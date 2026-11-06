/**
 * Host half of the plan board.
 *
 * The board is browser code (`client.js`). This half answers the questions the
 * browser cannot answer on its own: which plans a workspace has, what one
 * plan's detail looks like, whether it carries a rhythm snapshot, and the plan's
 * conversation with its DSH agent.
 *
 * Plan files stay the single source of truth for stage and progress. The only
 * durable state this plugin owns is the conversation store (comments plus the
 * session binding), which never writes back into `doc/plans/`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { buildBoard, buildCadence, buildPlanDetail, todayOf } from './src/board.mjs';
import { DiscussionStore, MAX_COMMENT_CHARS, PlanDiscussionService } from './src/discussion.mjs';
import { createDshSessionRuntime } from './src/dsh-session.mjs';
import { PLANS_DIR } from './src/scan-plans.mjs';

/** Board payload route. */
export const BOARD_ROUTE_PATH = '/plan-board/board';
/** One plan's detail route; the slug is a query parameter, never a path segment. */
export const PLAN_ROUTE_PATH = '/plan-board/plan';
/** Cadence payload route. */
export const CADENCE_ROUTE_PATH = '/plan-board/cadence';
/** Registered workspaces, so the panel can pick a board without a Session. */
export const WORKSPACES_ROUTE_PATH = '/plan-board/workspaces';
/** One plan's conversation: GET reads, POST comments or delivers. */
export const DISCUSSION_ROUTE_PATH = '/plan-board/discussion';
/** Cross-plan conversation search and the pending-reply inbox. */
export const SEARCH_ROUTE_PATH = '/plan-board/search';

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'connection', 'workspaceRegistry'];

/** Name of the agent tool that posts a plan comment back to the board. */
export const COMMENT_TOOL_NAME = 'plan_board_comment_add';

/** How long one workspace's board answer serves a polling client. */
const CACHE_TTL_MS = 15_000;
/** Keep at most this many workspace answers. */
const MAX_CACHE_ENTRIES = 8;
/** Largest accepted JSON body; a comment is bounded well below this. */
const MAX_BODY_BYTES = 64 * 1024;
/** Bytes of a plan file shown to the agent as conversation context. */
const PLAN_CONTEXT_BYTES = 20_000;

/** @type {Map<string, { at: number, refresh: string, value: unknown }>} */
const cache = new Map();
/** @type {DiscussionStore | undefined} */
let discussionStore;

/**
 * Read a host service without tripping Cordis's access guard.
 *
 * Cordis throws when a plugin reads a service it did not declare in `inject`.
 * Every optional capability here (tools, agents, sessions, persistence) is
 * probed through `ctx.get`, so a profile without it degrades the feature instead
 * of failing the whole entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} name - service name.
 * @returns {any} service, or undefined when absent.
 */
function serviceOf(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map one discussion failure to an honest status.
 *
 * A retryable runtime problem (no agent runtime, session owned elsewhere,
 * workspace moved) must not look like a malformed request; the client shows
 * the message either way, and the pending comments stay queued.
 * @param {unknown} error - thrown value.
 * @returns {{ status: number, error: string }} status and stable code.
 */
function deliveryOutcome(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('没有待投递的留言')) return { status: 409, error: 'nothing-pending' };
  if (message.includes('留言不能')) return { status: 400, error: 'invalid-comment' };
  if (message.includes('不支持任务会话') || message.includes('工作区已经变化')
    || message.includes('正被其他窗口使用') || message.includes('格式不受支持')
    || message.includes('不是合法 JSON')) {
    return { status: 503, error: 'delivery-unavailable' };
  }
  return { status: 500, error: 'delivery-failed' };
}

/**
 * Send one JSON answer.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON body.
 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Whether a canonical directory belongs to a registered workspace.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} candidate - canonical path.
 * @returns {boolean} confinement result.
 */
function isInsideWorkspace(ctx, candidate) {
  for (const workspace of ctx.workspaceRegistry.list()) {
    const base = path.resolve(workspace.path);
    if (candidate === base || candidate.startsWith(base + path.sep)) return true;
  }
  return false;
}

/**
 * Resolve and authorize the requested workspace directory.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} raw - `path` query value.
 * @returns {Promise<string | undefined>} canonical directory, or undefined when refused.
 */
async function resolveWorkspace(ctx, raw) {
  if (typeof raw !== 'string' || raw === '' || raw.includes('\0') || !path.isAbsolute(raw)) {
    return undefined;
  }
  let canonical;
  try {
    canonical = await fs.realpath(raw);
  } catch {
    return undefined;
  }
  return isInsideWorkspace(ctx, canonical) ? canonical : undefined;
}

/**
 * Read one query parameter without throwing on a malformed URL.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {string} name - parameter.
 * @returns {string} value, or ''.
 */
function queryOf(req, name) {
  try {
    return new URL(String(req.url), 'http://127.0.0.1').searchParams.get(name) ?? '';
  } catch {
    return '';
  }
}

/**
 * Read one bounded JSON body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} parsed object; throws on bad input.
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象');
  }
  return parsed;
}

/**
 * Cached board answer for a workspace.
 * @param {string} workspace - canonical workspace directory.
 * @param {string} kind - cache key suffix.
 * @param {() => Promise<unknown>} load - producer.
 * @param {string} [refresh=''] - manual refresh token.
 * @returns {Promise<unknown>} payload.
 */
function cached(workspace, kind, load, refresh = '') {
  const key = `${workspace}\u0000${kind}`;
  const hit = cache.get(key);
  if (hit !== undefined
    && Date.now() - hit.at < CACHE_TTL_MS
    && (refresh === '' || hit.refresh === refresh)) {
    return Promise.resolve(hit.value);
  }
  return load().then((value) => {
    cache.set(key, { at: Date.now(), refresh, value });
    if (cache.size > MAX_CACHE_ENTRIES) {
      for (const [entryKey, entry] of cache) {
        if (Date.now() - entry.at > CACHE_TTL_MS * 4) cache.delete(entryKey);
      }
    }
    return value;
  });
}

/**
 * Guard one request: trust fence, method, then the authorized workspace.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {string} [method='GET'] - allowed method.
 * @returns {Promise<string | undefined>} workspace directory, or undefined after answering.
 */
async function admitted(ctx, req, res, method = 'GET') {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection !== undefined) {
    res.statusCode = rejection;
    res.end();
    return undefined;
  }
  if (req.method !== method) {
    res.statusCode = 405;
    res.setHeader('allow', method);
    res.end();
    return undefined;
  }
  const workspace = await resolveWorkspace(ctx, queryOf(req, 'path'));
  if (workspace === undefined) {
    sendJson(res, 403, { error: 'workspace-not-allowed' });
    return undefined;
  }
  return workspace;
}

/**
 * Serve `GET /plan-board/board`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleBoard(ctx, req, res) {
  const workspace = await admitted(ctx, req, res);
  if (workspace === undefined) return;
  try {
    sendJson(res, 200, await cached(workspace, 'board', () => buildBoard(workspace), queryOf(req, 'refresh')));
  } catch (error) {
    sendJson(res, 500, { error: 'board-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Read the plan body the agent needs as conversation context.
 * @param {string} workspace - canonical workspace directory.
 * @param {string} slug - validated plan slug.
 * @param {boolean} archived - whether the plan sits in `done/`.
 * @returns {Promise<string>} plan text, or '' when unreadable.
 */
async function readPlanContext(workspace, slug, archived) {
  const file = path.join(workspace, PLANS_DIR, archived ? 'done' : '', `${slug}.md`);
  try {
    const text = await fs.readFile(file, 'utf8');
    return text.length > PLAN_CONTEXT_BYTES
      ? `${text.slice(0, PLAN_CONTEXT_BYTES)}\n\n（计划正文已截断，完整内容见计划文件）`
      : text;
  } catch {
    return '';
  }
}

/**
 * Serve `GET /plan-board/plan?slug=…`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handlePlan(ctx, req, res) {
  const workspace = await admitted(ctx, req, res);
  if (workspace === undefined) return;
  const slug = queryOf(req, 'slug');
  try {
    const detail = await buildPlanDetail(workspace, slug);
    if (detail === undefined) {
      sendJson(res, 404, { error: 'plan-not-found', slug });
      return;
    }
    sendJson(res, 200, detail);
  } catch (error) {
    sendJson(res, 500, { error: 'plan-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Serve `GET /plan-board/cadence`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleCadence(ctx, req, res) {
  const workspace = await admitted(ctx, req, res);
  if (workspace === undefined) return;
  try {
    sendJson(res, 200, await cached(workspace, 'cadence', () => buildCadence(workspace), queryOf(req, 'refresh')));
  } catch (error) {
    sendJson(res, 500, { error: 'cadence-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Serve `GET /plan-board/workspaces` — the workspaces a board can be opened for.
 *
 * The panel is a global `main` entry, not a Session-scoped one, so it has no
 * `workingDirectory` projection to read; it asks the host instead. Only
 * directories that already contain `doc/plans/` can host a board, so the list is
 * filtered here rather than handing the browser paths that would render empty.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleWorkspaces(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection !== undefined) {
    res.statusCode = rejection;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }
  const items = [];
  for (const workspace of ctx.workspaceRegistry.list()) {
    const counts = await planCounts(workspace.path);
    if (counts === undefined) continue;
    items.push({
      path: workspace.path,
      title: workspace.title ?? path.basename(workspace.path),
      ...counts,
    });
  }
  // The boarded workspace first: a board with live plans is what the panel is
  // for, and every other workspace would open onto an empty page. Registration
  // order says nothing about which one the user works in.
  items.sort((a, b) => b.live - a.live || b.archived - a.archived || a.title.localeCompare(b.title));
  sendJson(res, 200, items);
}

/**
 * How many plan files a workspace holds.
 * @param {string} workspace - absolute workspace directory.
 * @returns {Promise<{ live: number, archived: number } | undefined>} counts, or
 *   undefined when the workspace has no `doc/plans/` at all.
 */
async function planCounts(workspace) {
  const plansRoot = path.join(workspace, 'doc', 'plans');
  const count = async (dir) => {
    try {
      const names = await fs.readdir(dir);
      return names.filter((name) => name.endsWith('.md')).length;
    } catch {
      return undefined;
    }
  };
  const live = await count(plansRoot);
  if (live === undefined) return undefined;
  return { live, archived: (await count(path.join(plansRoot, 'done'))) ?? 0 };
}

/**
 * Create a discussion service bound to the workspace's board.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {PlanDiscussionService} service.
 */
function createDiscussion(ctx) {
  discussionStore ??= new DiscussionStore();
  return new PlanDiscussionService({
    store: discussionStore,
    runtime: createDshSessionRuntime(ctx),
    readPlan: readPlanContext,
  });
}

/**
 * POST bodies the discussion route accepts.
 *   `{ action: 'comment', body }` records a user comment without waking an agent.
 *   `{ action: 'deliver', body? }` records (optionally) and delivers every pending
 *   user comment to the plan's DSH conversation.
 */
async function handlePostDiscussion(ctx, req, res, workspace) {
  const discussion = createDiscussion(ctx);
  try {
    const slug = queryOf(req, 'slug');
    const detail = await buildPlanDetail(workspace, slug);
    if (detail === undefined) {
      sendJson(res, 404, { error: 'plan-not-found', slug });
      return;
    }
    const payload = await readJsonBody(req);
    const action = payload.action;
    const body = typeof payload.body === 'string' ? payload.body : '';
    if (body.length > MAX_COMMENT_CHARS) {
      sendJson(res, 400, { error: 'comment-too-long', message: `留言不能超过 ${MAX_COMMENT_CHARS} 字` });
      return;
    }
    if (action === 'comment') {
      try {
        sendJson(res, 200, await discussion.comment(workspace, slug, body));
      } catch (error) {
        const { status, error: code } = deliveryOutcome(error);
        sendJson(res, status, {
          error: code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (action === 'deliver') {
      if (detail.archived === true) {
        sendJson(res, 409, { error: 'archived', message: '已归档计划不再唤醒 Agent' });
        return;
      }
      try {
        sendJson(res, 202, await discussion.deliver(workspace, slug, body, detail));
      } catch (error) {
        const { status, error: code } = deliveryOutcome(error);
        sendJson(res, status, {
          error: code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    sendJson(res, 400, { error: 'unknown-action', action: typeof action === 'string' ? action : null });
  } catch (error) {
    const { status, error: code } = deliveryOutcome(error);
    sendJson(res, status === 500 ? 400 : status, {
      error: code,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Serve `GET|POST /plan-board/discussion?slug=…`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleDiscussion(ctx, req, res) {
  if (req.method === 'POST') {
    const workspace = await admitted(ctx, req, res, 'POST');
    if (workspace === undefined) return;
    await handlePostDiscussion(ctx, req, res, workspace);
    return;
  }
  const workspace = await admitted(ctx, req, res);
  if (workspace === undefined) return;
  const slug = queryOf(req, 'slug');
  try {
    const detail = await buildPlanDetail(workspace, slug);
    if (detail === undefined) {
      sendJson(res, 404, { error: 'plan-not-found', slug });
      return;
    }
    sendJson(res, 200, await createDiscussion(ctx).get(workspace, slug));
  } catch (error) {
    sendJson(res, 500, { error: 'discussion-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

/** Register the agent tool that lets a bound session answer on the board. */
function registerAgentTool(ctx) {
  const tools = serviceOf(ctx, 'tools');
  if (tools === undefined) return;
  const result = tools.register({
    name: COMMENT_TOOL_NAME,
    description:
      'Post a reply to the plan board conversation this session is bound to. '
      + 'Call it once at the end of each delivery to summarize what changed, how it was verified, '
      + 'and what still needs the user\'s decision.',
    parameters: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Reply text (1..4000 chars).' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: `已回复到计划看板；当前共 ${value?.total ?? '?'} 条沟通记录。` }],
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id;
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('计划看板回复必须来自会话内的 Agent');
      }
      const body = typeof args?.body === 'string' ? args.body.trim() : '';
      if (body.length === 0) throw new Error('回复不能为空');
      if (body.length > MAX_COMMENT_CHARS) throw new Error(`回复不能超过 ${MAX_COMMENT_CHARS} 字`);
      const discussion = await createDiscussion(ctx).agentComment(sessionId, body);
      return { total: discussion.comments.length, slug: discussion.slug, sessionId };
    },
  });
  ctx.effect(() => result, 'dsh-plan-board: plan_board_comment_add');
}

/**
 * Serve `GET /plan-board/search` — the derived SQLite index.
 *
 * Two shapes, both answered by the index rather than a JSON scan:
 *   `?mode=pending` lists plans still holding undelivered user comments;
 *   `?q=<text>` searches every plan's comments.
 * When the index is unavailable the route still answers 200 with
 * `available:false` plus a reason, because search is an accelerator and its
 * absence is not an error in the board.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleSearch(ctx, req, res) {
  const workspace = await admitted(ctx, req, res);
  if (workspace === undefined) return;
  const store = discussionStore ??= new DiscussionStore();
  try {
    if (queryOf(req, 'mode') === 'pending') {
      const result = await store.pendingPlans(queryOf(req, 'scope') === 'all' ? undefined : workspace);
      sendJson(res, 200, result);
      return;
    }
    const limit = Number(queryOf(req, 'limit')) || 50;
    const result = await store.searchComments(queryOf(req, 'q'), {
      limit,
      pendingOnly: queryOf(req, 'pending') === '1',
      workspace: queryOf(req, 'scope') === 'all' ? undefined : workspace,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, {
      error: 'search-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Register the read-only routes and the one write route that keeps the
 * conversation (never the plans) up to date.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const routes = [
    [WORKSPACES_ROUTE_PATH, handleWorkspaces],
    [BOARD_ROUTE_PATH, handleBoard],
    [PLAN_ROUTE_PATH, handlePlan],
    [CADENCE_ROUTE_PATH, handleCadence],
    [DISCUSSION_ROUTE_PATH, handleDiscussion],
    [SEARCH_ROUTE_PATH, handleSearch],
  ];
  for (const [routePath, handler] of routes) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: (req, res) => handler(ctx, req, res),
      }),
      `dsh-plan-board: ${routePath}`,
    );
  }
  registerAgentTool(ctx);
  ctx.effect(() => () => {
    discussionStore?.close();
    discussionStore = undefined;
  }, 'dsh-plan-board: discussion store');
}

export { todayOf };

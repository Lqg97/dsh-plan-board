/**
 * Host half of the plan board.
 *
 * The board is browser code (`client.js`). This half answers the three read-only
 * questions the browser cannot answer on its own: which plans does the selected
 * workspace have, what does one plan's detail look like, and does the workspace
 * carry a rhythm snapshot. Reads are confined to registered Workspace
 * directories, exactly like the shipped status bar route.
 */

import path from 'node:path';

import { buildBoard, buildCadence, buildPlanDetail } from './src/board.mjs';

/** Board payload route. */
export const BOARD_ROUTE_PATH = '/plan-board/board';
/** One plan's detail route; the slug is a query parameter, never a path segment. */
export const PLAN_ROUTE_PATH = '/plan-board/plan';
/** Cadence payload route. */
export const CADENCE_ROUTE_PATH = '/plan-board/cadence';
/** Registered workspaces, so the panel can pick a board without a Session. */
export const WORKSPACES_ROUTE_PATH = '/plan-board/workspaces';

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'connection', 'workspaceRegistry'];

/** How long one workspace's board answer serves a polling client. */
const CACHE_TTL_MS = 15_000;
/** Keep at most this many workspace answers. */
const MAX_CACHE_ENTRIES = 8;

/** @type {Map<string, { at: number, value: unknown }>} */
const cache = new Map();

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
    canonical = await import('node:fs/promises').then((fs) => fs.realpath(raw));
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
 * Cached board answer for a workspace.
 * @param {string} workspace - canonical workspace directory.
 * @param {string} kind - cache key suffix.
 * @param {() => Promise<unknown>} load - producer.
 * @returns {Promise<unknown>} payload.
 */
function cached(workspace, kind, load) {
  const key = `${workspace}\u0000${kind}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
  return load().then((value) => {
    cache.set(key, { at: Date.now(), value });
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
 * @returns {Promise<string | undefined>} workspace directory, or undefined after answering.
 */
async function admitted(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection !== undefined) {
    res.statusCode = rejection;
    res.end();
    return undefined;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
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
    sendJson(res, 200, await cached(workspace, 'board', () => buildBoard(workspace)));
  } catch (error) {
    sendJson(res, 500, { error: 'board-failed', message: error instanceof Error ? error.message : String(error) });
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
    sendJson(res, 200, await cached(workspace, 'cadence', () => buildCadence(workspace)));
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
  const { readdir } = await import('node:fs/promises');
  const plansRoot = path.join(workspace, 'doc', 'plans');
  const count = async (dir) => {
    try {
      const names = await readdir(dir);
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
 * Register the read-only routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const routes = [
    [WORKSPACES_ROUTE_PATH, handleWorkspaces],
    [BOARD_ROUTE_PATH, handleBoard],
    [PLAN_ROUTE_PATH, handlePlan],
    [CADENCE_ROUTE_PATH, handleCadence],
  ];
  for (const [routePath, handler] of routes) {
    ctx.effect(
      () => ctx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: (req, res) => handler(ctx, req, res),
      }),
      `dsh-plan-board: GET ${routePath}`,
    );
  }
}

/**
 * Route test for the plan board bundle.
 *
 * Exercises `apply()` against a fake Cordis context and the real filesystem:
 * workspace confinement, method guards, and the shapes the Client relies on.
 * Run from the workspace root:
 *
 *   node test/route.test.mjs
 *
 * Override the workspace with `DSH_PLAN_BOARD_TEST_WORKSPACE`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as plugin from '../index.js';

const WORKSPACE = path.resolve(process.env.DSH_PLAN_BOARD_TEST_WORKSPACE ?? path.join(import.meta.dirname, '../../../competition'));

/**
 * Fake context carrying just the services `apply` touches.
 * @param {string[]} workspaces - registered workspace directories.
 * @returns {{ ctx: object, routes: Map<string, Function> }} context and captured routes.
 */
function makeContext(workspaces) {
  const routes = new Map();
  const ctx = {
    effect(fn) {
      fn();
      return () => {};
    },
    connection: {
      requestRejection() {
        return undefined;
      },
    },
    workspaceRegistry: {
      list() {
        return workspaces.map((dir) => ({ id: `ws-${path.basename(dir)}`, path: dir, title: path.basename(dir) }));
      },
    },
    agents: {
      _live: new Map(),
      get(id) {
        return this._live.get(id);
      },
      async create(options) {
        const agent = {
          id: options.sessionId,
          status: 'idle',
          session: { header: { cwd: options.meta.cwd } },
          injected: [],
          followedUp: [],
          inject(message) {
            this.injected.push(message);
          },
          followup(message) {
            this.followedUp.push(message);
          },
          async whenIdle() {},
        };
        this._live.set(options.sessionId, agent);
        return { agent, dispose: async () => {} };
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => {};
      },
    },
    get(name) {
      return this[name];
    },
  };
  return { ctx, routes };
}

/**
 * Minimal response recorder.
 * @returns {object} response double with parsed body afterwards.
 */
function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body += chunk ?? '';
    },
    get json() {
      try {
        return JSON.parse(this.body);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Call one captured route.
 * @param {Function} handler - route handler.
 * @param {string} url - request URL with query.
 * @param {string} [method] - HTTP method.
 * @returns {Promise<object>} response double.
 */
async function call(handler, url, method = 'GET') {
  const res = makeResponse();
  await handler({ url, method }, res);
  return res;
}

test('all routes register on apply', () => {
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  assert.deepEqual([...routes.keys()].sort(), [
    '/plan-board/board',
    '/plan-board/cadence',
    '/plan-board/discussion',
    '/plan-board/plan',
    '/plan-board/search',
    '/plan-board/workspaces',
  ]);
});

test('workspace listing reports plan counts and leads with the busiest board', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-nows-'));
  const archivedOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-doneonly-'));
  try {
    fs.mkdirSync(path.join(archivedOnly, 'doc/plans/done'), { recursive: true });
    fs.writeFileSync(path.join(archivedOnly, 'doc/plans/done/old.md'), '# old\n');
    const { ctx, routes } = makeContext([empty, archivedOnly, WORKSPACE]);
    plugin.apply(ctx);
    const res = await call(routes.get('/plan-board/workspaces'), '/plan-board/workspaces');
    assert.equal(res.statusCode, 200);

    // Only workspaces that carry doc/plans/ are offered; the rest would render empty.
    const paths = res.json.map((item) => item.path);
    assert.ok(!paths.includes(empty));
    assert.ok(paths.includes(WORKSPACE));
    assert.ok(paths.includes(archivedOnly));

    // Counts let the picker explain itself, and a board with live plans leads.
    for (const item of res.json) {
      assert.equal(typeof item.live, 'number', `live count for ${item.title}`);
      assert.equal(typeof item.archived, 'number', `archived count for ${item.title}`);
      assert.ok(!('hasPlans' in item), 'hasPlans is superseded by the counts');
    }
    assert.equal(res.json[0].path, WORKSPACE, 'busiest board first');
    assert.ok(res.json[0].live >= res.json[res.json.length - 1].live);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(archivedOnly, { recursive: true, force: true });
  }
});

test('unregistered and relative paths are refused', async () => {
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const board = routes.get('/plan-board/board');
  for (const candidate of ['', '/etc', 'relative/dir', `${WORKSPACE}\u0000x`]) {
    const res = await call(board, `/plan-board/board?path=${encodeURIComponent(candidate)}`);
    assert.equal(res.statusCode, 403, `candidate ${JSON.stringify(candidate)}`);
  }
});

test('non-GET methods are rejected with 405', async () => {
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const res = await call(routes.get('/plan-board/board'), `/plan-board/board?path=${encodeURIComponent(WORKSPACE)}`, 'POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});

test('board payload has the counts, columns and cards the panel draws', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const res = await call(routes.get('/plan-board/board'), `/plan-board/board?path=${encodeURIComponent(WORKSPACE)}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const payload = res.json;
  assert.ok(Array.isArray(payload.cards) && payload.cards.length > 0);
  assert.equal(payload.cards.length, payload.counts.total);
  assert.equal(payload.counts.live + payload.counts.archived, payload.counts.total);
  assert.equal(payload.wip.columns.length, 6);
  for (const key of ['design', 'doing', 'blocked', 'ci', 'release', 'archived']) {
    const column = payload.wip.columns.find((entry) => entry.key === key);
    assert.ok(column !== undefined, `column ${key}`);
    assert.equal(column.plans.length, column.count, `column ${key} count`);
  }
  const first = payload.cards[0];
  for (const field of ['slug', 'title', 'stage', 'stageLabel', 'stageReason', 'health', 'idleDays',
    'headerStatusDate', 'lastProgressDate', 'progressCount', 'mergeRequests', 'repositories', 'recentProgress']) {
    assert.ok(field in first, `card field ${field}`);
  }
});

test('board refresh tokens bypass and then replace the cached payload', async () => {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-refresh-')));
  try {
    fs.mkdirSync(path.join(workspace, 'doc/plans'), { recursive: true });
    const plan = path.join(workspace, 'doc/plans/refresh.md');
    fs.writeFileSync(plan, '# A\n');
    const { ctx, routes } = makeContext([workspace]);
    plugin.apply(ctx);
    const board = routes.get('/plan-board/board');
    const url = (refresh) => `/plan-board/board?path=${encodeURIComponent(workspace)}${refresh}`;

    let res = await call(board, url('&refresh=0'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.cards[0].title, 'A');

    fs.writeFileSync(plan, '# B\n');
    res = await call(board, url('&refresh=0'));
    assert.equal(res.json.cards[0].title, 'A', 'the same token reuses its TTL cache');

    res = await call(board, url('&refresh=1'));
    assert.equal(res.json.cards[0].title, 'B', 'a new token reloads the workspace');

    fs.writeFileSync(plan, '# C\n');
    res = await call(board, url(''));
    assert.equal(res.json.cards[0].title, 'B', 'the refreshed value replaces the shared cache');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('detail route answers 404 for unknown or hostile slugs', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const plan = routes.get('/plan-board/plan');
  for (const slug of ['', '../../etc/passwd', 'no-such-plan']) {
    const res = await call(plan, `/plan-board/plan?path=${encodeURIComponent(WORKSPACE)}&slug=${encodeURIComponent(slug)}`);
    assert.equal(res.statusCode, 404, `slug ${JSON.stringify(slug)}`);
  }
});

test('the discussion route needs a POST, a known plan and an action', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-home-'));
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const discussion = routes.get('/plan-board/discussion');
  const read = await call(discussion, `/plan-board/discussion?path=${encodeURIComponent(WORKSPACE)}&slug=no-such-plan`);
  assert.equal(read.statusCode, 404);

  const wrongMethod = await call(discussion, `/plan-board/discussion?path=${encodeURIComponent(WORKSPACE)}&slug=no-such-plan`, 'PUT');
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, 'GET');

  const refused = await call(discussion, '/plan-board/discussion?path=/etc&slug=x', 'POST');
  assert.equal(refused.statusCode, 403);
});

test('the search route answers with the index availability, never an error', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-home-'));
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const search = routes.get('/plan-board/search');
  const query = `?path=${encodeURIComponent(WORKSPACE)}`;

  const hits = await call(search, `/plan-board/search${query}&q=CI`);
  assert.equal(hits.statusCode, 200);
  assert.equal(typeof hits.json.available, 'boolean');
  assert.ok(Array.isArray(hits.json.rows));

  const pending = await call(search, `/plan-board/search${query}&mode=pending`);
  assert.equal(pending.statusCode, 200);
  assert.ok(Array.isArray(pending.json.rows));

  const refused = await call(search, '/plan-board/search?path=/etc&q=x');
  assert.equal(refused.statusCode, 403);

  const wrongMethod = await call(search, `/plan-board/search${query}&q=x`, 'POST');
  assert.equal(wrongMethod.statusCode, 405);
});

test('the agent tool refuses to reply without a bound session', async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-home-'));
  const tools = new Map();
  const { ctx } = makeContext([WORKSPACE]);
  ctx.tools = {
    register(tool) {
      tools.set(tool.name, tool);
      return () => {};
    },
  };
  plugin.apply(ctx);
  const tool = tools.get(plugin.COMMENT_TOOL_NAME);
  assert.ok(tool !== undefined, 'the comment tool registers on apply');
  assert.equal(tool.parameters.additionalProperties, false);
  await assert.rejects(() => tool.execute({ body: '你好' }, { agent: { id: 'session-unbound' } }), /没有关联/);
  await assert.rejects(() => tool.execute({ body: '你好' }, {}), /必须来自会话内/);
});

test('a plan conversation is recorded, delivered once and answered by the agent tool', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-home-'));
  const slug = fs.readdirSync(path.join(WORKSPACE, 'doc/plans'))
    .find((name) => name.endsWith('.md'))?.replace(/\.md$/, '');
  t.diagnostic(`plan under test: ${slug}`);

  const tools = new Map();
  const { ctx, routes } = makeContext([WORKSPACE]);
  ctx.tools = { register(tool) { tools.set(tool.name, tool); return () => {}; } };
  plugin.apply(ctx);

  const discussion = routes.get('/plan-board/discussion');
  const query = `?path=${encodeURIComponent(WORKSPACE)}&slug=${encodeURIComponent(slug)}`;
  const post = async (body) => {
    const res = makeResponse();
    const payload = JSON.stringify(body);
    await discussion({
      url: `/plan-board/discussion${query}`,
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload);
      },
    }, res);
    return res;
  };

  // 1. Comment only: durable, pending, and no session was created.
  const commented = await post({ action: 'comment', body: '请补充 CI 日志' });
  assert.equal(commented.statusCode, 200);
  assert.equal(commented.json.pending, 1);
  assert.equal(commented.json.sessionId, null);
  assert.equal(ctx.agents._live.size, 0, 'a comment must not wake an agent');

  // 2. Deliver: one user message + one framing injection, and the backlog is consumed.
  const delivered = await post({ action: 'deliver', body: '另外看一下评审意见' });
  assert.equal(delivered.statusCode, 202);
  assert.equal(delivered.json.count, 2, 'both pending comments go out together');
  assert.equal(delivered.json.discussion.pending, 0);
  const agent = ctx.agents._live.get(delivered.json.sessionId);
  assert.equal(agent.followedUp.length, 1);
  assert.ok(agent.followedUp[0].content[0].text.includes('请补充 CI 日志'));
  assert.ok(agent.followedUp[0].content[0].text.includes('另外看一下评审意见'));
  assert.equal(agent.injected.length, 1);
  assert.equal(agent.injected[0].source.kind, 'dsh-plan-board');

  // 3. The agent replies through the tool: it lands on the same plan's thread.
  const tool = tools.get(plugin.COMMENT_TOOL_NAME);
  await tool.execute({ body: '已补日志并修好 CI' }, { agent: { id: delivered.json.sessionId } });
  const after = await call(discussion, `/plan-board/discussion${query}`);
  assert.equal(after.statusCode, 200);
  const reply = after.json.comments.at(-1);
  assert.equal(reply.author, 'agent');
  assert.equal(reply.body, '已补日志并修好 CI');
  assert.equal(after.json.sessionId, delivered.json.sessionId);

  // 4. Re-delivering with nothing pending is refused, not silently repeated.
  const again = await post({ action: 'deliver', body: '' });
  // 409 conflict, not 400: the request was well formed, there was just nothing left to send.
  assert.equal(again.statusCode, 409);
  assert.equal(again.json.error, 'nothing-pending');
});

test('an archived plan is not woken through the discussion route', async (t) => {
  const doneDir = path.join(WORKSPACE, 'doc/plans/done');
  if (!fs.existsSync(doneDir)) {
    t.skip(`no doc/plans/done under ${WORKSPACE}`);
    return;
  }
  const slug = fs.readdirSync(doneDir).find((name) => name.endsWith('.md'))?.replace(/\.md$/, '');
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-home-'));
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const res = makeResponse();
  const payload = JSON.stringify({ action: 'deliver', body: '还在吗' });
  await routes.get('/plan-board/discussion')({
    url: `/plan-board/discussion?path=${encodeURIComponent(WORKSPACE)}&slug=${encodeURIComponent(slug)}`,
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    },
  }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json.error, 'archived');
});

test('cadence route reports a missing snapshot instead of failing', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  const res = await call(routes.get('/plan-board/cadence'), `/plan-board/cadence?path=${encodeURIComponent(WORKSPACE)}`);
  assert.equal(res.statusCode, 200);
  assert.ok('found' in res.json);
  if (res.json.found === true) {
    assert.ok(Array.isArray(res.json.heat));
    assert.ok(Array.isArray(res.json.weekly));
  }
});

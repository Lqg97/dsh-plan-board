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
        return workspaces.map((dir) => ({ path: dir, title: path.basename(dir) }));
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => {};
      },
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

test('all five routes register on apply', () => {
  const { ctx, routes } = makeContext([WORKSPACE]);
  plugin.apply(ctx);
  assert.deepEqual([...routes.keys()].sort(), [
    '/plan-board/board',
    '/plan-board/cadence',
    '/plan-board/plan',
    '/plan-board/workspaces',
  ]);
});

test('workspace listing keeps only directories holding doc/plans', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-nows-'));
  try {
    const { ctx, routes } = makeContext([WORKSPACE, empty]);
    plugin.apply(ctx);
    const res = await call(routes.get('/plan-board/workspaces'), '/plan-board/workspaces');
    assert.equal(res.statusCode, 200);
    const paths = res.json.map((item) => item.path);
    assert.ok(paths.includes(WORKSPACE));
    assert.ok(!paths.includes(empty));
    assert.ok(res.json.every((item) => item.hasPlans === true));
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
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

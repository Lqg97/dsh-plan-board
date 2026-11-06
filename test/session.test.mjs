/**
 * Contract test for the DSH session adapter.
 *
 * These doubles are shaped from the SHIPPED runtime (dsh-agent-loop
 * `createAgent`/`resume`, `AgentPresetRegistry.resolve/mount`), not from what
 * the plugin wishes the API looked like. That difference is exactly what let an
 * earlier version pass its route tests while failing on a real host:
 *
 * - `agents.create` requires `{ sessionId, meta: { cwd } }` and runs
 *   `setup(agentCtx, agent)`; a setup that dereferences a missing field throws;
 * - `agentPresets` exposes `defaultId`, `resolve(id)` and `mount(agentCtx, id)`
 *   — there is no `defaultPresetId` and no `get()`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDshSessionRuntime } from '../src/dsh-session.mjs';

const WORKSPACE = '/tmp/plan-board-workspace';

/** A preset registry with the real member names. */
function fakePresets(defaultId = 'default') {
  const calls = { resolve: [], mount: [] };
  return {
    calls,
    defaultId,
    async resolve(id) {
      calls.resolve.push(id ?? this.defaultId);
      return { id: id ?? this.defaultId };
    },
    async mount(agentCtx, id) {
      if (agentCtx === undefined) throw new Error('mount requires a scoped agent context');
      calls.mount.push(id);
      return { id };
    },
  };
}

/** An agent registry with the real create/resume shapes. */
function makeAgents(options = {}) {
  const calls = { created: [], resumed: [], setupCalls: [] };
  const live = new Map();
  const makeAgent = (id) => ({
    id,
    status: 'idle',
    session: { header: { cwd: options.cwd ?? WORKSPACE } },
    inject() {},
    followup() {},
    async whenIdle() {},
  });
  const agents = {
    calls,
    live,
    get(id) {
      return live.get(id);
    },
    async create(request) {
      // Mirror the runtime's real requirements.
      if (typeof request?.sessionId !== 'string' || request.sessionId === '') {
        throw new Error('create requires a sessionId');
      }
      if (request.meta?.cwd === undefined) throw new Error('create requires meta.cwd');
      calls.created.push(request);
      const agent = makeAgent(request.sessionId);
      if (typeof request.setup === 'function') {
        // The runtime runs setup BEFORE publishing, with (agentCtx, agent).
        const commit = await request.setup({ sessions: {}, reflect: {} }, agent);
        calls.setupCalls.push(commit);
      }
      live.set(request.sessionId, agent);
      return { agent, dispose: async () => {} };
    },
    async resume(request) {
      if (typeof request?.resumeSessionId !== 'string') throw new Error('resume requires resumeSessionId');
      calls.resumed.push(request);
      const agent = makeAgent(request.resumeSessionId);
      if (typeof request.setup === 'function') await request.setup({}, agent);
      live.set(request.resumeSessionId, agent);
      return { agent, dispose: async () => {} };
    },
  };
  return agents;
}

function makeContext(overrides = {}) {
  const agents = overrides.agents ?? makeAgents(overrides);
  const presets = 'presets' in overrides ? overrides.presets : fakePresets();
  const services = {
    agents,
    agentPresets: presets,
    workspaceRegistry: {
      list: () => [{ id: 'w1', path: WORKSPACE, title: 'plan-board' }],
      archivedSessionIds: [],
      async attach() {},
      ...overrides.workspaceRegistry,
    },
    sessionPersistence: {
      async stat() {
        return { header: { cwd: overrides.storedCwd ?? WORKSPACE } };
      },
      ...overrides.sessionPersistence,
    },
  };
  const ctx = {
    // The real access path. A bare `ctx.agents` would throw on a real context
    // for anything not in `inject`, so the adapter must only use this.
    get(name) {
      return services[name];
    },
  };
  return { ctx, agents, presets, services };
}

test('a fresh plan composes the default preset the way the runtime does', async () => {
  const { ctx, agents, presets } = makeContext();
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: '计划看板', sessionId: null });

  assert.equal(opened.created, true);
  // The preset is resolved and mounted, not read off invented fields.
  assert.deepEqual(presets.calls.resolve, ['default']);
  assert.deepEqual(presets.calls.mount, ['default']);
  // create() gets a real sessionId + meta.cwd, and a setup that ran.
  const request = agents.calls.created[0];
  assert.equal(typeof request.sessionId, 'string');
  assert.equal(request.meta.cwd, WORKSPACE);
  assert.equal(request.meta.agentPreset, 'default');
  assert.equal(typeof request.setup, 'function');
});

test('setup never dereferences a missing composition field', async () => {
  // A roster that resolves but whose resolved record has no `composition`:
  // the old implementation read `spec.composition.allowedTools` here.
  const presets = {
    defaultId: 'broken',
    async resolve() {
      return { id: 'broken' };
    },
    async mount() {
      return { id: 'broken' };
    },
  };
  const { ctx } = makeContext({ presets });
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: null });
  assert.equal(opened.created, true);
});

test('a roster without the real API degrades to a bare session instead of throwing', async () => {
  const { ctx } = makeContext({ presets: { defaultPresetId: 'x', get: async () => ({}) } });
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: null });
  assert.equal(opened.created, true);
});

test('a live compatible session is borrowed without re-creating or re-composing', async () => {
  const { ctx, agents, presets } = makeContext();
  agents.live.set('session-live', {
    id: 'session-live',
    status: 'idle',
    session: { header: { cwd: WORKSPACE } },
    inject() {},
    followup() {},
    async whenIdle() {},
  });
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-live' });

  assert.equal(opened.created, false);
  assert.equal(opened.sessionId, 'session-live');
  assert.equal(agents.calls.created.length, 0);
  assert.equal(agents.calls.resumed.length, 0);
  assert.equal(presets.calls.mount.length, 0, 'a borrowed agent keeps its own composition');
});

test('an idle stored session is resumed through resumeSessionId', async () => {
  const { ctx, agents } = makeContext();
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-stored' });

  assert.equal(opened.created, false);
  assert.equal(agents.calls.resumed.length, 1);
  assert.equal(agents.calls.resumed[0].resumeSessionId, 'session-stored');
  assert.equal(agents.calls.created.length, 0);
});

test('a resume that races another owner adopts the live agent instead of duplicating', async () => {
  const agents = makeAgents();
  const adoption = {
    id: 'session-raced',
    status: 'running',
    session: { header: { cwd: WORKSPACE } },
    inject() {},
    followup() {},
    async whenIdle() {},
  };
  let attempts = 0;
  agents.resume = async () => {
    attempts += 1;
    // The GUI (or a double click) won the race between our get() and resume().
    agents.live.set('session-raced', adoption);
    throw new Error('agent "session-raced" is already registered');
  };
  const { ctx } = makeContext({ agents });
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-raced' });

  assert.equal(attempts, 1);
  assert.equal(opened.sessionId, 'session-raced');
  assert.equal(opened.created, false, 'never silently opens a second session');
  assert.equal(agents.calls.created.length, 0);
});

test('an owned-but-unresolvable session is reported, not replaced', async () => {
  const agents = makeAgents();
  agents.resume = async () => {
    throw new Error('agent "session-held" is already registered');
  };
  const { ctx } = makeContext({ agents });
  const runtime = createDshSessionRuntime(ctx);
  await assert.rejects(
    () => runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-held' }),
    /正被其他窗口使用/,
  );
  assert.equal(agents.calls.created.length, 0);
});

test('a session bound to another workspace is refused', async () => {
  const { ctx, agents } = makeContext();
  agents.live.set('session-elsewhere', {
    id: 'session-elsewhere',
    status: 'idle',
    session: { header: { cwd: '/tmp/other-project' } },
    inject() {},
    followup() {},
    async whenIdle() {},
  });
  const runtime = createDshSessionRuntime(ctx);
  await assert.rejects(
    () => runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-elsewhere' }),
    /工作区已经变化/,
  );
});

test('a stored session in another workspace is refused before resume', async () => {
  const { ctx, agents } = makeContext({ storedCwd: '/tmp/other-project' });
  const runtime = createDshSessionRuntime(ctx);
  await assert.rejects(
    () => runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-stored' }),
    /工作区已经变化/,
  );
  assert.equal(agents.calls.resumed.length, 0);
  assert.equal(agents.calls.created.length, 0);
});

test('an archived session is replaced by a new one', async () => {
  const { ctx, agents } = makeContext({
    workspaceRegistry: { archivedSessionIds: ['session-archived'] },
  });
  const runtime = createDshSessionRuntime(ctx);
  const opened = await runtime.open({ workspace: WORKSPACE, title: 'x', sessionId: 'session-archived' });
  assert.equal(opened.created, true);
  assert.notEqual(opened.sessionId, 'session-archived');
  assert.equal(agents.calls.resumed.length, 0);
});

test('a runtime without an agent registry reports itself unavailable', () => {
  assert.equal(createDshSessionRuntime({ get: () => undefined }), undefined);
});

test('a bare property read never happens when the context has no get()', async () => {
  // Simulates the real guard: reading ctx.agents without inject throws.
  const ctx = {
    get agents() {
      throw new Error('cannot get property "agents" without inject');
    },
  };
  assert.equal(createDshSessionRuntime(ctx), undefined);
});

test('session bindings are per-session and survive as the routing key', async () => {
  const { ctx } = makeContext();
  const runtime = createDshSessionRuntime(ctx);
  runtime.bind('session-a', WORKSPACE, 'plan-a');
  runtime.bind('session-b', WORKSPACE, 'plan-b');
  assert.deepEqual(runtime.planOf('session-a'), { workspace: WORKSPACE, slug: 'plan-a' });
  assert.deepEqual(runtime.planOf('session-b'), { workspace: WORKSPACE, slug: 'plan-b' });
  assert.equal(runtime.planOf('session-unknown'), undefined);
});

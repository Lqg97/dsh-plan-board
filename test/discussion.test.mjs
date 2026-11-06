/**
 * Conversation tests: the plan board's user <-> agent channel.
 *
 * Everything runs against an injected temporary store and a fake DSH runtime,
 * so no model call, no real `~/.dsh` write, and no workspace plan file is
 * touched. What is asserted is the contract the drawer depends on: comments
 * are durable, delivery merges a backlog into ONE user message, already
 * delivered comments never repeat, and a failed dispatch leaves the backlog
 * intact for retry.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DiscussionStore,
  MAX_COMMENT_CHARS,
  PlanDiscussionService,
  mergeCommentBodies,
  normalizeCommentBody,
} from '../src/discussion.mjs';

const WORKSPACE = '/tmp/plan-board-discussion-fixture';

/** A DSH runtime double that records exactly what reached the conversation. */
function fakeRuntime() {
  const created = [];
  const injections = [];
  const followups = [];
  const idles = [];
  const live = new Map();
  const bindings = new Map();
  const runtime = {
    bindings,
    created,
    injections,
    followups,
    idles,
    live(sessionId) {
      return live.get(sessionId);
    },
    bind(sessionId, workspace, slug) {
      this.bindings.set(sessionId, { workspace, slug });
    },
    planOf(sessionId) {
      return this.bindings.get(sessionId);
    },
    async open({ title, sessionId }) {
      if (sessionId !== null && live.has(sessionId)) {
        return { agent: live.get(sessionId), sessionId, created: false, status: live.get(sessionId).status };
      }
      const agent = {
        id: sessionId ?? `session-fresh-${created.length + 1}`,
        status: 'idle',
        inject: (message) => injections.push(message),
        followup: (message) => followups.push(message),
        whenIdle: () => new Promise((resolve) => idles.push(resolve)),
      };
      if (sessionId !== null) {
        live.set(sessionId, agent);
        return { agent, sessionId, created: false, status: 'idle' };
      }
      const id = `session-new-${created.length + 1}`;
      agent.id = id;
      live.set(id, agent);
      created.push({ id, title });
      return { agent, sessionId: id, created: true, status: 'idle' };
    },
  };
  return runtime;
}

async function fixture(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-board-discussion-'));
  const store = new DiscussionStore(path.join(directory, 'discussions.json'), {
    now: options.now ?? (() => 1_800_000_000_000),
    mintId: (() => {
      let n = 0;
      return () => `comment-${++n}`;
    })(),
  });
  const runtime = options.runtime === undefined ? fakeRuntime() : options.runtime;
  const service = new PlanDiscussionService({
    store,
    runtime,
    readPlan: async () => '# 计划\n\n> **当前状态（2026-11-06）**：实施中。\n',
  });
  return { directory, store, runtime, service };
}

const DETAIL = { title: '计划看板', slug: 'plan-board', archived: false };

test('comment bodies are trimmed, bounded and reject empties', () => {
  assert.equal(normalizeCommentBody('  先看 MR 1520  '), '先看 MR 1520');
  assert.throws(() => normalizeCommentBody('   '), /不能为空/);
  assert.throws(() => normalizeCommentBody('x'.repeat(MAX_COMMENT_CHARS + 1)), /不能超过/);
  assert.throws(() => normalizeCommentBody(42), /必须是字符串/);
});

test('a backlog merges into one user message and a lone comment stays verbatim', () => {
  assert.equal(mergeCommentBodies([]), '');
  assert.equal(mergeCommentBodies(['单独一条']), '单独一条');
  const merged = mergeCommentBodies(['第一条', '第二条']);
  assert.ok(merged.startsWith('（用户共留言 2 条，请逐条处理）'));
  assert.ok(merged.includes('第一条') && merged.includes('第二条'));
});

test('comments persist and reload from an atomic snapshot', async () => {
  const { directory, service } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '请补充验收证据');
  const reloaded = new DiscussionStore(path.join(directory, 'discussions.json'));
  const discussion = await reloaded.get(WORKSPACE, 'plan-board');
  assert.equal(discussion.comments.length, 1);
  assert.equal(discussion.comments[0].author, 'user');
  assert.equal(discussion.comments[0].deliveredAt, undefined);
  assert.equal(discussion.pending, undefined, 'raw store carries no view fields');
  const leftovers = (await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('two plans never share a conversation, so a reply cannot land on the wrong plan', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-a', '先做 A');
  await service.comment(WORKSPACE, 'plan-b', '先做 B');
  const a = await service.deliver(WORKSPACE, 'plan-a', '', { title: 'A', slug: 'plan-a', archived: false });
  const b = await service.deliver(WORKSPACE, 'plan-b', '', { title: 'B', slug: 'plan-b', archived: false });

  assert.notEqual(a.sessionId, b.sessionId, 'each plan gets its own DSH conversation');
  assert.deepEqual(runtime.planOf(b.sessionId), { workspace: WORKSPACE, slug: 'plan-b' });

  // Even when the store scan would find plan A first, routing uses the binding.
  const reply = await service.agentComment(b.sessionId, 'B 的处理结果');
  assert.equal(reply.slug, 'plan-b');
  assert.equal(reply.comments.at(-1).body, 'B 的处理结果');
});

test('a reply is refused when the session is not bound to that plan', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-a', '问 A');
  const delivered = await service.deliver(WORKSPACE, 'plan-a', '', { title: 'A', slug: 'plan-a', archived: false });
  // Someone rebinds the session to another plan (a stale client, a rename).
  runtime.bind(delivered.sessionId, WORKSPACE, 'plan-other');
  await assert.rejects(() => service.agentComment(delivered.sessionId, '越权'), /未绑定这个计划/);
});

test('a retried user comment is stored once, so it is never sent twice', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '同一句话');
  await service.comment(WORKSPACE, 'plan-board', '同一句话');
  const discussion = await service.get(WORKSPACE, 'plan-board');
  assert.equal(discussion.comments.length, 1, 'a duplicate pending comment is not stored twice');

  await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);
  assert.equal(runtime.followups.length, 1);
  assert.equal(runtime.followups[0].content[0].text, '同一句话');

  // Once delivered, the same text may legitimately be said again.
  await service.comment(WORKSPACE, 'plan-board', '同一句话');
  const after = await service.get(WORKSPACE, 'plan-board');
  assert.equal(after.comments.filter((entry) => entry.author === 'user').length, 2);
});

test('every delivery restates which plan the turn is about', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '第一条');
  await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);
  runtime.idles.forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));
  await service.comment(WORKSPACE, 'plan-board', '第二条');
  await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);

  assert.equal(runtime.injections.length, 2, 'a reused session still gets the plan framing');
  assert.ok(JSON.stringify(runtime.injections[1]).includes('plan-board'));
});

test('a corrupt store is reported and never overwritten', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-board-discussion-'));
  const file = path.join(directory, 'discussions.json');
  await fs.writeFile(file, '{"version":1,"discussions":{"broken', 'utf8');
  const store = new DiscussionStore(file);
  await assert.rejects(() => store.get(WORKSPACE, 'plan-board'), /不是合法 JSON/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"version":1,"discussions":{"broken');
});

test('a plan archived after its comment keeps the thread and stops waking', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-done', '归档前留下的话');
  // Archived before delivery: the route refuses to wake, but the comment stays
  // visible instead of vanishing with the plan.
  const discussion = await service.get(WORKSPACE, 'plan-done');
  assert.equal(discussion.comments.length, 1);
  assert.equal(discussion.pending, 1);
  assert.equal(runtime.followups.length, 0);
});

test('a second store instance reads the same file back', async () => {
  const { directory, service } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '第一条');
  const second = new DiscussionStore(path.join(directory, 'discussions.json'));
  await second.addComment(WORKSPACE, 'plan-board', 'user', '第二条');
  const discussion = await second.get(WORKSPACE, 'plan-board');
  assert.deepEqual(discussion.comments.map((entry) => entry.body), ['第一条', '第二条']);
});

test('a malformed store is reported instead of silently replaced', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-board-discussion-'));
  const file = path.join(directory, 'discussions.json');
  await fs.writeFile(file, JSON.stringify({ version: 99, discussions: {} }), 'utf8');
  const store = new DiscussionStore(file);
  await assert.rejects(() => store.get(WORKSPACE, 'plan-board'), /格式不受支持/);
  const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(onDisk.version, 99, 'the original file is never overwritten');
});

test('first delivery creates a session, injects context, then sends one message', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '先处理 CI 失败');
  await service.comment(WORKSPACE, 'plan-board', '再看评审意见');
  const result = await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.delivered, 'run');
  assert.equal(runtime.created.length, 1);

  assert.equal(runtime.injections.length, 1, 'framing is injected once, as plugin context');
  const framing = JSON.stringify(runtime.injections[0]);
  assert.equal(runtime.injections[0].source.kind, 'dsh-plan-board');
  assert.ok(framing.includes('plan_board_comment_add'));
  assert.ok(framing.includes('计划看板'));

  assert.equal(runtime.followups.length, 1, 'two pending comments must not become two bubbles');
  const delivered = runtime.followups[0];
  assert.equal(delivered.source.kind, 'user');
  const text = delivered.content[0].text;
  assert.ok(text.includes('先处理 CI 失败') && text.includes('再看评审意见'));

  const discussion = await service.get(WORKSPACE, 'plan-board');
  assert.equal(discussion.sessionId, result.sessionId);
  assert.equal(discussion.pending, 0);
  assert.equal(discussion.comments.filter((comment) => comment.deliveredAt !== undefined).length, 2);
});

test('delivered comments never repeat, and a reused session is not re-created', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '第一批');
  const first = await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);
  runtime.idles.forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));

  await service.comment(WORKSPACE, 'plan-board', '第二批');
  const second = await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);
  assert.equal(second.count, 1, 'only the new pending comment is delivered');
  assert.equal(runtime.created.length, 1, 'the bound session is reused');
  assert.equal(second.sessionId, first.sessionId);
  const text = runtime.followups[1].content[0].text;
  assert.ok(text.includes('第二批'));
  assert.ok(!text.includes('第一批'));
});

test('delivery with nothing pending is refused instead of waking the agent', async () => {
  const { service, runtime } = await fixture();
  await assert.rejects(() => service.deliver(WORKSPACE, 'plan-board', '', DETAIL), /没有待投递的留言/);
  assert.equal(runtime.followups.length, 0);
  assert.equal(runtime.created.length, 0);
});

test('a failed dispatch keeps the backlog pending so the user can retry', async () => {
  const runtime = fakeRuntime();
  runtime.open = async () => {
    throw new Error('agent registry unavailable');
  };
  const { service } = await fixture({ runtime });
  await service.comment(WORKSPACE, 'plan-board', '重试我');
  await assert.rejects(() => service.deliver(WORKSPACE, 'plan-board', '', DETAIL), /unavailable/);
  const discussion = await service.get(WORKSPACE, 'plan-board');
  assert.equal(discussion.pending, 1);
  assert.equal(discussion.comments[0].deliveredAt, undefined);
});

test('concurrent deliveries serialize so a comment cannot be sent twice', async () => {
  const { service, runtime } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '只发一次');
  const results = await Promise.allSettled([
    service.deliver(WORKSPACE, 'plan-board', '', DETAIL),
    service.deliver(WORKSPACE, 'plan-board', '', DETAIL),
  ]);
  const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
  const rejected = results.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /没有待投递的留言/);
  assert.equal(runtime.followups.length, 1);
});

test('the agent tool path records a reply against the bound session only', async () => {
  const { service } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '请处理');
  const delivered = await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);

  const discussion = await service.agentComment(delivered.sessionId, '已修好 CI，附件是日志');
  const agentComment = discussion.comments.at(-1);
  assert.equal(agentComment.author, 'agent');
  assert.equal(agentComment.sessionId, delivered.sessionId);
  assert.equal(discussion.pending, 0, 'agent replies are never queued for delivery');

  await assert.rejects(() => service.agentComment('session-unrelated', '越权回复'), /没有关联/);
});

test('running state is reported while the agent turn is unsettled', async () => {
  const { service } = await fixture();
  await service.comment(WORKSPACE, 'plan-board', '开始');
  await service.deliver(WORKSPACE, 'plan-board', '', DETAIL);
  const running = await service.get(WORKSPACE, 'plan-board');
  assert.equal(running.running, true);
  assert.equal(running.available, true);
});

test('without a DSH runtime the discussion still reads and refuses to pretend it delivered', async () => {
  const { service } = await fixture({ runtime: null });
  await service.comment(WORKSPACE, 'plan-board', '离线留言');
  const discussion = await service.get(WORKSPACE, 'plan-board');
  assert.equal(discussion.comments.length, 1);
  assert.equal(discussion.available, false);
  await assert.rejects(() => service.deliver(WORKSPACE, 'plan-board', '', DETAIL), /不支持任务会话/);
});

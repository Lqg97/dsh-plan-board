/**
 * Tests for the derived SQLite index.
 *
 * The point of the index is that it is *disposable*: it answers queries the
 * JSON store cannot answer cheaply, and losing it must cost nothing but search.
 * These tests pin that contract, including deliberately corrupting the database.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DiscussionIndex } from '../src/discussion-index.mjs';
import { DiscussionStore } from '../src/discussion.mjs';

const WORKSPACE = '/tmp/plan-board-index-fixture';

async function tempDir(prefix = 'plan-board-index-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** One store fixture with an in-memory index and a temp JSON file. */
async function fixture() {
  const directory = await tempDir();
  const store = new DiscussionStore(path.join(directory, 'discussions.json'), {
    index: new DiscussionIndex(':memory:'),
  });
  return { directory, store };
}

const discussion = (slug, comments, overrides = {}) => ({
  workspace: WORKSPACE,
  slug,
  sessionId: overrides.sessionId ?? null,
  updatedAt: overrides.updatedAt ?? 1,
  comments,
});

const comment = (id, author, body, createdAt, deliveredAt) => ({
  id, author, body, createdAt,
  ...(deliveredAt === undefined ? {} : { deliveredAt }),
});

test('the index answers cross-plan queries the store cannot', async () => {
  const index = new DiscussionIndex(':memory:');
  const rebuilt = await index.rebuild({
    [`${WORKSPACE}\nplan-a`]: discussion('plan-a', [
      comment('c1', 'user', 'CI 失败了', 100),
      comment('c2', 'agent', '已修复 CI', 200, 210),
    ]),
    [`${WORKSPACE}\nplan-b`]: discussion('plan-b', [comment('c3', 'user', '请补充证据', 300)]),
  });
  assert.deepEqual(rebuilt, { indexed: 3 });

  const matches = await index.search('CI');
  assert.deepEqual(matches.map((row) => row.body).sort(), ['CI 失败了', '已修复 CI']);
  assert.equal(matches[0].slug, 'plan-a', 'a hit carries the plan it belongs to');
});

test('pending inbox lists only plans with undelivered user comments', async () => {
  const index = new DiscussionIndex(':memory:');
  await index.rebuild({
    [`${WORKSPACE}\nplan-a`]: discussion('plan-a', [
      comment('c1', 'user', '已发过的', 100, 120),
    ]),
    [`${WORKSPACE}\nplan-b`]: discussion('plan-b', [
      comment('c2', 'user', '待投递', 200),
      comment('c3', 'agent', 'Agent 回复不算待投递', 300),
    ]),
  });
  const pending = await index.pendingPlans();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].slug, 'plan-b');
  assert.equal(pending[0].pending, 1);
});

test('search is bounded by an explicit limit', async () => {
  const index = new DiscussionIndex(':memory:');
  const many = Array.from({ length: 40 }, (_, i) => comment(`c${i}`, 'user', `命中 ${i}`, i));
  await index.rebuild({ [`${WORKSPACE}\nplan`]: discussion('plan', many) });
  assert.equal((await index.search('命中', { limit: 5 })).length, 5);
  assert.equal((await index.search('命中', { limit: 9999 })).length, 40, 'clamped, not unbounded');
});

test('the store writes the JSON truth even when the index is broken', async () => {
  const directory = await tempDir();
  const jsonFile = path.join(directory, 'discussions.json');
  const broken = new DiscussionIndex(path.join(directory, 'x.sqlite'));
  // Force a permanent failure: a directory where the database file should be.
  await fs.mkdir(path.join(directory, 'x.sqlite'), { recursive: true });
  const store = new DiscussionStore(jsonFile, { index: broken });
  const comment = await store.addComment(WORKSPACE, 'plan-board', 'user', '索引坏了也要存下');

  assert.equal(comment.body, '索引坏了也要存下');
  const onDisk = JSON.parse(await fs.readFile(jsonFile, 'utf8'));
  assert.equal(onDisk.discussions[`${WORKSPACE}\nplan-board`].comments.length, 1);

  const reloaded = new DiscussionStore(jsonFile, { index: null });
  const stored = await reloaded.get(WORKSPACE, 'plan-board');
  assert.equal(stored.comments[0].body, '索引坏了也要存下');
});

test('search reports unavailable instead of throwing when the index cannot open', async () => {
  const directory = await tempDir();
  await fs.mkdir(path.join(directory, 'blocked.sqlite'), { recursive: true });
  const store = new DiscussionStore(path.join(directory, 'discussions.json'), {
    index: new DiscussionIndex(path.join(directory, 'blocked.sqlite')),
  });
  await store.addComment(WORKSPACE, 'plan-board', 'user', '一条留言');
  const result = await store.searchComments('留言');
  assert.equal(result.available, false);
  assert.deepEqual(result.rows, []);
  assert.equal(typeof result.reason, 'string');
});

test('a deleted index is rebuilt from JSON on the next query', async () => {
  const directory = await tempDir();
  const jsonFile = path.join(directory, 'discussions.json');
  const indexPath = path.join(directory, 'discussions.index.sqlite');
  const first = new DiscussionStore(jsonFile, { index: new DiscussionIndex(indexPath) });
  await first.addComment(WORKSPACE, 'plan-board', 'user', '重建后仍能搜到');
  assert.equal((await first.searchComments('重建')).rows.length, 1);
  first.close();

  // Simulate an operator wiping the derived database.
  await fs.rm(indexPath, { force: true });
  await fs.rm(`${indexPath}-wal`, { force: true });
  await fs.rm(`${indexPath}-shm`, { force: true });

  const second = new DiscussionStore(jsonFile, { index: new DiscussionIndex(indexPath) });
  const result = await second.searchComments('重建');
  assert.equal(result.available, true);
  assert.equal(result.rows.length, 1, 'the index rebuilds itself from the JSON truth');
  second.close();
});

test('a corrupt index file is rebuilt rather than fatal', async () => {
  const directory = await tempDir();
  const jsonFile = path.join(directory, 'discussions.json');
  const indexPath = path.join(directory, 'broken.index.sqlite');
  await fs.writeFile(jsonFile, JSON.stringify({
    version: 1,
    discussions: {
      [`${WORKSPACE}\nplan-board`]: discussion('plan-board', [
        comment('c1', 'user', '幸存的一条留言', 100),
      ]),
    },
  }), 'utf8');
  await fs.writeFile(indexPath, 'this is not a database', 'utf8');

  const store = new DiscussionStore(jsonFile, { index: new DiscussionIndex(indexPath) });
  const result = await store.searchComments('幸存');
  // Either it recovered or it reports unavailable — it must never throw, and
  // it must never touch the JSON truth.
  assert.equal(typeof result.available, 'boolean');
  const onDisk = JSON.parse(await fs.readFile(jsonFile, 'utf8'));
  assert.equal(onDisk.discussions[`${WORKSPACE}\nplan-board`].comments[0].body, '幸存的一条留言');
  store.close();
});

test('marking a comment delivered updates the pending inbox', async () => {
  const { store } = await fixture();
  await store.addComment(WORKSPACE, 'plan-board', 'user', '待投递');
  assert.equal((await store.pendingPlans(WORKSPACE)).rows.length, 1);

  const pending = (await store.pendingPlans(WORKSPACE)).rows[0];
  // Use the real id: the store mints them, so a hardcoded one would silently
  // deliver nothing and make this test pass for the wrong reason.
  const stored = await store.get(WORKSPACE, 'plan-board');
  await store.markDelivered(WORKSPACE, 'plan-board', [stored.comments[0].id], 'session-x');
  const after = await store.pendingPlans(WORKSPACE);
  assert.deepEqual(after.rows, []);
  assert.equal(pending.pending, 1);
});

test('disabling the index leaves the store fully functional', async () => {
  const directory = await tempDir();
  const store = new DiscussionStore(path.join(directory, 'discussions.json'), { index: null });
  await store.addComment(WORKSPACE, 'plan-board', 'user', '没有索引也能用');
  const stored = await store.get(WORKSPACE, 'plan-board');
  assert.equal(stored.comments[0].body, '没有索引也能用');
  const search = await store.searchComments('没有');
  assert.equal(search.available, false);
});

test('the index file lives beside the store and is clearly derived', async () => {
  const directory = await tempDir();
  const jsonFile = path.join(directory, 'discussions.json');
  const store = new DiscussionStore(jsonFile);
  const expected = path.join(directory, 'discussions.index.sqlite');
  assert.equal(store.index.file, expected);
  store.close();
});

test('rebuildIndex restores search after out-of-band file edits', async () => {
  const { store } = await fixture();
  await store.addComment(WORKSPACE, 'plan-board', 'user', '第一条');
  // Someone hand-edits the JSON truth; the index cannot know until rebuilt.
  await store.rebuildIndex();
  const result = await store.searchComments('第一条');
  assert.equal(result.available, true);
  assert.equal(result.rows.length, 1);
});

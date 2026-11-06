/**
 * Board facts against the real workspace plus the shapes that broke an earlier
 * draft: unparenthesized status dates, an archive that must stay neutral, and
 * plans that discuss "blocked" in their body without being blocked.
 *
 * Run from the plugin root:
 *
 *   node --test test/*.test.mjs
 *
 * Override the workspace with `DSH_PLAN_BOARD_TEST_WORKSPACE`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { board } from './helpers.mjs';
import {
  classify,
  healthLevel,
  mismatchDescription,
  toCard,
  wipLevel,
} from '../src/stage-rules.mjs';
import { headerStatusDate, leadingBlockquote, parseMergeRequests, parseProgress } from '../src/scan-plans.mjs';

const WORKSPACE = path.resolve(process.env.DSH_PLAN_BOARD_TEST_WORKSPACE ?? path.join(import.meta.dirname, '../../../competition'));

test('leading blockquote stops at the first body paragraph', () => {
  const text = [
    '# 标题',
    '',
    '> **当前状态（2026-11-04 18:00）**：方案待评审。',
    '> **范围**：只处理 7 组。',
    '',
    '## 一、目标',
    '',
    '> 正文里也会引用「阻塞」这个词，但它不是本计划的状态。',
  ].join('\n');
  const block = leadingBlockquote(text);
  assert.equal(block.length, 2);
  assert.ok(block[0].includes('当前状态'));
  assert.ok(!block.some((line) => line.includes('正文里')));
});

test('status date is read both from parentheses and from a leading date', () => {
  assert.equal(headerStatusDate('> **当前状态（2026-11-04 18:00）**：x'), '2026-11-04');
  assert.equal(headerStatusDate('> 状态（2026-10-14 13:06）：x'), '2026-10-14');
  // The unparenthesized shape lanxie-season-identity uses.
  assert.equal(headerStatusDate('> 2026-11-04 已确认自动撤销 MR !1520 合入'), '2026-11-04');
  assert.equal(headerStatusDate('> **进度**：[progress.md](x)。'), null);
});

test('progress entries need a date heading and keep their order', () => {
  const text = [
    '## 2026-11-03：方案草案',
    '正文',
    '## 2026-11-04: 实现并更新 MR',
    '## 五-1、test 环境端到端验证（2026-09-24，AC1–AC8）',
    '## 2026-11-03 第三次打卡',
  ].join('\n');
  const { entries, dates } = parseProgress(text);
  assert.equal(entries.length, 3);
  assert.deepEqual(dates, ['2026-11-03', '2026-11-04']);
});

test('merge request links dedupe across both URL shapes', () => {
  const text = [
    '[!143](https://git.woa.com/sport/matchUnion/editor/-/merge_requests/143)',
    'https://git.woa.com/sport/competition/src/merge_requests/1506',
    'again https://git.woa.com/sport/matchUnion/editor/-/merge_requests/143',
  ].join('\n');
  const merges = parseMergeRequests(text);
  assert.deepEqual(merges, [
    { repo: 'sport/matchUnion/editor', num: 143 },
    { repo: 'sport/competition/src', num: 1506 },
  ]);
});

test('stall thresholds are the documented 3 / 6 / 8 day boundaries', () => {
  assert.equal(healthLevel(0), 'ok');
  assert.equal(healthLevel(3), 'ok');
  assert.equal(healthLevel(4), 'idle');
  assert.equal(healthLevel(6), 'idle');
  assert.equal(healthLevel(7), 'warn');
  assert.equal(healthLevel(8), 'warn');
  assert.equal(healthLevel(9), 'error');
  assert.equal(healthLevel(null), 'idle');
});

test('wip pressure warns at 6 and errors at 8', () => {
  assert.equal(wipLevel(5), 'ok');
  assert.equal(wipLevel(6), 'warn');
  assert.equal(wipLevel(7), 'warn');
  assert.equal(wipLevel(8), 'error');
});

test('waiting for a decision outranks waiting for CI', () => {
  const plan = {
    archived: false,
    headerLines: ['**状态**：MR opened、can_be_merged、**仍待用户授权同窗口合入**'],
    recentProgress: [],
  };
  assert.equal(classify(plan).stage, 'blocked');
});

test('CI green and merge-ready phrases classify as CI', () => {
  for (const status of ['**当前状态**：CI 均绿', '**当前状态**：三个 MR 均可合并']) {
    const plan = { archived: false, headerLines: [status], recentProgress: [] };
    assert.equal(classify(plan).stage, 'ci');
  }
});

test('a merged plan with an open CI phrase is not left in the CI column', () => {
  const plan = {
    archived: false,
    headerLines: ['**当前状态（2026-11-04）**：已合入，观察窗满期，待验收'],
    recentProgress: [],
  };
  assert.equal(classify(plan).stage, 'release');
});

test('archived plans keep a neutral level instead of a stall colour', () => {
  const plan = {
    archived: true,
    slug: 'old',
    title: 'old',
    headerLines: [],
    headerStatusDate: '2026-08-01',
    lastProgressDate: '2026-08-01',
    recentProgress: [],
    mergeRequests: [],
    repositories: [],
    evidence: [],
    fileMtime: '2026-08-01T00:00:00.000Z',
    progressCount: 1,
    firstProgressDate: '2026-08-01',
    file: 'done/old.md',
  };
  const card = toCard(plan, '2026-11-05');
  assert.equal(card.health, 'archived');
  assert.ok(card.archivedDays > 90);
});

test('header/progress disagreement is reported in both directions', () => {
  const base = {
    archived: false,
    slug: 'x',
    title: 'x',
    headerLines: [],
    recentProgress: [],
    mergeRequests: [],
    repositories: [],
    evidence: [],
    progressCount: 1,
    firstProgressDate: '2026-10-26',
    fileMtime: '2026-10-26T00:00:00.000Z',
  };
  const stale = toCard({ ...base, headerStatusDate: '2026-10-14', lastProgressDate: '2026-10-26' }, '2026-11-05');
  assert.equal(stale.headerMismatch, true);
  assert.match(mismatchDescription(stale) ?? '', /头状态未回写/);

  const missing = toCard({ ...base, headerStatusDate: '2026-10-29', lastProgressDate: '2026-10-26' }, '2026-11-05');
  assert.equal(missing.headerMismatch, true);
  assert.match(mismatchDescription(missing) ?? '', /progress 没补/);

  const agree = toCard({ ...base, headerStatusDate: '2026-10-27', lastProgressDate: '2026-10-26' }, '2026-11-05');
  assert.equal(agree.headerMismatch, false);
  assert.equal(mismatchDescription(agree), null);
});

test('the real workspace scans to the documented board', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const data = await board(WORKSPACE, '2026-11-05');
  const live = data.cards.filter((card) => card.archived !== true);

  // Counts must equal what the filesystem holds, otherwise the board silently lies.
  const activeFiles = fs.readdirSync(path.join(WORKSPACE, 'doc/plans')).filter((name) => name.endsWith('.md'));
  const doneFiles = fs.readdirSync(path.join(WORKSPACE, 'doc/plans/done')).filter((name) => name.endsWith('.md'));
  assert.equal(data.cards.length, activeFiles.length + doneFiles.length);
  assert.equal(live.length, activeFiles.length);
  assert.equal(new Set(data.cards.map((card) => card.slug)).size, data.cards.length);

  // The calibration table in the plan (§4.1.1): one row per live plan.
  const expected = {
    'access-legacy-redis-read-cleanup': { stage: 'design', health: 'ok' },
    'lanxie-season-identity': { stage: 'release', health: 'ok' },
    'player-team-relation-tounion-plan': { stage: 'blocked', health: 'error' },
    'sports-adminapi-offline-plan': { stage: 'blocked', health: 'error' },
    'union-player-team-lock-takeover': { stage: 'ci', health: 'warn' },
  };
  for (const [slug, want] of Object.entries(expected)) {
    const card = data.cards.find((entry) => entry.slug === slug);
    if (card === undefined) continue; // plan archived since the table was written
    assert.equal(card.stage, want.stage, `${slug} stage`);
    const fileMtimeDate = typeof card.fileMtime === 'string' ? card.fileMtime.slice(0, 10) : null;
    const dates = [card.headerStatusDate, card.lastProgressDate, fileMtimeDate];
    // Health was calibrated against the historical data.today clock. Once the
    // real plan has moved beyond that date, keep asserting its stage but do not
    // judge its current health against the stale calibration point.
    if (dates.some((date) => date !== null && date > data.today)) continue;
    assert.equal(card.health, want.health, `${slug} health`);
  }

  // Exact mismatch text/direction is covered hermetically above. Keep the real
  // workspace calibration only while its data still matches the historical clock.
  assert.ok(live.every((card) => typeof card.headerMismatch === 'boolean'));
  const union = live.find((card) => card.slug === 'union-player-team-lock-takeover');
  if (union !== undefined) {
    const fileMtimeDate = typeof union.fileMtime === 'string' ? union.fileMtime.slice(0, 10) : null;
    const dates = [union.headerStatusDate, union.lastProgressDate, fileMtimeDate];
    if (dates.every((date) => date === null || date <= data.today)) {
      assert.equal(union.headerMismatch, true, 'header newer than progress at the calibration date');
    }
  }
});

test('detail lookups accept only scanned slugs', async (t) => {
  if (!fs.existsSync(path.join(WORKSPACE, 'doc/plans'))) {
    t.skip(`no doc/plans under ${WORKSPACE}`);
    return;
  }
  const { planDetail } = await import('./helpers.mjs');
  const detail = await planDetail(WORKSPACE, 'sports-adminapi-offline-plan', '2026-11-05');
  if (detail !== undefined) {
    assert.equal(detail.slug, 'sports-adminapi-offline-plan');
    assert.ok(Array.isArray(detail.recentProgress));
  }
  assert.equal(await planDetail(WORKSPACE, '../../etc/passwd', '2026-11-05'), undefined);
  assert.equal(await planDetail(WORKSPACE, 'no-such-plan', '2026-11-05'), undefined);
});

test('a workspace without doc/plans reports a warning, not a crash', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-board-empty-'));
  try {
    const data = await board(empty, '2026-11-05');
    assert.equal(data.cards.length, 0);
    assert.equal(data.warnings.length, 1);
    assert.match(data.warnings[0], /未找到/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

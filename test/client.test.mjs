/**
 * Client view-model tests without adding a second React runtime to this plugin.
 *
 * The browser file is deliberately a plain ModuleLoader bundle. Tests instrument
 * only the factory return in an in-memory source string, then exercise its pure
 * helpers and PlanCard's keyboard contract with a tiny createElement stub.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

/** Load pure internals; production code and its return shape stay unchanged. */
function loadClientInternals() {
  let source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const original = 'return { inject, apply };';
  assert.ok(source.includes(original), 'factory return marker exists');
  source = source.replace(original, `return {
    inject, apply,
    __test: { selectCards, limitArchivedCards, timelineWindow, formatStageReason, PlanCard, paginate, renderMarkdown, zh, en },
  };`);
  let factory;
  const window = {
    __ModuleLoader__: {
      load(definition) {
        factory = definition.factory;
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
  };
  vm.runInNewContext(source, { window, console, URLSearchParams });
  assert.equal(typeof factory, 'function');
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
  };
  const api = factory((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected client dependency: ${id}`);
  });
  return api.__test;
}

const internals = loadClientInternals();

function card(slug, overrides = {}) {
  return {
    slug,
    title: slug,
    archived: false,
    health: 'ok',
    idleDays: 0,
    headerMismatch: false,
    repositories: [],
    mergeRequests: [],
    recentProgress: [],
    headerStatusDate: null,
    lastProgressDate: null,
    fileMtime: null,
    progressCount: 0,
    ...overrides,
  };
}

function filters(overrides = {}) {
  return {
    repo: '',
    health: '',
    hasMr: false,
    mismatchOnly: false,
    query: '',
    ...overrides,
  };
}

test('client search covers title, slug, repositories and MR numbers', () => {
  const cards = [
    card('alpha', { repositories: ['sport/competition/src'], mergeRequests: [{ repo: 'sport/competition/src', num: 1506 }] }),
    card('beta', { title: 'Login polish' }),
  ];
  assert.deepEqual(Array.from(internals.selectCards(cards, filters({ query: '1506' }), 'updated'), (entry) => entry.slug), ['alpha']);
  assert.deepEqual(Array.from(internals.selectCards(cards, filters({ query: 'competition' }), 'updated'), (entry) => entry.slug), ['alpha']);
  assert.deepEqual(Array.from(internals.selectCards(cards, filters({ query: 'login' }), 'updated'), (entry) => entry.slug), ['beta']);
});

test('client filters combine MR and header mismatch without mutating cards', () => {
  const cards = [
    card('match', { headerMismatch: true, mergeRequests: [{ repo: 'a/b', num: 1 }], lastProgressDate: '2026-11-01' }),
    card('archived-mismatch', { archived: true, headerMismatch: true, mergeRequests: [{ repo: 'a/b', num: 2 }] }),
    card('other', { lastProgressDate: '2026-11-02' }),
  ];
  const original = cards.map((entry) => entry.slug);
  const result = internals.selectCards(cards, filters({ hasMr: true, mismatchOnly: true }), 'updated');
  assert.deepEqual(Array.from(result, (entry) => entry.slug), ['match']);
  assert.deepEqual(cards.map((entry) => entry.slug), original);
});

test('recent activity sorting puts missing dates last and breaks ties by title and slug', () => {
  const cards = [
    card('z', { title: 'Same', lastProgressDate: '2026-11-02' }),
    card('none'),
    card('a', { title: 'Same', headerStatusDate: '2026-11-02' }),
    card('new', { fileMtime: '2026-11-03T08:00:00Z' }),
  ];
  assert.deepEqual(
    Array.from(internals.selectCards(cards, filters(), 'updated'), (entry) => entry.slug),
    ['new', 'a', 'z', 'none'],
  );
});

test('stalled sorting ranks health and then idle days', () => {
  const cards = [
    card('healthy', { health: 'ok', idleDays: 1 }),
    card('slow', { health: 'warn', idleDays: 8 }),
    card('stalled-new', { health: 'error', idleDays: 9 }),
    card('stalled-old', { health: 'error', idleDays: 20 }),
  ];
  assert.deepEqual(
    Array.from(internals.selectCards(cards, filters(), 'stalled'), (entry) => entry.slug),
    ['stalled-old', 'stalled-new', 'slow', 'healthy'],
  );
});

test('title sorting is numeric aware and does not mutate the input order', () => {
  const cards = [card('a', { title: 'Plan 10' }), card('b', { title: 'Plan 2' })];
  assert.deepEqual(Array.from(internals.selectCards(cards, filters(), 'title'), (entry) => entry.title), ['Plan 2', 'Plan 10']);
  assert.deepEqual(cards.map((entry) => entry.title), ['Plan 10', 'Plan 2']);
});

test('archive cap expands fully and is bypassed by any active filter', () => {
  const cards = Array.from({ length: 7 }, (_, index) => card(`old-${index}`));
  assert.equal(internals.limitArchivedCards(cards, false, false).length, 6);
  assert.equal(internals.limitArchivedCards(cards, false, true).length, 7);
  assert.equal(internals.limitArchivedCards(cards, true, false).length, 7);
});

test('single-day timeline gets a 14-day axis with today at the right edge', () => {
  const axis = internals.timelineWindow(['2026-11-06'], '2026-11-06');
  assert.equal(axis.span, 14 * 86_400_000);
  assert.equal(new Date(axis.startTime).toISOString().slice(0, 10), '2026-10-23');
  assert.equal((axis.endTime - axis.startTime) / axis.span, 1);
  assert.equal((Date.parse('2026-11-06T00:00:00Z') - axis.startTime) / axis.span, 1);
});

test('timeline preserves long ranges and uses UTC across daylight-saving changes', () => {
  const long = internals.timelineWindow(['2026-09-01', '2026-11-06'], '2026-11-06');
  assert.equal(long.span, 66 * 86_400_000);
  const dst = internals.timelineWindow(['2026-03-01', '2026-03-15'], '2026-03-15');
  assert.equal(dst.span, 14 * 86_400_000);
  const fallback = internals.timelineWindow(['not-a-date'], '2026-11-06');
  assert.equal(fallback.span, 14 * 86_400_000);
  assert.ok(Number.isFinite(fallback.startTime));
});

test('stage reasons use localized stable shapes', () => {
  const tr = (key, params = {}) => `${key}:${params.phrase ?? ''}`;
  assert.equal(internals.formatStageReason({ stage: 'archived' }, tr), 'reason.archived:');
  assert.equal(internals.formatStageReason({ stage: 'ci', stageReason: '命中「CI 均绿」' }, tr), 'reason.matched:CI 均绿');
});

test('PlanCard Space opens once and prevents page scrolling', () => {
  const opened = [];
  let prevented = 0;
  const element = internals.PlanCard({
    card: card('keyboard'),
    onOpen: (slug) => opened.push(slug),
    tr: (key) => key,
    selected: null,
  });
  const event = {
    key: ' ',
    target: 'card',
    currentTarget: 'card',
    preventDefault() { prevented += 1; },
  };
  element.props.onKeyDown(event);
  assert.equal(prevented, 1);
  assert.deepEqual(opened, ['keyboard']);
});

test('evidence pagination is 10 per page and never renders an empty page', () => {
  const { paginate } = internals;
  assert.ok(paginate !== undefined, 'paginate helper is exposed');
  const plain = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(paginate(0, 0)), { page: 0, pages: 1, from: 0, to: 0, items: [] });
  assert.deepEqual(plain(paginate(1, 0)), { page: 0, pages: 1, from: 1, to: 1, items: [0] });
  assert.deepEqual(plain(paginate(10, 0)), { page: 0, pages: 1, from: 1, to: 10, items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  assert.equal(paginate(22, 0).pages, 3);
  assert.deepEqual(paginate(22, 1).items.length, 10);
  assert.deepEqual(paginate(22, 2).items.length, 2);

  // A page index left over from a longer list must clamp, not render blank.
  const clamped = paginate(11, 5);
  assert.equal(clamped.page, 1);
  assert.equal(clamped.items.length, 1);
});

test('markdown rendering covers the constructs real plans use', () => {
  const { renderMarkdown } = internals;
  const types = (md) => JSON.parse(JSON.stringify(renderMarkdown(md))).map((node) => node.type);

  assert.deepEqual(types('# 标题'), ['h2'], 'the H1 is demoted one level under the drawer title');
  assert.deepEqual(types('## 小节'), ['h3']);
  assert.deepEqual(types('- a\n- b'), ['ul']);
  assert.deepEqual(types('1. a\n2. b'), ['ol']);
  assert.deepEqual(types('> 引用'), ['blockquote']);
  assert.deepEqual(types('---'), ['hr']);
  assert.deepEqual(types(['```', 'npm test', '```'].join('\n')), ['pre']);
  assert.deepEqual(types('段落'), ['p']);

  // A table becomes a wrapper div holding a real table element.
  const table = JSON.parse(JSON.stringify(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')));
  assert.equal(table.length, 1);
  assert.equal(table[0].type, 'div');
  // This harness's createElement stub does not flatten children, so nested
  // arrays survive here exactly as React received them.
  const flatten = (nodes) => nodes.flat(Infinity).filter((node) => node !== null && node !== undefined);
  const inner = flatten(table[0].children)[0];
  assert.equal(inner.type, 'table');
  const parts = flatten(inner.children);
  assert.equal(parts[0].type, 'thead');
  assert.equal(parts[1].type, 'tbody');
  const rows = flatten(parts[1].children);
  assert.equal(rows.length, 1, 'one body row');
  assert.equal(flatten(rows[0].children).length, 2, 'two cells');

  // A pipe table must not degrade into literal paragraph text.
  assert.ok(!types('| a | b |\n| --- | --- |\n| 1 | 2 |').includes('p'));

  // Raw HTML in the source stays a text child: the renderer never builds an
  // element from it, and React escapes text children on the way to the DOM.
  const rawNodes = JSON.parse(JSON.stringify(renderMarkdown('<img src=x onerror=alert(1)>')));
  assert.equal(rawNodes.length, 1);
  assert.equal(rawNodes[0].type, 'p', 'the tag does not become an element');
  const kids = rawNodes[0].children.flat(Infinity);
  assert.deepEqual(kids, ['<img src=x onerror=alert(1)>'], 'it stays verbatim text');
  assert.ok(!JSON.stringify(rawNodes).includes('"type":"img"'), 'no img element is constructed');
});
test('zh/en dictionaries expose exactly the same keys', () => {
  const zhKeys = Object.keys(internals.zh).sort();
  const enKeys = Object.keys(internals.en).sort();
  assert.deepEqual(zhKeys, enKeys);
});

/**
 * Scanning one workspace's `doc/plans/` tree into plan facts.
 *
 * The plan files are the single source of truth for this board: nothing here
 * derives state from chat logs, git, or a second ledger. Every field is either
 * read from a plan file's leading status block, counted from its
 * `evidence/<slug>/progress.md`, or computed from those two plus file mtimes.
 *
 * Only the head of each file is read (status blocks and "next step" lines live
 * in the first few KB), because `doc/plans/` also carries large report artifacts
 * and a workspace can hold hundreds of plan files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Bytes read from the head of each plan file. Status blocks never exceed this. */
export const HEAD_BYTES = 8192;
/** Bytes read from the head of each progress file; entries are `## YYYY-MM-DD` lines. */
export const PROGRESS_BYTES = 400_000;
/** Directory (relative to the workspace) holding plans and their evidence. */
export const PLANS_DIR = 'doc/plans';

/**
 * Status-date shapes, matched against the blockquote body with its `>` markers
 * already stripped (`leadingBlockquote` does that):
 *   `> **当前状态（2026-11-04 18:00）**：…` and `> 状态（2026-10-14）：…` name the
 *   date in parentheses, while `> 2026-11-04 已确认…` leads with it.
 */
const HEADER_STATUS_PATTERNS = [
  /(?:当前状态|状态|实查)\s*[（(]\s*(\d{4}-\d{2}-\d{2})/,
  /^\s*(\d{4}-\d{2}-\d{2})\s/,
];
/** `## 2026-11-03：标题` progress entries; the colon is optional and may be full-width. */
const PROGRESS_ENTRY = /^##\s+(\d{4}-\d{2}-\d{2})\s*[：:、]?\s*(.*)$/gm;
/** `https://git.woa.com/<group>/<repo>/-/merge_requests/<n>` and the short form. */
const MR_LINK = /git\.woa\.com\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+?)(?:\/-)?\/merge_requests\/(\d+)/g;
/** `关联仓库：\`a\`（…）、\`b\`` style lines. */
const REPO_HINT = /(?:关联仓库|实施仓库|目标仓库)\s*[：:]\s*(.+)$/m;

/**
 * Read at most `bytes` from the head of a file.
 * @param {string} file - absolute path.
 * @param {number} bytes - cap.
 * @returns {Promise<string>} decoded head text, or '' when unreadable.
 */
async function readHead(file, bytes) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * The leading blockquote of a plan file: the status block, from the H1 until the
 * first normal paragraph or rule. Later quotes in the body often discuss
 * "blocked" or "waiting for authorization" as a topic, so they must not be read
 * as that plan's current state.
 * @param {string} text - plan head.
 * @returns {string[]} status lines without markers.
 */
export function leadingBlockquote(text) {
  const lines = text.split('\n');
  const out = [];
  let started = false;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      started = true;
      out.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }
    if (started && trimmed === '') continue;
    if (started) break;
    if (trimmed.startsWith('#')) continue;
    if (trimmed !== '') break;
  }
  return out.filter((line) => line !== '');
}

/**
 * First status date named in a plan's leading blockquote.
 * @param {string} text - plan head.
 * @returns {string | null} `YYYY-MM-DD`.
 */
export function headerStatusDate(text) {
  const stripped = leadingBlockquote(text).join('\n');
  // A single status line without a title is a valid input too (tests and callers
  // that already isolated the block).
  const block = stripped !== '' ? stripped : text.replace(/^>\s?/gm, '');
  for (const pattern of HEADER_STATUS_PATTERNS) {
    const match = pattern.exec(block);
    if (match !== null) return match[1];
  }
  return null;
}

/**
 * Progress entries of one plan.
 * @param {string} text - progress head.
 * @returns {{ entries: { date: string, heading: string }[], dates: string[] }} entries
 *   newest last, plus their distinct dates sorted.
 */
export function parseProgress(text) {
  const entries = [];
  PROGRESS_ENTRY.lastIndex = 0;
  let match;
  while ((match = PROGRESS_ENTRY.exec(text)) !== null) {
    entries.push({ date: match[1], heading: match[2].trim().slice(0, 160) });
  }
  const dates = [...new Set(entries.map((entry) => entry.date))].sort();
  return { entries, dates };
}

/**
 * Merge request links named by a plan, deduplicated, in file order.
 * @param {string} text - plan head.
 * @returns {{ repo: string, num: number }[]} links.
 */
export function parseMergeRequests(text) {
  const seen = new Set();
  const out = [];
  MR_LINK.lastIndex = 0;
  let match;
  while ((match = MR_LINK.exec(text)) !== null) {
    const repo = match[1];
    const num = Number(match[2]);
    const key = `${repo}#${num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo, num });
  }
  return out;
}

/**
 * Repositories a plan declares it will touch.
 * @param {string} text - plan head.
 * @param {{ repo: string, num: number }[]} merges - links already parsed.
 * @returns {string[]} short repository names, deduplicated, in file order.
 */
export function parseRepositories(text, merges) {
  const out = [];
  const push = (repo) => {
    if (repo !== '' && !out.includes(repo)) out.push(repo);
  };
  for (const merge of merges) push(merge.repo);
  const hint = REPO_HINT.exec(text);
  if (hint !== null) {
    for (const token of hint[1].match(/`([^`]+)`/g) ?? []) push(token.replace(/`/g, ''));
  }
  return out;
}

/**
 * Plan title and slug from a file path.
 * @param {string} text - plan head.
 * @param {string} slug - file stem.
 * @returns {string} title.
 */
export function planTitle(text, slug) {
  const line = text.split('\n', 1)[0] ?? '';
  const title = line.replace(/^#\s*/, '').trim();
  return title === '' ? slug : title;
}

/**
 * Whether `doc/plans/<slug>` holds an evidence directory.
 * @param {string} plansRoot - absolute `doc/plans`.
 * @param {string} slug - plan slug.
 * @returns {Promise<string[]>} evidence subdirectory names, empty when absent.
 */
async function evidenceEntries(plansRoot, slug) {
  try {
    const entries = await fs.readdir(path.join(plansRoot, 'evidence', slug), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

/**
 * One plan file's facts, before stage/health derivation.
 * @param {string} file - absolute plan path.
 * @param {string} slug - file stem.
 * @param {boolean} archived - whether the file lives under `done/`.
 * @param {string} plansRoot - absolute `doc/plans`.
 * @returns {Promise<object>} plan facts.
 */
async function readPlan(file, slug, archived, plansRoot) {
  const head = await readHead(file, HEAD_BYTES);
  const progressFile = path.join(plansRoot, 'evidence', slug, 'progress.md');
  const progress = parseProgress(await readHead(progressFile, PROGRESS_BYTES));
  const merges = parseMergeRequests(head);
  let mtime = null;
  try {
    mtime = (await fs.stat(file)).mtime.toISOString();
  } catch {
    mtime = null;
  }
  return {
    slug,
    title: planTitle(head, slug),
    archived,
    file: path.relative(plansRoot, file),
    headerLines: leadingBlockquote(head),
    headerStatusDate: headerStatusDate(head),
    progressCount: progress.entries.length,
    firstProgressDate: progress.dates[0] ?? null,
    lastProgressDate: progress.dates[progress.dates.length - 1] ?? null,
    recentProgress: progress.entries.slice(-8),
    mergeRequests: merges,
    repositories: parseRepositories(head, merges),
    evidence: await evidenceEntries(plansRoot, slug),
    fileMtime: mtime,
  };
}

/**
 * Scan every plan file of one workspace.
 * @param {string} workspace - absolute workspace directory.
 * @returns {Promise<{ plans: object[], warnings: string[] }>} plan facts, active first.
 */
export async function scanPlans(workspace) {
  const plansRoot = path.join(workspace, PLANS_DIR);
  /** @type {string[]} */
  const warnings = [];
  /** @type {object[]} */
  const plans = [];
  const groups = [
    { dir: plansRoot, archived: false },
    { dir: path.join(plansRoot, 'done'), archived: true },
  ];
  for (const group of groups) {
    let names;
    try {
      names = await fs.readdir(group.dir);
    } catch (error) {
      if (group.archived) continue;
      warnings.push(`未找到 ${PLANS_DIR}/：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
      const file = path.join(group.dir, name);
      plans.push(await readPlan(file, name.slice(0, -3), group.archived, plansRoot));
    }
  }
  return { plans, warnings };
}

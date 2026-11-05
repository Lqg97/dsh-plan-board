/**
 * Turning plan facts into board columns and a stall level.
 *
 * Two product decisions live here, both taken from this workspace's own cadence
 * data (see the plan's evidence directory) rather than from a generic kanban:
 *
 * 1. "Waiting for a decision" outranks "waiting for CI". A plan that says both
 *    `仍待用户授权` and `opened` is blocked on the user, so it must not sit in a
 *    column that reads like "about to merge".
 * 2. Stall thresholds are in days, at 3 / 7 / 9. Plan progress is bursty — the
 *    median consecutive active days for one plan is 1 — so an hours-based
 *    "stale" badge would fire constantly and mean nothing.
 */

/** Columns, in board order. `match` lists the phrases that put a plan there. */
export const STAGES = [
  { key: 'design', label: '① 方案 / 待评审', hint: '文件头写着待评审、未动代码' },
  { key: 'doing', label: '② 实施中', hint: '其余在飞计划，包含没有 progress 记录的一次性计划' },
  { key: 'blocked', label: '③ 待拍板 / 阻塞', hint: '等你决策：授权、拍板、阻塞项' },
  { key: 'ci', label: '④ 待合入 / CI', hint: 'MR 已提、等 CI 或等评审' },
  { key: 'release', label: '⑤ 待发布 / 观察窗', hint: '已合入，等发布、灰度、观察窗或验收' },
  { key: 'archived', label: '⑥ 已归档', hint: '位于 doc/plans/done/' },
];

/** Stage keys whose phrases are matched against the plan's status block. */
const PHRASES = {
  blocked: [
    '待用户授权', '待授权', '需授权', '等授权', '同窗口合入', '待拍板',
    '待归属', '待负责人', '阻塞',
  ],
  ci: ['opened', '待合入', 'CI 已绿', 'can_be_merged', 'commit_check_state=success'],
  release: ['已合入', '发布验收', '观察窗', '灰度', '待正式发布', '待验收'],
  design: ['方案待评审', '待评审', '未动代码'],
};

/**
 * Match order. Earlier entries win; `doing` is the fallback and matches nothing.
 * `blocked` deliberately precedes `ci`: see the file comment.
 */
const ORDER = ['blocked', 'ci', 'release', 'design'];

/** Stall level boundaries in days: at most this many days is still healthy. */
const HEALTH_BOUNDS = [
  { maxDays: 3, key: 'ok' },
  { maxDays: 6, key: 'idle' },
  { maxDays: 8, key: 'warn' },
  { maxDays: Infinity, key: 'error' },
];

/**
 * Stall level for a day count.
 * @param {number | null} days - days since the last sign of movement.
 * @returns {'ok' | 'idle' | 'warn' | 'error'} level.
 */
export function healthLevel(days) {
  if (days === null) return 'idle';
  for (const bound of HEALTH_BOUNDS) {
    if (days <= bound.maxDays) return bound.key;
  }
  return 'error';
}

/**
 * The text a stage decision reads: the status block plus the newest progress
 * headings. Body prose is excluded on purpose — plan files discuss "blocked" as
 * a topic far more often than they declare it as their own state.
 * @param {object} plan - plan facts.
 * @returns {string} decision text.
 */
function decisionText(plan) {
  const headings = (plan.recentProgress ?? []).slice(-3).map((entry) => entry.heading);
  return [...(plan.headerLines ?? []), ...headings].join('\n');
}

/**
 * Column for one plan, with the phrase that decided it.
 * @param {object} plan - plan facts.
 * @returns {{ stage: string, reason: string }} column and reason.
 */
export function classify(plan) {
  if (plan.archived === true) {
    return { stage: 'archived', reason: '位于 doc/plans/done/' };
  }
  const text = decisionText(plan);
  for (const stage of ORDER) {
    for (const phrase of PHRASES[stage]) {
      if (!text.includes(phrase)) continue;
      // A merged plan that still lists open MRs is waiting on CI, not shipping.
      if (stage === 'ci' && text.includes('已合入')) continue;
      return { stage, reason: `命中「${phrase}」` };
    }
  }
  return { stage: 'doing', reason: '无状态关键词，按在飞处理' };
}

/**
 * Whole days from `date` to `today`, both `YYYY-MM-DD`.
 * @param {string} date - earlier date.
 * @param {string} today - later date.
 * @returns {number} day count.
 */
export function daysBetween(date, today) {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Latest `YYYY-MM-DD` among the given candidates, ignoring null/undefined.
 * @param {(string | null | undefined)[]} dates - candidates.
 * @returns {string | null} latest date.
 */
function latest(dates) {
  const present = dates.filter((date) => typeof date === 'string' && date !== '');
  return present.length === 0 ? null : present.sort()[present.length - 1];
}

/**
 * Calendar date of an ISO timestamp in local time.
 * @param {string | null} iso - timestamp.
 * @returns {string | null} `YYYY-MM-DD`.
 */
function localDate(iso) {
  if (typeof iso !== 'string' || iso === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Board-ready card for one plan: column, stall level, and the two facts the
 * board exists to surface — how long nothing moved, and whether the file header
 * and the progress log disagree.
 * @param {object} plan - plan facts.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {object} card.
 */
export function toCard(plan, today) {
  const { stage, reason } = classify(plan);
  const progressDate = plan.lastProgressDate;
  const headerDate = plan.headerStatusDate;
  const mtimeDate = localDate(plan.fileMtime);

  // Three independent sources of "someone touched this". The newest wins for the
  // stall level, but all three stay on the card: a file that was merely touched
  // must not look like a plan that moved.
  const newest = latest([progressDate, headerDate, mtimeDate]);
  const idleDays = newest === null ? null : daysBetween(newest, today);
  const headerLag = headerDate !== null && progressDate !== null
    ? signedDays(headerDate, progressDate)
    : null;

  return {
    ...plan,
    stage,
    stageLabel: STAGES.find((entry) => entry.key === stage)?.label ?? stage,
    stageReason: reason,
    // Archived plans keep a neutral level: their dates only say how long ago they
    // were filed, and painting them as stalled would drown the live ones.
    health: plan.archived === true ? 'archived' : healthLevel(idleDays),
    idleDays,
    idleSource: newest === mtimeDate ? 'mtime' : (newest === progressDate ? 'progress' : 'header'),
    headerLag,
    headerMismatch: headerLag !== null && Math.abs(headerLag) > 1,
    archivedDays: plan.archived === true && idleDays !== null ? idleDays : null,
  };
}

/**
 * Signed day difference `to - from`.
 * @param {string} to - later date.
 * @param {string} from - earlier date.
 * @returns {number} signed days.
 */
function signedDays(to, from) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Where two plans disagree between header and progress log, in words.
 * @param {object} card - card produced by {@link toCard}.
 * @returns {string | null} description, or null when they agree.
 */
export function mismatchDescription(card) {
  if (card.headerMismatch !== true) return null;
  if (card.headerLag === null) return null;
  return card.headerLag > 0
    ? `progress 没补（文件头比最后 progress 新 ${card.headerLag} 天）`
    : `头状态未回写（落后最后 progress ${-card.headerLag} 天）`;
}

/**
 * Work-in-progress pressure for one column count.
 * @param {number} count - cards in a working column.
 * @returns {'ok' | 'warn' | 'error'} level.
 */
export function wipLevel(count) {
  if (count >= 8) return 'error';
  if (count >= 6) return 'warn';
  return 'ok';
}

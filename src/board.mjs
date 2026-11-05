/**
 * Assembling the three payloads the Client asks for.
 *
 * Everything here is read-only over the workspace: plan files, their progress
 * logs, and the optional cadence snapshot produced by the workspace's own
 * tooling. There is no second ledger and nothing is written back.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PLANS_DIR, scanPlans } from './scan-plans.mjs';
import { STAGES, mismatchDescription, toCard, wipLevel } from './stage-rules.mjs';

/** Working columns, i.e. everything except the archive. */
export const LIVE_STAGES = STAGES.filter((stage) => stage.key !== 'archived').map((stage) => stage.key);
/** Column count at which the board reports an overloaded column. */
export const WIP_LIMIT = 6;

/** Cadence snapshot written by the workspace's own mining script, when it exists. */
export const CADENCE_CANDIDATES = [
  'doc/plans/evidence/plan-board-plugin/cadence-data.json',
];

/**
 * Today's local calendar date as `YYYY-MM-DD`.
 * @param {Date} [now] - clock override for tests.
 * @returns {string} date.
 */
export function todayOf(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Build the board for one workspace.
 * @param {string} workspace - absolute workspace directory.
 * @param {{ now?: Date }} [options] - clock override.
 * @returns {Promise<object>} board payload.
 */
export async function buildBoard(workspace, options = {}) {
  const today = todayOf(options.now);
  const { plans, warnings } = await scanPlans(workspace);
  const cards = plans.map((plan) => toCard(plan, today));

  const columns = STAGES.map((stage) => {
    const items = cards.filter((card) => card.stage === stage.key);
    return {
      key: stage.key,
      label: stage.label,
      hint: stage.hint,
      count: items.length,
      wip: stage.key === 'archived' ? 'ok' : wipLevel(items.length),
      plans: items.map((card) => card.slug),
    };
  });

  const live = cards.filter((card) => card.archived !== true);
  return {
    workspace,
    today,
    generatedAt: new Date().toISOString(),
    plansDir: PLANS_DIR,
    counts: {
      live: live.length,
      archived: cards.length - live.length,
      total: cards.length,
      progressedToday: live.filter((card) => card.lastProgressDate === today).length,
      mismatched: live.filter((card) => card.headerMismatch === true).length,
      stalled: live.filter((card) => card.health === 'error').length,
    },
    wip: { limit: WIP_LIMIT, columns },
    cards,
    warnings,
  };
}

/**
 * One plan's detail, including the disagreement phrasing and evidence listing.
 * @param {string} workspace - absolute workspace directory.
 * @param {string} slug - plan slug; must resolve inside the scanned set.
 * @param {{ now?: Date }} [options] - clock override.
 * @returns {Promise<object | undefined>} detail payload, or undefined when unknown.
 */
export async function buildPlanDetail(workspace, slug, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return undefined;
  const board = await buildBoard(workspace, options);
  const card = board.cards.find((entry) => entry.slug === slug);
  if (card === undefined) return undefined;
  return {
    ...card,
    mismatch: mismatchDescription(card),
    evidenceDir: card.evidence.length > 0 ? `${PLANS_DIR}/evidence/${slug}` : null,
  };
}

/**
 * Cadence view model: the workspace's own rhythm snapshot, when one exists.
 *
 * The snapshot is produced offline (it has to decompress every assistant
 * transcript, which is far too slow to do while rendering a panel). The board
 * therefore only reads it, and says so when the file is missing or stale.
 * @param {string} workspace - absolute workspace directory.
 * @param {{ now?: Date }} [options] - clock override.
 * @returns {Promise<object>} cadence payload.
 */
export async function buildCadence(workspace, options = {}) {
  const today = todayOf(options.now);
  for (const relative of CADENCE_CANDIDATES) {
    const file = path.join(workspace, relative);
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { found: true, file: relative, error: `快照不是合法 JSON：${error.message}` };
    }
    return { found: true, file: relative, ...summarizeCadence(data, today) };
  }
  return {
    found: false,
    hint: `未找到节奏快照；在工作区运行 doc/plans/evidence/plan-board-plugin/scripts/mine.mjs 生成后可读`,
  };
}

/**
 * Keep the parts of the cadence snapshot a panel can draw, and note its age.
 * @param {any} data - snapshot.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {object} summary.
 */
function summarizeCadence(data, today) {
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const dailyHourly = Array.isArray(data?.dailyHourly) ? data.dailyHourly : [];
  const hours = Array.from({ length: 13 }, (_, index) => index + 10);
  const heat = dailyHourly.map((row) => ({
    date: row.date,
    cells: hours.map((hour) => Number(row.hours?.[hour] ?? 0)),
  }));
  const weekly = (Array.isArray(data?.throughput) ? data.throughput : []).map((week) => ({
    isoWeek: week.isoWeek,
    prompts: week.userPrompts ?? 0,
    donePlans: week.donePlans ?? 0,
  }));
  const generatedAt = data?.meta?.generatedAt ?? null;
  const ageDays = typeof generatedAt === 'string'
    ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
    : null;
  return {
    generatedAt,
    stale: ageDays !== null && ageDays > 7,
    ageDays,
    totalInputs: data?.inputs?.total ?? data?.meta?.sample?.totalUserPrompts ?? null,
    activeDays: daily.length,
    heat,
    hours,
    heatMax: Math.max(1, ...heat.flatMap((row) => row.cells)),
    weekly,
    vocab: (Array.isArray(data?.commandVocab) ? data.commandVocab : []).map((entry) => ({
      label: entry.label,
      count: entry.count,
      share: entry.share,
    })),
    facts: (Array.isArray(data?.insights) ? data.insights : []).slice(0, 5).map((entry) => ({
      conclusion: entry.conclusion,
      evidence: entry.evidence,
    })),
  };
}

/** Thin wrappers so tests read like the board does, with a fixed clock. */

import { buildBoard, buildCadence, buildPlanDetail } from '../src/board.mjs';

/**
 * Board payload at a fixed date.
 * @param {string} workspace - workspace directory.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {Promise<object>} board.
 */
export function board(workspace, today) {
  return buildBoard(workspace, { now: new Date(`${today}T12:00:00`) });
}

/**
 * Detail payload at a fixed date.
 * @param {string} workspace - workspace directory.
 * @param {string} slug - plan slug.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {Promise<object | undefined>} detail.
 */
export function planDetail(workspace, slug, today) {
  return buildPlanDetail(workspace, slug, { now: new Date(`${today}T12:00:00`) });
}

/**
 * Cadence payload at a fixed date.
 * @param {string} workspace - workspace directory.
 * @param {string} today - `YYYY-MM-DD`.
 * @returns {Promise<object>} cadence.
 */
export function cadence(workspace, today) {
  return buildCadence(workspace, { now: new Date(`${today}T12:00:00`) });
}

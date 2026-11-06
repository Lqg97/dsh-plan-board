/**
 * Narrow adapter around DSH's real agent/session registry.
 *
 * The shapes here are taken from the shipped runtime, not guessed:
 * - `agents.create({ sessionId, meta: { cwd, agentPreset }, setup })`
 *   (dsh-agent-loop `createAgent` → `sessions.prepare` + `agents.enter`);
 * - `agents.resume({ resumeSessionId, setup })`;
 * - `setup(agentCtx, agent)` may await and may return a commit, exactly like
 *   SessionController's own `composeAgent`;
 * - `agentPresets.resolve(id)` → `{ id, broken? }`, `agentPresets.mount(agentCtx, id)`;
 * - every optional service is read through `ctx.get(name)` because a bare
 *   `ctx.name` throws "cannot get property … without inject".
 */

import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Read a service without tripping Cordis's inject guard.
 * @param {any} ctx - host context.
 * @param {string} name - service name.
 * @returns {any} service, or undefined when this profile does not provide it.
 */
function serviceOf(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name);
    return undefined;
  } catch {
    return undefined;
  }
}

function sameDirectory(left, right) {
  return typeof left === 'string' && right !== undefined && path.resolve(left) === path.resolve(right);
}

/**
 * Build the preset composition the way SessionController does, falling back to
 * a bare composition when the roster does not expose the expected API.
 * @param {any} ctx - host context.
 * @returns {{ agentPreset?: string, setup?: Function } | undefined} composition.
 */
async function composeAgent(ctx) {
  const presets = serviceOf(ctx, 'agentPresets');
  if (presets === undefined) return undefined;
  try {
    if (typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') return undefined;
    const resolved = await presets.resolve(presets.defaultId);
    const resolvedId = resolved?.id;
    if (typeof resolvedId !== 'string' || resolvedId === '') return undefined;
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx) => {
        await presets.mount(agentCtx, resolvedId);
      },
    };
  } catch {
    // A broken roster must not make the board session unopenable.
    return undefined;
  }
}

const OWNED_MESSAGE = /already (registered|owned)|already live|writer-held/i;

/**
 * Whether a thrown error means "someone else already owns this session id".
 * The runtime signals it as SessionAlreadyOwnedError; engine text is the
 * fallback for wrapped errors.
 * @param {unknown} error - thrown value.
 * @returns {boolean} true when the id is owned elsewhere.
 */
function isOwnedError(error) {
  if (!(error instanceof Error)) return false;
  if (error.name === 'SessionAlreadyOwnedError') return true;
  return OWNED_MESSAGE.test(error.message);
}

/**
 * Create the runtime face the discussion service talks to.
 * @param {any} ctx - host context.
 * @returns {object | undefined} runtime, or undefined when DSH has no agents.
 */
export function createDshSessionRuntime(ctx) {
  const agents = serviceOf(ctx, 'agents');
  if (agents === undefined) return undefined;
  const workspaces = serviceOf(ctx, 'workspaceRegistry');

  /** session id -> the one plan it may speak for (enforced on the agent tool). */
  const bindings = new Map();

  const liveOf = (sessionId) => {
    try {
      return agents.get(sessionId);
    } catch {
      return undefined;
    }
  };

  const attach = async (workspace, sessionId) => {
    try {
      const entry = workspaces?.list?.().find((item) => sameDirectory(item.path, workspace));
      if (entry?.id !== undefined && typeof workspaces?.attach === 'function') {
        await workspaces.attach(entry.id, sessionId);
      }
    } catch {
      // The session still works; it just may not appear in the sidebar list.
    }
  };

  return {
    live: liveOf,

    /** Claim a session for exactly one plan; the caller owns session creation. */
    bind(sessionId, workspace, slug) {
      bindings.set(sessionId, { workspace, slug });
    },

    /**
     * The plan a session speaks for.
     *
     * Explicit bindings win. After a plugin reload the in-memory map is empty,
     * so fall back to the live session's own cwd: the agent tool only ever
     * writes to a plan under a registered workspace root.
     */
    planOf(sessionId) {
      const bound = bindings.get(sessionId);
      if (bound !== undefined) return bound;
      const live = liveOf(sessionId);
      const cwd = live?.session?.header?.cwd;
      if (typeof cwd !== 'string' || cwd === '') return undefined;
      const registered = workspaces?.list?.().some((item) => sameDirectory(item.path, cwd));
      return registered === true ? { workspace: cwd, slug: undefined } : undefined;
    },

    /**
     * Reuse the bound conversation, resume it from disk, or explicitly create
     * one. Never silently creates a second session while the first is alive.
     * @param {{ workspace: string, title: string, sessionId: string | null }} request - request.
     * @returns {Promise<object>} opened conversation.
     */
    async open({ workspace, title, sessionId: previousId }) {
      const composition = await composeAgent(ctx);
      const presetMeta = composition === undefined ? {} : { agentPreset: composition.agentPreset };
      const setupOptions = composition === undefined ? {} : { setup: composition.setup };

      /** One open attempt; `fallback` is only set for a genuinely unusable session. */
      const attempt = async () => {
        const archived = previousId !== null
          && (workspaces?.archivedSessionIds ?? []).includes(previousId);
        if (previousId !== null && !archived) {
          const live = liveOf(previousId);
          if (live !== undefined) {
            if (!sameDirectory(live.session?.header?.cwd, workspace)) {
              throw new Error('关联会话的工作区已经变化，已停止投递');
            }
            return { agent: live, sessionId: previousId, created: false };
          }
          if (typeof agents.resume === 'function') {
            const persistence = serviceOf(ctx, 'sessionPersistence');
            let stored;
            try {
              stored = await persistence?.stat?.(previousId);
            } catch {
              stored = undefined;
            }
            if (stored !== undefined && !sameDirectory(stored.header?.cwd, workspace)) {
              throw new Error('关联会话的工作区已经变化，已停止投递');
            }
            if (stored !== undefined) {
              try {
                const handle = await agents.resume({ resumeSessionId: previousId, ...setupOptions });
                return { agent: handle.agent, sessionId: previousId, created: false };
              } catch (error) {
                // Raced with another owner (a double send, or the GUI reopened
                // it): adopt that live agent instead of opening a second one.
                const now = liveOf(previousId);
                if (now !== undefined) {
                  if (!sameDirectory(now.session?.header?.cwd, workspace)) {
                    throw new Error('关联会话的工作区已经变化，已停止投递');
                  }
                  return { agent: now, sessionId: previousId, created: false };
                }
                if (error instanceof Error && error.message.includes('工作区已经变化')) throw error;
                // Someone owns the id but the registry cannot resolve it. Falling
                // through to create() would open a second conversation and split
                // the thread; surface it so the user can close the other window.
                if (isOwnedError(error)) throw error;
              }
            }
          }
        }
        const sessionId = `session-plan-board-${crypto.randomUUID()}`;
        const handle = await agents.create({
          sessionId,
          meta: { cwd: workspace, ...presetMeta },
          ...setupOptions,
        });
        return { agent: handle.agent, sessionId, created: true };
      };

      let opened;
      try {
        opened = await attempt();
      } catch (error) {
        if (!isOwnedError(error)) throw error;
        // Last resort: someone else owns the id and it is not resolvable through
        // `get`; surface it rather than creating a duplicate silently.
        throw new Error(`关联会话正被其他窗口使用：${error instanceof Error ? error.message : String(error)}`);
      }

      await attach(workspace, opened.sessionId);
      try {
        serviceOf(ctx, 'sessions')?.setTitle?.(opened.sessionId, `计划 · ${title}`);
      } catch {
        // A display title is optional; delivery must not depend on it.
      }
      return {
        agent: opened.agent,
        sessionId: opened.sessionId,
        created: opened.created,
        status: opened.agent?.status,
      };
    },
  };
}

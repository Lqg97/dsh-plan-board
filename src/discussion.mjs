/**
 * Plan conversations live apart from the Markdown plans. The plan remains the
 * source of stage/progress truth; this store owns only comments and the DSH
 * session binding needed to deliver them.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DiscussionIndex } from './discussion-index.mjs';

export const MAX_COMMENT_CHARS = 4000;
export const DISCUSSION_SCHEMA_VERSION = 1;

/** Default durable location; tests and embedders may inject another filename. */
export function defaultDiscussionFile() {
  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
  return path.join(home, 'plan-board', 'discussions.json');
}

/** Normalize the public comment contract shared by users and the agent tool. */
export function normalizeCommentBody(value) {
  if (typeof value !== 'string') throw new Error('留言必须是字符串');
  const body = value.trim();
  if (body.length === 0) throw new Error('留言不能为空');
  if (body.length > MAX_COMMENT_CHARS) throw new Error(`留言不能超过 ${MAX_COMMENT_CHARS} 字`);
  return body;
}

/** One DSH user message per explicit delivery, even with a pending backlog. */
export function mergeCommentBodies(bodies) {
  if (bodies.length === 0) return '';
  if (bodies.length === 1) return bodies[0];
  return `（用户共留言 ${bodies.length} 条，请逐条处理）\n\n${bodies.join('\n\n----\n\n')}`;
}

function keyOf(workspace, slug) {
  return `${path.resolve(workspace)}\n${slug}`;
}

function emptyDiscussion(workspace, slug) {
  return {
    workspace: path.resolve(workspace), slug, sessionId: null,
    comments: [], createdAt: null, updatedAt: null,
  };
}

function clone(value) {
  return structuredClone(value);
}

/**
 * Small atomic JSON store. All mutations use one write lane so a user delivery
 * and an agent reply cannot overwrite each other.
 */
export class DiscussionStore {
  constructor(file = defaultDiscussionFile(), options = {}) {
    this.file = file;
    this.now = options.now ?? (() => Date.now());
    this.mintId = options.mintId ?? (() => `comment-${crypto.randomUUID()}`);
    this.data = null;
    this.loading = null;
    this.writeLane = Promise.resolve();
    /**
     * Derived search index. It is pure accelerator: `null` disables it, and
     * every index failure is swallowed because the JSON file already holds the
     * comment by then.
     */
    this.index = options.index === null
      ? null
      : options.index ?? new DiscussionIndex(file.replace(/\.json$/, '') + '.index.sqlite');
    this.indexed = false;
  }

  async load() {
    if (this.data !== null) return;
    if (this.loading !== null) return this.loading;
    this.loading = (async () => {
      let text;
      try {
        text = await fs.readFile(this.file, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          this.data = { version: DISCUSSION_SCHEMA_VERSION, discussions: {} };
          return;
        }
        throw error;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Never overwrite a file we cannot read: a truncated write or a
        // hand-edited store must reach the user as itself, not as "empty".
        throw new Error(`计划看板沟通记录不是合法 JSON（${this.file}）；原文件已保留`);
      }
      if (parsed?.version !== DISCUSSION_SCHEMA_VERSION
        || typeof parsed.discussions !== 'object' || parsed.discussions === null
        || Array.isArray(parsed.discussions)) {
        throw new Error('计划看板沟通记录格式不受支持；原文件已保留');
      }
      this.data = parsed;
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async get(workspace, slug) {
    await this.load();
    const key = keyOf(workspace, slug);
    return clone(this.data.discussions[key] ?? emptyDiscussion(workspace, slug));
  }

  async findBySession(sessionId) {
    await this.load();
    const found = Object.values(this.data.discussions)
      .find((entry) => entry?.sessionId === sessionId);
    return found === undefined ? undefined : clone(found);
  }

/**
   * Bring the derived index in line with the JSON truth.
   *
   * Runs once per process: cheap on a healthy index (schema version matches)
   * and a full rebuild when the file is missing, stale or corrupt. Failure is
   * reported by returning `false`; search then simply yields no rows.
   * @returns {Promise<boolean>} whether the index is serving queries.
   */
  async syncIndex() {
    if (this.index === null) return false;
    if (this.indexed) return this.index.available;
    await this.load();
    this.indexed = true;
    try {
      const opened = await this.index.open();
      if (opened === undefined) return false;
      // A fresh or version-mismatched database is empty: rebuild it once.
      const row = opened.prepare('SELECT COUNT(*) AS n FROM comments').get();
      if ((row?.n ?? 0) === 0 && Object.keys(this.data.discussions).length > 0) {
        await this.index.rebuild(this.data.discussions);
      }
      return this.index.available;
    } catch {
      return false;
    }
  }

  /**
   * Search comments across every plan — the query this store exists to answer.
   * @param {string} text - free text.
   * @param {{ limit?: number, pendingOnly?: boolean, workspace?: string }} [options] - filters.
   * @returns {Promise<{ available: boolean, reason?: string, rows: Array<object> }>} result.
   */
  async searchComments(text, options = {}) {
    if (!(await this.syncIndex())) {
      return {
        available: false,
        reason: this.index?.reason ?? 'search index is disabled',
        rows: [],
      };
    }
    return { available: true, rows: await this.index.search(text, options) };
  }

  /**
   * Plans holding undelivered user comments, for an inbox view.
   * @param {string} [workspace] - restrict to one workspace.
   * @returns {Promise<{ available: boolean, rows: Array<object> }>} result.
   */
  async pendingPlans(workspace) {
    if (!(await this.syncIndex())) return { available: false, rows: [] };
    return { available: true, rows: await this.index.pendingPlans(workspace) };
  }

  /** Rebuild the derived index from the JSON truth (operator escape hatch). */
  async rebuildIndex() {
    if (this.index === null) return false;
    await this.load();
    const result = await this.index.rebuild(this.data.discussions);
    this.indexed = result !== undefined;
    return this.index.available;
  }

  /** Release the index handle; the JSON truth stays untouched. */
  close() {
    this.index?.close();
  }

  /** Serialize read-modify-write and persist via same-directory atomic rename. */
  mutate(workspace, slug, mutator) {
    const operation = this.writeLane.then(async () => {
      await this.load();
      const key = keyOf(workspace, slug);
      const previous = this.data.discussions[key] ?? emptyDiscussion(workspace, slug);
      const next = clone(previous);
      const result = await mutator(next, previous);
      next.updatedAt = this.now();
      if (next.createdAt === null) next.createdAt = next.updatedAt;
      const nextData = {
        version: DISCUSSION_SCHEMA_VERSION,
        discussions: { ...this.data.discussions, [key]: next },
      };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'w');
        try {
          await handle.writeFile(`${JSON.stringify(nextData, null, 2)}\n`, 'utf8');
          // Without the fsync a crash can publish a zero-length store over the
          // previous good one; rename alone only orders the directory entry.
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, this.file);
        this.data = nextData;
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      // The JSON write is the commit. The index is a projection of it, so a
      // failure here must never surface as a failed comment.
      if (this.index !== null) {
        try {
          await this.index.upsert(key, next);
        } catch {
          // Search goes stale for this plan; the truth is still on disk.
        }
      }
      return clone(result ?? next);
    });
    this.writeLane = operation.catch(() => {});
    return operation;
  }

  /**
   * Append one comment.
   *
   * A user comment that is identical to the still-pending one is returned as-is
   * instead of stored twice: a browser retry, a double click before the button
   * disabled, or a resent request must never make the agent read the same text
   * twice. Once the earlier copy is delivered, the text may be sent again.
   * @param {string} workspace - plan workspace.
   * @param {string} slug - plan slug.
   * @param {'user'|'agent'|'system'} author - who wrote it.
   * @param {string} body - text.
   * @param {string | null} [sessionId] - speaking session.
   * @returns {Promise<object>} the stored (or already pending) comment.
   */
  addComment(workspace, slug, author, body, sessionId = null) {
    const text = normalizeCommentBody(body);
    if (!['user', 'agent', 'system'].includes(author)) throw new Error('未知留言作者');
    return this.mutate(workspace, slug, (discussion) => {
      const duplicate = author === 'user'
        ? discussion.comments.find((entry) => entry.author === 'user'
          && entry.body === text && typeof entry.deliveredAt !== 'number')
        : undefined;
      if (duplicate !== undefined) return duplicate;
      const comment = {
        id: this.mintId(), author, body: text, createdAt: this.now(),
        ...(sessionId !== null ? { sessionId } : {}),
      };
      discussion.comments.push(comment);
      return comment;
    });
  }

  bindSession(workspace, slug, sessionId) {
    return this.mutate(workspace, slug, (discussion) => {
      discussion.sessionId = sessionId;
      return discussion;
    });
  }

  markDelivered(workspace, slug, commentIds, sessionId) {
    const ids = new Set(commentIds);
    return this.mutate(workspace, slug, (discussion) => {
      const deliveredAt = this.now();
      for (const comment of discussion.comments) {
        if (comment.author === 'user' && ids.has(comment.id)) {
          comment.deliveredAt = deliveredAt;
          comment.sessionId = sessionId;
        }
      }
      discussion.sessionId = sessionId;
      return discussion;
    });
  }
}

/**
 * Coordinates durable comments with real DSH agents. Runtime is deliberately a
 * narrow structural interface, allowing exhaustive tests without an LLM.
 */
export class PlanDiscussionService {
  constructor({ store, runtime, readPlan }) {
    this.store = store;
    this.runtime = runtime;
    this.readPlan = readPlan;
    this.queues = new Map();
    this.runs = new Map();
    this.disposed = false;
  }

  async get(workspace, slug) {
    const discussion = await this.store.get(workspace, slug);
    const run = this.runs.get(keyOf(workspace, slug));
    const live = discussion.sessionId === null ? undefined : this.runtime?.live?.(discussion.sessionId);
    return {
      ...discussion,
      pending: discussion.comments.filter((comment) => comment.author === 'user'
        && typeof comment.deliveredAt !== 'number').length,
      running: run !== undefined || (live !== undefined && live.status !== 'idle'),
      available: Boolean(this.runtime) && this.disposed !== true,
    };
  }

  async comment(workspace, slug, body) {
    await this.store.addComment(workspace, slug, 'user', body);
    return this.get(workspace, slug);
  }

  enqueue(workspace, slug, operation) {
    const key = keyOf(workspace, slug);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const lane = result.catch(() => {});
    this.queues.set(key, lane);
    return result.finally(() => {
      if (this.queues.get(key) === lane) this.queues.delete(key);
    });
  }

  async deliver(workspace, slug, body, detail) {
    if (this.disposed || !this.runtime) throw new Error('当前 DSH 运行时不支持任务会话');
    return this.enqueue(workspace, slug, async () => {
      if (typeof body === 'string' && body.trim().length > 0) {
        await this.store.addComment(workspace, slug, 'user', body);
      }
      const before = await this.store.get(workspace, slug);
      const pending = before.comments.filter((comment) => comment.author === 'user'
        && typeof comment.deliveredAt !== 'number');
      if (pending.length === 0) throw new Error('没有待投递的留言');

      const opened = await this.runtime.open({
        workspace, slug, title: detail.title, sessionId: before.sessionId,
      });
      // One conversation can back only one plan: the agent reply is routed by
      // session id, so sharing an id would send plan B's answer to plan A.
      if (typeof this.runtime.bind === 'function') {
        this.runtime.bind(opened.sessionId, workspace, slug);
      }
      // Bind before dispatch: if a later step fails, the retry resumes this
      // session instead of leaving an unowned replacement behind.
      await this.store.bindSession(workspace, slug, opened.sessionId);
      // Always (re)state which plan this turn is about. A reused conversation
      // may be mid-turn on something else, and the agent needs the reply
      // contract in context before it answers.
      // Watch before dispatching: a fast first turn can settle before a
      // post-dispatch hook is attached, which would strand the "running" badge.
      this.watch(workspace, slug, opened.sessionId, opened.agent);
      const plan = await this.readPlan(workspace, slug, detail.archived === true);
      opened.agent.inject({
        id: `msg-plan-board-${crypto.randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: this.framing(workspace, slug, detail, plan) }],
        source: { kind: 'dsh-plan-board' },
      });
      if (opened.created && before.sessionId !== null && before.sessionId !== opened.sessionId) {
        await this.store.addComment(workspace, slug, 'system', '原关联会话不可用，已创建新会话继续沟通。');
      }
      opened.agent.followup({
        id: `msg-plan-board-${crypto.randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: mergeCommentBodies(pending.map((comment) => comment.body)) }],
        source: { kind: 'user' },
      });
      await this.store.markDelivered(workspace, slug, pending.map((comment) => comment.id), opened.sessionId);
      return {
        ok: true,
        delivered: opened.status === 'running' ? 'live' : 'run',
        count: pending.length,
        sessionId: opened.sessionId,
        discussion: await this.get(workspace, slug),
      };
    });
  }

  framing(workspace, slug, detail, plan) {
    return [
      `【计划看板】${detail.title}`,
      `计划 slug: ${slug}`,
      `工作区: ${workspace}`,
      `计划文件: doc/plans/${detail.archived === true ? 'done/' : ''}${slug}.md`,
      '',
      '你正在通过计划看板与用户沟通。先理解下面的计划，再处理随后的用户留言。',
      '需要让回复出现在看板时，调用 plan_board_comment_add（body 为 1..4000 字）；完成每轮处理时必须调用一次，概述结果、验证和仍需用户决定的事项。',
      '不要仅在看板留言中声称已修改文件；实际修改仍需使用当前会话的工具完成。',
      '',
      '--- 计划内容（沟通上下文，不替代原文件） ---',
      plan || '（计划正文读取失败，请先读取上述计划文件。）',
    ].join('\n');
  }

  watch(workspace, slug, sessionId, agent) {
    const key = keyOf(workspace, slug);
    const existing = this.runs.get(key);
    // Re-watch a different session (the old one was replaced); keep one per plan.
    if (existing !== undefined && existing.sessionId === sessionId) return;
    const run = { sessionId, agent };
    this.runs.set(key, run);
    Promise.resolve(agent.whenIdle())
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.addComment(workspace, slug, 'system', `Agent 本轮执行失败：${message}`, sessionId)
          .catch(() => {});
      })
      .finally(() => {
        if (this.runs.get(key) === run) this.runs.delete(key);
      });
  }

  async agentComment(sessionId, body) {
    // Route by the session -> plan map maintained at delivery time, never by a
    // "first discussion bound to this session" scan.
    const target = typeof this.runtime?.planOf === 'function'
      ? this.runtime.planOf(sessionId)
      : undefined;
    let discussion;
    if (target?.slug !== undefined) {
      discussion = await this.store.get(target.workspace, target.slug);
      if (discussion.sessionId !== sessionId) throw new Error('该会话当前未绑定这个计划');
    } else if (target?.workspace !== undefined) {
      // Reload case: the map is gone, so resolve from the store but require that
      // the plan really is bound to this exact session.
      discussion = await this.store.findBySession(sessionId);
    } else {
      discussion = await this.store.findBySession(sessionId);
    }
    if (discussion === undefined) throw new Error('当前会话没有关联的计划看板任务');
    if (target?.workspace !== undefined && discussion.workspace !== path.resolve(target.workspace)) {
      throw new Error('该会话当前未绑定这个计划');
    }
    await this.store.addComment(discussion.workspace, discussion.slug, 'agent', body, sessionId);
    return this.get(discussion.workspace, discussion.slug);
  }

  dispose() {
    this.disposed = true;
  }
}

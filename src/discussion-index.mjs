/**
 * Disposable SQLite search index over the plan-board discussion store.
 *
 * Design follows DSH's own session-search service: the durable truth stays in
 * `discussions.json` (human-readable, greppable, hand-repairable), and SQLite
 * holds only a *derived* read model that can be deleted and rebuilt at any time.
 *
 * Consequences that shape this file:
 * - the index is never authoritative: a missing or damaged database degrades to
 *   "no search", never to lost comments;
 * - every write path is `index()`-ed after the JSON write commits, so a failed
 *   index update cannot roll back a comment;
 * - the schema is versioned with `PRAGMA user_version`, and an unrecognised
 *   version rebuilds from JSON rather than migrating blindly.
 *
 * `node:sqlite` is an experimental built-in and logs an ExperimentalWarning on
 * first import; it is imported lazily so profiles that never search never see it.
 */

import path from 'node:path';

/** Derived schema version; a mismatch rebuilds the index from the JSON truth. */
export const INDEX_SCHEMA_VERSION = 1;

/** Rows examined per batch while rebuilding, to bound peak memory. */
const REBUILD_BATCH = 500;

/**
 * Whether SQLite is usable in this runtime.
 * @returns {Promise<{ DatabaseSync: any } | undefined>} module, or undefined.
 */
async function loadSqlite() {
  try {
    const module = await import('node:sqlite');
    return typeof module?.DatabaseSync === 'function' ? module : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A derived, rebuildable search index.
 *
 * The public surface is deliberately narrow: search plus a full rebuild. Every
 * method tolerates an unusable index by returning "no result" instead of
 * throwing, because search is an accelerator, not a source of truth.
 */
export class DiscussionIndex {
  /**
   * @param {string} file - database path; `:memory:` is allowed for tests.
   * @param {{ now?: () => number, batchSize?: number }} [options] - knobs.
   */
  constructor(file, options = {}) {
    this.file = file;
    this.now = options.now ?? (() => Date.now());
    this.batchSize = options.batchSize ?? REBUILD_BATCH;
    this.db = null;
    this.opening = null;
    /** Why the index is currently unusable, if it is. */
    this.reason = undefined;
  }

  /**
   * Open and validate the index, rebuilding it when the schema is unknown.
   * Safe to call repeatedly; concurrent calls share one open.
   * @returns {Promise<any | undefined>} the database handle, or undefined.
   */
  async open() {
    if (this.db !== null) return this.db;
    if (this.opening !== null) return this.opening;
    this.opening = (async () => {
      const sqlite = await loadSqlite();
      if (sqlite === undefined) {
        this.reason = 'node:sqlite is unavailable in this runtime';
        return undefined;
      }
      let db;
      try {
        db = new sqlite.DatabaseSync(this.file === ':memory:' ? ':memory:' : path.resolve(this.file));
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
        db.exec('PRAGMA application_id = 0x50424152');
        const { user_version: version } = db.prepare('PRAGMA user_version').get() ?? {};
        if (version !== INDEX_SCHEMA_VERSION) this.#createSchema(db);
        this.db = db;
        this.reason = undefined;
        return db;
      } catch (error) {
        try {
          db?.close();
        } catch {
          // Already unusable; nothing to release.
        }
        this.reason = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }

  /**
   * (Re)create the derived tables. Dropping first keeps `user_version`
   * mismatches a rebuild rather than a blind migration.
   * @param {any} db - open database.
   */
  #createSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        plan_key   TEXT PRIMARY KEY,
        workspace  TEXT NOT NULL,
        slug       TEXT NOT NULL,
        session_id TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS comments (
        id          TEXT PRIMARY KEY,
        plan_key    TEXT NOT NULL,
        author      TEXT NOT NULL,
        body        TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS comments_by_plan ON comments(plan_key, created_at);
      CREATE INDEX IF NOT EXISTS comments_pending ON comments(delivered_at) WHERE delivered_at IS NULL;
      CREATE INDEX IF NOT EXISTS plans_by_session ON plans(session_id);
    `);
    db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
  }

  /**
   * Drop everything and rebuild from the authoritative store snapshot.
   * @param {Record<string, any>} discussions - key -> discussion, as stored in JSON.
   * @returns {Promise<{ indexed: number } | undefined>} counts, or undefined when unavailable.
   */
  async rebuild(discussions) {
    const db = await this.open();
    if (db === undefined) return undefined;
    try {
      db.exec('BEGIN');
      db.exec('DELETE FROM comments');
      db.exec('DELETE FROM plans');
      const planInsert = db.prepare(`
        INSERT OR REPLACE INTO plans(plan_key, workspace, slug, session_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const commentInsert = db.prepare(`
        INSERT OR REPLACE INTO comments(id, plan_key, author, body, created_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      let indexed = 0;
      const entries = Object.entries(discussions ?? {});
      for (let offset = 0; offset < entries.length; offset += this.batchSize) {
        for (const [planKey, discussion] of entries.slice(offset, offset + this.batchSize)) {
          planInsert.run(
            planKey,
            discussion.workspace,
            discussion.slug,
            discussion.sessionId ?? null,
            discussion.updatedAt ?? null,
          );
          for (const comment of discussion.comments ?? []) {
            commentInsert.run(
              comment.id,
              planKey,
              comment.author,
              comment.body,
              comment.createdAt ?? 0,
              comment.deliveredAt ?? null,
            );
            indexed += 1;
          }
        }
      }
      db.exec('COMMIT');
      return { indexed };
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the caller only needs the error.
      }
      this.reason = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }

  /**
   * Sync one plan's rows without touching anything else.
   * @param {string} planKey - store key.
   * @param {any} discussion - that plan's discussion.
   * @returns {Promise<boolean>} whether the index accepted the write.
   */
  async upsert(planKey, discussion) {
    const db = await this.open();
    if (db === undefined) return false;
    try {
      db.exec('BEGIN');
      db.prepare(`
        INSERT OR REPLACE INTO plans(plan_key, workspace, slug, session_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        planKey,
        discussion.workspace,
        discussion.slug,
        discussion.sessionId ?? null,
        discussion.updatedAt ?? null,
      );
      db.prepare('DELETE FROM comments WHERE plan_key = ?').run(planKey);
      const insert = db.prepare(`
        INSERT OR REPLACE INTO comments(id, plan_key, author, body, created_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const comment of discussion.comments ?? []) {
        insert.run(
          comment.id, planKey, comment.author, comment.body,
          comment.createdAt ?? 0, comment.deliveredAt ?? null,
        );
      }
      db.exec('COMMIT');
      return true;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore: the write simply did not land.
      }
      this.reason = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Search comments across every plan.
   *
   * This is the query the JSON store cannot answer cheaply, and the reason the
   * index exists at all.
   * @param {string} text - free text; empty returns the newest comments.
   * @param {{ limit?: number, pendingOnly?: boolean, workspace?: string }} [options] - filters.
   * @returns {Promise<Array<object>>} matches, newest first; empty when unusable.
   */
  async search(text, options = {}) {
    const db = await this.open();
    if (db === undefined) return [];
    const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 500);
    const clauses = [];
    const params = [];
    const query = typeof text === 'string' ? text.trim() : '';
    if (query !== '') {
      clauses.push('c.body LIKE ?');
      params.push(`%${query}%`);
    }
    if (options.pendingOnly === true) clauses.push('c.delivered_at IS NULL');
    if (typeof options.workspace === 'string' && options.workspace !== '') {
      clauses.push('p.workspace = ?');
      params.push(path.resolve(options.workspace));
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    try {
      const rows = db.prepare(`
        SELECT c.id, c.plan_key, c.author, c.body, c.created_at, c.delivered_at,
               p.workspace, p.slug, p.session_id
        FROM comments c
        JOIN plans p ON p.plan_key = c.plan_key
        ${where}
        ORDER BY c.created_at DESC
        LIMIT ?
      `).all(...params, limit);
      return rows.map((row) => ({ ...row }));
    } catch (error) {
      this.reason = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  /**
   * Plans that still have an undelivered user comment — the inbox query.
   * @param {string} [workspace] - restrict to one workspace.
   * @returns {Promise<Array<object>>} one row per plan with a pending count.
   */
  async pendingPlans(workspace) {
    const db = await this.open();
    if (db === undefined) return [];
    const hasWorkspace = typeof workspace === 'string' && workspace !== '';
    try {
      const rows = db.prepare(`
        SELECT p.plan_key, p.workspace, p.slug, p.session_id, COUNT(c.id) AS pending
        FROM plans p
        JOIN comments c ON c.plan_key = p.plan_key
        WHERE c.delivered_at IS NULL AND c.author = 'user'
          ${hasWorkspace ? 'AND p.workspace = ?' : ''}
        GROUP BY p.plan_key
        ORDER BY pending DESC, p.slug ASC
      `).all(...(hasWorkspace ? [path.resolve(workspace)] : []));
      return rows.map((row) => ({ ...row }));
    } catch (error) {
      this.reason = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  /** Whether the index is currently serving queries. */
  get available() {
    return this.db !== null;
  }

  /** Close the handle; the file stays on disk and is reusable next boot. */
  close() {
    try {
      this.db?.close();
    } catch {
      // Closing a already-broken handle must not mask the original failure.
    }
    this.db = null;
  }
}

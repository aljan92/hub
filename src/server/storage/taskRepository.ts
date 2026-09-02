import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { DesignTaskLog, SessionEvent, TaskSummary } from '../../types/tasks';
import { loadJsonWithBackupRecovery } from '../utils/atomicFileStorage';

export interface TaskPageOptions {
  limit?: number;
  cursor?: string;
  source?: string;
  status?: string;
  checkpoint?: string;
  search?: string;
}

export interface TaskPageResult {
  success: boolean;
  tasks: TaskSummary[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface TaskUsageMetrics {
  imageGenerationsCount: number;
  vectorizationsCount: number;
  taskEventOpenRouterCost: number;
}

interface ColumnProjection {
  id: string;
  counter: number;
  source: string;
  suffix: string | null;
  status: string;
  checkpoint: string | null;
  received_at: string;
  updated_at: string;
  quote: string | null;
  niche1: string | null;
  niche2: string | null;
  subniche: string | null;
  image_url: string | null;
  has_error: number;
  error_details: string | null;
  design_id: string | null;
  in_queue: number;
  events_count: number;
  client_ip: string | null;
  image_generations_count: number;
  vectorizations_count: number;
  openrouter_cost_usd: number;
  payload_json: string;
}

export class TaskRepository {
  private static db: DatabaseSync | null = null;
  private static dbPath = path.resolve(process.cwd(), 'data', 'mba_hub.sqlite');
  private static legacyJsonPath = path.resolve(process.cwd(), 'data', 'tasks_log.json');
  private static legacyCounterPath = path.resolve(process.cwd(), 'data', 'tasks_counter.json');
  private static isInitialized = false;

  private static verifyNodeEngine() {
    const [majorStr, minorStr] = process.versions.node.split('.');
    const major = parseInt(majorStr, 10);
    const minor = parseInt(minorStr, 10);
    const isSupported = major > 22 || (major === 22 && minor >= 5);
    if (!isSupported) {
      throw new Error(`[TaskRepository] node:sqlite requires Node.js >= 22.5.0. Current runtime is ${process.version}`);
    }
  }

  /**
   * Initializes the SQLite Database, sets WAL & FULL durability, applies schemas,
   * and runs atomic migration from tasks_log.json if necessary.
   */
  public static init(customDbPath?: string): void {
    if (this.isInitialized && this.db && !customDbPath) return;
    this.verifyNodeEngine();

    const targetDbPath = customDbPath || this.dbPath;
    const dbDir = path.dirname(targetDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // If SQLite DB does not exist yet, check if we need to migrate from tasks_log.json
    if (!fs.existsSync(targetDbPath) && !customDbPath && fs.existsSync(this.legacyJsonPath)) {
      console.log('[TaskRepository] 📦 Discovered existing tasks_log.json with no SQLite database. Starting atomic migration...');
      this.executeMigrationFromLegacyJson(targetDbPath);
    }

    this.db = new DatabaseSync(targetDbPath);
    this.configurePragmas(this.db);
    this.createSchema(this.db);
    this.isInitialized = true;
    console.log(`[TaskRepository] 🛡️ SQLite Task Storage initialized at ${targetDbPath} (WAL Mode, synchronous=FULL).`);
  }

  /**
   * Closes the database with a clean checkpoint.
   */
  public static close(): void {
    if (this.db) {
      try {
        console.log('[TaskRepository] 🛑 Checkpointing and closing SQLite database...');
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        this.db.close();
      } catch (err: any) {
        console.warn('[TaskRepository] Error during close:', err.message);
      } finally {
        this.db = null;
        this.isInitialized = false;
      }
    }
  }

  /**
   * Configures SQLite PRAGMAs for high durability & concurrency on NAS / Docker
   */
  private static configurePragmas(db: DatabaseSync): void {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = FULL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
  }

  /**
   * Creates the application metadata and tasks tables with composite indexes
   */
  private static createSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        counter INTEGER NOT NULL,
        source TEXT NOT NULL,
        suffix TEXT,
        status TEXT NOT NULL,
        checkpoint TEXT,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        quote TEXT,
        niche1 TEXT,
        niche2 TEXT,
        subniche TEXT,
        image_url TEXT,
        has_error INTEGER NOT NULL DEFAULT 0,
        error_details TEXT,
        design_id TEXT,
        in_queue INTEGER NOT NULL DEFAULT 0,
        events_count INTEGER NOT NULL DEFAULT 0,
        client_ip TEXT,
        image_generations_count INTEGER NOT NULL DEFAULT 0,
        vectorizations_count INTEGER NOT NULL DEFAULT 0,
        openrouter_cost_usd REAL NOT NULL DEFAULT 0.0,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_counter ON tasks(counter DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_source_counter ON tasks(source, counter DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status_counter ON tasks(status, counter DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_design_id ON tasks(design_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_received_at ON tasks(received_at DESC);
    `);

    // Schema version
    const versionRow: any = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
    if (!versionRow) {
      db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', '1')").run();
      db.exec('PRAGMA user_version = 1;');
    }
  }

  /**
   * Central mapper: Converts canonical DesignTaskLog to strongly-typed projection columns.
   */
  public static taskToColumns(task: DesignTaskLog): ColumnProjection {
    const quote = task.quote || task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || task.payload?.title || null;
    const niche1 = task.niche1 || task.payload?.niche1 || null;
    const niche2 = task.niche2 || task.payload?.niche2 || null;
    const subniche = task.subniche || task.payload?.subniche || null;
    const designId = task.payload?.designId || task.designId || null;
    const imageUrl = task.imageUrl || null;
    const errorDetails = task.errorDetails || null;
    const clientIp = task.clientIp || null;
    const eventsCount = Array.isArray(task.events) ? task.events.length : (task.eventsCount || 0);

    // Compute lightweight usage metrics directly from events / task
    let imageGenCount = 0;
    let vectorCount = 0;
    let openRouterCost = 0;

    if (Array.isArray(task.events)) {
      for (const ev of task.events) {
        if (ev.type === 'IDEOGRAM_RESPONSE') imageGenCount++;
        if (ev.type === 'VECTORIZE_RESPONSE') vectorCount++;
        if (ev.metadata?.costUsd) openRouterCost += Number(ev.metadata.costUsd) || 0;
      }
    } else {
      if (imageUrl) imageGenCount++;
      if (task.svgContent || task.localMbaPngPath) vectorCount++;
    }

    // Canonical payload contains the exact task object
    const payloadJson = JSON.stringify(task);

    return {
      id: task.id,
      counter: task.counter || 0,
      source: task.source || 'HERMES',
      suffix: task.suffix || null,
      status: task.status || 'RECEIVED',
      checkpoint: task.checkpoint || null,
      received_at: task.receivedAt || new Date().toISOString(),
      updated_at: task.updatedAt || task.receivedAt || new Date().toISOString(),
      quote,
      niche1,
      niche2,
      subniche,
      image_url: imageUrl,
      has_error: task.hasError ? 1 : 0,
      error_details: errorDetails,
      design_id: designId,
      in_queue: task.inQueue ? 1 : 0,
      events_count: eventsCount,
      client_ip: clientIp,
      image_generations_count: imageGenCount,
      vectorizations_count: vectorCount,
      openrouter_cost_usd: openRouterCost,
      payload_json: payloadJson
    };
  }

  /**
   * Central mapper: Reconstructs canonical DesignTaskLog from a database row.
   */
  public static rowToTask(row: any): DesignTaskLog {
    if (!row || !row.payload_json) {
      throw new Error('[TaskRepository] Invalid row: payload_json is missing');
    }
    const task: DesignTaskLog = JSON.parse(row.payload_json);
    // Guarantee synchronization with indexed columns
    task.id = row.id;
    task.counter = row.counter;
    task.source = row.source;
    task.suffix = row.suffix;
    task.status = row.status;
    task.checkpoint = row.checkpoint;
    task.receivedAt = row.received_at;
    task.updatedAt = row.updated_at;
    task.quote = row.quote || task.quote;
    task.niche1 = row.niche1 || task.niche1;
    task.niche2 = row.niche2 || task.niche2;
    task.subniche = row.subniche || task.subniche;
    task.imageUrl = row.image_url || task.imageUrl;
    task.hasError = Boolean(row.has_error);
    task.errorDetails = row.error_details || task.errorDetails;
    task.inQueue = Boolean(row.in_queue);
    task.eventsCount = row.events_count;
    task.clientIp = row.client_ip || task.clientIp;
    return task;
  }

  /**
   * Central mapper: Converts database row directly into lightweight TaskSummary without payload_json parsing.
   */
  public static rowToSummary(row: any): TaskSummary {
    return {
      id: row.id,
      counter: row.counter,
      source: row.source,
      suffix: row.suffix || undefined,
      status: row.status,
      checkpoint: row.checkpoint || undefined,
      receivedAt: row.received_at,
      updatedAt: row.updated_at,
      quote: row.quote || undefined,
      niche1: row.niche1 || undefined,
      niche2: row.niche2 || undefined,
      subniche: row.subniche || undefined,
      imageUrl: row.image_url || undefined,
      hasError: Boolean(row.has_error),
      errorDetails: row.error_details || undefined,
      eventsCount: row.events_count,
      clientIp: row.client_ip || undefined,
      designId: row.design_id || undefined,
      inQueue: Boolean(row.in_queue)
    };
  }

  /**
   * Atomic migration of tasks_log.json using a separate temporary database (mba_hub.sqlite.migrating).
   * If any error occurs, rolls back, discards temporary files, leaves tasks_log.json untouched,
   * and throws error (Fail-Closed).
   */
  public static executeMigrationFromLegacyJson(targetDbPath: string, customJsonPath?: string): void {
    const jsonPath = customJsonPath || this.legacyJsonPath;
    const tempDbPath = `${targetDbPath}.migrating`;

    // 1. Clean up any leftover .migrating database from a previously aborted run
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
    if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);

    console.log(`[TaskRepository] ⏳ Reading legacy JSON from ${jsonPath}...`);
    const recovery = loadJsonWithBackupRecovery<DesignTaskLog[]>(jsonPath, {
      backupExt: '.bak',
      validate: (data) => Array.isArray(data),
      defaultValue: []
    });

    if (!recovery.success || !Array.isArray(recovery.data)) {
      throw new Error(`[TaskRepository] Failed to read or parse ${jsonPath}. Migration aborted.`);
    }

    const legacyTasks = recovery.data;
    console.log(`[TaskRepository] 📄 Found ${legacyTasks.length} legacy tasks to migrate.`);

    let tempDb: DatabaseSync | null = null;

    try {
      tempDb = new DatabaseSync(tempDbPath);
      this.configurePragmas(tempDb);
      this.createSchema(tempDb);

      tempDb.exec('BEGIN IMMEDIATE;');

      const insertStmt = tempDb.prepare(`
        INSERT INTO tasks (
          id, counter, source, suffix, status, checkpoint, received_at, updated_at,
          quote, niche1, niche2, subniche, image_url, has_error, error_details,
          design_id, in_queue, events_count, client_ip,
          image_generations_count, vectorizations_count, openrouter_cost_usd,
          payload_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?
        )
      `);

      let maxCounter = 0;
      const seenIds = new Set<string>();

      for (const task of legacyTasks) {
        if (!task || !task.id) continue;
        seenIds.add(task.id);
        const counter = task.counter || 0;
        if (counter > maxCounter) maxCounter = counter;

        const cols = this.taskToColumns(task);
        insertStmt.run(
          cols.id, cols.counter, cols.source, cols.suffix, cols.status, cols.checkpoint,
          cols.received_at, cols.updated_at, cols.quote, cols.niche1, cols.niche2, cols.subniche,
          cols.image_url, cols.has_error, cols.error_details, cols.design_id, cols.in_queue,
          cols.events_count, cols.client_ip, cols.image_generations_count, cols.vectorizations_count,
          cols.openrouter_cost_usd, cols.payload_json
        );
      }

      // Read legacy counter if present
      let counterToStore = maxCounter;
      if (fs.existsSync(this.legacyCounterPath)) {
        try {
          const rawCounter = JSON.parse(fs.readFileSync(this.legacyCounterPath, 'utf-8'));
          if (rawCounter && typeof rawCounter.counter === 'number') {
            counterToStore = Math.max(counterToStore, rawCounter.counter);
          }
        } catch {}
      }

      tempDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('task_counter', ?)").run(String(counterToStore));
      tempDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1')").run();

      tempDb.exec('COMMIT;');

      // 2. Validation
      const countRow: any = tempDb.prepare('SELECT COUNT(*) as count FROM tasks').get();
      if (countRow.count !== seenIds.size) {
        throw new Error(`[TaskRepository] Migration integrity error: Expected ${seenIds.size} rows, but found ${countRow.count} in database.`);
      }

      // 3. Explicit WAL Checkpoint TRUNCATE & result verification
      const checkpointRow: any = tempDb.prepare('PRAGMA wal_checkpoint(TRUNCATE);').get();
      if (checkpointRow && checkpointRow.busy === 1) {
        throw new Error(`[TaskRepository] PRAGMA wal_checkpoint(TRUNCATE) failed with busy status: ${JSON.stringify(checkpointRow)}`);
      }

      // 4. Verify integrity on the fully checkpointed database
      const integrityRow: any = tempDb.prepare('PRAGMA integrity_check;').get();
      if (!integrityRow || integrityRow.integrity_check !== 'ok') {
        throw new Error(`[TaskRepository] PRAGMA integrity_check failed: ${JSON.stringify(integrityRow)}`);
      }

      // 5. Close temp DB connection
      tempDb.close();
      tempDb = null;

      // 6. Ensure no lingering .migrating-wal or .migrating-shm remains before renaming
      const tempWalPath = `${tempDbPath}-wal`;
      const tempShmPath = `${tempDbPath}-shm`;
      if (fs.existsSync(tempWalPath)) {
        try { fs.unlinkSync(tempWalPath); } catch {}
      }
      if (fs.existsSync(tempShmPath)) {
        try { fs.unlinkSync(tempShmPath); } catch {}
      }

      // 7. Atomically rename .migrating to final database
      fs.renameSync(tempDbPath, targetDbPath);
      console.log(`[TaskRepository] ✅ Migration complete! Created ${targetDbPath} with ${countRow.count} tasks.`);

      // 5. Retain original JSON files as permanent backup
      const backupJsonPath = path.resolve(path.dirname(jsonPath), 'tasks_log.pre-sqlite-backup.json');
      fs.renameSync(jsonPath, backupJsonPath);
      console.log(`[TaskRepository] 🛡️ Original tasks_log.json preserved as ${backupJsonPath}.`);

      if (fs.existsSync(this.legacyCounterPath)) {
        const backupCounterPath = path.resolve(path.dirname(this.legacyCounterPath), 'tasks_counter.pre-sqlite-backup.json');
        try {
          fs.renameSync(this.legacyCounterPath, backupCounterPath);
        } catch {}
      }
    } catch (err: any) {
      if (tempDb) {
        try {
          tempDb.exec('ROLLBACK;');
          tempDb.close();
        } catch {}
      }
      // Remove temporary files
      try { if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath); } catch {}
      try { if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`); } catch {}
      try { if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`); } catch {}

      console.error('[TaskRepository] 🚨 CRITICAL MIGRATION FAILURE. Original JSON files left untouched:', err.message);
      throw err;
    }
  }

  private static getDb(): DatabaseSync {
    if (!this.db) {
      this.init();
    }
    return this.db!;
  }

  /**
   * Atomically increments and returns the next sequential task counter.
   */
  public static getNextCounter(): number {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      let current = 0;
      const row: any = db.prepare("SELECT value FROM metadata WHERE key = 'task_counter'").get();
      if (row && row.value) {
        current = parseInt(row.value, 10) || 0;
      } else {
        const maxRow: any = db.prepare('SELECT COALESCE(MAX(counter), 0) as maxCounter FROM tasks').get();
        current = maxRow.maxCounter || 0;
      }

      current += 1;
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('task_counter', ?)").run(String(current));
      db.exec('COMMIT;');
      return current;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  /**
   * Inserts a new task atomically.
   */
  public static createTask(task: DesignTaskLog): DesignTaskLog {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (!task.counter) {
        let current = 0;
        const row: any = db.prepare("SELECT value FROM metadata WHERE key = 'task_counter'").get();
        if (row && row.value) {
          current = parseInt(row.value, 10) || 0;
        } else {
          const maxRow: any = db.prepare('SELECT COALESCE(MAX(counter), 0) as maxCounter FROM tasks').get();
          current = maxRow.maxCounter || 0;
        }
        current += 1;
        task.counter = current;
        db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('task_counter', ?)").run(String(current));
      }

      if (!task.id) {
        const padded = String(task.counter).padStart(3, '0');
        task.id = task.suffix ? `#${padded}-${task.suffix}` : `#${padded}`;
      }

      task.receivedAt = task.receivedAt || new Date().toISOString();
      task.updatedAt = new Date().toISOString();

      const cols = this.taskToColumns(task);

      db.prepare(`
        INSERT INTO tasks (
          id, counter, source, suffix, status, checkpoint, received_at, updated_at,
          quote, niche1, niche2, subniche, image_url, has_error, error_details,
          design_id, in_queue, events_count, client_ip,
          image_generations_count, vectorizations_count, openrouter_cost_usd,
          payload_json
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?
        )
      `).run(
        cols.id, cols.counter, cols.source, cols.suffix, cols.status, cols.checkpoint,
        cols.received_at, cols.updated_at, cols.quote, cols.niche1, cols.niche2, cols.subniche,
        cols.image_url, cols.has_error, cols.error_details, cols.design_id, cols.in_queue,
        cols.events_count, cols.client_ip, cols.image_generations_count, cols.vectorizations_count,
        cols.openrouter_cost_usd, cols.payload_json
      );

      db.exec('COMMIT;');
      return task;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  /**
   * Updates only the targeted task row. Loads existing task, merges partial updates,
   * updates payload_json and indexed columns atomically.
   */
  public static updateTask(taskId: string, updates: Partial<DesignTaskLog>): DesignTaskLog | null {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const row: any = db.prepare('SELECT payload_json FROM tasks WHERE id = ?').get(taskId);
      if (!row || !row.payload_json) {
        db.exec('ROLLBACK;');
        return null;
      }

      const existingTask: DesignTaskLog = JSON.parse(row.payload_json);

      // Deep merge payload if provided
      if (updates.payload) {
        existingTask.payload = {
          ...existingTask.payload,
          ...updates.payload
        };
      }

      // Merge other properties
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'payload') continue;
        (existingTask as any)[key] = value;
      }

      existingTask.updatedAt = new Date().toISOString();

      const cols = this.taskToColumns(existingTask);

      db.prepare(`
        UPDATE tasks SET
          counter = ?,
          source = ?,
          suffix = ?,
          status = ?,
          checkpoint = ?,
          received_at = ?,
          updated_at = ?,
          quote = ?,
          niche1 = ?,
          niche2 = ?,
          subniche = ?,
          image_url = ?,
          has_error = ?,
          error_details = ?,
          design_id = ?,
          in_queue = ?,
          events_count = ?,
          client_ip = ?,
          image_generations_count = ?,
          vectorizations_count = ?,
          openrouter_cost_usd = ?,
          payload_json = ?
        WHERE id = ?
      `).run(
        cols.counter, cols.source, cols.suffix, cols.status, cols.checkpoint,
        cols.received_at, cols.updated_at, cols.quote, cols.niche1, cols.niche2, cols.subniche,
        cols.image_url, cols.has_error, cols.error_details, cols.design_id, cols.in_queue,
        cols.events_count, cols.client_ip, cols.image_generations_count, cols.vectorizations_count,
        cols.openrouter_cost_usd, cols.payload_json,
        taskId
      );

      db.exec('COMMIT;');
      return existingTask;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  /**
   * Appends an event to a single task atomically with duplicate event compaction.
   */
  public static addEvent(taskId: string, event: SessionEvent): DesignTaskLog | null {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const row: any = db.prepare('SELECT payload_json FROM tasks WHERE id = ?').get(taskId);
      if (!row || !row.payload_json) {
        db.exec('ROLLBACK;');
        return null;
      }

      const task: DesignTaskLog = JSON.parse(row.payload_json);
      if (!Array.isArray(task.events)) {
        task.events = [];
      }

      // Compact consecutive identical events
      const lastEvent = task.events.length > 0 ? task.events[task.events.length - 1] : null;
      const isConsecutiveDuplicate =
        lastEvent &&
        lastEvent.type === event.type &&
        lastEvent.title === event.title &&
        JSON.stringify(lastEvent.content ?? null) === JSON.stringify(event.content ?? null);

      if (isConsecutiveDuplicate && lastEvent) {
        lastEvent.repeatCount = (lastEvent.repeatCount || 1) + 1;
        lastEvent.lastRepeatedAt = event.timestamp || new Date().toISOString();
      } else {
        task.events.push(event);
      }

      task.updatedAt = new Date().toISOString();
      const cols = this.taskToColumns(task);

      db.prepare(`
        UPDATE tasks SET
          updated_at = ?,
          events_count = ?,
          image_generations_count = ?,
          vectorizations_count = ?,
          openrouter_cost_usd = ?,
          payload_json = ?
        WHERE id = ?
      `).run(
        cols.updated_at,
        cols.events_count,
        cols.image_generations_count,
        cols.vectorizations_count,
        cols.openrouter_cost_usd,
        cols.payload_json,
        taskId
      );

      db.exec('COMMIT;');
      return task;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  /**
   * Full reconstruction of DesignTaskLog from SQLite.
   */
  public static getTaskById(taskId: string): DesignTaskLog | null {
    const db = this.getDb();
    const row: any = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!row) return null;
    return this.rowToTask(row);
  }

  /**
   * Fast summary retrieval without parsing payload_json.
   */
  public static getTaskSummaryById(taskId: string): TaskSummary | null {
    const db = this.getDb();
    const row: any = db.prepare(`
      SELECT id, counter, source, suffix, status, checkpoint, received_at, updated_at,
             quote, niche1, niche2, subniche, image_url, has_error, error_details,
             design_id, in_queue, events_count, client_ip
      FROM tasks
      WHERE id = ?
    `).get(taskId);

    if (!row) return null;
    return this.rowToSummary(row);
  }

  /**
   * Keyset pagination query directly from SQLite (WHERE counter < ? ORDER BY counter DESC LIMIT 21).
   */
  public static getTaskSummariesPage(options: TaskPageOptions = {}): TaskPageResult {
    const db = this.getDb();
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const queryLimit = limit + 1; // 21st record determines hasMore

    const conditions: string[] = [];
    const params: any[] = [];

    // Keyset cursor based on task counter
    if (options.cursor) {
      const cursorRow: any = db.prepare('SELECT counter FROM tasks WHERE id = ?').get(options.cursor);
      if (cursorRow && typeof cursorRow.counter === 'number') {
        conditions.push('counter < ?');
        params.push(cursorRow.counter);
      }
    }

    if (options.source && options.source !== 'ALL') {
      conditions.push('source = ?');
      params.push(options.source);
    }

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.checkpoint) {
      conditions.push('checkpoint = ?');
      params.push(options.checkpoint);
    }

    if (options.search && options.search.trim()) {
      const q = `%${options.search.trim()}%`;
      conditions.push('(id LIKE ? OR quote LIKE ? OR niche1 LIKE ? OR niche2 LIKE ? OR design_id LIKE ?)');
      params.push(q, q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT id, counter, source, suffix, status, checkpoint, received_at, updated_at,
             quote, niche1, niche2, subniche, image_url, has_error, error_details,
             design_id, in_queue, events_count, client_ip
      FROM tasks
      ${whereClause}
      ORDER BY counter DESC
      LIMIT ?
    `;

    const rows: any[] = db.prepare(sql).all(...params, queryLimit);

    // Count total matching records for totalCount
    const countSql = `SELECT COUNT(*) as total FROM tasks ${whereClause}`;
    const totalRow: any = db.prepare(countSql).get(...params);
    const totalCount = totalRow ? totalRow.total : rows.length;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const tasks = pageRows.map(r => this.rowToSummary(r));
    const nextCursor = hasMore && tasks.length > 0 ? tasks[tasks.length - 1].id : null;

    return {
      success: true,
      tasks,
      totalCount,
      hasMore,
      nextCursor
    };
  }

  /**
   * Retrieves all awaiting tasks for review sidebar directly via index.
   */
  public static getAwaitingTaskSummaries(): TaskSummary[] {
    const db = this.getDb();
    const rows: any[] = db.prepare(`
      SELECT id, counter, source, suffix, status, checkpoint, received_at, updated_at,
             quote, niche1, niche2, subniche, image_url, has_error, error_details,
             design_id, in_queue, events_count, client_ip
      FROM tasks
      WHERE status IN (
        'AWAITING_PRE_FLIGHT_REVIEW',
        'AWAITING_DESIGN_REVIEW',
        'AWAITING_TM_REVIEW',
        'AWAITING_SVG_REVIEW'
      )
      ORDER BY counter DESC
    `).all();

    return rows.map(r => this.rowToSummary(r));
  }

  /**
   * Fast query for active update design IDs (used by UpdateBackfillService).
   */
  public static getActiveUpdateDesignIds(): Set<string> {
    const db = this.getDb();
    const rows: any[] = db.prepare(`
      SELECT id, design_id
      FROM tasks
      WHERE (source = 'UPDATE' OR suffix = 'U')
        AND status NOT IN ('REJECTED', 'CANCELLED', 'ERROR')
        AND has_error = 0
    `).all();

    const ids = new Set<string>();
    for (const r of rows) {
      if (r.design_id) ids.add(r.design_id.trim());
      if (r.id) {
        const clean = r.id.replace(/^#/, '').replace(/-U$/, '').trim();
        ids.add(clean);
      }
    }
    return ids;
  }

  /**
   * Fast query for active update tasks in review (used by UpdateBackfillService.getActiveUpdateCount).
   */
  public static getActiveReviewUpdateTasks(): Array<{ id: string; designId?: string }> {
    const db = this.getDb();
    const rows: any[] = db.prepare(`
      SELECT id, design_id
      FROM tasks
      WHERE (source = 'UPDATE' OR suffix = 'U')
        AND status IN ('AWAITING_DESIGN_REVIEW', 'UPDATE_ANALYZED', 'AWAITING_TM_REVIEW')
        AND has_error = 0
    `).all();

    return rows.map(r => ({
      id: r.id,
      designId: r.design_id || undefined
    }));
  }

  /**
   * Fast cancellation of matching update tasks (used by QueueService & UpdateBackfillService).
   */
  public static cancelTasksByTarget(targetTaskId: string, targetDesignId?: string): number {
    const db = this.getDb();
    let query = `
      UPDATE tasks
      SET status = 'CANCELLED', updated_at = ?
      WHERE (id = ? OR id = ?)
        AND status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')
    `;
    const params: any[] = [new Date().toISOString(), targetTaskId, `#${targetTaskId}`];

    if (targetDesignId) {
      query = `
        UPDATE tasks
        SET status = 'CANCELLED', updated_at = ?
        WHERE (id = ? OR id = ? OR design_id = ?)
          AND status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')
      `;
      params.push(targetDesignId);
    }

    const info = db.prepare(query).run(...params);
    return Number(info.changes);
  }

  /**
   * Cancels all hanging/stale update tasks (used by UpdateBackfillService.resetInFlightLocks).
   */
  public static cancelActiveUpdateTasks(): number {
    const db = this.getDb();
    const info = db.prepare(`
      UPDATE tasks
      SET status = 'CANCELLED', updated_at = ?
      WHERE (source = 'UPDATE' OR suffix = 'U')
        AND status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')
    `).run(new Date().toISOString());

    return Number(info.changes);
  }

  /**
   * Direct aggregated query for CostTracking metrics (avoids parsing thousands of JSON payloads).
   */
  public static getTaskUsageMetrics(resetTimestamp: number): TaskUsageMetrics {
    const db = this.getDb();
    const isoThreshold = resetTimestamp > 0 ? new Date(resetTimestamp).toISOString() : '1970-01-01T00:00:00.000Z';

    const row: any = db.prepare(`
      SELECT
        COALESCE(SUM(image_generations_count), 0) as imageGenerationsCount,
        COALESCE(SUM(vectorizations_count), 0) as vectorizationsCount,
        COALESCE(SUM(openrouter_cost_usd), 0.0) as taskEventOpenRouterCost
      FROM tasks
      WHERE received_at >= ?
    `).get(isoThreshold);

    return {
      imageGenerationsCount: Number(row.imageGenerationsCount) || 0,
      vectorizationsCount: Number(row.vectorizationsCount) || 0,
      taskEventOpenRouterCost: Number(row.taskEventOpenRouterCost) || 0
    };
  }

  /**
   * Deletes a single task row.
   */
  public static deleteTask(taskId: string): boolean {
    const db = this.getDb();
    const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    return Number(info.changes) > 0;
  }

  /**
   * Clears all tasks (for test suites or manual log clearing).
   */
  public static clearAllTasks(): void {
    const db = this.getDb();
    db.exec('DELETE FROM tasks;');
  }

  /**
   * Returns total task count in SQLite.
   */
  public static getTotalTaskCount(): number {
    const db = this.getDb();
    const row: any = db.prepare('SELECT COUNT(*) as count FROM tasks').get();
    return row ? Number(row.count) : 0;
  }
}

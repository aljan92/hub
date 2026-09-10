import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Version the interpretation, not just the physical schema. Old confirmations cannot
// prove that a new mapper has applied all of its fields.
const VERSION = 'products-v1';
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_FIELDS = ['designId', 'listingId', 'marketplace', 'marketplaceId', 'productType', 'asin', 'status', 'listPrice', 'currencyCode', 'productTitle', 'brandName', 'searchableOnRetail', 'deleteReasonType', 'lockReasonType', 'createdDate', 'updatedDate', 'estimatedExpirationDate', 'productImageUrn'];
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const digest = (value: any) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function syncScope(url: string, account: string): string {
  if (!account?.trim()) throw new Error('Amazon-Konto nicht verifiziert; kein bestätigter Sync möglich.');
  return digest([VERSION, new URL(url.trim()).origin, 'mba_designs', account.trim()]);
}
export function sourceRow(row: any): any {
  return Object.fromEntries(SOURCE_FIELDS.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}
export function listingKey(row: any): string {
  // AMAZON_FIND_LISTINGS_API.md documents listingId as design/type/market.
  // ASIN is mutable payload, never part of the identity. Conflicting duplicates fail closed.
  // Missing listingId is deliberately never eligible for skipping.
  return digest([row.designId, row.listingId, row.marketplace || row.marketplaceId, row.productType]);
}
export function groupListings(rows: any[]): Map<string, any[]> {
  const groups = new Map<string, Map<string, any>>();
  for (const input of rows) {
    if (!input.designId) throw new Error('FindListings enthält einen Eintrag ohne Design-ID.');
    const row = sourceRow(input);
    const group = groups.get(row.designId) || new Map();
    const key = listingKey(row);
    if (group.has(key) && digest(group.get(key)) !== digest(row)) {
      throw new Error(`Widersprüchliche Listingstände für Design ${row.designId}; erneut vollständig abrufen.`);
    }
    group.set(key, row);
    groups.set(row.designId, group);
  }
  return new Map([...groups].map(([id, values]) => [id, [...values.values()]]));
}

/** Separate SQLite file keeps sync migrations and cache resets away from task storage.
 * Pending work and confirmations are committed together, with WAL/FULL durability. */
export class SyncStateRepository {
  private db: DatabaseSync;
  constructor(filename = path.resolve(process.cwd(), 'data', 'sync_state.sqlite')) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_scopes (scope TEXT PRIMARY KEY, watermark TEXT, full_at INTEGER);
      CREATE TABLE IF NOT EXISTS sync_listings (scope TEXT, identity TEXT, fingerprint TEXT NOT NULL, PRIMARY KEY(scope, identity));
      CREATE TABLE IF NOT EXISTS sync_jobs (scope TEXT, design TEXT, products TEXT, texts INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope, design));
      CREATE TABLE IF NOT EXISTS sync_metrics (family TEXT PRIMARY KEY, calls INTEGER NOT NULL, bytes INTEGER NOT NULL, rows INTEGER NOT NULL, errors INTEGER NOT NULL);
    `);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  state(scope: string): { watermark: string | null; full_at: number | null } {
    return (this.db.prepare('SELECT watermark, full_at FROM sync_scopes WHERE scope=?').get(scope) as any) || { watermark: null, full_at: null };
  }
  checkpoint(scope: string, watermark: string, full = false) {
    this.db.prepare(`INSERT INTO sync_scopes(scope,watermark,full_at) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET
      watermark=excluded.watermark, full_at=COALESCE(excluded.full_at,sync_scopes.full_at)`).run(scope, watermark, full ? Date.now() : null);
  }
  invalidate() {
    this.transaction(() => {
      this.db.exec('DELETE FROM sync_listings; DELETE FROM sync_scopes;');
      // Keep pending jobs: cache invalidation must not discard unconfirmed work.
    });
  }
  stage(scope: string, rows: any[], skip: boolean): { jobs: Map<string, any[]>; unchanged: number } {
    const groups = groupListings(rows);
    let unchanged = 0;
    this.transaction(() => {
      for (const [design, incoming] of groups) {
        const pending = this.db.prepare('SELECT products FROM sync_jobs WHERE scope=? AND design=?').get(scope, design) as any;
        const identical = incoming.every(row => !!row.listingId &&
          (this.db.prepare('SELECT fingerprint FROM sync_listings WHERE scope=? AND identity=?').get(scope, listingKey(row)) as any)?.fingerprint === digest(row));
        if (identical && !pending?.products) unchanged++;
        if (skip && identical && !pending?.products) continue;
        const union = new Map<string, any>((pending?.products ? JSON.parse(pending.products) : []).map((r: any) => [listingKey(r), r]));
        incoming.forEach(row => union.set(listingKey(row), row));
        this.db.prepare(`INSERT INTO sync_jobs(scope,design,products) VALUES(?,?,?) ON CONFLICT(scope,design) DO UPDATE SET products=excluded.products`).run(scope, design, JSON.stringify([...union.values()]));
      }
    });
    const pending = this.db.prepare('SELECT design, products FROM sync_jobs WHERE scope=? AND products IS NOT NULL ORDER BY rowid').all(scope) as any[];
    return { jobs: new Map(pending.map(job => [job.design, JSON.parse(job.products)])), unchanged };
  }
  confirm(scope: string, rows: any[], forceTexts = false) {
    this.transaction(() => {
      for (const [design, listings] of groupListings(rows)) {
        const changed = forceTexts || listings.some(row =>
          (this.db.prepare('SELECT fingerprint FROM sync_listings WHERE scope=? AND identity=?').get(scope, listingKey(row)) as any)?.fingerprint !== digest(row));
        for (const row of listings) this.db.prepare(`INSERT INTO sync_listings VALUES(?,?,?) ON CONFLICT(scope,identity) DO UPDATE SET fingerprint=excluded.fingerprint`).run(scope, listingKey(row), digest(row));
        this.db.prepare(`UPDATE sync_jobs SET products=NULL, texts=MAX(texts,?),
          attempts=CASE WHEN ? THEN 0 ELSE attempts END, next_at=CASE WHEN ? THEN 0 ELSE next_at END
          WHERE scope=? AND design=?`).run(changed ? 1 : 0, changed ? 1 : 0, changed ? 1 : 0, scope, design);
        this.db.prepare('DELETE FROM sync_jobs WHERE scope=? AND design=? AND texts=0 AND products IS NULL').run(scope, design);
      }
    });
  }
  textJobs(scope: string, limit = 25): string[] {
    return (this.db.prepare('SELECT design FROM sync_jobs WHERE scope=? AND texts=1 AND products IS NULL AND next_at<=? ORDER BY next_at,rowid LIMIT ?').all(scope, Date.now(), limit) as any[]).map(row => row.design);
  }
  textDone(scope: string, design: string) {
    this.db.prepare('DELETE FROM sync_jobs WHERE scope=? AND design=? AND products IS NULL').run(scope, design);
  }
  textFailed(scope: string, design: string) {
    this.db.prepare(`UPDATE sync_jobs SET attempts=attempts+1, next_at=? + MIN(86400000,300000 * (1 << MIN(attempts,8))) WHERE scope=? AND design=?`).run(Date.now(), scope, design);
  }
  pending(scope: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM sync_jobs WHERE scope=?').get(scope) as any).n);
  }
  metric(family: string, data: any, error?: unknown) {
    const bytes = Buffer.byteLength(JSON.stringify(data ?? null));
    this.db.prepare(`INSERT INTO sync_metrics VALUES(?,1,?,?,?) ON CONFLICT(family) DO UPDATE SET calls=calls+1, bytes=bytes+excluded.bytes, rows=rows+excluded.rows, errors=errors+excluded.errors`).run(family, bytes, Array.isArray(data) ? data.length : 0, error ? 1 : 0);
  }
  metrics() { return this.db.prepare('SELECT * FROM sync_metrics ORDER BY family').all(); }
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SyncStateRepository, syncScope, WEEK_MS } from '../storage/syncStateRepository';
import { SupabaseService } from './supabaseService';
import { getSupabaseClient, loadSettings, saveSettings } from './settingsService';
import { BrowserSessionService } from './browserSessionService';
import { atomicWriteJson, loadJsonWithBackupRecovery } from '../utils/atomicFileStorage';
import { AmazonRetailIdentityService } from './amazonRetailIdentityService';
import {
  getChildAsinPolicy,
  isConfirmedChildAsin,
  isChildAsinRequirementSatisfied,
  isLegacyChildAsinWriteEnabled,
  isNewChildAsinShadowType,
  normalizeChildAsinProductType
} from './childAsinPolicyService';

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  text: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface SyncState {
  isScanning: boolean;
  activeScanType: string | null;
  scanStatus: 'ready' | 'scanning' | 'error';
  lastStatusMessage: string;
  autoUpdateEnabled: boolean;
  lastPeriodicSync: string | null;
  lastPeriodicSyncCount: number;
  lastQuickDesigns: number | null;
  lastFullDesigns: number | null;
  lastQuickListings: number | null;
  lastFullListings: number | null;
  lastQuickSales: number | null;
  lastFullSalesAll: number | null;
  lastAsinSync: string | null;
  liveDesignsCount: number;
  unresolvedAsinsCount: number;
  childAsinShadow?: { lastRunAt: string | null; checked: number; resolved: number; unresolved: number; lastResult: string | null };
  childAsinDiagnostics?: ChildAsinDiagnostics;
  childAsinValidation?: { observed: number; resolved: number; confirmedTwice: number; statuses: Array<{ status: string; count: number }> };
  lifecycleAudit?: LifecycleAuditSummary;
  egress?: { mode: 'observe' | 'optimized'; baselineReady: boolean; pending: number; metrics: any[] };
  lastRun?: ProductSyncRuntime['lastRun'];
}

export interface LifecycleAuditSummary {
  lastRunAt: string;
  amazonListings: number;
  amazonDesigns: number;
  databaseDesigns: number;
  deletedAtAmazonDesigns: number;
  missingFromAmazonDesigns: number;
  stalePublishedProducts: number;
  staleAdAsins: number;
  missingDatabaseProducts: number;
  reportPath: string;
  complete: boolean;
}

export interface ChildAsinDiagnostics {
  lastRunAt: string;
  unresolvedDesigns: number;
  unresolvedEntries: number;
  retryWaiting: number;
  readyNow: number;
  staleStatusDesigns: number;
  truncated: boolean;
  reasons: Array<{ reason: string; count: number }>;
  groups: Array<{ type: string; market: string; count: number }>;
}

const MARKETPLACE_IDS = {
  us: 'ATVPDKIKX0DER',
  de: 'A1PA6795UKMFR9',
  gb: 'A1F83G8C2ARO7P',
  fr: 'A13V1IB3VIYZZH',
  it: 'APJ6JRA9NG5V4',
  es: 'A1RKKUPIHCS9HS',
  jp: 'A1VC38T7YXB528'
};

const MP_MAP: Record<string, string> = {
  ATVPDKIKX0DER: 'us',
  A1PA6795UKMFR9: 'de',
  A1F83G8C2ARO7P: 'gb',
  A13V1IB3VIYZZH: 'fr',
  APJ6JRA9NG5V4: 'it',
  A1RKKUPIHCS9HS: 'es',
  A1VC38T7YXB528: 'jp'
};

const ALL_STATUSES = ['DRAFT', 'TRANSLATING', 'REVIEW', 'DECLINED', 'AMAZON_REJECTED', 'PUBLISHING', 'TIMED_OUT', 'PROPAGATED', 'PUBLISHED', 'DELETED', 'LOCKED'];
const FIND_LISTINGS_URL = 'https://merch.amazon.com/api/ng-amazon/coral/com.amazon.merch.search.MerchSearchService/FindListings';
const PRODUCT_CONFIG_URL = 'https://merch.amazon.com/api/productconfiguration/get?id=';
const PRODUCT_SYNC_COLUMNS = new Set([
  'design_id', 'listing_id', 'product_image_urn', 'asins', 'asin_standard_tshirt_us',
  'price_standard_tshirt_us', 'created_date', 'updated_date', 'estimated_expiration_date',
  'products_live_us', 'products_live_de', 'products_live_gb', 'products_live_fr',
  'products_live_it', 'products_live_es', 'products_live_jp', 'published_products',
  'ad_asins', 'asin_resolved', 'status', 'last_synced_at'
]);
type ProductSyncRuntime = {
  version: 1;
  productWatermark: string | null;
  accountKey?: string;
  textVersions?: Record<string, string>;
  resolverRetries?: Record<string, { attempts: number; nextAt: string; parentAsin: string; lastError: string }>;
  resolverShadow?: { lastRunAt: string | null; checked: number; resolved: number; unresolved: number; lastResult: string | null; cursor?: number; blockedUntil?: string | null };
  resolverDiagnostics?: ChildAsinDiagnostics;
  lifecycleAudit?: LifecycleAuditSummary;
  resolverObservations?: Record<string, { parentAsin: string; resolvedAsin: string | null; status: string; source: string | null; observedAt: string; consistentCount: number }>;
  lastRun?: { runId: string; type: string; status: 'running' | 'complete' | 'partial' | 'truncated' | 'cancelled' | 'unknown_write_outcome' | 'error'; startedAt: string; finishedAt?: string; pages: number; attempted: number; confirmed: number; message?: string };
};
const SYNC_RUNTIME_PATH = path.resolve(process.cwd(), 'data', 'sync_runtime.json');
const FULL_STAGE_PATH = path.resolve(process.cwd(), 'data', 'sync_full_stage.json');
const LIFECYCLE_AUDIT_PATH = path.resolve(process.cwd(), 'data', 'sync_lifecycle_audit.json');

export class SyncEngine {
  private static logs: SyncLogEntry[] = [];
  private static state: SyncState = {
    isScanning: false,
    activeScanType: null,
    scanStatus: 'ready',
    lastStatusMessage: 'Bereit',
    autoUpdateEnabled: false,
    lastPeriodicSync: null,
    lastPeriodicSyncCount: 0,
    lastQuickDesigns: null,
    lastFullDesigns: null,
    lastQuickListings: null,
    lastFullListings: null,
    lastQuickSales: null,
    lastFullSalesAll: null,
    lastAsinSync: null,
    liveDesignsCount: 0,
    unresolvedAsinsCount: 0,
    childAsinShadow: { lastRunAt: null, checked: 0, resolved: 0, unresolved: 0, lastResult: null },
  };

  private static shouldStop = false;
  private static autoUpdateTimer: NodeJS.Timeout | null = null;
  private static asinResolveTimer: NodeJS.Timeout | null = null;
  private static textCatchupTimer: NodeJS.Timeout | null = null;
  private static activeWorker: string | null = null;

  private static syncStore: SyncStateRepository | null = null;
  private static currentScope: string | null = null;
  private static countsFetchedAt = 0;
  private static countsInFlight: Promise<void> | null = null;
  private static weeklyAttemptAt = 0;

  private static productScope(accountId: string) { return syncScope(loadSettings().supabaseUrl, accountId); }
  private static optimized() { return loadSettings().syncEgressMode === 'optimized'; }

  private static store() {
    return this.syncStore ||= new SyncStateRepository();
  }

  public static setEgressMode(mode: 'observe' | 'optimized') {
    if (this.state.isScanning || this.activeWorker) throw new Error('Bitte den laufenden Sync zuerst beenden.');
    saveSettings({ syncEgressMode: mode });
    this.addLog(mode === 'optimized' ? 'Änderungsvergleich aktiviert; Überspringen erst nach vollständigem Abgleich.' : 'Beobachtungsmodus: Produktdaten werden konservativ abgeglichen.');
  }

  public static invalidateSyncCache() {
    if (this.state.isScanning || this.activeWorker) throw new Error('Bitte den laufenden Sync zuerst beenden.');
    this.store().invalidate();
    this.addLog('Bestätigter Vergleichsstand zurückgesetzt. Offene Arbeit bleibt erhalten; Full Refresh erforderlich.', 'warn');
  }

  private static recordTraffic(family: string, result: any) {
    try { this.store().metric(family, result?.data, result?.error); } catch { /* Metrics must not hide a confirmed write. */ }
  }

  private static async applyProductChanges(page: any, accountId: string, rows: any[], force: boolean) {
    const scope = this.productScope(accountId);
    this.currentScope = scope;
    const store = this.store();
    const baseline = store.state(scope).full_at;
    const skip = !force && !!baseline && this.optimized();
    // Validate before staging: unrecognized identities must never become confirmations.
    for (const row of rows) {
      const market = typeof row.marketplace === 'string' ? row.marketplace.toLowerCase() : MP_MAP[row.marketplaceId];
      const updated = typeof row.updatedDate === 'number' ? new Date(row.updatedDate * 1000) : new Date(row.updatedDate);
      if (!row.updatedDate || !Number.isFinite(updated.getTime())) throw new Error('FindListings enthält ein ungültiges Änderungsdatum; keine Fortschrittsbestätigung.');
      if (!row.designId || !market || !Object.values(MP_MAP).includes(market) || !String(row.productType || '').trim()) {
        throw new Error('FindListings enthält eine unbekannte Design-/Markt-/Produktidentität; keine Fortschrittsbestätigung.');
      }
    }
    const { jobs, unchanged } = store.stage(scope, rows, skip);
    const mapped = this.mapListingsToSupabase([...jobs.values()].flat());
    const count = await this.mergeAndUpsertDesigns(mapped, ids => {
      store.confirm(scope, ids.flatMap(id => jobs.get(id) || []), force);
      this.countsFetchedAt = 0; SupabaseService.invalidateStats();
    });
    const { processed, errors } = await this.drainTextJobs(page, scope);
    if (count || processed) { this.countsFetchedAt = 0; SupabaseService.invalidateStats(); }
    this.addLog(`[Änderungsvergleich] ${skip ? unchanged : 0} unverändert übersprungen (${unchanged} identisch), ${count} Produkte bestätigt, ${processed} Texte bestätigt, ${store.pending(scope)} Aufgaben offen (${skip ? 'optimiert' : 'vollständiger Abgleich'}).`);
    return { scope, count, attempted: mapped.length, errors };
  }

  private static async drainTextJobs(page: any, scope: string) {
    const store = this.store();
    let processed = 0;
    let errors = 0;
    // Bounded independent text queue; failures survive product checkpoint advancement.
    for (const designId of store.textJobs(scope)) {
      if (this.shouldStop) break;
      try {
        const payload = this.parseTextData(designId, await this.fetchProductConfig(page, designId));
        if (!payload) throw new Error('ProductConfig enthält keine Textdaten.');
        const result = await this.getSupabase().from('mba_designs').upsert(payload, { onConflict: 'design_id' });
        this.recordTraffic('text_write', result);
        if (result.error) throw new Error(result.error.message);
        store.textDone(scope, designId);
        processed++;
      } catch (error: any) {
        store.textFailed(scope, designId);
        errors++;
        this.addLog(`[Textfolgejob] ${designId} bleibt offen: ${error.message}`, 'warn');
      }
    }
    if (processed) SupabaseService.invalidateStats();
    return { processed, errors };
  }

  public static async runQueuedTexts() {
    const runId = this.beginWorker('queued_texts');
    this.state.isScanning = true;
    this.state.activeScanType = 'queued_texts';
    this.shouldStop = false;
    try {
      const page = await this.getAmazonPage();
      const scope = this.productScope(await this.getAccountId(page));
      const result = await this.drainTextJobs(page, scope);
      this.finishWorker(runId, this.shouldStop ? 'cancelled' : result.errors ? 'partial' : 'complete', { confirmed: result.processed });
    } catch (error: any) {
      this.finishWorker(runId, 'error', { message: error.message });
      throw error;
    } finally { this.state.isScanning = false; this.state.activeScanType = null; }
  }

  private static loadRuntime(): ProductSyncRuntime {
    const loaded = loadJsonWithBackupRecovery<ProductSyncRuntime>(SYNC_RUNTIME_PATH, {
      defaultValue: { version: 1, productWatermark: null },
      validate: value => value?.version === 1 && (value.productWatermark === null || typeof value.productWatermark === 'string')
    });
    if (!loaded.success) throw new Error(`Sync-Laufstatus ist beschädigt: ${loaded.error}`);
    return loaded.data;
  }

  private static saveRuntime(runtime: ProductSyncRuntime) {
    atomicWriteJson(SYNC_RUNTIME_PATH, runtime, { backup: true, space: 2 });
  }

  private static beginWorker(type: string): string {
    if (this.activeWorker || this.state.isScanning) throw new Error(`Ein Sync-Worker läuft bereits (${this.activeWorker || this.state.activeScanType || 'Scan'}).`);
    const runId = crypto.randomUUID();
    const runtime = this.loadRuntime();
    runtime.lastRun = { runId, type, status: 'running', startedAt: new Date().toISOString(), pages: 0, attempted: 0, confirmed: 0 };
    this.saveRuntime(runtime);
    this.activeWorker = type;
    return runId;
  }

  private static finishWorker(runId: string, status: NonNullable<ProductSyncRuntime['lastRun']>['status'], details: Partial<NonNullable<ProductSyncRuntime['lastRun']>> = {}) {
    const runtime = this.loadRuntime();
    if (runtime.lastRun?.runId === runId) runtime.lastRun = { ...runtime.lastRun, ...details, status, finishedAt: new Date().toISOString() };
    this.saveRuntime(runtime);
    this.activeWorker = null;
  }

  public static getLogs(): SyncLogEntry[] {
    return this.logs;
  }

  public static clearLogs() {
    this.logs = [];
  }

  public static addLog(text: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const entry: SyncLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      text,
      type,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) {
      this.logs.pop();
    }
  }

  public static getState(): SyncState {
    try {
      const runtime = this.loadRuntime();
      return { ...this.state, childAsinShadow: runtime.resolverShadow || this.state.childAsinShadow, childAsinDiagnostics: runtime.resolverDiagnostics || this.state.childAsinDiagnostics, childAsinValidation: this.buildResolverValidation(runtime.resolverObservations || {}), lifecycleAudit: runtime.lifecycleAudit || this.state.lifecycleAudit, lastRun: runtime.lastRun, egress: {
      mode: loadSettings().syncEgressMode || 'observe',
      baselineReady: !!this.currentScope && !!this.store().state(this.currentScope).full_at,
      pending: this.currentScope ? this.store().pending(this.currentScope) : 0,
      metrics: this.store().metrics()
    } }; }
    catch { return { ...this.state }; }
  }

  public static updateCounts(live: number, unresolved: number) {
    this.state.liveDesignsCount = live;
    this.state.unresolvedAsinsCount = unresolved;
  }

  public static buildResolverValidation(observations: NonNullable<ProductSyncRuntime['resolverObservations']>) {
    const statuses = new Map<string, number>();
    let resolved = 0;
    let confirmedTwice = 0;
    for (const observation of Object.values(observations || {})) {
      statuses.set(observation.status, (statuses.get(observation.status) || 0) + 1);
      if (observation.status === 'resolved' && observation.resolvedAsin) resolved++;
      if (observation.status === 'resolved' && observation.resolvedAsin && observation.consistentCount >= 2) confirmedTwice++;
    }
    return {
      observed: Object.keys(observations || {}).length,
      resolved,
      confirmedTwice,
      statuses: [...statuses.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count }))
    };
  }

  public static stopScan() {
    this.shouldStop = true;
    this.state.lastStatusMessage = 'Abbruch angefordert; laufender Request wird sicher beendet.';
    this.addLog('Scan manuell abgebrochen.', 'warn');
  }

  public static init() {
    const settings = loadSettings();
    const enabled = settings.autoSyncEnabled !== undefined ? settings.autoSyncEnabled : true;
    this.state.autoUpdateEnabled = enabled;
    if (enabled) {
      this.addLog('[Auto-Update] Hintergrund-Scheduler aktiv (alle 15 Min).', 'info');
      this.startSchedulers();
    }
  }

  public static toggleAutoUpdate(enabled: boolean) {
    this.state.autoUpdateEnabled = enabled;
    saveSettings({ autoSyncEnabled: enabled });
    if (enabled) {
      this.addLog('[Auto-Update] Hintergrund-Scheduler aktiviert (alle 15 Min).', 'success');
      this.startSchedulers();
    } else {
      this.addLog('[Auto-Update] Hintergrund-Scheduler deaktiviert.', 'info');
      this.stopSchedulers();
    }
  }

  private static startSchedulers() {
    this.stopSchedulers();
    // Periodic Smart Sync (every 15 min)
    this.autoUpdateTimer = setInterval(async () => {
      if (this.state.autoUpdateEnabled && !this.state.isScanning) {
        try {
          await this.runSmartSync();
          const fullAt = this.currentScope ? this.store().state(this.currentScope).full_at : null;
          if (fullAt && Date.now() - fullAt >= WEEK_MS && Date.now() - this.weeklyAttemptAt >= 6 * 60 * 60 * 1000) {
            this.weeklyAttemptAt = Date.now();
            this.addLog('Wöchentlicher Kontrollabgleich fällig; prüfe alle Produkte unabhängig vom Cache.');
            await this.runFullReload();
          }
        } catch (e: any) {
          this.addLog(`[Auto-Update] Fehler: ${e.message}`, 'error');
        }
      }
    }, 15 * 60 * 1000);

    // ASIN Resolver background queue (every 1 min)
    this.asinResolveTimer = setInterval(async () => {
      if (this.state.autoUpdateEnabled && !this.state.isScanning) {
        try {
          await this.resolveChildAsinsBatch(5);
          await this.runChildAsinShadowBatch(1);
        } catch (e) {}
      }
    }, 60 * 1000);

    this.textCatchupTimer = setInterval(async () => {
      if (this.state.autoUpdateEnabled && !this.state.isScanning) {
        try { await this.runQueuedTexts(); } catch (e: any) { this.addLog(`[Text-Catch-up] Fehler: ${e.message}`, 'error'); }
      }
    }, 5 * 60 * 1000);
  }

  private static stopSchedulers() {
    if (this.autoUpdateTimer) clearInterval(this.autoUpdateTimer);
    if (this.asinResolveTimer) clearInterval(this.asinResolveTimer);
    if (this.textCatchupTimer) clearInterval(this.textCatchupTimer);
    this.autoUpdateTimer = null;
    this.asinResolveTimer = null;
    this.textCatchupTimer = null;
  }

  private static sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static cachedAccountId: string | null = null;

  /**
   * Helper to query Supabase safely
   */
  private static getSupabase() {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase ist nicht konfiguriert (URL/Key fehlt).');
    return supabase;
  }

  /**
   * Helper to get active Amazon authenticated page from Session 1
   */
  private static async getAmazonPage() {
    const session = await BrowserSessionService.getSession('sync');
    if (!session || session.page.isClosed()) {
      throw new Error('Session 1 (Sync & Login) ist nicht aktiv.');
    }

    let currentUrl = session.page.url();
    // If on about:blank or not on amazon, navigate to dashboard
    if (currentUrl === 'about:blank' || !currentUrl.includes('amazon.com')) {
      this.addLog('[Session 1] Navigiere zu Amazon Dashboard...', 'info');
      await session.page.goto('https://merch.amazon.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      currentUrl = session.page.url();
    }

    if (!currentUrl.includes('amazon.com')) {
      throw new Error(`Session 1 ist nicht auf Amazon eingeloggt (Aktuelle Seite: ${currentUrl}). Bitte erst in Session 1 einloggen.`);
    }
    return session.page;
  }

  /**
   * Discover and cache Amazon Account-ID / ContentOwnerId
   */
  public static async getAccountId(page: any): Promise<string> {
    // Re-verify each run: the browser may have switched Amazon accounts.

    // 1. Try extracting from cookies/DOM
    const extracted = await page.evaluate(() => {
      const mCookie = document.cookie.match(/(?:accountId|contentOwnerId)=([A-Z0-9]+)/i);
      if (mCookie) return mCookie[1];
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText).join(' ');
      const m = scripts.match(/["'](?:accountId|contentOwnerId|ContentOwnerId)["']\s*:\s*["']([A-Z0-9]+)["']/i);
      if (m) return m[1];
      return null;
    });

    if (extracted) {
      this.cachedAccountId = extracted;
      this.addLog(`[Session 1] Amazon Account-ID erkannt: ${extracted} ✓`, 'info');
      return extracted;
    }

    // 2. Navigate to manage/products and capture accountId from Angular's network request
    this.addLog('[Session 1] Ermittle Amazon Account-ID über Manage-Seite...', 'info');
    let capturedId: string | null = null;
    const requestHandler = (req: any) => {
      if (req.url().includes('FindListings')) {
        try {
          const json = req.postDataJSON();
          if (json?.accountId) {
            capturedId = json.accountId;
          }
        } catch {}
      }
    };

    page.on('request', requestHandler);
    try {
      await page.goto('https://merch.amazon.com/manage/products', { waitUntil: 'domcontentloaded', timeout: 30000 });
      let waitTime = 0;
      while (!capturedId && waitTime < 6000) {
        await this.sleep(200);
        waitTime += 200;
      }
    } finally {
      page.off('request', requestHandler);
    }

    if (capturedId) {
      this.cachedAccountId = capturedId;
      this.addLog(`[Session 1] Amazon Account-ID erkannt: ${capturedId} ✓`, 'success');
      return capturedId;
    }

    return '';
  }

  /**
   * Execute in-browser FindListings query using Session 1 authentication cookies and Coral Request format with 429 retry backoff
   */
  private static async fetchListingsPage(page: any, accountId: string, pageToken: any[] = [], statuses: string[] = ALL_STATUSES) {
    return await page.evaluate(async ({ accountId, pageToken, statuses, url }) => {
      const body = {
        pageSize: 500,
        sortField: 'DateUpdated',
        sortOrder: 'Descending',
        status: statuses,
        marketplaces: null,
        productTypes: null,
        searchableOnRetail: null,
        deleteReasonType: ['', 'CONTENT_POLICY_VIOLATION', 'INACTIVE_NO_SALES', 'CONTENT_CREATOR'],
        accountId: accountId || null,
        pageToken: pageToken || [],
        __type: 'com.amazon.merch.search#FindListingsRequest'
      };

      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      let retries = 0;
      let backoff = 1500;

      while (retries < 10) {
        let resp: Response;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          try {
            resp = await fetch(url, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include', signal: controller.signal });
          } finally { clearTimeout(timeout); }
        } catch (error) {
          if (retries >= 9) throw error;
          await sleep(backoff + Math.floor(Math.random() * 500));
          backoff = Math.min(backoff * 1.5, 8000);
          retries++;
          continue;
        }

        if (resp.ok) {
          const data = await resp.json();
          if (!data || !Array.isArray(data.results) || (data.pageToken != null && !Array.isArray(data.pageToken))) throw new Error('FindListings lieferte ein ungültiges Antwortschema.');
          return data;
        }

        if ([408, 429, 500, 502, 503, 504].includes(resp.status) || resp.url?.includes('merch.amazon.com/429')) {
          console.log(`[FindListings] Temporärer HTTP ${resp.status}, warte ${backoff}ms (Versuch ${retries + 1}/10)...`);
          const retryAfter = Number(resp.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : backoff + Math.floor(Math.random() * 500));
          backoff = Math.min(backoff * 1.5, 8000);
          retries++;
          continue;
        }

        if (resp.url?.includes('signin') || resp.status === 404) throw new Error('LoggedOut');
        const errText = await resp.text().catch(() => '');
        throw new Error(`FindListings HTTP ${resp.status}: ${errText || resp.statusText}`);
      }

      throw new Error('FindListings: Rate limit retries exceeded');
    }, { accountId, pageToken, statuses, url: FIND_LISTINGS_URL });
  }

  /**
   * Fetch Product Config (titles, bullets, brand) for a specific design
   */
  private static async fetchProductConfig(page: any, designId: string) {
    return await page.evaluate(async ({ url }) => {
      let backoff = 1000;
      for (let attempt = 0; attempt < 5; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include', signal: controller.signal });
          if (res.ok) return await res.json();
          if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw new Error(`ProductConfig HTTP ${res.status}`);
        } catch (error) {
          if (attempt === 4) throw error;
        } finally { clearTimeout(timeout); }
        await new Promise(resolve => setTimeout(resolve, backoff + Math.floor(Math.random() * 300)));
        backoff = Math.min(backoff * 2, 8000);
      }
      throw new Error('ProductConfig retries exceeded');
    }, { url: `${PRODUCT_CONFIG_URL}${designId}` });
  }

  /**
   * Fetch Sales Analytics from Amazon
   */
  private static async fetchSalesAnalytics(page: any, startDate: string, endDate: string) {
    return await page.evaluate(async ({ startDate, endDate }) => {
      try {
        const url = `https://merch.amazon.com/analytics/sales/v1?startDate=${startDate}&endDate=${endDate}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include'
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }, { startDate, endDate });
  }

  public static async inspectSalesContract(): Promise<any> {
    if (this.state.isScanning || this.activeWorker) throw new Error('Ein anderer Sync-Worker läuft bereits.');
    const page = await this.getAmazonPage();
    const accountId = await this.getAccountId(page);
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const marketplaceIds = Object.values(MARKETPLACE_IDS);
    return page.evaluate(async ({ accountId, marketplaceIds, fromDate, toDate }) => {
      const params = new URLSearchParams();
      marketplaceIds.forEach(id => params.append('marketplaceId', id));
      params.set('fromDate', String(fromDate));
      params.set('toDate', String(toDate));
      if (accountId) params.set('accountId', accountId);
      const response = await fetch(`/api/reporting/purchases/report?${params.toString()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      if (!response.ok) return { ok: false, status: response.status, contentType, bodyKind: text.trim().startsWith('<') ? 'html' : 'text', responseBytes: text.length };
      let data: any;
      try { data = JSON.parse(text); } catch { return { ok: false, status: response.status, contentType, bodyKind: 'invalid-json', responseBytes: text.length }; }
      const topLevelKeys = data && typeof data === 'object' ? Object.keys(data) : [];
      const markets = topLevelKeys.map(key => {
        const rows = Array.isArray(data[key]) ? data[key] : [];
        return { key, rows: rows.length, sampleFields: rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).sort() : [] };
      });
      return { ok: true, status: response.status, contentType, responseBytes: text.length, topLevelKeys, markets };
    }, { accountId, marketplaceIds, fromDate: from.setUTCHours(0, 0, 0, 0), toDate: to.setUTCHours(23, 59, 59, 999) });
  }

  /**
   * Fetch live and unresolved counts from Supabase
   */
  public static async refreshDBStats() {
    if (Date.now() - this.countsFetchedAt < 5 * 60 * 1000) return;
    if (this.countsInFlight) return this.countsInFlight;
    this.countsInFlight = (async () => {
      const stats = await SupabaseService.getStats();
      this.updateCounts(stats.liveDesigns, stats.unresolvedAsins);
      this.countsFetchedAt = Date.now();
    })();
    try { await this.countsInFlight; } finally { this.countsInFlight = null; }
  }

  /**
   * Map Amazon FindListings results to Supabase mba_designs schema
   */
  public static mapListingsToSupabase(results: any[]) {
    const designMap = new Map<string, any>();

    for (const r of results) {
      const dId = r.designId;
      if (!dId) continue;
      const mp = r.marketplace?.toLowerCase() || MP_MAP[r.marketplaceId];
      if (!mp || !Object.values(MP_MAP).includes(mp)) {
        this.addLog(`[Produkte] Unbekannter Marktplatz für Design ${dId}; Eintrag wurde sicher ausgelassen.`, 'warn');
        continue;
      }
      const pt = String(r.productType || '').trim().toLowerCase();
      if (!pt) {
        this.addLog(`[Produkte] Fehlender Produkttyp für Design ${dId}; Eintrag wurde sicher ausgelassen.`, 'warn');
        continue;
      }
      if (!designMap.has(dId)) {
        designMap.set(dId, {
          design_id: dId,
          listing_id: r.listingId || null,
          product_image_urn: r.productImageUrn || null,
          asins: [],
          asin_standard_tshirt_us: null,
          price_standard_tshirt_us: null,
          created_date: null,
          updated_date: null,
          estimated_expiration_date: null,
          products_live_us: [], products_live_de: [], products_live_gb: [],
          products_live_fr: [], products_live_it: [], products_live_es: [], products_live_jp: [],
          published_products: [],
          status: null,
          last_synced_at: new Date().toISOString(),
          _deleted_asins: []
        });
      }
      const d = designMap.get(dId);
      if (r.asin && !d.asins.includes(r.asin)) d.asins.push(r.asin);
      const status = r.status || '';
      const LIVE_STATUSES = new Set(['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING', 'published', 'propagated', 'locked', 'timed_out', 'publishing', 'translating']);
      const isLive = status && LIVE_STATUSES.has(status);
      if (isLive && pt) {
        const key = `products_live_${mp}`;
        if (d[key] && !d[key].includes(pt)) d[key].push(pt);
      }
      if (isLive && r.asin) {
        d.published_products.push({ asin: r.asin, type: r.productType || pt.toUpperCase(), market: mp });
      } else if (r.asin) {
        d._deleted_asins.push(r.asin);
      }
      if (isLive && mp === 'us' && (pt === 'standard_tshirt' || pt === 'STANDARD_TSHIRT')) {
        d.asin_standard_tshirt_us = r.asin || d.asin_standard_tshirt_us;
        if (r.listPrice) d.price_standard_tshirt_us = r.listPrice;
      }
      const safeDate = (v: any) => { 
        try { 
          if (!v) return null; 
          const dt = typeof v === 'number' ? new Date(v * 1000) : new Date(v); 
          return isNaN(dt.getTime()) ? null : dt.toISOString(); 
        } catch (e) { return null; } 
      };
      const created = safeDate(r.createdDate);
      const updated = safeDate(r.updatedDate);
      if (created && (!d.created_date || created < d.created_date)) d.created_date = created;
      if (updated && (!d.updated_date || updated > d.updated_date)) d.updated_date = updated;
      if (r.estimatedExpirationDate) d.estimated_expiration_date = safeDate(r.estimatedExpirationDate);

      const STATUS_PRIORITY: Record<string, number> = { PUBLISHED: 100, PROPAGATED: 90, PUBLISHING: 80, REVIEW: 70, TRANSLATING: 60, DRAFT: 50, LOCKED: 40, TIMED_OUT: 30, DECLINED: 20, AMAZON_REJECTED: 15, DELETED: 10 };
      if (status) {
        const upper = status.toUpperCase();
        const newPrio = STATUS_PRIORITY[upper] || 0;
        const oldPrio = STATUS_PRIORITY[d.status] || 0;
        if (newPrio > oldPrio) d.status = upper;
      }
      if (r.productImageUrn) d.product_image_urn = r.productImageUrn;
    }
    return Array.from(designMap.values());
  }

  /**
   * Merge new design data with existing DB records before upserting (Never removes ASINs)
   */
  public static async mergeAndUpsertDesigns(mapped: any[], onConfirmed?: (ids: string[]) => void) {
    const supabase = this.getSupabase();
    if (mapped.length === 0) return 0;

    // Hub-owned lifecycle fields are written only by the confirmed Update
    // pipeline. Amazon sync payloads must never reset or infer them.
    mapped = mapped.map(record => {
      const sanitized = { ...record };
      return Object.fromEntries(Object.entries(sanitized).filter(([key]) => PRODUCT_SYNC_COLUMNS.has(key) || key === '_deleted_asins'));
    });

    const designIds = mapped.map(m => m.design_id);
    const existing = new Map<string, any>();

    for (let i = 0; i < designIds.length; i += 200) {
      const batch = designIds.slice(i, i + 200);
      const { data, error } = await supabase.from('mba_designs')
        .select('design_id, asins, asin_standard_tshirt_us, price_standard_tshirt_us, published_products, ad_asins, asin_resolved')
        .in('design_id', batch);
      this.recordTraffic('product_read', { data, error });
      if (error) throw new Error(`Supabase-Bestandsread fehlgeschlagen: ${error.message || String(error)}`);
      if (data) data.forEach(d => existing.set(d.design_id, d));
    }

    const merged = mapped.map(m => {
      const ex = existing.get(m.design_id);
      if (!ex) {
        const adAsins = this.buildAdAsins(m.published_products, []);
        return {
          ...m,
          ad_asins: adAsins,
          asin_resolved: adAsins.every((ad: any) => !isLegacyChildAsinWriteEnabled(ad.type) || isChildAsinRequirementSatisfied(ad))
        };
      }

      // Merge ASINs (Union)
      const allAsins = Array.from(new Set([...(ex.asins || []), ...(m.asins || [])]));
      
      // Merge published_products
      const productKey = (p: any) => `${String(p.market || '').toLowerCase()}_${String(p.type || '').toUpperCase()}`;
      const prodMap = new Map<string, any>();
      (ex.published_products || []).forEach((p: any) => { if (p?.market && p?.type) prodMap.set(productKey(p), p); });
      (m.published_products || []).forEach((p: any) => { if (p?.market && p?.type) prodMap.set(productKey(p), p); });
      const pubProducts = Array.from(prodMap.values());
      const liveLists: Record<string, string[]> = {};
      for (const market of Object.values(MP_MAP)) liveLists[`products_live_${market}`] = Array.from(new Set(pubProducts.filter((p: any) => p.market === market).map((p: any) => String(p.type).toLowerCase())));
      const standardUs = pubProducts.find((p: any) => p.market === 'us' && String(p.type).toUpperCase() === 'STANDARD_TSHIRT');
      const adAsins = this.buildAdAsins(pubProducts, ex.ad_asins || [], ex.published_products || []);
      const fullyResolved = adAsins.every((ad: any) => !isLegacyChildAsinWriteEnabled(ad.type) || isChildAsinRequirementSatisfied(ad));

      return {
        ...m,
        ...liveLists,
        asins: allAsins,
        published_products: pubProducts,
        asin_standard_tshirt_us: standardUs?.asin || ex.asin_standard_tshirt_us,
        price_standard_tshirt_us: m.price_standard_tshirt_us || ex.price_standard_tshirt_us,
        ad_asins: adAsins,
        asin_resolved: fullyResolved
      };
    });

    const writable = merged.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => PRODUCT_SYNC_COLUMNS.has(key))));
    let confirmed = 0;
    for (let i = 0; i < writable.length; i += 200) {
      if (this.shouldStop) throw new Error('Scan manuell abgebrochen; offene Blöcke bleiben vorgemerkt.');
      const chunk = writable.slice(i, i + 200);
      const result = await supabase.from('mba_designs').upsert(chunk, { onConflict: 'design_id' });
      this.recordTraffic('product_write', result);
      const { error } = result;
      if (error) {
        throw new Error(`Supabase-Upsert fehlgeschlagen (Block ${Math.floor(i / 200) + 1}): ${error.message || String(error)}`);
      }
      onConfirmed?.(chunk.map(record => String(record.design_id)));
      confirmed += chunk.length;
    }

    return confirmed;
  }

  /**
   * Sanitizes raw ASIN string to extract the exact 10-char ASIN (e.g. 'MC_Assembly_1#B0FDKRXX21' -> 'B0FDKRXX21')
   */
  public static sanitizeAsin(val: any): string | null {
    if (!val || typeof val !== 'string') return null;
    const clean = val.trim();
    // 1. Look for standard B0XXXXXXXX (10 chars)
    const b0Match = clean.match(/(B0[A-Z0-9]{8})/i);
    if (b0Match) return b0Match[1].toUpperCase();
    // 2. Look for any 10-char alphanumeric ASIN
    const genMatch = clean.match(/([A-Z0-9]{10})/);
    if (genMatch) return genMatch[1].toUpperCase();
    return clean;
  }

  /**
   * Resolve only an unambiguous child ASIN. Selected/default variation markers
   * are stronger evidence than a variation map; generic page ASINs are ignored.
   */
  public static extractVerifiedChildAsin(html: string, parentAsin: string): string | null {
    const parent = this.sanitizeAsin(parentAsin);
    const uniqueChildren = (values: any[]) => Array.from(new Set(values
      .map(value => this.sanitizeAsin(value))
      .filter((value): value is string => !!value && value !== parent)));

    const direct = uniqueChildren([
      ...Array.from(html.matchAll(/"selectedVariationASIN"\s*:\s*"([A-Z0-9]{10})"/g), match => match[1]),
      ...Array.from(html.matchAll(/data-defaultAsin="([A-Z0-9]{10})"/g), match => match[1])
    ]);
    if (direct.length === 1) return direct[0];
    if (direct.length > 1) return null;

    const mapped: any[] = [];
    for (const match of html.matchAll(/"dimensionToAsinMap"\s*:\s*({[^}]+})/g)) {
      try { mapped.push(...Object.values(JSON.parse(match[1]))); } catch {}
    }
    for (const match of html.matchAll(/"asinToDimension"\s*:\s*({[^}]+})/g)) {
      try { mapped.push(...Object.keys(JSON.parse(match[1]))); } catch {}
    }
    const candidates = uniqueChildren(mapped);
    return candidates.length === 1 ? candidates[0] : null;
  }

  public static buildAdAsins(publishedProducts: any[], existingAdAsins: any[] = [], existingProducts: any[] = []) {
    const existingMap = new Map();
    existingAdAsins.forEach(ad => {
      if (ad.type && ad.market) {
        const clean = SyncEngine.sanitizeAsin(ad.asin);
        existingMap.set(`${ad.type.toUpperCase()}_${ad.market.toLowerCase()}`, { asin: clean, parentAsin: SyncEngine.sanitizeAsin(ad.parentAsin) });
      }
    });

    return publishedProducts.map(p => {
      const key = `${(p.type || '').toUpperCase()}_${(p.market || '').toLowerCase()}`;
      const existing = existingMap.get(key);
      const exAsin = existing?.asin;
      const cleanParentAsin = SyncEngine.sanitizeAsin(p.asin);
      const oldParent = existing?.parentAsin || SyncEngine.sanitizeAsin(existingProducts.find(old => `${String(old.type || '').toUpperCase()}_${String(old.market || '').toLowerCase()}` === key)?.asin);

      const policy = getChildAsinPolicy(p.type);
      if (policy === 'unsupported') {
        return existing
          ? { asin: exAsin || cleanParentAsin, parentAsin: existing.parentAsin || cleanParentAsin, type: p.type, market: p.market }
          : { asin: cleanParentAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
      }

      if (policy === 'resolve') {
        if (exAsin && exAsin !== cleanParentAsin && oldParent === cleanParentAsin) {
          return { asin: exAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
        }
        // New V2 types were historically stored as identity entries. Preserve
        // that parent placeholder until a later guarded write can replace it.
        if (isNewChildAsinShadowType(p.type) && exAsin === cleanParentAsin && oldParent === cleanParentAsin) {
          return { asin: exAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
        }
        if (isNewChildAsinShadowType(p.type) && !existing) {
          return { asin: cleanParentAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
        }
        return { asin: null, parentAsin: cleanParentAsin, type: p.type, market: p.market };
      }

      return { asin: cleanParentAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
    });
  }

  /**
   * Parse Product Config (US and International text data)
   */
  public static parseTextData(designId: string, configData: any) {
    if (!configData?.textData) return null;
    const td = configData.textData;
    const payload: any = { design_id: designId };

    const usData = td['en'] || td['us'] || td['en-US'] || null;
    if (usData) {
      payload.title_us = usData.title || null;
      payload.brand_us = usData.brandName || null;
      payload.bullet_1_us = usData.bullets?.[0] || null;
      payload.bullet_2_us = usData.bullets?.[1] || null;
      payload.description_us = usData.description || null;
    }

    const other: Record<string, any> = {};
    for (const [lang, data] of Object.entries<any>(td)) {
      if (lang === 'en' || lang === 'us' || lang === 'en-US') continue;
      other[lang] = {
        title: data.title || null,
        brand: data.brandName || null,
        bullets: data.bullets || [],
        description: data.description || null
      };
    }
    if (Object.keys(other).length > 0) payload.text_data_other = other;

    return payload;
  }

  /**
   * 1. Run Smart Sync (Quick Update Products)
   */
  public static async runSmartSync(): Promise<{ designCount: number }> {
    const runId = this.beginWorker('quick_products');
    const runStartedAt = new Date().toISOString();
    let pages = 0;
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'quick_products';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Quick Update: Lade neueste Designs von Amazon...';
    this.addLog('[Quick Update Produkte] Starte Synchronisierung über Session 1...', 'info');

    try {
      const page = await this.getAmazonPage();
      const accountId = await this.getAccountId(page);

      let pageToken: any[] = [];
      const allResults: any[] = [];
      const seenTokens = new Set<string>(['[]']);
      const scope = this.productScope(accountId);
      const checkpoint = this.store().state(scope).watermark;
      const lowerBoundary = checkpoint ? new Date(Date.parse(checkpoint) - 24 * 60 * 60 * 1000).toISOString() : null;
      let coveredBoundary = false;


      for (let p = 0; p < 10; p++) {
        if (this.shouldStop) break;
        const json = await this.fetchListingsPage(page, accountId, pageToken);
        pages++;
        if (!json.results || json.results.length === 0) {
          if (json.pageToken?.length) throw new Error('Leere FindListings-Seite mit Fortsetzungstoken.');
          coveredBoundary = true; break;
        }

        allResults.push(...json.results);

        if (lowerBoundary) {
          const oldestInBatch = json.results[json.results.length - 1];
          const oldestDate = oldestInBatch?.updatedDate;
          const safeDate = (v: any) => { 
            try { 
              if (!v) return null; 
              const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v); 
              return isNaN(d.getTime()) ? null : d.toISOString(); 
            } catch (e) { return null; } 
          };
          const oldestIso = safeDate(oldestDate);
          if (oldestIso && oldestIso < lowerBoundary) { coveredBoundary = true; break; }
        }

        if (!json.pageToken || json.pageToken.length === 0) { coveredBoundary = true; break; }
        const tokenKey = JSON.stringify(json.pageToken);
        if (seenTokens.has(tokenKey)) throw new Error('FindListings-Pagination wiederholt denselben Token ohne Fortschritt.');
        seenTokens.add(tokenKey);
        pageToken = json.pageToken;
        await this.sleep(600);
      }

      if (this.shouldStop) throw new Error('Scan manuell abgebrochen.');

      this.addLog(`[Quick Update Produkte] ${allResults.length} Einträge von Amazon geladen. Mappe auf Supabase...`, 'info');
      const { count, attempted } = await this.applyProductChanges(page, accountId, allResults, false);
      const completeCoverage = coveredBoundary;
      if (this.shouldStop) throw new Error('Scan manuell abgebrochen.');
      if (completeCoverage) this.store().checkpoint(scope, runStartedAt);

      const now = Date.now();
      this.state.lastQuickDesigns = now;
      this.state.lastPeriodicSync = new Date().toLocaleString('de-DE');
      this.state.lastPeriodicSyncCount = count;

      this.addLog(
        completeCoverage
          ? `[Quick Update Produkte] Vollständig: ${count} Designs bestätigt ✓ (${this.state.liveDesignsCount} Live Designs).`
          : `[Quick Update Produkte] ${count} Designs bestätigt, Lauf aber nicht vollständig abgedeckt. Full Refresh erforderlich.`,
        completeCoverage ? 'success' : 'warn'
      );
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = completeCoverage ? `Bereit (${this.state.liveDesignsCount} Live Designs)` : `Teilstand bestätigt; historische Reconciliation offen`;
      this.finishWorker(runId, completeCoverage ? 'complete' : 'truncated', { pages, attempted, confirmed: count, message: completeCoverage ? undefined : 'Keine vertrauenswürdige Vollständigkeitsmarke; Full Refresh erforderlich.' });
      return { designCount: count };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Quick Update Produkte] Fehler: ${err.message}`, 'error');
      this.finishWorker(runId, this.shouldStop ? 'cancelled' : 'error', { pages, message: err.message });
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 2. Run Full Reload (Full Refresh Products)
   */
  public static async runFullReload(): Promise<{ designCount: number }> {
    const runId = this.beginWorker('full_products');
    const runStartedAt = new Date().toISOString();
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'full_products';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Full Refresh: Lade alle Designs von Amazon...';
    this.addLog('[Full Refresh Produkte] Starte vollständigen Scan aller Produkte über Session 1...', 'info');

    try {
      const page = await this.getAmazonPage();
      const accountId = await this.getAccountId(page);

      let pageToken: any[] = [];
      let pageNum = 0;
      const allResults: any[] = [];
      const seenTokens = new Set<string>(['[]']);

      while (!this.shouldStop) {
        if (pageNum >= 1000) throw new Error('Full Refresh überschritt das Sicherheitslimit von 1.000 Seiten.');
        pageNum++;
        this.addLog(`[Full Refresh] Lade Seite ${pageNum} von Amazon (je 500 Einträge)...`, 'info');
        const json = await this.fetchListingsPage(page, accountId, pageToken);
        if (!json.results || json.results.length === 0) {
          if (json.pageToken?.length) throw new Error('Leere FindListings-Seite mit Fortsetzungstoken.');
          break;
        }

        allResults.push(...json.results);
        const accountKey = crypto.createHash('sha256').update(accountId || 'unknown').digest('hex').slice(0, 16);
        atomicWriteJson(FULL_STAGE_PATH, { version: 1, runId, accountKey, startedAt: runStartedAt, pageNum, pageToken: json.pageToken || [], results: allResults }, { backup: true });
        this.addLog(`[Full Refresh] Bisher ${allResults.length} Einträge gesammelt...`, 'info');

        if (!json.pageToken || json.pageToken.length === 0) break;
        const tokenKey = JSON.stringify(json.pageToken);
        if (seenTokens.has(tokenKey)) throw new Error('FindListings-Pagination wiederholt denselben Token ohne Fortschritt.');
        seenTokens.add(tokenKey);
        pageToken = json.pageToken;
        await this.sleep(1000);
      }

      if (this.shouldStop) throw new Error('Scan manuell abgebrochen.');

      this.addLog(`[Full Refresh] Mappe ${allResults.length} Einträge auf Supabase Schema...`, 'info');
      const { count: totalSaved, attempted, scope } = await this.applyProductChanges(page, accountId, allResults, true);
      if (this.shouldStop) throw new Error('Scan manuell abgebrochen.');
      if (!allResults.length) throw new Error('Vollabgleich lieferte keine Produkte; Basisstand wird nicht freigegeben.');
      this.store().checkpoint(scope, runStartedAt, true);
      const runtime = this.loadRuntime();
      runtime.productWatermark = runStartedAt;
      runtime.accountKey = crypto.createHash('sha256').update(accountId || 'unknown').digest('hex').slice(0, 16);
      this.saveRuntime(runtime);
      try { if (fs.existsSync(FULL_STAGE_PATH)) fs.unlinkSync(FULL_STAGE_PATH); } catch {}

      this.state.lastFullDesigns = Date.now();
      this.addLog(`[Full Refresh Produkte] Beendet. ${totalSaved} Designs erfolgreich in Supabase synchronisiert ✓ (${this.state.liveDesignsCount} Live Designs).`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = `Bereit (${this.state.liveDesignsCount} Live Designs)`;
      this.finishWorker(runId, 'complete', { pages: pageNum, attempted, confirmed: totalSaved });
      return { designCount: totalSaved };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Full Refresh Produkte] Fehler: ${err.message}`, 'error');
      this.finishWorker(runId, this.shouldStop ? 'cancelled' : 'error', { pages: 0, message: err.message });
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 3. Run Deep Scan New (Quick Update Listings)
   */
  public static async runDeepScanNew(): Promise<{ processed: number }> {
    if (this.state.isScanning || this.activeWorker) throw new Error('Ein anderer Sync-Worker läuft bereits.');
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'quick_listings';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Quick Update Listings: Lade fehlende Texte...';
    this.addLog('[Quick Update Listings] Suche Designs ohne US-Titel...', 'info');

    let processed = 0;
    try {
      const supabase = this.getSupabase();
      const page = await this.getAmazonPage();

      let cursor = '';
      let found = 0;
      while (!this.shouldStop) {
        let query = supabase.from('mba_designs').select('design_id').is('title_us', null)
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
          .order('design_id', { ascending: true }).limit(100);
        if (cursor) query = query.gt('design_id', cursor);
        const { data: missingDesigns, error } = await query;
        if (error) throw error;
        if (!missingDesigns || missingDesigns.length === 0) break;
        found += missingDesigns.length;
        cursor = missingDesigns[missingDesigns.length - 1].design_id;
        this.addLog(`[Quick Update Listings] ${found} Designs geprüft. Lade Texte...`, 'info');
        for (const item of missingDesigns) {
          if (this.shouldStop) break;
          try {
            const textData = this.parseTextData(item.design_id, await this.fetchProductConfig(page, item.design_id));
            if (!textData) throw new Error('Keine Textdaten erhalten.');
            const { error: writeError } = await supabase.from('mba_designs').upsert(textData, { onConflict: 'design_id' });
            if (writeError) throw writeError;
            processed++;
          } catch (e: any) {
            this.addLog(`[Quick Update Listings] ${item.design_id} bleibt offen: ${e.message}`, 'warn');
          }
          await this.sleep(150);
        }
        if (missingDesigns.length < 100) break;
      }

      if (found === 0) {
        this.addLog('[Quick Update Listings] Keine fehlenden Texte gefunden. Alles aktuell! ✓', 'success');
      } else {
        this.addLog(`[Quick Update Listings] ${processed} Texte erfolgreich aktualisiert! ✓`, 'success');
      }

      this.state.lastQuickListings = Date.now();
      await this.refreshDBStats();
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = 'Bereit';
      return { processed };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Quick Update Listings] Fehler: ${err.message}`, 'error');
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 4. Run Deep Scan All (Full Refresh Listings)
   */
  public static async runDeepScanAll(): Promise<{ processed: number }> {
    if (this.state.isScanning || this.activeWorker) throw new Error('Ein anderer Sync-Worker läuft bereits.');
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'full_listings';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Full Refresh Listings: Lade alle Texte...';
    this.addLog('[Full Refresh Listings] Lade Texte für alle Designs...', 'info');

    let processed = 0;
    try {
      const supabase = this.getSupabase();
      const page = await this.getAmazonPage();

      let from = 0;
      while (!this.shouldStop) {
        const { data: batch, error } = await supabase.from('mba_designs')
          .select('design_id')
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
          .range(from, from + 49);

        if (error || !batch || batch.length === 0) break;

        for (const item of batch) {
          if (this.shouldStop) break;
          try {
            const config = await this.fetchProductConfig(page, item.design_id);
            const textData = this.parseTextData(item.design_id, config);
            if (textData) {
              const { error: writeError } = await supabase.from('mba_designs').upsert(textData, { onConflict: 'design_id' });
              if (writeError) throw writeError;
              processed++;
            }
          } catch {}
          await this.sleep(150);
        }

        this.addLog(`[Full Refresh Listings] ${processed} Texte geladen...`, 'info');
        from += 50;
      }

      this.state.lastFullListings = Date.now();
      await this.refreshDBStats();
      this.addLog(`[Full Refresh Listings] Beendet. ${processed} Texte aktualisiert ✓`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = 'Bereit';
      return { processed };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Full Refresh Listings] Fehler: ${err.message}`, 'error');
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 5. Run Smart Sales Sync (Quick Sales)
   */
  public static async runSmartSalesSync(): Promise<{ processed: number }> {
    if (this.state.isScanning || this.activeWorker) throw new Error('Ein anderer Sync-Worker läuft bereits.');
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'quick_sales';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Quick Sales: Lade 30-Tage Verkäufe...';
    this.addLog('[Quick Update Sales] Lade Verkäufe der letzten 30 Tage...', 'info');

    let processed = 0;
    try {
      const page = await this.getAmazonPage();
      const supabase = this.getSupabase();

      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);

      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      const analytics = await this.fetchSalesAnalytics(page, startStr, endStr);
      if (analytics && Array.isArray(analytics.sales)) {
        const salesMap = new Map<string, { units: number; royaltiesEur: number; royaltiesUsd: number }>();
        for (const row of analytics.sales) {
          const dId = row.designId;
          if (!dId) continue;
          const curr = salesMap.get(dId) || { units: 0, royaltiesEur: 0, royaltiesUsd: 0 };
          curr.units += row.unitsSold || 0;
          if (row.currency === 'EUR') curr.royaltiesEur += row.estimatedRoyalty || 0;
          if (row.currency === 'USD') curr.royaltiesUsd += row.estimatedRoyalty || 0;
          salesMap.set(dId, curr);
        }

        for (const [designId, stats] of salesMap.entries()) {
          await supabase.from('mba_designs').update({
            sales_30d: stats.units,
            royalties_30d_eur: Math.round(stats.royaltiesEur * 100) / 100,
            royalties_30d_usd: Math.round(stats.royaltiesUsd * 100) / 100
          }).eq('design_id', designId);
          processed++;
        }
      }

      this.state.lastQuickSales = Date.now();
      await this.refreshDBStats();
      this.addLog(`[Quick Update Sales] Beendet. ${processed} Designs mit Sales aktualisiert ✓`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = 'Bereit';
      return { processed };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Quick Update Sales] Fehler: ${err.message}`, 'error');
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 6. Run Full Sales History Sync
   */
  public static async runFullSalesHistory(): Promise<{ processed: number }> {
    throw new Error('Full Sales ist vorübergehend gesperrt: Der Amazon-Vertrag und die atomare Snapshot-Übernahme sind noch nicht verifiziert. Es wurden keine Sales-Daten verändert.');
    /* istanbul ignore next */
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'full_sales';
    this.state.scanStatus = 'scanning';
    this.state.lastStatusMessage = 'Full Refresh Sales: Lade gesamte All-Time Sales History...';
    this.addLog('[Full Refresh Sales] Starte All-Time Sales History Update...', 'info');

    let processed = 0;
    try {
      const page = await this.getAmazonPage();
      const supabase = this.getSupabase();

      const end = new Date();
      const start = new Date(2015, 0, 1);

      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      const analytics = await this.fetchSalesAnalytics(page, startStr, endStr);
      if (analytics && Array.isArray(analytics.sales)) {
        const { error: resetError } = await supabase.from('mba_designs').update({
          sales_total: 0,
          royalties_total_eur: 0,
          royalties_total_usd: 0,
          sales_history_synced: true
        }).not('design_id', 'is', null);
        if (resetError) throw new Error(`Null-Sales-Grundstand konnte nicht gespeichert werden: ${resetError.message}`);

        const salesMap = new Map<string, { units: number; royaltiesEur: number; royaltiesUsd: number }>();
        for (const row of analytics.sales) {
          const dId = row.designId;
          if (!dId) continue;
          const curr = salesMap.get(dId) || { units: 0, royaltiesEur: 0, royaltiesUsd: 0 };
          curr.units += row.unitsSold || 0;
          if (row.currency === 'EUR') curr.royaltiesEur += row.estimatedRoyalty || 0;
          if (row.currency === 'USD') curr.royaltiesUsd += row.estimatedRoyalty || 0;
          salesMap.set(dId, curr);
        }

        for (const [designId, stats] of salesMap.entries()) {
          await supabase.from('mba_designs').update({
            sales_total: stats.units,
            royalties_total_eur: Math.round(stats.royaltiesEur * 100) / 100,
            royalties_total_usd: Math.round(stats.royaltiesUsd * 100) / 100,
            sales_history_synced: true
          }).eq('design_id', designId);
          processed++;
        }
      }

      this.state.lastFullSalesAll = Date.now();
      await this.refreshDBStats();
      this.addLog(`[Full Refresh Sales] Beendet. ${processed} Designs mit All-Time Sales aktualisiert ✓`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = 'Bereit';
      return { processed };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Full Refresh Sales] Fehler: ${err.message}`, 'error');
      throw err;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 7. Resolve Child ASINs Batch
   */
  public static buildLifecycleAudit(listings: any[], databaseRows: any[]): { summary: Omit<LifecycleAuditSummary, 'lastRunAt' | 'reportPath' | 'complete'>; candidates: any } {
    const liveStatuses = new Set(['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING']);
    const amazonByDesign = new Map<string, { all: any[]; liveKeys: Set<string> }>();
    const productKey = (type: unknown, market: unknown) => `${normalizeChildAsinProductType(type)}|${String(market || '').toLowerCase()}`;
    for (const listing of listings || []) {
      const designId = String(listing?.designId || '');
      const market = String(listing?.marketplace || MP_MAP[listing?.marketplaceId] || '').toLowerCase();
      if (!designId || !market || !listing?.productType) continue;
      const entry = amazonByDesign.get(designId) || { all: [], liveKeys: new Set<string>() };
      entry.all.push(listing);
      if (liveStatuses.has(String(listing?.status || '').toUpperCase())) entry.liveKeys.add(productKey(listing.productType, market));
      amazonByDesign.set(designId, entry);
    }

    const deletedAtAmazon: string[] = [];
    const missingFromAmazon: string[] = [];
    const staleProducts: Array<{ designId: string; type: string; market: string }> = [];
    const staleAds: Array<{ designId: string; type: string; market: string }> = [];
    const missingDatabaseProducts: Array<{ designId: string; type: string; market: string }> = [];
    const databaseDesignIds = new Set<string>();
    for (const row of databaseRows || []) {
      const designId = String(row?.design_id || '');
      if (!designId) continue;
      databaseDesignIds.add(designId);
      const amazon = amazonByDesign.get(designId);
      if (!amazon) missingFromAmazon.push(designId);
      else if (amazon.liveKeys.size === 0) deletedAtAmazon.push(designId);

      const dbProducts = Array.isArray(row?.published_products) ? row.published_products : [];
      const dbKeys = new Set(dbProducts.map((product: any) => productKey(product?.type, product?.market)));
      const liveKeys = amazon?.liveKeys || new Set<string>();
      for (const product of dbProducts) {
        const key = productKey(product?.type, product?.market);
        if (!liveKeys.has(key)) staleProducts.push({ designId, type: normalizeChildAsinProductType(product?.type), market: String(product?.market || '').toLowerCase() });
      }
      for (const ad of Array.isArray(row?.ad_asins) ? row.ad_asins : []) {
        if (!liveKeys.has(productKey(ad?.type, ad?.market))) staleAds.push({ designId, type: normalizeChildAsinProductType(ad?.type), market: String(ad?.market || '').toLowerCase() });
      }
      for (const key of liveKeys) {
        if (!dbKeys.has(key)) {
          const [type, market] = key.split('|');
          missingDatabaseProducts.push({ designId, type, market });
        }
      }
    }
    for (const [designId, amazon] of amazonByDesign) {
      if (databaseDesignIds.has(designId)) continue;
      for (const key of amazon.liveKeys) {
        const [type, market] = key.split('|');
        missingDatabaseProducts.push({ designId, type, market });
      }
    }

    return {
      summary: {
        amazonListings: listings.length,
        amazonDesigns: amazonByDesign.size,
        databaseDesigns: databaseRows.length,
        deletedAtAmazonDesigns: deletedAtAmazon.length,
        missingFromAmazonDesigns: missingFromAmazon.length,
        stalePublishedProducts: staleProducts.length,
        staleAdAsins: staleAds.length,
        missingDatabaseProducts: missingDatabaseProducts.length
      },
      candidates: { deletedAtAmazon, missingFromAmazon, staleProducts, staleAds, missingDatabaseProducts }
    };
  }

  public static async runLifecycleAudit(): Promise<LifecycleAuditSummary> {
    const runId = this.beginWorker('lifecycle_audit');
    this.shouldStop = false;
    this.state.isScanning = true;
    this.state.activeScanType = 'lifecycle_audit';
    let pages = 0;
    try {
      const page = await this.getAmazonPage();
      const accountId = await this.getAccountId(page);
      const listings: any[] = [];
      let pageToken: any[] = [];
      const seenTokens = new Set<string>(['[]']);
      while (!this.shouldStop) {
        if (pages >= 1000) throw new Error('Lifecycle-Audit überschritt das Sicherheitslimit von 1.000 Seiten.');
        const response = await this.fetchListingsPage(page, accountId, pageToken, ALL_STATUSES);
        pages++;
        if (!response.results?.length) {
          if (response.pageToken?.length) throw new Error('Lifecycle-Audit erhielt eine leere Seite mit Fortsetzungstoken.');
          break;
        }
        listings.push(...response.results);
        if (!response.pageToken?.length) break;
        const tokenKey = JSON.stringify(response.pageToken);
        if (seenTokens.has(tokenKey)) throw new Error('Lifecycle-Audit erkannte einen wiederholten Seitentoken.');
        seenTokens.add(tokenKey);
        pageToken = response.pageToken;
        await this.sleep(600);
      }
      if (this.shouldStop) throw new Error('Lifecycle-Audit manuell abgebrochen.');
      if (!listings.length) throw new Error('Lifecycle-Audit lieferte keine Amazon-Produkte; kein Bericht erstellt.');

      const supabase = this.getSupabase();
      const databaseRows: any[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from('mba_designs')
          .select('design_id, status, published_products, ad_asins')
          .order('design_id', { ascending: true })
          .range(from, from + 499);
        this.recordTraffic('lifecycle_audit_read', { data, error });
        if (error) throw new Error(`Lifecycle-Audit konnte Supabase nicht lesen: ${error.message || String(error)}`);
        databaseRows.push(...(data || []));
        if (!data || data.length < 500) break;
      }

      const audit = this.buildLifecycleAudit(listings, databaseRows);
      const summary: LifecycleAuditSummary = {
        ...audit.summary,
        lastRunAt: new Date().toISOString(),
        reportPath: 'data/sync_lifecycle_audit.json',
        complete: true
      };
      atomicWriteJson(LIFECYCLE_AUDIT_PATH, { version: 1, accountKey: crypto.createHash('sha256').update(accountId || 'unknown').digest('hex').slice(0, 16), summary, candidates: audit.candidates }, { backup: true });
      const runtime = this.loadRuntime();
      runtime.lifecycleAudit = summary;
      this.saveRuntime(runtime);
      this.state.lifecycleAudit = summary;
      this.addLog(`[Lifecycle Audit] Read-only abgeschlossen: ${summary.deletedAtAmazonDesigns} vollständig gelöschte Designs, ${summary.stalePublishedProducts} veraltete Produkte, ${summary.staleAdAsins} betroffene ad_asins.`, 'success');
      this.finishWorker(runId, 'complete', { pages, attempted: databaseRows.length, confirmed: 0, message: 'Nur gelesen; keine Datenbankänderung.' });
      return summary;
    } catch (error: any) {
      this.finishWorker(runId, this.shouldStop ? 'cancelled' : 'error', { pages, message: error?.message || String(error) });
      this.addLog(`[Lifecycle Audit] Fehler: ${error?.message || String(error)}. Keine Datenbankänderung.`, 'error');
      throw error;
    } finally {
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  public static buildChildAsinDiagnostics(
    rows: any[],
    retryState: ProductSyncRuntime['resolverRetries'] = {},
    truncated = false
  ): ChildAsinDiagnostics {
    const reasons = new Map<string, number>();
    const groups = new Map<string, number>();
    let unresolvedEntries = 0;
    let retryWaiting = 0;
    let readyNow = 0;
    let staleStatusDesigns = 0;
    const now = Date.now();

    const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) || 0) + 1);
    for (const row of rows || []) {
      const products = Array.isArray(row?.published_products) ? row.published_products : [];
      const adAsins = Array.isArray(row?.ad_asins) ? row.ad_asins : [];
      let rowHasOpenLegacyEntry = false;
      for (const product of products) {
        const type = normalizeChildAsinProductType(product?.type);
        if (!isLegacyChildAsinWriteEnabled(type)) continue;
        const market = String(product?.market || '').trim().toLowerCase();
        const parentAsin = this.sanitizeAsin(product?.asin);
        const ad = adAsins.find((entry: any) =>
          normalizeChildAsinProductType(entry?.type) === type && String(entry?.market || '').trim().toLowerCase() === market
        );
        const recordedParentAsin = this.sanitizeAsin(ad?.parentAsin);
        if (parentAsin && recordedParentAsin === parentAsin && isConfirmedChildAsin(ad?.asin, parentAsin)) continue;

        rowHasOpenLegacyEntry = true;
        unresolvedEntries++;
        add(groups, `${type}|${market || 'unbekannt'}`);
        const retryKey = `${row.design_id}:${market}:${type}`;
        const retry = retryState?.[retryKey];
        if (retry && retry.parentAsin === parentAsin && Date.parse(retry.nextAt) > now) {
          retryWaiting++;
          add(reasons, `Warte auf Retry (${retry.lastError || 'Fehler'})`);
        } else if (!parentAsin) {
          add(reasons, 'Parent-ASIN fehlt');
        } else if (!ad?.asin) {
          readyNow++;
          add(reasons, 'Child-ASIN fehlt, jetzt prüfbar');
        } else if (recordedParentAsin && recordedParentAsin !== parentAsin) {
          readyNow++;
          add(reasons, 'Parent geändert, Child-ASIN neu zu prüfen');
        } else {
          readyNow++;
          add(reasons, 'Parent-Platzhalter, jetzt prüfbar');
        }
      }
      if (!rowHasOpenLegacyEntry) {
        staleStatusDesigns++;
        add(reasons, 'Status veraltet oder nur nicht unterstützte Produkte');
      }
    }

    const sorted = (map: Map<string, number>) => [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      lastRunAt: new Date().toISOString(),
      unresolvedDesigns: rows.length,
      unresolvedEntries,
      retryWaiting,
      readyNow,
      staleStatusDesigns,
      truncated,
      reasons: sorted(reasons).map(([reason, count]) => ({ reason, count })),
      groups: sorted(groups).map(([key, count]) => {
        const [type, market] = key.split('|');
        return { type, market, count };
      })
    };
  }

  private static persistChildAsinDiagnostics(rows: any[], runtime: ProductSyncRuntime, truncated = false) {
    const diagnostics = this.buildChildAsinDiagnostics(rows, runtime.resolverRetries || {}, truncated);
    runtime.resolverDiagnostics = diagnostics;
    this.saveRuntime(runtime);
    this.state.childAsinDiagnostics = diagnostics;
  }

  public static async resolveChildAsinsBatch(limit = 10): Promise<{ processed: number; errors: number }> {
    const runId = this.beginWorker('resolve_asins');
    this.state.isScanning = true;
    this.state.activeScanType = 'resolve_asins';
    const supabase = this.getSupabase();
    let processed = 0;
    let errors = 0;

    const marketplaceDomains: Record<string, string> = {
      'us': 'amazon.com',
      'de': 'amazon.de',
      'gb': 'amazon.co.uk',
      'fr': 'amazon.fr',
      'it': 'amazon.it',
      'es': 'amazon.es',
      'jp': 'amazon.co.jp'
    };

    try {
      const page = await this.getAmazonPage();
      const runtime = this.loadRuntime();
      const retryState = runtime.resolverRetries || {};
      const { data: unresolved, error } = await supabase.from('mba_designs')
        .select('design_id, published_products, ad_asins')
        .or('asin_resolved.eq.false,asin_resolved.is.null')
        .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
        .order('updated_date', { ascending: true, nullsFirst: true })
        // A 50-row window could be occupied entirely by retry-delayed rows and
        // permanently hide later candidates. The current live queue is small;
        // inspect a broad bounded window so every due row gets a fair chance.
        .limit(1000);

      this.recordTraffic('resolver_read', { data: unresolved, error });
      if (error) throw new Error(`ASIN-Queue konnte nicht gelesen werden: ${error.message || String(error)}`);
      if (!unresolved || unresolved.length === 0) {
        const runtime = this.loadRuntime();
        this.persistChildAsinDiagnostics([], runtime);
        this.state.lastAsinSync = new Date().toLocaleString('de-DE');
        this.finishWorker(runId, 'complete', { pages: 0, attempted: 0, confirmed: 0 });
        this.state.isScanning = false;
        this.state.activeScanType = null;
        return { processed: 0, errors: 0 };
      }

      let selected = 0;
      for (const item of unresolved) {
        if (selected >= limit) break;
        if (this.shouldStop) break;
        const pubProducts: any[] = item.published_products || [];
        const newAdAsins: any[] = this.buildAdAsins(pubProducts, item.ad_asins || [], pubProducts);

        const toResolve: { ad: any; parent: any; retryKey: string }[] = [];
        for (const ad of newAdAsins) {
          if (!isLegacyChildAsinWriteEnabled(ad.type)) continue;
          const parent = pubProducts.find(p => (p.type || '').toUpperCase() === (ad.type || '').toUpperCase() && (p.market || '').toLowerCase() === (ad.market || '').toLowerCase());
          if (!parent || !parent.asin) continue;
          if (!ad.asin || ad.asin === parent.asin) {
            const retryKey = `${item.design_id}:${String(ad.market).toLowerCase()}:${String(ad.type).toUpperCase()}`;
            const retry = retryState[retryKey];
            if (!retry || retry.parentAsin !== parent.asin || Date.parse(retry.nextAt) <= Date.now()) toResolve.push({ ad, parent, retryKey });
          }
        }
        if (toResolve.length === 0) {
          const alreadyResolved = newAdAsins.every((ad: any) => !isLegacyChildAsinWriteEnabled(ad.type) || isChildAsinRequirementSatisfied(ad));
          if (alreadyResolved) {
            const { error: confirmError } = await supabase.from('mba_designs').update({ ad_asins: newAdAsins, asin_resolved: true }).eq('design_id', item.design_id);
            if (confirmError) errors++; else {
              processed++;
              item.ad_asins = newAdAsins;
              item.asin_resolved = true;
            }
          }
          continue;
        }
        selected++;

        let itemFailed = false;
        for (const { ad, parent, retryKey } of toResolve) {
          let failureReason = '';
          if (this.shouldStop) break;
          try {
            const domain = marketplaceDomains[ad.market?.toLowerCase()] || 'amazon.com';
            const detailUrl = `https://www.${domain}/dp/${parent.asin}`;

            const response = await fetch(detailUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache'
              }
            });

            if (response.status === 404) {
              itemFailed = true;
              errors++;
              failureReason = 'HTTP 404';
              this.addLog(`[ASIN Scanner] Produkt ${parent.asin} (${ad.market}) nicht gefunden (404). Auflösung bleibt offen.`, 'warn');
              const attempts = (retryState[retryKey]?.parentAsin === parent.asin ? retryState[retryKey].attempts : 0) + 1;
              retryState[retryKey] = { attempts, nextAt: new Date(Date.now() + Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, Math.min(attempts - 1, 8)))).toISOString(), parentAsin: parent.asin, lastError: failureReason };
              continue;
            }

            const html = await response.text();

            // Detect CAPTCHA or Robot Check
            if (html.includes('/errors/validateCaptcha') || html.includes('Robot Check') || response.status === 503 || response.status === 403) {
              this.addLog(`[ASIN Scanner] ⚠️ Amazon Rate-Limit / Captcha für ${parent.asin} (${ad.market}). Pausiere...`, 'warn');
              itemFailed = true;
              errors++;
              failureReason = `HTTP ${response.status} / CAPTCHA`;
              await this.sleep(3000);
              const attempts = (retryState[retryKey]?.parentAsin === parent.asin ? retryState[retryKey].attempts : 0) + 1;
              retryState[retryKey] = { attempts, nextAt: new Date(Date.now() + Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, Math.min(attempts - 1, 8)))).toISOString(), parentAsin: parent.asin, lastError: failureReason };
              continue;
            }

            if (html) {
              const finalChildAsin = SyncEngine.extractVerifiedChildAsin(html, parent.asin);

              if (finalChildAsin && finalChildAsin !== parent.asin) {
                ad.asin = finalChildAsin;
                this.addLog(`[ASIN Scanner] ✓ Child-ASIN aufgelöst für ${ad.type} (${ad.market}): ${parent.asin} ➔ ${finalChildAsin}`, 'success');
              } else {
                itemFailed = true;
                errors++;
                failureReason = 'Keine eindeutig belegte Child-ASIN';
                this.addLog(`[ASIN Scanner] Keine eindeutig belegte Child-ASIN für ${ad.type} (${ad.market}) gefunden. Auflösung bleibt offen.`, 'warn');
              }
            } else {
              itemFailed = true;
              errors++;
              failureReason = 'Leere Amazon-Antwort';
            }
          } catch (e: any) {
            errors++;
            itemFailed = true;
            failureReason = e.message || 'Unbekannter Resolverfehler';
            this.addLog(`[ASIN Scanner] Fehler bei ${parent.asin} (${ad.market}): ${e.message}`, 'error');
          }
          if (failureReason) {
            const attempts = (retryState[retryKey]?.parentAsin === parent.asin ? retryState[retryKey].attempts : 0) + 1;
            const delayMs = Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, Math.min(attempts - 1, 8)));
            retryState[retryKey] = { attempts, nextAt: new Date(Date.now() + delayMs).toISOString(), parentAsin: parent.asin, lastError: failureReason };
          } else if (ad.asin) {
            delete retryState[retryKey];
          }
          await this.sleep(1800 + Math.random() * 800);
        }

        const fullyResolved = !itemFailed && newAdAsins.every((ad: any) => {
          if (!isLegacyChildAsinWriteEnabled(ad.type)) return true;
          const parent = pubProducts.find(p => (p.type || '').toUpperCase() === (ad.type || '').toUpperCase() && (p.market || '').toLowerCase() === (ad.market || '').toLowerCase());
          return !!ad.asin && !!parent?.asin && ad.asin !== parent.asin;
        });
        const { error: updateError } = await supabase.from('mba_designs').update({
          ad_asins: newAdAsins,
          asin_resolved: fullyResolved
        }).eq('design_id', item.design_id);
        if (updateError) {
          errors++;
          this.addLog(`[ASIN Scanner] Supabase-Write für ${item.design_id} fehlgeschlagen: ${updateError.message || String(updateError)}`, 'error');
        } else if (fullyResolved) {
          processed++;
          item.ad_asins = newAdAsins;
          item.asin_resolved = true;
        } else {
          item.ad_asins = newAdAsins;
        }
      }
      runtime.resolverRetries = Object.fromEntries(Object.entries(retryState).slice(-5000));
      this.persistChildAsinDiagnostics(unresolved.filter((row: any) => row.asin_resolved !== true), runtime, unresolved.length >= 1000);
    } catch (err: any) {
      console.warn('[SyncEngine] ASIN batch error:', err.message);
    }

    this.state.lastAsinSync = new Date().toLocaleString('de-DE');
    await this.refreshDBStats();
    this.finishWorker(runId, this.shouldStop ? 'cancelled' : (errors ? 'partial' : 'complete'), { pages: 0, attempted: processed + errors, confirmed: processed, message: errors ? `${errors} Auflösungen bleiben offen.` : undefined });
    this.state.isScanning = false;
    this.state.activeScanType = null;
    return { processed, errors };
  }

  /** Read-only SNAP-style probe for every product type requiring a child ASIN. */
  public static async runChildAsinShadowBatch(limit = 1): Promise<{ checked: number; resolved: number; unresolved: number }> {
    this.shouldStop = false;
    const runId = this.beginWorker('resolve_asins_shadow');
    this.state.isScanning = true;
    this.state.activeScanType = 'resolve_asins_shadow';
    let checked = 0;
    let resolved = 0;
    let unresolvedCount = 0;
    let finalStatus: NonNullable<ProductSyncRuntime['lastRun']>['status'] = 'complete';
    let message: string | undefined;
    let blockedResult: string | null = null;

    try {
      const supabase = this.getSupabase();
      const runtime = this.loadRuntime();
      const retryState = runtime.resolverRetries || {};
      const observations = runtime.resolverObservations || {};
      const previousShadow = runtime.resolverShadow;
      const blockedUntil = previousShadow?.blockedUntil ? Date.parse(previousShadow.blockedUntil) : 0;
      if (blockedUntil > Date.now()) {
        const lastResult = `Amazon-Retail-Prüfung bis ${new Date(blockedUntil).toLocaleString('de-DE')} pausiert; keine Datenbankänderung.`;
        runtime.resolverShadow = { ...previousShadow, lastRunAt: new Date().toISOString(), checked: 0, resolved: 0, unresolved: 0, lastResult };
        this.saveRuntime(runtime);
        this.state.childAsinShadow = runtime.resolverShadow;
        message = lastResult;
        return { checked: 0, resolved: 0, unresolved: 0 };
      }
      const cursor = Math.max(0, Number(previousShadow?.cursor || 0));
      const { data: rows, error } = await supabase.from('mba_designs')
        .select('design_id, published_products, ad_asins')
        .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
        .order('updated_date', { ascending: true, nullsFirst: true })
        .range(cursor, cursor + 249);
      this.recordTraffic('resolver_shadow_read', { data: rows, error });
      if (error) throw new Error(`ASIN-Shadow-Queue konnte nicht gelesen werden: ${error.message || String(error)}`);

      const candidates: Array<{ designId: string; type: string; market: string; parentAsin: string; retryKey: string; observationKey: string }> = [];
      for (const row of rows || []) {
        const products = Array.isArray(row.published_products) ? row.published_products : [];
        const adAsins = Array.isArray(row.ad_asins) ? row.ad_asins : [];
        for (const product of products) {
          const type = normalizeChildAsinProductType(product?.type);
          const market = String(product?.market || '').toLowerCase();
          const parentAsin = this.sanitizeAsin(product?.asin);
          if (getChildAsinPolicy(type) !== 'resolve' || !parentAsin || !market) continue;
          const existing = adAsins.find((entry: any) =>
            normalizeChildAsinProductType(entry?.type) === type && String(entry?.market || '').toLowerCase() === market
          );
          if (this.sanitizeAsin(existing?.parentAsin) === parentAsin && isConfirmedChildAsin(existing?.asin, parentAsin)) continue;
          const retryKey = `shadow:${row.design_id}:${market}:${type}`;
          const observationKey = crypto.createHash('sha256').update(`${row.design_id}:${market}:${type}`).digest('hex').slice(0, 24);
          const observation = observations[observationKey];
          if (observation?.parentAsin === parentAsin && Date.parse(observation.observedAt) > Date.now() - 12 * 60 * 60 * 1000) continue;
          const retry = retryState[retryKey];
          if (retry?.parentAsin === parentAsin && Date.parse(retry.nextAt) > Date.now()) continue;
          candidates.push({ designId: row.design_id, type, market, parentAsin, retryKey, observationKey });
          if (candidates.length >= Math.max(1, limit)) break;
        }
        if (candidates.length >= Math.max(1, limit)) break;
      }

      for (const candidate of candidates) {
        if (this.shouldStop) break;
        checked++;
        const result = await AmazonRetailIdentityService.resolve(candidate.parentAsin, candidate.market);
        const previousObservation = observations[candidate.observationKey];
        const resolvedAsin = result.status === 'resolved' ? result.evidence.resolvedAsin : null;
        observations[candidate.observationKey] = {
          parentAsin: candidate.parentAsin,
          resolvedAsin,
          status: result.status,
          source: result.evidence.source || null,
          observedAt: new Date().toISOString(),
          consistentCount: previousObservation?.parentAsin === candidate.parentAsin && previousObservation?.resolvedAsin === resolvedAsin && previousObservation?.status === result.status
            ? (previousObservation.consistentCount || 0) + 1 : 1
        };
        if (result.status === 'resolved') {
          resolved++;
          delete retryState[candidate.retryKey];
          this.addLog(
            `[ASIN SNAP Shadow] ✓ ${candidate.type} (${candidate.market}): ${candidate.parentAsin} ➔ ${result.evidence.resolvedAsin} via ${result.evidence.source}. Nur geprüft, nicht gespeichert.`,
            'success'
          );
        } else {
          unresolvedCount++;
          const previous = retryState[candidate.retryKey];
          const attempts = previous?.parentAsin === candidate.parentAsin ? previous.attempts + 1 : 1;
          const delayMs = Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, Math.min(attempts - 1, 8)));
          retryState[candidate.retryKey] = {
            attempts,
            nextAt: new Date(Date.now() + delayMs).toISOString(),
            parentAsin: candidate.parentAsin,
            lastError: result.status
          };
          const blocked = result.status === 'amazon_blocked' || result.status === 'auth_required';
          this.addLog(
            `[ASIN SNAP Shadow] ${candidate.type} (${candidate.market}) blieb offen: ${result.status}. Keine Datenbankänderung.`,
            blocked ? 'error' : 'warn'
          );
          if (blocked) {
            blockedResult = `${result.status}; sechs Stunden pausiert. Keine Datenbankänderung.`;
            runtime.resolverShadow = {
              ...(runtime.resolverShadow || previousShadow),
              lastRunAt: new Date().toISOString(), checked, resolved, unresolved: unresolvedCount,
              lastResult: blockedResult,
              cursor,
              blockedUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
            };
            break;
          }
        }
      }

      const lastResult = blockedResult || (candidates.length === 0
        ? 'Keine fälligen neuen Produkt-/Marktplatzkombinationen in der begrenzten Stichprobe.'
        : `${resolved}/${checked} eindeutig aufgelöst; keine Datenbankänderung.`);
      runtime.resolverRetries = Object.fromEntries(Object.entries(retryState).slice(-5000));
      runtime.resolverObservations = Object.fromEntries(Object.entries(observations).slice(-5000));
      const nextCursor = blockedResult ? cursor : ((rows || []).length < 250 ? 0 : cursor + 250);
      runtime.resolverShadow = {
        ...(runtime.resolverShadow || {}),
        lastRunAt: new Date().toISOString(), checked, resolved, unresolved: unresolvedCount, lastResult,
        cursor: nextCursor,
        blockedUntil: runtime.resolverShadow?.blockedUntil || null
      };
      this.saveRuntime(runtime);
      this.state.childAsinShadow = runtime.resolverShadow;
      message = lastResult;
      if (unresolvedCount) finalStatus = 'partial';
      return { checked, resolved, unresolved: unresolvedCount };
    } catch (error: any) {
      finalStatus = 'error';
      message = error?.message || String(error);
      this.addLog(`[ASIN SNAP Shadow] Fehler: ${message}. Keine Datenbankänderung.`, 'error');
      throw error;
    } finally {
      this.finishWorker(runId, this.shouldStop ? 'cancelled' : finalStatus, { pages: 0, attempted: checked, confirmed: 0, message });
      this.state.isScanning = false;
      this.state.activeScanType = null;
    }
  }

  /**
   * 8. Danger Zone: Reset Sales Data
   */
  public static async resetSalesData() {
    const supabase = this.getSupabase();
    this.addLog('[Gefahrenzone] Setze alle Sales-Daten in Supabase zurück...', 'warn');

    let from = 0;
    while (true) {
      const { data, error } = await supabase.from('mba_designs')
        .select('design_id')
        .range(from, from + 999);

      if (error || !data || data.length === 0) break;

      const updates = data.map(d => ({
        design_id: d.design_id,
        sales_30d: 0,
        royalties_30d_usd: 0,
        royalties_30d_eur: 0,
        royalties_30d_gbp: 0,
        royalties_30d_jpy: 0,
        sales_total: 0,
        royalties_total_usd: 0,
        royalties_total_eur: 0,
        royalties_total_gbp: 0,
        royalties_total_jpy: 0,
        sales_history_synced: false
      }));

      await supabase.from('mba_designs').upsert(updates);
      from += 1000;
    }

    this.addLog('[Gefahrenzone] Alle Sales-Daten erfolgreich zurückgesetzt! ✓', 'success');
  }

  /**
   * 9. Danger Zone: Reset ASIN Resolution Status
   */
  public static async resetAsinResolutionStatus() {
    const supabase = this.getSupabase();
    this.addLog('[Gefahrenzone] Setze ASIN-Auflösungsstatus zurück...', 'warn');

    let from = 0;
    while (true) {
      const { data, error } = await supabase.from('mba_designs')
        .select('design_id')
        .range(from, from + 999);

      if (error || !data || data.length === 0) break;

      const updates = data.map(d => ({
        design_id: d.design_id,
        asin_resolved: false
      }));

      await supabase.from('mba_designs').upsert(updates);
      from += 1000;
    }

    await this.refreshDBStats();
    this.addLog('[Gefahrenzone] ASIN-Auflösungsstatus erfolgreich zurückgesetzt! ✓', 'success');
  }

  private static cachedRatelimiter: {
    data: { tier?: number; slots: { used: number; total: number; free: number } };
    timestamp: number;
  } | null = null;

  /**
   * 10. Fetch Live Tier & Daily Upload Slots from Amazon Merch Ratelimiter API / Dashboard in Session 1
   */
  /**
   * 10. Fetch Live Tier & Daily Upload Slots from Amazon Merch Ratelimiter API / Dashboard in Session 1
   */
  public static async fetchDashboardRatelimiter(page?: any, forceRefresh = false): Promise<{
    tier?: number;
    slots: { used: number; total: number; free: number };
    liveDesignsCount?: number;
    freeDesignsCount?: number;
  } | null> {
    const now = Date.now();
    // Cache TTL 10 seconds for live responsiveness
    if (!forceRefresh && this.cachedRatelimiter && (now - this.cachedRatelimiter.timestamp) < 10000) {
      return this.cachedRatelimiter.data;
    }

    try {
      // Session 1 is the dedicated sync session
      const p = page || await this.getAmazonPage();

      const result = await p.evaluate(async () => {
        let liveDesigns: number | null = null;
        let freeDesigns: number | null = null;

        // Method 1: Amazon Native Ratelimiter JSON API
        try {
          const res = await fetch('/api/ratelimiter/metadata', {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && (data.dailyProduct || data.dailyDesign || data.tier || data.overallDesign || data.overallProduct)) {
              const overall = data.overallDesign || data.overallProduct || data.totalDesign || data.totalProduct;
              if (overall) {
                if (typeof overall.count === 'number') liveDesigns = overall.count;
                if (typeof overall.limit === 'number' && liveDesigns !== null) {
                  freeDesigns = Math.max(0, overall.limit - liveDesigns);
                }
              }
              return { 
                type: 'api', 
                data: {
                  ...data,
                  liveDesigns,
                  freeDesigns
                } 
              };
            }
          }
        } catch (e) {}

        // Method 2: Parse Productor or Amazon Dashboard DOM Elements
        try {
          let used: number | null = null;
          let total: number | null = null;
          let tier: number | null = null;

          const allElements = Array.from(document.querySelectorAll('*'));

          // 2A: Check Productor "Uploaded" Card (<div class="text-sm mb-1">Uploaded</div> ... <div class="font-weight-bold">80 / 200</div>)
          const uploadedHeader = allElements.find(el => (el.textContent || '').trim().toLowerCase() === 'uploaded');
          if (uploadedHeader) {
            const container = uploadedHeader.closest('.media-body') || uploadedHeader.closest('.media') || uploadedHeader.parentElement;
            if (container) {
              const text = container.textContent || '';
              const match = text.match(/(\d+)\s*\/\s*(\d+)/);
              if (match) {
                used = parseInt(match[1], 10);
                total = parseInt(match[2], 10);
              }
            }
          }

          // 2B: Check Productor "Designs" Card (<div><div class="text-sm mb-1">Designs</div><h3 class="my-0">1.987</h3><div class="text-sm text-muted">Free: <br>13</div></div>)
          const designsHeader = allElements.find(el => {
            const t = (el.textContent || '').trim().toLowerCase();
            return t === 'designs' || t === 'live designs';
          });
          if (designsHeader) {
            const container = designsHeader.closest('.media-body') || designsHeader.closest('.media') || designsHeader.parentElement;
            if (container) {
              const countEl = container.querySelector('h1, h2, h3, h4, .font-weight-bold, .my-0') || container;
              if (countEl && countEl.textContent) {
                const match = countEl.textContent.match(/([0-9,.]+)/);
                if (match) {
                  liveDesigns = parseInt(match[1].replace(/[,.]/g, ''), 10);
                }
              }

              const containerText = container.textContent || '';
              const freeMatch = containerText.match(/Free\s*:?\s*([0-9,.]+)/i) || containerText.match(/Frei\s*:?\s*([0-9,.]+)/i);
              if (freeMatch) {
                freeDesigns = parseInt(freeMatch[1].replace(/[,.]/g, ''), 10);
              }
            }
          }

          // 2C: Check Productor progress bar for uploaded slots
          if (used === null || total === null) {
            const progressBar = document.querySelector('.progress-bar.bg-productor, .progress-bar[aria-valuemax]') as HTMLElement;
            if (progressBar) {
              const max = progressBar.getAttribute('aria-valuemax');
              const nowVal = progressBar.getAttribute('aria-valuenow');
              if (max && nowVal) {
                total = parseInt(max, 10);
                const ratio = parseFloat(nowVal);
                if (ratio <= 1.0) {
                  used = Math.round(ratio * total);
                } else {
                  used = Math.round(ratio);
                }
              }
            }
          }

          // 2D: Full page regex text fallback (Productor & Native Dashboard)
          const pageText = document.body.innerText || '';

          if (used === null || total === null) {
            const slotMatches = [
              /Uploaded\s*[:\n\r\s]*(\d+)\s*\/\s*(\d+)/i,
              /Published\s*[:\n\r\s]*(\d+)\s*\/\s*(\d+)/i,
              /Daily\s*Upload\s*Limit\s*[:\n\r\s]*(\d+)\s*\/\s*(\d+)/i,
              /(\d+)\s*\/\s*(\d+)\s*(?:Uploaded|Published|Uploads)/i,
              /(\d+)\s*von\s*(\d+)\s*(?:verwendet|hochgeladen)/i
            ];

            for (const rgx of slotMatches) {
              const m = pageText.match(rgx);
              if (m) {
                used = parseInt(m[1], 10);
                total = parseInt(m[2], 10);
                break;
              }
            }
          }

          if (liveDesigns === null) {
            const dMatch = pageText.match(/Live\s*Designs\s*[:\n\r\s]*([0-9,.]+)/i) 
              || pageText.match(/Designs\s*[:\n\r\s]*([0-9,.]+)/i)
              || pageText.match(/([0-9,.]+)\s*Live\s*Designs/i);
            if (dMatch) {
              liveDesigns = parseInt(dMatch[1].replace(/[,.]/g, ''), 10);
            }
          }

          // 2E: Tier match
          const tierMatch = pageText.match(/Tier\s*:?\s*([0-9,.]+)/i) || pageText.match(/T\s*([0-9]{3,6})/i);
          if (tierMatch) {
            tier = parseInt(tierMatch[1].replace(/[,.]/g, ''), 10);
          } else if (liveDesigns !== null && freeDesigns !== null) {
            tier = liveDesigns + freeDesigns;
          }

          if (used !== null || total !== null || tier !== null || liveDesigns !== null) {
            return {
              type: 'dom',
              data: {
                dailyProduct: {
                  count: used ?? 0,
                  limit: total ?? 200
                },
                liveDesigns,
                freeDesigns,
                tier
              }
            };
          }
        } catch (e) {}

        return null;
      });

      if (result?.data) {
        const d = result.data;
        const used = d.dailyProduct?.count ?? d.dailyDesign?.count ?? 0;
        const total = d.dailyProduct?.limit ?? d.dailyDesign?.limit ?? 200;
        const tier = d.overallDesign?.limit ?? d.overallProduct?.limit ?? d.tier ?? d.maxProducts ?? d.totalProduct?.limit ?? d.tierLevel ?? null;
        const liveDesigns = d.liveDesigns ?? d.overallDesign?.count ?? d.overallProduct?.count ?? null;
        const freeDesigns = d.freeDesigns ?? (tier && liveDesigns ? Math.max(0, tier - liveDesigns) : null);

        const payload = {
          tier: typeof tier === 'number' ? tier : (tier ? parseInt(String(tier).replace(/[,.]/g, ''), 10) : undefined),
          slots: {
            used: Number(used) || 0,
            total: Number(total) || 200,
            free: Math.max(0, (Number(total) || 200) - (Number(used) || 0))
          },
          liveDesignsCount: typeof liveDesigns === 'number' && !isNaN(liveDesigns) ? liveDesigns : undefined,
          freeDesignsCount: typeof freeDesigns === 'number' && !isNaN(freeDesigns) ? freeDesigns : undefined
        };

        if (payload.liveDesignsCount !== undefined) {
          this.state.liveDesignsCount = payload.liveDesignsCount;
        }

        this.cachedRatelimiter = {
          data: payload,
          timestamp: now
        };
        return payload;
      }
    } catch (e) {
      console.warn('[SyncEngine] fetchDashboardRatelimiter error:', e);
    }
    return this.cachedRatelimiter ? this.cachedRatelimiter.data : null;
  }
}

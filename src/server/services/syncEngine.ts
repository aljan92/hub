import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSupabaseClient, loadSettings, saveSettings } from './settingsService';
import { BrowserSessionService } from './browserSessionService';
import { atomicWriteJson, loadJsonWithBackupRecovery } from '../utils/atomicFileStorage';

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
  lastRun?: ProductSyncRuntime['lastRun'];
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

const VARIANT_PRODUCT_TYPES = new Set([
  'HARDCOVER_JOURNAL',
  'MUG',
  'PHONE_CASE_APPLE_IPHONE',
  'PHONE_CASE_SAMSUNG_GALAXY',
  'POP_SOCKET',
  'PRINTED_BASEBALL_HAT',
  'PRINTED_TRUCKER_HAT',
  'SPORT_SUN_VISOR',
  'THROW_PILLOW',
  'TOTE_BAG',
  'TUMBLER',
  'WATER_BOTTLE'
]);

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
  lastRun?: { runId: string; type: string; status: 'running' | 'complete' | 'partial' | 'truncated' | 'cancelled' | 'unknown_write_outcome' | 'error'; startedAt: string; finishedAt?: string; pages: number; attempted: number; confirmed: number; message?: string };
};
const SYNC_RUNTIME_PATH = path.resolve(process.cwd(), 'data', 'sync_runtime.json');
const FULL_STAGE_PATH = path.resolve(process.cwd(), 'data', 'sync_full_stage.json');

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
  };

  private static shouldStop = false;
  private static autoUpdateTimer: NodeJS.Timeout | null = null;
  private static asinResolveTimer: NodeJS.Timeout | null = null;
  private static textCatchupTimer: NodeJS.Timeout | null = null;
  private static activeWorker: string | null = null;

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
    if (this.activeWorker) throw new Error(`Sync-Worker '${this.activeWorker}' läuft bereits.`);
    this.activeWorker = type;
    const runId = crypto.randomUUID();
    const runtime = this.loadRuntime();
    runtime.lastRun = { runId, type, status: 'running', startedAt: new Date().toISOString(), pages: 0, attempted: 0, confirmed: 0 };
    this.saveRuntime(runtime);
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
    try { return { ...this.state, lastRun: this.loadRuntime().lastRun }; }
    catch { return { ...this.state }; }
  }

  public static updateCounts(live: number, unresolved: number) {
    this.state.liveDesignsCount = live;
    this.state.unresolvedAsinsCount = unresolved;
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
        } catch (e) {}
      }
    }, 60 * 1000);

    this.textCatchupTimer = setInterval(async () => {
      if (this.state.autoUpdateEnabled && !this.state.isScanning) {
        try { await this.runDeepScanNew(); } catch (e: any) { this.addLog(`[Text-Catch-up] Fehler: ${e.message}`, 'error'); }
      }
    }, 6 * 60 * 60 * 1000);
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
    if (this.cachedAccountId) return this.cachedAccountId;

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

  private static async refreshTextsForConfirmedDesigns(page: any, supabase: any, mapped: any[]): Promise<{ processed: number; errors: number }> {
    if (mapped.length === 0) return { processed: 0, errors: 0 };
    const runtime = this.loadRuntime();
    const versions = runtime.textVersions || {};
    const existing = new Map<string, any>();
    const ids = mapped.map(item => item.design_id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('mba_designs').select('design_id, title_us, brand_us, text_data_other').in('design_id', ids.slice(i, i + 200));
      if (error) throw new Error(`Text-Bestandsread fehlgeschlagen: ${error.message || String(error)}`);
      for (const row of data || []) existing.set(row.design_id, row);
    }
    let processed = 0;
    let errors = 0;
    for (const item of mapped) {
      if (this.shouldStop) break;
      const row = existing.get(item.design_id);
      const sourceVersion = item.updated_date || item.last_synced_at || '';
      const missing = !row?.title_us || !row?.brand_us || !row?.text_data_other || Object.keys(row.text_data_other || {}).length === 0;
      if (!missing && versions[item.design_id] === sourceVersion) continue;
      try {
        const payload = this.parseTextData(item.design_id, await this.fetchProductConfig(page, item.design_id));
        if (!payload) throw new Error('ProductConfig enthält keine Textdaten.');
        const { error } = await supabase.from('mba_designs').upsert(payload, { onConflict: 'design_id' });
        if (error) throw new Error(error.message || String(error));
        versions[item.design_id] = sourceVersion;
        processed++;
      } catch (error: any) {
        errors++;
        this.addLog(`[Textfolgejob] ${item.design_id} bleibt offen: ${error.message}`, 'warn');
      }
      await this.sleep(150);
    }
    runtime.textVersions = Object.fromEntries(Object.entries(versions).slice(-10000));
    this.saveRuntime(runtime);
    return { processed, errors };
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
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const [liveRes, unresolvedRes] = await Promise.all([
        supabase.from('mba_designs')
          .select('design_id', { count: 'exact', head: true })
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING']),
        supabase.from('mba_designs')
          .select('design_id', { count: 'exact', head: true })
          .or('asin_resolved.eq.false,asin_resolved.is.null')
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
      ]);

      this.state.liveDesignsCount = liveRes.count || 0;
      this.state.unresolvedAsinsCount = unresolvedRes.count || 0;
    } catch (e) {}
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
  public static async mergeAndUpsertDesigns(mapped: any[]) {
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
          asin_resolved: adAsins.every((ad: any) => !VARIANT_PRODUCT_TYPES.has(String(ad.type || '').toUpperCase()) || (!!ad.asin && ad.asin !== ad.parentAsin))
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
      const fullyResolved = adAsins.every((ad: any) => !VARIANT_PRODUCT_TYPES.has(String(ad.type || '').toUpperCase()) || (!!ad.asin && ad.asin !== ad.parentAsin));

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
      const chunk = writable.slice(i, i + 200);
      const { error } = await supabase.from('mba_designs').upsert(chunk, { onConflict: 'design_id' });
      if (error) {
        throw new Error(`Supabase-Upsert fehlgeschlagen (Block ${Math.floor(i / 200) + 1}): ${error.message || String(error)}`);
      }
      confirmed += chunk.length;
    }

    await this.refreshDBStats();
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

      if (VARIANT_PRODUCT_TYPES.has((p.type || '').toUpperCase())) {
        if (exAsin && exAsin !== cleanParentAsin && oldParent === cleanParentAsin) {
          return { asin: exAsin, parentAsin: cleanParentAsin, type: p.type, market: p.market };
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

      const supabase = this.getSupabase();
      let pageToken: any[] = [];
      const allResults: any[] = [];
      const seenTokens = new Set<string>(['[]']);
      const runtime = this.loadRuntime();
      const accountKey = crypto.createHash('sha256').update(accountId || 'unknown').digest('hex').slice(0, 16);
      const lowerBoundary = runtime.accountKey === accountKey && runtime.productWatermark
        ? new Date(Date.parse(runtime.productWatermark) - 24 * 60 * 60 * 1000).toISOString()
        : null;
      let coveredBoundary = false;
      let hasMore = false;

      for (let p = 0; p < 10; p++) {
        if (this.shouldStop) break;
        const json = await this.fetchListingsPage(page, accountId, pageToken);
        pages++;
        if (!json.results || json.results.length === 0) break;

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
          if (oldestIso && oldestIso <= lowerBoundary) { coveredBoundary = true; break; }
        }

        if (!json.pageToken || json.pageToken.length === 0) { coveredBoundary = true; break; }
        const tokenKey = JSON.stringify(json.pageToken);
        if (seenTokens.has(tokenKey)) throw new Error('FindListings-Pagination wiederholt denselben Token ohne Fortschritt.');
        seenTokens.add(tokenKey);
        pageToken = json.pageToken;
        hasMore = true;
        await this.sleep(600);
      }

      if (this.shouldStop) throw new Error('Scan manuell abgebrochen.');

      this.addLog(`[Quick Update Produkte] ${allResults.length} Einträge von Amazon geladen. Mappe auf Supabase...`, 'info');
      const mapped = this.mapListingsToSupabase(allResults);
      const count = await this.mergeAndUpsertDesigns(mapped);
      const textResult = await this.refreshTextsForConfirmedDesigns(page, supabase, mapped);
      if (textResult.processed || textResult.errors) this.addLog(`[Textfolgejob] ${textResult.processed} aktualisiert, ${textResult.errors} offen.`, textResult.errors ? 'warn' : 'success');
      const completeCoverage = coveredBoundary && !(hasMore && pages >= 10 && !coveredBoundary);
      if (completeCoverage && runtime.productWatermark) {
        const watermarkRuntime = this.loadRuntime();
        watermarkRuntime.productWatermark = runStartedAt;
        watermarkRuntime.accountKey = accountKey;
        this.saveRuntime(watermarkRuntime);
      }

      const now = Date.now();
      this.state.lastQuickDesigns = now;
      this.state.lastPeriodicSync = new Date().toLocaleString('de-DE');
      this.state.lastPeriodicSyncCount = count;

      await this.refreshDBStats();
      this.addLog(
        completeCoverage
          ? `[Quick Update Produkte] Vollständig: ${count} Designs bestätigt ✓ (${this.state.liveDesignsCount} Live Designs).`
          : `[Quick Update Produkte] ${count} Designs bestätigt, Lauf aber nicht vollständig abgedeckt. Full Refresh erforderlich.`,
        completeCoverage ? 'success' : 'warn'
      );
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = completeCoverage ? `Bereit (${this.state.liveDesignsCount} Live Designs)` : `Teilstand bestätigt; historische Reconciliation offen`;
      this.finishWorker(runId, completeCoverage ? 'complete' : 'truncated', { pages, attempted: mapped.length, confirmed: count, message: completeCoverage ? undefined : 'Keine vertrauenswürdige Vollständigkeitsmarke; Full Refresh erforderlich.' });
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
        if (!json.results || json.results.length === 0) break;

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
      const mapped = this.mapListingsToSupabase(allResults);
      const totalSaved = await this.mergeAndUpsertDesigns(mapped);
      const runtime = this.loadRuntime();
      runtime.productWatermark = runStartedAt;
      runtime.accountKey = crypto.createHash('sha256').update(accountId || 'unknown').digest('hex').slice(0, 16);
      this.saveRuntime(runtime);
      try { if (fs.existsSync(FULL_STAGE_PATH)) fs.unlinkSync(FULL_STAGE_PATH); } catch {}

      this.state.lastFullDesigns = Date.now();
      await this.refreshDBStats();
      this.addLog(`[Full Refresh Produkte] Beendet. ${totalSaved} Designs erfolgreich in Supabase synchronisiert ✓ (${this.state.liveDesignsCount} Live Designs).`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = `Bereit (${this.state.liveDesignsCount} Live Designs)`;
      this.finishWorker(runId, 'complete', { pages: pageNum, attempted: mapped.length, confirmed: totalSaved });
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
        .limit(Math.max(50, limit * 10));

      if (error) throw new Error(`ASIN-Queue konnte nicht gelesen werden: ${error.message || String(error)}`);
      if (!unresolved || unresolved.length === 0) return { processed: 0, errors: 0 };

      let selected = 0;
      for (const item of unresolved) {
        if (selected >= limit) break;
        if (this.shouldStop) break;
        const pubProducts: any[] = item.published_products || [];
        const newAdAsins: any[] = this.buildAdAsins(pubProducts, item.ad_asins || [], pubProducts);

        const toResolve: { ad: any; parent: any; retryKey: string }[] = [];
        for (const ad of newAdAsins) {
          if (!VARIANT_PRODUCT_TYPES.has((ad.type || '').toUpperCase())) continue;
          const parent = pubProducts.find(p => (p.type || '').toUpperCase() === (ad.type || '').toUpperCase() && (p.market || '').toLowerCase() === (ad.market || '').toLowerCase());
          if (!parent || !parent.asin) continue;
          if (!ad.asin || ad.asin === parent.asin) {
            const retryKey = `${item.design_id}:${String(ad.market).toLowerCase()}:${String(ad.type).toUpperCase()}`;
            const retry = retryState[retryKey];
            if (!retry || retry.parentAsin !== parent.asin || Date.parse(retry.nextAt) <= Date.now()) toResolve.push({ ad, parent, retryKey });
          }
        }
        if (toResolve.length === 0) {
          const alreadyResolved = newAdAsins.every((ad: any) => !VARIANT_PRODUCT_TYPES.has(String(ad.type || '').toUpperCase()) || (!!ad.asin && ad.asin !== ad.parentAsin));
          if (alreadyResolved) {
            const { error: confirmError } = await supabase.from('mba_designs').update({ ad_asins: newAdAsins, asin_resolved: true }).eq('design_id', item.design_id);
            if (confirmError) errors++; else processed++;
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
          if (!VARIANT_PRODUCT_TYPES.has((ad.type || '').toUpperCase())) return true;
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
        }
      }
      runtime.resolverRetries = Object.fromEntries(Object.entries(retryState).slice(-5000));
      this.saveRuntime(runtime);
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

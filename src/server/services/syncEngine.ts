import { getSupabaseClient, loadSettings } from './settingsService';
import { BrowserSessionService } from './browserSessionService';

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
  'WATER_BOTTLE',
  'SOCCER_JERSEY'
]);

const ALL_STATUSES = ['DRAFT', 'TRANSLATING', 'REVIEW', 'DECLINED', 'AMAZON_REJECTED', 'PUBLISHING', 'TIMED_OUT', 'PROPAGATED', 'PUBLISHED', 'DELETED', 'LOCKED'];
const FIND_LISTINGS_URL = 'https://merch.amazon.com/api/ng-amazon/coral/com.amazon.merch.search.MerchSearchService/FindListings';
const PRODUCT_CONFIG_URL = 'https://merch.amazon.com/api/productconfiguration/get?id=';

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
    return { ...this.state };
  }

  public static updateCounts(live: number, unresolved: number) {
    this.state.liveDesignsCount = live;
    this.state.unresolvedAsinsCount = unresolved;
  }

  public static stopScan() {
    this.shouldStop = true;
    this.state.isScanning = false;
    this.state.activeScanType = null;
    this.state.scanStatus = 'ready';
    this.state.lastStatusMessage = 'Scan manuell abgebrochen.';
    this.addLog('Scan manuell abgebrochen.', 'warn');
  }

  public static toggleAutoUpdate(enabled: boolean) {
    this.state.autoUpdateEnabled = enabled;
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
  }

  private static stopSchedulers() {
    if (this.autoUpdateTimer) clearInterval(this.autoUpdateTimer);
    if (this.asinResolveTimer) clearInterval(this.asinResolveTimer);
    this.autoUpdateTimer = null;
    this.asinResolveTimer = null;
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
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          credentials: 'include'
        });

        if (resp.ok) return await resp.json();

        if (resp.status === 429 || resp.url?.includes('merch.amazon.com/429')) {
          console.log(`[FindListings] Rate limited (429), warte ${backoff}ms (Versuch ${retries + 1}/10)...`);
          await sleep(backoff);
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
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`ProductConfig HTTP ${res.status}`);
      return await res.json();
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
      const mp = r.marketplace?.toLowerCase() || (MP_MAP[r.marketplaceId] || 'us');
      const pt = r.productType?.toLowerCase() || r.productType || '';
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

    const designIds = mapped.map(m => m.design_id);
    const existing = new Map<string, any>();

    for (let i = 0; i < designIds.length; i += 200) {
      const batch = designIds.slice(i, i + 200);
      const { data } = await supabase.from('mba_designs')
        .select('design_id, asins, asin_standard_tshirt_us, price_standard_tshirt_us, published_products, ad_asins')
        .in('design_id', batch);
      if (data) data.forEach(d => existing.set(d.design_id, d));
    }

    const merged = mapped.map(m => {
      const ex = existing.get(m.design_id);
      if (!ex) {
        return {
          ...m,
          ad_asins: this.buildAdAsins(m.published_products, [])
        };
      }

      // Merge ASINs (Union)
      const allAsins = Array.from(new Set([...(ex.asins || []), ...(m.asins || [])]));
      
      // Merge published_products
      const prodMap = new Map();
      (ex.published_products || []).forEach((p: any) => prodMap.set(p.asin, p));
      (m.published_products || []).forEach((p: any) => prodMap.set(p.asin, p));
      if (m._deleted_asins) {
        m._deleted_asins.forEach((asin: string) => prodMap.delete(asin));
      }
      const pubProducts = Array.from(prodMap.values());

      return {
        ...m,
        asins: allAsins,
        published_products: pubProducts,
        asin_standard_tshirt_us: m.asin_standard_tshirt_us || ex.asin_standard_tshirt_us,
        price_standard_tshirt_us: m.price_standard_tshirt_us || ex.price_standard_tshirt_us,
        ad_asins: this.buildAdAsins(pubProducts, ex.ad_asins || [])
      };
    });

    for (let i = 0; i < merged.length; i += 200) {
      const chunk = merged.slice(i, i + 200);
      const { error } = await supabase.from('mba_designs').upsert(chunk, { onConflict: 'design_id' });
      if (error) {
        console.error('[SyncEngine] Error upserting designs chunk:', error);
      }
    }

    await this.refreshDBStats();
    return merged.length;
  }

  public static buildAdAsins(publishedProducts: any[], existingAdAsins: any[] = []) {
    const existingMap = new Map();
    existingAdAsins.forEach(ad => {
      if (ad.type && ad.market) {
        existingMap.set(`${ad.type.toUpperCase()}_${ad.market.toLowerCase()}`, ad.asin);
      }
    });

    return publishedProducts.map(p => {
      const key = `${(p.type || '').toUpperCase()}_${(p.market || '').toLowerCase()}`;
      const exAsin = existingMap.get(key);

      if (VARIANT_PRODUCT_TYPES.has((p.type || '').toUpperCase())) {
        if (exAsin && exAsin !== p.asin) {
          return { asin: exAsin, type: p.type, market: p.market };
        }
        return { asin: null, type: p.type, market: p.market };
      }

      return { asin: p.asin, type: p.type, market: p.market };
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

      const { data: latest } = await supabase
        .from('mba_designs')
        .select('updated_date')
        .order('updated_date', { ascending: false })
        .limit(1);
      const lastUpdated = latest?.[0]?.updated_date || null;

      for (let p = 0; p < 10; p++) {
        if (this.shouldStop) break;
        const json = await this.fetchListingsPage(page, accountId, pageToken);
        if (!json.results || json.results.length === 0) break;

        allResults.push(...json.results);

        if (lastUpdated) {
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
          if (oldestIso && oldestIso <= lastUpdated) break;
        }

        if (!json.pageToken || json.pageToken.length === 0) break;
        pageToken = json.pageToken;
        await this.sleep(600);
      }

      this.addLog(`[Quick Update Produkte] ${allResults.length} Einträge von Amazon geladen. Mappe auf Supabase...`, 'info');
      const mapped = this.mapListingsToSupabase(allResults);
      const count = await this.mergeAndUpsertDesigns(mapped);

      const now = Date.now();
      this.state.lastQuickDesigns = now;
      this.state.lastPeriodicSync = new Date().toLocaleString('de-DE');
      this.state.lastPeriodicSyncCount = count;

      await this.refreshDBStats();
      this.addLog(`[Quick Update Produkte] Erfolgreich synchronisiert: ${count} Designs in Supabase aktualisiert ✓ (${this.state.liveDesignsCount} Live Designs).`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = `Bereit (${this.state.liveDesignsCount} Live Designs)`;
      return { designCount: count };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Quick Update Produkte] Fehler: ${err.message}`, 'error');
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

      while (!this.shouldStop) {
        pageNum++;
        this.addLog(`[Full Refresh] Lade Seite ${pageNum} von Amazon (je 500 Einträge)...`, 'info');
        const json = await this.fetchListingsPage(page, accountId, pageToken);
        if (!json.results || json.results.length === 0) break;

        allResults.push(...json.results);
        this.addLog(`[Full Refresh] Bisher ${allResults.length} Einträge gesammelt...`, 'info');

        if (!json.pageToken || json.pageToken.length === 0) break;
        pageToken = json.pageToken;
        await this.sleep(1000);
      }

      this.addLog(`[Full Refresh] Mappe ${allResults.length} Einträge auf Supabase Schema...`, 'info');
      const mapped = this.mapListingsToSupabase(allResults);
      const totalSaved = await this.mergeAndUpsertDesigns(mapped);

      this.state.lastFullDesigns = Date.now();
      await this.refreshDBStats();
      this.addLog(`[Full Refresh Produkte] Beendet. ${totalSaved} Designs erfolgreich in Supabase synchronisiert ✓ (${this.state.liveDesignsCount} Live Designs).`, 'success');
      this.state.scanStatus = 'ready';
      this.state.lastStatusMessage = `Bereit (${this.state.liveDesignsCount} Live Designs)`;
      return { designCount: totalSaved };
    } catch (err: any) {
      this.state.scanStatus = 'error';
      this.state.lastStatusMessage = `Fehler: ${err.message}`;
      this.addLog(`[Full Refresh Produkte] Fehler: ${err.message}`, 'error');
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

      const { data: missingDesigns, error } = await supabase.from('mba_designs')
        .select('design_id')
        .is('title_us', null)
        .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
        .limit(50);

      if (error) throw error;

      if (!missingDesigns || missingDesigns.length === 0) {
        this.addLog('[Quick Update Listings] Keine fehlenden Texte gefunden. Alles aktuell! ✓', 'success');
      } else {
        this.addLog(`[Quick Update Listings] ${missingDesigns.length} Designs gefunden. Lade Texte...`, 'info');
        for (const item of missingDesigns) {
          if (this.shouldStop) break;
          try {
            const config = await this.fetchProductConfig(page, item.design_id);
            const textData = this.parseTextData(item.design_id, config);
            if (textData) {
              await supabase.from('mba_designs').upsert(textData);
              processed++;
            }
          } catch (e: any) {
            console.warn(`[SyncEngine] Config error for ${item.design_id}:`, e.message);
          }
          await this.sleep(150);
        }
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
              await supabase.from('mba_designs').upsert(textData);
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
      const { data: unresolved, error } = await supabase.from('mba_designs')
        .select('design_id, published_products, ad_asins')
        .or('asin_resolved.eq.false,asin_resolved.is.null')
        .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
        .limit(limit);

      if (error || !unresolved || unresolved.length === 0) return { processed: 0, errors: 0 };

      for (const item of unresolved) {
        if (this.shouldStop) break;
        const pubProducts: any[] = item.published_products || [];
        const newAdAsins: any[] = this.buildAdAsins(pubProducts, item.ad_asins || []);

        const toResolve: { ad: any; parent: any }[] = [];
        for (const ad of newAdAsins) {
          if (!VARIANT_PRODUCT_TYPES.has((ad.type || '').toUpperCase())) continue;
          const parent = pubProducts.find(p => (p.type || '').toUpperCase() === (ad.type || '').toUpperCase() && (p.market || '').toLowerCase() === (ad.market || '').toLowerCase());
          if (!parent || !parent.asin) continue;
          if (!ad.asin || ad.asin === parent.asin) {
            toResolve.push({ ad, parent });
          }
        }

        for (const { ad, parent } of toResolve) {
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
              this.addLog(`[ASIN Scanner] Produkt ${parent.asin} (${ad.market}) nicht gefunden (404). Parent-ASIN gesetzt.`, 'warn');
              ad.asin = parent.asin;
              continue;
            }

            const html = await response.text();

            // Detect CAPTCHA or Robot Check
            if (html.includes('/errors/validateCaptcha') || html.includes('Robot Check') || response.status === 503 || response.status === 403) {
              this.addLog(`[ASIN Scanner] ⚠️ Amazon Rate-Limit / Captcha für ${parent.asin} (${ad.market}). Pausiere...`, 'warn');
              await this.sleep(3000);
              continue;
            }

            if (html) {
              const matchDimensionMap = html.match(/"dimensionToAsinMap"\s*:\s*({[^}]+})/);
              const matchAsinToDimension = html.match(/"asinToDimension"\s*:\s*({[^}]+})/);
              const matchSelectedVar = html.match(/"selectedVariationASIN"\s*:\s*"([A-Z0-9]{10})"/);
              const matchDataAsin = html.match(/data-defaultAsin="([A-Z0-9]{10})"/);
              const matchDataCsa = html.match(/data-csa-c-item-id="([A-Z0-9]{10})"/);
              const matchFallbackAsin = html.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/);

              let resolvedChild: string | null = null;
              if (matchDimensionMap && matchDimensionMap[1]) {
                try {
                  const asinMap = JSON.parse(matchDimensionMap[1]);
                  const asins = Object.values(asinMap).filter((a: any) => a && a !== parent.asin);
                  if (asins.length > 0) resolvedChild = asins[0] as string;
                } catch {}
              }

              if (!resolvedChild && matchAsinToDimension && matchAsinToDimension[1]) {
                try {
                  const asinMap = JSON.parse(matchAsinToDimension[1]);
                  const asins = Object.keys(asinMap).filter((a: any) => a && a !== parent.asin);
                  if (asins.length > 0) resolvedChild = asins[0] as string;
                } catch {}
              }

              if (!resolvedChild && matchSelectedVar && matchSelectedVar[1] && matchSelectedVar[1] !== parent.asin) {
                resolvedChild = matchSelectedVar[1];
              }

              if (!resolvedChild && matchDataAsin && matchDataAsin[1] && matchDataAsin[1] !== parent.asin) {
                resolvedChild = matchDataAsin[1];
              }

              if (!resolvedChild && matchDataCsa && matchDataCsa[1] && matchDataCsa[1] !== parent.asin) {
                resolvedChild = matchDataCsa[1];
              }

              if (!resolvedChild && matchFallbackAsin && matchFallbackAsin[1] && matchFallbackAsin[1] !== parent.asin) {
                resolvedChild = matchFallbackAsin[1];
              }

              if (resolvedChild) {
                ad.asin = resolvedChild;
                this.addLog(`[ASIN Scanner] ✓ Child-ASIN aufgelöst für ${ad.type} (${ad.market}): ${parent.asin} ➔ ${resolvedChild}`, 'success');
              } else {
                ad.asin = parent.asin;
                this.addLog(`[ASIN Scanner] Keine abweichende Child-ASIN für ${ad.type} (${ad.market}) gefunden. Verwende ${parent.asin}.`, 'info');
              }
            } else {
              ad.asin = parent.asin;
            }
          } catch (e: any) {
            errors++;
            ad.asin = parent.asin;
            this.addLog(`[ASIN Scanner] Fehler bei ${parent.asin} (${ad.market}): ${e.message}`, 'error');
          }
          await this.sleep(1800 + Math.random() * 800);
        }

        await supabase.from('mba_designs').update({
          ad_asins: newAdAsins,
          asin_resolved: true
        }).eq('design_id', item.design_id);
        processed++;
      }
    } catch (err: any) {
      console.warn('[SyncEngine] ASIN batch error:', err.message);
    }

    this.state.lastAsinSync = new Date().toLocaleString('de-DE');
    await this.refreshDBStats();
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
}

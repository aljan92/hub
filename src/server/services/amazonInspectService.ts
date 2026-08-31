import fs from 'fs';
import path from 'path';
import { BrowserSessionService } from './browserSessionService';
import { SyncEngine } from './syncEngine';
import { TaskLogService } from './taskLogService';

const FIND_LISTINGS_URL = 'https://merch.amazon.com/api/ng-amazon/coral/com.amazon.merch.search.MerchSearchService/FindListings';
const PRODUCT_CONFIG_URL = 'https://merch.amazon.com/api/productconfiguration/get?id=';
const ALL_STATUSES = ['DRAFT', 'TRANSLATING', 'REVIEW', 'DECLINED', 'AMAZON_REJECTED', 'PUBLISHING', 'TIMED_OUT', 'PROPAGATED', 'PUBLISHED', 'DELETED', 'LOCKED'];

export interface AmazonInspectResult {
  success: boolean;
  endpoint: 'productconfig' | 'findlistings';
  designId?: string;
  url?: string;
  data?: any;
  error?: string;
  status?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

export class AmazonInspectService {
  /**
   * Ensure Session 1 is open and on merch.amazon.com
   */
  private static async getAuthenticatedPage() {
    const session = await BrowserSessionService.getSession('sync');
    const currentUrl = session.page.url();
    if (!currentUrl.includes('merch.amazon.com')) {
      await session.page.goto('https://merch.amazon.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    return session.page;
  }

  /**
   * Fetch Product Config (Listing texts, brands, bullets, descriptions, colors, products)
   */
  public static async inspectProductConfig(designId: string): Promise<AmazonInspectResult> {
    const cleanId = (designId || '').replace(/^#/, '').replace(/-U$/, '').trim();
    const timestamp = new Date().toISOString();
    const targetUrl = `${PRODUCT_CONFIG_URL}${cleanId}`;

    if (!cleanId) {
      return {
        success: false,
        endpoint: 'productconfig',
        designId: cleanId,
        error: 'Keine Design-ID (UUID) angegeben.',
        timestamp
      };
    }

    try {
      const page = await this.getAuthenticatedPage();

      const result = await page.evaluate(async ({ url, dId }) => {
        try {
          const resp = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'include'
          });

          const status = resp.status;
          const ok = resp.ok;
          const redirectedToLogin = resp.url?.includes('signin') || resp.url?.includes('ap/signin');

          if (redirectedToLogin) {
            return {
              ok: false,
              status: 401,
              error: 'Session 1 ist ausgeloggt (Weiterleitung auf Amazon Login).',
              data: null
            };
          }

          let json = null;
          let text = '';
          try {
            json = await resp.json();
          } catch (e) {
            text = await resp.text().catch(() => '');
          }

          return {
            ok,
            status,
            data: json || text,
            error: ok ? null : `HTTP ${status}: ${resp.statusText || text || 'Fehler beim Abruf'}`
          };
        } catch (fetchErr: any) {
          return {
            ok: false,
            status: 0,
            error: fetchErr.message || 'Netzwerkfehler im Browserkontext',
            data: null
          };
        }
      }, { url: targetUrl, dId: cleanId });

      return {
        success: result.ok,
        endpoint: 'productconfig',
        designId: cleanId,
        url: targetUrl,
        data: result.data,
        error: result.error || undefined,
        status: result.status,
        timestamp,
        metadata: {
          hasTextData: !!(result.data && typeof result.data === 'object' && result.data.textData),
          languages: result.data?.textData ? Object.keys(result.data.textData) : []
        }
      };
    } catch (err: any) {
      return {
        success: false,
        endpoint: 'productconfig',
        designId: cleanId,
        url: targetUrl,
        error: `Browser Session Fehler: ${err.message}`,
        timestamp
      };
    }
  }

  /**
   * Query FindListings Coral RPC and extract status & product information
   */
  public static async inspectFindListings(designId?: string): Promise<AmazonInspectResult> {
    const cleanId = (designId || '').trim();
    const timestamp = new Date().toISOString();

    try {
      const page = await this.getAuthenticatedPage();
      const accountId = await SyncEngine.getAccountId(page);

      const result = await page.evaluate(async ({ accountId, url, allStatuses, targetDesignId }) => {
        const body = {
          pageSize: 500,
          sortField: 'DateUpdated',
          sortOrder: 'Descending',
          status: allStatuses,
          marketplaces: null,
          productTypes: null,
          searchableOnRetail: null,
          deleteReasonType: ['', 'CONTENT_POLICY_VIOLATION', 'INACTIVE_NO_SALES', 'CONTENT_CREATOR'],
          accountId: accountId || null,
          pageToken: [],
          __type: 'com.amazon.merch.search#FindListingsRequest'
        };

        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            credentials: 'include'
          });

          const status = resp.status;
          const ok = resp.ok;

          if (resp.url?.includes('signin') || resp.url?.includes('ap/signin')) {
            return {
              ok: false,
              status: 401,
              error: 'Session 1 ist ausgeloggt (Weiterleitung auf Amazon Login).',
              data: null
            };
          }

          let json: any = null;
          let text = '';
          try {
            json = await resp.json();
          } catch (e) {
            text = await resp.text().catch(() => '');
          }

          if (!ok) {
            return {
              ok: false,
              status,
              error: `FindListings HTTP ${status}: ${resp.statusText || text}`,
              data: json || text
            };
          }

          const rawResults = json?.results || [];
          let filteredResults = rawResults;
          let isDesignMatched = false;

          if (targetDesignId) {
            filteredResults = rawResults.filter((r: any) => 
              (r.designId && r.designId.toLowerCase() === targetDesignId.toLowerCase()) ||
              (r.asin && r.asin.toLowerCase() === targetDesignId.toLowerCase()) ||
              (r.listingId && r.listingId.toLowerCase() === targetDesignId.toLowerCase())
            );
            isDesignMatched = filteredResults.length > 0;
          }

          // Summarize statuses
          const statusSummary: Record<string, number> = {};
          for (const item of filteredResults) {
            const st = item.status || 'UNKNOWN';
            statusSummary[st] = (statusSummary[st] || 0) + 1;
          }

          return {
            ok: true,
            status,
            data: {
              targetDesignId: targetDesignId || null,
              matchedResultsCount: filteredResults.length,
              totalResultsInBatch: rawResults.length,
              statusSummary,
              isDesignMatched,
              items: targetDesignId ? filteredResults : rawResults.slice(0, 50),
              rawFullResponse: targetDesignId ? { ...json, results: filteredResults } : json
            },
            error: null
          };
        } catch (fetchErr: any) {
          return {
            ok: false,
            status: 0,
            error: fetchErr.message || 'Netzwerkfehler im Browserkontext',
            data: null
          };
        }
      }, { accountId, url: FIND_LISTINGS_URL, allStatuses: ALL_STATUSES, targetDesignId: cleanId });

      return {
        success: result.ok,
        endpoint: 'findlistings',
        designId: cleanId,
        url: FIND_LISTINGS_URL,
        data: result.data,
        error: result.error || undefined,
        status: result.status,
        timestamp,
        metadata: {
          matchedCount: result.data?.matchedResultsCount || 0,
          isDesignMatched: !!result.data?.isDesignMatched,
          statusSummary: result.data?.statusSummary || {}
        }
      };
    } catch (err: any) {
      return {
        success: false,
        endpoint: 'findlistings',
        designId: cleanId,
        url: FIND_LISTINGS_URL,
        error: `Browser Session Fehler: ${err.message}`,
        timestamp
      };
    }
  }

  // Helper to normalize Amazon marketplace codes to standard 2-letter country codes
  public static normalizeMarketplace(raw: string): string {
    const s = String(raw).trim().toUpperCase();
    if (['US', '1', 'COM', 'AMAZON.COM', 'ATVPDKIKX0DER'].includes(s)) return 'US';
    if (['GB', 'UK', '3', 'CO.UK', 'AMAZON.CO.UK', 'A1F83G8C2ARO7P'].includes(s)) return 'GB';
    if (['DE', '4', 'AMAZON.DE', 'A1PA6795UKMFR9'].includes(s)) return 'DE';
    if (['FR', '5', 'AMAZON.FR', 'A13V1IB3VIYZZH'].includes(s)) return 'FR';
    if (['IT', '6', 'AMAZON.IT', 'APJ6JRA9NG5V4'].includes(s)) return 'IT';
    if (['ES', '7', 'AMAZON.ES', 'A1RKKUPIHCS9HS'].includes(s)) return 'ES';
    if (['JP', '8', 'CO.JP', 'AMAZON.CO.JP', 'A1VC38T7YXB528'].includes(s)) return 'JP';
    return s;
  }

  // Helper to normalize Amazon product keys to catalog product IDs
  public static normalizeProductKey(raw: string): string {
    const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
    if (['STANDARD_TSHIRT', 'STANDARD_T_SHIRT', 'TSHIRT', 'STANDARD'].includes(s)) return 'STANDARD_TSHIRT';
    if (['VALUE_GRAPHIC_TSHIRT', 'VALUE_GRAPHIC_T_SHIRT', 'VALUE_TSHIRT', 'VALUE_T_SHIRT'].includes(s)) return 'VALUE_GRAPHIC_TSHIRT';
    if (['PREMIUM_TSHIRT', 'PREMIUM_T_SHIRT', 'PREMIUM'].includes(s)) return 'PREMIUM_TSHIRT';
    if (['COMFORT_COLORS_HEAVYWEIGHT_TSHIRT', 'COMFORT_COLORS', 'HEAVYWEIGHT_TSHIRT', 'COMFORT_COLORS_TSHIRT'].includes(s)) return 'COMFORT_COLORS_HEAVYWEIGHT_TSHIRT';
    if (['VNECK_TSHIRT', 'VNECK', 'V_NECK', 'V_NECK_TSHIRT', 'V_NECK_T_SHIRT'].includes(s)) return 'VNECK_TSHIRT';
    if (['TANK_TOP', 'TANKTOP', 'TANK'].includes(s)) return 'TANK_TOP';
    if (['LONG_SLEEVE_TSHIRT', 'LONG_SLEEVE_T_SHIRT', 'LONGSLEEVE', 'LONG_SLEEVE'].includes(s)) return 'LONG_SLEEVE_TSHIRT';
    if (['RAGLAN', 'BASEBALL_TEE', 'RAGLAN_TSHIRT'].includes(s)) return 'RAGLAN';
    if (['SOCCER_JERSEY', 'SOCCER'].includes(s)) return 'SOCCER_JERSEY';
    if (['BASKETBALL_JERSEY', 'BASKETBALL'].includes(s)) return 'BASKETBALL_JERSEY';
    if (['SWEATSHIRT', 'SWEAT_SHIRT'].includes(s)) return 'SWEATSHIRT';
    if (['PULLOVER_HOODIE', 'HOODIE', 'PULLOVER'].includes(s)) return 'PULLOVER_HOODIE';
    if (['ZIP_HOODIE', 'ZIPHOODIE', 'ZIPPER_HOODIE'].includes(s)) return 'ZIP_HOODIE';
    if (['POPSOCKET', 'POPSOCKETS', 'POP_SOCKET', 'POP_SOCKETS'].includes(s)) return 'POPSOCKET';
    if (['IPHONE_CASE', 'IPHONE_CASES', 'IPHONE'].includes(s)) return 'IPHONE_CASE';
    if (['SAMSUNG_GALAXY_CASE', 'SAMSUNG_CASE', 'SAMSUNG', 'SAMSUNG_GALAXY_CASES'].includes(s)) return 'SAMSUNG_GALAXY_CASE';
    if (['TOTE_BAG', 'TOTE_BAGS', 'TOTEBAG', 'TOTEBAGS', 'BAG'].includes(s)) return 'TOTE_BAG';
    if (['THROW_PILLOW', 'THROW_PILLOWS', 'PILLOW', 'PILLOWS'].includes(s)) return 'THROW_PILLOW';
    if (['TUMBLER', 'TUMBLERS'].includes(s)) return 'TUMBLER';
    return s;
  }

  /**
   * Create an UPDATE task in TaskLogService from fetched Amazon Merch data
   */
  public static async createUpdateTaskFromAmazon(designId: string): Promise<any> {
    const cleanId = (designId || '').replace(/^#/, '').replace(/-U$/, '').trim();
    if (!cleanId) {
      throw new Error('Keine Design-ID (UUID) angegeben.');
    }

    // 1. Fetch Product Config (Authoritative source for design products, textData & artwork)
    const configRes = await this.inspectProductConfig(cleanId);
    if (!configRes.success || !configRes.data) {
      throw new Error(configRes.error || `Product Config für Design ${cleanId} konnte nicht von Amazon geladen werden.`);
    }

    const configData = configRes.data;
    const textData = configData.textData || {};
    const masterListing = textData.en || textData.de || Object.values(textData)[0] || {};
    const title = masterListing.title || 'Amazon Merch Update Task';
    const brand = masterListing.brandName || '';
    const bullets = masterListing.bullets || [];
    const description = masterListing.description || '';

    // Collect products summary & calculate configured slots
    const products = configData.products || {};
    const productTypes: string[] = [];
    let totalConfiguredSlots = 0;
    const productSummary: Record<string, any> = {};

    for (const [pKey, pVal] of Object.entries<any>(products)) {
      const normalizedKey = AmazonInspectService.normalizeProductKey(pKey);
      productTypes.push(normalizedKey);
      const rawMarketplaces = Object.keys(pVal.marketplaceData || {});
      const normalizedMarketplaces = Array.from(new Set(rawMarketplaces.map(AmazonInspectService.normalizeMarketplace)));
      totalConfiguredSlots += Math.max(1, normalizedMarketplaces.length);

      const entry = {
        fits: pVal.dimensions?.FIT || [],
        colors: pVal.dimensions?.COLOR || [],
        marketplaces: normalizedMarketplaces,
        artworkInstruction: pVal.artworkInstructions?.FRONT || pVal.artworkInstructions?.BACK || pVal.artworkInstructions?.POP_SOCKET || null
      };

      // Store under normalized key and original key for 100% lookup reliability
      productSummary[normalizedKey] = entry;
      if (pKey !== normalizedKey) {
        productSummary[pKey] = entry;
      }
    }

    if (productTypes.length === 0 && totalConfiguredSlots === 0) {
      throw new Error(`Design ${cleanId} hat keine konfigurierten Produkte auf Amazon.`);
    }

    // 2. Optional: Query FindListings (Coral RPC) to check for active locks/processing
    let statusSummary: Record<string, number> = {};
    let publishedCount = totalConfiguredSlots;
    let matchedItems: any[] = [];
    let findData: any = null;

    try {
      const findRes = await this.inspectFindListings(cleanId);
      if (findRes.success && findRes.data) {
        findData = findRes.data;
        statusSummary = findData.statusSummary || {};
        matchedItems = findData.items || [];
        const processingStatuses = ['PUBLISHING', 'PROCESSING', 'TRANSLATING', 'REVIEW', 'UNDER_REVIEW', 'LOCKED', 'PENDING'];
        const activeProcessing = processingStatuses.filter(s => (statusSummary[s] || 0) > 0);

        if (activeProcessing.length > 0) {
          const details = activeProcessing.map(s => `${s}: ${statusSummary[s]}`).join(', ');
          throw new Error(`Design ${cleanId} ist aktuell auf Amazon gesperrt/in Bearbeitung (${details}).`);
        }

        if (findData.isDesignMatched) {
          const directPublished = (statusSummary.PUBLISHED || 0) + (statusSummary.PROPAGATED || 0);
          if (directPublished > 0) {
            publishedCount = directPublished;
          }
        }
      }
    } catch (fErr: any) {
      if (fErr.message?.includes('gesperrt/in Bearbeitung')) {
        throw fErr;
      }
      console.warn(`[AmazonInspectService] ℹ️ FindListings Vorab-Check für Design ${cleanId}: ${fErr.message}`);
    }

    const payload = {
      designId: cleanId,
      editUrl: `https://merch.amazon.com/designs/${cleanId}/edit`,
      globalArtworkUrn: configData.globalArtworkUrn || null,
      title,
      brand,
      bullets,
      description,
      masterListing,
      textData,
      productTypes,
      productSummary,
      liveStats: {
        totalVariantsFound: matchedItems.length > 0 ? matchedItems.length : totalConfiguredSlots,
        statusSummary: Object.keys(statusSummary).length > 0 ? statusSummary : { PUBLISHED: totalConfiguredSlots },
        publishedCount,
        isAllPublished: true,
        estimatedSlotSavings: `${publishedCount} Live-Varianten (0 Slot-Verbrauch)`
      },
      rawProductConfig: configData,
      rawFindListings: findData
    };

    // 3. Create TaskLog with source = 'UPDATE'
    const taskLog = TaskLogService.createTaskLog({
      source: 'UPDATE',
      payload
    });

    // 4. Add structured event detailing the fetched data
    TaskLogService.addEvent(taskLog.id, {
      type: 'TASK_HANDOFF',
      title: `Amazon Rohdaten erfasst (${publishedCount} Varianten konfiguriert)`,
      content: {
        designId: cleanId,
        editUrl: `https://merch.amazon.com/designs/${cleanId}/edit`,
        globalArtworkUrn: configData.globalArtworkUrn,
        masterListing: {
          title,
          brand,
          bullets,
          description: description.slice(0, 150) + (description.length > 150 ? '...' : '')
        },
        languagesAvailable: Object.keys(textData),
        configuredProductsCount: productTypes.length,
        liveVariantsCount: publishedCount,
        statusSummary
      }
    });

    // 5. Automatically trigger DOM inspection & Master Artwork Download to get 100% true live matrix & rejection check
    try {
      console.log(`[AmazonInspectService] 🔍 Führe sofortige DOM-Live-Inspektion & Artwork-Download für neuen Task ${taskLog.id} aus...`);
      await this.downloadDesignArtwork(taskLog.id, cleanId);
    } catch (dErr: any) {
      console.warn(`[AmazonInspectService] ⚠️ Initiale DOM-Inspektion für ${taskLog.id} fehlgeschlagen:`, dErr.message);
    }

    return TaskLogService.getTask(taskLog.id) || taskLog;
  }

  /**
   * Download the master design artwork (4500x5400 px PNG) from merch.amazon.com/designs/{designId}/edit
   * using an isolated background tab in Session 1 to prevent collisions with sync operations.
   * Also performs deterministic DOM inspection of the 'Select Products' table for 100% true live matrix.
   */
  public static async downloadDesignArtwork(taskId: string, designId: string): Promise<{ success: boolean; localUrl?: string; error?: string; hasRejection?: boolean; rejectionReason?: string | null }> {
    const cleanDesignId = (designId || '').trim();
    const cleanTaskId = (taskId || '').trim();
    if (!cleanDesignId || !cleanTaskId) {
      return { success: false, error: 'Task-ID oder Design-ID fehlt.' };
    }

    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    if (!fs.existsSync(designsDir)) {
      fs.mkdirSync(designsDir, { recursive: true });
    }

    const safeId = cleanTaskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeId}.png`;
    const filePath = path.join(designsDir, filename);

    const editUrl = `https://merch.amazon.com/designs/${cleanDesignId}/edit`;
    console.log(`[AmazonInspectService] 🖼️ Starte Artwork-Download & DOM-Live-Inspektion für Task ${cleanTaskId} (Design ${cleanDesignId}) via Session 1...`);

    // Set task to PROCESSING state so UI immediately shows downloading badge
    TaskLogService.updateTaskStatus(cleanTaskId, {
      status: 'PROCESSING',
      hasError: false
    });

    let newTab: any = null;
    try {
      const session = await BrowserSessionService.getSession('sync');
      newTab = await session.page.context().newPage();

      // Navigate to edit page
      await newTab.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 1. FIRST: Extract and download Master Artwork (Stable, proven sequence)
      await newTab.waitForSelector('img[alt$=".png"], img[alt="null"], img.artwork, #global-uploader-container img, .global-uploader img', { timeout: 25000 }).catch(() => null);

      const extractResult = await newTab.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img[alt$=".png"], img[alt="null"]'));
        let targetImg = images.find(e => e.getAttribute('alt') && e.getAttribute('alt')!.endsWith('.png'));
        if (!targetImg) {
          targetImg = images.find(e => e.getAttribute('alt') === 'null');
        }
        if (!targetImg) {
          targetImg = (document.querySelector('img.artwork.ng-star-inserted') ||
                       document.querySelector('.artwork') ||
                       document.querySelector('#global-uploader-container img') ||
                       document.querySelector('.global-uploader img')) as HTMLImageElement;
        }

        if (!targetImg || !(targetImg as HTMLImageElement).src) {
          return { ok: false, error: 'Kein Artwork Bild-Element auf der Amazon Edit-Seite gefunden.' };
        }

        const rawSrc = (targetImg as HTMLImageElement).src;
        // Strip downscaling modifiers (e.g. ._SR640,768_.png or ._AC_UX500_.jpg) to get full original resolution
        const fullResUrl = rawSrc.replace(/\._[^_]+_\.(png|jpg|jpeg)$/i, '.$1');
        return { ok: true, rawSrc, fullResUrl };
      });

      if (!extractResult.ok || !extractResult.fullResUrl) {
        throw new Error(extractResult.error || 'Konnte Original-Bild-URL im DOM nicht ermitteln.');
      }

      console.log(`[AmazonInspectService] 🔍 Full-Res URL gefunden: ${extractResult.fullResUrl}`);

      // Fetch image data inside authenticated browser context as Base64 Data URL
      const base64Data = await newTab.evaluate(async (imgUrl: string) => {
        try {
          const resp = await fetch(imgUrl, { credentials: 'include' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
          const blob = await resp.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('FileReader Fehler'));
            reader.readAsDataURL(blob);
          });
        } catch (fetchErr: any) {
          throw new Error(`Browser fetch failed: ${fetchErr.message}`);
        }
      }, extractResult.fullResUrl);

      // Write to disk
      const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');

      const designsDir = path.resolve(process.cwd(), 'data', 'designs');
      if (!fs.existsSync(designsDir)) {
        fs.mkdirSync(designsDir, { recursive: true });
      }

      const safeId = cleanTaskId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeId}.png`;
      const filePath = path.join(designsDir, filename);
      fs.writeFileSync(filePath, buffer);
      console.log(`[AmazonInspectService] 💾 Original-Design für ${cleanTaskId} erfolgreich gespeichert: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

      const localUrl = `/api/v1/designs/image/${encodeURIComponent(cleanTaskId)}`;

      // 2. SECOND: Check for page-level rejection banners or policy violations
      const pageRejectionInfo = await newTab.evaluate(() => {
        const alertElements = Array.from(document.querySelectorAll('.alert-danger, .alert-warning, .error-banner, .validation-error, [role="alert"]'));
        const alertText = alertElements.map(a => a.textContent?.trim() || '').filter(Boolean).join(' | ');
        const bodyText = document.body.innerText || '';
        const hasKeywords = /rejected|policy violation|content policy|copyright violation|trademark violation/i.test(bodyText);
        return {
          hasAlert: alertElements.length > 0 || hasKeywords,
          alertText: alertText || (hasKeywords ? 'Amazon Rejection / Policy Violation Text auf Seite erkannt' : '')
        };
      });

      // 3. THIRD: Open "Select Products" modal to inspect exact live matrix from DOM
      let domLiveSummary: Record<string, string[]> = {};
      let totalLiveSlots = 0;
      let rejectedOrDraftItems: string[] = [];

      try {
        const selectBtnSelector = '#select-marketplace-button-original, button:has-text("Select Products"), button:has-text("Produkte auswählen"), button.btn-outline-primary:has-text("Select"), [id*="select-marketplace"]';
        await newTab.waitForSelector(selectBtnSelector, { timeout: 25000 }).catch(() => null);
        const selectBtn = await newTab.$(selectBtnSelector);
        if (selectBtn) {
          console.log(`[AmazonInspectService] 🔍 Öffne 'Select Products' Popup im DOM für Task ${cleanTaskId}...`);
          await selectBtn.click().catch(() => null);
          await newTab.waitForSelector('.select-products-table, .modal-body table', { timeout: 15000 }).catch(() => null);

          const domResult = await newTab.evaluate(() => {
            const pubMap: Record<string, string[]> = {};
            let liveCount = 0;
            const draftOrRej: string[] = [];

            const checkboxes = Array.from(document.querySelectorAll('flowcheckbox[formcontrolname="shouldPublish"], flowcheckbox[class*="-"]'));
            for (const cb of checkboxes) {
              const className = cb.className || '';
              const match = className.match(/([A-Z0-9_]+)-([A-Z]{2})/);
              if (!match) continue;

              const rawProd = match[1];
              const mp = match[2].toUpperCase();

              const isReadonly = Boolean(
                cb.querySelector('span.readonly') ||
                cb.querySelector('input[readonly]') ||
                (cb.querySelector('i.sci-check-box') && cb.querySelector('span.readonly'))
              );
              const isChecked = Boolean(cb.querySelector('i.sci-check-box'));

              if (isReadonly) {
                if (!pubMap[rawProd]) pubMap[rawProd] = [];
                if (!pubMap[rawProd].includes(mp)) {
                  pubMap[rawProd].push(mp);
                  liveCount++;
                }
              } else if (isChecked && !isReadonly) {
                // Checked but not locked as readonly -> rejected item or unapproved draft
                draftOrRej.push(`${rawProd}-${mp}`);
              }
            }

            // Close modal cleanly
            const closeBtn = document.querySelector('button.close, .modal-header button, #select-marketplace-cancel-button') as HTMLElement;
            if (closeBtn) {
              closeBtn.click();
            }

            return { pubMap, liveCount, draftOrRej };
          });

          if (domResult && domResult.pubMap) {
            // Normalize product keys
            for (const [rKey, mps] of Object.entries<string[]>(domResult.pubMap)) {
              const normKey = AmazonInspectService.normalizeProductKey(rKey);
              domLiveSummary[normKey] = mps;
              if (rKey !== normKey) {
                domLiveSummary[rKey] = mps;
              }
            }
            totalLiveSlots = domResult.liveCount;
            rejectedOrDraftItems = domResult.draftOrRej || [];
            console.log(`[AmazonInspectService] 🎯 DOM Live-Inspektion erfolgreich: ${totalLiveSlots} Live-Slots über ${Object.keys(domLiveSummary).length} Produkte. Rejections/Drafts: ${rejectedOrDraftItems.length}`);
          }
        }
      } catch (domErr: any) {
        console.warn(`[AmazonInspectService] ⚠️ DOM-Inspektion für Select Products fehlgeschlagen (Fallback auf API-Daten):`, domErr.message);
      }

      // Determine rejection flag
      const hasRejection = pageRejectionInfo.hasAlert || rejectedOrDraftItems.length > 0;
      const rejectionReason = pageRejectionInfo.alertText || (rejectedOrDraftItems.length > 0 ? `Nicht publizierte/abgelehnte Produkte erkannt: ${rejectedOrDraftItems.join(', ')}` : null);

      // Update Task in TaskLogService with true DOM-scanned product summary & rejection status
      const currentTask = TaskLogService.getTask(cleanTaskId);
      const updatedPayload = {
        ...(currentTask?.payload || {}),
        hasRejection,
        rejectionReason,
        publishedCount: Object.keys(domLiveSummary).length > 0 ? totalLiveSlots : (currentTask?.payload?.publishedCount ?? totalLiveSlots),
        productSummary: Object.keys(domLiveSummary).length > 0 
          ? Object.fromEntries(Object.entries(domLiveSummary).map(([k, mps]) => [k, { marketplaces: mps }]))
          : (currentTask?.payload?.productSummary || {}),
        liveProductSummary: Object.keys(domLiveSummary).length > 0 
          ? Object.fromEntries(Object.entries(domLiveSummary).map(([k, mps]) => [k, { marketplaces: mps }]))
          : (currentTask?.payload?.liveProductSummary || {}),
        liveProductTypes: Object.keys(domLiveSummary).length > 0 ? Object.keys(domLiveSummary) : (currentTask?.payload?.liveProductTypes || [])
      };

      TaskLogService.updateTaskStatus(cleanTaskId, {
        status: hasRejection ? 'AWAITING_DESIGN_REVIEW' : 'RECEIVED',
        imageUrl: localUrl,
        localImagePath: localUrl,
        mbaPngUrl: localUrl,
        localMbaPngPath: filePath,
        payload: updatedPayload,
        needsManualReview: hasRejection,
        hasError: false
      });

      TaskLogService.addEvent(cleanTaskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: hasRejection 
          ? '⚠️ Original-Design heruntergeladen & Amazon-Rejection erkannt'
          : 'Original-Design heruntergeladen & Live-Produkte verifiziert',
        content: {
          localUrl,
          originalUrl: extractResult.fullResUrl,
          fileSizeBytes: buffer.length,
          fileSizeMb: (buffer.length / 1024 / 1024).toFixed(2) + ' MB',
          downloadedAt: new Date().toISOString(),
          domLiveSummary,
          totalLiveSlots,
          hasRejection,
          rejectionReason
        }
      });

      return { success: true, localUrl, hasRejection, rejectionReason };
    } catch (err: any) {
      console.error(`[AmazonInspectService] ❌ Fehler beim Artwork-Download für Task ${cleanTaskId}:`, err);
      TaskLogService.updateTaskStatus(cleanTaskId, {
        status: 'ERROR',
        hasError: true,
        errorDetails: err.message
      });
      TaskLogService.addEvent(cleanTaskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler beim Design-Download',
        content: err.message || 'Unbekannter Fehler beim Herunterladen des Original-Designs'
      });
      return { success: false, error: err.message };
    } finally {
      if (newTab) {
        await newTab.close().catch(() => {});
      }
    }
  }

  /**
   * Standalone DOM inspection of merch.amazon.com/designs/{designId}/edit
   * Opens the 'Select Products' popup and returns the exact live product matrix and rejections.
   */
  public static async inspectDomProducts(designId: string): Promise<{
    success: boolean;
    designId: string;
    editUrl: string;
    totalLiveSlots: number;
    liveProducts: Record<string, string[]>;
    unapprovedOrDraftProducts: string[];
    hasRejection: boolean;
    rejectionReason: string | null;
    detailedElements: Array<{
      product: string;
      marketplace: string;
      isReadonly: boolean;
      isChecked: boolean;
      rawClass: string;
    }>;
    error?: string;
  }> {
    const cleanDesignId = (designId || '').trim();
    if (!cleanDesignId) {
      return {
        success: false,
        designId: '',
        editUrl: '',
        totalLiveSlots: 0,
        liveProducts: {},
        unapprovedOrDraftProducts: [],
        hasRejection: false,
        rejectionReason: null,
        detailedElements: [],
        error: 'Keine Design-ID angegeben.'
      };
    }

    const editUrl = `https://merch.amazon.com/designs/${cleanDesignId}/edit`;
    console.log(`[AmazonInspectService] 🔍 Starte Standalone DOM-Inspektion für Design ${cleanDesignId}...`);
    let newTab: any = null;
    try {
      const session = await BrowserSessionService.getSession('sync');
      newTab = await session.page.context().newPage();

      await newTab.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 1. Check for page-level alerts
      const pageRejectionInfo = await newTab.evaluate(() => {
        const alertElements = Array.from(document.querySelectorAll('.alert-danger, .alert-warning, .error-banner, .validation-error, [role="alert"]'));
        const alertText = alertElements.map(a => a.textContent?.trim() || '').filter(Boolean).join(' | ');
        const bodyText = document.body.innerText || '';
        const hasKeywords = /rejected|policy violation|content policy|copyright violation|trademark violation/i.test(bodyText);
        return {
          hasAlert: alertElements.length > 0 || hasKeywords,
          alertText: alertText || (hasKeywords ? 'Amazon Rejection / Policy Violation Text auf Seite erkannt' : '')
        };
      });

      // 2. Open "Select Products" popup
      const selectBtnSelector = '#select-marketplace-button-original, button:has-text("Select Products"), button:has-text("Produkte auswählen"), button.btn-outline-primary:has-text("Select"), [id*="select-marketplace"]';
      await newTab.waitForSelector(selectBtnSelector, { timeout: 30000 });
      const selectBtn = await newTab.$(selectBtnSelector);
      if (!selectBtn) {
        throw new Error('Button "Select Products" (#select-marketplace-button-original) konnte im DOM nicht gefunden werden.');
      }

      await selectBtn.click();
      await newTab.waitForSelector('.select-products-table, .modal-body table', { timeout: 15000 });

      // 3. Evaluate table
      const domResult = await newTab.evaluate(() => {
        const liveMap: Record<string, string[]> = {};
        let liveCount = 0;
        const drafts: string[] = [];
        const details: Array<{ product: string; marketplace: string; isReadonly: boolean; isChecked: boolean; rawClass: string }> = [];

        const checkboxes = Array.from(document.querySelectorAll('flowcheckbox[formcontrolname="shouldPublish"], flowcheckbox[class*="-"]'));
        for (const cb of checkboxes) {
          const className = cb.className || '';
          const match = className.match(/([A-Z0-9_]+)-([A-Z]{2})/);
          if (!match) continue;

          const rawProd = match[1];
          const mp = match[2].toUpperCase();

          const isReadonly = Boolean(
            cb.querySelector('span.readonly') ||
            cb.querySelector('input[readonly]') ||
            (cb.querySelector('i.sci-check-box') && cb.querySelector('span.readonly'))
          );
          const isChecked = Boolean(cb.querySelector('i.sci-check-box'));

          details.push({
            product: rawProd,
            marketplace: mp,
            isReadonly,
            isChecked,
            rawClass: className
          });

          if (isReadonly) {
            if (!liveMap[rawProd]) liveMap[rawProd] = [];
            if (!liveMap[rawProd].includes(mp)) {
              liveMap[rawProd].push(mp);
              liveCount++;
            }
          } else if (isChecked && !isReadonly) {
            drafts.push(`${rawProd}-${mp}`);
          }
        }

        const closeBtn = document.querySelector('button.close, .modal-header button, #select-marketplace-cancel-button') as HTMLElement;
        if (closeBtn) closeBtn.click();

        return { liveMap, liveCount, drafts, details };
      });

      // Normalize product keys
      const normalizedLiveProducts: Record<string, string[]> = {};
      for (const [rKey, mps] of Object.entries<string[]>(domResult.liveMap || {})) {
        const normKey = AmazonInspectService.normalizeProductKey(rKey);
        normalizedLiveProducts[normKey] = mps;
      }

      const hasRejection = pageRejectionInfo.hasAlert || domResult.drafts.length > 0;
      const rejectionReason = pageRejectionInfo.alertText || (domResult.drafts.length > 0 ? `Unpublizierte/abgelehnte Produkte erkannt: ${domResult.drafts.join(', ')}` : null);

      console.log(`[AmazonInspectService] 🎯 Standalone DOM-Inspektion abgeschlossen: ${domResult.liveCount} Live-Slots über ${Object.keys(normalizedLiveProducts).length} Produkte. Rejections: ${domResult.drafts.length}`);

      return {
        success: true,
        designId: cleanDesignId,
        editUrl,
        totalLiveSlots: domResult.liveCount,
        liveProducts: normalizedLiveProducts,
        unapprovedOrDraftProducts: domResult.drafts,
        hasRejection,
        rejectionReason,
        detailedElements: domResult.details
      };
    } catch (err: any) {
      console.error(`[AmazonInspectService] ❌ Standalone DOM-Inspektion fehlgeschlagen:`, err);
      return {
        success: false,
        designId: cleanDesignId,
        editUrl,
        totalLiveSlots: 0,
        liveProducts: {},
        unapprovedOrDraftProducts: [],
        hasRejection: false,
        rejectionReason: null,
        detailedElements: [],
        error: err.message || 'Fehler beim Auslesen des DOM-Produkt-Popups'
      };
    } finally {
      if (newTab) {
        await newTab.close().catch(() => {});
      }
    }
  }
}

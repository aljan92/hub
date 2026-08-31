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

    // Helper to normalize Amazon marketplace codes to standard 2-letter country codes
    const normalizeMarketplace = (raw: string): string => {
      const s = String(raw).trim().toUpperCase();
      if (['US', '1', 'COM', 'AMAZON.COM', 'ATVPDKIKX0DER'].includes(s)) return 'US';
      if (['GB', 'UK', '3', 'CO.UK', 'AMAZON.CO.UK', 'A1F83G8C2ARO7P'].includes(s)) return 'GB';
      if (['DE', '4', 'AMAZON.DE', 'A1PA6795UKMFR9'].includes(s)) return 'DE';
      if (['FR', '5', 'AMAZON.FR', 'A13V1IB3VIYZZH'].includes(s)) return 'FR';
      if (['IT', '6', 'AMAZON.IT', 'APJ6JRA9NG5V4'].includes(s)) return 'IT';
      if (['ES', '7', 'AMAZON.ES', 'A1RKKUPIHCS9HS'].includes(s)) return 'ES';
      if (['JP', '8', 'CO.JP', 'AMAZON.CO.JP', 'A1VC38T7YXB528'].includes(s)) return 'JP';
      return s;
    };

    // Collect products summary & calculate configured slots
    const products = configData.products || {};
    const productTypes = Object.keys(products);
    let totalConfiguredSlots = 0;
    const productSummary: Record<string, any> = {};
    for (const [pKey, pVal] of Object.entries<any>(products)) {
      const rawMarketplaces = Object.keys(pVal.marketplaceData || {});
      const normalizedMarketplaces = Array.from(new Set(rawMarketplaces.map(normalizeMarketplace)));
      totalConfiguredSlots += Math.max(1, normalizedMarketplaces.length);
      productSummary[pKey] = {
        fits: pVal.dimensions?.FIT || [],
        colors: pVal.dimensions?.COLOR || [],
        marketplaces: normalizedMarketplaces,
        artworkInstruction: pVal.artworkInstructions?.FRONT || pVal.artworkInstructions?.BACK || pVal.artworkInstructions?.POP_SOCKET || null
      };
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
      title: `Amazon Rohdaten erfasst (${publishedCount} Varianten live)`,
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

    return taskLog;
  }

  /**
   * Download the master design artwork (4500x5400 px PNG) from merch.amazon.com/designs/{designId}/edit
   * using an isolated background tab in Session 1 to prevent collisions with sync operations.
   */
  public static async downloadDesignArtwork(taskId: string, designId: string): Promise<{ success: boolean; localUrl?: string; error?: string }> {
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

    // Fast-path: if already downloaded, return cached localUrl
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > 5000) {
          console.log(`[AmazonInspectService] 🖼️ Design bereits lokal vorhanden: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          const localUrl = `/api/v1/designs/image/${encodeURIComponent(cleanTaskId)}`;
          return { success: true, localUrl };
        }
      } catch (e) {}
    }

    const editUrl = `https://merch.amazon.com/designs/${cleanDesignId}/edit`;
    console.log(`[AmazonInspectService] 🖼️ Starte Artwork-Download für Task ${cleanTaskId} (Design ${cleanDesignId}) via Session 1...`);

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

      // Wait for the artwork image to render in DOM
      await newTab.waitForSelector('img[alt$=".png"], img[alt="null"], img.artwork, #global-uploader-container img, .global-uploader img', { timeout: 25000 }).catch(() => null);

      // Extract high-res image URL from DOM
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

      // Update TaskLog with paths and status
      TaskLogService.updateTaskStatus(cleanTaskId, {
        status: 'RECEIVED',
        imageUrl: localUrl,
        localImagePath: localUrl,
        mbaPngUrl: localUrl,
        localMbaPngPath: filePath,
        hasError: false
      });

      TaskLogService.addEvent(cleanTaskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: 'Original-Design heruntergeladen',
        content: {
          localUrl,
          originalUrl: extractResult.fullResUrl,
          fileSizeBytes: buffer.length,
          fileSizeMb: (buffer.length / 1024 / 1024).toFixed(2) + ' MB',
          downloadedAt: new Date().toISOString()
        }
      });

      return { success: true, localUrl };
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
    } finally {
      if (newTab) {
        await newTab.close().catch(() => {});
      }
    }
  }
}

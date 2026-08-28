import { BrowserSessionService } from './browserSessionService';
import { SyncEngine } from './syncEngine';

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
    const cleanId = (designId || '').trim();
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
}

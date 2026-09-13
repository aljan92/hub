import { BrowserSessionService } from './browserSessionService';
import { AmazonInspectService } from './amazonInspectService';

export interface AmazonDeleteResult {
  success: boolean;
  designId: string;
  deletedProductsCount?: number;
  productsToOperateOn?: Record<string, Record<string, string>>;
  error?: string;
  amazonStatus?: number;
  amazonResponse?: any;
}

export class AmazonDeleteDesignService {
  /**
   * Delete a design and all its product variants directly on Merch by Amazon
   * via POST https://merch.amazon.com/api/productconfiguration/delete
   */
  public static async deleteDesignFromAmazon(rawDesignId: string): Promise<AmazonDeleteResult> {
    const cleanId = (rawDesignId || '').replace(/^#/, '').replace(/-U$/, '').trim();
    if (!cleanId) {
      return { success: false, designId: '', error: 'Keine gültige Amazon Design-ID angegeben.' };
    }

    console.log(`[AmazonDeleteDesignService] 🗑️ Initiating Amazon deletion for Design ${cleanId}...`);

    // 1. Fetch current product configuration from Amazon to build productsToOperateOn
    const configRes = await AmazonInspectService.inspectProductConfig(cleanId);
    if (!configRes.success || !configRes.data) {
      throw new Error(configRes.error || `Produktkonfiguration für Design ${cleanId} konnte nicht von Amazon abgerufen werden.`);
    }

    const configData = configRes.data;
    const products = configData.products || {};
    const productsToOperateOn: Record<string, Record<string, string>> = {};
    let totalProductsCount = 0;

    for (const [pType, pVal] of Object.entries<any>(products)) {
      if (pVal?.marketplaceData && typeof pVal.marketplaceData === 'object') {
        for (const [mkt, mData] of Object.entries<any>(pVal.marketplaceData)) {
          if (mData && mData.id) {
            if (!productsToOperateOn[pType]) {
              productsToOperateOn[pType] = {};
            }
            productsToOperateOn[pType][mkt] = String(mData.id);
            totalProductsCount++;
          }
        }
      }
    }

    // 2. Call Amazon's internal delete API via Session 1
    const session = await BrowserSessionService.getSession('sync');
    const currentUrl = session.page.url();
    if (!currentUrl.includes('merch.amazon.com')) {
      await session.page.goto('https://merch.amazon.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    const deletePayload = {
      id: cleanId,
      productsToOperateOn
    };

    const deleteUrl = 'https://merch.amazon.com/api/productconfiguration/delete';

    const result = await session.page.evaluate(async ({ url, payload }) => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(payload)
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
        } catch {
          text = await resp.text().catch(() => '');
        }

        return {
          ok,
          status,
          data: json || text,
          error: ok ? null : `HTTP ${status}: ${resp.statusText || text || 'Löschung bei Amazon fehlgeschlagen'}`
        };
      } catch (fetchErr: any) {
        return {
          ok: false,
          status: 0,
          error: fetchErr.message || 'Netzwerkfehler im Browserkontext beim Löschen',
          data: null
        };
      }
    }, { url: deleteUrl, payload: deletePayload });

    if (!result.ok) {
      console.error(`[AmazonDeleteDesignService] ❌ Amazon Delete fehlgeschlagen für ${cleanId}:`, result.error);
      return {
        success: false,
        designId: cleanId,
        error: result.error || `HTTP ${result.status} beim Löschen auf Amazon`,
        amazonStatus: result.status,
        amazonResponse: result.data
      };
    }

    console.log(`[AmazonDeleteDesignService] ✅ Design ${cleanId} erfolgreich bei Amazon gelöscht (${totalProductsCount} Produkt-Slots).`);

    return {
      success: true,
      designId: cleanId,
      deletedProductsCount: totalProductsCount,
      productsToOperateOn,
      amazonStatus: result.status,
      amazonResponse: result.data
    };
  }
}

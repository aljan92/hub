import { loadSettings } from './settingsService';

export interface TrademarkHit {
  trademark: string;
  classNumber: string;
  status: string;
  registrationNumber?: string;
  serialNumber?: string;
  goodsAndServices?: string;
  source: 'USPTO' | 'EUIPO' | 'DPMA';
}

export interface TrademarkCheckResult {
  hasInfringementClass25: boolean;
  blockedProducts: string[];
  hits: Record<string, TrademarkHit[]>;
  totalHits: number;
  message: string;
}

export class TrademarkService {
  /**
   * Test connection to Productor Trademark APIs
   */
  static async testConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const settings = loadSettings();
    const start = Date.now();
    try {
      const formData = new URLSearchParams();
      formData.append('trademarks', JSON.stringify(['testquery']));

      const res = await fetch('https://uspto-tm-api2.productor.io/search-batch?classes=25,9', {
        method: 'POST',
        headers: {
          'Authorization': settings.productorUsptoAuth,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(6000)
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs };
      }
      return { success: false, latencyMs, error: `USPTO API responded with HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Connection timeout' };
    }
  }

  /**
   * Check a list of terms/keywords or a whole quote across USPTO, EUIPO, and DPMA
   */
  static async checkTrademarks(terms: string[], locale: 'en' | 'de' = 'en'): Promise<TrademarkCheckResult> {
    const settings = loadSettings();
    const cleanTerms = terms
      .map(t => t.trim())
      .filter(t => t.length > 1)
      .map(t => t.toLowerCase());

    const uniqueTerms = Array.from(new Set(cleanTerms));
    if (uniqueTerms.length === 0) {
      return {
        hasInfringementClass25: false,
        blockedProducts: [],
        hits: {},
        totalHits: 0,
        message: 'No terms to check.'
      };
    }

    const allHits: Record<string, TrademarkHit[]> = {};

    try {
      // 1. USPTO Check
      const usptoFormData = new URLSearchParams();
      usptoFormData.append('trademarks', JSON.stringify(uniqueTerms));

      const usptoRes = await fetch('https://uspto-tm-api2.productor.io/search-batch?classes=25,9,18,20,35,16,24,41,40,21', {
        method: 'POST',
        headers: {
          'Authorization': settings.productorUsptoAuth,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: usptoFormData.toString(),
        signal: AbortSignal.timeout(8000)
      });

      if (usptoRes.ok) {
        const usptoData = await usptoRes.json();
        for (const [term, records] of Object.entries(usptoData)) {
          if (Array.isArray(records) && records.length > 0) {
            allHits[term] = allHits[term] || [];
            records.forEach((r: any) => {
              allHits[term].push({
                trademark: r.trademark || r.mark_identification || r.MarkVerbalElementText || term,
                classNumber: String(r.class_id || r.class || r.international_class || '25'),
                status: r.status || r.status_code || 'LIVE',
                registrationNumber: r.registration_number,
                serialNumber: r.serial_number,
                goodsAndServices: r.goods_and_services || r.goods_services,
                source: 'USPTO'
              });
            });
          }
        }
      }

      // 2. EUIPO Check
      const euFormData = new URLSearchParams();
      euFormData.append('trademarks', JSON.stringify(uniqueTerms));

      const euRes = await fetch('https://euipo-tm-api1.productor.io/search-batch?classes=25,9,16,41,21', {
        method: 'POST',
        headers: {
          'Authorization': settings.productorEuipoAuth,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: euFormData.toString(),
        signal: AbortSignal.timeout(8000)
      });

      if (euRes.ok) {
        const euData = await euRes.json();
        for (const [term, records] of Object.entries(euData)) {
          if (Array.isArray(records) && records.length > 0) {
            allHits[term] = allHits[term] || [];
            records.forEach((r: any) => {
              allHits[term].push({
                trademark: r.trademark || r.mark_identification || term,
                classNumber: String(r.class_id || r.class || '25'),
                status: r.status || 'LIVE',
                source: 'EUIPO'
              });
            });
          }
        }
      }

      // 3. DPMA Check (if locale is German)
      if (locale === 'de') {
        const dpmaFormData = new URLSearchParams();
        dpmaFormData.append('trademarks', JSON.stringify(uniqueTerms));

        const dpmaRes = await fetch('https://dpma-tm-api2.productor.io/search-batch?classes=25,9,16,41,21', {
          method: 'POST',
          headers: {
            'Authorization': settings.productorDpmaAuth,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: dpmaFormData.toString(),
          signal: AbortSignal.timeout(8000)
        });

        if (dpmaRes.ok) {
          const dpmaData = await dpmaRes.json();
          for (const [term, records] of Object.entries(dpmaData)) {
            if (Array.isArray(records) && records.length > 0) {
              allHits[term] = allHits[term] || [];
              records.forEach((r: any) => {
                allHits[term].push({
                  trademark: r.trademark || term,
                  classNumber: String(r.class_id || r.class || '25'),
                  status: r.status || 'LIVE',
                  source: 'DPMA'
                });
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[TrademarkService] Error checking trademarks:', err.message || err);
    }

    // Analyze class hits & blocked products
    let hasInfringementClass25 = false;
    const blockedProductsSet = new Set<string>();
    let totalHits = 0;

    for (const [term, records] of Object.entries(allHits)) {
      totalHits += records.length;
      for (const rec of records) {
        const isLive = !rec.status || rec.status.toUpperCase().includes('LIVE') || rec.status.toUpperCase().includes('REGISTERED');
        if (!isLive) continue;

        const cls = rec.classNumber;
        if (cls === '25') {
          hasInfringementClass25 = true;
          blockedProductsSet.add('STANDARD_TSHIRT');
          blockedProductsSet.add('PREMIUM_TSHIRT');
          blockedProductsSet.add('HOODIE');
          blockedProductsSet.add('SWEATSHIRT');
          blockedProductsSet.add('ZIP_HOODIE');
          blockedProductsSet.add('TANK_TOP');
          blockedProductsSet.add('LONG_SLEEVE_TSHIRT');
          blockedProductsSet.add('RAGLAN');
        } else if (cls === '9') {
          blockedProductsSet.add('POPSOCKET');
          blockedProductsSet.add('PHONE_CASE_APPLE_IPHONE');
          blockedProductsSet.add('PHONE_CASE_SAMSUNG_GALAXY');
        } else if (cls === '21') {
          blockedProductsSet.add('MUG');
          blockedProductsSet.add('TUMBLER');
        } else if (cls === '20') {
          blockedProductsSet.add('THROW_PILLOW');
        } else if (cls === '8' || cls === '18') {
          blockedProductsSet.add('TOTE_BAG');
        }
      }
    }

    return {
      hasInfringementClass25,
      blockedProducts: Array.from(blockedProductsSet),
      hits: allHits,
      totalHits,
      message: hasInfringementClass25
        ? 'Achtung: Live-Treffer in Klasse 25 (Bekleidung) gefunden!'
        : totalHits > 0
        ? `Treffer in Nebenklassen gefunden. ${blockedProductsSet.size} Produkte werden gesperrt.`
        : 'Keine aktiven Schutzrechte gefunden. Quote ist sauber ✓'
    };
  }
}

import { loadSettings } from './settingsService';

export type TrademarkOffice = 'USPTO' | 'EUIPO' | 'DPMA';

export interface TrademarkHit {
  trademark: string;
  term?: string;
  classNumber: string;
  status: string;
  registrationNumber?: string;
  serialNumber?: string;
  goodsAndServices?: string;
  source: TrademarkOffice;
}

export interface TrademarkCheckResult {
  hasInfringementClass25: boolean;
  blockedProducts: string[];
  hits: Record<string, TrademarkHit[]>;
  totalHits: number;
  message: string;
}

export interface FieldCheckResult {
  safe: boolean;
  hasInfringementClass25: boolean;
  totalHits: number;
  blockedProducts: string[];
  hits: Record<string, TrademarkHit[]>;
}

export interface BatchFieldInput {
  offices?: string[] | string;
  marketplace?: string;
  fields: {
    title?: string;
    brand?: string;
    bullet1?: string;
    bullet2?: string;
    description?: string;
    phrase?: string;
    [key: string]: string | undefined;
  };
}

export interface BatchCheckResult {
  success: boolean;
  safe: boolean;
  hasInfringementClass25: boolean;
  blockedProducts: string[];
  officesChecked: TrademarkOffice[];
  summary: {
    totalHits: number;
    verdict: 'SAFE_ALL' | 'SAFE_FOR_APPAREL' | 'REJECTED_CLASS_25';
    message: string;
  };
  fieldResults: Record<string, FieldCheckResult>;
}

const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'have', 'are', 'was',
  'were', 'will', 'been', 'each', 'when', 'into', 'just', 'more', 'some', 'than',
  'them', 'then', 'they', 'what', 'which', 'who', 'will', 'shirt', 'tshirt', 't-shirt',
  'apparel', 'gift', 'ideas', 'great', 'cool', 'love', 'lovers', 'graphic', 'design',
  'men', 'women', 'kids', 'boys', 'girls', 'youth', 'funny', 'retro', 'vintage', 'classic'
]);

export class TrademarkService {
  /**
   * Test connection to Productor Trademark APIs
   */
  static async testConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const settings = loadSettings();
    const start = Date.now();
    try {
      const fd = new FormData();
      fd.append('trademarks', JSON.stringify(['nike']));

      const res = await fetch('https://uspto-tm-api2.productor.io/search-batch?classes=25,9', {
        method: 'POST',
        headers: {
          'Authorization': settings.productorUsptoAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng==',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Origin': 'chrome-extension://kgicddkelkheehndihemgimanfdighkk'
        },
        body: fd,
        signal: AbortSignal.timeout(6000)
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs };
      }
      return { success: false, latencyMs, error: `USPTO API antwortet mit HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Verbindungs-Timeout' };
    }
  }

  /**
   * Parse office inputs (e.g. 'USPTO', 'EUIPO', 'DPMA' or fallback 'US', 'DE', 'EU')
   */
  static normalizeOffices(input?: string[] | string, marketplace?: string): TrademarkOffice[] {
    const rawList: string[] = [];
    if (Array.isArray(input)) {
      rawList.push(...input);
    } else if (typeof input === 'string' && input.trim()) {
      rawList.push(...input.split(',').map(s => s.trim()));
    } else if (marketplace && typeof marketplace === 'string') {
      rawList.push(marketplace.trim());
    }

    const offices = new Set<TrademarkOffice>();
    for (const raw of rawList) {
      const up = raw.toUpperCase();
      if (up === 'USPTO' || up === 'US' || up === 'COM') {
        offices.add('USPTO');
      } else if (up === 'EUIPO' || up === 'EU' || up === 'UK' || up === 'GB' || up === 'FR' || up === 'IT' || up === 'ES') {
        offices.add('EUIPO');
      } else if (up === 'DPMA' || up === 'DE') {
        offices.add('DPMA');
        offices.add('EUIPO'); // German market is also covered by EUIPO
      }
    }

    // Default to USPTO if none specified
    if (offices.size === 0) {
      offices.add('USPTO');
    }

    return Array.from(offices);
  }

  /**
   * Extract search terms from text: full phrase + n-grams + individual significant keywords
   */
  static extractTermsFromText(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    const trimmed = text.trim();
    if (trimmed.length < 2) return [];

    const terms = new Set<string>();
    
    // 1. If text is relatively short (<= 60 chars), check the entire phrase
    if (trimmed.length <= 60) {
      terms.add(trimmed.toLowerCase());
    }

    // Clean word tokens
    const words = trimmed
      .split(/[\s,.;:!?/()"\-+]+/)
      .map(w => w.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '').trim().toLowerCase())
      .filter(w => w.length >= 3);

    // 2. Add individual words (skip very common stop words unless 6+ chars)
    for (const w of words) {
      if (w.length >= 4 && !COMMON_STOP_WORDS.has(w)) {
        terms.add(w);
      }
    }

    // 3. 2-gram and 3-gram phrases
    for (let i = 0; i < words.length - 1; i++) {
      const twoGram = `${words[i]} ${words[i + 1]}`;
      terms.add(twoGram);
      if (i < words.length - 2) {
        const threeGram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        terms.add(threeGram);
      }
    }

    return Array.from(terms);
  }

  /**
   * Check if a trademark status string or code represents an active/live registered trademark
   * Strictly filters out PENDING, DEAD, ABANDONED, CANCELLED, EXPIRED, REFUSED
   */
  static isLiveStatus(rawStatus?: string | number): boolean {
    if (rawStatus === undefined || rawStatus === null || rawStatus === '') {
      return false;
    }
    const s = String(rawStatus).trim().toUpperCase();

    // Explicit non-live statuses
    if (
      s.includes('DEAD') ||
      s.includes('PENDING') ||
      s.includes('CANCEL') ||
      s.includes('ABANDON') ||
      s.includes('EXPIRE') ||
      s.includes('REFUSE') ||
      s.includes('SUSPEND')
    ) {
      return false;
    }

    // Explicit live statuses
    return (
      s.includes('LIVE') ||
      s.includes('REGISTERED') ||
      s.includes('ACTIVE') ||
      s === 'REG' ||
      s === '700' ||
      s === '701'
    );
  }

  /**
   * Check terms across specified trademark offices
   */
  static async queryOffices(uniqueTerms: string[], offices: TrademarkOffice[]): Promise<Record<string, TrademarkHit[]>> {
    const settings = loadSettings();
    const allHits: Record<string, TrademarkHit[]> = {};

    if (uniqueTerms.length === 0 || offices.length === 0) {
      return allHits;
    }

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Origin': 'chrome-extension://kgicddkelkheehndihemgimanfdighkk'
    };

    const promises: Promise<void>[] = [];

    // 1. USPTO
    if (offices.includes('USPTO')) {
      promises.push((async () => {
        try {
          const usptoFd = new FormData();
          usptoFd.append('trademarks', JSON.stringify(uniqueTerms));

          const res = await fetch('https://uspto-tm-api2.productor.io/search-batch?classes=25,9,18,20,35,16,24,41,40,21', {
            method: 'POST',
            headers: {
              ...defaultHeaders,
              'Authorization': settings.productorUsptoAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng=='
            },
            body: usptoFd,
            signal: AbortSignal.timeout(9000)
          });

          if (res.ok) {
            const data = await res.json();
            for (const [term, records] of Object.entries(data)) {
              if (Array.isArray(records) && records.length > 0) {
                records.forEach((r: any) => {
                  const rawStatus = r.status || r.status_code || 'LIVE';
                  if (this.isLiveStatus(rawStatus)) {
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.trademark || r.mark_identification || r.MarkVerbalElementText || term,
                      classNumber: String(r.class_id || r.class || r.international_class || '25'),
                      status: 'LIVE',
                      registrationNumber: r.registration_number,
                      serialNumber: r.serial_number,
                      goodsAndServices: r.goods_and_services || r.goods_services,
                      source: 'USPTO'
                    });
                  }
                });
              }
            }
          }
        } catch (err: any) {
          console.warn('[TrademarkService] USPTO query error:', err.message || err);
        }
      })());
    }

    // 2. EUIPO
    if (offices.includes('EUIPO')) {
      promises.push((async () => {
        try {
          const euFd = new FormData();
          euFd.append('trademarks', JSON.stringify(uniqueTerms));

          const res = await fetch('https://euipo-tm-api1.productor.io/search-batch?classes=25,9,16,41,21', {
            method: 'POST',
            headers: {
              ...defaultHeaders,
              'Authorization': settings.productorEuipoAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjc4NzgyaWhvbG5zZmRiKC8mJi9pbzFubml1aDg3OGZhYnV6ZmFzYmprYmtqaGg3MDBoOQ=='
            },
            body: euFd,
            signal: AbortSignal.timeout(9000)
          });

          if (res.ok) {
            const data = await res.json();
            for (const [term, records] of Object.entries(data)) {
              if (Array.isArray(records) && records.length > 0) {
                records.forEach((r: any) => {
                  const rawStatus = r.status || 'LIVE';
                  if (this.isLiveStatus(rawStatus)) {
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.trademark || r.mark_identification || term,
                      classNumber: String(r.class_id || r.class || '25'),
                      status: 'LIVE',
                      source: 'EUIPO'
                    });
                  }
                });
              }
            }
          }
        } catch (err: any) {
          console.warn('[TrademarkService] EUIPO query error:', err.message || err);
        }
      })());
    }

    // 3. DPMA
    if (offices.includes('DPMA')) {
      promises.push((async () => {
        try {
          const dpmaFd = new FormData();
          dpmaFd.append('trademarks', JSON.stringify(uniqueTerms));

          const res = await fetch('https://dpma-tm-api2.productor.io/search-batch?classes=25,9,16,41,21', {
            method: 'POST',
            headers: {
              ...defaultHeaders,
              'Authorization': settings.productorDpmaAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjcydWppaW9zZHBoaWhxMDg3MnIzMGc4YmJpJiZ1MWlpODE3Njdnejc2NzU2JTA3Z3V6YXNm'
            },
            body: dpmaFd,
            signal: AbortSignal.timeout(9000)
          });

          if (res.ok) {
            const data = await res.json();
            for (const [term, records] of Object.entries(data)) {
              if (Array.isArray(records) && records.length > 0) {
                records.forEach((r: any) => {
                  const rawStatus = r.status || 'LIVE';
                  if (this.isLiveStatus(rawStatus)) {
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.trademark || term,
                      classNumber: String(r.class_id || r.class || '25'),
                      status: 'LIVE',
                      source: 'DPMA'
                    });
                  }
                });
              }
            }
          }
        } catch (err: any) {
          console.warn('[TrademarkService] DPMA query error:', err.message || err);
        }
      })());
    }

    await Promise.all(promises);
    return allHits;
  }

  /**
   * Analyze hits to calculate blocked products and class 25 status
   */
  static analyzeHits(hitsRecord: Record<string, TrademarkHit[]>): {
    hasInfringementClass25: boolean;
    blockedProducts: string[];
    totalHits: number;
  } {
    let hasInfringementClass25 = false;
    const blockedProductsSet = new Set<string>();
    let totalHits = 0;

    for (const [, records] of Object.entries(hitsRecord)) {
      for (const rec of records) {
        if (!this.isLiveStatus(rec.status)) continue;
        totalHits++;

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
      totalHits
    };
  }

  /**
   * Legacy check method for single term array (used by UI Designer)
   */
  static async checkTrademarks(terms: string[], locale: 'en' | 'de' = 'en'): Promise<TrademarkCheckResult> {
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

    const offices: TrademarkOffice[] = locale === 'de' ? ['USPTO', 'EUIPO', 'DPMA'] : ['USPTO', 'EUIPO'];
    const hits = await this.queryOffices(uniqueTerms, offices);
    const analysis = this.analyzeHits(hits);

    return {
      hasInfringementClass25: analysis.hasInfringementClass25,
      blockedProducts: analysis.blockedProducts,
      hits,
      totalHits: analysis.totalHits,
      message: analysis.hasInfringementClass25
        ? 'Achtung: Live-Treffer in Klasse 25 (Bekleidung) gefunden!'
        : analysis.totalHits > 0
        ? `Treffer in Nebenklassen gefunden. ${analysis.blockedProducts.length} Produkte werden gesperrt.`
        : 'Keine aktiven Schutzrechte gefunden. Quote ist sauber ✓'
    };
  }

  /**
   * Comprehensive Multi-Field Batch Check for Hermes Agent & MCP Integration
   */
  static async checkBatchFields(input: BatchFieldInput): Promise<BatchCheckResult> {
    const offices = this.normalizeOffices(input.offices, input.marketplace);
    const fields = input.fields || {};

    // 1. Extract terms per field and build global term list
    const fieldTermsMap: Record<string, string[]> = {};
    const allUniqueTerms = new Set<string>();

    for (const [fieldName, rawValue] of Object.entries(fields)) {
      if (rawValue && typeof rawValue === 'string') {
        const terms = this.extractTermsFromText(rawValue);
        fieldTermsMap[fieldName] = terms;
        terms.forEach(t => allUniqueTerms.add(t));
      }
    }

    const termList = Array.from(allUniqueTerms);
    const globalHits = termList.length > 0 ? await this.queryOffices(termList, offices) : {};

    // 2. Map global hits back to each field
    const fieldResults: Record<string, FieldCheckResult> = {};
    let totalGlobalHits = 0;
    let globalHasInfringementClass25 = false;
    const globalBlockedProducts = new Set<string>();

    for (const [fieldName, terms] of Object.entries(fieldTermsMap)) {
      const fieldHits: Record<string, TrademarkHit[]> = {};
      for (const t of terms) {
        if (globalHits[t] && globalHits[t].length > 0) {
          fieldHits[t] = globalHits[t];
        }
      }

      const analysis = this.analyzeHits(fieldHits);
      if (analysis.hasInfringementClass25) globalHasInfringementClass25 = true;
      analysis.blockedProducts.forEach(p => globalBlockedProducts.add(p));
      totalGlobalHits += analysis.totalHits;

      fieldResults[fieldName] = {
        safe: !analysis.hasInfringementClass25,
        hasInfringementClass25: analysis.hasInfringementClass25,
        totalHits: analysis.totalHits,
        blockedProducts: analysis.blockedProducts,
        hits: fieldHits
      };
    }

    const isCompletelySafe = !globalHasInfringementClass25 && globalBlockedProducts.size === 0;
    const verdict: 'SAFE_ALL' | 'SAFE_FOR_APPAREL' | 'REJECTED_CLASS_25' = globalHasInfringementClass25
      ? 'REJECTED_CLASS_25'
      : globalBlockedProducts.size > 0
      ? 'SAFE_FOR_APPAREL'
      : 'SAFE_ALL';

    const message = globalHasInfringementClass25
      ? `Achtung: Live-Treffer in Klasse 25 (Bekleidung) gefunden in: ${Object.keys(fieldResults).filter(f => fieldResults[f].hasInfringementClass25).join(', ')}`
      : totalGlobalHits > 0
      ? `Keine Treffer in Klasse 25 (Bekleidung ist sicher). ${globalBlockedProducts.size} Nebenprodukte (PopSockets/Tassen etc.) gesperrt.`
      : 'Keine aktiven Schutzrechte gefunden. Text & Listing sind sauber ✓';

    return {
      success: true,
      safe: !globalHasInfringementClass25,
      hasInfringementClass25: globalHasInfringementClass25,
      blockedProducts: Array.from(globalBlockedProducts),
      officesChecked: offices,
      summary: {
        totalHits: totalGlobalHits,
        verdict,
        message
      },
      fieldResults
    };
  }
}

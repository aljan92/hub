import { loadSettings } from './settingsService';
import { ProductCatalogService } from './productCatalogService';
import { TrademarkWhitelistService } from './trademarkWhitelistService';

export type TrademarkOffice = 'USPTO' | 'EUIPO' | 'DPMA';

export interface TrademarkHit {
  trademark: string;
  term?: string;
  classNumber: string;
  classes?: string[];
  status: string;
  registrationNumber?: string;
  serialNumber?: string | number;
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
  affectedClasses: string[];
  blockedProducts: string[];
  officesChecked: TrademarkOffice[];
  summary: {
    totalHits: number;
    verdict: 'SAFE_ALL' | 'SAFE_FOR_APPAREL' | 'NEEDS_AUDIT' | 'REJECTED_CLASS_25';
    message: string;
    exactPhraseHitsCount: number;
    keywordHitsCount: number;
  };
  exactPhraseHits: TrademarkHit[];
  keywordHits: TrademarkHit[];
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
   * Extract and normalize Nice Classification numbers (e.g. '041' -> '41', '009,042' -> ['9', '42'])
   */
  static extractNiceClasses(r: any): string[] {
    if (!r) return [];
    const raw = r.classification || r.Classification || r.classes || r.class_id || r.class || r.international_class || '';
    if (!raw) return [];
    
    if (Array.isArray(raw)) {
      return raw.map(c => String(c).replace(/^0+/, '').trim()).filter(Boolean);
    }
    
    return String(raw)
      .split(/[,;\s]+/)
      .map(c => c.replace(/[^0-9]/g, '').replace(/^0+/, '').trim())
      .filter(Boolean);
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
      s.includes('EINGETRAGEN') ||
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
                    const classes = this.extractNiceClasses(r);
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.trademark || r.mark_identification || r.MarkVerbalElementText || term,
                      classNumber: classes.join(', ') || 'N/A',
                      classes,
                      status: 'LIVE',
                      registrationNumber: r.registration_number || r.registration_date,
                      serialNumber: r.serial_number || r.applicationNumber,
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
                  const rawStatus = r.markCurrentStatusCode || r.status || 'LIVE';
                  if (this.isLiveStatus(rawStatus)) {
                    const classes = this.extractNiceClasses(r);
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.trademark || r.mark_identification || term,
                      classNumber: classes.join(', ') || 'N/A',
                      classes,
                      status: 'LIVE',
                      serialNumber: r.applicationNumber,
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
                  const rawStatus = r.MarkCurrentStatusCode || r.status || 'LIVE';
                  if (this.isLiveStatus(rawStatus)) {
                    const classes = this.extractNiceClasses(r);
                    allHits[term] = allHits[term] || [];
                    allHits[term].push({
                      term,
                      trademark: r.MarkVerbalElementText || r.trademark || term,
                      classNumber: classes.join(', ') || 'N/A',
                      classes,
                      status: 'LIVE',
                      serialNumber: r.ApplicationNumber,
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
    blockedClasses: number[];
    blockedProducts: string[];
    totalHits: number;
  } {
    let hasInfringementClass25 = false;
    const blockedClassesSet = new Set<number>();
    let totalHits = 0;

    for (const [term, records] of Object.entries(hitsRecord)) {
      for (const rec of records) {
        if (!this.isLiveStatus(rec.status)) continue;

        const hitTerm = rec.term || term || '';
        const hitMark = rec.trademark || '';
        const source = rec.source || 'GLOBAL';

        // Filter out whitelisted terms/trademarks
        if (
          TrademarkWhitelistService.isWhitelisted(hitTerm, source) ||
          TrademarkWhitelistService.isWhitelisted(hitMark, source)
        ) {
          continue;
        }

        totalHits++;

        const classes = (rec.classes && rec.classes.length > 0)
          ? rec.classes
          : this.extractNiceClasses({ classification: rec.classNumber });

        for (const c of classes) {
          const num = parseInt(c, 10);
          if (!isNaN(num)) {
            blockedClassesSet.add(num);
            if (num === 25) {
              hasInfringementClass25 = true;
            }
          }
        }
      }
    }

    const blockedClasses = Array.from(blockedClassesSet);
    const blockedProducts = ProductCatalogService.getBlockedProductIdsForNiceClasses(
      blockedClasses.filter(c => c !== 25) // Clothing 25 is handled separately via hard-reject / rewrite
    );

    return {
      hasInfringementClass25,
      blockedClasses,
      blockedProducts,
      totalHits
    };
  }

  /**
   * Comprehensive Audit for Listing + Niche Metadata (Hard-Reject, Product Blocking, Fair-Use)
   */
  static async auditListingAndMetadata(params: {
    listing: { brand: string; title: string; bullet1: string; bullet2: string; description?: string };
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    offices?: TrademarkOffice[];
  }): Promise<{
    isHardReject: boolean;
    hardRejectReason?: string | null;
    isSafe: boolean;
    needsRewrite: boolean;
    brandConflict: boolean;
    titleConflict: boolean;
    blockedNiceClasses: number[];
    blockedProducts: string[];
    allHits: TrademarkHit[];
    hitDetails: Record<string, TrademarkHit[]>;
  }> {
    const offices = params.offices && params.offices.length > 0 ? params.offices : (['USPTO', 'EUIPO', 'DPMA'] as TrademarkOffice[]);
    
    // 1. Collect all terms to query
    const termsToFieldMap: Record<string, string[]> = {
      quote: params.quote ? this.extractTermsFromText(params.quote) : [],
      niche1: params.niche1 ? this.extractTermsFromText(params.niche1) : [],
      niche2: params.niche2 && params.niche2.toLowerCase() !== 'none' ? this.extractTermsFromText(params.niche2) : [],
      subniche: params.subniche && params.subniche.toLowerCase() !== 'none' ? this.extractTermsFromText(params.subniche) : [],
      brand: this.extractTermsFromText(params.listing.brand),
      title: this.extractTermsFromText(params.listing.title),
      bullet1: this.extractTermsFromText(params.listing.bullet1),
      bullet2: this.extractTermsFromText(params.listing.bullet2),
    };

    const allUniqueTerms = new Set<string>();
    for (const terms of Object.values(termsToFieldMap)) {
      terms.forEach(t => allUniqueTerms.add(t));
    }

    const termList = Array.from(allUniqueTerms);
    const globalHits = termList.length > 0 ? await this.queryOffices(termList, offices) : {};

    // 2. Classify hits
    let isHardReject = false;
    let hardRejectReason: string | null = null;
    let brandConflict = false;
    let titleConflict = false;
    let needsRewrite = false;
    const blockedClassesSet = new Set<number>();
    const allHitsList: TrademarkHit[] = [];

    // Check Hard-Reject on Core Slogan & Core Niches in Class 25
    const coreFields = ['quote', 'niche1', 'niche2', 'subniche'];
    for (const f of coreFields) {
      const terms = termsToFieldMap[f] || [];
      for (const t of terms) {
        const hits = globalHits[t] || [];
        for (const h of hits) {
          if (!this.isLiveStatus(h.status)) continue;
          allHitsList.push(h);
          const classes = (h.classes && h.classes.length > 0) ? h.classes : this.extractNiceClasses({ classification: h.classNumber });
          if (classes.includes('25')) {
            isHardReject = true;
            hardRejectReason = `Core ${f} "${t}" is an active Class 25 trademark (${h.source}: ${h.trademark}).`;
            break;
          }
        }
        if (isHardReject) break;
      }
      if (isHardReject) break;
    }

    if (isHardReject) {
      return {
        isHardReject: true,
        hardRejectReason,
        isSafe: false,
        needsRewrite: false,
        brandConflict: true,
        titleConflict: true,
        blockedNiceClasses: [25],
        blockedProducts: [],
        allHits: allHitsList,
        hitDetails: globalHits
      };
    }

    // Check Brand Name in Class 25 (0 Tolerance)
    const brandTerms = termsToFieldMap.brand || [];
    for (const t of brandTerms) {
      const hits = globalHits[t] || [];
      for (const h of hits) {
        if (!this.isLiveStatus(h.status)) continue;
        allHitsList.push(h);
        const classes = (h.classes && h.classes.length > 0) ? h.classes : this.extractNiceClasses({ classification: h.classNumber });
        if (classes.includes('25')) {
          brandConflict = true;
          needsRewrite = true;
        } else {
          classes.forEach(c => {
            const num = parseInt(c, 10);
            if (!isNaN(num)) blockedClassesSet.add(num);
          });
        }
      }
    }

    // Check Title & Bullets
    const listingFields = ['title', 'bullet1', 'bullet2'];
    for (const f of listingFields) {
      const terms = termsToFieldMap[f] || [];
      for (const t of terms) {
        const hits = globalHits[t] || [];
        for (const h of hits) {
          if (!this.isLiveStatus(h.status)) continue;
          allHitsList.push(h);
          const classes = (h.classes && h.classes.length > 0) ? h.classes : this.extractNiceClasses({ classification: h.classNumber });
          if (classes.includes('25')) {
            if (f === 'title') {
              // Exact matches or non-stop words in title trigger rewrite
              if (!COMMON_STOP_WORDS.has(t)) {
                titleConflict = true;
                needsRewrite = true;
              }
            } else {
              // In bullets: multi-word phrases or non-descriptive trademarks trigger rewrite
              if (!COMMON_STOP_WORDS.has(t) && t.includes(' ')) {
                needsRewrite = true;
              }
            }
          } else {
            classes.forEach(c => {
              const num = parseInt(c, 10);
              if (!isNaN(num)) blockedClassesSet.add(num);
            });
          }
        }
      }
    }

    const blockedNiceClasses = Array.from(blockedClassesSet);
    const blockedProducts = ProductCatalogService.getBlockedProductIdsForNiceClasses(
      blockedNiceClasses.filter(c => c !== 25)
    );

    const isSafe = !brandConflict && !titleConflict && !needsRewrite;

    return {
      isHardReject: false,
      hardRejectReason: null,
      isSafe,
      needsRewrite,
      brandConflict,
      titleConflict,
      blockedNiceClasses,
      blockedProducts,
      allHits: allHitsList,
      hitDetails: globalHits
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

    const brandHasClass25 = Boolean(fieldResults.brand?.hasInfringementClass25);
    const titleHasClass25 = Boolean(fieldResults.title?.hasInfringementClass25);
    const quoteHasClass25 = Boolean(fieldResults.quote?.hasInfringementClass25);
    const hasBrandTitleClass25 = brandHasClass25 || titleHasClass25 || quoteHasClass25;

    let verdict: 'SAFE_ALL' | 'SAFE_FOR_APPAREL' | 'NEEDS_AUDIT' | 'REJECTED_CLASS_25';
    let message: string;

    if (hasBrandTitleClass25) {
      verdict = 'REJECTED_CLASS_25';
      const affected = [brandHasClass25 && 'Brand', titleHasClass25 && 'Title', quoteHasClass25 && 'Quote'].filter(Boolean);
      message = `Klasse 25 Konflikt in Identifikatoren (${affected.join(', ')}). Automatisches Umschreiben erforderlich.`;
    } else if (globalHasInfringementClass25) {
      verdict = 'NEEDS_AUDIT';
      message = `Treffer in Bullets/Description gefunden (${totalGlobalHits} Treffer). Fair-Use-Prüfung durch Trademark Auditor.`;
    } else if (globalBlockedProducts.size > 0) {
      verdict = 'SAFE_FOR_APPAREL';
      message = `Keine Treffer in Klasse 25 (Bekleidung sicher). ${globalBlockedProducts.size} Nebenprodukte gesperrt.`;
    } else {
      verdict = 'SAFE_ALL';
      message = 'Keine aktiven Schutzrechte gefunden. Listing ist sauber ✓';
    }

    const rawInputPhrases = new Set<string>();
    for (const rawValue of Object.values(fields)) {
      if (rawValue && typeof rawValue === 'string') {
        const tr = rawValue.trim().toLowerCase();
        if (tr.length > 0) rawInputPhrases.add(tr);
      }
    }

    const exactPhraseHits: TrademarkHit[] = [];
    const keywordHits: TrademarkHit[] = [];
    const affectedClassesSet = new Set<string>();
    const seenHitKeys = new Set<string>();

    for (const [term, hits] of Object.entries(globalHits)) {
      for (const hit of hits) {
        const uniqueKey = `${hit.source}-${hit.trademark}-${hit.classNumber}-${hit.term}`;
        if (seenHitKeys.has(uniqueKey)) continue;
        seenHitKeys.add(uniqueKey);

        (hit.classes || []).forEach(c => affectedClassesSet.add(c));

        if (rawInputPhrases.has(term.toLowerCase())) {
          exactPhraseHits.push(hit);
        } else {
          keywordHits.push(hit);
        }
      }
    }

    return {
      success: true,
      safe: !hasBrandTitleClass25,
      hasInfringementClass25: globalHasInfringementClass25,
      affectedClasses: Array.from(affectedClassesSet).sort((a, b) => Number(a) - Number(b)),
      blockedProducts: Array.from(globalBlockedProducts),
      officesChecked: offices,
      summary: {
        totalHits: totalGlobalHits,
        verdict,
        message,
        exactPhraseHitsCount: exactPhraseHits.length,
        keywordHitsCount: keywordHits.length
      },
      exactPhraseHits,
      keywordHits,
      fieldResults
    };
  }
}

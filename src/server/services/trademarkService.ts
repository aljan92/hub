import { loadSettings } from './settingsService';
import { ProductCatalogService } from './productCatalogService';
import { TrademarkWhitelistService } from './trademarkWhitelistService';
import { LLMService, EnglishListing } from './llmService';

export type TrademarkOffice = 'USPTO' | 'EUIPO' | 'DPMA';

export type MatchTypeV2 = 
  | 'FULL_EXACT'
  | 'EXACT_NGRAM'
  | 'SINGLE_WORD_EXACT'
  | 'CONTAINS_REGISTERED_MARK'
  | 'QUERY_INSIDE_LONGER_MARK'
  | 'FUZZY_OR_SIMILAR';

export interface TrademarkHitV2 {
  searchedTerm: string;
  registeredMark: string;
  field?: 'brand' | 'title' | 'bullet1' | 'bullet2' | 'description' | 'quote' | string;
  office: 'USPTO' | 'EUIPO' | 'DPMA';
  status: string;
  markFeature: 'Word' | 'Figurative' | 'Combined' | string;
  classes: number[];
  classNumber: string;
  wordCount: number;
  matchType: MatchTypeV2;
  isFullQuoteMatch: boolean;
  isKnownPhraseMatch: boolean;
  serialNumber?: string | number;
  registrationNumber?: string | number;
  applicant?: string;
  filingDate?: string;
  registrationDate?: string;
}

export interface CompactOccurrence {
  field: string;
  matchedTerm?: string;
}

export interface CompactTrademarkHit {
  id: string;
  mark: string;
  status: string;
  feature: string;
  classes: number[];
  offices: string[];
  matchType: MatchTypeV2;
  fullQuoteMatch: boolean;
  occurrences: CompactOccurrence[];
}

export interface TrademarkAuditResultV2 {
  finalDecision: 'APPROVED' | 'APPROVE_WITH_BLOCKED_PRODUCTS' | 'REWRITE' | 'ESCALATE';
  isSafe: boolean;
  canBeFixedByListingRewrite: boolean;
  reasonCode: string | null;
  recommendedAction: string | null;
  initialTrademarkHits: TrademarkHitV2[];
  finalTrademarkHits: TrademarkHitV2[];
  rewriteIterations: Array<{
    iteration: number;
    actionsTaken: string[];
    listing: EnglishListing;
    hitsFound: number;
  }>;
  refereeResult: any;
  verifierResult: any;
  forbiddenTermsForTask: string[];
  blockedProducts: string[];
  blockedNiceClasses: number[];
  finalListing: EnglishListing;
}

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

  /**
   * =========================================================================
   * TRADEMARK WORKFLOW V2 METHODS (USPTO Focus, 1-5 Grams, Multi-Round Loop)
   * =========================================================================
   */

  /**
   * V2 Term Extraction: 1-5 Grams + Full Quote, Stopword preservation in phrases
   */
  static extractTermsFromTextV2(params: {
    listing: { brand?: string; title?: string; bullet1?: string; bullet2?: string; description?: string };
    quote?: string;
  }): { terms: string[]; termToFieldsMap: Record<string, string[]> } {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'by', 'from',
      'up', 'about', 'into', 'over', 'after', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'this', 'that', 'your', 'my', 'its', 'their', 'our', 'all', 'any', 'each', 'shirt', 'tshirt', 't-shirt'
    ]);

    const termToFieldsMap: Record<string, Set<string>> = {};
    const addTerm = (term: string, field: string) => {
      const clean = term.trim().toLowerCase();
      if (clean.length < 2) return;
      if (!termToFieldsMap[clean]) termToFieldsMap[clean] = new Set();
      termToFieldsMap[clean].add(field);
    };

    const fields: Array<[string, string | undefined]> = [
      ['brand', params.listing.brand],
      ['title', params.listing.title],
      ['bullet1', params.listing.bullet1],
      ['bullet2', params.listing.bullet2],
      ['description', params.listing.description],
      ['quote', params.quote]
    ];

    for (const [field, text] of fields) {
      if (!text || typeof text !== 'string') continue;
      const trimmed = text.trim();
      if (!trimmed) continue;

      const rawTokens = trimmed
        .split(/[\s,.;:!?/()"\-+–—[\]{}#*~`^|\\]+/)
        .map(w => w.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '').trim().toLowerCase())
        .filter(Boolean);

      // For quote, always include the full quote phrase
      if (field === 'quote' && rawTokens.length > 0) {
        addTerm(rawTokens.join(' '), 'quote');
      }

      // 1-Grams: add word if length >= 3 and not a single stopword
      for (const w of rawTokens) {
        if (w.length >= 3 && !stopWords.has(w)) {
          addTerm(w, field);
        }
      }

      // 2-Grams to 5-Grams (preserve stopwords inside multi-word phrases!)
      for (let len = 2; len <= 5; len++) {
        for (let i = 0; i <= rawTokens.length - len; i++) {
          const nGramTokens = rawTokens.slice(i, i + len);
          const hasSubstantialWord = nGramTokens.some(tok => !stopWords.has(tok) && tok.length >= 3);
          if (hasSubstantialWord) {
            addTerm(nGramTokens.join(' '), field);
          }
        }
      }
    }

    const result: Record<string, string[]> = {};
    for (const [t, set] of Object.entries(termToFieldsMap)) {
      result[t] = Array.from(set);
    }

    return {
      terms: Object.keys(result),
      termToFieldsMap: result
    };
  }

  /**
   * Query USPTO batch endpoint (batching up to 50 terms per request)
   */
  static async queryUsptoBatch(terms: string[]): Promise<Record<string, any[]>> {
    const settings = loadSettings();
    const allResults: Record<string, any[]> = {};
    if (terms.length === 0) return allResults;

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Origin': 'chrome-extension://kgicddkelkheehndihemgimanfdighkk',
      'Authorization': settings.productorUsptoAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng=='
    };

    const chunkSize = 50;
    for (let i = 0; i < terms.length; i += chunkSize) {
      const chunk = terms.slice(i, i + chunkSize);
      try {
        const fd = new FormData();
        fd.append('trademarks', JSON.stringify(chunk));

        const res = await fetch('https://uspto-tm-api2.productor.io/search-batch?classes=25,9,18,20,35,16,24,41,40,21', {
          method: 'POST',
          headers: defaultHeaders,
          body: fd,
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          const data = await res.json();
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v) && v.length > 0) {
              allResults[k.toLowerCase()] = v;
            }
          }
        }
      } catch (err: any) {
        console.warn('[TrademarkService] USPTO query error chunk:', err.message || err);
      }
    }

    return allResults;
  }

  /**
   * Deterministic Match Normalization & Classification before LLM
   */
  static normalizeAndClassifyMatches(
    rawHits: Record<string, any[]>,
    termToFieldsMap: Record<string, string[]>,
    quote?: string
  ): TrademarkHitV2[] {
    const normalizedHits: TrademarkHitV2[] = [];
    const cleanQuote = quote ? quote.trim().toLowerCase().replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '') : '';
    const seenKeys = new Set<string>();

    for (const [term, records] of Object.entries(rawHits)) {
      const termLower = term.toLowerCase().trim();
      const fields = termToFieldsMap[termLower] || ['listing'];

      for (const r of records) {
        const rawStatus = r.status || r.status_code || 'LIVE';
        if (!this.isLiveStatus(rawStatus)) continue;

        const registeredMark = String(r.mark_identification || r.trademark || r.MarkVerbalElementText || term).trim();
        const regMarkClean = registeredMark.toLowerCase().replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, '').trim();
        const rawClasses = this.extractNiceClasses(r);
        const classes = rawClasses.map(c => parseInt(c, 10)).filter(n => !isNaN(n));

        const wordCount = regMarkClean.split(/\s+/).filter(Boolean).length;

        // Match type calculation
        let matchType: MatchTypeV2 = 'FUZZY_OR_SIMILAR';
        if (regMarkClean === termLower) {
          if (cleanQuote && termLower === cleanQuote) {
            matchType = 'FULL_EXACT';
          } else if (wordCount === 1) {
            matchType = 'SINGLE_WORD_EXACT';
          } else {
            matchType = 'EXACT_NGRAM';
          }
        } else if (termLower.includes(regMarkClean)) {
          matchType = 'CONTAINS_REGISTERED_MARK';
        } else if (regMarkClean.includes(termLower)) {
          matchType = 'QUERY_INSIDE_LONGER_MARK';
        }

        const isFullQuoteMatch = Boolean(cleanQuote && (regMarkClean === cleanQuote || matchType === 'FULL_EXACT'));
        const isKnownPhraseMatch = wordCount >= 2 && (matchType === 'EXACT_NGRAM' || matchType === 'FULL_EXACT' || matchType === 'CONTAINS_REGISTERED_MARK');

        const drawing = String(r.mark_drawing || r.MarkFeature || r.markFeature || '').toUpperCase();
        let markFeature = 'Word';
        if (drawing.includes('DESIGN') || drawing.includes('COMBINED') || drawing.includes('BILD') || drawing.includes('FIGURATIVE')) {
          markFeature = 'Combined';
        }

        for (const f of fields) {
          const uniqueKey = `USPTO-${registeredMark}-${classes.join(',')}-${termLower}-${f}`;
          if (seenKeys.has(uniqueKey)) continue;
          seenKeys.add(uniqueKey);

          normalizedHits.push({
            searchedTerm: termLower,
            registeredMark,
            field: f,
            office: 'USPTO',
            status: 'LIVE',
            markFeature,
            classes,
            classNumber: classes.join(', ') || 'N/A',
            wordCount,
            matchType,
            isFullQuoteMatch,
            isKnownPhraseMatch,
            serialNumber: r.serial_number || r.ApplicationNumber || r.applicationNumber,
            registrationNumber: r.registration_number || r.registration_date,
            filingDate: r.filing_date || r.ApplicationDate,
            registrationDate: r.registration_date || r.RegistrationDate
          });
        }
      }
    }

    return normalizedHits;
  }

  /**
   * Compact, deduplicated representation of trademark hits specifically tailored for LLM evaluation.
   * Strips internal registration numbers, dates, and duplicate entries, aggregating by registered mark.
   */
  /**
   * Helper to retrieve the current text of a listing field (for fingerprinting & logging)
   */
  static getFieldText(listing: Partial<EnglishListing> = {}, field: string, quote?: string): string {
    if (field === 'brand') return listing.brand || '';
    if (field === 'title') return listing.title || '';
    if (field === 'bullet1') return listing.bullet1 || '';
    if (field === 'bullet2') return listing.bullet2 || '';
    if (field === 'description') return listing.description || '';
    if (field === 'quote') return quote || '';
    return '';
  }

  /**
   * Compacts hundreds of raw/normalized hits into deduplicated mark entities.
   * Significantly reduces token payload by omitting full field text repetition
   * while preserving exact field locations and actual matched terms.
   */
  static buildCompactTrademarkHits(
    normalizedHits: TrademarkHitV2[],
    listing?: Partial<EnglishListing>,
    quote?: string
  ): CompactTrademarkHit[] {
    const markMap = new Map<string, {
      mark: string;
      status: string;
      features: Set<string>;
      classes: Set<number>;
      offices: Set<string>;
      matchTypes: Set<MatchTypeV2>;
      fullQuoteMatch: boolean;
      occurrencesMap: Map<string, CompactOccurrence>;
    }>();

    for (const h of normalizedHits) {
      const cleanMark = (h.registeredMark || h.searchedTerm || '').trim().toUpperCase();
      if (!cleanMark) continue;

      let entry = markMap.get(cleanMark);
      if (!entry) {
        entry = {
          mark: cleanMark,
          status: h.status || 'ACTIVE',
          features: new Set(),
          classes: new Set(),
          offices: new Set(),
          matchTypes: new Set(),
          fullQuoteMatch: false,
          occurrencesMap: new Map()
        };
        markMap.set(cleanMark, entry);
      }

      if (h.markFeature) entry.features.add(h.markFeature);
      if (Array.isArray(h.classes)) {
        h.classes.forEach(c => entry!.classes.add(c));
      }
      if (h.office) entry.offices.add(h.office);
      if (h.matchType) entry.matchTypes.add(h.matchType);
      if (h.isFullQuoteMatch) entry.fullQuoteMatch = true;

      const field = h.field || 'listing';
      const rawMatched = String((h as any).matchedTerm || h.searchedTerm || '').trim();
      const matchedTerm = rawMatched.length > 0 ? rawMatched : undefined;
      const occKey = `${field.toLowerCase()}|${matchedTerm ? matchedTerm.toLowerCase() : ''}`;

      if (!entry.occurrencesMap.has(occKey)) {
        const occ: CompactOccurrence = { field };
        if (matchedTerm) {
          occ.matchedTerm = matchedTerm;
        }
        entry.occurrencesMap.set(occKey, occ);
      }
    }

    const matchTypePriority: MatchTypeV2[] = [
      'FULL_EXACT',
      'EXACT_NGRAM',
      'SINGLE_WORD_EXACT',
      'CONTAINS_REGISTERED_MARK',
      'QUERY_INSIDE_LONGER_MARK',
      'FUZZY_OR_SIMILAR'
    ];

    const compactList: CompactTrademarkHit[] = [];
    let idx = 1;

    for (const [_, entry] of markMap.entries()) {
      let bestMatchType: MatchTypeV2 = 'FUZZY_OR_SIMILAR';
      for (const p of matchTypePriority) {
        if (entry.matchTypes.has(p)) {
          bestMatchType = p;
          break;
        }
      }

      const feature = entry.features.has('Combined') ? 'Combined' : (entry.features.values().next().value || 'Word');

      compactList.push({
        id: `tm_${idx++}`,
        mark: entry.mark,
        status: entry.status,
        feature,
        classes: Array.from(entry.classes).sort((a, b) => a - b),
        offices: Array.from(entry.offices).sort(),
        matchType: bestMatchType,
        fullQuoteMatch: entry.fullQuoteMatch,
        occurrences: Array.from(entry.occurrencesMap.values())
      });
    }

    return compactList;
  }

  /**
   * Complete V2 Trademark Audit Orchestrator:
   * Scan ➔ Match Normalization ➔ Compact LLM Payload ➔ Referee (GPT-5.6 Sol) ➔ Rewrite Loop (up to 3x) ➔ Final Verifier Gate
   */
  static async executeTrademarkAuditV2(params: {
    listing: EnglishListing;
    quote?: string;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    maxRewriteCycles?: number;
    taskId?: string;
    sessionId?: string;
    onEvent?: (event: { type: string; title: string; content: any; metadata?: any }) => void;
  }): Promise<TrademarkAuditResultV2> {
    let currentListing: EnglishListing = { ...params.listing };
    const forbiddenTermsForTask: string[] = [];
    const rewriteIterations: Array<{
      iteration: number;
      actionsTaken: string[];
      listing: EnglishListing;
      hitsFound: number;
    }> = [];

    const tmSessionId = params.sessionId || (params.taskId ? `tm:${params.taskId}` : `tm:${Date.now()}`);
    const approvedHitContexts = new Set<string>();

    const getHitContextKey = (mark: string, markFeature: string, classes: number[], matchType: string, field: string, text: string) => {
      const normText = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const normFeature = (markFeature || 'word').trim().toLowerCase();
      return `${mark.toLowerCase()}|${normFeature}|${classes.slice().sort((a, b) => a - b).join(',')}|${matchType}|${field}|${normText}`;
    };

    let initialTrademarkHits: TrademarkHitV2[] = [];
    let finalRefereeResult: any = null;
    let finalVerifierResult: any = null;
    let blockedProducts: string[] = [];
    let blockedNiceClasses: number[] = [];
    const maxCycles = params.maxRewriteCycles ?? 3;

    for (let cycle = 0; cycle <= maxCycles; cycle++) {
      console.log(`[TrademarkServiceV2] 🔍 Starte USPTO Scan (Zyklus ${cycle} von ${maxCycles}, Session: ${tmSessionId})...`);

      // 1. Term extraction V2
      const { terms, termToFieldsMap } = this.extractTermsFromTextV2({
        listing: currentListing,
        quote: params.quote
      });

      // 2. USPTO Live query
      const rawHits = await this.queryUsptoBatch(terms);

      // 3. Match classification (Full internal details preserved for audit & UI)
      const normalizedHits = this.normalizeAndClassifyMatches(rawHits, termToFieldsMap, params.quote);

      if (cycle === 0) {
        initialTrademarkHits = [...normalizedHits];
      }

      // Compact representation for LLM evaluation
      const compactHits = this.buildCompactTrademarkHits(normalizedHits, currentListing, params.quote);

      params.onEvent?.({
        type: 'TM_SCAN_RESPONSE',
        title: cycle === 0 ? `USPTO TM Scan abgeschlossen (${normalizedHits.length} Treffer, ${compactHits.length} kompakt)` : `USPTO TM Scan (Runde ${cycle}: ${normalizedHits.length} Treffer, ${compactHits.length} kompakt)`,
        content: { cycle, totalHits: normalizedHits.length, compactHitsCount: compactHits.length, termsCheckedCount: terms.length, hits: normalizedHits }
      });

      // Check which hits are genuinely new or in a modified context (Hit-Re-Use optimization)
      const hitsToReview = cycle === 0 ? compactHits : compactHits.filter(h => {
        return h.occurrences.some(occ => {
          const fieldText = TrademarkService.getFieldText(currentListing, occ.field, params.quote);
          return !approvedHitContexts.has(getHitContextKey(h.mark, h.feature, h.classes, h.matchType, occ.field, fieldText));
        });
      });

      let refereeRes: any;

      if (cycle > 0 && hitsToReview.length === 0) {
        console.log(`[TrademarkServiceV2] ⚡ Alle ${compactHits.length} Treffer wurden in diesem Task bereits als KEEP geprüft und sind im Kontext unverändert. Überspringe erneuten Referee-Call.`);
        refereeRes = {
          decision: 'APPROVE',
          canBeFixedByListingRewrite: true,
          reasonCode: null,
          recommendedAction: null,
          hits: [],
          blockedProducts,
          rewriteRequired: false,
          rewriteInstructions: []
        };
      } else {
        // 4. GPT-5.6 Sol Trademark Referee Pass (with compact hits & stable session_id)
        refereeRes = await LLMService.evaluateTrademarkReferee({
          currentListing,
          niche1: params.niche1,
          niche2: params.niche2,
          subniche: params.subniche,
          quote: params.quote,
          compactHits: hitsToReview,
          normalizedHits,
          rewriteIteration: cycle,
          forbiddenTermsForTask,
          blockedProducts,
          sessionId: tmSessionId
        });
      }

      finalRefereeResult = refereeRes;

      // Update approvedHitContexts with hits from this round that were not flagged as problematic
      const problematicMarks = new Set(
        (refereeRes.hits || [])
          .filter((h: any) => h.decision === 'REWRITE' || h.action === 'REWRITE' || h.decision === 'ESCALATE' || h.action === 'ESCALATE')
          .map((h: any) => (h.registeredMark || h.mark || h.searchedTerm || '').trim().toLowerCase())
      );
      for (const h of hitsToReview) {
        if (!problematicMarks.has(h.mark.trim().toLowerCase())) {
          for (const occ of h.occurrences) {
            const fieldText = TrademarkService.getFieldText(currentListing, occ.field, params.quote);
            approvedHitContexts.add(getHitContextKey(h.mark, h.feature, h.classes, h.matchType, occ.field, fieldText));
          }
        }
      }

      // Accumulate blocked products from referee
      if (Array.isArray(refereeRes.blockedProducts) && refereeRes.blockedProducts.length > 0) {
        blockedProducts = Array.from(new Set([...blockedProducts, ...refereeRes.blockedProducts]));
      }

      params.onEvent?.({
        type: 'TM_REFEREE_RESPONSE',
        title: `Trademark Referee: ${refereeRes.decision} (Zyklus ${cycle})`,
        content: { decision: refereeRes.decision, canBeFixedByListingRewrite: refereeRes.canBeFixedByListingRewrite, reasonCode: refereeRes.reasonCode, actions: refereeRes.hits },
        metadata: { provider: 'OpenRouter', model: refereeRes._rawRequest?.model }
      });

      // A. Check for Immediate Escalation (Only if decision is ESCALATE, or if REWRITE is unfixable due to core quote)
      if (refereeRes.decision === 'ESCALATE' || (refereeRes.decision === 'REWRITE' && refereeRes.canBeFixedByListingRewrite === false)) {
        const reasonCode = refereeRes.reasonCode || (refereeRes.decision === 'ESCALATE' ? 'CORE_QUOTE_CLASS25_CONFLICT' : 'UNFIXABLE_TRADEMARK_CONFLICT');
        console.warn(`[TrademarkServiceV2] 🚨 Eskalation ausgelöst: ${reasonCode}`);
        return {
          finalDecision: 'ESCALATE',
          isSafe: false,
          canBeFixedByListingRewrite: false,
          reasonCode,
          recommendedAction: refereeRes.recommendedAction || 'DO_NOT_SUBMIT',
          initialTrademarkHits,
          finalTrademarkHits: normalizedHits,
          rewriteIterations,
          refereeResult: refereeRes,
          verifierResult: null,
          forbiddenTermsForTask,
          blockedProducts,
          blockedNiceClasses,
          finalListing: currentListing
        };
      }

      // B. If Referee approves (APPROVE or APPROVE_WITH_BLOCKED_PRODUCTS) ➔ Run Adversarial Verifier Pass as FINAL GATE!
      if (refereeRes.decision === 'APPROVE' || refereeRes.decision === 'APPROVE_WITH_BLOCKED_PRODUCTS') {
        console.log(`[TrademarkServiceV2] 🛡️ Referee hat genehmigt (${refereeRes.decision}). Starte Verifier als Final Gate...`);
        
        const verifierRes = await LLMService.evaluateTrademarkVerifier({
          currentListing,
          niche1: params.niche1,
          niche2: params.niche2,
          subniche: params.subniche,
          quote: params.quote,
          compactHits, // Final Verifier receives the FULL compact hits of the candidate
          normalizedHits,
          refereeDecision: refereeRes.decision,
          blockedProducts,
          sessionId: tmSessionId
        });

        finalVerifierResult = verifierRes;

        params.onEvent?.({
          type: 'TM_VERIFIER_RESPONSE',
          title: `Amazon Rejection Verifier: ${verifierRes.verdict}`,
          content: { verdict: verifierRes.verdict, recommendation: verifierRes.recommendation, risks: verifierRes.identifiedRisks },
          metadata: { provider: 'OpenRouter', model: verifierRes._rawRequest?.model }
        });

        if (verifierRes.verdict === 'SAFE') {
          console.log(`[TrademarkServiceV2] ✅ Verifier bestätigt SAFE. Listing endgültig freigegeben!`);
          return {
            finalDecision: refereeRes.decision,
            isSafe: true,
            canBeFixedByListingRewrite: true,
            reasonCode: null,
            recommendedAction: null,
            initialTrademarkHits,
            finalTrademarkHits: normalizedHits,
            rewriteIterations,
            refereeResult: refereeRes,
            verifierResult: verifierRes,
            forbiddenTermsForTask,
            blockedProducts,
            blockedNiceClasses,
            finalListing: currentListing
          };
        }

        // If Verifier flagged HIGH_RISK:
        console.warn(`[TrademarkServiceV2] ⚠️ Verifier hat HIGH_RISK gemeldet (${verifierRes.identifiedRisks.length} Risiken).`);
        const hasInvalidAi = verifierRes.identifiedRisks?.some((r: any) => r.riskType === 'INVALID_AI_RESPONSE');
        if (!verifierRes.canBeFixedByListingRewrite || hasInvalidAi) {
          const reasonCode = hasInvalidAi ? 'INVALID_AI_RESPONSE' : 'VERIFIER_UNFIXABLE_RISK';
          return {
            finalDecision: 'ESCALATE',
            isSafe: false,
            canBeFixedByListingRewrite: false,
            reasonCode,
            recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
            initialTrademarkHits,
            finalTrademarkHits: normalizedHits,
            rewriteIterations,
            refereeResult: refereeRes,
            verifierResult: verifierRes,
            forbiddenTermsForTask,
            blockedProducts,
            blockedNiceClasses,
            finalListing: currentListing
          };
        }

        if (cycle >= maxCycles) {
          return {
            finalDecision: 'ESCALATE',
            isSafe: false,
            canBeFixedByListingRewrite: true,
            reasonCode: 'REWRITE_LIMIT_REACHED',
            recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
            initialTrademarkHits,
            finalTrademarkHits: normalizedHits,
            rewriteIterations,
            refereeResult: refereeRes,
            verifierResult: verifierRes,
            forbiddenTermsForTask,
            blockedProducts,
            blockedNiceClasses,
            finalListing: currentListing
          };
        }

        // Add verifier risks to rewrite instructions and continue loop
        if (!refereeRes.rewriteInstructions) refereeRes.rewriteInstructions = [];
        const verifierInstructions = verifierRes.identifiedRisks.map((r: any) => `Resolve ${r.riskType} in ${r.field}: "${r.term}" - ${r.explanation}`);
        refereeRes.rewriteInstructions.push(...verifierInstructions);
        verifierRes.identifiedRisks.forEach((r: any) => {
          if (r.term && r.term.length > 2) forbiddenTermsForTask.push(r.term.toLowerCase());
        });
      }

      // C. If Rewrite is required (either from Referee or Verifier):
      if (cycle >= maxCycles) {
        console.warn(`[TrademarkServiceV2] 🚨 Rewrite-Limit von ${maxCycles} erreicht. Eskaliere zu Human Review.`);
        return {
          finalDecision: 'ESCALATE',
          isSafe: false,
          canBeFixedByListingRewrite: true,
          reasonCode: 'REWRITE_LIMIT_REACHED',
          recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
          initialTrademarkHits,
          finalTrademarkHits: normalizedHits,
          rewriteIterations,
          refereeResult: refereeRes,
          verifierResult: finalVerifierResult,
          forbiddenTermsForTask,
          blockedProducts,
          blockedNiceClasses,
          finalListing: currentListing
        };
      }

      // Collect terms that need fixing into forbidden list
      for (const h of refereeRes.hits) {
        if (h.decision === 'REWRITE' || h.action === 'REWRITE' || h.amazonRejectionRisk === 'HIGH' || h.amazonRejectionRisk === 'VERY_HIGH') {
          if (h.searchedTerm) forbiddenTermsForTask.push(h.searchedTerm.toLowerCase());
          if (h.registeredMark) forbiddenTermsForTask.push(h.registeredMark.toLowerCase());
        }
      }

      console.log(`[TrademarkServiceV2] ✍️ Führe SEO-Rewrite durch (Runde ${cycle + 1}). Verbotene Begriffe: [${forbiddenTermsForTask.join(', ')}]`);

      const rewriteRes = await LLMService.rewriteListingForTrademarkV2({
        currentListing,
        niche1: params.niche1,
        niche2: params.niche2,
        subniche: params.subniche,
        quote: params.quote,
        rewriteIteration: cycle + 1,
        forbiddenTermsForTask: Array.from(new Set(forbiddenTermsForTask)),
        rewriteInstructions: refereeRes.rewriteInstructions || [],
        hitsToFix: refereeRes.hits,
        sessionId: tmSessionId
      });

      currentListing = rewriteRes.refinedListing;

      rewriteIterations.push({
        iteration: cycle + 1,
        actionsTaken: rewriteRes.actionsTaken,
        listing: { ...currentListing },
        hitsFound: normalizedHits.length
      });

      params.onEvent?.({
        type: 'TM_REWRITE_RESPONSE',
        title: `SEO-Rewrite Runde ${cycle + 1} abgeschlossen`,
        content: { iteration: cycle + 1, actionsTaken: rewriteRes.actionsTaken, listing: currentListing },
        metadata: { provider: 'OpenRouter', model: rewriteRes._rawRequest?.model }
      });
    }

    // Default fallback escalation if loop finishes without safe verdict
    return {
      finalDecision: 'ESCALATE',
      isSafe: false,
      canBeFixedByListingRewrite: true,
      reasonCode: 'REWRITE_LIMIT_REACHED',
      recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
      initialTrademarkHits,
      finalTrademarkHits: [],
      rewriteIterations,
      refereeResult: finalRefereeResult,
      verifierResult: finalVerifierResult,
      forbiddenTermsForTask,
      blockedProducts,
      blockedNiceClasses,
      finalListing: currentListing
    };
  }
}


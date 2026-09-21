import { loadSettings } from './settingsService';
import { ProductCatalogService } from './productCatalogService';
import { TrademarkWhitelistService } from './trademarkWhitelistService';
import { LLMService, EnglishListing } from './llmService';
import { ListingValidationService } from './listingValidationService';
import { TrademarkWorkflowState, TrademarkWorkflowPhase } from '../../types/tasks';
import {
  TrademarkPolicyService,
  TrademarkScanIntegrity,
  TrademarkClearanceProofV3,
  TrademarkClassVerdict,
  TrademarkSourceRole,
  US_TM_POLICY_VERSION
} from './trademarkPolicyService';

export type TrademarkOffice = 'USPTO' | 'EUIPO' | 'DPMA';

export type MatchTypeV2 = 
  | 'FULL_EXACT'
  | 'EXACT_NGRAM'
  | 'SINGLE_WORD_EXACT'
  | 'CONTAINS_REGISTERED_MARK'
  | 'QUERY_INSIDE_LONGER_MARK'
  | 'FUZZY_OR_SIMILAR';

export type TrademarkMatchScope =
  | 'FULL_QUOTE_EXACT' | 'LOCKED_TAIL_EXACT' | 'FULL_BRAND_EXACT'
  | 'EXACT_NGRAM' | 'SINGLE_WORD_EXACT' | 'CONTAINS_MARK'
  | 'QUERY_INSIDE_MARK' | 'FUZZY_OR_SIMILAR';

export interface TrademarkHitV2 {
  id?: string;
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
  goodsServices?: string;
  sourceRole?: TrademarkSourceRole;
  matchScope?: TrademarkMatchScope;
}

export interface CompactOccurrence {
  field: string;
  matchedTerm?: string;
  sourceRole?: TrademarkSourceRole;
  matchScope?: TrademarkMatchScope;
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
  goodsServices?: string[];
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
  scanIntegrity?: TrademarkScanIntegrity;
  classVerdicts?: Record<string, TrademarkClassVerdict>;
  clearanceProof?: TrademarkClearanceProofV3;
}

export interface UsptoBatchQueryResult {
  hitsByTerm: Record<string, any[]>;
  integrity: TrademarkScanIntegrity;
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
    lockedTitleTail?: string;
  }): { terms: string[]; termToFieldsMap: Record<string, string[]>; droppedTermsCount: number } {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'by', 'from',
      'up', 'about', 'into', 'over', 'after', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'this', 'that', 'your', 'my', 'its', 'their', 'our', 'all', 'any', 'each', 'shirt', 'tshirt', 't-shirt'
    ]);

    const termToFieldsMap: Record<string, Set<string>> = {};
    const priorities = new Map<string, number>();
    const addTerm = (term: string, field: string, priority = 10) => {
      const clean = TrademarkPolicyService.normalizePhrase(term);
      if (clean.length < 2) return;
      if (!termToFieldsMap[clean]) termToFieldsMap[clean] = new Set();
      termToFieldsMap[clean].add(field);
      priorities.set(clean, Math.max(priorities.get(clean) || 0, priority));
    };

    const fields: Array<[string, string | undefined]> = [
      ['brand', params.listing.brand],
      ['title', params.listing.title],
      ['bullet1', params.listing.bullet1],
      ['bullet2', params.listing.bullet2],
      ['description', params.listing.description],
      ['quote', params.quote],
      ['lockedTitleTail', params.lockedTitleTail]
    ];

    for (const [field, text] of fields) {
      if (!text || typeof text !== 'string') continue;
      const trimmed = text.trim();
      if (!trimmed) continue;

      const rawTokens = trimmed
        .split(/[\s,.;:!?/()"\-+–—[\]{}#*~`^|\\]+/)
        .map(w => w.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '').trim().toLowerCase())
        .filter(Boolean);

      // Quote and locked tail are immutable exact-source terms. Their component
      // words remain ordinary listing occurrences where they actually appear.
      if ((field === 'quote' || field === 'lockedTitleTail') && rawTokens.length > 0) {
        addTerm(rawTokens.join(' '), field, field === 'quote' ? 100 : 99);
        continue;
      }

      if ((field === 'brand' && rawTokens.length > 0 || field === 'title' && rawTokens.length > 1) && trimmed.length <= 60) {
        addTerm(rawTokens.join(' '), field === 'brand' ? 'brandFull' : field, field === 'brand' ? 98 : 80);
      }

      // 1-Grams: add word if length >= 3 and not a single stopword
      for (const w of rawTokens) {
        if (field === 'brand' && rawTokens.length === 1) continue;
        if (w.length >= 3 && !stopWords.has(w)) {
          addTerm(w, field, field === 'brand' ? 70 : field === 'title' ? 55 : 25);
        }
      }

      // 2-Grams to 5-Grams (preserve stopwords inside multi-word phrases!)
      const maxGram = field === 'brand' || field === 'title' ? 5 : 3;
      for (let len = 2; len <= maxGram; len++) {
        for (let i = 0; i <= rawTokens.length - len; i++) {
          const nGramTokens = rawTokens.slice(i, i + len);
          if (field === 'brand' && len === rawTokens.length && i === 0) continue;
          const hasSubstantialWord = nGramTokens.some(tok => !stopWords.has(tok) && tok.length >= 3);
          if (hasSubstantialWord) {
            addTerm(nGramTokens.join(' '), field, (field === 'brand' ? 75 : field === 'title' ? 60 : 30) + len);
          }
        }
      }
    }

    const orderedTerms = Object.keys(termToFieldsMap).sort((a, b) =>
      (priorities.get(b) || 0) - (priorities.get(a) || 0) || a.localeCompare(b)
    );
    const maxTerms = 200;
    const selectedTerms = orderedTerms.slice(0, maxTerms);
    const result: Record<string, string[]> = {};
    for (const t of selectedTerms) {
      const set = termToFieldsMap[t];
      result[t] = Array.from(set);
    }

    return {
      terms: Object.keys(result),
      termToFieldsMap: result,
      droppedTermsCount: Math.max(0, orderedTerms.length - selectedTerms.length)
    };
  }

  /**
   * Query USPTO batch endpoint (batching up to 50 terms per request)
   */
  static async queryUsptoBatch(terms: string[], niceClasses: number[] = [25]): Promise<UsptoBatchQueryResult> {
    const settings = loadSettings();
    const allResults: Record<string, any[]> = {};
    const startedAt = new Date().toISOString();
    const classes = [...new Set(niceClasses.filter(Number.isInteger))].sort((a, b) => a - b);
    const chunkSize = 50;
    const plannedBatches = Math.ceil(terms.length / chunkSize);
    const integrity: TrademarkScanIntegrity = {
      status: 'COMPLETE', provider: 'PRODUCTOR_USPTO', requestedClasses: classes,
      plannedTerms: terms.length, plannedBatches, successfulBatches: 0, failedBatches: 0,
      attempts: 0, ignoredPendingCount: 0, unknownStatusCount: 0, unknownClassCount: 0,
      startedAt, errors: []
    };
    if (terms.length === 0) {
      integrity.completedAt = new Date().toISOString();
      return { hitsByTerm: allResults, integrity };
    }
    if (classes.length === 0) {
      integrity.status = 'FAILED';
      integrity.failedBatches = plannedBatches;
      integrity.errors.push({ batchIndex: 0, code: 'NO_NICE_CLASSES', message: 'No configured Nice classes available for USPTO scan' });
      integrity.completedAt = new Date().toISOString();
      return { hitsByTerm: allResults, integrity };
    }

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Origin': 'chrome-extension://kgicddkelkheehndihemgimanfdighkk',
      'Authorization': settings.productorUsptoAuth || 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng=='
    };

    for (let i = 0; i < terms.length; i += chunkSize) {
      const chunk = terms.slice(i, i + chunkSize);
      const batchIndex = Math.floor(i / chunkSize);
      let succeeded = false;
      for (let attempt = 1; attempt <= 3 && !succeeded; attempt++) {
        integrity.attempts++;
        try {
          if (attempt > 1) await new Promise(resolve => setTimeout(resolve, attempt === 2 ? 350 : 1200));
          const fd = new FormData();
          fd.append('trademarks', JSON.stringify(chunk));
          const res = await fetch(`https://uspto-tm-api2.productor.io/search-batch?classes=${classes.join(',')}`, {
            method: 'POST', headers: defaultHeaders, body: fd, signal: AbortSignal.timeout(10000)
          });
          if (!res.ok) {
            const error: any = new Error(`USPTO HTTP ${res.status}`);
            error.httpStatus = res.status;
            throw error;
          }
          const data = await res.json();
          if (!data || typeof data !== 'object') throw new Error('USPTO response has invalid schema');
          if (Array.isArray(data)) {
            if (data.length === 0) {
              succeeded = true;
              integrity.successfulBatches++;
              continue;
            }
            throw new Error('USPTO response has invalid non-empty array schema');
          }
          for (const [k, v] of Object.entries(data)) {
            if (!Array.isArray(v)) throw new Error(`USPTO response has invalid hit list for "${k}"`);
            if (v.length > 0) allResults[TrademarkPolicyService.normalizePhrase(k)] = v;
          }
          succeeded = true;
          integrity.successfulBatches++;
        } catch (err: any) {
          if (attempt === 3) {
            integrity.failedBatches++;
            integrity.errors.push({
              batchIndex,
              code: err?.httpStatus ? 'USPTO_HTTP_ERROR' : (err?.name === 'TimeoutError' ? 'USPTO_TIMEOUT' : 'USPTO_REQUEST_FAILED'),
              httpStatus: err?.httpStatus,
              message: err?.message || String(err)
            });
          }
        }
      }
    }
    integrity.status = integrity.failedBatches === 0 ? 'COMPLETE' : (integrity.successfulBatches > 0 ? 'INCOMPLETE' : 'FAILED');
    integrity.completedAt = new Date().toISOString();
    return { hitsByTerm: allResults, integrity };
  }

  /**
   * Deterministic Match Normalization & Classification before LLM
   */
  static normalizeAndClassifyMatches(
    rawHits: Record<string, any[]>,
    termToFieldsMap: Record<string, string[]>,
    quote?: string,
    lockedTitleTail?: string,
    integrity?: TrademarkScanIntegrity
  ): TrademarkHitV2[] {
    const normalizedHits: TrademarkHitV2[] = [];
    const cleanQuote = TrademarkPolicyService.normalizePhrase(quote);
    const cleanTail = TrademarkPolicyService.normalizePhrase(lockedTitleTail);
    const seenKeys = new Set<string>();

    for (const [term, records] of Object.entries(rawHits)) {
      const termLower = term.toLowerCase().trim();
      const fields = termToFieldsMap[termLower] || ['listing'];

      for (const r of records) {
        const rawStatus = r.status ?? r.status_code ?? r.markCurrentStatusCode ?? r.MarkCurrentStatusCode;
        const statusGroup = TrademarkPolicyService.classifyRegistryStatus(rawStatus);
        if (statusGroup === 'LIVE_PENDING') {
          if (integrity) integrity.ignoredPendingCount++;
          continue;
        }
        if (statusGroup === 'INACTIVE') continue;
        if (statusGroup === 'UNKNOWN') {
          if (integrity) integrity.unknownStatusCount++;
          continue;
        }

        const registeredMark = String(r.mark_identification || r.trademark || r.MarkVerbalElementText || term).trim();
        const regMarkClean = TrademarkPolicyService.normalizePhrase(registeredMark);
        const rawClasses = this.extractNiceClasses(r);
        const classes = rawClasses.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
        if (classes.length === 0) {
          if (integrity) integrity.unknownClassCount++;
          continue;
        }

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

        const isFullQuoteMatch = Boolean(cleanQuote && termLower === cleanQuote && regMarkClean === cleanQuote);
        const isKnownPhraseMatch = wordCount >= 2 && (matchType === 'EXACT_NGRAM' || matchType === 'FULL_EXACT' || matchType === 'CONTAINS_REGISTERED_MARK');

        const drawing = String(r.mark_drawing || r.MarkFeature || r.markFeature || '').toUpperCase();
        let markFeature = 'Word';
        if (drawing.includes('DESIGN') || drawing.includes('COMBINED') || drawing.includes('BILD') || drawing.includes('FIGURATIVE')) {
          markFeature = 'Combined';
        }

        for (const f of fields) {
          if (f === 'quote' && !isFullQuoteMatch) continue;
          const isLockedTailExact = f === 'lockedTitleTail' && Boolean(cleanTail && termLower === cleanTail && regMarkClean === cleanTail);
          if (f === 'lockedTitleTail' && !isLockedTailExact) continue;
          const outputField = f === 'brandFull' ? 'brand' : f;
          const uniqueKey = `USPTO-${registeredMark}-${classes.join(',')}-${termLower}-${outputField}-${f === 'brandFull' ? 'full' : 'part'}`;
          if (seenKeys.has(uniqueKey)) continue;
          seenKeys.add(uniqueKey);

          const sourceRole: TrademarkSourceRole = (f === 'brand' || f === 'brandFull') ? 'BRAND'
            : f === 'quote' ? 'PRINTED_QUOTE'
            : f === 'lockedTitleTail' ? 'LOCKED_TITLE_TAIL'
            : f === 'title' ? 'TITLE_PREFIX'
            : f === 'bullet1' ? 'BULLET_1'
            : f === 'bullet2' ? 'BULLET_2'
            : 'DESCRIPTION';
          const matchScope: TrademarkMatchScope = isFullQuoteMatch && sourceRole === 'PRINTED_QUOTE' ? 'FULL_QUOTE_EXACT'
            : isLockedTailExact ? 'LOCKED_TAIL_EXACT'
            : f === 'brandFull' && regMarkClean === termLower ? 'FULL_BRAND_EXACT'
            : matchType === 'EXACT_NGRAM' || matchType === 'FULL_EXACT' ? 'EXACT_NGRAM'
              : matchType === 'SINGLE_WORD_EXACT' ? 'SINGLE_WORD_EXACT'
              : matchType === 'CONTAINS_REGISTERED_MARK' ? 'CONTAINS_MARK'
              : matchType === 'QUERY_INSIDE_LONGER_MARK' ? 'QUERY_INSIDE_MARK'
              : 'FUZZY_OR_SIMILAR';

          normalizedHits.push({
            id: `hit_${normalizedHits.length + 1}`,
            searchedTerm: termLower,
            registeredMark,
            field: outputField,
            office: 'USPTO',
            status: statusGroup,
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
            ,goodsServices: r.goods_and_services || r.goods_services || r.GoodsServices
            ,sourceRole
            ,matchScope
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
      goodsServices: Set<string>;
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
          goodsServices: new Set(),
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
      if (h.goodsServices) entry.goodsServices.add(String(h.goodsServices).slice(0, 300));

      const field = h.field || 'listing';
      const rawMatched = String((h as any).matchedTerm || h.searchedTerm || '').trim();
      const matchedTerm = rawMatched.length > 0 ? rawMatched : undefined;
      const occKey = `${field.toLowerCase()}|${matchedTerm ? matchedTerm.toLowerCase() : ''}|${h.matchScope || ''}`;

      if (!entry.occurrencesMap.has(occKey)) {
        const occ: CompactOccurrence = { field, sourceRole: h.sourceRole, matchScope: h.matchScope };
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
        occurrences: Array.from(entry.occurrencesMap.values()),
        goodsServices: Array.from(entry.goodsServices).slice(0, 3)
      });
    }

    return compactList;
  }

  /**
   * Complete V3 Trademark Audit Orchestrator:
   * Scan ➔ normalization ➔ conditional configured-model review ➔ bounded rewrite ➔ proof
   */
  static async executeTrademarkAuditV2(params: {
    listing: EnglishListing;
    quote?: string;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    additionalProductIds?: string[];
    maxRewriteCycles?: number;
    taskId?: string;
    sessionId?: string;
    initialWorkflowState?: TrademarkWorkflowState;
    onPersistState?: (state: TrademarkWorkflowState) => void;
    onEvent?: (event: { type: string; title: string; content: any; metadata?: any }) => void;
  }): Promise<TrademarkAuditResultV2> {
    const normN1 = ListingValidationService.normalizeOptionalText(params.niche1);
    const normN2 = ListingValidationService.normalizeOptionalText(params.niche2);
    const normSub = ListingValidationService.normalizeOptionalText(params.subniche);
    const lockedTitleTail = ListingValidationService.resolveExpectedTitleSuffix({ niche1: normN1, niche2: normN2, subniche: normSub });
    const productScope = TrademarkPolicyService.resolveProductScope(params.additionalProductIds);
    if (!productScope.niceClasses.includes(25)) {
      const error: any = new Error('REQUIRED_CLASS_25_UNCONFIGURED: No enabled product is assigned to Nice Class 25');
      error.code = 'REQUIRED_CLASS_25_UNCONFIGURED';
      throw error;
    }

    const initState = params.initialWorkflowState;

    // Validate and sanitize incoming candidate listing
    const initialValidation = ListingValidationService.validateAndRepairListing({
      listing: initState?.currentListing ? initState.currentListing : params.listing,
      niche1: normN1,
      niche2: normN2,
      subniche: normSub
    });
    let currentListing: EnglishListing = { ...initialValidation.listing };
    const forbiddenTermsForTask: string[] = initState?.forbiddenTermsForTask ? [...initState.forbiddenTermsForTask] : [];
    const rewriteIterations: Array<{
      iteration: number;
      actionsTaken: string[];
      listing: EnglishListing;
      hitsFound: number;
    }> = initState?.rewriteIterations ? [...initState.rewriteIterations] : [];

    const tmSessionId = params.sessionId || (params.taskId ? `tm:${params.taskId}` : `tm:${Date.now()}`);
    const approvedHitContexts = new Set<string>(initState?.approvedHitContexts || []);

    const getHitContextKey = (mark: string, markFeature: string, classes: number[], matchType: string, field: string, text: string) => {
      const normText = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const normFeature = (markFeature || 'word').trim().toLowerCase();
      const configuredModel = loadSettings().llmModel || 'configured-model';
      return `${US_TM_POLICY_VERSION}|tm-referee-v3|${configuredModel}|${mark.toLowerCase()}|${normFeature}|${classes.slice().sort((a, b) => a - b).join(',')}|${matchType}|${field}|${normText}`;
    };

    let initialTrademarkHits: TrademarkHitV2[] = (initState?.initialTrademarkHits as any) || [];
    let lastTrademarkHits: TrademarkHitV2[] = (initState?.lastTrademarkHits as any) || [];
    let finalRefereeResult: any = initState?.lastRefereeResult || null;
    let finalVerifierResult: any = initState?.lastVerifierResult || null;
    let blockedProducts: string[] = [...new Set([
      ...(initState?.blockedProducts || []),
      ...productScope.unconfiguredProductIds
    ])].sort();
    let blockedNiceClasses: number[] = initState?.blockedNiceClasses ? [...initState.blockedNiceClasses] : [];
    let lastScanIntegrity: TrademarkScanIntegrity | undefined = initState?.scanIntegrity;
    let finalClearanceProof: TrademarkClearanceProofV3 | undefined = initState?.clearanceProof;
    let technicalRetryCount = initState?.technicalRetryCount || 0;
    let nextTechnicalRetryAt = initState?.nextTechnicalRetryAt;
    let maxCycles = params.maxRewriteCycles ?? 3;
    if (rewriteIterations.length >= 4) maxCycles = Math.max(maxCycles, 4);

    // Helper to persist state to disk immediately before and after external decisions
    const saveState = (phase: TrademarkWorkflowPhase) => {
      const state: TrademarkWorkflowState = {
        phase,
        rewriteAttemptsCompleted: rewriteIterations.length,
        currentListing: { ...currentListing },
        forbiddenTermsForTask: [...forbiddenTermsForTask],
        rewriteIterations: [...rewriteIterations],
        lastRefereeResult: finalRefereeResult,
        lastVerifierResult: finalVerifierResult,
        blockedProducts: [...blockedProducts],
        blockedNiceClasses: [...blockedNiceClasses],
        initialTrademarkHits: [...initialTrademarkHits],
        lastTrademarkHits: [...lastTrademarkHits],
        policyVersion: US_TM_POLICY_VERSION,
        catalogFingerprint: productScope.catalogFingerprint,
        approvedHitContexts: [...approvedHitContexts],
        scanIntegrity: lastScanIntegrity,
        classVerdicts: finalClearanceProof?.classVerdicts,
        clearanceProof: finalClearanceProof,
        technicalRetryCount,
        nextTechnicalRetryAt
        ,lastCheckedListing: { ...currentListing }
      };
      if (params.onPersistState) {
        params.onPersistState(state);
      } else if (params.taskId) {
        try {
          const { TaskLogService } = require('./taskLogService');
          TaskLogService.updateTaskStatus(params.taskId, { trademarkWorkflowState: state });
        } catch {}
      }
    };

    const scheduleTechnicalRetry = () => {
      technicalRetryCount += 1;
      const delaysMinutes = [15, 60, 360];
      const delay = delaysMinutes[Math.min(technicalRetryCount - 1, delaysMinutes.length - 1)];
      nextTechnicalRetryAt = technicalRetryCount <= delaysMinutes.length
        ? new Date(Date.now() + delay * 60 * 1000).toISOString()
        : undefined;
      saveState('TECHNICAL_RETRY_WAIT');
    };

    const buildClearanceProof = (hits: TrademarkHitV2[], referee: any): TrademarkClearanceProofV3 => {
      const classVerdicts = TrademarkPolicyService.buildClassVerdicts({
        niceClasses: productScope.niceClasses,
        products: productScope.products,
        hits,
        problematicHits: [],
        blockedNiceClasses
      });
      const blockedProductIds = [...new Set([
        ...productScope.unconfiguredProductIds,
        ...TrademarkPolicyService.productsForClasses(productScope.products, blockedNiceClasses)
      ])].sort();
      const blockedSet = new Set(blockedProductIds);
      const sourceStatus = (role: TrademarkSourceRole) => hits.some(hit => hit.sourceRole === role)
        ? 'FAIR_USE_CLEAR' as const : 'CLEAR' as const;
      return {
        schemaVersion: 3,
        policyVersion: US_TM_POLICY_VERSION,
        marketplace: 'US',
        finalDecision: blockedProductIds.length > 0 ? 'APPROVED_WITH_BLOCKED_PRODUCTS' : 'APPROVED',
        scanIntegrity: lastScanIntegrity!,
        model: referee?._rawRequest?.model || (hits.length === 0 ? 'deterministic/no-llm' : (loadSettings().llmModel || 'configured-model')),
        promptVersion: 'tm-referee-v3',
        evaluatedAt: new Date().toISOString(),
        listingFingerprint: TrademarkPolicyService.listingFingerprint(currentListing as any),
        catalogFingerprint: productScope.catalogFingerprint,
        queriedNiceClasses: productScope.niceClasses,
        classVerdicts,
        allowedProductIds: productScope.productIds.filter(id => !blockedSet.has(id)),
        blockedProductIds,
        blockedNiceClasses: [...blockedNiceClasses].sort((a, b) => a - b),
        brandStatus: 'CLEAR',
        quoteStatus: sourceStatus('PRINTED_QUOTE'),
        lockedTailStatus: sourceStatus('LOCKED_TITLE_TAIL')
      };
    };

    // Determine starting cycle and initial action
    const startCycle = rewriteIterations.length;
    let resumePhase: TrademarkWorkflowPhase | null = initState?.phase || null;
    let skipToVerifier = resumePhase === 'VERIFY';

    saveState(resumePhase || 'INITIAL_SCAN');

    if (resumePhase === 'REWRITE' && rewriteIterations.length >= maxCycles) {
      const unresolvedClasses = [...new Set((finalRefereeResult?.hits || []).flatMap((hit: any) => Array.isArray(hit.classes) ? hit.classes : []))]
        .filter((value): value is number => Number.isInteger(value));
      const unresolvedBrand = (finalRefereeResult?.hits || []).some((hit: any) =>
        String(hit.field || '').toLowerCase() === 'brand'
        && ['REWRITE', 'ESCALATE', 'MANUAL_REVIEW'].includes(String(hit.action || hit.decision || '').toUpperCase())
      );
      const progressCounts = [
        ...rewriteIterations.map(iteration => iteration.hitsFound),
        lastTrademarkHits.length
      ];
      const resumeFourthSecondaryAttempt = maxCycles === 3 && rewriteIterations.length === 3
        && unresolvedClasses.length > 0 && !unresolvedClasses.includes(25) && !unresolvedBrand
        && Array.isArray(initState?.lastTrademarkHits)
        && TrademarkPolicyService.hasStrictHitCountProgress(progressCounts);
      if (resumeFourthSecondaryAttempt) {
        maxCycles = 4;
      } else {
        console.warn(`[TrademarkServiceV2] 🚨 Rewrite-Limit von ${maxCycles} erreicht. Eskaliere zu Human Review.`);
        saveState('ESCALATED');
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
        finalListing: ListingValidationService.validateAndRepairListing({
          listing: currentListing,
          niche1: normN1,
          niche2: normN2,
          subniche: normSub,
          forbiddenTerms: forbiddenTermsForTask
        }).listing
        };
      }
    }

    for (let cycle = startCycle; cycle <= maxCycles; cycle++) {
      console.log(`[TrademarkServiceV2] 🔍 Starte USPTO Scan (Zyklus ${cycle} von ${maxCycles}, Session: ${tmSessionId}, Completed Rewrites: ${rewriteIterations.length})...`);

      // 1. Term extraction V2
      const { terms, termToFieldsMap, droppedTermsCount } = this.extractTermsFromTextV2({
        listing: currentListing,
        quote: params.quote,
        lockedTitleTail
      });
      if (droppedTermsCount > 0) {
        params.onEvent?.({
          type: 'TM_SEARCH_PLAN_BUDGET',
          title: `USPTO-Suchplan priorisiert (${terms.length} Begriffe)`,
          content: { selectedTerms: terms.length, droppedLowPriorityTerms: droppedTermsCount }
        });
      }

      // 2. USPTO Live query
      const queryResult = await this.queryUsptoBatch(terms, productScope.niceClasses);
      lastScanIntegrity = queryResult.integrity;
      const rawHits = queryResult.hitsByTerm;

      if (queryResult.integrity.status !== 'COMPLETE') {
        finalRefereeResult = null;
        scheduleTechnicalRetry();
        return {
          finalDecision: 'ESCALATE', isSafe: false, canBeFixedByListingRewrite: false,
          reasonCode: 'USPTO_SCAN_INCOMPLETE', recommendedAction: 'AUTOMATIC_TECHNICAL_RETRY',
          initialTrademarkHits, finalTrademarkHits: [], rewriteIterations,
          refereeResult: null, verifierResult: null, forbiddenTermsForTask,
          blockedProducts, blockedNiceClasses, finalListing: currentListing,
          scanIntegrity: queryResult.integrity
        };
      }
      nextTechnicalRetryAt = undefined;

      // 3. Match classification (Full internal details preserved for audit & UI)
      const normalizedHits = this.normalizeAndClassifyMatches(rawHits, termToFieldsMap, params.quote, lockedTitleTail, queryResult.integrity);
      lastTrademarkHits = [...normalizedHits];
      if (queryResult.integrity.unknownStatusCount > 0 || queryResult.integrity.unknownClassCount > 0) {
        queryResult.integrity.status = 'INCOMPLETE';
      }
      if (queryResult.integrity.status !== 'COMPLETE') {
        scheduleTechnicalRetry();
        return {
          finalDecision: 'ESCALATE', isSafe: false, canBeFixedByListingRewrite: false,
          reasonCode: 'USPTO_SCAN_INCOMPLETE', recommendedAction: 'AUTOMATIC_TECHNICAL_RETRY',
          initialTrademarkHits, finalTrademarkHits: normalizedHits, rewriteIterations,
          refereeResult: null, verifierResult: null, forbiddenTermsForTask,
          blockedProducts, blockedNiceClasses, finalListing: currentListing,
          scanIntegrity: queryResult.integrity
        };
      }

      if (cycle === 0) {
        initialTrademarkHits = [...normalizedHits];
      }

      // Compact representation for LLM evaluation
      const compactHits = this.buildCompactTrademarkHits(normalizedHits, currentListing, params.quote);

      const immutableClass25Conflict = compactHits.find(hit =>
        hit.classes.includes(25) && hit.feature === 'Word' && hit.mark.trim().split(/\s+/).length >= 2
        && (hit.fullQuoteMatch || hit.occurrences.some(occ => occ.sourceRole === 'LOCKED_TITLE_TAIL'))
      );
      if (immutableClass25Conflict) {
        saveState('ESCALATED');
        return {
          finalDecision: 'ESCALATE', isSafe: false, canBeFixedByListingRewrite: false,
          reasonCode: immutableClass25Conflict.fullQuoteMatch ? 'CORE_QUOTE_CLASS25_CONFLICT' : 'LOCKED_TAIL_CLASS25_CONFLICT',
          recommendedAction: 'DO_NOT_SUBMIT', initialTrademarkHits,
          finalTrademarkHits: normalizedHits, rewriteIterations, refereeResult: null,
          verifierResult: null, forbiddenTermsForTask, blockedProducts, blockedNiceClasses,
          finalListing: currentListing, scanIntegrity: lastScanIntegrity
        };
      }

      params.onEvent?.({
        type: 'TM_SCAN_RESPONSE',
        title: cycle === 0 ? `USPTO TM Scan abgeschlossen (${normalizedHits.length} Treffer, ${compactHits.length} kompakt)` : `USPTO TM Scan (Runde ${cycle}: ${normalizedHits.length} Treffer, ${compactHits.length} kompakt)`,
        content: { cycle, totalHits: normalizedHits.length, compactHitsCount: compactHits.length, termsCheckedCount: terms.length, scanIntegrity: queryResult.integrity, hits: normalizedHits }
      });

      // Check which hits are genuinely new or in a modified context (Hit-Re-Use optimization)
      const hitsToReview = cycle === 0 ? compactHits : compactHits.filter(h => {
        return h.occurrences.some(occ => {
          const fieldText = TrademarkService.getFieldText(currentListing, occ.field, params.quote);
          return !approvedHitContexts.has(getHitContextKey(h.mark, h.feature, h.classes, h.matchType, occ.field, fieldText));
        });
      });

      let refereeRes: any;
      let resumedDirectlyAtVerifier = false;

      if (skipToVerifier) {
        console.log(`[TrademarkServiceV2] ⚡ Resuming directly at VERIFY phase for rewrite iteration ${rewriteIterations.length}. Skipping scan/referee.`);
        skipToVerifier = false;
        resumedDirectlyAtVerifier = true;
        refereeRes = finalRefereeResult || {
          decision: 'APPROVE',
          canBeFixedByListingRewrite: true,
          hits: [],
          blockedProducts
        };
      } else if (cycle > 0 && hitsToReview.length === 0) {
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
        saveState('REFEREE');
        // 4. Trademark Referee Pass using the generally configured model
        refereeRes = await LLMService.evaluateTrademarkReferee({
          currentListing,
          niche1: normN1,
          niche2: normN2,
          subniche: normSub,
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

      const brandHitIds = new Set(compactHits.filter(hit => hit.occurrences.some(occ => occ.sourceRole === 'BRAND')).map(hit => hit.id));
      const hitsUnderReview = new Set(hitsToReview.map(hit => hit.id));
      const requiredHitIds = new Set(compactHits.filter(hit => hitsUnderReview.has(hit.id) && (
        hit.classes.includes(25) || hit.feature === 'Combined' || hit.fullQuoteMatch
        || hit.occurrences.some(occ => occ.sourceRole === 'BRAND' || occ.sourceRole === 'LOCKED_TITLE_TAIL')
      )).map(hit => hit.id));
      const semanticErrors = resumedDirectlyAtVerifier ? [] : TrademarkPolicyService.validateSemanticDecisions(
        refereeRes.hits || [], new Set(compactHits.map(hit => hit.id)), brandHitIds, requiredHitIds
      );
      const compactHitsById = new Map(compactHits.map(hit => [hit.id, hit]));
      for (const evaluatedHit of refereeRes.hits || []) {
        const factualHit = compactHitsById.get(evaluatedHit.id);
        if (!factualHit) continue;
        const reportedClasses = Array.isArray(evaluatedHit.classes)
          ? evaluatedHit.classes.filter(Number.isInteger).sort((a: number, b: number) => a - b)
          : [];
        const factualClasses = [...factualHit.classes].sort((a, b) => a - b);
        if (JSON.stringify(reportedClasses) !== JSON.stringify(factualClasses)) {
          semanticErrors.push(`Invented or missing classes for ${evaluatedHit.id}`);
        }
        const factualFields = new Set(factualHit.occurrences.map(occurrence => occurrence.field));
        if (!factualFields.has(evaluatedHit.field)) {
          semanticErrors.push(`Invented or missing field for ${evaluatedHit.id}`);
        }
      }
      const knownBrandSignals = Array.isArray(refereeRes.knownBrandSignals) ? refereeRes.knownBrandSignals : [];
      const validSignalFields = new Set(['brand', 'title', 'bullet1', 'bullet2', 'description', 'quote']);
      for (const signal of knownBrandSignals) {
        const fieldText = signal.field === 'quote'
          ? String(params.quote || '')
          : validSignalFields.has(signal.field) ? String((currentListing as any)[signal.field] || '') : '';
        if (!signal.term || !validSignalFields.has(signal.field)
          || !Number.isFinite(signal.confidence) || signal.confidence < 0.9 || signal.confidence > 1
          || !['REWRITE', 'MANUAL_REVIEW'].includes(signal.action)
          || (signal.field === 'quote' && signal.action !== 'MANUAL_REVIEW')
          || !TrademarkPolicyService.normalizePhrase(fieldText).includes(TrademarkPolicyService.normalizePhrase(signal.term))) {
          semanticErrors.push('Invalid known-brand signal');
        }
      }
      const semanticActions = [
        ...(refereeRes.hits || []).map((hit: any) => String(hit.action || hit.decision || '').toUpperCase()),
        ...knownBrandSignals.map((signal: any) => String(signal.action || '').toUpperCase())
      ];
      if ((refereeRes.decision === 'APPROVE' || refereeRes.decision === 'APPROVE_WITH_BLOCKED_PRODUCTS')
        && semanticActions.some((action: string) => action === 'REWRITE' || action === 'MANUAL_REVIEW' || action === 'ESCALATE')) {
        semanticErrors.push('Approval contradicts unresolved semantic actions');
      }
      if (refereeRes.decision === 'REWRITE' && !semanticActions.includes('REWRITE')) {
        semanticErrors.push('Rewrite decision has no supplied hit requiring rewrite');
      }
      const blockedHitIds = new Set((refereeRes.hits || [])
        .filter((hit: any) => String(hit.action || hit.decision || '').toUpperCase() === 'BLOCK_CLASS')
        .map((hit: any) => hit.id));
      if (refereeRes.decision === 'APPROVE_WITH_BLOCKED_PRODUCTS' && blockedHitIds.size === 0) {
        semanticErrors.push('Blocked-products decision has no supplied class-block action');
      }
      const requestedBlockedClasses = compactHits
        .filter(hit => blockedHitIds.has(hit.id))
        .flatMap(hit => hit.classes);
      if (requestedBlockedClasses.includes(25)) {
        semanticErrors.push('Class 25 cannot be product-blocked by the semantic referee');
      }
      if (semanticErrors.length > 0) {
        refereeRes = {
          ...refereeRes,
          decision: 'ESCALATE', canBeFixedByListingRewrite: false,
          reasonCode: 'INVALID_AI_RESPONSE', recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
          escalation: { errors: semanticErrors }
        };
        finalRefereeResult = refereeRes;
      } else if (requestedBlockedClasses.length > 0) {
        blockedNiceClasses = [...new Set([...blockedNiceClasses, ...requestedBlockedClasses])].sort((a, b) => a - b);
        blockedProducts = [...new Set([
          ...productScope.unconfiguredProductIds,
          ...TrademarkPolicyService.productsForClasses(productScope.products, blockedNiceClasses)
        ])].sort();
      }
      for (const signal of knownBrandSignals) {
        if (signal.action === 'REWRITE' && signal.term) {
          forbiddenTermsForTask.push(TrademarkPolicyService.normalizePhrase(signal.term));
          refereeRes.rewriteInstructions = [...(refereeRes.rewriteInstructions || []), `Remove known third-party brand/IP term "${signal.term}" from ${signal.field}.`];
        }
      }

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

      // Product IDs are never accepted from the LLM. They are resolved only
      // from Nice classes through the effective Product Catalog.

      params.onEvent?.({
        type: 'TM_REFEREE_RESPONSE',
        title: `Trademark Referee: ${refereeRes.decision} (Zyklus ${cycle})`,
        content: { decision: refereeRes.decision, canBeFixedByListingRewrite: refereeRes.canBeFixedByListingRewrite, reasonCode: refereeRes.reasonCode, actions: refereeRes.hits },
        metadata: { provider: 'OpenRouter', model: refereeRes._rawRequest?.model, usage: refereeRes._usage }
      });

      // A. Check for Immediate Escalation (Only if decision is ESCALATE, or if REWRITE is unfixable due to core quote)
      if (refereeRes.decision === 'ESCALATE' || (refereeRes.decision === 'REWRITE' && refereeRes.canBeFixedByListingRewrite === false)) {
        const reasonCode = refereeRes.reasonCode || (refereeRes.decision === 'ESCALATE' ? 'CORE_QUOTE_CLASS25_CONFLICT' : 'UNFIXABLE_TRADEMARK_CONFLICT');
        console.warn(`[TrademarkServiceV2] 🚨 Eskalation ausgelöst: ${reasonCode}`);
        saveState('ESCALATED');
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
          finalListing: ListingValidationService.validateAndRepairListing({
            listing: currentListing,
            niche1: normN1,
            niche2: normN2,
            subniche: normSub,
            forbiddenTerms: forbiddenTermsForTask
          }).listing
        };
      }

      // B. If Referee approves (APPROVE or APPROVE_WITH_BLOCKED_PRODUCTS) ➔ Run Adversarial Verifier Pass as FINAL GATE!
      if (refereeRes.decision === 'APPROVE' || refereeRes.decision === 'APPROVE_WITH_BLOCKED_PRODUCTS') {
        const requiresVerifier = rewriteIterations.length > 0 || compactHits.some(hit =>
          hit.fullQuoteMatch || hit.classes.includes(25) || hit.feature === 'Combined'
          || hit.occurrences.some(occ => occ.sourceRole === 'LOCKED_TITLE_TAIL')
        ) || knownBrandSignals.length > 0
          || (refereeRes.hits || []).some((hit: any) => Number(hit.confidence) < 0.9 || hit.usageClassification === 'KNOWN_BRAND_OR_IP');
        if (!requiresVerifier) {
          finalClearanceProof = buildClearanceProof(normalizedHits, refereeRes);
          saveState('COMPLETED');
          return {
            finalDecision: finalClearanceProof.finalDecision === 'APPROVED' ? 'APPROVED' : 'APPROVE_WITH_BLOCKED_PRODUCTS',
            isSafe: true, canBeFixedByListingRewrite: true, reasonCode: null, recommendedAction: null,
            initialTrademarkHits, finalTrademarkHits: normalizedHits, rewriteIterations,
            refereeResult: refereeRes, verifierResult: null, forbiddenTermsForTask,
            blockedProducts: finalClearanceProof.blockedProductIds,
            blockedNiceClasses: finalClearanceProof.blockedNiceClasses,
            finalListing: currentListing, scanIntegrity: lastScanIntegrity,
            classVerdicts: finalClearanceProof.classVerdicts,
            clearanceProof: finalClearanceProof
          };
        }
        console.log(`[TrademarkServiceV2] 🛡️ Referee hat genehmigt (${refereeRes.decision}). Starte Verifier als Final Gate...`);
        saveState('VERIFY');
        
        const verifierRes = await LLMService.evaluateTrademarkVerifier({
          currentListing,
          niche1: normN1,
          niche2: normN2,
          subniche: normSub,
          quote: params.quote,
          compactHits, // Final Verifier receives the FULL compact hits of the candidate
          normalizedHits,
          refereeDecision: refereeRes.decision,
          refereeHits: refereeRes.hits || [],
          blockedProducts,
          sessionId: tmSessionId
        });

        finalVerifierResult = verifierRes;

        params.onEvent?.({
          type: 'TM_VERIFIER_RESPONSE',
          title: `Amazon Rejection Verifier: ${verifierRes.verdict}`,
          content: { verdict: verifierRes.verdict, recommendation: verifierRes.recommendation, risks: verifierRes.identifiedRisks },
          metadata: { provider: 'OpenRouter', model: verifierRes._rawRequest?.model, usage: verifierRes._usage }
        });

        if (verifierRes.verdict === 'SAFE') {
          console.log(`[TrademarkServiceV2] ✅ Verifier bestätigt SAFE. Listing endgültig freigegeben!`);
          finalClearanceProof = buildClearanceProof(normalizedHits, refereeRes);
          saveState('COMPLETED');
          return {
            finalDecision: finalClearanceProof.finalDecision === 'APPROVED' ? 'APPROVED' : 'APPROVE_WITH_BLOCKED_PRODUCTS',
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
            blockedProducts: finalClearanceProof.blockedProductIds,
            blockedNiceClasses: finalClearanceProof.blockedNiceClasses,
            finalListing: ListingValidationService.validateAndRepairListing({
              listing: currentListing,
              niche1: normN1,
              niche2: normN2,
              subniche: normSub,
              forbiddenTerms: forbiddenTermsForTask
            }).listing
            ,scanIntegrity: lastScanIntegrity
            ,classVerdicts: finalClearanceProof.classVerdicts
            ,clearanceProof: finalClearanceProof
          };
        }

        // If Verifier flagged HIGH_RISK:
        console.warn(`[TrademarkServiceV2] ⚠️ Verifier hat HIGH_RISK gemeldet (${verifierRes.identifiedRisks.length} Risiken).`);
        const hasInvalidAi = verifierRes.identifiedRisks?.some((r: any) => r.riskType === 'INVALID_AI_RESPONSE');
        if (!verifierRes.canBeFixedByListingRewrite || hasInvalidAi) {
          const reasonCode = hasInvalidAi ? 'INVALID_AI_RESPONSE' : 'VERIFIER_UNFIXABLE_RISK';
          saveState('ESCALATED');
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
            finalListing: ListingValidationService.validateAndRepairListing({
              listing: currentListing,
              niche1: normN1,
              niche2: normN2,
              subniche: normSub,
              forbiddenTerms: forbiddenTermsForTask
            }).listing
          };
        }

        if (rewriteIterations.length >= maxCycles) {
          saveState('ESCALATED');
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
            finalListing: ListingValidationService.validateAndRepairListing({
              listing: currentListing,
              niche1: normN1,
              niche2: normN2,
              subniche: normSub,
              forbiddenTerms: forbiddenTermsForTask
            }).listing
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
      if (rewriteIterations.length >= maxCycles) {
        const unresolvedClasses = [...new Set((refereeRes.hits || []).flatMap((hit: any) => Array.isArray(hit.classes) ? hit.classes : []))]
          .filter((value): value is number => Number.isInteger(value));
        const unresolvedBrand = (refereeRes.hits || []).some((hit: any) =>
          String(hit.field || '').toLowerCase() === 'brand'
          && ['REWRITE', 'ESCALATE', 'MANUAL_REVIEW'].includes(String(hit.action || hit.decision || '').toUpperCase())
        ) || knownBrandSignals.some((signal: any) => String(signal.field || '').toLowerCase() === 'brand');
        const progressCounts = [
          ...rewriteIterations.map(iteration => iteration.hitsFound),
          normalizedHits.length
        ];
        const previousHitCount = progressCounts[progressCounts.length - 2] ?? Number.POSITIVE_INFINITY;
        const qualifiesForFourthSecondaryAttempt = maxCycles === 3
          && rewriteIterations.length === 3
          && unresolvedClasses.length > 0
          && !unresolvedClasses.includes(25)
          && !unresolvedBrand
          && TrademarkPolicyService.hasStrictHitCountProgress(progressCounts);
        if (qualifiesForFourthSecondaryAttempt) {
          maxCycles = 4;
          params.onEvent?.({
            type: 'TM_REWRITE_EXTENSION',
            title: 'Ein vierter Rewrite nur für fortschreitenden Nebenklassen-Konflikt',
            content: { previousHitCount, currentHitCount: normalizedHits.length, unresolvedClasses }
          });
        } else if (unresolvedClasses.length > 0 && !unresolvedClasses.includes(25) && !unresolvedBrand) {
          blockedNiceClasses = [...new Set([...blockedNiceClasses, ...unresolvedClasses])].sort((a, b) => a - b);
          blockedProducts = [...new Set([
            ...productScope.unconfiguredProductIds,
            ...TrademarkPolicyService.productsForClasses(productScope.products, blockedNiceClasses)
          ])].sort();
          finalClearanceProof = buildClearanceProof(normalizedHits, refereeRes);
          saveState('COMPLETED');
          return {
            finalDecision: 'APPROVE_WITH_BLOCKED_PRODUCTS', isSafe: true,
            canBeFixedByListingRewrite: false, reasonCode: 'SECONDARY_CLASSES_BLOCKED_AFTER_REWRITE_LIMIT',
            recommendedAction: 'PUBLISH_ALLOWED_PRODUCTS', initialTrademarkHits,
            finalTrademarkHits: normalizedHits, rewriteIterations, refereeResult: refereeRes,
            verifierResult: finalVerifierResult, forbiddenTermsForTask,
            blockedProducts, blockedNiceClasses, finalListing: currentListing,
            scanIntegrity: lastScanIntegrity, classVerdicts: finalClearanceProof.classVerdicts,
            clearanceProof: finalClearanceProof
          };
        } else {
          console.warn(`[TrademarkServiceV2] 🚨 Rewrite-Limit von ${maxCycles} erreicht. Class 25/Brand bleibt manuell zu prüfen.`);
          saveState('ESCALATED');
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
          finalListing: ListingValidationService.validateAndRepairListing({
            listing: currentListing,
            niche1: normN1,
            niche2: normN2,
            subniche: normSub,
            forbiddenTerms: forbiddenTermsForTask
          }).listing
          };
        }
      }

      // Collect terms that need fixing into forbidden list
      for (const h of refereeRes.hits) {
        if (h.decision === 'REWRITE' || h.action === 'REWRITE' || h.amazonRejectionRisk === 'HIGH' || h.amazonRejectionRisk === 'VERY_HIGH') {
          if (h.searchedTerm) forbiddenTermsForTask.push(h.searchedTerm.toLowerCase());
          if (h.registeredMark) forbiddenTermsForTask.push(h.registeredMark.toLowerCase());
        }
      }

      console.log(`[TrademarkServiceV2] ✍️ Führe SEO-Rewrite durch (Runde ${rewriteIterations.length + 1}). Verbotene Begriffe: [${forbiddenTermsForTask.join(', ')}]`);
      saveState('REWRITE');

      const listingFields = ['brand', 'title', 'bullet1', 'bullet2', 'description'] as const;
      const affectedFields = new Set<string>([
        ...(refereeRes.hits || []).map((hit: any) => hit.field),
        ...knownBrandSignals.map((signal: any) => signal.field),
        ...(finalVerifierResult?.identifiedRisks || []).map((risk: any) => risk.field)
      ].filter((field: any) => listingFields.includes(field)));
      if (affectedFields.size === 0) {
        saveState('ESCALATED');
        return {
          finalDecision: 'ESCALATE', isSafe: false, canBeFixedByListingRewrite: false,
          reasonCode: 'INVALID_AI_RESPONSE', recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
          initialTrademarkHits, finalTrademarkHits: normalizedHits, rewriteIterations,
          refereeResult: refereeRes, verifierResult: finalVerifierResult,
          forbiddenTermsForTask, blockedProducts, blockedNiceClasses, finalListing: currentListing,
          scanIntegrity: lastScanIntegrity
        };
      }
      const listingBeforeRewrite = { ...currentListing };

      const rewriteRes = await LLMService.rewriteListingForTrademarkV2({
        currentListing,
        niche1: normN1,
        niche2: normN2,
        subniche: normSub,
        quote: params.quote,
        rewriteIteration: rewriteIterations.length + 1,
        forbiddenTermsForTask: Array.from(new Set(forbiddenTermsForTask)),
        rewriteInstructions: refereeRes.rewriteInstructions || [],
        hitsToFix: refereeRes.hits,
        sessionId: tmSessionId
      });

      currentListing = rewriteRes.refinedListing;
      const changedOutsideContract = listingFields.filter(field =>
        !affectedFields.has(field) && currentListing[field] !== listingBeforeRewrite[field]
      );
      if (changedOutsideContract.length > 0
        || TrademarkPolicyService.listingFingerprint(currentListing) === TrademarkPolicyService.listingFingerprint(listingBeforeRewrite)) {
        const reasonCode = changedOutsideContract.length > 0 ? 'REWRITE_SCOPE_VIOLATION' : 'REWRITE_STAGNATION';
        saveState('ESCALATED');
        return {
          finalDecision: 'ESCALATE', isSafe: false, canBeFixedByListingRewrite: false,
          reasonCode, recommendedAction: 'HUMAN_REVIEW_RECOMMENDED', initialTrademarkHits,
          finalTrademarkHits: normalizedHits, rewriteIterations, refereeResult: refereeRes,
          verifierResult: finalVerifierResult, forbiddenTermsForTask, blockedProducts,
          blockedNiceClasses, finalListing: listingBeforeRewrite, scanIntegrity: lastScanIntegrity
        };
      }

      const postRewriteValidation = ListingValidationService.validateAndRepairListing({
        listing: currentListing,
        niche1: normN1,
        niche2: normN2,
        subniche: normSub,
        forbiddenTerms: forbiddenTermsForTask
      });
      currentListing = postRewriteValidation.listing;

      rewriteIterations.push({
        iteration: rewriteIterations.length + 1,
        actionsTaken: rewriteRes.actionsTaken,
        listing: { ...currentListing },
        hitsFound: normalizedHits.length
      });

      saveState('VERIFY');

      params.onEvent?.({
        type: 'TM_REWRITE_RESPONSE',
        title: `SEO-Rewrite Runde ${rewriteIterations.length} abgeschlossen`,
        content: { iteration: rewriteIterations.length, actionsTaken: rewriteRes.actionsTaken, listing: currentListing },
        metadata: { provider: 'OpenRouter', model: rewriteRes._rawRequest?.model, usage: rewriteRes._usage }
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
      finalListing: ListingValidationService.validateAndRepairListing({
        listing: currentListing,
        niche1: normN1,
        niche2: normN2,
        subniche: normSub,
        forbiddenTerms: forbiddenTermsForTask
      }).listing
    };
  }
}

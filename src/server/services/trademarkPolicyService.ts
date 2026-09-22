import { createHash } from 'node:crypto';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { getEnabledMarketplacesForProduct, isProductUploadEnabled } from './productAvailabilityPolicy';

export const US_TM_POLICY_VERSION = 'us-tm-v3' as const;
export const US_TM_PROOF_SCHEMA_VERSION = 3 as const;

export type TrademarkSourceRole =
  | 'BRAND' | 'TITLE_PREFIX' | 'LOCKED_TITLE_TAIL'
  | 'BULLET_1' | 'BULLET_2' | 'DESCRIPTION' | 'PRINTED_QUOTE';
export type RegistryStatusGroup = 'LIVE_REGISTERED' | 'LIVE_PENDING' | 'INACTIVE' | 'UNKNOWN';
export type TrademarkClassStatus = 'CLEAR' | 'FAIR_USE_CLEAR' | 'REWRITE_REQUIRED' | 'BLOCKED' | 'MANUAL_REVIEW' | 'TECHNICAL_UNKNOWN';
export type UsageClassification =
  | 'INCIDENTAL_DICTIONARY_OVERLAP' | 'GENERIC_USE' | 'DESCRIPTIVE_FAIR_USE'
  | 'NOMINATIVE_REFERENCE' | 'SOURCE_IDENTIFYING_USE' | 'ORNAMENTAL_SLOGAN_USE'
  | 'KNOWN_BRAND_OR_IP' | 'AMBIGUOUS';

export interface TrademarkScanIntegrity {
  status: 'COMPLETE' | 'INCOMPLETE' | 'FAILED';
  provider: 'PRODUCTOR_USPTO';
  requestedClasses: number[];
  plannedTerms: number;
  plannedBatches: number;
  successfulBatches: number;
  failedBatches: number;
  attempts: number;
  ignoredPendingCount: number;
  unknownStatusCount: number;
  unknownClassCount: number;
  startedAt: string;
  completedAt?: string;
  errors: Array<{ batchIndex: number; code: string; httpStatus?: number; message: string }>;
}

export interface TrademarkClassVerdict {
  niceClass: number;
  status: TrademarkClassStatus;
  relevantHitIds: string[];
  fairUseHitIds: string[];
  problematicHitIds: string[];
  ambiguousHitIds: string[];
  productIds: string[];
  reasonCode?: string;
}

export interface TrademarkClearanceProofV3 {
  schemaVersion: 3;
  policyVersion: typeof US_TM_POLICY_VERSION;
  marketplace: 'US';
  finalDecision: 'APPROVED' | 'APPROVED_WITH_BLOCKED_PRODUCTS';
  scanIntegrity: TrademarkScanIntegrity;
  model: string;
  promptVersion: string;
  evaluatedAt: string;
  listingFingerprint: string;
  catalogFingerprint: string;
  queriedNiceClasses: number[];
  classVerdicts: Record<string, TrademarkClassVerdict>;
  allowedProductIds: string[];
  blockedProductIds: string[];
  blockedNiceClasses: number[];
  brandStatus: 'CLEAR';
  quoteStatus: TrademarkClassStatus;
  lockedTailStatus: TrademarkClassStatus;
}

export interface TrademarkProductScope {
  products: MerchProduct[];
  productIds: string[];
  niceClasses: number[];
  unconfiguredProductIds: string[];
  catalogFingerprint: string;
}

export interface SemanticDecisionLike {
  hitId?: string;
  usageClassification?: UsageClassification | string;
  confidence?: number;
  action?: string;
  decision?: string;
  field?: string;
  classes?: number[];
}

export class TrademarkPolicyService {
  static hasStrictHitCountProgress(counts: number[]): boolean {
    return counts.length >= 2
      && counts.every(Number.isFinite)
      && counts.slice(1).every((count, index) => count < counts[index]);
  }

  static classifyRegistryStatus(rawStatus?: string | number): RegistryStatusGroup {
    if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === '') return 'UNKNOWN';
    const status = String(rawStatus).trim().toUpperCase();
    if (status.includes('DEAD') || status.includes('CANCEL') || status.includes('ABANDON') || status.includes('EXPIRE') || status.includes('REFUSE') || status.includes('SUSPEND')) return 'INACTIVE';
    if (status.includes('PENDING') || status.includes('APPLICATION') || status.includes('AWAITING') || status === '630' || status === '680') return 'LIVE_PENDING';
    if (status.includes('LIVE') || status.includes('REGISTERED') || status.includes('ACTIVE') || status === 'REG' || status === '700' || status === '701') return 'LIVE_REGISTERED';
    return 'UNKNOWN';
  }

  static normalizePhrase(value?: string): string {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/[‘’´`]/g, "'")
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/^['"“”.,!?;:()[\]{}\s]+|['"“”.,!?;:()[\]{}\s]+$/g, '')
      .replace(/\s*-\s*/g, ' ')
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static listingFingerprint(listing: {
    brand?: unknown;
    title?: unknown;
    bullet1?: unknown;
    bullet2?: unknown;
    description?: unknown;
  }): string {
    const projection = (['brand', 'title', 'bullet1', 'bullet2', 'description'] as const)
      .map(key => [key, String(listing?.[key] || '').trim()]);
    return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  }

  static resolveProductScope(additionalProductIds: string[] = []): TrademarkProductScope {
    const catalog = ProductCatalogService.getCatalog();
    const uploadPolicy = ProductCatalogService.getUploadPolicy();
    const additional = new Set(additionalProductIds.map(raw => {
      const matched = ProductCatalogService.findProductByAmazonKey(String(raw));
      if (matched) return matched.id;
      const normalized = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
      return catalog.products.find(product => product.id.toUpperCase() === normalized)?.id || String(raw);
    }));
    const products = catalog.products
      .filter(product => additional.has(product.id)
        || (isProductUploadEnabled(product) && getEnabledMarketplacesForProduct(product, uploadPolicy).length > 0))
      .sort((a, b) => a.id.localeCompare(b.id));
    const unconfiguredProductIds = products
      .filter(product => product.niceClass === null || product.niceClass === undefined)
      .map(product => product.id);
    const niceClasses = [...new Set(products
      .map(product => product.niceClass)
      .filter((value): value is number => Number.isInteger(value)))]
      .sort((a, b) => a - b);
    const projection = products.map(product => ({
      id: product.id,
      niceClass: product.niceClass ?? null,
      userEnabled: product.userEnabled !== false,
      available: product.available !== false,
      marketplaces: getEnabledMarketplacesForProduct(product, uploadPolicy).sort()
    }));
    return {
      products,
      productIds: products.map(product => product.id),
      niceClasses,
      unconfiguredProductIds,
      catalogFingerprint: createHash('sha256').update(JSON.stringify(projection)).digest('hex')
    };
  }

  static productsForClasses(products: MerchProduct[], classes: number[]): string[] {
    const wanted = new Set(classes);
    return products
      .filter(product => product.niceClass !== null && product.niceClass !== undefined && wanted.has(product.niceClass))
      .map(product => product.id)
      .sort();
  }

  static buildClassVerdicts(params: {
    niceClasses: number[];
    products: MerchProduct[];
    hits: Array<{ id?: string; classes?: number[] }>;
    problematicHits?: Array<{ id?: string; classes?: number[]; registeredMark?: string }>;
    blockedNiceClasses?: number[];
  }): Record<string, TrademarkClassVerdict> {
    const blocked = new Set(params.blockedNiceClasses || []);
    const problematicByClass = new Map<number, string[]>();
    for (const hit of params.problematicHits || []) {
      for (const cls of hit.classes || []) {
        const values = problematicByClass.get(cls) || [];
        values.push(String(hit.id || hit.registeredMark || 'problematic'));
        problematicByClass.set(cls, values);
      }
    }
    const verdicts: Record<string, TrademarkClassVerdict> = {};
    for (const niceClass of params.niceClasses) {
      const relevant = params.hits.filter(hit => hit.classes?.includes(niceClass)).map(hit => String(hit.id || 'hit'));
      const problematic = problematicByClass.get(niceClass) || [];
      const status: TrademarkClassStatus = blocked.has(niceClass)
        ? 'BLOCKED'
        : problematic.length > 0
          ? 'REWRITE_REQUIRED'
          : relevant.length > 0 ? 'FAIR_USE_CLEAR' : 'CLEAR';
      verdicts[String(niceClass)] = {
        niceClass, status, relevantHitIds: [...new Set(relevant)],
        fairUseHitIds: problematic.length === 0 ? [...new Set(relevant)] : [],
        problematicHitIds: [...new Set(problematic)], ambiguousHitIds: [],
        productIds: this.productsForClasses(params.products, [niceClass])
      };
    }
    return verdicts;
  }

  static buildHumanApprovedProof(params: {
    listing: { brand?: unknown; title?: unknown; bullet1?: unknown; bullet2?: unknown; description?: unknown };
    productScope: TrademarkProductScope;
    scanIntegrity: TrademarkScanIntegrity;
    hits: Array<{ id?: string; classes?: number[]; sourceRole?: TrademarkSourceRole }>;
    blockedNiceClasses?: number[];
  }): TrademarkClearanceProofV3 {
    if (params.scanIntegrity.status !== 'COMPLETE' || params.scanIntegrity.failedBatches !== 0) {
      throw new Error('Cannot approve an incomplete USPTO scan');
    }

    const blockedNiceClasses = [...new Set(params.blockedNiceClasses || [])].sort((a, b) => a - b);
    if (blockedNiceClasses.includes(25)) throw new Error('Nice Class 25 cannot be blocked for an approved design');
    const blockedProductIds = [...new Set([
      ...params.productScope.unconfiguredProductIds,
      ...this.productsForClasses(params.productScope.products, blockedNiceClasses)
    ])].sort();
    const blockedSet = new Set(blockedProductIds);
    const classVerdicts = this.buildClassVerdicts({
      niceClasses: params.productScope.niceClasses,
      products: params.productScope.products,
      hits: params.hits,
      blockedNiceClasses
    });
    return {
      schemaVersion: US_TM_PROOF_SCHEMA_VERSION,
      policyVersion: US_TM_POLICY_VERSION,
      marketplace: 'US',
      finalDecision: blockedProductIds.length > 0 ? 'APPROVED_WITH_BLOCKED_PRODUCTS' : 'APPROVED',
      scanIntegrity: params.scanIntegrity,
      model: 'human-review',
      promptVersion: 'human-override/us-tm-v3',
      evaluatedAt: new Date().toISOString(),
      listingFingerprint: this.listingFingerprint(params.listing),
      catalogFingerprint: params.productScope.catalogFingerprint,
      queriedNiceClasses: [...params.productScope.niceClasses],
      classVerdicts,
      allowedProductIds: params.productScope.productIds.filter(id => !blockedSet.has(id)),
      blockedProductIds,
      blockedNiceClasses,
      brandStatus: 'CLEAR',
      quoteStatus: params.hits.some(hit => hit.sourceRole === 'PRINTED_QUOTE') ? 'FAIR_USE_CLEAR' : 'CLEAR',
      lockedTailStatus: params.hits.some(hit => hit.sourceRole === 'LOCKED_TITLE_TAIL') ? 'FAIR_USE_CLEAR' : 'CLEAR'
    };
  }

  static isFairUse(classification?: string): boolean {
    return classification === 'DESCRIPTIVE_FAIR_USE' || classification === 'GENERIC_USE' || classification === 'INCIDENTAL_DICTIONARY_OVERLAP';
  }

  static validateSemanticDecisions(
    decisions: SemanticDecisionLike[],
    knownHitIds: Set<string>,
    brandHitIds: Set<string>,
    requiredHitIds: Set<string> = new Set()
  ): string[] {
    const errors: string[] = [];
    const seenIds = new Set<string>();
    const classifications = new Set<UsageClassification>([
      'INCIDENTAL_DICTIONARY_OVERLAP', 'GENERIC_USE', 'DESCRIPTIVE_FAIR_USE',
      'NOMINATIVE_REFERENCE', 'SOURCE_IDENTIFYING_USE', 'ORNAMENTAL_SLOGAN_USE',
      'KNOWN_BRAND_OR_IP', 'AMBIGUOUS'
    ]);
    const actions = new Set(['KEEP', 'REWRITE', 'BLOCK_CLASS', 'MANUAL_REVIEW', 'ESCALATE']);
    for (const decision of decisions) {
      if (!decision.hitId || !knownHitIds.has(decision.hitId)) errors.push(`Unknown trademark hit id: ${decision.hitId || '<missing>'}`);
      if (decision.hitId) seenIds.add(decision.hitId);
      if (!classifications.has(decision.usageClassification as UsageClassification)) {
        errors.push(`Invalid usage classification for ${decision.hitId || '<missing>'}`);
      }
      const action = decision.action || decision.decision;
      if (!action || !actions.has(action)) errors.push(`Invalid action for ${decision.hitId || '<missing>'}`);
      const confidence = Number(decision.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push(`Invalid confidence for ${decision.hitId || '<missing>'}`);
      if (action === 'KEEP') {
        if (decision.hitId && brandHitIds.has(decision.hitId)
          && decision.usageClassification !== 'INCIDENTAL_DICTIONARY_OVERLAP') {
          errors.push(`Brand hit ${decision.hitId} is not strictly clear`);
        } else if (!this.isFairUse(decision.usageClassification)) {
          errors.push(`KEEP is incompatible with non-fair-use classification for ${decision.hitId || '<missing>'}`);
        }
      }
    }
    for (const id of requiredHitIds) if (!seenIds.has(id)) errors.push(`Missing required semantic decision for ${id}`);
    return errors;
  }

  static validateClearanceProof(params: {
    proof?: TrademarkClearanceProofV3;
    listing: { brand?: unknown; title?: unknown; bullet1?: unknown; bullet2?: unknown; description?: unknown };
    productScope?: TrademarkProductScope;
  }): string[] {
    const proof = params.proof;
    const errors: string[] = [];
    if (!proof) return ['Missing V3 trademark clearance proof'];
    if (proof.schemaVersion !== US_TM_PROOF_SCHEMA_VERSION || proof.policyVersion !== US_TM_POLICY_VERSION) errors.push('Unsupported trademark clearance proof version');
    if (proof.scanIntegrity?.status !== 'COMPLETE' || proof.scanIntegrity.failedBatches !== 0) errors.push('USPTO scan is not complete');
    if (proof.listingFingerprint !== this.listingFingerprint(params.listing)) errors.push('Listing changed after trademark clearance');
    if (proof.brandStatus !== 'CLEAR') errors.push('Brand is not clear');
    const class25 = proof.classVerdicts?.['25'];
    if (!class25 || !['CLEAR', 'FAIR_USE_CLEAR'].includes(class25.status)) errors.push('Nice Class 25 is not cleared');
    const allowed = new Set(proof.allowedProductIds || []);
    const blocked = new Set(proof.blockedProductIds || []);
    if (allowed.size !== (proof.allowedProductIds || []).length) errors.push('Duplicate product in allowed list');
    if (blocked.size !== (proof.blockedProductIds || []).length) errors.push('Duplicate product in blocked list');
    for (const id of allowed) if (blocked.has(id)) errors.push(`Product is both allowed and blocked: ${id}`);
    const blockedClasses = new Set(proof.blockedNiceClasses || []);
    if (blockedClasses.has(25)) errors.push('Nice Class 25 cannot be blocked');
    if (proof.finalDecision === 'APPROVED' && (blocked.size > 0 || blockedClasses.size > 0)) errors.push('Approved proof contains blocked scope');
    if (proof.finalDecision === 'APPROVED_WITH_BLOCKED_PRODUCTS' && blocked.size === 0) errors.push('Blocked-products decision has no blocked products');
    if (params.productScope) {
      if (proof.catalogFingerprint !== params.productScope.catalogFingerprint) errors.push('Product catalog changed after trademark clearance');
      if (JSON.stringify([...(proof.queriedNiceClasses || [])].sort((a, b) => a - b)) !== JSON.stringify(params.productScope.niceClasses)) {
        errors.push('Queried Nice classes do not match the current product scope');
      }
      if (JSON.stringify([...(proof.scanIntegrity?.requestedClasses || [])].sort((a, b) => a - b))
        !== JSON.stringify([...(proof.queriedNiceClasses || [])].sort((a, b) => a - b))) {
        errors.push('USPTO scan classes do not match the clearance proof');
      }
      const expectedBlocked = [...new Set([
        ...params.productScope.unconfiguredProductIds,
        ...this.productsForClasses(params.productScope.products, [...blockedClasses])
      ])].sort();
      const expectedAllowed = params.productScope.productIds.filter(id => !expectedBlocked.includes(id)).sort();
      if (JSON.stringify([...blocked].sort()) !== JSON.stringify(expectedBlocked)) {
        errors.push('Blocked product set does not match the current class decisions');
      }
      if (JSON.stringify([...allowed].sort()) !== JSON.stringify(expectedAllowed)) {
        errors.push('Allowed product set does not match the current class decisions');
      }
      for (const id of params.productScope.productIds) {
        if (!allowed.has(id) && !blocked.has(id)) errors.push(`Product has no trademark decision: ${id}`);
      }
      for (const id of params.productScope.unconfiguredProductIds) {
        if (!blocked.has(id)) errors.push(`Product without Nice class is not blocked: ${id}`);
      }
      for (const id of [...allowed, ...blocked]) {
        if (!params.productScope.productIds.includes(id)) errors.push(`Unknown product in trademark proof: ${id}`);
      }
      for (const niceClass of params.productScope.niceClasses) {
        const verdict = proof.classVerdicts?.[String(niceClass)];
        if (!verdict) {
          errors.push(`Missing Nice class verdict: ${niceClass}`);
          continue;
        }
        const expectedProducts = this.productsForClasses(params.productScope.products, [niceClass]);
        if (JSON.stringify([...(verdict.productIds || [])].sort()) !== JSON.stringify(expectedProducts)) {
          errors.push(`Product mapping changed for Nice class ${niceClass}`);
        }
        if (blockedClasses.has(niceClass) !== (verdict.status === 'BLOCKED')) {
          errors.push(`Blocked status mismatch for Nice class ${niceClass}`);
        }
        if (!['CLEAR', 'FAIR_USE_CLEAR', 'BLOCKED'].includes(verdict.status)) {
          errors.push(`Nice class ${niceClass} is not in a publishable final state`);
        }
        const relevantIds = [...new Set(verdict.relevantHitIds || [])].sort();
        const fairUseIds = [...new Set(verdict.fairUseHitIds || [])].sort();
        if (verdict.status === 'CLEAR' && relevantIds.length > 0) {
          errors.push(`Clear Nice class ${niceClass} still contains registry hits`);
        }
        if (verdict.status === 'FAIR_USE_CLEAR'
          && (relevantIds.length === 0 || JSON.stringify(relevantIds) !== JSON.stringify(fairUseIds)
            || (verdict.problematicHitIds || []).length > 0 || (verdict.ambiguousHitIds || []).length > 0)) {
          errors.push(`Fair-use Nice class ${niceClass} is not fully classified as fair use`);
        }
        for (const productId of expectedProducts) {
          if (verdict.status === 'BLOCKED' && !blocked.has(productId)) errors.push(`Blocked class product is not blocked: ${productId}`);
          if (verdict.status !== 'BLOCKED' && !allowed.has(productId)) errors.push(`Cleared class product is not allowed: ${productId}`);
        }
      }
    }
    return [...new Set(errors)];
  }
}

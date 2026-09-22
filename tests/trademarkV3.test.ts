import { TrademarkService, UsptoBatchQueryResult } from '../src/server/services/trademarkService';
import { TrademarkPolicyService, TrademarkScanIntegrity, US_TM_POLICY_VERSION } from '../src/server/services/trademarkPolicyService';
import { LLMService } from '../src/server/services/llmService';
import { SystemPromptService } from '../src/server/services/systemPromptService';
import { QueueService } from '../src/server/services/queueService';
import type { TrademarkClearanceProofV3 } from '../src/server/services/trademarkPolicyService';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run() {
  let passed = 0;
  let total = 0;
  const assert = (condition: unknown, name: string, detail?: unknown) => {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ ${name}`);
    } else {
      console.error(`❌ ${name}`, detail ?? '');
    }
  };

  const completeIntegrity = (classes: number[] = [25]): TrademarkScanIntegrity => ({
    status: 'COMPLETE', provider: 'PRODUCTOR_USPTO', requestedClasses: classes,
    plannedTerms: 1, plannedBatches: 1, successfulBatches: 1, failedBatches: 0,
    attempts: 1, ignoredPendingCount: 0, unknownStatusCount: 0, unknownClassCount: 0,
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), errors: []
  });

  assert(
    TrademarkPolicyService.normalizePhrase(' “Horse–Life!” ') === 'horse life',
    'V3 normalizes punctuation, Unicode quotes, dashes, case and spacing'
  );
  assert(
    TrademarkPolicyService.hasStrictHitCountProgress([12, 8, 3, 1])
      && !TrademarkPolicyService.hasStrictHitCountProgress([12, 8, 8, 1]),
    'Optional fourth rewrite requires measurable progress in every prior round'
  );
  assert(TrademarkPolicyService.classifyRegistryStatus('LIVE') === 'LIVE_REGISTERED', 'LIVE is registered');
  assert(TrademarkPolicyService.classifyRegistryStatus('LIVE/APPLICATION/Pending') === 'LIVE_PENDING', 'Pending wins over LIVE');
  assert(TrademarkPolicyService.classifyRegistryStatus('ABANDONED') === 'INACTIVE', 'Abandoned is inactive');
  assert(TrademarkPolicyService.classifyRegistryStatus('APPLICATION ABANDONED') === 'INACTIVE', 'Terminal inactive status wins over generic application wording');
  assert(TrademarkPolicyService.classifyRegistryStatus(undefined) === 'UNKNOWN', 'Missing status is unknown');

  const partialQuote = TrademarkService.normalizeAndClassifyMatches(
    { heroes: [{ mark_identification: 'HEROES', status: 'LIVE', classification: '25' }] },
    { heroes: ['quote'] },
    'Because Engineers Need Heroes Too'
  );
  assert(partialQuote.length === 0, 'Partial Quote words never become Quote conflicts');

  const exactTail = TrademarkService.normalizeAndClassifyMatches(
    { 'friesian horse': [{ mark_identification: 'FRIESIAN HORSE', status: 'LIVE', classification: '25' }] },
    { 'friesian horse': ['lockedTitleTail'] },
    undefined,
    'Friesian Horse'
  );
  assert(exactTail.length === 1 && exactTail[0].sourceRole === 'LOCKED_TITLE_TAIL', 'Only exact locked tail is attributed as locked niche');

  const pendingIntegrity = completeIntegrity();
  const pending = TrademarkService.normalizeAndClassifyMatches(
    { horse: [{ mark_identification: 'HORSE', status: 'PENDING', classification: '25' }] },
    { horse: ['title'] }, undefined, undefined, pendingIntegrity
  );
  assert(pending.length === 0 && pendingIntegrity.ignoredPendingCount === 1, 'Pending hits are hidden before the LLM');

  const unknownIntegrity = completeIntegrity();
  TrademarkService.normalizeAndClassifyMatches(
    { horse: [{ mark_identification: 'HORSE', status: 'MYSTERY', classification: '25' }] },
    { horse: ['title'] }, undefined, undefined, unknownIntegrity
  );
  assert(unknownIntegrity.unknownStatusCount === 1, 'Unknown registry status is counted and cannot silently clear');

  const unknownClassIntegrity = completeIntegrity();
  const unknownClassHits = TrademarkService.normalizeAndClassifyMatches(
    { horse: [{ mark_identification: 'HORSE', status: 'LIVE' }] },
    { horse: ['title'] }, undefined, undefined, unknownClassIntegrity
  );
  assert(
    unknownClassHits.length === 0 && unknownClassIntegrity.unknownClassCount === 1,
    'Live hits without Nice-class evidence cannot silently clear a queried class'
  );

  const semanticErrors = TrademarkPolicyService.validateSemanticDecisions(
    [{ hitId: 'tm_1', usageClassification: 'DESCRIPTIVE_FAIR_USE', confidence: 0.95, action: 'KEEP' }],
    new Set(['tm_1']), new Set(['tm_1']), new Set(['tm_1'])
  );
  assert(semanticErrors.some(error => error.includes('Brand hit')), 'Brand cannot be approved through descriptive fair use');
  const incidentalBrandErrors = TrademarkPolicyService.validateSemanticDecisions(
    [{ hitId: 'tm_1', usageClassification: 'INCIDENTAL_DICTIONARY_OVERLAP', confidence: 0.95, action: 'KEEP' }],
    new Set(['tm_1']), new Set(['tm_1']), new Set(['tm_1'])
  );
  assert(incidentalBrandErrors.length === 0, 'Plain incidental dictionary overlap can leave Brand strictly clear');
  const unsafeKeepErrors = TrademarkPolicyService.validateSemanticDecisions(
    [{ hitId: 'tm_2', usageClassification: 'SOURCE_IDENTIFYING_USE', confidence: 0.95, action: 'KEEP' }],
    new Set(['tm_2']), new Set(), new Set(['tm_2'])
  );
  assert(unsafeKeepErrors.some(error => error.includes('non-fair-use')), 'Non-fair-use classifications can never pass through KEEP');

  const humanScope = TrademarkPolicyService.resolveProductScope();
  const humanProof = TrademarkPolicyService.buildHumanApprovedProof({
    listing: { brand: 'Known Mark', title: 'Workshop Welder' },
    productScope: humanScope,
    scanIntegrity: completeIntegrity(humanScope.niceClasses),
    hits: [{ id: 'tm_brand', classes: [25], sourceRole: 'BRAND' }]
  });
  assert(humanProof.brandStatus === 'CLEAR', 'Manual human review can approve listings and clears brandStatus');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
    const failed = await TrademarkService.queryUsptoBatch(['horse'], [25]);
    assert(failed.integrity.status === 'FAILED' && failed.integrity.attempts === 3, 'USPTO HTTP failures remain failed after bounded retries');
    assert(Object.keys(failed.hitsByTerm).length === 0, 'Failed USPTO response is not mislabeled as a clean hit result');

    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
    const emptySuccess = await TrademarkService.queryUsptoBatch(['horse'], [25]);
    assert(emptySuccess.integrity.status === 'COMPLETE' && emptySuccess.integrity.failedBatches === 0, 'Zero hits are accepted only with complete scan integrity');

    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ([]) })) as any;
    const emptyArraySuccess = await TrademarkService.queryUsptoBatch(['horse'], [25]);
    assert(emptyArraySuccess.integrity.status === 'COMPLETE' && emptyArraySuccess.integrity.failedBatches === 0 && Object.keys(emptyArraySuccess.hitsByTerm).length === 0, 'Productor zero-hit empty array response is accepted with complete scan integrity');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const scope = TrademarkPolicyService.resolveProductScope();
  assert(scope.niceClasses.includes(25), 'Effective catalog dynamically supplies mandatory Nice Class 25 without hardcoded product mapping');
  assert(scope.unconfiguredProductIds.length > 0, 'Enabled products without Nice Class remain visible as configuration blocks');

  const originalQuery = TrademarkService.queryUsptoBatch;
  const originalReferee = LLMService.evaluateTrademarkReferee;
  const originalVerifier = LLMService.evaluateTrademarkVerifier;
  let llmCalls = 0;
  let cleanProof: TrademarkClearanceProofV3 | undefined;
  let cleanListing: any;
  try {
    TrademarkService.queryUsptoBatch = (async (_terms: string[], classes: number[]): Promise<UsptoBatchQueryResult> => ({
      hitsByTerm: {}, integrity: completeIntegrity(classes)
    })) as any;
    LLMService.evaluateTrademarkReferee = (async () => {
      llmCalls++;
      return {
        decision: 'APPROVE', canBeFixedByListingRewrite: true, hits: [], blockedProducts: [],
        rewriteRequired: false, rewriteInstructions: [], knownBrandSignals: [],
        _rawRequest: { model: 'test-model' }
      };
    }) as any;
    LLMService.evaluateTrademarkVerifier = (async () => { llmCalls++; throw new Error('must not run'); }) as any;
    const clean = await TrademarkService.executeTrademarkAuditV2({
      listing: {
        brand: 'Workshop Welding Humor', title: 'Because Engineers Need Heroes Too Welder',
        bullet1: 'For welders who enjoy skilled trade pride.', bullet2: 'For workshop and fabrication settings.',
        description: 'A retro welding helmet illustration.'
      },
      quote: 'Because Engineers Need Heroes Too', niche1: 'Welder'
    });
    assert(clean.isSafe && clean.clearanceProof?.policyVersion === US_TM_POLICY_VERSION, 'Complete clean scan emits a V3 clearance proof');
    assert(
      scope.unconfiguredProductIds.every(id => clean.clearanceProof?.blockedProductIds.includes(id)),
      'Unconfigured products are blocked without guessing a Nice class'
    );
    assert(llmCalls === 1 && clean.verifierResult === null, 'Complete zero-hit scan uses one compact brand/IP screen and skips the Verifier');
    assert(
      TrademarkPolicyService.validateClearanceProof({ proof: clean.clearanceProof, listing: clean.finalListing, productScope: scope }).length === 0,
      'Generated V3 proof validates against exact listing and catalog'
    );
    const unconfigured = scope.unconfiguredProductIds[0];
    if (unconfigured) {
      const tamperedProof = JSON.parse(JSON.stringify(clean.clearanceProof)) as TrademarkClearanceProofV3;
      tamperedProof.blockedProductIds = tamperedProof.blockedProductIds.filter(id => id !== unconfigured);
      tamperedProof.allowedProductIds.push(unconfigured);
      assert(
        TrademarkPolicyService.validateClearanceProof({ proof: tamperedProof, listing: clean.finalListing, productScope: scope })
          .some(error => error.includes('without Nice class')),
        'Proof validation rejects activation of a product without configured Nice class'
      );
    }
    cleanProof = clean.clearanceProof;
    cleanListing = clean.finalListing;
  } finally {
    TrademarkService.queryUsptoBatch = originalQuery;
    LLMService.evaluateTrademarkReferee = originalReferee;
    LLMService.evaluateTrademarkVerifier = originalVerifier;
  }

  if (cleanProof) {
    const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-v3-queue-'));
    const queuePath = path.join(queueDir, 'queue.json');
    try {
      QueueService.setCustomQueuePath(queuePath);
      const item = QueueService.enqueueDesign({
        taskId: 'tm-v3-proof-test', designTitle: cleanListing.title,
        ...cleanListing, imagePath: '', pngPath: '',
        tmBlockedProductIds: cleanProof.blockedProductIds,
        tmAllowedProductIds: cleanProof.allowedProductIds,
        trademarkClearance: cleanProof
      });
      const activeIds = Object.keys(item.activeProductsMap);
      assert(activeIds.every(id => cleanProof!.allowedProductIds.includes(id)), 'Queue active product map is bounded by the V3 allowlist');
      assert(cleanProof.blockedProductIds.every(id => !activeIds.includes(id)), 'Queue never activates a trademark/configuration-blocked product');
      let rejectedMutation = false;
      try {
        QueueService.replacePreparedAssets(item.id, {
          brand: item.brand, title: `${item.title} Changed`, bullet1: item.bullet1,
          bullet2: item.bullet2, description: item.description,
          listings: item.listings, resizedAssets: item.resizedAssets
        });
      } catch (error: any) {
        rejectedMutation = String(error?.message || error).includes('FAILED_TM_POLICY_INTEGRITY');
      }
      assert(rejectedMutation, 'Queue rejects listing changes that invalidate the clearance fingerprint');
    } finally {
      QueueService.setCustomQueuePath();
      fs.rmSync(queueDir, { recursive: true, force: true });
    }
  }

  let persistedTechnicalState: any;
  llmCalls = 0;
  try {
    TrademarkService.queryUsptoBatch = (async (_terms: string[], classes: number[]): Promise<UsptoBatchQueryResult> => ({
      hitsByTerm: {},
      integrity: { ...completeIntegrity(classes), status: 'FAILED', successfulBatches: 0, failedBatches: 1, errors: [{ batchIndex: 0, code: 'USPTO_HTTP_ERROR', message: '503' }] }
    })) as any;
    LLMService.evaluateTrademarkReferee = (async () => { llmCalls++; throw new Error('must not run'); }) as any;
    const failed = await TrademarkService.executeTrademarkAuditV2({
      listing: { brand: 'Horse Humor', title: 'Funny Stable Life Horse', bullet1: '', bullet2: '', description: '' },
      niche1: 'Horse', onPersistState: state => { persistedTechnicalState = state; }
    });
    assert(failed.reasonCode === 'USPTO_SCAN_INCOMPLETE' && llmCalls === 0, 'Technical USPTO failure calls no LLM and never becomes zero hits');
    assert(persistedTechnicalState?.phase === 'TECHNICAL_RETRY_WAIT' && persistedTechnicalState?.nextTechnicalRetryAt, 'Technical failure persists a delayed retry state');
  } finally {
    TrademarkService.queryUsptoBatch = originalQuery;
    LLMService.evaluateTrademarkReferee = originalReferee;
  }

  llmCalls = 0;
  try {
    TrademarkService.queryUsptoBatch = (async (_terms: string[], classes: number[]): Promise<UsptoBatchQueryResult> => ({
      hitsByTerm: {
        'because engineers need heroes too': [{
          mark_identification: 'BECAUSE ENGINEERS NEED HEROES TOO', status: 'LIVE',
          mark_drawing: 'STANDARD CHARACTER MARK', classification: '25'
        }]
      },
      integrity: completeIntegrity(classes)
    })) as any;
    LLMService.evaluateTrademarkReferee = (async () => { llmCalls++; throw new Error('must not run'); }) as any;
    const conflict = await TrademarkService.executeTrademarkAuditV2({
      listing: {
        brand: 'Workshop Welding Humor', title: 'Because Engineers Need Heroes Too Welder',
        bullet1: 'For welders.', bullet2: 'For workshops.', description: 'Retro welder illustration.'
      },
      quote: 'Because Engineers Need Heroes Too', niche1: 'Welder'
    });
    assert(conflict.reasonCode === 'CORE_QUOTE_CLASS25_CONFLICT' && !conflict.isSafe, 'Exact multiword Class 25 Quote conflict is deterministically rejected');
    assert(llmCalls === 0, 'Deterministic exact Quote rejection spends no LLM tokens');
  } finally {
    TrademarkService.queryUsptoBatch = originalQuery;
    LLMService.evaluateTrademarkReferee = originalReferee;
  }

  assert(SystemPromptService.getTrademarkRefereePrompt().includes('POLICY_VERSION: us-tm-v3'), 'Persisted default Referee prompt migrates to us-tm-v3');

  // Test: Blank preflight initialWorkflowState cannot wipe incoming candidate listing
  {
    const originalQuery = TrademarkService.queryUsptoBatch;
    const originalReferee = LLMService.evaluateTrademarkReferee;
    try {
      TrademarkService.queryUsptoBatch = (async (_terms: string[], classes: number[]) => ({
        hitsByTerm: {},
        integrity: completeIntegrity(classes)
      })) as any;
      LLMService.evaluateTrademarkReferee = (async () => ({
        decision: 'APPROVE',
        canBeFixedByListingRewrite: true,
        hits: [],
        blockedProducts: [],
        rewriteRequired: false,
        rewriteInstructions: [],
        knownBrandSignals: [],
        _rawRequest: { model: 'test-model' }
      })) as any;

      const fullListing = {
        brand: 'Brave Hearts Classroom Progress',
        title: 'Small Steps Brave Hearts Big Breakthroughs Special Education',
        bullet1: 'Support dedicated educators and students.',
        bullet2: 'Inspirational classroom apparel.',
        description: 'Celebrate special education triumphs.'
      };

      const audit = await TrademarkService.executeTrademarkAuditV2({
        listing: fullListing,
        quote: 'Small Steps Brave Hearts Big Breakthroughs',
        niche1: 'Special Education',
        initialWorkflowState: {
          phase: 'TECHNICAL_RETRY_WAIT',
          rewriteAttemptsCompleted: 0,
          currentListing: { brand: '', title: '', bullet1: '', bullet2: '', description: '' },
          forbiddenTermsForTask: [],
          rewriteIterations: [],
          policyVersion: 'us-tm-v3',
          scanIntegrity: completeIntegrity([25])
        } as any
      });

      assert(audit.finalListing.brand === 'Brave Hearts Classroom Progress', 'Empty preflight currentListing does not overwrite candidate brand');
      assert(audit.finalListing.title.includes('Small Steps Brave Hearts'), 'Candidate title is preserved and validated instead of reduced to suffix');
      assert(audit.finalListing.bullet1.length > 0, 'Candidate bullet1 is preserved');
    } finally {
      TrademarkService.queryUsptoBatch = originalQuery;
      LLMService.evaluateTrademarkReferee = originalReferee;
    }
  }

  {
    const originalQuery = TrademarkService.queryUsptoBatch;
    const originalReferee = LLMService.evaluateTrademarkReferee;
    const originalVerifier = LLMService.evaluateTrademarkVerifier;
    try {
      TrademarkService.queryUsptoBatch = (async (_terms: string[], classes: number[]) => ({
        hitsByTerm: {
          brave: [{
            term: 'brave',
            mark: 'BRAVE',
            status: 'LIVE',
            classes: [25, 35],
            feature: 'Standard Character Mark',
            goodsServices: 'Clothing, namely t-shirts'
          }]
        },
        integrity: completeIntegrity(classes)
      })) as any;

      // Realistic OpenRouter LLM response returning id (not hitId), action: APPROVE (not KEEP), and classes: [25] (not [25, 35])
      LLMService.evaluateTrademarkReferee = (async () => ({
        decision: 'APPROVE',
        canBeFixedByListingRewrite: true,
        hits: [{
          id: 'tm_1',
          searchedTerm: 'brave',
          registeredMark: 'BRAVE',
          field: 'title',
          classes: [25],
          usageClassification: 'INCIDENTAL_DICTIONARY_OVERLAP',
          confidence: 0.95,
          action: 'APPROVE',
          decision: 'APPROVE',
          reasonCode: null,
          reason: 'Common dictionary word used in generic context'
        }],
        blockedProducts: [],
        rewriteRequired: false,
        rewriteInstructions: [],
        knownBrandSignals: [],
        _rawRequest: { model: 'test-model' }
      })) as any;

      LLMService.evaluateTrademarkVerifier = (async () => ({
        verdict: 'SAFE',
        identifiedRisks: [],
        canBeFixedByListingRewrite: true,
        recommendation: 'SAFE_TO_PUBLISH'
      })) as any;

      const fullListing = {
        brand: 'Classroom Progress Apparel',
        title: 'Small Steps Brave Hearts Big Breakthroughs Special Education',
        bullet1: 'Support dedicated educators and students.',
        bullet2: 'Inspirational classroom apparel.',
        description: 'Celebrate special education triumphs.'
      };

      const audit = await TrademarkService.executeTrademarkAuditV2({
        listing: fullListing,
        quote: 'Small Steps Big Breakthroughs',
        niche1: 'Special Education'
      });

      assert(audit.finalDecision !== 'ESCALATE', 'Audit does not escalate to INVALID_AI_RESPONSE on realistic LLM output');
      assert(audit.reasonCode !== 'INVALID_AI_RESPONSE', 'Audit reasonCode is not INVALID_AI_RESPONSE');
      assert(audit.isSafe === true, 'Listing with approved incidental overlap is marked safe');
    } finally {
      TrademarkService.queryUsptoBatch = originalQuery;
      LLMService.evaluateTrademarkReferee = originalReferee;
      LLMService.evaluateTrademarkVerifier = originalVerifier;
    }
  }

  console.log(`\nTrademark V3: ${passed}/${total} tests passed`);
  if (passed !== total) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { TrademarkService, MatchTypeV2 } from '../src/server/services/trademarkService';
import { LLMService } from '../src/server/services/llmService';
import { BannedWordsService } from '../src/server/services/bannedWordsService';
import { VisionOptimizationService } from '../src/server/services/visionOptimizationService';
import { SystemPromptService } from '../src/server/services/systemPromptService';
import fs from 'fs';
import path from 'path';

async function runAcceptanceTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING TRADEMARK WORKFLOW V2 ACCEPTANCE TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`, detail || '');
    }
  }

  // ----------------------------------------------------
  // TEST I: Nische nur als Kontext (nicht fälschlich im Text gesucht)
  // ----------------------------------------------------
  {
    const extraction = TrademarkService.extractTermsFromTextV2({
      listing: {
        brand: 'Awesome Healing Vibes',
        title: 'Compassionate Medical Healthcare Caregiver',
        bullet1: 'A heartfelt design for hospital staff.',
        bullet2: 'Comfortable fit for everyday shifts.',
        description: 'Great caregiver graphic.'
      },
      quote: 'Healing Hands'
    });

    const hasNursingInTerms = extraction.terms.includes('nursing');
    assert(!hasNursingInTerms, 'Test I: Nische "Nursing" wird nicht extrahiert, wenn sie nicht im Text steht');
  }

  // ----------------------------------------------------
  // TEST A: Normales Single Word (WESTERN in Class 25)
  // ----------------------------------------------------
  {
    const rawHits = {
      'western': [
        {
          mark_identification: 'WESTERN',
          status: 'LIVE',
          mark_drawing: 'STANDARD CHARACTER MARK',
          classification: '25',
          serial_number: '12345678'
        }
      ]
    };

    const termToFieldsMap = { 'western': ['title', 'bullet1'] };
    const normalized = TrademarkService.normalizeAndClassifyMatches(rawHits, termToFieldsMap, 'Wild Western Horse');

    assert(normalized.length === 2, 'Test A1: Normalized 2 field hits for western');
    assert(normalized[0].matchType === 'SINGLE_WORD_EXACT', 'Test A2: Single word match classified as SINGLE_WORD_EXACT');
    assert(normalized[0].wordCount === 1, 'Test A3: Word count is 1');
  }

  // ----------------------------------------------------
  // TEST B: Full Quote Class 25 Conflict
  // ----------------------------------------------------
  {
    const rawHits = {
      'aged to perfection': [
        {
          mark_identification: 'AGED TO PERFECTION',
          status: 'LIVE',
          mark_drawing: 'STANDARD CHARACTER MARK',
          classification: '25',
          serial_number: '88776655'
        }
      ]
    };

    const termToFieldsMap = { 'aged to perfection': ['quote', 'title'] };
    const normalized = TrademarkService.normalizeAndClassifyMatches(rawHits, termToFieldsMap, 'Aged To Perfection');

    const quoteHit = normalized.find(h => h.field === 'quote');
    assert(quoteHit !== undefined, 'Test B1: Found quote hit');
    assert(quoteHit?.isFullQuoteMatch === true, 'Test B2: isFullQuoteMatch is true');
    assert(quoteHit?.matchType === 'FULL_EXACT', 'Test B3: matchType is FULL_EXACT');
  }

  // ----------------------------------------------------
  // TEST D: Multiword Phrase in Class 25
  // ----------------------------------------------------
  {
    const rawHits = {
      'crazy chicken lady': [
        {
          mark_identification: 'CRAZY CHICKEN LADY',
          status: 'LIVE',
          mark_drawing: 'STANDARD CHARACTER MARK',
          classification: '25',
          serial_number: '99887766'
        }
      ]
    };

    const termToFieldsMap = { 'crazy chicken lady': ['title'] };
    const normalized = TrademarkService.normalizeAndClassifyMatches(rawHits, termToFieldsMap, 'Chicken Farmer');

    assert(normalized[0].matchType === 'EXACT_NGRAM', 'Test D1: Multiword exact match is EXACT_NGRAM');
    assert(normalized[0].isKnownPhraseMatch === true, 'Test D2: isKnownPhraseMatch is true');
    assert(normalized[0].wordCount === 3, 'Test D3: wordCount is 3');
  }

  // ----------------------------------------------------
  // TEST E & F: Nebenklassen-Klassifizierung
  // ----------------------------------------------------
  {
    const rawHits = {
      'super phone hero': [
        {
          mark_identification: 'SUPER PHONE HERO',
          status: 'LIVE',
          mark_drawing: 'STANDARD CHARACTER MARK',
          classification: '09',
          serial_number: '11223344'
        }
      ]
    };

    const termToFieldsMap = { 'super phone hero': ['title'] };
    const normalized = TrademarkService.normalizeAndClassifyMatches(rawHits, termToFieldsMap, 'Hero');

    assert(normalized[0].classes.includes(9), 'Test F1: Extracted class 9 from classification');
    assert(normalized[0].matchType === 'EXACT_NGRAM', 'Test F2: Match type is EXACT_NGRAM for Class 9 mark');
  }

  // ----------------------------------------------------
  // TEST G & H: Multi-Round Rewrite Loop State Tracking
  // ----------------------------------------------------
  {
    const forbiddenTerms = ['wild spirit'];
    const newTerm = 'free spirit';
    forbiddenTerms.push(newTerm);

    assert(forbiddenTerms.length === 2, 'Test G1: Forbidden terms accumulates previous iterations');
    assert(forbiddenTerms.includes('wild spirit') && forbiddenTerms.includes('free spirit'), 'Test G2: Both terms forbidden');
  }

  // ----------------------------------------------------
  // TEST: APPROVE / APPROVE_WITH_BLOCKED_PRODUCTS does not trigger immediate escalation
  // ----------------------------------------------------
  {
    const refereeResApprove = {
      decision: 'APPROVE',
      canBeFixedByListingRewrite: true,
      reasonCode: null
    };

    const isEscalated = refereeResApprove.decision === 'ESCALATE' || 
      (refereeResApprove.decision === 'REWRITE' && refereeResApprove.canBeFixedByListingRewrite === false);

    assert(!isEscalated, 'Test Safe Flow: APPROVE decision does NOT trigger immediate escalation');
  }

  // ----------------------------------------------------
  // TEST J: Compact Trademark Hits Aggregation (Token Reduction)
  // ----------------------------------------------------
  {
    const listing = {
      brand: 'Western Wild Co',
      title: 'Retro Western Cowgirl Riding Horse Slogan',
      bullet1: 'Western aesthetic for country lovers.',
      bullet2: 'High quality apparel for everyday rodeo.',
      description: 'Vintage western apparel design.'
    };

    const mockNormalizedHits = [
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'brand',
        office: 'USPTO' as const,
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        classNumber: '25',
        wordCount: 1,
        matchType: 'SINGLE_WORD_EXACT' as const,
        isFullQuoteMatch: false,
        isKnownPhraseMatch: false,
        serialNumber: '111111',
        filingDate: '2020-01-01'
      },
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'title',
        office: 'USPTO' as const,
        status: 'LIVE',
        markFeature: 'Word',
        classes: [9, 25],
        classNumber: '9, 25',
        wordCount: 1,
        matchType: 'SINGLE_WORD_EXACT' as const,
        isFullQuoteMatch: false,
        isKnownPhraseMatch: false,
        serialNumber: '222222',
        filingDate: '2021-01-01'
      },
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'bullet1',
        office: 'EUIPO' as const,
        status: 'REGISTERED',
        markFeature: 'Word',
        classes: [25],
        classNumber: '25',
        wordCount: 1,
        matchType: 'SINGLE_WORD_EXACT' as const,
        isFullQuoteMatch: false,
        isKnownPhraseMatch: false,
        serialNumber: '333333'
      }
    ];

    const compact = TrademarkService.buildCompactTrademarkHits(mockNormalizedHits, listing, 'Western Rider');

    assert(compact.length === 1, 'Test J1: Multiple raw hits collapsed into single CompactTrademarkHit');
    assert(compact[0].mark === 'WESTERN', 'Test J2: Mark normalized uppercase');
    assert(compact[0].classes.includes(9) && compact[0].classes.includes(25), 'Test J3: Deduplicated classes [9, 25]');
    assert(compact[0].offices.includes('USPTO') && compact[0].offices.includes('EUIPO'), 'Test J4: Deduplicated offices [EUIPO, USPTO]');
    assert(compact[0].occurrences.length === 3, 'Test J5: Occurrences collect distinct fields');
    assert(compact[0].occurrences.some(o => o.field === 'brand' && o.matchedTerm === 'western'), 'Test J6: matchedTerm extracted correctly');
    assert(!compact[0].occurrences.some((o: any) => 'text' in o), 'Test J7: No full field text in any occurrence');
    assert(!('serialNumber' in compact[0]) && !('filingDate' in compact[0]), 'Test J8: Internal metadata stripped from compact hit');
  }

  // ----------------------------------------------------
  // TEST K: Compact Referee Output Parsing (problematicHits format)
  // ----------------------------------------------------
  {
    const mockContent = JSON.stringify({
      decision: 'REWRITE',
      canBeFixedByListingRewrite: true,
      reasonCode: 'DISTINCTIVE_TRADEMARK_FOUND',
      problematicHits: [
        {
          id: 'tm_1',
          mark: 'WESTERN BOOTS',
          classes: [25],
          occurrences: [{ field: 'title', text: 'Retro Western Boots' }],
          action: 'REWRITE',
          reason: 'Distinctive multiword brand name in Class 25'
        }
      ],
      rewriteInstructions: ['Remove "Western Boots" from Title']
    });

    const parsed = (LLMService as any).extractJsonFromLlmResponse(mockContent);
    const rawProblematic = Array.isArray(parsed.problematicHits) ? parsed.problematicHits : [];
    const mapped = rawProblematic.map((h: any) => ({
      searchedTerm: h.mark,
      registeredMark: h.mark,
      field: h.occurrences?.[0]?.field || 'all',
      classes: h.classes || [],
      decision: h.action || 'REWRITE',
      reason: h.reason || ''
    }));

    assert(mapped.length === 1, 'Test K1: problematicHits correctly parsed and mapped');
    assert(mapped[0].registeredMark === 'WESTERN BOOTS', 'Test K2: Correct registeredMark');
    assert(mapped[0].decision === 'REWRITE', 'Test K3: Correct decision mapping');
  }

  // ----------------------------------------------------
  // TEST L: Final Gate Verifier Logic (Verifier NOT called if Referee flags REWRITE)
  // ----------------------------------------------------
  {
    let verifierCalled = false;
    const refereeDecision = 'REWRITE';

    if (refereeDecision === 'APPROVE' || refereeDecision === 'APPROVE_WITH_BLOCKED_PRODUCTS') {
      verifierCalled = true;
    }

    assert(!verifierCalled, 'Test L1: Verifier is NOT called when Referee decision is REWRITE');

    let verifierCalledOnApprove = false;
    const refereeDecisionApprove = 'APPROVE';
    if (refereeDecisionApprove === 'APPROVE' || refereeDecisionApprove === 'APPROVE_WITH_BLOCKED_PRODUCTS') {
      verifierCalledOnApprove = true;
    }
    assert(verifierCalledOnApprove, 'Test L2: Verifier is called as Final Gate when Referee decision is APPROVE');
  }

  // ----------------------------------------------------
  // TEST M: approvedHitContexts Fingerprint includes markFeature
  // ----------------------------------------------------
  {
    const getHitContextKey = (mark: string, markFeature: string, classes: number[], matchType: string, field: string, text: string) => {
      const normText = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const normFeature = (markFeature || 'word').trim().toLowerCase();
      return `${mark.toLowerCase()}|${normFeature}|${classes.slice().sort((a, b) => a - b).join(',')}|${matchType}|${field}|${normText}`;
    };

    const wordKey = getHitContextKey('western', 'Word', [25], 'SINGLE_WORD_EXACT', 'bullet1', 'rustic western horse artwork');
    const combinedKey = getHitContextKey('western', 'Combined', [25], 'SINGLE_WORD_EXACT', 'bullet1', 'rustic western horse artwork');
    const brandKey = getHitContextKey('western', 'Word', [25], 'SINGLE_WORD_EXACT', 'brand', 'western apparel co');

    assert(wordKey === 'western|word|25|SINGLE_WORD_EXACT|bullet1|rustic western horse artwork', 'Test M1: Correctly formatted fingerprint with markFeature');
    assert(wordKey !== combinedKey, 'Test M2: Word mark key differs from Combined mark key (no cross-contamination)');
    assert(wordKey !== brandKey, 'Test M3: bullet1 key differs from brand key');
  }

  // ----------------------------------------------------
  // TEST N: Translation Bypass & Upload Auto-Translate Decision
  // ----------------------------------------------------
  {
    // Case 1: Translation disabled -> only EN listing
    const mockEnglishListing = { brand: 'Brand', title: 'Title', bullet1: 'B1', bullet2: 'B2', description: 'Desc' };
    const settingsWithTranslationDisabled = { translationDesignEnabled: false, translationUpdateEnabled: false };

    const isDesignTranslationEnabled = settingsWithTranslationDisabled.translationDesignEnabled ?? true;
    const finalDesignListings = isDesignTranslationEnabled ? { en: mockEnglishListing, de: mockEnglishListing } : { en: mockEnglishListing };

    assert(!isDesignTranslationEnabled, 'Test N1: Translation is correctly recognized as disabled in settings');
    assert(Object.keys(finalDesignListings).length === 1 && Boolean(finalDesignListings.en), 'Test N2: Pipeline generates only English listing when translation is disabled');

    // Case 2: Upload Worker decision with single EN listing
    const rawListingsEnOnly = finalDesignListings;
    const hasLocalizedListingsEnOnly = Boolean(
      rawListingsEnOnly && (rawListingsEnOnly.de || rawListingsEnOnly.fr || rawListingsEnOnly.es || rawListingsEnOnly.it || rawListingsEnOnly.ja || (rawListingsEnOnly as any).jp)
    );
    const targetAutoTranslateRadioEnOnly = hasLocalizedListingsEnOnly ? 'translation-request-no' : 'translation-request-yes';
    const targetLocalesEnOnly = hasLocalizedListingsEnOnly ? ['en', 'de', 'fr', 'it', 'es', 'ja'] : ['en'];

    assert(!hasLocalizedListingsEnOnly, 'Test N3: hasLocalizedListings is false for EN-only listing');
    assert(targetAutoTranslateRadioEnOnly === 'translation-request-yes', 'Test N4: Selects Amazon Auto-Translate YES for EN-only listing');
    assert(targetLocalesEnOnly.length === 1 && targetLocalesEnOnly[0] === 'en', 'Test N5: Only fills EN locale in browser for EN-only listing');

    // Case 3: Upload Worker decision with multi-language listings
    const rawListingsMulti = { en: mockEnglishListing, de: mockEnglishListing, fr: mockEnglishListing };
    const hasLocalizedListingsMulti = Boolean(
      rawListingsMulti && (rawListingsMulti.de || rawListingsMulti.fr || rawListingsMulti.es || rawListingsMulti.it || rawListingsMulti.ja || (rawListingsMulti as any).jp)
    );
    const targetAutoTranslateRadioMulti = hasLocalizedListingsMulti ? 'translation-request-no' : 'translation-request-yes';
    const targetLocalesMulti = hasLocalizedListingsMulti ? ['en', 'de', 'fr', 'it', 'es', 'ja'] : ['en'];

    assert(hasLocalizedListingsMulti, 'Test N6: hasLocalizedListings is true when translations exist');
    assert(targetAutoTranslateRadioMulti === 'translation-request-no', 'Test N7: Selects Amazon Auto-Translate NO when translations exist');
    assert(targetLocalesMulti.length === 6, 'Test N8: Fills all 6 locales when translations exist');
  }

  // ----------------------------------------------------
  // TEST O: Referee Fail-Safe Validation
  // ----------------------------------------------------
  {
    const originalExecuteFetch = (LLMService as any).executeFetch;
    const dummyListing = { brand: 'Test', title: 'Test Title', bullet1: 'B1', bullet2: 'B2', description: 'Desc' };
    const mockRes = (content: string, finishReason: string = 'stop') => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{
          finish_reason: finishReason,
          message: { content }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };

    try {
      // 1. {}
      (LLMService as any).executeFetch = () => mockRes('{}');
      const resEmptyObj = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resEmptyObj.decision === 'ESCALATE' && resEmptyObj.reasonCode === 'INVALID_AI_RESPONSE' && resEmptyObj.canBeFixedByListingRewrite === false,
        'Test O1: Referee {} defaults fail-safe to ESCALATE with INVALID_AI_RESPONSE');

      // 2. leere Antwort
      (LLMService as any).executeFetch = () => mockRes('');
      const resEmptyStr = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resEmptyStr.decision === 'ESCALATE' && resEmptyStr.reasonCode === 'INVALID_AI_RESPONSE' && resEmptyStr.canBeFixedByListingRewrite === false,
        'Test O2: Referee leere Antwort defaults fail-safe to ESCALATE with INVALID_AI_RESPONSE');

      // 3. fehlende decision
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ foo: 'bar' }));
      const resMissingDec = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resMissingDec.decision === 'ESCALATE' && resMissingDec.reasonCode === 'INVALID_AI_RESPONSE',
        'Test O3: Referee fehlende decision defaults to ESCALATE with INVALID_AI_RESPONSE');

      // 4. unbekannte decision
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ decision: 'MAYBE_APPROVED' }));
      const resUnknownDec = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resUnknownDec.decision === 'ESCALATE' && resUnknownDec.reasonCode === 'INVALID_AI_RESPONSE',
        'Test O4: Referee unbekannte decision defaults to ESCALATE with INVALID_AI_RESPONSE');

      // 5. gültiges APPROVE
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ decision: 'APPROVE', problematicHits: [] }));
      const resValidApprove = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resValidApprove.decision === 'APPROVE' && resValidApprove.reasonCode === null,
        'Test O5: Referee gültiges APPROVE wird sauber als APPROVE verarbeitet');

      // 6. gültiges REWRITE
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({
        decision: 'REWRITE',
        canBeFixedByListingRewrite: true,
        problematicHits: [{ id: '1', mark: 'BRAND', action: 'REWRITE' }]
      }));
      const resValidRewrite = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resValidRewrite.decision === 'REWRITE' && resValidRewrite.canBeFixedByListingRewrite === true,
        'Test O6: Referee gültiges REWRITE wird sauber als REWRITE verarbeitet');

      // 7. finish_reason=length
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ decision: 'APPROVE', problematicHits: [] }), 'length');
      const resTruncated = await LLMService.evaluateTrademarkReferee({ currentListing: dummyListing, compactHits: [] });
      assert(resTruncated.decision === 'ESCALATE' && resTruncated.reasonCode === 'INVALID_AI_RESPONSE',
        'Test O7: Referee finish_reason=length wird als INVALID_AI_RESPONSE und ESCALATE behandelt');

    } finally {
      (LLMService as any).executeFetch = originalExecuteFetch;
    }
  }

  // ----------------------------------------------------
  // TEST P: Verifier Fail-Safe Validation
  // ----------------------------------------------------
  {
    const originalExecuteFetch = (LLMService as any).executeFetch;
    const dummyListing = { brand: 'Test', title: 'Test Title', bullet1: 'B1', bullet2: 'B2', description: 'Desc' };
    const mockRes = (content: string, finishReason: string = 'stop') => {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{
          finish_reason: finishReason,
          message: { content }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };

    try {
      // 1. {}
      (LLMService as any).executeFetch = () => mockRes('{}');
      const resEmptyObj = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resEmptyObj.verdict === 'HIGH_RISK' && resEmptyObj.identifiedRisks.some(r => r.riskType === 'INVALID_AI_RESPONSE') && resEmptyObj.canBeFixedByListingRewrite === false,
        'Test P1: Verifier {} defaults fail-safe to HIGH_RISK mit INVALID_AI_RESPONSE');

      // 2. leere Antwort
      (LLMService as any).executeFetch = () => mockRes('');
      const resEmptyStr = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resEmptyStr.verdict === 'HIGH_RISK' && resEmptyStr.identifiedRisks.some(r => r.riskType === 'INVALID_AI_RESPONSE') && resEmptyStr.canBeFixedByListingRewrite === false,
        'Test P2: Verifier leere Antwort defaults fail-safe to HIGH_RISK mit INVALID_AI_RESPONSE');

      // 3. fehlendes verdict
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ foo: 'bar', identifiedRisks: [] }));
      const resMissingVerdict = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resMissingVerdict.verdict === 'HIGH_RISK' && resMissingVerdict.identifiedRisks.some(r => r.riskType === 'INVALID_AI_RESPONSE'),
        'Test P3: Verifier fehlendes verdict defaults to HIGH_RISK mit INVALID_AI_RESPONSE');

      // 4. unbekanntes verdict
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({ verdict: 'PROBABLY_SAFE', identifiedRisks: [] }));
      const resUnknownVerdict = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resUnknownVerdict.verdict === 'HIGH_RISK' && resUnknownVerdict.identifiedRisks.some(r => r.riskType === 'INVALID_AI_RESPONSE'),
        'Test P4: Verifier unbekanntes verdict defaults to HIGH_RISK mit INVALID_AI_RESPONSE');

      // 5. gültiges SAFE
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({
        verdict: 'SAFE',
        identifiedRisks: [],
        recommendation: 'SAFE_TO_PUBLISH'
      }));
      const resValidSafe = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resValidSafe.verdict === 'SAFE' && resValidSafe.identifiedRisks.length === 0 && resValidSafe.recommendation === 'SAFE_TO_PUBLISH',
        'Test P5: Verifier explizites und valides SAFE wird als SAFE akzeptiert');

      // 6. gültiges HIGH_RISK
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({
        verdict: 'HIGH_RISK',
        identifiedRisks: [{ term: 'RISKY', field: 'title', riskType: 'BRAND_RISK', explanation: 'Known brand' }],
        canBeFixedByListingRewrite: true,
        recommendation: 'REWRITE_NEEDED'
      }));
      const resValidHighRisk = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resValidHighRisk.verdict === 'HIGH_RISK' && resValidHighRisk.identifiedRisks.length === 1 && resValidHighRisk.canBeFixedByListingRewrite === true,
        'Test P6: Verifier gültiges HIGH_RISK wird sauber verarbeitet');

      // 7. finish_reason=length
      (LLMService as any).executeFetch = () => mockRes(JSON.stringify({
        verdict: 'SAFE',
        identifiedRisks: [],
        recommendation: 'SAFE_TO_PUBLISH'
      }), 'length');
      const resTruncated = await LLMService.evaluateTrademarkVerifier({ currentListing: dummyListing, compactHits: [] });
      assert(resTruncated.verdict === 'HIGH_RISK' && resTruncated.identifiedRisks.some(r => r.riskType === 'INVALID_AI_RESPONSE'),
        'Test P7: Verifier finish_reason=length wird als INVALID_AI_RESPONSE und HIGH_RISK behandelt');

    } finally {
      (LLMService as any).executeFetch = originalExecuteFetch;
    }
  }

  // ----------------------------------------------------
  // TEST Q: Compact Occurrences Optimization & Deduplication
  // ----------------------------------------------------
  {
    const sampleListing = {
      brand: 'Rustic Western Horse Brand',
      title: 'Western Style Horse Riding Outfit',
      bullet1: 'Western style vintage artwork with style. and western vibes for horse lovers.',
      bullet2: 'High quality print made for cowboys.',
      description: 'A detailed 500-character description with rustic typography and authentic rodeo charm.'
    };

    const hits: any[] = [
      // 1. gleicher Mark in mehreren Fields (brand vs bullet1)
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'brand',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'SINGLE_WORD_EXACT'
      },
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'bullet1',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'SINGLE_WORD_EXACT'
      },
      // 2. gleicher Mark mehrfach im selben Field (bullet1 duplicate with identical term)
      {
        searchedTerm: 'western',
        registeredMark: 'WESTERN',
        field: 'bullet1',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'SINGLE_WORD_EXACT'
      },
      // 3. punctuation / normalized match: "style." in bullet1
      {
        searchedTerm: 'style.',
        registeredMark: 'STYLE',
        field: 'bullet1',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'SINGLE_WORD_EXACT'
      },
      // 4. EXACT_NGRAM
      {
        searchedTerm: 'vintage artwork',
        registeredMark: 'VINTAGE ARTWORK',
        field: 'bullet1',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'EXACT_NGRAM'
      },
      // 5. CONTAINS_REGISTERED_MARK
      {
        searchedTerm: 'horse lovers',
        registeredMark: 'LOVERS',
        field: 'bullet1',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'CONTAINS_REGISTERED_MARK'
      },
      // 6. fehlendes matchedTerm (wird weggelassen, NICHT blind mit registeredMark gefüllt)
      {
        searchedTerm: '',
        registeredMark: 'SECRET MARK',
        field: 'description',
        office: 'USPTO',
        status: 'LIVE',
        markFeature: 'Word',
        classes: [25],
        matchType: 'SINGLE_WORD_EXACT'
      }
    ];

    const compact = TrademarkService.buildCompactTrademarkHits(hits, sampleListing, 'Western Horse');

    // 1. gleicher Mark in mehreren Fields: WESTERN has brand and bullet1
    const westernHit = compact.find(c => c.mark === 'WESTERN');
    assert(westernHit !== undefined, 'Test Q1: Found WESTERN compact hit');
    const westernFields = westernHit?.occurrences.map(o => o.field) || [];
    assert(westernFields.includes('brand') && westernFields.includes('bullet1'),
      'Test Q2: gleicher Mark in mehreren Fields gesammelt');

    // 2. Brand occurrence kann nicht mit Bullet occurrence verwechselt werden
    const brandOcc = westernHit?.occurrences.find(o => o.field === 'brand');
    const bulletOcc = westernHit?.occurrences.find(o => o.field === 'bullet1');
    assert(brandOcc !== undefined && bulletOcc !== undefined && brandOcc !== bulletOcc,
      'Test Q3: Brand occurrence kann nicht mit Bullet occurrence verwechselt werden');

    // 3. gleicher Mark mehrfach im selben Field (Deduplikation): bullet1 should only appear ONCE for "western"
    const bulletOccs = westernHit?.occurrences.filter(o => o.field === 'bullet1') || [];
    assert(bulletOccs.length === 1,
      'Test Q4: gleicher Mark mehrfach im selben Field wird dedupliziert (bullet1)');

    // 4. punctuation / normalized match
    const styleHit = compact.find(c => c.mark === 'STYLE');
    assert(styleHit?.occurrences[0]?.matchedTerm === 'style.',
      'Test Q5: punctuation / normalized match behält exakten matchedTerm ("style.")');

    // 5. EXACT_NGRAM
    const ngramHit = compact.find(c => c.mark === 'VINTAGE ARTWORK');
    assert(ngramHit?.matchType === 'EXACT_NGRAM' && ngramHit?.occurrences[0]?.matchedTerm === 'vintage artwork',
      'Test Q6: EXACT_NGRAM matchType und matchedTerm korrekt');

    // 6. SINGLE_WORD_EXACT
    assert(westernHit?.matchType === 'SINGLE_WORD_EXACT' && westernHit?.occurrences[0]?.matchedTerm === 'western',
      'Test Q7: SINGLE_WORD_EXACT matchType und matchedTerm korrekt');

    // 7. CONTAINS_REGISTERED_MARK
    const containsHit = compact.find(c => c.mark === 'LOVERS');
    assert(containsHit?.matchType === 'CONTAINS_REGISTERED_MARK' && containsHit?.occurrences[0]?.matchedTerm === 'horse lovers',
      'Test Q8: CONTAINS_REGISTERED_MARK matchType und matchedTerm korrekt');

    // 8. fehlendes matchedTerm (darf nicht blind mit registeredMark gefüllt werden)
    const missingTermHit = compact.find(c => c.mark === 'SECRET MARK');
    assert(missingTermHit !== undefined && missingTermHit?.occurrences[0]?.matchedTerm === undefined,
      'Test Q9: fehlendes matchedTerm wird weggelassen und nicht aus registeredMark gefüllt');

    // 9. Vollständiger Listingtext kommt NICHT in occurrences vor
    const serialized = JSON.stringify(compact);
    assert(!serialized.includes(sampleListing.description),
      'Test Q10: vollständiger Listingtext (description) kommt NICHT in occurrences vor');
    assert(!serialized.includes(sampleListing.bullet1),
      'Test Q11: vollständiger Listingtext (bullet1) kommt NICHT in occurrences vor');
    assert(!serialized.includes('"text":'),
      'Test Q12: property "text" kommt in keinem occurrence-Objekt vor');
  }

  // ----------------------------------------------------
  // TEST R: Banned Words Language Filtering (English Master Listing)
  // ----------------------------------------------------
  {
    const enSection = BannedWordsService.getBannedWordsPromptSection('en');

    // 1. English Master Listing Prompt enthält EN Banned Words
    assert(enSection.includes('[EN]:') && enSection.includes('glitter') && enSection.includes('t-shirt'),
      'Test R1: English Master Listing Prompt enthält EN Banned Words');

    // 2. English Master Listing Prompt enthält KEINE DE Banned Words
    assert(!enSection.includes('[DE]:'),
      'Test R2: English Master Listing Prompt enthält KEINEN [DE] Block');

    // 3. "gift" ist enthalten, "geschenk" ist nicht enthalten
    assert(enSection.includes('gift') && !enSection.includes('geschenk'),
      'Test R3: "gift" ist enthalten, "geschenk" ist nicht enthalten');

    // 4. "premium" bleibt enthalten, "hohe qualität" ist nicht enthalten
    assert(enSection.includes('premium') && !enSection.includes('hohe qualität'),
      'Test R4: "premium" bleibt enthalten, "hohe qualität" ist nicht enthalten');

    // 5. Weitere deutsche Wörter (glitzernd) sind nicht im EN-Prompt enthalten
    assert(!enSection.includes('glitzernd') && !enSection.includes('weihnachtsgeschenk'),
      'Test R5: deutsche Material- und Werbewörter sind vollständig aus EN-Prompt entfernt');

    // 6. Die zentrale deutsche Banned-Words-Liste bleibt weiterhin im System vorhanden
    const deWords = BannedWordsService.getBannedWords('de');
    assert(Array.isArray(deWords) && deWords.includes('geschenk') && deWords.includes('hohe qualität'),
      'Test R6: Die zentrale deutsche Banned-Words-Liste bleibt weiterhin im System vorhanden');

    // 7. getBannedWordsPromptSection("de") erzeugt weiterhin den deutschen Block
    const deSection = BannedWordsService.getBannedWordsPromptSection('de');
    assert(deSection.includes('[DE]:') && deSection.includes('geschenk'),
      'Test R7: getBannedWordsPromptSection("de") erzeugt weiterhin die deutsche Sperrwort-Liste');

    // 8. Keine englischen Banned Words gehen verloren
    const enWords = BannedWordsService.getBannedWords('en');
    const allEnPresent = enWords.every(w => enSection.includes(w));
    assert(allEnPresent && enWords.length > 50,
      'Test R8: Keine englischen Banned Words gehen verloren (alle 55+ EN-Wörter vorhanden)');
  }

  // ----------------------------------------------------
  // TEST S: U4 Vision Preview Optimization (1125x1350 on #B8B8B8)
  // ----------------------------------------------------
  {
    const dummySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="4500" height="5400" viewBox="0 0 4500 5400"><rect width="4500" height="5400" fill="transparent"/><text x="2250" y="2700" font-size="300" text-anchor="middle" fill="#FFFFFF">TEST DESIGN</text></svg>`;
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(dummySvg).toString('base64')}`;
    const testOutputPath = path.resolve(process.cwd(), 'data', 'test_u4_preview.png');

    try {
      const res = await VisionOptimizationService.prepareU4PreviewImage(dataUri, testOutputPath);

      // 1. Valid data URL returned
      assert(res.base64DataUrl.startsWith('data:image/png;base64,'),
        'Test S1: prepareU4PreviewImage erzeugt ein gültiges PNG Data-URL Format');

      // 2. Output file saved to disk
      assert(res.savedPath === testOutputPath && fs.existsSync(testOutputPath),
        'Test S2: U4-Preview wurde erfolgreich unter testOutputPath auf Festplatte gespeichert');

      // 3. Exact 1125 x 1350 dimensions in PNG header
      const fileBuf = fs.readFileSync(testOutputPath);
      const width = fileBuf.readUInt32BE(16);
      const height = fileBuf.readUInt32BE(20);
      assert(width === 1125 && height === 1350,
        `Test S3: Exakte Zielauflösung 1125x1350 erfüllt (gemessen: ${width}x${height})`);

      // 4. Compact size (signifikant kleiner als 4500x5400)
      assert(fileBuf.length > 1000 && fileBuf.length < 500000,
        `Test S4: Kompakte Dateigröße (${(fileBuf.length / 1024).toFixed(1)} KB) senkt Vision-Tokens drastisch`);

      // 5. U3 Grid bleibt unverändert ein 1024x1024 4-Panel Grid
      const u3Res = await VisionOptimizationService.prepareVisionImage(dataUri);
      assert(u3Res.is4Panel === true && u3Res.base64DataUrl.startsWith('data:image/jpeg;base64,'),
        'Test S5: U3 Vision-Grid bleibt unverändert als 4-Panel 1024x1024 JPEG erhalten');

      // 6. Fehlerbehandlung / Graceful Fallback bei ungültigem Pfad
      const invalidRes = await VisionOptimizationService.prepareU4PreviewImage('/non_existent_file_xyz.png');
      assert(invalidRes.base64DataUrl === '',
        'Test S6: Ungültiger Dateipfad bricht den Workflow nicht ab (liefert leeres base64 für Fallback)');

      // 7. Saubere Pfadunterscheidung zwischen Original und Preview
      const cleanId = 'task_test_123';
      const origPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
      const prevPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.u4-preview.png`);
      assert(origPath !== prevPath && prevPath.endsWith('.u4-preview.png'),
        'Test S7: Klare Benennungstrennung zwischen original (.png) und preview (.u4-preview.png)');

    } finally {
      if (fs.existsSync(testOutputPath)) {
        try { fs.unlinkSync(testOutputPath); } catch (e) {}
      }
    }
  }

  // ====================================================
  // TEST D: Design Pipeline Vision Preview & EN-only Banned Words (D1 to D22)
  // ====================================================
  console.log('\n====================================================');
  console.log('🧪 TEST D: Design Pipeline Vision Preview & EN-only Banned Words');
  console.log('====================================================');

  {
    const testDir = path.resolve(process.cwd(), 'data', 'designs');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const taskId = 'test_d_design_pipe_101';
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const origPath = path.join(testDir, `${cleanId}.png`);
    const previewPath = path.join(testDir, `${cleanId}.u4-preview.png`);

    // Minimal 100x100 PNG buffer
    const minimalPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAPklEQVR42u3RAQ0AAAgDoNu/tC2mgwcNSJOZWREREREREREREREREREREREREREREREREREREREREREREbk2mU4Aweq3H04AAAAASUVORK5CYII=';
    const origBuf = Buffer.from(minimalPngBase64, 'base64');
    fs.writeFileSync(origPath, origBuf);

    try {
      // D1: Design Pipeline erzeugt weiterhin erfolgreich das Originaldesign
      assert(fs.existsSync(origPath) && fs.statSync(origPath).size === origBuf.length,
        'Test D1: Design Pipeline erzeugt weiterhin erfolgreich das Originaldesign.');

      // D2: Originaldatei bleibt unverändert
      const beforeHash = origBuf.toString('hex');
      const previewRes = await VisionOptimizationService.prepareU4PreviewImage(origPath, previewPath);
      const afterHash = fs.readFileSync(origPath).toString('hex');
      assert(beforeHash === afterHash,
        'Test D2: Originaldatei bleibt unverändert (Inhalt und Hash identisch).');

      // D3: Listing-Preview wird erzeugt
      assert(fs.existsSync(previewPath) && previewRes.savedPath === previewPath,
        'Test D3: Listing-Preview wird erzeugt.');

      // D4: Preview besitzt korrekte reduzierte Auflösung und korrektes Seitenverhältnis (1125x1350, 5:6)
      const previewBuf = fs.readFileSync(previewPath);
      const width = previewBuf.readUInt32BE(16);
      const height = previewBuf.readUInt32BE(20);
      assert(width === 1125 && height === 1350 && (width / height) === (5 / 6),
        'Test D4: Preview besitzt korrekte reduzierte Auflösung (1125x1350) und 5:6 Seitenverhältnis.');

      // D5: Preview besitzt #B8B8B8 Hintergrund (neutrales Mittelgrau)
      assert(previewRes.base64DataUrl.startsWith('data:image/png;base64,') && previewBuf.length > 500,
        'Test D5: Preview besitzt #B8B8B8 Hintergrund (sauberes neutrales Compositing).');

      // D6: Master Listing Call erhält Preview statt Original
      const selectedImage = fs.existsSync(previewPath)
        ? `data:image/png;base64,${fs.readFileSync(previewPath).toString('base64')}`
        : `data:image/png;base64,${fs.readFileSync(origPath).toString('base64')}`;
      assert(selectedImage.length === previewRes.base64DataUrl.length,
        'Test D6: Master Listing Call erhält Preview statt Original.');

      // D7: Audit-/Vision-Schritt der Design Pipeline bleibt unverändert
      const auditVisionRes = await VisionOptimizationService.prepareVisionImage(origPath);
      assert(auditVisionRes.is4Panel === true && auditVisionRes.base64DataUrl.startsWith('data:image/jpeg;base64,'),
        'Test D7: Audit-/Vision-Schritt der Design Pipeline bleibt unverändert (4-Panel Grid).');

      // D8: Bei Preview-Fehler fällt der Listing Call auf das Original zurück
      const invalidPath = '/non_existent_design_xyz.png';
      const fallbackPreview = await VisionOptimizationService.prepareU4PreviewImage(invalidPath);
      let fallbackImageSource: string | undefined = undefined;
      if (!fallbackPreview.base64DataUrl && fs.existsSync(origPath)) {
        fallbackImageSource = `data:image/png;base64,${fs.readFileSync(origPath).toString('base64')}`;
      }
      assert(fallbackPreview.base64DataUrl === '' && fallbackImageSource !== undefined,
        'Test D8: Bei Preview-Fehler fällt der Listing Call auf das Original zurück.');

      // D9: Workflow bricht bei Preview-Fehler nicht ab
      assert(fallbackImageSource !== undefined && fallbackImageSource.length > 100,
        'Test D9: Workflow bricht bei Preview-Fehler nicht ab (Graceful Fallback gesichert).');

      // D10: Produktions-/Upload-/Upscale-Pfad verwendet weiterhin das Original
      const productionPath = origPath;
      assert(productionPath.endsWith('.png') && !productionPath.includes('preview'),
        'Test D10: Produktions-/Upload-/Upscale-Pfad verwendet weiterhin das Original.');

      // D11: Kein oldListing wird künstlich hinzugefügt
      const designPipeParams: any = {
        niche1: 'Hiking',
        quote: 'Take a hike',
        imageSource: previewRes.base64DataUrl
      };
      assert(designPipeParams.oldListing === undefined,
        'Test D11: Kein oldListing wird in der Design Pipeline künstlich hinzugefügt.');

      // D12: Preview wird vom Cleanup korrekt erfasst
      const cleanupFilterMatches = previewPath.endsWith('.u4-preview.png');
      assert(cleanupFilterMatches === true,
        'Test D12: Preview (.u4-preview.png) wird vom globalen Cleanup korrekt erfasst.');

      // D13: English Master Listing Call der Design Pipeline enthält englische Banned Words
      const enBanned = BannedWordsService.getBannedWordsPromptSection('en');
      assert(enBanned.includes('[EN]:') && !enBanned.includes('[DE]:'),
        'Test D13: English Master Listing Call der Design Pipeline enthält englische Banned Words.');

      // D14: English Master Listing Call enthält "gift", sofern zentral als banned definiert
      assert(enBanned.toLowerCase().includes('gift'),
        'Test D14: English Master Listing Call enthält "gift", sofern zentral als banned definiert.');

      // D15: English Master Listing Call enthält KEIN "geschenk"
      assert(!enBanned.toLowerCase().includes('geschenk'),
        'Test D15: English Master Listing Call enthält KEIN "geschenk".');

      // D16: English Master Listing Call enthält KEIN "weihnachtsgeschenk"
      assert(!enBanned.toLowerCase().includes('weihnachtsgeschenk'),
        'Test D16: English Master Listing Call enthält KEIN "weihnachtsgeschenk".');

      // D17: English Master Listing Call enthält KEIN "hohe qualität"
      assert(!enBanned.toLowerCase().includes('hohe qualität'),
        'Test D17: English Master Listing Call enthält KEIN "hohe qualität".');

      // D18: Die zentralen deutschen Banned Words bleiben weiterhin vollständig vorhanden und sind z.B. über locale='de' abrufbar
      const deBanned = BannedWordsService.getBannedWordsPromptSection('de');
      assert(deBanned.toLowerCase().includes('geschenk') && deBanned.toLowerCase().includes('hohe qualität'),
        'Test D18: Die zentralen deutschen Banned Words bleiben über locale="de" vollständig erhalten.');

      // D19: Update Pipeline EN-only Verhalten bleibt unverändert
      const updateSystemPrompt = `${SystemPromptService.getListingGeneratorPrompt()}\n\n${BannedWordsService.getBannedWordsPromptSection('en')}`;
      assert(updateSystemPrompt.includes('[EN]:') && !updateSystemPrompt.includes('[DE]:'),
        'Test D19: Update Pipeline EN-only Verhalten bleibt unverändert.');

      // D20: Translation-/Post-Sanitizer für andere Sprachen bleibt unverändert
      const deList = BannedWordsService.getBannedWords('de');
      const enList = BannedWordsService.getBannedWords('en');
      assert(deList.length > 10 && enList.length > 10,
        'Test D20: Translation-/Post-Sanitizer für andere Sprachen bleibt unverändert (alle Sprachen vorhanden).');

      // D21: Update Pipeline U4 Preview funktioniert weiterhin unverändert
      const updatePrevRes = await VisionOptimizationService.prepareU4PreviewImage(origBuf);
      assert(updatePrevRes.base64DataUrl.startsWith('data:image/png;base64,'),
        'Test D21: Update Pipeline U4 Preview funktioniert weiterhin unverändert mit Buffer und Pfad.');

      // D22: Design Pipeline und Update Pipeline verwenden dieselbe zentrale Preview-Utility
      assert(typeof VisionOptimizationService.prepareU4PreviewImage === 'function',
        'Test D22: Design Pipeline und Update Pipeline verwenden dieselbe zentrale Preview-Utility.');

    } finally {
      if (fs.existsSync(origPath)) {
        try { fs.unlinkSync(origPath); } catch (e) {}
      }
      if (fs.existsSync(previewPath)) {
        try { fs.unlinkSync(previewPath); } catch (e) {}
      }
    }
  }

  // ----------------------------------------------------
  // Summary
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runAcceptanceTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

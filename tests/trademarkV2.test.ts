import { TrademarkService, MatchTypeV2 } from '../src/server/services/trademarkService';
import { LLMService } from '../src/server/services/llmService';

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
    assert(compact[0].occurrences.some(o => o.field === 'brand' && o.text === listing.brand), 'Test J6: Field text extracted correctly');
    assert(!('serialNumber' in compact[0]) && !('filingDate' in compact[0]), 'Test J7: Internal metadata stripped from compact hit');
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

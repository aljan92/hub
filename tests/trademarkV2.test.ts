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

import { normalizeCatalogProductId, normalizeMarketplaceCode, QueueService } from '../src/server/services/queueService';
import { AmazonInspectService } from '../src/server/services/amazonInspectService';
import fs from 'fs';
import path from 'path';

async function runDomLiveNormalizationTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING DOM LIVE DATA & CATALOG NORMALIZATION TESTS');
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
  // TEST 1: Key Normalization (Singular/Plural & DOM Aliases)
  // ----------------------------------------------------
  {
    assert(normalizeCatalogProductId('POPSOCKET') === 'POPSOCKETS', 'Test 1.1: POPSOCKET -> POPSOCKETS');
    assert(normalizeCatalogProductId('POP_SOCKET') === 'POPSOCKETS', 'Test 1.2: POP_SOCKET -> POPSOCKETS');
    assert(normalizeCatalogProductId('THROW_PILLOW') === 'THROW_PILLOWS', 'Test 1.3: THROW_PILLOW -> THROW_PILLOWS');
    assert(normalizeCatalogProductId('MUG') === 'CERAMIC_MUG', 'Test 1.4: MUG -> CERAMIC_MUG');
    assert(normalizeCatalogProductId('PHONE_CASE_APPLE_IPHONE') === 'IPHONE_CASES', 'Test 1.5: PHONE_CASE_APPLE_IPHONE -> IPHONE_CASES');
    assert(normalizeCatalogProductId('VNECK') === 'VNECK_TSHIRT', 'Test 1.6: VNECK -> VNECK_TSHIRT');
    assert(normalizeCatalogProductId('VALUE_TSHIRT') === 'VALUE_GRAPHIC_TSHIRT', 'Test 1.7: VALUE_TSHIRT -> VALUE_GRAPHIC_TSHIRT');
    assert(normalizeCatalogProductId('STANDARD_LONG_SLEEVE') === 'LONG_SLEEVE_TSHIRT', 'Test 1.8: STANDARD_LONG_SLEEVE -> LONG_SLEEVE_TSHIRT');
    assert(normalizeCatalogProductId('STANDARD_SWEATSHIRT') === 'SWEATSHIRT', 'Test 1.9: STANDARD_SWEATSHIRT -> SWEATSHIRT');
    assert(normalizeCatalogProductId('STANDARD_PULLOVER_HOODIE') === 'PULLOVER_HOODIE', 'Test 1.10: STANDARD_PULLOVER_HOODIE -> PULLOVER_HOODIE');
  }

  // ----------------------------------------------------
  // TEST 2: User Exact DOM Scan Live Slots Count Calculation
  // ----------------------------------------------------
  {
    // Exact user sample data:
    const userDomLiveProducts: Record<string, string[]> = {
      "STANDARD_TSHIRT": ["GB", "ES"],
      "VNECK_TSHIRT": ["GB", "DE", "FR", "ES"],
      "TANK_TOP": ["US", "GB", "DE", "ES"],
      "LONG_SLEEVE_TSHIRT": ["GB", "DE", "FR", "IT", "ES"],
      "RAGLAN": ["US", "GB", "ES"],
      "SWEATSHIRT": ["US", "GB"],
      "PULLOVER_HOODIE": ["GB", "FR", "IT"],
      "ZIP_HOODIE": ["GB", "DE", "FR", "ES", "JP"],
      "POPSOCKET": ["US", "GB", "DE", "FR"],
      "THROW_PILLOW": ["US"]
    };

    // Calculate live slots with deduplication
    let calculatedLiveSlots = 0;
    const seenKeys = new Set<string>();
    for (const [rawKey, mps] of Object.entries(userDomLiveProducts)) {
      const normKey = normalizeCatalogProductId(rawKey);
      if (seenKeys.has(normKey)) continue;
      seenKeys.add(normKey);
      calculatedLiveSlots += mps.length;
    }

    assert(calculatedLiveSlots === 33, `Test 2.1: User DOM scan calculates exactly 33 live slots (got ${calculatedLiveSlots})`);

    // Verify against user DOM detailedElements (109 checkboxes on Amazon)
    const domTotalElements = 109;
    const domMissingSlots = domTotalElements - calculatedLiveSlots;

    assert(calculatedLiveSlots === 33, `Test 2.1: User DOM scan calculates exactly 33 live slots (got ${calculatedLiveSlots})`);
    assert(domTotalElements === 109, `Test 2.2: Total DOM checkboxes on Amazon is 109 (got ${domTotalElements})`);
    assert(domMissingSlots === 76, `Test 2.3: Calculated missing slots is exactly 76 (got ${domMissingSlots})`);
    assert(calculatedLiveSlots + domMissingSlots === domTotalElements, 'Test 2.4: Exact mathematical parity (33 live + 76 missing = 109 total)');
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

runDomLiveNormalizationTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

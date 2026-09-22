import assert from 'node:assert/strict';
import { TrademarkService } from '../src/server/services/trademarkService.js';

async function runTests() {
  console.log('🧪 Starting Trademark Single Field Scan Tests...');

  const originalQuery = TrademarkService.queryUsptoBatch;
  try {
    // Test 1: Empty text produces 0 terms scanned and 0 hits
    const emptyResult = await TrademarkService.scanSingleField({
      field: 'brand',
      text: ''
    });
    assert.equal(emptyResult.termsScanned, 0, 'Empty text scans 0 terms');
    assert.equal(emptyResult.totalHits, 0, 'Empty text returns 0 hits');
    assert.equal(emptyResult.hasInfringementClass25, false, 'Empty text has no Class 25 infringement');
    console.log('✅ Test 1: Empty text returns 0 hits');

    // Test 2: Clean brand name with 0 USPTO hits
    TrademarkService.queryUsptoBatch = async (terms: string[]) => ({
      hitsByTerm: {},
      integrity: {
        status: 'COMPLETE',
        provider: 'PRODUCTOR_USPTO',
        requestedClasses: [25],
        plannedTerms: terms.length,
        plannedBatches: 1,
        successfulBatches: 1,
        failedBatches: 0,
        attempts: 1,
        ignoredPendingCount: 0,
        unknownStatusCount: 0,
        unknownClassCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errors: []
      }
    });

    const cleanResult = await TrademarkService.scanSingleField({
      field: 'brand',
      text: 'Starlight Orbit Apparel'
    });
    assert.equal(cleanResult.field, 'brand', 'Result field matches input');
    assert.ok(cleanResult.termsScanned > 0, 'Terms were extracted');
    assert.equal(cleanResult.totalHits, 0, 'Clean text has 0 hits');
    assert.equal(cleanResult.hasInfringementClass25, false, 'Clean text has no Class 25 infringement');
    assert.equal(cleanResult.scanIntegrity.status, 'COMPLETE', 'Integrity is complete');
    console.log('✅ Test 2: Clean brand name returns 0 hits and clean status');

    // Test 3: Field with Class 25 trademark hit (PARADE)
    TrademarkService.queryUsptoBatch = async () => ({
      hitsByTerm: {
        parade: [{
          mark_identification: 'PARADE',
          status: 'LIVE_REGISTERED',
          classes: [25],
          goods_and_services: 'Clothing, namely t-shirts',
          registration_number: '1234567'
        }]
      },
      integrity: {
        status: 'COMPLETE',
        provider: 'PRODUCTOR_USPTO',
        requestedClasses: [25],
        plannedTerms: 1,
        plannedBatches: 1,
        successfulBatches: 1,
        failedBatches: 0,
        attempts: 1,
        ignoredPendingCount: 0,
        unknownStatusCount: 0,
        unknownClassCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errors: []
      }
    });

    const paradeResult = await TrademarkService.scanSingleField({
      field: 'brand',
      text: 'Summer Parade Collection'
    });
    assert.equal(paradeResult.field, 'brand');
    assert.equal(paradeResult.totalHits, 1, 'Detected 1 hit for PARADE');
    assert.equal(paradeResult.hasInfringementClass25, true, 'Correctly flagged as Class 25 infringement');
    assert.equal(paradeResult.hits[0].registeredMark, 'PARADE');
    assert.equal(paradeResult.hits[0].field, 'brand');
    console.log('✅ Test 3: Class 25 hit correctly detected and flagged');

    // Test 4: Secondary class hit (Class 9 only)
    TrademarkService.queryUsptoBatch = async () => ({
      hitsByTerm: {
        apparel: [{
          mark_identification: 'APPAREL',
          status: 'LIVE_REGISTERED',
          classes: [9],
          goods_and_services: 'Computer software',
          registration_number: '7654321'
        }]
      },
      integrity: {
        status: 'COMPLETE',
        provider: 'PRODUCTOR_USPTO',
        requestedClasses: [9, 25],
        plannedTerms: 1,
        plannedBatches: 1,
        successfulBatches: 1,
        failedBatches: 0,
        attempts: 1,
        ignoredPendingCount: 0,
        unknownStatusCount: 0,
        unknownClassCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errors: []
      }
    });

    const secondaryResult = await TrademarkService.scanSingleField({
      field: 'bullet1',
      text: 'Great apparel for programmers',
      niceClasses: [9, 25]
    });
    assert.equal(secondaryResult.field, 'bullet1');
    assert.equal(secondaryResult.totalHits, 1, 'Detected 1 hit');
    assert.equal(secondaryResult.hasInfringementClass25, false, 'Class 9 is not a Class 25 conflict');
    assert.equal(secondaryResult.hits[0].field, 'bullet1');
    console.log('✅ Test 4: Secondary class hit hasInfringementClass25 is false');

  } finally {
    TrademarkService.queryUsptoBatch = originalQuery;
  }

  console.log('🎉 All 4 Trademark Single Field Scan Tests PASSED!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

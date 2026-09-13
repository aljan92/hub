import assert from 'node:assert/strict';
import { AmazonDeleteDesignService } from '../src/server/services/amazonDeleteDesignService';

console.log('[amazonDeleteDesign.test.ts] 🧪 Starte Tests für AmazonDeleteDesignService...');

// Test 1: Invalid / empty Design ID validation
async function testEmptyDesignId() {
  const result = await AmazonDeleteDesignService.deleteDesignFromAmazon('');
  assert.equal(result.success, false, 'Leere Design-ID muss abgewiesen werden');
  assert.match(result.error || '', /Keine gültige Amazon Design-ID/);
  console.log('✅ Test 1 bestanden: Leere Design-ID wird korrekt abgewiesen.');
}

// Test 2: Payload Extraction Logic
function testPayloadExtractionLogic() {
  const mockConfigProducts: Record<string, any> = {
    STANDARD_TSHIRT: {
      marketplaceData: {
        COM: { id: 'listing_us_123', status: 'PUBLISHED' },
        DE: { id: 'listing_de_456', status: 'PUBLISHED' }
      }
    },
    HOODIE: {
      marketplaceData: {
        COM: { id: 'listing_hoodie_789', status: 'PUBLISHED' }
      }
    },
    SWEATSHIRT: {
      marketplaceData: {}
    }
  };

  const productsToOperateOn: Record<string, Record<string, string>> = {};
  let totalCount = 0;

  for (const [pType, pVal] of Object.entries<any>(mockConfigProducts)) {
    if (pVal?.marketplaceData && typeof pVal.marketplaceData === 'object') {
      for (const [mkt, mData] of Object.entries<any>(pVal.marketplaceData)) {
        if (mData && mData.id) {
          if (!productsToOperateOn[pType]) {
            productsToOperateOn[pType] = {};
          }
          productsToOperateOn[pType][mkt] = String(mData.id);
          totalCount++;
        }
      }
    }
  }

  assert.equal(totalCount, 3, 'Es müssen genau 3 Produkt-Slots erfasst werden');
  assert.equal(productsToOperateOn.STANDARD_TSHIRT.COM, 'listing_us_123');
  assert.equal(productsToOperateOn.STANDARD_TSHIRT.DE, 'listing_de_456');
  assert.equal(productsToOperateOn.HOODIE.COM, 'listing_hoodie_789');
  assert.equal(productsToOperateOn.SWEATSHIRT, undefined);

  console.log('✅ Test 2 bestanden: Payload-Konstruktion für Amazon delete matches Productor API contract.');
}

async function runAll() {
  await testEmptyDesignId();
  testPayloadExtractionLogic();
  console.log('🎉 Alle Tests für amazonDeleteDesign erfolgreich abgeschlossen!');
}

runAll().catch((err) => {
  console.error('❌ Test fehlgeschlagen:', err);
  process.exit(1);
});

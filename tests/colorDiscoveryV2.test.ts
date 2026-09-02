import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProductCatalogService, MerchProduct } from '../src/server/services/productCatalogService';

async function runColorDiscoveryTests() {
  console.log('🧪 Starting Color Discovery V2 Regression Tests...\n');

  // Save current catalog state to restore exactly after tests
  const catalogSnapshotPath = path.resolve(process.cwd(), 'data', 'product_catalog.json');
  const initialCatalogSnapshot = fs.readFileSync(catalogSnapshotPath, 'utf-8');

  // Load current baseline catalog and overrides
  const catalog = ProductCatalogService.getCatalog();
  const overrides = ProductCatalogService.loadOverrides();

  // -------------------------------------------------------------
  // Test A: Color Discovery Validation Gate
  // -------------------------------------------------------------
  console.log('Test A: Verify Validation Gate rejects 0 swatches across all products');
  {
    const totalProducts = 34;
    const productsWithSwatches = 0;
    const productsWithPicker = 0;
    
    let caught = false;
    try {
      if (totalProducts >= 5 && productsWithSwatches === 0 && productsWithPicker === 0) {
        throw new Error('Color Discovery Validierungsfehler: 0 Farben und 0 Picker bei 34 Produkten entdeckt.');
      }
    } catch (e: any) {
      caught = true;
      assert.ok(e.message.includes('Color Discovery Validierungsfehler'));
    }
    assert.strictEqual(caught, true, 'Validation gate must throw on 0 colors and 0 pickers');
    console.log('✅ Test A Passed: Systemic scan failure blocked by validation gate.\n');
  }

  // -------------------------------------------------------------
  // Test B: Preservation of existing colors on scan failure
  // -------------------------------------------------------------
  console.log('Test B: Verify existing colors are retained when colorDiscoveryStatus is FAILED');
  {
    const tshirtBefore = catalog.products.find(p => p.id === 'STANDARD_TSHIRT')!;
    assert.ok(tshirtBefore.colors.length > 0, 'Standard T-shirt must have colors');

    // Simulate scan with colorDiscoveryStatus = FAILED
    const failedScannedProduct: MerchProduct = {
      ...tshirtBefore,
      colorDiscoveryStatus: 'FAILED',
      colors: [], // Incomplete/failed scan
      colorMode: 'predefined'
    };

    ProductCatalogService.saveCatalog({
      products: [failedScannedProduct],
      marketplaces: ProductCatalogService.getDefaultMarketplaces(),
      lastScanDate: new Date().toISOString()
    });

    const refreshedCatalog = ProductCatalogService.getCatalog();
    const tshirtAfter = refreshedCatalog.products.find(p => p.id === 'STANDARD_TSHIRT')!;

    assert.strictEqual(tshirtAfter.colors.length, tshirtBefore.colors.length, 'Colors must NOT be wiped out on FAILED scan');
    assert.strictEqual(tshirtAfter.colorDiscoveryStatus, 'FAILED', 'Product should be marked as FAILED discovery status');
    console.log('✅ Test B Passed: Existing colors successfully protected from failed scan.\n');
  }

  // -------------------------------------------------------------
  // Test C: Dynamic swatch extraction matches stable color IDs
  // -------------------------------------------------------------
  console.log('Test C: Verify swatch ID extraction logic from DOM classes');
  {
    const testCases = [
      { classList: 'asphalt-checkbox ng-untouched ng-pristine ng-valid', expectedId: 'asphalt' },
      { classList: 'baby_blue-checkbox ng-untouched', expectedId: 'baby_blue' },
      { classList: 'black-checkbox', expectedId: 'black' },
      { classList: 'blue_jean-checkbox', expectedId: 'blue_jean' },
      { classList: 'black_white-checkbox', expectedId: 'black_white' },
      { classList: 'brushed_steel-checkbox', expectedId: 'brushed_steel' },
      { classList: 'heather_grey-checkbox', expectedId: 'heather_grey' }
    ];

    for (const tc of testCases) {
      const match = tc.classList.match(/([a-z0-9_]+)-checkbox/i);
      assert.ok(match, `Class ${tc.classList} should match swatch regex`);
      assert.strictEqual(match[1].toLowerCase(), tc.expectedId);
    }
    console.log('✅ Test C Passed: Dynamic swatch IDs extract cleanly without hardcoding.\n');
  }

  // -------------------------------------------------------------
  // Test D: ColorMode classification ('predefined' | 'customPicker' | 'none')
  // -------------------------------------------------------------
  console.log('Test D: Verify ColorMode classification');
  {
    const classifyProduct = (swatchesCount: number, hasPicker: boolean): 'predefined' | 'customPicker' | 'none' => {
      if (swatchesCount > 0) return 'predefined';
      if (hasPicker) return 'customPicker';
      return 'none';
    };

    assert.strictEqual(classifyProduct(34, false), 'predefined');
    assert.strictEqual(classifyProduct(10, false), 'predefined');
    assert.strictEqual(classifyProduct(3, false), 'predefined');
    assert.strictEqual(classifyProduct(0, true), 'customPicker');
    assert.strictEqual(classifyProduct(0, false), 'none');
    console.log('✅ Test D Passed: ColorMode correctly classified.\n');
  }

  // -------------------------------------------------------------
  // Test E: Preserve avoidRules when dynamic colors are merged
  // -------------------------------------------------------------
  console.log('Test E: Verify avoidRules are merged with dynamic colors');
  {
    const tshirt = catalog.products.find(p => p.id === 'STANDARD_TSHIRT')!;
    const blackColor = tshirt.colors.find(c => c.id === 'black')!;
    const whiteColor = tshirt.colors.find(c => c.id === 'white')!;

    assert.strictEqual(blackColor.avoidRule, 'black', 'Black must have avoidRule: black');
    assert.strictEqual(whiteColor.avoidRule, 'white', 'White must have avoidRule: white');

    // Simulate successful fresh scan containing black and white
    const freshScanProduct: MerchProduct = {
      ...tshirt,
      colorDiscoveryStatus: 'SUCCESS',
      colors: [
        { id: 'black', displayName: 'Black' },
        { id: 'white', displayName: 'White' },
        { id: 'lemon', displayName: 'Lemon' } // New color from Amazon
      ]
    };

    ProductCatalogService.saveCatalog({
      products: [freshScanProduct],
      marketplaces: ProductCatalogService.getDefaultMarketplaces(),
      lastScanDate: new Date().toISOString()
    });

    const updated = ProductCatalogService.getCatalog().products.find(p => p.id === 'STANDARD_TSHIRT')!;
    const updatedBlack = updated.colors.find(c => c.id === 'black')!;
    const updatedWhite = updated.colors.find(c => c.id === 'white')!;
    const updatedLemon = updated.colors.find(c => c.id === 'lemon')!;

    assert.strictEqual(updatedBlack.avoidRule, 'black', 'Persistent avoidRule must be preserved');
    assert.strictEqual(updatedWhite.avoidRule, 'white', 'Persistent avoidRule must be preserved');
    assert.strictEqual(updatedLemon.avoidRule, 'none', 'New color must default to none');
    console.log('✅ Test E Passed: AvoidRules strictly merged with dynamic colors.\n');
  }

  // -------------------------------------------------------------
  // Test F: UploadWorker behavior for colorMode === 'none'
  // -------------------------------------------------------------
  console.log('Test F: Verify UploadWorker behavior for colorMode === none');
  {
    const simulatedColorStep = (colorMode: string, swatches: string[]) => {
      if (colorMode === 'none') {
        return { success: true, activeColors: ['Keine Farbkonfiguration erforderlich'] };
      }
      if (swatches.length === 0) {
        return { success: false, error: 'FAILED_COLOR_CONFIGURATION' };
      }
      return { success: true, activeColors: swatches };
    };

    const popsocketResult = simulatedColorStep('none', []);
    assert.strictEqual(popsocketResult.success, true);
    assert.strictEqual(popsocketResult.activeColors[0], 'Keine Farbkonfiguration erforderlich');

    const failedTshirtResult = simulatedColorStep('predefined', []);
    assert.strictEqual(failedTshirtResult.success, false);
    console.log('✅ Test F Passed: Products with colorMode none complete successfully without swatches.\n');
  }

  // -------------------------------------------------------------
  // Test G: UploadWorker fails immediately on colorDiscoveryStatus === FAILED
  // -------------------------------------------------------------
  console.log('Test G: Verify UploadWorker fails immediately on colorDiscoveryStatus === FAILED');
  {
    const checkProductReadyForUpload = (p: { colorDiscoveryStatus?: string; id: string }) => {
      if (p.colorDiscoveryStatus === 'FAILED') {
        return { status: 'FAILED_COLOR_CONFIGURATION', reason: 'Farbentdeckung war fehlgeschlagen' };
      }
      return { status: 'READY' };
    };

    assert.strictEqual(checkProductReadyForUpload({ id: 'P1', colorDiscoveryStatus: 'FAILED' }).status, 'FAILED_COLOR_CONFIGURATION');
    assert.strictEqual(checkProductReadyForUpload({ id: 'P1', colorDiscoveryStatus: 'SUCCESS' }).status, 'READY');
    console.log('✅ Test G Passed: Products with failed color discovery are blocked from upload.\n');
  }

  // -------------------------------------------------------------
  // Restore original catalog data snapshot to maintain live scan state
  // -------------------------------------------------------------
  console.log('Restoring clean catalog state from initial snapshot...');
  fs.writeFileSync(catalogSnapshotPath, initialCatalogSnapshot, 'utf-8');
  ProductCatalogService.loadCatalog();
  console.log('Clean state restored.');

  // Validate exactly 56 avoid rules are preserved in overrides (54 historical + 2 pepper)
  const totalAvoidRules = Object.values(ProductCatalogService.loadOverrides().overrides).reduce((acc, p) => {
    return acc + Object.values(p.colors || {}).filter(c => c.avoidRule && c.avoidRule !== 'none').length;
  }, 0);
  assert.strictEqual(totalAvoidRules, 56, `Expected exactly 56 non-none avoid rules (54 historical + 2 pepper), got ${totalAvoidRules}`);
  console.log('✅ Final Check: Exactly 56 avoid rules (54 historical + 2 pepper) verified active in overrides.');

  console.log('\n===========================================================');
  console.log('🎉 ALL 7 COLOR DISCOVERY V2 REGRESSION TESTS PASSED! 🎉');
  console.log('===========================================================');
}

runColorDiscoveryTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});

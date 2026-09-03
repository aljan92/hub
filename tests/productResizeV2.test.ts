import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  ARTWORK_VARIANT_REGISTRY,
  RESIZE_BACKGROUND_PROFILES,
  getGeneratableVariants,
  resolveBackgroundColor,
  ProductCatalogService
} from '../src/server/services/productCatalogService';
import { AssetValidationService } from '../src/server/services/assetValidationService';

console.log('====================================================');
console.log('🚀 RUNNING PRODUCT RESIZE V2 TESTS');
console.log('====================================================\n');

let passed = 0;
let total = 0;

function test(condition: boolean, name: string, detail?: any) {
  total++;
  if (condition) {
    console.log(`✅ TEST ${total}: ${name}`);
    passed++;
  } else {
    console.error(`❌ TEST ${total} FAILED: ${name}`);
    if (detail) console.error('   Detail:', JSON.stringify(detail, null, 2));
  }
}

async function runTests() {

  // ==========================================================================
  // Test Group 1: ARTWORK_VARIANT_REGISTRY structure
  // ==========================================================================
  console.log('\n--- Registry Structure ---');

  // Legacy variants preserved
  test(ARTWORK_VARIANT_REGISTRY.MASTER?.storageType === 'legacy', 'MASTER has storageType legacy');
  test(ARTWORK_VARIANT_REGISTRY.MASTER?.artifactKey === 'pngPath', 'MASTER artifactKey is pngPath');
  test(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_STANDARD?.storageType === 'legacy', 'Mug Standard is legacy');
  test(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_BRUSH?.storageType === 'legacy', 'Mug Brush is legacy');
  test(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_STANDARD?.storageType === 'legacy', 'Drinkware Standard is legacy');
  test(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_BRUSH?.storageType === 'legacy', 'Drinkware Brush is legacy');

  // New variants have productVariants storage
  const newVariantIds = [
    'CANVAS_BG_CONTAIN_4452X5292_DARK',
    'CANVAS_BG_CONTAIN_4320X5400_DARK',
    'CANVAS_BG_CONTAIN_4480X3472_DARK',
    'CANVAS_BG_CONTAIN_4500X3750_DARK'
  ];

  for (const id of newVariantIds) {
    const v = ARTWORK_VARIANT_REGISTRY[id];
    test(v != null, `${id} exists in registry`);
    test(v?.storageType === 'productVariants', `${id} has storageType productVariants`);
    test(v?.generator != null, `${id} has generator config`);
    test(v?.generator?.mode === 'CANVAS_BACKGROUND_CONTAIN', `${id} generator mode is CANVAS_BACKGROUND_CONTAIN`);
    test(v?.generator?.source === 'TRIMMED', `${id} generator source is TRIMMED`);
  }

  // No product IDs as variant IDs
  for (const id of newVariantIds) {
    test(!id.includes('BLANKET') || id.startsWith('CANVAS_BG'), `${id} does not contain raw product name as primary identifier`);
    test(!id.includes('POSTER') || id.startsWith('CANVAS_BG'), `${id} is technical, not product-based`);
  }

  // ==========================================================================
  // Test Group 2: Canvas Dimensions
  // ==========================================================================
  console.log('\n--- Canvas Dimensions ---');

  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4452X5292_DARK?.generator?.canvas.width === 4452, 'Blanket width 4452');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4452X5292_DARK?.generator?.canvas.height === 5292, 'Blanket height 5292');

  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4320X5400_DARK?.generator?.canvas.width === 4320, 'Poster width 4320');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4320X5400_DARK?.generator?.canvas.height === 5400, 'Poster height 5400');

  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4480X3472_DARK?.generator?.canvas.width === 4480, 'Laptop Sleeve width 4480');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4480X3472_DARK?.generator?.canvas.height === 3472, 'Laptop Sleeve height 3472');

  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4500X3750_DARK?.generator?.canvas.width === 4500, 'Mouse Pad width 4500');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4500X3750_DARK?.generator?.canvas.height === 3750, 'Mouse Pad height 3750');

  // Max width constraint
  for (const id of newVariantIds) {
    const w = ARTWORK_VARIANT_REGISTRY[id]?.generator?.canvas.width || 0;
    test(w <= 4500, `${id} width ${w} <= 4500 pixel budget`);
  }

  // ==========================================================================
  // Test Group 3: Padding
  // ==========================================================================
  console.log('\n--- Padding ---');

  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4452X5292_DARK?.generator?.paddingShortSidePct === 0.10, 'Blanket padding 10%');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4320X5400_DARK?.generator?.paddingShortSidePct === 0.08, 'Poster padding 8%');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4480X3472_DARK?.generator?.paddingShortSidePct === 0.08, 'Laptop Sleeve padding 8%');
  test(ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4500X3750_DARK?.generator?.paddingShortSidePct === 0.09, 'Mouse Pad padding 9%');

  // ==========================================================================
  // Test Group 4: Background Profiles
  // ==========================================================================
  console.log('\n--- Background Profiles ---');

  // Test E: Default DARK_PRODUCT
  test(RESIZE_BACKGROUND_PROFILES.DARK_PRODUCT != null, 'DARK_PRODUCT profile exists');
  test(RESIZE_BACKGROUND_PROFILES.DARK_PRODUCT?.type === 'solid', 'DARK_PRODUCT is solid');
  test((RESIZE_BACKGROUND_PROFILES.DARK_PRODUCT as any)?.color === '#4E4A46', 'DARK_PRODUCT color is #4E4A46');

  // All new variants reference DARK_PRODUCT
  for (const id of newVariantIds) {
    test(ARTWORK_VARIANT_REGISTRY[id]?.generator?.backgroundProfile === 'DARK_PRODUCT', `${id} uses DARK_PRODUCT profile`);
  }

  // Test F: resolveBackgroundColor resolves correctly
  const blanketGen = ARTWORK_VARIANT_REGISTRY.CANVAS_BG_CONTAIN_4452X5292_DARK?.generator;
  if (blanketGen) {
    test(resolveBackgroundColor(blanketGen) === '#4E4A46', 'resolveBackgroundColor resolves DARK_PRODUCT to #4E4A46');
  }

  // ==========================================================================
  // Test Group 5: getGeneratableVariants()
  // ==========================================================================
  console.log('\n--- Generable Variants ---');

  const generatable = getGeneratableVariants();
  test(generatable.length === 4, `getGeneratableVariants returns exactly 4 (got ${generatable.length})`);
  test(generatable.every(v => v.generator != null), 'All generable variants have generator configs');
  test(generatable.every(v => v.storageType === 'productVariants'), 'All generable variants use productVariants storage');
  test(generatable.every(v => v.generator!.source === 'TRIMMED'), 'All generable variants use TRIMMED source');

  // Legacy variants should NOT be in generatable list
  test(!generatable.some(v => v.id === 'MASTER'), 'MASTER is not in generatable list');
  test(!generatable.some(v => v.id === 'TWO_SIDED_MUG_STANDARD'), 'Mug Standard is not in generatable list');

  // ==========================================================================
  // Test Group 6: Product Catalog Override Integration
  // ==========================================================================
  console.log('\n--- Product Catalog Overrides ---');

  const overridesPath = path.resolve(process.cwd(), 'data/product_catalog_overrides.json');
  test(fs.existsSync(overridesPath), 'Overrides file exists');
  const overridesData = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
  const overrides = overridesData.overrides || {};

  // Test H: Product without special resize → MASTER (default)
  const stdTshirt = overrides.STANDARD_TSHIRT;
  const stdResizeEnabled = stdTshirt?.artwork?.customResizeEnabled;
  test(!stdResizeEnabled, 'Standard T-Shirt has customResizeEnabled false/undefined → MASTER');

  // Test I: Mouse Pad → CANVAS_BG_CONTAIN_4500X3750_DARK
  const mousePadOv = overrides.MOUSE_PAD;
  test(mousePadOv?.artwork?.customResizeEnabled === true, 'Mouse Pad customResizeEnabled is true');
  test(mousePadOv?.artwork?.resizeByAvoidColor?.white === 'CANVAS_BG_CONTAIN_4500X3750_DARK', 'Mouse Pad white → CANVAS_BG_CONTAIN_4500X3750_DARK');
  test(mousePadOv?.artwork?.resizeByAvoidColor?.black === 'CANVAS_BG_CONTAIN_4500X3750_DARK', 'Mouse Pad black → correct variant');
  test(mousePadOv?.artwork?.resizeByAvoidColor?.none === 'CANVAS_BG_CONTAIN_4500X3750_DARK', 'Mouse Pad none → correct variant');

  // Test J: Matte Poster → CANVAS_BG_CONTAIN_4320X5400_DARK
  const posterOv = overrides.MATTE_POSTER;
  test(posterOv?.artwork?.customResizeEnabled === true, 'Matte Poster customResizeEnabled is true');
  test(posterOv?.artwork?.resizeByAvoidColor?.none === 'CANVAS_BG_CONTAIN_4320X5400_DARK', 'Matte Poster none → correct variant');

  // Throw Blanket
  const blanketOv = overrides.THROW_BLANKET;
  test(blanketOv?.artwork?.customResizeEnabled === true, 'Throw Blanket customResizeEnabled is true');
  test(blanketOv?.artwork?.resizeByAvoidColor?.none === 'CANVAS_BG_CONTAIN_4452X5292_DARK', 'Throw Blanket none → correct variant');

  // Laptop Sleeve
  const laptopOv = overrides.LAPTOP_SLEEVE;
  test(laptopOv?.artwork?.customResizeEnabled === true, 'Laptop Sleeve customResizeEnabled is true');
  test(laptopOv?.artwork?.resizeByAvoidColor?.none === 'CANVAS_BG_CONTAIN_4480X3472_DARK', 'Laptop Sleeve none → correct variant');

  // ==========================================================================
  // Test Group 7: Upload Resolver Semantics
  // ==========================================================================
  console.log('\n--- Upload Resolver Semantics ---');

  // Simulate resolver logic
  const resolveVariant = (artworkConfig: any, avoidColor: string) => {
    if (!artworkConfig?.customResizeEnabled) return 'MASTER';
    const raw = String(avoidColor || 'none').toLowerCase();
    const key: 'white' | 'black' | 'none' =
      (raw.includes('white') || raw.includes('weiß')) ? 'white' :
      (raw.includes('black') || raw.includes('schwarz')) ? 'black' : 'none';
    return artworkConfig.resizeByAvoidColor?.[key] || 'MASTER';
  };

  // Regression: Existing Mug still works
  const mugOv = overrides.CERAMIC_MUG || overrides.MUG;
  test(resolveVariant(mugOv?.artwork, 'white') === 'TWO_SIDED_MUG_BRUSH', 'Mug white → TWO_SIDED_MUG_BRUSH (regression)');
  test(resolveVariant(mugOv?.artwork, 'none') === 'TWO_SIDED_MUG_STANDARD', 'Mug none → TWO_SIDED_MUG_STANDARD (regression)');

  // Regression: Existing Drinkware still works
  const travelOv = overrides.TRAVEL_TUMBLER;
  test(resolveVariant(travelOv?.artwork, 'white') === 'TWO_SIDED_DRINKWARE_BRUSH', 'Travel Tumbler white → TWO_SIDED_DRINKWARE_BRUSH (regression)');

  // New products resolve correctly
  test(resolveVariant(mousePadOv?.artwork, 'white') === 'CANVAS_BG_CONTAIN_4500X3750_DARK', 'Mouse Pad resolves to correct variant');
  test(resolveVariant(posterOv?.artwork, 'none') === 'CANVAS_BG_CONTAIN_4320X5400_DARK', 'Poster resolves to correct variant');
  test(resolveVariant(blanketOv?.artwork, 'black') === 'CANVAS_BG_CONTAIN_4452X5292_DARK', 'Blanket resolves to correct variant');
  test(resolveVariant(laptopOv?.artwork, 'none') === 'CANVAS_BG_CONTAIN_4480X3472_DARK', 'Laptop Sleeve resolves to correct variant');

  // storageType-based resolution
  const mousePadVariant = ARTWORK_VARIANT_REGISTRY[resolveVariant(mousePadOv?.artwork, 'none')];
  test(mousePadVariant?.storageType === 'productVariants', 'Mouse Pad variant uses productVariants storage');
  const mugVariant = ARTWORK_VARIANT_REGISTRY[resolveVariant(mugOv?.artwork, 'none')];
  test(mugVariant?.storageType === 'legacy', 'Mug variant uses legacy storage');
  test(mugVariant?.artifactKey === 'mugStandardPath', 'Mug variant artifactKey is mugStandardPath');

  // ==========================================================================
  // Test Group 8: No Product IDs in Registry or Renderer
  // ==========================================================================
  console.log('\n--- Architecture Guards ---');

  // No product IDs as variant IDs
  const productIds = ['THROW_BLANKET', 'MATTE_POSTER', 'LAPTOP_SLEEVE', 'MOUSE_PAD'];
  for (const pid of productIds) {
    test(ARTWORK_VARIANT_REGISTRY[pid] == null, `No variant with product ID "${pid}" in registry`);
  }

  // Check no product IDs in any variant generator
  const allVariants = Object.values(ARTWORK_VARIANT_REGISTRY);
  for (const v of allVariants) {
    if (v.generator) {
      for (const pid of productIds) {
        test(!v.id.includes(pid), `Variant ${v.id} does not contain product ID ${pid}`);
      }
    }
  }

  // ==========================================================================
  // Test Group 9: No resize orchestration in TaskLogService
  // ==========================================================================
  console.log('\n--- Single Resize Orchestrator ---');

  const taskLogPath = path.resolve(process.cwd(), 'src/server/services/taskLogService.ts');
  const taskLogContent = fs.readFileSync(taskLogPath, 'utf-8');
  test(!taskLogContent.includes("import { ArtworkResizeService }"), 'TaskLogService does not import ArtworkResizeService');
  test(!taskLogContent.includes('ArtworkResizeService.generateResizedArtworks'), 'TaskLogService does not call generateResizedArtworks directly');

  // Legacy resize steps still removed
  const designPipelinePath = path.resolve(process.cwd(), 'src/server/services/designPipelineService.ts');
  const updatePipelinePath = path.resolve(process.cwd(), 'src/server/services/updatePipelineService.ts');
  if (fs.existsSync(designPipelinePath)) {
    const dpContent = fs.readFileSync(designPipelinePath, 'utf-8');
    test(!dpContent.includes('stepD7_5'), 'DesignPipeline has no stepD7_5 (legacy removed)');
  }
  if (fs.existsSync(updatePipelinePath)) {
    const upContent = fs.readFileSync(updatePipelinePath, 'utf-8');
    test(!upContent.includes('stepU6_5'), 'UpdatePipeline has no stepU6_5 (legacy removed)');
  }

  // ==========================================================================
  // Test Group 10: DESIGN / UPDATE use same resize path
  // ==========================================================================
  console.log('\n--- DESIGN/UPDATE Equality ---');

  const finalizationPath = path.resolve(process.cwd(), 'src/server/services/finalizationService.ts');
  const finContent = fs.readFileSync(finalizationPath, 'utf-8');
  // Both pipelines use the same FinalizationService.finalizeForQueue
  test(finContent.includes("pipeline: 'DESIGN' | 'UPDATE'"), 'FinalizationService handles both DESIGN and UPDATE');
  test(finContent.includes('generateAllProductVariants'), 'FinalizationService calls generateAllProductVariants');
  // No separate resize logic for DESIGN vs UPDATE
  const designResizeCount = (finContent.match(/generateResizedArtworks/g) || []).length;
  test(designResizeCount === 1, `Only 1 call to generateResizedArtworks in FinalizationService (got ${designResizeCount})`);

  // ==========================================================================
  // Test Group 11: Product Catalog Overrides contain ONLY variant selection
  // ==========================================================================
  console.log('\n--- Override Structure ---');

  for (const pid of productIds) {
    const ov = overrides[pid];
    if (ov?.artwork) {
      test(ov.artwork.artworkResize == null, `${pid} override has no artworkResize config`);
      test(ov.artwork.canvas == null, `${pid} override has no canvas dimensions`);
      test(ov.artwork.paddingShortSidePct == null, `${pid} override has no padding`);
      test(ov.artwork.backgroundColor == null, `${pid} override has no background color`);
    }
  }

  // ==========================================================================
  // Test Group 12: AssetValidationService dimension checker
  // ==========================================================================
  console.log('\n--- Asset Validation ---');

  // Create a minimal but valid PNG with known dimensions for testing
  // PNG with 10x10 dimensions
  const testPng = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
    0x00, 0x00, 0x00, 0x0D, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x0A, // width = 10
    0x00, 0x00, 0x00, 0x14, // height = 20
    0x08, 0x06, 0x00, 0x00, 0x00, // depth=8, RGBA, compression, filter, interlace
    0x00, 0x00, 0x00, 0x00  // CRC placeholder
  ]);
  const testDir = path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  const testPngPath = path.join(testDir, 'test_dim_check.png');
  fs.writeFileSync(testPngPath, testPng);

  test(AssetValidationService.validateProductVariantDimensions(testPngPath, 10, 20) === true, 'Dimension check 10x20 passes');
  test(AssetValidationService.validateProductVariantDimensions(testPngPath, 20, 10) === false, 'Dimension check wrong dims fails');
  test(AssetValidationService.validateProductVariantDimensions('/nonexistent.png', 10, 20) === false, 'Dimension check nonexistent file fails');

  // Cleanup
  try { fs.unlinkSync(testPngPath); } catch {}

  // ==========================================================================
  // Test Group 13: All 9 registry entries exist
  // ==========================================================================
  console.log('\n--- Full Registry ---');

  const allIds = Object.keys(ARTWORK_VARIANT_REGISTRY);
  test(allIds.length === 9, `Registry has 9 entries (1 MASTER + 4 legacy two-sided + 4 new), got ${allIds.length}`);
  test(allIds.includes('MASTER'), 'MASTER in registry');
  test(allIds.includes('TWO_SIDED_MUG_STANDARD'), 'TWO_SIDED_MUG_STANDARD in registry');
  test(allIds.includes('TWO_SIDED_MUG_BRUSH'), 'TWO_SIDED_MUG_BRUSH in registry');
  test(allIds.includes('TWO_SIDED_DRINKWARE_STANDARD'), 'TWO_SIDED_DRINKWARE_STANDARD in registry');
  test(allIds.includes('TWO_SIDED_DRINKWARE_BRUSH'), 'TWO_SIDED_DRINKWARE_BRUSH in registry');
  for (const id of newVariantIds) {
    test(allIds.includes(id), `${id} in registry`);
  }

  // ==========================================================================
  // Results
  // ==========================================================================
  console.log('\n====================================================');
  console.log(`🏁 PRODUCT RESIZE V2 RESULTS: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

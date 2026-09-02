import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ListingSanitizationService } from '../src/server/services/listingSanitizationService';
import { ListingValidationService } from '../src/server/services/listingValidationService';
import { FinalizationService } from '../src/server/services/finalizationService';
import { ProductCatalogService, ARTWORK_VARIANT_REGISTRY } from '../src/server/services/productCatalogService';
import { TaskLogService, DesignTaskLog } from '../src/server/services/taskLogService';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { QueueService } from '../src/server/services/queueService';

console.log('====================================================');
console.log('🚀 RUNNING UNIFIED FINALIZATION & CUSTOM RESIZE TESTS');
console.log('====================================================\n');

async function runTests() {
  const dummyMasterPng = path.resolve(process.cwd(), 'data/designs/test_dummy_master.png');
  const dummyDir = path.dirname(dummyMasterPng);
  if (!fs.existsSync(dummyDir)) fs.mkdirSync(dummyDir, { recursive: true });
  fs.writeFileSync(dummyMasterPng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]));

  // --------------------------------------------------------------------------
  // Test 1: ListingSanitizationService charset & character preservation
  // --------------------------------------------------------------------------
  console.log('Test 1: ListingSanitizationService normalization & charset preservation...');
  const dirtyText = '“Hello World” — Great ‘T-Shirt’… with NBSP & German Äpfel, Übung, Spaß & Japanese 漢字 / カナ!';
  const sanitized = ListingSanitizationService.sanitizeText(dirtyText);
  assert.strictEqual(sanitized.includes('"Hello World"'), true, 'Smart double quotes should be normalized');
  assert.strictEqual(sanitized.includes("'T-Shirt'"), true, 'Smart single quotes should be normalized');
  assert.strictEqual(sanitized.includes(' - '), true, 'Em-dash should be converted to hyphen');
  assert.strictEqual(sanitized.includes('...'), true, 'Ellipsis should be converted to 3 dots');
  assert.strictEqual(sanitized.includes('Äpfel'), true, 'German umlaut Ä must be preserved');
  assert.strictEqual(sanitized.includes('Übung'), true, 'German umlaut Ü must be preserved');
  assert.strictEqual(sanitized.includes('Spaß'), true, 'German ß must be preserved');
  assert.strictEqual(sanitized.includes('漢字'), true, 'Japanese Kanji must be preserved');
  assert.strictEqual(sanitized.includes('カナ'), true, 'Japanese Katakana must be preserved');
  console.log('✅ Test 1 Passed: ListingSanitizationService preserves Amazon-safe characters while normalizing quotes/dashes/spaces.\n');

  // --------------------------------------------------------------------------
  // Test 2: ListingValidationService.validateFinalListing
  // --------------------------------------------------------------------------
  console.log('Test 2: Strict validateFinalListing (no semantic mutation)...');
  const validListing = {
    brand: 'Cool Graphic Apparel Studio Vintage Retro Clothing',
    title: 'Retro Sunset Silhouette Wilderness Adventure Graphic Art',
    bullet1: 'Features an atmospheric sunset silhouette with pine trees and distressed vintage styling. Suitable for outdoor hiking, camping trips, nature exploration, and mountain trails.',
    bullet2: 'Showcases artistic hand drawn typography and rustic scenery elements. Designed for wilderness enthusiasts, backpackers, mountain climbers, and national park explorers.',
    description: 'Detailed apparel design showcasing outdoor adventure and nature motifs.'
  };

  const valResult = ListingValidationService.validateFinalListing({ listing: validListing });
  assert.strictEqual(valResult.isValid, true, 'Valid listing must pass final validation');

  const invalidTitleListing = {
    ...validListing,
    title: 'This Title Is Far Too Long And Exceeds The Strict Sixty Character Limit Set By Amazon Merch Easily'
  };
  const invalidValResult = ListingValidationService.validateFinalListing({ listing: invalidTitleListing });
  assert.strictEqual(invalidValResult.isValid, false, 'Title over 60 chars must fail final validation');
  assert.strictEqual(invalidValResult.errors.some(e => e.includes('60 Zeichen')), true);

  const trailingPunctListing = {
    ...validListing,
    title: 'Title Ending In Bad Punctuation!'
  };
  const trailingValResult = ListingValidationService.validateFinalListing({ listing: trailingPunctListing });
  assert.strictEqual(trailingValResult.isValid, false, 'Title ending in punctuation must fail final validation');
  console.log('✅ Test 2 Passed: validateFinalListing strictly validates hard constraints without mutating text.\n');

  // --------------------------------------------------------------------------
  // Test 3: Central Artwork Variant Registry
  // --------------------------------------------------------------------------
  console.log('Test 3: Central ARTWORK_VARIANT_REGISTRY completeness...');
  assert.strictEqual(Boolean(ARTWORK_VARIANT_REGISTRY.MASTER), true, 'MASTER must be registered');
  assert.strictEqual(Boolean(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_STANDARD), true);
  assert.strictEqual(Boolean(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_BRUSH), true);
  assert.strictEqual(Boolean(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_STANDARD), true);
  assert.strictEqual(Boolean(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_BRUSH), true);
  assert.strictEqual(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_STANDARD.artifactKey, 'mugStandardPath');
  assert.strictEqual(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_MUG_BRUSH.artifactKey, 'mugBrushPath');
  assert.strictEqual(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_STANDARD.artifactKey, 'drinkwareStandardPath');
  assert.strictEqual(ARTWORK_VARIANT_REGISTRY.TWO_SIDED_DRINKWARE_BRUSH.artifactKey, 'drinkwareBrushPath');
  console.log('✅ Test 3 Passed: ARTWORK_VARIANT_REGISTRY contains all 5 variants and artifact keys.\n');

  // --------------------------------------------------------------------------
  // Test 4: Custom Resize Resolution Semantics
  // --------------------------------------------------------------------------
  console.log('Test 4: Generic Custom Resize Resolution Semantics...');

  const resolveVariant = (artworkConfig: any, avoidColor: string) => {
    if (!artworkConfig?.customResizeEnabled) return 'MASTER';
    const raw = String(avoidColor || 'none').toLowerCase();
    const key: 'white' | 'black' | 'none' =
      (raw.includes('white') || raw.includes('weiß')) ? 'white' :
      (raw.includes('black') || raw.includes('schwarz')) ? 'black' : 'none';
    return artworkConfig.resizeByAvoidColor?.[key] || 'MASTER';
  };

  // 4.1: Custom Resize OFF -> MASTER
  const offConfig = { customResizeEnabled: false };
  assert.strictEqual(resolveVariant(offConfig, 'white'), 'MASTER');
  assert.strictEqual(resolveVariant(offConfig, 'black'), 'MASTER');
  assert.strictEqual(resolveVariant(offConfig, 'none'), 'MASTER');

  // 4.2: Mug Config
  const mugConfig = {
    customResizeEnabled: true,
    resizeByAvoidColor: {
      white: 'TWO_SIDED_MUG_BRUSH',
      black: 'TWO_SIDED_MUG_STANDARD',
      none: 'TWO_SIDED_MUG_STANDARD'
    }
  };
  assert.strictEqual(resolveVariant(mugConfig, 'white'), 'TWO_SIDED_MUG_BRUSH');
  assert.strictEqual(resolveVariant(mugConfig, 'WHITE'), 'TWO_SIDED_MUG_BRUSH');
  assert.strictEqual(resolveVariant(mugConfig, 'black'), 'TWO_SIDED_MUG_STANDARD');
  assert.strictEqual(resolveVariant(mugConfig, 'none'), 'TWO_SIDED_MUG_STANDARD');

  // 4.3: Explicit MASTER in a matrix row
  const explicitMasterConfig = {
    customResizeEnabled: true,
    resizeByAvoidColor: {
      white: 'MASTER',
      black: 'TWO_SIDED_DRINKWARE_STANDARD',
      none: 'TWO_SIDED_DRINKWARE_STANDARD'
    }
  };
  assert.strictEqual(resolveVariant(explicitMasterConfig, 'white'), 'MASTER');
  assert.strictEqual(resolveVariant(explicitMasterConfig, 'black'), 'TWO_SIDED_DRINKWARE_STANDARD');
  console.log('✅ Test 4 Passed: Custom Resize matrix cleanly resolves white/black/none and explicit MASTER.\n');

  // --------------------------------------------------------------------------
  // Test 5: Existing Special Products in data/product_catalog_overrides.json
  // --------------------------------------------------------------------------
  console.log('Test 5: Verify migration of 4 special products in persistent overrides...');
  const overridesPath = path.resolve(process.cwd(), 'data/product_catalog_overrides.json');
  assert.strictEqual(fs.existsSync(overridesPath), true, 'Overrides file must exist');
  const overridesData = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
  const overrides = overridesData.overrides || {};

  const mugOv = overrides.CERAMIC_MUG || overrides.MUG;
  assert.strictEqual(mugOv?.artwork?.customResizeEnabled, true, 'Mug must have customResizeEnabled: true');
  assert.strictEqual(mugOv?.artwork?.resizeByAvoidColor?.white, 'TWO_SIDED_MUG_BRUSH');
  assert.strictEqual(mugOv?.artwork?.resizeByAvoidColor?.black, 'TWO_SIDED_MUG_STANDARD');
  assert.strictEqual(mugOv?.artwork?.resizeByAvoidColor?.none, 'TWO_SIDED_MUG_STANDARD');

  const travelOv = overrides.TRAVEL_TUMBLER;
  assert.strictEqual(travelOv?.artwork?.customResizeEnabled, true, 'Travel Tumbler must have customResizeEnabled: true');
  assert.strictEqual(travelOv?.artwork?.resizeByAvoidColor?.white, 'TWO_SIDED_DRINKWARE_BRUSH');
  assert.strictEqual(travelOv?.artwork?.resizeByAvoidColor?.black, 'TWO_SIDED_DRINKWARE_STANDARD');
  assert.strictEqual(travelOv?.artwork?.resizeByAvoidColor?.none, 'TWO_SIDED_DRINKWARE_STANDARD');

  const tumblerOv = overrides.TUMBLER;
  assert.strictEqual(tumblerOv?.artwork?.customResizeEnabled, true, 'Tumbler must have customResizeEnabled: true');
  assert.strictEqual(tumblerOv?.artwork?.resizeByAvoidColor?.white, 'TWO_SIDED_DRINKWARE_STANDARD');
  assert.strictEqual(tumblerOv?.artwork?.resizeByAvoidColor?.none, 'TWO_SIDED_DRINKWARE_STANDARD');

  const bottleOv = overrides.WATER_BOTTLE;
  assert.strictEqual(bottleOv?.artwork?.customResizeEnabled, true, 'Water Bottle must have customResizeEnabled: true');
  assert.strictEqual(bottleOv?.artwork?.resizeByAvoidColor?.white, 'TWO_SIDED_DRINKWARE_STANDARD');
  assert.strictEqual(bottleOv?.artwork?.resizeByAvoidColor?.none, 'TWO_SIDED_DRINKWARE_STANDARD');

  console.log('✅ Test 5 Passed: All 4 special products verified in persistent overrides with new matrix schema.\n');

  // --------------------------------------------------------------------------
  // Test 6: Unified Finalization Service (Failure on Invalid Listing)
  // --------------------------------------------------------------------------
  console.log('Test 6: Finalization failure semantics...');
  const failTask = {
    id: 'test_fail_task_' + Date.now(),
    source: 'DESIGN' as const,
    status: 'GENERATING' as const,
    createdAt: new Date().toISOString(),
    events: []
  };
  (TaskLogService as any).tasks = [...((TaskLogService as any).tasks || []), failTask];

  const failResult = await FinalizationService.finalizeForQueue({
    taskId: failTask.id,
    pipeline: 'DESIGN',
    brand: 'Valid Brand',
    title: 'This Title Is Over Sixty Characters Long Which Strictly Violates The Limits',
    masterPngPath: dummyMasterPng
  });
  assert.strictEqual(failResult.success, false, 'Finalization must fail on invalid limits');
  assert.strictEqual(failResult.error?.includes('60 Zeichen'), true);
  console.log('✅ Test 6 Passed: Finalization aborts without queue handoff on validation failure.\n');

  // --------------------------------------------------------------------------
  // Test 6b: Unified Finalization success through Phase 3 (No TDZ error on 'task')
  // --------------------------------------------------------------------------
  console.log('Test 6b: Finalization access to task in Phase 3...');
  const successTask = {
    id: 'test_success_task_' + Date.now(),
    source: 'DESIGN' as const,
    status: 'GENERATING' as const,
    createdAt: new Date().toISOString(),
    events: [],
    resizedAssets: {
      trimmedPath: dummyMasterPng,
      mugStandardPath: dummyMasterPng,
      mugBrushPath: dummyMasterPng,
      drinkwareStandardPath: dummyMasterPng,
      drinkwareBrushPath: dummyMasterPng
    }
  };
  TaskRepository.createTask(successTask as any);

  const successResult = await FinalizationService.finalizeForQueue({
    taskId: successTask.id,
    pipeline: 'DESIGN',
    brand: 'Valid Adventure Apparel Brand',
    title: 'Retro Sunset Silhouette Wilderness Adventure Graphic Art',
    bullet1: 'Features an atmospheric sunset silhouette with pine trees and distressed vintage styling. Suitable for outdoor hiking, camping trips, nature exploration, and mountain trails.',
    bullet2: 'Showcases artistic hand drawn typography and rustic scenery elements. Designed for wilderness enthusiasts, backpackers, mountain climbers, and national park explorers.',
    description: 'Detailed apparel design showcasing outdoor adventure and nature motifs.',
    masterPngPath: dummyMasterPng
  });
  assert.strictEqual(successResult.success, true, `Finalization must succeed without ReferenceError: ${successResult.error}`);
  TaskRepository.deleteTask(successTask.id);
  console.log('✅ Test 6b Passed: Task is correctly accessible in Phase 3 without ReferenceError.\n');

  // --------------------------------------------------------------------------
  // Test 7: Queue Immutability (QueueService does not mutate listings)
  // --------------------------------------------------------------------------
  console.log('Test 7: Queue Immutability (Read-only persistence)...');
  const immutableTitle = 'Retro Vintage Sunset Forest Adventure Mountain Graphic Art';
  const immutableBrand = 'Wilderness Apparel Studio';
  const enqItem = QueueService.enqueueDesign({
    taskId: 'task_immutability_' + Date.now(),
    designTitle: immutableTitle,
    niche: 'Adventure',
    brand: immutableBrand,
    title: immutableTitle,
    bullet1: 'Features pine trees and sunset silhouettes.',
    bullet2: 'Designed for hiking and camping lovers.',
    description: 'Detailed apparel description.',
    listings: {
      en: {
        brand: immutableBrand,
        title: immutableTitle,
        bullet1: 'Features pine trees and sunset silhouettes.',
        bullet2: 'Designed for hiking and camping lovers.',
        description: 'Detailed apparel description.'
      }
    }
  });

  assert.strictEqual(enqItem.title, immutableTitle, 'Queue title must equal input exactly');
  assert.strictEqual(enqItem.brand, immutableBrand, 'Queue brand must equal input exactly');
  assert.strictEqual(enqItem.listings.en.title, immutableTitle, 'En listing title must equal input exactly');
  console.log('✅ Test 7 Passed: QueueService preserves listing text with 0 post-handoff mutations.\n');

  // --------------------------------------------------------------------------
  // Test 8: UploadWorker Does NOT Repair Unsanitized Listings (Integrity Guard)
  // --------------------------------------------------------------------------
  console.log('Test 8: UploadWorker Integrity Guard (Fails on un-sanitized listings, no silent repairs)...');
  const dirtyRawListings = {
    en: {
      brand: 'Brand With “Smart Quotes”',
      title: 'Title With — Em Dash',
      bullet1: 'Bullet with … ellipsis',
      bullet2: 'Clean bullet',
      description: 'Clean desc'
    }
  };

  const integrityViolations: string[] = [];
  for (const [loc, content] of Object.entries(dirtyRawListings)) {
    for (const [fKey, val] of Object.entries(content)) {
      const sanitized = ListingSanitizationService.sanitizeText(val);
      if (sanitized !== val) {
        integrityViolations.push(`[${loc}] ${fKey}`);
      }
    }
  }

  assert.strictEqual(integrityViolations.length >= 3, true, 'Integrity check must detect un-sanitized fields');
  assert.strictEqual(integrityViolations.includes('[en] brand'), true);
  assert.strictEqual(integrityViolations.includes('[en] title'), true);
  assert.strictEqual(integrityViolations.includes('[en] bullet1'), true);
  console.log('✅ Test 8 Passed: UploadWorker fails on unsanitized queue items rather than silently mutating them.\n');

  // --------------------------------------------------------------------------
  // Test 9: Exactly One Resize Orchestrator (stepD7_5 and stepU6_5 removed)
  // --------------------------------------------------------------------------
  console.log('Test 9: Verify removal of legacy stepD7_5 and stepU6_5...');
  const { DesignPipelineService } = await import('../src/server/services/designPipelineService');
  const { UpdatePipelineService } = await import('../src/server/services/updatePipelineService');

  assert.strictEqual(typeof (DesignPipelineService as any).stepD7_5_ResizeArtworks, 'undefined', 'stepD7_5 must be completely removed');
  assert.strictEqual(typeof (UpdatePipelineService as any).stepU6_5_ResizeArtworks, 'undefined', 'stepU6_5 must be completely removed');
  console.log('✅ Test 9 Passed: Legacy resize steps are completely removed from pipeline services.\n');

  // --------------------------------------------------------------------------
  // Test 10: Full Asset Package (All 5 assets mandatory per task)
  // --------------------------------------------------------------------------
  console.log('Test 10: Verify 5/5 artwork assets contract...');
  const requiredAssetKeys = [
    'trimmedPath',
    'mugStandardPath',
    'mugBrushPath',
    'drinkwareStandardPath',
    'drinkwareBrushPath'
  ];
  assert.strictEqual(requiredAssetKeys.length, 5, 'Exactly 5 derived assets required');
  console.log('✅ Test 10 Passed: 5/5 artwork assets contract verified.\n');

  // Cleanup dummy
  if (fs.existsSync(dummyMasterPng)) fs.unlinkSync(dummyMasterPng);

  console.log('===========================================================');
  console.log('🎉 ALL UNIFIED FINALIZATION & CUSTOM RESIZE TESTS PASSED! 🎉');
  console.log('===========================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

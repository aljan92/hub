import fs from 'fs';
import path from 'path';

// Known initial Amazon DOM key mappings for existing 34 MBA Hub products
export const INITIAL_AMAZON_KEY_MAPPING: Record<string, string> = {
  STANDARD_TSHIRT: 'STANDARD_TSHIRT',
  VALUE_GRAPHIC_TSHIRT: 'VALUE_TSHIRT',
  PREMIUM_TSHIRT: 'PREMIUM_TSHIRT',
  COMFORT_COLORS_HEAVYWEIGHT_TSHIRT: 'COMFORT_COLORS_HEAVYWEIGHT_TSHIRT',
  VNECK_TSHIRT: 'VNECK',
  TANK_TOP: 'TANK_TOP',
  PERFORMANCE_TSHIRT: 'PERFORMANCE_TSHIRT',
  BASEBALL_JERSEY: 'BASEBALL_JERSEY',
  SOCCER_JERSEY: 'SOCCER_JERSEY',
  BASKETBALL_JERSEY: 'BASKETBALL_JERSEY',
  LONG_SLEEVE_TSHIRT: 'STANDARD_LONG_SLEEVE',
  RAGLAN: 'RAGLAN',
  SWEATSHIRT: 'STANDARD_SWEATSHIRT',
  COMFORT_COLORS_SWEATSHIRT: 'COMFORT_COLORS_SWEATSHIRT',
  COMFORT_COLORS_CROP_SWEATSHIRT: 'COMFORT_COLORS_CROP_SWEATSHIRT',
  CROP_TOP: 'CROP_TOP',
  PULLOVER_HOODIE: 'STANDARD_PULLOVER_HOODIE',
  ZIP_HOODIE: 'ZIP_HOODIE',
  PERFORMANCE_HOODIE: 'PERFORMANCE_HOODIE',
  PERFORMANCE_POLO: 'PERFORMANCE_POLO',
  PERFORMANCE_QUARTER_ZIP: 'PERFORMANCE_QUARTER_ZIP',
  BASEBALL_HAT: 'PRINTED_BASEBALL_HAT',
  TRUCKER_HAT: 'PRINTED_TRUCKER_HAT',
  SPORT_SUN_VISOR: 'VISOR',
  SPORT_BACKPACK: 'SPORT_BACKPACK',
  POPSOCKETS: 'POP_SOCKET',
  IPHONE_CASES: 'PHONE_CASE_APPLE_IPHONE',
  TOTE_BAG: 'TOTE_BAG',
  THROW_PILLOWS: 'THROW_PILLOW',
  TUMBLER: 'TUMBLER',
  CERAMIC_MUG: 'MUG',
  WATER_BOTTLE: 'WATER_BOTTLE',
  TRAVEL_TUMBLER: 'TRAVEL_TUMBLER',
  HARDCOVER_JOURNAL: 'HARDCOVER_JOURNAL'
};

export const INITIAL_KNOWN_AMAZON_KEYS: Record<string, string[]> = {
  STANDARD_TSHIRT: ['STANDARD_TSHIRT', 'STANDARD_T_SHIRT', 'TSHIRT'],
  VALUE_GRAPHIC_TSHIRT: ['VALUE_TSHIRT', 'VALUE_GRAPHIC_TSHIRT', 'VALUE_T_SHIRT'],
  PREMIUM_TSHIRT: ['PREMIUM_TSHIRT', 'PREMIUM_T_SHIRT'],
  COMFORT_COLORS_HEAVYWEIGHT_TSHIRT: ['COMFORT_COLORS_HEAVYWEIGHT_TSHIRT', 'COMFORT_COLORS'],
  VNECK_TSHIRT: ['VNECK', 'VNECK_TSHIRT', 'V_NECK'],
  TANK_TOP: ['TANK_TOP', 'TANKTOP'],
  PERFORMANCE_TSHIRT: ['PERFORMANCE_TSHIRT', 'PERFORMANCE_T_SHIRT'],
  BASEBALL_JERSEY: ['BASEBALL_JERSEY'],
  SOCCER_JERSEY: ['SOCCER_JERSEY'],
  BASKETBALL_JERSEY: ['BASKETBALL_JERSEY'],
  LONG_SLEEVE_TSHIRT: ['STANDARD_LONG_SLEEVE', 'LONG_SLEEVE_TSHIRT', 'LONG_SLEEVE'],
  RAGLAN: ['RAGLAN', 'BASEBALL_TEE'],
  SWEATSHIRT: ['STANDARD_SWEATSHIRT', 'SWEATSHIRT'],
  COMFORT_COLORS_SWEATSHIRT: ['COMFORT_COLORS_SWEATSHIRT'],
  COMFORT_COLORS_CROP_SWEATSHIRT: ['COMFORT_COLORS_CROP_SWEATSHIRT'],
  CROP_TOP: ['CROP_TOP'],
  PULLOVER_HOODIE: ['STANDARD_PULLOVER_HOODIE', 'PULLOVER_HOODIE', 'HOODIE'],
  ZIP_HOODIE: ['ZIP_HOODIE'],
  PERFORMANCE_HOODIE: ['PERFORMANCE_HOODIE'],
  PERFORMANCE_POLO: ['PERFORMANCE_POLO', 'POLO'],
  PERFORMANCE_QUARTER_ZIP: ['PERFORMANCE_QUARTER_ZIP', 'QUARTER_ZIP'],
  BASEBALL_HAT: ['PRINTED_BASEBALL_HAT', 'BASEBALL_HAT'],
  TRUCKER_HAT: ['PRINTED_TRUCKER_HAT', 'TRUCKER_HAT'],
  SPORT_SUN_VISOR: ['VISOR', 'SPORT_SUN_VISOR', 'SUN_VISOR'],
  SPORT_BACKPACK: ['SPORT_BACKPACK'],
  POPSOCKETS: ['POP_SOCKET', 'POPSOCKETS', 'POPSOCKET'],
  IPHONE_CASES: ['PHONE_CASE_APPLE_IPHONE', 'IPHONE_CASES', 'IPHONE_CASE'],
  TOTE_BAG: ['TOTE_BAG'],
  THROW_PILLOWS: ['THROW_PILLOW', 'THROW_PILLOWS', 'PILLOW'],
  TUMBLER: ['TUMBLER'],
  CERAMIC_MUG: ['MUG', 'CERAMIC_MUG'],
  WATER_BOTTLE: ['WATER_BOTTLE'],
  TRAVEL_TUMBLER: ['TRAVEL_TUMBLER', 'TRAVEL-TUMBLER'],
  HARDCOVER_JOURNAL: ['HARDCOVER_JOURNAL', 'JOURNAL']
};

export const INITIAL_ARTWORK_CONFIGS: Record<string, any> = {
  CERAMIC_MUG: {
    variants: [
      { id: 'TWO_SIDED_MUG_STANDARD', artifactKey: 'mugStandardPath' },
      { id: 'TWO_SIDED_MUG_BRUSH', artifactKey: 'mugBrushPath' }
    ],
    selectionStrategy: 'VISION_AVOID_WHITE'
  },
  TRAVEL_TUMBLER: {
    variants: [
      { id: 'TWO_SIDED_DRINKWARE_STANDARD', artifactKey: 'drinkwareStandardPath' },
      { id: 'TWO_SIDED_DRINKWARE_BRUSH', artifactKey: 'drinkwareBrushPath' }
    ],
    selectionStrategy: 'VISION_AVOID_WHITE'
  },
  TUMBLER: {
    variants: [
      { id: 'TWO_SIDED_DRINKWARE_STANDARD', artifactKey: 'drinkwareStandardPath' }
    ],
    selectionStrategy: 'ALWAYS_STANDARD'
  },
  WATER_BOTTLE: {
    variants: [
      { id: 'TWO_SIDED_DRINKWARE_STANDARD', artifactKey: 'drinkwareStandardPath' }
    ],
    selectionStrategy: 'ALWAYS_STANDARD'
  }
};

export function runMigration() {
  const dataDir = path.resolve(process.cwd(), 'data');
  const catalogPath = path.join(dataDir, 'product_catalog.json');
  const backupPath = path.join(dataDir, 'product_catalog.backup.v1.json');
  const overridesPath = path.join(dataDir, 'product_catalog_overrides.json');

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog file not found at ${catalogPath}`);
  }

  // 1. Ensure backup
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(catalogPath, backupPath);
    console.log(`✅ Backup created at ${backupPath}`);
  }

  const rawCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const products: any[] = rawCatalog.products || [];

  if (products.length !== 34) {
    throw new Error(`Expected exactly 34 products in catalog, found ${products.length}! Aborting migration.`);
  }

  // 2. Build Overrides
  const overrides: Record<string, any> = {};
  let totalNiceClasses = 0;
  let totalNonNoneAvoidRules = 0;
  let totalDroppable = 0;
  let totalSpecialArtwork = 0;

  for (const prod of products) {
    const pId = prod.id;
    const niceClass = prod.niceClass ?? null;
    if (niceClass !== null) totalNiceClasses++;

    const isDropAllowed = Boolean(prod.isDropAllowed);
    if (isDropAllowed) totalDroppable++;

    const dropPriorityOrder = prod.dropPriorityOrder;
    const uiSortOrder = prod.sortOrder;

    const colorsMap: Record<string, { avoidRule: 'none' | 'white' | 'black' }> = {};
    if (Array.isArray(prod.colors)) {
      for (const col of prod.colors) {
        const rule = col.avoidRule || 'none';
        colorsMap[col.id] = { avoidRule: rule };
        if (rule !== 'none') totalNonNoneAvoidRules++;
      }
    }

    const artworkConfig = INITIAL_ARTWORK_CONFIGS[pId] || {
      variants: [],
      selectionStrategy: 'DEFAULT_MASTER'
    };
    if (artworkConfig.selectionStrategy !== 'DEFAULT_MASTER') totalSpecialArtwork++;

    const knownKeys = INITIAL_KNOWN_AMAZON_KEYS[pId] || [INITIAL_AMAZON_KEY_MAPPING[pId] || pId];

    overrides[pId] = {
      niceClass,
      uiSortOrder,
      isDropAllowed,
      dropPriorityOrder,
      artwork: artworkConfig,
      colors: colorsMap,
      knownAmazonKeys: knownKeys
    };
  }

  // Validation Gates
  console.log('--- MIGRATION VALIDATION GATES ---');
  console.log(`Products in overrides: ${Object.keys(overrides).length} / 34`);
  console.log(`Nice Classes: ${totalNiceClasses} / 34`);
  console.log(`Non-none avoidRules: ${totalNonNoneAvoidRules} / 54`);
  console.log(`Droppable products: ${totalDroppable} / 30`);
  console.log(`Special artwork products: ${totalSpecialArtwork} / 4`);

  if (Object.keys(overrides).length !== 34) {
    throw new Error(`Validation failed: Product count mismatch (${Object.keys(overrides).length} !== 34)`);
  }
  if (totalNiceClasses !== 34) {
    throw new Error(`Validation failed: Nice class count mismatch (${totalNiceClasses} !== 34)`);
  }
  if (totalNonNoneAvoidRules !== 54) {
    throw new Error(`Validation failed: avoidRule count mismatch (${totalNonNoneAvoidRules} !== 54)`);
  }
  if (totalDroppable !== 30) {
    throw new Error(`Validation failed: droppable count mismatch (${totalDroppable} !== 30)`);
  }
  if (totalSpecialArtwork !== 4) {
    throw new Error(`Validation failed: special artwork count mismatch (${totalSpecialArtwork} !== 4)`);
  }

  const overridesPayload = {
    schemaVersion: 1,
    lastUpdated: new Date().toISOString(),
    overrides
  };

  // Atomic write of overrides
  const tmpOverridesPath = `${overridesPath}.tmp`;
  fs.writeFileSync(tmpOverridesPath, JSON.stringify(overridesPayload, null, 2), 'utf-8');
  fs.renameSync(tmpOverridesPath, overridesPath);
  console.log(`✅ ${overridesPath} written atomically!`);

  // 3. Update dynamic product_catalog.json with Amazon Identity & Lifecycle fields
  const updatedProducts = products.map(prod => {
    const amazonKey = INITIAL_AMAZON_KEY_MAPPING[prod.id] || prod.id;
    return {
      ...prod,
      available: true,
      lastSeenAt: new Date().toISOString(),
      amazonSortOrder: prod.sortOrder,
      amazon: {
        key: amazonKey,
        cardId: `${amazonKey}-card`,
        checkboxClass: amazonKey,
        sortOrder: prod.sortOrder
      }
    };
  });

  const updatedCatalog = {
    ...rawCatalog,
    products: updatedProducts
  };

  const tmpCatalogPath = `${catalogPath}.tmp`;
  fs.writeFileSync(tmpCatalogPath, JSON.stringify(updatedCatalog, null, 2), 'utf-8');
  fs.renameSync(tmpCatalogPath, catalogPath);
  console.log(`✅ ${catalogPath} updated with dynamic Amazon identity!`);

  console.log('🎉 Migration V2 successfully completed!');
}

runMigration();

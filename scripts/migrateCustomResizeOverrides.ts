import fs from 'fs';
import path from 'path';

const OVERRIDES_PATH = path.resolve(process.cwd(), 'data/product_catalog_overrides.json');
const CATALOG_PATH = path.resolve(process.cwd(), 'data/product_catalog.json');

const MIGRATION_MAPPINGS: Record<string, { white: string; black: string; none: string }> = {
  CERAMIC_MUG: {
    white: 'TWO_SIDED_MUG_BRUSH',
    black: 'TWO_SIDED_MUG_STANDARD',
    none: 'TWO_SIDED_MUG_STANDARD'
  },
  MUG: {
    white: 'TWO_SIDED_MUG_BRUSH',
    black: 'TWO_SIDED_MUG_STANDARD',
    none: 'TWO_SIDED_MUG_STANDARD'
  },
  TRAVEL_TUMBLER: {
    white: 'TWO_SIDED_DRINKWARE_BRUSH',
    black: 'TWO_SIDED_DRINKWARE_STANDARD',
    none: 'TWO_SIDED_DRINKWARE_STANDARD'
  },
  TUMBLER: {
    white: 'TWO_SIDED_DRINKWARE_STANDARD',
    black: 'TWO_SIDED_DRINKWARE_STANDARD',
    none: 'TWO_SIDED_DRINKWARE_STANDARD'
  },
  WATER_BOTTLE: {
    white: 'TWO_SIDED_DRINKWARE_STANDARD',
    black: 'TWO_SIDED_DRINKWARE_STANDARD',
    none: 'TWO_SIDED_DRINKWARE_STANDARD'
  }
};

function migrate() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    console.warn(`Overrides file not found at ${OVERRIDES_PATH}`);
    return;
  }

  const raw = fs.readFileSync(OVERRIDES_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const overrides = data.overrides || {};

  let migratedCount = 0;
  for (const [id, entry] of Object.entries<any>(overrides)) {
    const specialMapping = MIGRATION_MAPPINGS[id];
    if (specialMapping) {
      entry.artwork = {
        customResizeEnabled: true,
        resizeByAvoidColor: { ...specialMapping }
      };
      migratedCount++;
      console.log(`[Migration] Migrated ${id} to customResizeEnabled: true with matrix:`, specialMapping);
    } else {
      // Legacy or default product
      if (entry.artwork?.selectionStrategy === 'DEFAULT_MASTER' || !entry.artwork?.customResizeEnabled) {
        entry.artwork = {
          customResizeEnabled: false
        };
      }
    }
  }

  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[Migration] Successfully migrated ${migratedCount} special products in ${OVERRIDES_PATH}`);

  // Also sync to catalog if present
  if (fs.existsSync(CATALOG_PATH)) {
    try {
      const catRaw = fs.readFileSync(CATALOG_PATH, 'utf-8');
      const catData = JSON.parse(catRaw);
      if (Array.isArray(catData.products)) {
        for (const p of catData.products) {
          const ov = overrides[p.id] || overrides[p.amazon?.key];
          if (ov?.artwork) {
            p.artwork = ov.artwork;
          }
        }
        fs.writeFileSync(CATALOG_PATH, JSON.stringify(catData, null, 2), 'utf-8');
        console.log(`[Migration] Synced effective artwork config to ${CATALOG_PATH}`);
      }
    } catch (err: any) {
      console.warn(`[Migration] Failed syncing to catalog:`, err.message);
    }
  }
}

migrate();

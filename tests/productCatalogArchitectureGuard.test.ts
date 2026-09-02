import fs from 'fs';
import path from 'path';

/**
 * ARCHITECTURE GUARD: Product Catalog & Upload V2
 * 
 * Verifies that the Product Catalog, Scanner, Upload Worker, and Queue strictly adhere
 * to the single-source-of-truth invariant:
 * 
 * 1. Dynamic Amazon Data: data/product_catalog.json
 * 2. Persistent MBA Hub Overrides: data/product_catalog_overrides.json
 * 
 * No hardcoded product lists, alias cascades, KNOWN_COLORS, or Product->Attribute maps
 * are permitted in the Product Catalog and Upload runtime.
 */

interface AllowlistEntry {
  file: string;
  construct: string;
  reason: string;
  category: 'SUPABASE_SYNC_PROTECTED' | 'EXTERNAL_AMAZON_API_SCHEMA';
}

const GRANULAR_ALLOWLIST: AllowlistEntry[] = [
  {
    file: 'src/server/services/amazonInspectService.ts',
    construct: 'pVal.artworkInstructions?.POP_SOCKET',
    reason: 'Amazon Coral/ProductConfiguration API placement slot key for PopSockets',
    category: 'EXTERNAL_AMAZON_API_SCHEMA'
  }
];

// Files strictly belonging to the independent Supabase Sync Engine subsystem (protected)
const SUPABASE_SYNC_PROTECTED_FILES = [
  'src/server/services/syncEngine.ts',
  'src/server/services/settingsService.ts'
];

// Core files in scope for Product Catalog & Upload V2 Architecture
const IN_SCOPE_FILES = [
  'src/server/services/productCatalogService.ts',
  'src/server/services/productScannerService.ts',
  'src/server/services/uploadWorkerService.ts',
  'src/server/services/queueService.ts',
  'src/server/services/amazonInspectService.ts',
  'src/client/views/ProductsView.tsx',
  'src/client/views/QueueView.tsx'
];

const KNOWN_HISTORICAL_PRODUCT_IDS = [
  'STANDARD_TSHIRT',
  'VALUE_GRAPHIC_TSHIRT',
  'PREMIUM_TSHIRT',
  'VNECK_TSHIRT',
  'LONG_SLEEVE_TSHIRT',
  'SWEATSHIRT',
  'PULLOVER_HOODIE',
  'CERAMIC_MUG',
  'POPSOCKETS',
  'IPHONE_CASES',
  'THROW_PILLOWS',
  'SPORT_SUN_VISOR',
  'BASEBALL_HAT',
  'TRUCKER_HAT',
  'TRAVEL_TUMBLER',
  'WATER_BOTTLE',
  'RAGLAN',
  'TANK_TOP',
  'PERFORMANCE_TSHIRT',
  'BASEBALL_JERSEY',
  'SOCCER_JERSEY',
  'BASKETBALL_JERSEY',
  'CROP_TOP',
  'ZIP_HOODIE',
  'PERFORMANCE_HOODIE',
  'PERFORMANCE_POLO',
  'PERFORMANCE_QUARTER_ZIP',
  'SPORT_BACKPACK',
  'TOTE_BAG',
  'LAPTOP_SLEEVE',
  'MOUSE_PAD',
  'THROW_BLANKET',
  'MATTE_POSTER',
  'TUMBLER',
  'HARDCOVER_JOURNAL'
];

function runGuard() {
  console.log('====================================================');
  console.log('🛡️ RUNNING PRODUCT CATALOG V2 ARCHITECTURE GUARD');
  console.log('====================================================\n');

  let violationsCount = 0;

  for (const relPath of IN_SCOPE_FILES) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️ File not found, skipping: ${relPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    // 1. Check for KNOWN_COLORS
    if (content.includes('KNOWN_COLORS')) {
      console.error(`❌ [VIOLATION] ${relPath}: KNOWN_COLORS hardcoded map detected!`);
      violationsCount++;
    }

    // 2. Check for getAliases
    if (content.includes('getAliases(')) {
      console.error(`❌ [VIOLATION] ${relPath}: getAliases legacy alias map detected!`);
      violationsCount++;
    }

    // 3. Check for inferNiceClass
    if (content.includes('inferNiceClass')) {
      console.error(`❌ [VIOLATION] ${relPath}: inferNiceClass hardcoded class inferer detected!`);
      violationsCount++;
    }

    // 4. Check for knownAmazonKeys in runtime
    if (content.includes('knownAmazonKeys')) {
      console.error(`❌ [VIOLATION] ${relPath}: knownAmazonKeys legacy alias property detected!`);
      violationsCount++;
    }

    // 5. Line-by-line checks for concrete product ID branches or lists
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();

      // Check allowlist
      const isAllowlisted = GRANULAR_ALLOWLIST.some(al => 
        al.file === relPath && trimmed.includes(al.construct)
      );
      if (isAllowlisted) return;

      // Skip pure comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }

      for (const prodId of KNOWN_HISTORICAL_PRODUCT_IDS) {
        if (line.includes(prodId)) {
          // Check if it is a branch condition
          if (trimmed.startsWith('if (') || trimmed.startsWith('case ') || trimmed.startsWith('switch ') || trimmed.includes(`=== '${prodId}'`) || trimmed.includes(`=== "${prodId}"`)) {
            console.error(`❌ [VIOLATION] ${relPath}:${lineNum}: Concrete product branching on ${prodId}!`);
            console.error(`    Code: ${trimmed}`);
            violationsCount++;
          }
          // Check if it is inside an array declaration
          if ((trimmed.includes(`['${prodId}'`) || trimmed.includes(`["${prodId}"`) || trimmed.includes(`'${prodId}',`)) && !trimmed.includes('type') && !trimmed.includes('interface')) {
            console.error(`❌ [VIOLATION] ${relPath}:${lineNum}: Hardcoded product array containing ${prodId}!`);
            console.error(`    Code: ${trimmed}`);
            violationsCount++;
          }
        }
      }
    });
  }

  console.log('--- Granular Allowlist Summary ---');
  GRANULAR_ALLOWLIST.forEach(entry => {
    console.log(`✅ [ALLOWLISTED] [${entry.category}] ${entry.file}: "${entry.construct}" (${entry.reason})`);
  });

  console.log('\n--- Protected Subsystems Summary ---');
  SUPABASE_SYNC_PROTECTED_FILES.forEach(file => {
    console.log(`🔒 [SUPABASE_SYNC_PROTECTED] ${file} (Strictly isolated from Product Catalog rules)`);
  });

  console.log('\n====================================================');
  if (violationsCount === 0) {
    console.log('🎉 ARCHITECTURE GUARD PASSED: 0 VIOLATIONS FOUND!');
    console.log('====================================================\n');
  } else {
    console.error(`💥 ARCHITECTURE GUARD FAILED: ${violationsCount} VIOLATIONS DETECTED!`);
    console.log('====================================================\n');
    process.exit(1);
  }
}

runGuard();

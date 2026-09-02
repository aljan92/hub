import fs from 'fs';
import path from 'path';

export type ColorMode = 'predefined' | 'customPicker' | 'none' | 'failed';

export interface MerchColorDef {
  id: string;          // e.g. "dark_heather"
  displayName: string; // e.g. "Dark Heather"
  amazonIdentifier?: string; // e.g. "dark_heather_swatch"
  domIdentifier?: string;    // e.g. "flowcheckbox-dark_heather"
  hexPreview?: string; // e.g. "#3A3D40"
  avoidRule?: 'none' | 'white' | 'black'; // 'none' (default) | 'white' (avoid on white) | 'black' (avoid on black)
}

export interface MerchFitTypeDef {
  id: string;          // e.g. "men", "women", "youth", "girls"
  displayName: string; // e.g. "Men", "Women"
  amazonIdentifier?: string;
  domIdentifier?: string;
}

export interface MerchMarketplace {
  id: string;          // e.g. "US", "GB", "DE", "FR", "IT", "ES", "JP"
  displayName: string; // e.g. ".com", ".co.uk", ".de"
  defaultPrice: string;// e.g. "19.99"
}

export interface ProductAmazonIdentity {
  key: string;              // Dynamic Amazon productType e.g. "MUG", "STANDARD_LONG_SLEEVE"
  cardId: string;           // Dynamic card container ID e.g. "MUG-card"
  checkboxClass: string;    // Dynamic modal checkbox class prefix e.g. "MUG"
  sortOrder: number;        // Dynamic row index in "Select Products" modal
}

export interface ProductArtworkVariantConfig {
  id: string;               // e.g. "TWO_SIDED_MUG_STANDARD", "TWO_SIDED_MUG_BRUSH"
  artifactKey: 'trimmedPath' | 'mugStandardPath' | 'mugBrushPath' | 'drinkwareStandardPath' | 'drinkwareBrushPath';
}

export interface ProductArtworkConfig {
  variants: ProductArtworkVariantConfig[];
  selectionStrategy: 'DEFAULT_MASTER' | 'VISION_AVOID_WHITE' | 'ALWAYS_STANDARD';
}

export interface ProductOverride {
  niceClass: number | null;
  uiSortOrder?: number;
  isDropAllowed?: boolean;
  dropPriorityOrder?: number;
  artwork?: ProductArtworkConfig;
  colors?: Record<string, { avoidRule: 'none' | 'white' | 'black' }>;
}

export interface ProductOverridesData {
  schemaVersion: number;
  lastUpdated: string;
  overrides: Record<string, ProductOverride>;
}

export interface MerchProduct {
  id: string;                          // Stable MBA Hub ID, e.g. "STANDARD_TSHIRT", "CERAMIC_MUG"
  displayName: string;                 // Human-readable name, e.g. "Standard t-shirt"
  niceClass?: number | null;           // Nice Trademark Class (25, 18, 20, 21, 9, 16) or null
  colorMode: ColorMode;                // 'predefined', 'customPicker', or 'none'
  colorDiscoveryStatus?: 'SUCCESS' | 'FAILED'; // Status of color discovery for this product
  colors: MerchColorDef[];             // Available swatches
  fitTypes: MerchFitTypeDef[];         // Available fit types
  availableMarketplaces: string[];     // Marketplace IDs, e.g. ["US", "GB", "DE", "FR", "IT", "ES", "JP"]
  sortOrder: number;                   // UI Display order for MBA Hub menus
  amazonSortOrder?: number;            // Dynamic Amazon row order (0, 1, 2...) for UploadWorker
  amazon?: ProductAmazonIdentity;      // Dynamic Amazon DOM identity
  artwork?: ProductArtworkConfig;      // Special artwork capabilities & selection strategy
  available?: boolean;                 // Soft delete flag (true = active, false = temporarily unlisted by Amazon)
  lastSeenAt?: string;                 // ISO date when Amazon last confirmed this product
  presetHexColors?: string[];          // Preset hex values for custom picker
  lastUpdated: string;                 // ISO date string
  isDropAllowed?: boolean;             // Whether this product can be dropped during slot shortage
  dropPriorityOrder?: number;          // Order for drop cascade (1 = drop first, 2 = drop second, etc.)
}

export interface ProductCatalogData {
  products: MerchProduct[];
  marketplaces: MerchMarketplace[];
  lastScanDate: string | null;
  schemaVersion: number;
}

export interface ProductCatalogStats {
  totalProducts: number;
  totalSlots: number;
  totalMarketplaces: number;
  lastScanDate: string | null;
}

// Well-known Merch by Amazon swatch color hex mappings for rich visual rendering
export const MERCH_COLOR_HEX_MAP: Record<string, string> = {
  black: '#121212',
  white: '#FFFFFF',
  asphalt: '#383E42',
  navy: '#131E2E',
  dark_heather: '#3A3D40',
  heather_grey: '#A8A9AD',
  heather_blue: '#4A6B82',
  royal: '#1B4D89',
  baby_blue: '#8CB4D9',
  grass: '#3E8E41',
  kelly_green: '#1E792E',
  dark_green: '#1A3828',
  olive: '#4D4E32',
  olive_heather: '#4D543B',
  red: '#B81D24',
  cranberry: '#7D1A2B',
  burgundy: '#5B1E28',
  red_heather: '#873238',
  pink: '#E88B9E',
  light_pink: '#F4C2C2',
  pink_heather: '#C28490',
  purple: '#4B2E83',
  light_purple: '#B399D4',
  purple_heather: '#6B4C72',
  lemon: '#F4E04D',
  golden_yellow: '#F5A623',
  orange: '#E65100',
  brown: '#4E3629',
  silver: '#C0C0C0',
  slate: '#5C6F84',
  sapphire: '#0F52BA',
  ivory: '#FFFFF0',
  light_beige: '#F5F5DC',
  mint_green: '#98FF98',
  deep_blue: '#0B2265',
  plum: '#4D1F3D',
  raspberry_red: '#911736',
  forest: '#1E3F20',
  forest_green: '#1E3F20',
  tan: '#D2B48C',
  storm: '#4F5B66',
  mauve: '#915F6D',
  grey: '#808080',
  dark_grey: '#333333',
  neon_pink: '#FF1493',
  black_athletic_heather: '#2B2B2B',
  black_white: '#222222',
  dark_heather_white: '#3A3D40',
  navy_athletic_heather: '#1A2738',
  navy_white: '#131E2E',
  red_white: '#B81D24',
  royal_blue_white: '#1B4D89',
  blue_white: '#1B4D89',
  pink_white: '#E88B9E',
  yellow_white: '#F4E04D',
  orange_white: '#E65100',
  brushed_steel: '#A2AAB0',
  light_blue: '#8CB4D9',
  dusty_blue: '#5C768D',
  sage_green: '#879B86',
  bright_pink: '#FF4081',
  blue_tie_dye: '#2E5B88',
  grey_tie_dye: '#6E7074',
  purple_tie_dye: '#5B3B70',
  fern_tie_dye: '#3D5E43',
  umber_tie_dye: '#5A3E31'
};

export class ProductCatalogService {
  private static catalogFilePath = path.resolve(process.cwd(), 'data', 'product_catalog.json');
  private static overridesFilePath = path.resolve(process.cwd(), 'data', 'product_catalog_overrides.json');

  private static catalogData: ProductCatalogData = {
    products: [],
    marketplaces: [],
    lastScanDate: null,
    schemaVersion: 1
  };

  private static overridesData: ProductOverridesData = {
    schemaVersion: 1,
    lastUpdated: new Date().toISOString(),
    overrides: {}
  };

  private static isLoaded = false;

  public static ensureLoaded(): void {
    if (this.isLoaded) return;
    this.loadOverrides();
    this.loadCatalog();
    this.isLoaded = true;
  }

  /**
   * Save overrides atomically: .tmp file -> JSON validate -> renameSync
   */
  public static saveOverridesAtomic(data: ProductOverridesData): void {
    try {
      const dataDir = path.dirname(this.overridesFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      data.lastUpdated = new Date().toISOString();
      const tmpPath = `${this.overridesFilePath}.tmp`;
      const jsonStr = JSON.stringify(data, null, 2);
      
      // Strict integrity check before replacing
      JSON.parse(jsonStr);

      fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
      fs.renameSync(tmpPath, this.overridesFilePath);
      this.overridesData = data;
    } catch (err: any) {
      console.error('[ProductCatalogService] Failed to save product_catalog_overrides.json atomically:', err.message);
      throw err;
    }
  }

  /**
   * Load overrides from data/product_catalog_overrides.json
   */
  public static loadOverrides(): ProductOverridesData {
    try {
      if (fs.existsSync(this.overridesFilePath)) {
        const raw = fs.readFileSync(this.overridesFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.overrides === 'object') {
          this.overridesData = parsed;
          return this.overridesData;
        }
      }
    } catch (err: any) {
      console.error('[ProductCatalogService] Failed to load product_catalog_overrides.json:', err.message);
    }

    this.overridesData = {
      schemaVersion: 1,
      lastUpdated: new Date().toISOString(),
      overrides: {}
    };
    return this.overridesData;
  }

  /**
   * Save catalog data atomically to data/product_catalog.json
   */
  public static saveCatalogAtomic(data: ProductCatalogData): void {
    try {
      const dataDir = path.dirname(this.catalogFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const tmpPath = `${this.catalogFilePath}.tmp`;
      const jsonStr = JSON.stringify(data, null, 2);
      JSON.parse(jsonStr);

      fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
      fs.renameSync(tmpPath, this.catalogFilePath);
      this.catalogData = data;
    } catch (err: any) {
      console.error('[ProductCatalogService] Failed to save product_catalog.json atomically:', err.message);
      throw err;
    }
  }

  /**
   * Load catalog data from ./data/product_catalog.json
   */
  public static loadCatalog(): ProductCatalogData {
    try {
      if (fs.existsSync(this.catalogFilePath)) {
        const raw = fs.readFileSync(this.catalogFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.products)) {
          this.catalogData = {
            products: parsed.products,
            marketplaces: parsed.marketplaces || this.getDefaultMarketplaces(),
            lastScanDate: parsed.lastScanDate || null,
            schemaVersion: parsed.schemaVersion || 1
          };
          this.enrichColorsWithHex();
          return this.catalogData;
        }
      }
    } catch (err: any) {
      console.error('[ProductCatalogService] Failed to load product_catalog.json:', err.message);
    }

    this.catalogData = {
      products: [],
      marketplaces: this.getDefaultMarketplaces(),
      lastScanDate: null,
      schemaVersion: 1
    };
    return this.catalogData;
  }

  /**
   * Helper to look up an override entry by stable ID or by matching dynamic catalog product
   */
  public static getOverrideEntry(productId: string, amazonKey?: string): { key: string; override: ProductOverride } | null {
    this.ensureLoaded();
    const overrides = this.overridesData.overrides || {};
    if (overrides[productId]) {
      return { key: productId, override: overrides[productId] };
    }
    const cleanId = String(productId || '').trim().toUpperCase();
    const cleanKey = amazonKey ? String(amazonKey).trim().toUpperCase() : undefined;
    const prod = this.catalogData.products.find(p => 
      p.id.toUpperCase() === cleanId || 
      p.amazon?.key?.toUpperCase() === cleanId ||
      (cleanKey && p.amazon?.key?.toUpperCase() === cleanKey)
    );
    if (prod && overrides[prod.id]) {
      return { key: prod.id, override: overrides[prod.id] };
    }
    return null;
  }

  /**
   * Dynamic lookup: find product by Amazon DOM key or stable ID
   */
  public static findProductByAmazonKey(key: string): MerchProduct | undefined {
    this.ensureLoaded();
    const clean = String(key || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
    const compact = clean.replace(/_/g, '');
    return this.catalogData.products.find(p => {
      const pId = p.id.toUpperCase();
      const pKey = (p.amazon?.key || '').toUpperCase();
      if (pId === clean || pKey === clean) return true;
      if (pId.replace(/_/g, '') === compact || pKey.replace(/_/g, '') === compact) return true;
      if (pId.replace(/_/g, '').replace(/S$/, '') === compact.replace(/S$/, '') || pKey.replace(/_/g, '').replace(/S$/, '') === compact.replace(/S$/, '')) return true;
      if (clean === 'TRAVEL_MUG' && (pId === 'TRAVEL_TUMBLER' || pKey === 'TRAVEL_TUMBLER')) return true;
      return false;
    });
  }

  /**
   * Get merged catalog: Amazon dynamic data + persistent MBA Hub overrides
   */
  public static getCatalog(): ProductCatalogData {
    this.ensureLoaded();

    const mergedProducts: MerchProduct[] = this.catalogData.products.map(prod => {
      const matched = this.getOverrideEntry(prod.id, prod.amazon?.key);
      const override = matched?.override;
      const isAvailable = prod.available !== false;
      const amazonKey = prod.amazon?.key || prod.id;
      const amazonSort = prod.amazonSortOrder ?? prod.amazon?.sortOrder ?? prod.sortOrder ?? 999;
      const uiSort = override?.uiSortOrder ?? prod.sortOrder ?? amazonSort;

      // Merge colors with persistent avoidRules
      const mergedColors = (prod.colors || []).map(col => {
        const colorOverride = override?.colors?.[col.id];
        return {
          ...col,
          avoidRule: colorOverride?.avoidRule ?? col.avoidRule ?? 'none'
        };
      });

      const artwork = override?.artwork ?? prod.artwork ?? {
        variants: [],
        selectionStrategy: 'DEFAULT_MASTER'
      };

      return {
        ...prod,
        available: isAvailable,
        niceClass: override?.niceClass !== undefined ? override.niceClass : (prod.niceClass ?? null),
        sortOrder: uiSort,
        amazonSortOrder: amazonSort,
        isDropAllowed: override?.isDropAllowed ?? prod.isDropAllowed ?? false,
        dropPriorityOrder: override?.dropPriorityOrder ?? prod.dropPriorityOrder,
        colors: mergedColors,
        artwork,
        amazon: prod.amazon || {
          key: amazonKey,
          cardId: `${amazonKey}-card`,
          checkboxClass: amazonKey,
          sortOrder: amazonSort
        }
      };
    });

    return {
      ...this.catalogData,
      products: mergedProducts
    };
  }

  /**
   * Save catalog data from scanner or update operations.
   * Merges scanned products with existing products and persistent overrides.
   */
  public static saveCatalog(data: Partial<ProductCatalogData>): ProductCatalogData {
    this.ensureLoaded();
    const nowIso = new Date().toISOString();

    if (data.products !== undefined) {
      const existingProds = [...this.catalogData.products];
      const overrides = this.overridesData.overrides || {};

      // Match each incoming product against existing catalog
      const matchedExistingIds = new Set<string>();

      const updatedProducts: MerchProduct[] = [];

      for (const scanned of data.products) {
        const scannedAmazonKey = scanned.amazon?.key || scanned.id;

        // 1. Try to find existing product by amazon.key or id
        let matched = existingProds.find(p => {
          if (p.amazon?.key === scannedAmazonKey) return true;
          return p.id === scannedAmazonKey;
        });

        if (matched) {
          matchedExistingIds.add(matched.id);

          // Check if color scan was valid for this product
          const isColorScanValid = scanned.colorDiscoveryStatus !== 'FAILED' && scanned.colorMode !== 'failed';
          const isSuspectEmptyColor = (scanned.colorMode === 'predefined' && (!scanned.colors || scanned.colors.length === 0) && (matched.colors || []).length > 0);

          let mergedColors: MerchColorDef[] = [];
          let mergedColorMode: ColorMode = scanned.colorMode || matched.colorMode;
          let colorDiscoveryStatus: 'SUCCESS' | 'FAILED' = isColorScanValid ? 'SUCCESS' : 'FAILED';

          if (!isColorScanValid || isSuspectEmptyColor) {
            // PROTECT PREVIOUS VALID DATA: Keep existing colors and colorMode
            console.log(`[ProductCatalogService] 🛡️ Retaining existing colors for ${matched.id} (${(matched.colors || []).length} colors) due to incomplete color scan`);
            mergedColors = matched.colors || [];
            mergedColorMode = matched.colorMode;
            colorDiscoveryStatus = !isColorScanValid ? 'FAILED' : 'SUCCESS';
          } else if (scanned.colorMode === 'customPicker' || scanned.colorMode === 'none') {
            mergedColors = [];
            mergedColorMode = scanned.colorMode;
          } else {
            // Update dynamic fields while merging with persistent avoidRules
            const productOverrides = overrides[matched.id]?.colors || {};
            mergedColors = (scanned.colors || []).map(sc => {
              const rule = productOverrides[sc.id]?.avoidRule ?? 'none';
              return {
                ...sc,
                avoidRule: rule
              };
            });
            mergedColorMode = 'predefined';
          }

          const amazonSort = scanned.amazonSortOrder ?? scanned.amazon?.sortOrder ?? matched.amazonSortOrder ?? matched.sortOrder;

          updatedProducts.push({
            ...matched,
            displayName: scanned.displayName || matched.displayName,
            available: true,
            lastSeenAt: nowIso,
            colorMode: mergedColorMode,
            colorDiscoveryStatus,
            colors: mergedColors,
            fitTypes: scanned.fitTypes && scanned.fitTypes.length > 0 ? scanned.fitTypes : matched.fitTypes,
            availableMarketplaces: scanned.availableMarketplaces && scanned.availableMarketplaces.length > 0 ? scanned.availableMarketplaces : matched.availableMarketplaces,
            amazonSortOrder: amazonSort,
            amazon: scanned.amazon || {
              key: scannedAmazonKey,
              cardId: `${scannedAmazonKey}-card`,
              checkboxClass: scannedAmazonKey,
              sortOrder: amazonSort
            },
            presetHexColors: scanned.presetHexColors || matched.presetHexColors,
            lastUpdated: nowIso
          });
        } else {
          // Brand NEW product detected by Amazon!
          const newStableId = scanned.id || scannedAmazonKey;
          const amazonSort = scanned.amazonSortOrder ?? scanned.amazon?.sortOrder ?? updatedProducts.length;
          const isColorScanValid = scanned.colorDiscoveryStatus !== 'FAILED';
          
          console.log(`[ProductCatalogService] 🌟 New Amazon Product detected: ${newStableId} (${scannedAmazonKey})`);

          // Ensure override exists with niceClass: null
          if (!overrides[newStableId]) {
            overrides[newStableId] = {
              niceClass: null,
              uiSortOrder: updatedProducts.length + 1,
              isDropAllowed: false,
              artwork: {
                variants: [],
                selectionStrategy: 'DEFAULT_MASTER'
              },
              colors: {}
            };
            this.saveOverridesAtomic(this.overridesData);
          }

          updatedProducts.push({
            id: newStableId,
            displayName: scanned.displayName || newStableId.replace(/_/g, ' '),
            available: true,
            lastSeenAt: nowIso,
            niceClass: null,
            colorMode: scanned.colorMode || (scanned.colors && scanned.colors.length > 0 ? 'predefined' : 'none'),
            colorDiscoveryStatus: isColorScanValid ? 'SUCCESS' : 'FAILED',
            colors: (scanned.colors || []).map(c => ({ ...c, avoidRule: 'none' })),
            fitTypes: scanned.fitTypes || [],
            availableMarketplaces: scanned.availableMarketplaces || ['US'],
            sortOrder: overrides[newStableId]?.uiSortOrder ?? (updatedProducts.length + 1),
            amazonSortOrder: amazonSort,
            amazon: scanned.amazon || {
              key: scannedAmazonKey,
              cardId: `${scannedAmazonKey}-card`,
              checkboxClass: scannedAmazonKey,
              sortOrder: amazonSort
            },
            artwork: {
              variants: [],
              selectionStrategy: 'DEFAULT_MASTER'
            },
            presetHexColors: scanned.presetHexColors,
            lastUpdated: nowIso,
            isDropAllowed: false
          });
        }
      }

      // Soft-delete products not seen in current scan: KEEP them, set available = false!
      for (const exist of existingProds) {
        if (!matchedExistingIds.has(exist.id)) {
          console.log(`[ProductCatalogService] ⚠️ Product ${exist.id} not in current scan. Soft-deleting (available = false).`);
          updatedProducts.push({
            ...exist,
            available: false
          });
        }
      }

      this.catalogData.products = updatedProducts;
    }

    if (data.marketplaces !== undefined) {
      this.catalogData.marketplaces = data.marketplaces;
    }
    if (data.lastScanDate !== undefined) {
      this.catalogData.lastScanDate = data.lastScanDate;
    }

    this.enrichColorsWithHex();
    this.saveCatalogAtomic(this.catalogData);
    return this.getCatalog();
  }

  /**
   * Clear dynamic catalog cache. Overrides are NEVER deleted!
   */
  public static clearCatalog(): ProductCatalogData {
    this.ensureLoaded();
    this.catalogData = {
      products: [],
      marketplaces: this.getDefaultMarketplaces(),
      lastScanDate: null,
      schemaVersion: 1
    };

    this.saveCatalogAtomic(this.catalogData);
    console.log('[ProductCatalogService] Cleared dynamic product catalog (overrides preserved)');
    return this.getCatalog();
  }

  /**
   * Get single product by stable ID
   */
  public static getProduct(id: string): MerchProduct | undefined {
    return this.getCatalog().products.find(p => p.id === id);
  }

  /**
   * Look up a single product by ID (alias for getProduct)
   */
  public static getProductById(id: string): MerchProduct | undefined {
    return this.getProduct(id);
  }

  /**
   * Get all products belonging to a specific Nice Trademark Class (e.g. 25, 9, 18, 20, 21, 16)
   */
  public static getProductsByNiceClass(niceClass: number): MerchProduct[] {
    return this.getCatalog().products.filter(p => p.niceClass === niceClass);
  }

  /**
   * Get product IDs that should be blocked for a set of Nice Trademark Classes
   */
  public static getBlockedProductIdsForNiceClasses(blockedClasses: number[]): string[] {
    if (!blockedClasses || blockedClasses.length === 0) return [];
    const blockedSet = new Set(blockedClasses);
    return this.getCatalog().products
      .filter(p => p.niceClass !== null && p.niceClass !== undefined && blockedSet.has(p.niceClass))
      .map(p => p.id);
  }

  /**
   * Update nice class for a single product (saved to persistent overrides)
   */
  public static updateProductNiceClass(id: string, niceClass: number | null): ProductCatalogData {
    this.ensureLoaded();
    const found = this.getOverrideEntry(id);
    const targetKey = found ? found.key : id;

    if (!this.overridesData.overrides[targetKey]) {
      this.overridesData.overrides[targetKey] = {
        niceClass,
        uiSortOrder: 999,
        isDropAllowed: false,
        colors: {}
      };
    } else {
      this.overridesData.overrides[targetKey].niceClass = niceClass;
    }

    this.saveOverridesAtomic(this.overridesData);
    const catalog = this.getCatalog();
    this.saveCatalogAtomic(catalog);
    return catalog;
  }

  /**
   * Update avoid rule for a specific color of a product (saved to persistent overrides)
   */
  public static updateProductColorAvoidRule(productId: string, colorId: string, avoidRule: 'none' | 'white' | 'black'): ProductCatalogData {
    this.ensureLoaded();
    const found = this.getOverrideEntry(productId);
    const targetKey = found ? found.key : productId;

    if (!this.overridesData.overrides[targetKey]) {
      this.overridesData.overrides[targetKey] = {
        niceClass: null,
        uiSortOrder: 999,
        isDropAllowed: false,
        colors: {}
      };
    }
    if (!this.overridesData.overrides[targetKey].colors) {
      this.overridesData.overrides[targetKey].colors = {};
    }
    this.overridesData.overrides[targetKey].colors![colorId] = { avoidRule };

    this.saveOverridesAtomic(this.overridesData);
    const catalog = this.getCatalog();
    this.saveCatalogAtomic(catalog);
    return catalog;
  }

  /**
   * Update drop configuration (isDropAllowed, dropPriorityOrder) for products (saved to persistent overrides)
   */
  public static updateDropConfig(configs: Array<{ id: string; isDropAllowed: boolean; dropPriorityOrder: number }>): ProductCatalogData {
    this.ensureLoaded();
    for (const conf of configs) {
      const found = this.getOverrideEntry(conf.id);
      const targetKey = found ? found.key : conf.id;

      if (!this.overridesData.overrides[targetKey]) {
        this.overridesData.overrides[targetKey] = {
          niceClass: null,
          uiSortOrder: 999,
          isDropAllowed: conf.isDropAllowed,
          dropPriorityOrder: conf.dropPriorityOrder,
          colors: {}
        };
      } else {
        this.overridesData.overrides[targetKey].isDropAllowed = conf.isDropAllowed;
        this.overridesData.overrides[targetKey].dropPriorityOrder = conf.dropPriorityOrder;
      }
    }

    this.saveOverridesAtomic(this.overridesData);
    const catalog = this.getCatalog();
    this.saveCatalogAtomic(catalog);
    return catalog;
  }

  /**
   * Get all active products allowed to be dropped, ordered by user priority
   */
  public static getDroppableProductsOrdered(): MerchProduct[] {
    const catalog = this.getCatalog();
    return catalog.products
      .filter(p => p.available !== false && p.isDropAllowed === true)
      .sort((a, b) => {
        const orderA = a.dropPriorityOrder ?? 99;
        const orderB = b.dropPriorityOrder ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.sortOrder - b.sortOrder;
      });
  }

  /**
   * Calculate how many non-US slots can be dropped across all droppable products
   */
  public static calculateMaxDroppableSlotsCount(): number {
    const droppables = this.getDroppableProductsOrdered();
    let count = 0;
    for (const prod of droppables) {
      if (prod.available === false) continue;
      const nonUsMarketplaces = (prod.availableMarketplaces || []).filter(mp => mp.toUpperCase() !== 'US');
      count += nonUsMarketplaces.length;
    }
    return count;
  }

  public static getMaxDroppableSlots(): number {
    return this.calculateMaxDroppableSlotsCount();
  }

  public static getTotalBaseSlotsCount(): number {
    const catalog = this.getCatalog();
    let count = 0;
    for (const prod of catalog.products) {
      if (prod.available === false) continue;
      count += (prod.availableMarketplaces || []).length;
    }
    return count;
  }

  /**
   * Enrich color objects with hex preview codes
   */
  private static enrichColorsWithHex() {
    for (const prod of this.catalogData.products) {
      if (Array.isArray(prod.colors)) {
        for (const col of prod.colors) {
          const cleanId = col.id.toLowerCase().replace(/-/g, '_');
          col.hexPreview = MERCH_COLOR_HEX_MAP[cleanId] || '#718096';
        }
      }
    }
  }

  public static getStats(): ProductCatalogStats {
    const catalog = this.getCatalog();
    const activeProducts = catalog.products.filter(p => p.available !== false);
    return {
      totalProducts: activeProducts.length,
      totalSlots: this.getTotalBaseSlotsCount(),
      totalMarketplaces: catalog.marketplaces.length,
      lastScanDate: catalog.lastScanDate
    };
  }

  /**
   * Default Merch by Amazon Marketplaces
   */
  public static getDefaultMarketplaces(): MerchMarketplace[] {
    return [
      { id: 'US', displayName: '.com', defaultPrice: '19.99' },
      { id: 'GB', displayName: '.co.uk', defaultPrice: '16.99' },
      { id: 'DE', displayName: '.de', defaultPrice: '17.49' },
      { id: 'FR', displayName: '.fr', defaultPrice: '18.99' },
      { id: 'IT', displayName: '.it', defaultPrice: '17.99' },
      { id: 'ES', displayName: '.es', defaultPrice: '17.99' },
      { id: 'JP', displayName: '.co.jp', defaultPrice: '2299' },
    ];
  }
}

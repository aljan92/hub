import fs from 'fs';
import path from 'path';

export type ColorMode = 'predefined' | 'customPicker';

export interface MerchColorDef {
  id: string;          // e.g. "dark_heather"
  displayName: string; // e.g. "Dark Heather"
  hexPreview?: string; // e.g. "#3A3D40"
  avoidRule?: 'none' | 'white' | 'black'; // 'none' (default) | 'white' (avoid on white) | 'black' (avoid on black)
}

export interface MerchFitTypeDef {
  id: string;          // e.g. "men", "women", "youth", "girls"
  displayName: string; // e.g. "Men", "Women"
}

export interface MerchMarketplace {
  id: string;          // e.g. "US", "GB", "DE", "FR", "IT", "ES", "JP"
  displayName: string; // e.g. ".com", ".co.uk", ".de"
  defaultPrice: string;// e.g. "19.99"
}

export interface MerchProduct {
  id: string;                          // CSS identifier, e.g. "STANDARD_TSHIRT"
  displayName: string;                 // Human-readable name, e.g. "Standard t-shirt"
  niceClass?: number;                  // Nice Trademark Class (25, 18, 20, 21, 9, 16)
  colorMode: ColorMode;                // 'predefined' or 'customPicker'
  colors: MerchColorDef[];             // Available swatches
  fitTypes: MerchFitTypeDef[];         // Available fit types
  availableMarketplaces: string[];     // Marketplace IDs, e.g. ["US", "GB", "DE", "FR", "IT", "ES", "JP"]
  sortOrder: number;                   // Display / upload order
  presetHexColors?: string[];          // Preset hex values for custom picker
  lastUpdated: string;                 // ISO date string
  isDropAllowed?: boolean;             // Whether this product can be dropped during slot shortage
  dropPriorityOrder?: number;          // Order for drop cascade (1 = drop first, 2 = drop second, etc.)
}

export function inferNiceClass(idOrName: string): number {
  const clean = (idOrName || '').toLowerCase();
  if (clean.includes('popsocket') || clean.includes('case') || clean.includes('phone')) return 9;
  if (clean.includes('backpack') || clean.includes('tote') || clean.includes('bag')) return 18;
  if (clean.includes('pillow') || clean.includes('cushion')) return 20;
  if (clean.includes('mug') || clean.includes('tumbler') || clean.includes('bottle')) return 21;
  if (clean.includes('journal') || clean.includes('notebook') || clean.includes('book')) return 16;
  return 25; // Default to 25 (Apparel & Headwear)
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
  private static catalogData: ProductCatalogData = {
    products: [],
    marketplaces: [],
    lastScanDate: null,
    schemaVersion: 1
  };

  private static isLoaded = false;

  private static ensureLoaded() {
    if (this.isLoaded) return;
    this.loadCatalog();
    this.isLoaded = true;
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
   * Save catalog data to ./data/product_catalog.json
   */
  public static saveCatalog(data: Partial<ProductCatalogData>): ProductCatalogData {
    this.ensureLoaded();

    if (data.products !== undefined) {
      // Merge with existing products to preserve niceClass, isDropAllowed, dropPriorityOrder, and color avoidRules
      const existingMap = new Map(this.catalogData.products.map(p => [p.id, p]));
      this.catalogData.products = data.products.map(newProd => {
        const existing = existingMap.get(newProd.id);
        const niceClass = newProd.niceClass ?? existing?.niceClass ?? inferNiceClass(newProd.displayName || newProd.id);
        const isDropAllowed = newProd.isDropAllowed ?? existing?.isDropAllowed ?? false;
        const dropPriorityOrder = newProd.dropPriorityOrder ?? existing?.dropPriorityOrder;

        const existingColorsMap = new Map((existing?.colors || []).map(c => [c.id, c]));
        const mergedColors = (newProd.colors || []).map(newCol => {
          const existCol = existingColorsMap.get(newCol.id);
          return {
            ...newCol,
            avoidRule: newCol.avoidRule ?? existCol?.avoidRule ?? 'none'
          };
        });

        return {
          ...newProd,
          colors: mergedColors,
          niceClass,
          isDropAllowed,
          dropPriorityOrder
        };
      });
    }
    if (data.marketplaces !== undefined) {
      this.catalogData.marketplaces = data.marketplaces;
    }
    if (data.lastScanDate !== undefined) {
      this.catalogData.lastScanDate = data.lastScanDate;
    }

    this.enrichColorsWithHex();

    try {
      const dataDir = path.dirname(this.catalogFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.catalogFilePath, JSON.stringify(this.catalogData, null, 2), 'utf-8');
      console.log(`[ProductCatalogService] Saved ${this.catalogData.products.length} products to ${this.catalogFilePath}`);
    } catch (err: any) {
      console.error('[ProductCatalogService] Error writing product_catalog.json:', err.message);
    }

    return this.catalogData;
  }

  /**
   * Clear the dynamic catalog completely
   */
  public static clearCatalog(): ProductCatalogData {
    this.catalogData = {
      products: [],
      marketplaces: this.getDefaultMarketplaces(),
      lastScanDate: null,
      schemaVersion: 1
    };

    try {
      if (fs.existsSync(this.catalogFilePath)) {
        fs.writeFileSync(this.catalogFilePath, JSON.stringify(this.catalogData, null, 2), 'utf-8');
      }
      console.log('[ProductCatalogService] Cleared product catalog');
    } catch (err: any) {
      console.error('[ProductCatalogService] Error clearing catalog:', err.message);
    }

    return this.catalogData;
  }

  /**
   * Get active catalog data
   */
  public static getCatalog(): ProductCatalogData {
    this.ensureLoaded();
    return this.catalogData;
  }

  /**
   * Get catalog statistics (Total products, total slots across all marketplaces)
   */
  public static getStats(): ProductCatalogStats {
    this.ensureLoaded();
    const products = this.catalogData.products || [];
    
    // Each product on each marketplace counts as 1 slot
    let totalSlots = 0;
    for (const prod of products) {
      const mpCount = Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces.length : 0;
      totalSlots += mpCount;
    }

    return {
      totalProducts: products.length,
      totalSlots,
      totalMarketplaces: (this.catalogData.marketplaces || []).length,
      lastScanDate: this.catalogData.lastScanDate
    };
  }

  /**
   * Look up a single product by ID
   */
  public static getProductById(id: string): MerchProduct | undefined {
    this.ensureLoaded();
    return this.catalogData.products.find(p => p.id === id);
  }

  /**
   * Get all products belonging to a specific Nice Trademark Class (e.g. 25, 9, 18, 20, 21, 16)
   */
  public static getProductsByNiceClass(niceClass: number): MerchProduct[] {
    this.ensureLoaded();
    return this.catalogData.products.filter(p => (p.niceClass ?? inferNiceClass(p.displayName || p.id)) === niceClass);
  }

  /**
   * Get product IDs that should be blocked for a set of Nice Trademark Classes
   */
  public static getBlockedProductIdsForNiceClasses(blockedClasses: number[]): string[] {
    if (!blockedClasses || blockedClasses.length === 0) return [];
    this.ensureLoaded();
    const blockedSet = new Set(blockedClasses);
    return this.catalogData.products
      .filter(p => blockedSet.has(p.niceClass ?? inferNiceClass(p.displayName || p.id)))
      .map(p => p.id);
  }

  /**
   * Update nice class for a single product
   */
  public static updateProductNiceClass(id: string, niceClass: number): ProductCatalogData {
    this.ensureLoaded();
    const prod = this.catalogData.products.find(p => p.id === id);
    if (prod) {
      prod.niceClass = niceClass;
      return this.saveCatalog(this.catalogData);
    }
    return this.catalogData;
  }

  /**
   * Update avoid rule for a specific color of a product
   */
  public static updateProductColorAvoidRule(productId: string, colorId: string, avoidRule: 'none' | 'white' | 'black'): ProductCatalogData {
    this.ensureLoaded();
    const prod = this.catalogData.products.find(p => p.id === productId);
    if (prod && Array.isArray(prod.colors)) {
      const col = prod.colors.find(c => c.id === colorId);
      if (col) {
        col.avoidRule = avoidRule;
        return this.saveCatalog(this.catalogData);
      }
    }
    return this.catalogData;
  }

  /**
   * Update drop configuration (isDropAllowed, dropPriorityOrder) for products
   */
  public static updateDropConfig(configs: Array<{ id: string; isDropAllowed: boolean; dropPriorityOrder: number }>): ProductCatalogData {
    this.ensureLoaded();
    const configMap = new Map(configs.map(c => [c.id, c]));

    for (const prod of this.catalogData.products) {
      if (configMap.has(prod.id)) {
        const conf = configMap.get(prod.id)!;
        prod.isDropAllowed = conf.isDropAllowed;
        prod.dropPriorityOrder = conf.dropPriorityOrder;
      }
    }

    return this.saveCatalog(this.catalogData);
  }

  /**
   * Get all products allowed to be dropped, ordered by user priority
   */
  public static getDroppableProductsOrdered(): MerchProduct[] {
    this.ensureLoaded();
    return this.catalogData.products
      .filter(p => p.isDropAllowed === true)
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
      // US is NEVER droppable, count only non-US marketplaces
      const nonUsMarketplaces = (prod.availableMarketplaces || []).filter(mp => mp.toUpperCase() !== 'US');
      count += nonUsMarketplaces.length;
    }
    return count;
  }

  public static getMaxDroppableSlots(): number {
    return this.calculateMaxDroppableSlotsCount();
  }

  public static getTotalBaseSlotsCount(): number {
    let count = 0;
    for (const prod of this.catalogData.products) {
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

import { normalizeCatalogProductId, normalizeMarketplaceCode } from './queueService';

export interface AmazonProductCheckboxState {
  productId: string;
  marketplace: string;
  checked: boolean;
  readonly: boolean;
}

export interface ReconciledUpdateSelection {
  selectionMap: Record<string, string[]>;
  additionsMap: Record<string, string[]>;
  liveSummary: Record<string, { marketplaces: string[] }>;
  liveSlotCount: number;
  additionSlotCount: number;
}

const SUPPORTED_MARKETPLACES = new Set(['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'JP']);

const addMarketplace = (target: Record<string, string[]>, productId: string, marketplace: string) => {
  if (!target[productId]) target[productId] = [];
  if (!target[productId].includes(marketplace)) target[productId].push(marketplace);
};

/**
 * Rebuilds an update from the currently visible Amazon modal. Readonly/locked
 * checkboxes are the authoritative live state; only editable catalog entries
 * become additions. Products/marketplaces no longer exposed by Amazon vanish
 * from the upload delta without requiring product-specific selectors.
 */
export function reconcileUpdateSelectionFromDom(
  states: AmazonProductCheckboxState[],
  catalogSelection: Record<string, string[]>
): ReconciledUpdateSelection {
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error('FAILED_PRODUCT_SELECTION: Select-Products-DOM enthält keine auswertbaren Marktplatz-Checkboxen.');
  }

  const allowed = new Map<string, Set<string>>();
  for (const [rawProductId, rawMarketplaces] of Object.entries(catalogSelection || {})) {
    const productId = normalizeCatalogProductId(rawProductId);
    if (!Array.isArray(rawMarketplaces)) {
      throw new Error(`FAILED_PRODUCT_SELECTION: Ungültige Katalog-Marktplätze für ${rawProductId}`);
    }
    allowed.set(productId, new Set(rawMarketplaces.map(value => normalizeMarketplaceCode(String(value)))));
  }

  const selectionMap: Record<string, string[]> = {};
  const additionsMap: Record<string, string[]> = {};
  const liveMap: Record<string, string[]> = {};
  const seen = new Set<string>();

  for (const state of states) {
    const productId = normalizeCatalogProductId(state.productId);
    const marketplace = normalizeMarketplaceCode(state.marketplace);
    if (!productId || !SUPPORTED_MARKETPLACES.has(marketplace)) continue;
    const key = `${productId}:${marketplace}`;
    if (seen.has(key)) {
      throw new Error(`FAILED_PRODUCT_SELECTION: Doppelte DOM-Checkbox für ${key}`);
    }
    seen.add(key);
    if (!(productId in selectionMap)) selectionMap[productId] = [];

    if (state.readonly && state.checked) {
      addMarketplace(selectionMap, productId, marketplace);
      addMarketplace(liveMap, productId, marketplace);
      continue;
    }

    if (!state.readonly && allowed.get(productId)?.has(marketplace)) {
      addMarketplace(selectionMap, productId, marketplace);
      addMarketplace(additionsMap, productId, marketplace);
    }
  }

  const liveSummary = Object.fromEntries(
    Object.entries(liveMap).map(([productId, marketplaces]) => [productId, { marketplaces }])
  );
  return {
    selectionMap,
    additionsMap,
    liveSummary,
    liveSlotCount: Object.values(liveMap).reduce((sum, marketplaces) => sum + marketplaces.length, 0),
    additionSlotCount: Object.values(additionsMap).reduce((sum, marketplaces) => sum + marketplaces.length, 0)
  };
}

export function isAmazonDesignProcessingNotice(text: unknown): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized.includes('this design cannot be edited at this time')
    && (normalized.includes('under review') || normalized.includes('processing'));
}

export function getLiveMarketplacesForProduct(
  liveSummary: Record<string, unknown> | null | undefined,
  productId: string
): string[] {
  if (!liveSummary || typeof liveSummary !== 'object' || Array.isArray(liveSummary)) return [];
  const normalizedProductId = normalizeCatalogProductId(productId);
  const matchingKey = Object.keys(liveSummary).find(key => normalizeCatalogProductId(key) === normalizedProductId);
  if (!matchingKey) return [];
  const info = liveSummary[matchingKey];
  const marketplaces = Array.isArray(info) ? info : (info as { marketplaces?: unknown } | null)?.marketplaces;
  if (!Array.isArray(marketplaces)) return [];
  return [...new Set(marketplaces.map(value => normalizeMarketplaceCode(String(value))))];
}

/** Queue allocation is a delta for updates, not the full Amazon checkbox state. */
export function buildUploadProductSelection(
  plannedAdditions: Record<string, string[]>,
  isUpdate: boolean,
  liveSummary?: Record<string, unknown> | null
): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  const merge = (product: string, marketplaces: unknown) => {
    if (!Array.isArray(marketplaces) || marketplaces.some(mp => typeof mp !== 'string' && typeof mp !== 'number')) {
      throw new Error(`FAILED_PRODUCT_SELECTION: Ungültige Marktplatzdaten für ${product}`);
    }
    const id = normalizeCatalogProductId(product);
    const normalized = marketplaces.map(mp => normalizeMarketplaceCode(String(mp)));
    if (normalized.some(mp => !SUPPORTED_MARKETPLACES.has(mp))) {
      throw new Error(`FAILED_PRODUCT_SELECTION: Unbekannter Marktplatz für ${product}`);
    }
    selected[id] = [...new Set([...(selected[id] || []), ...normalized])];
  };
  for (const [product, marketplaces] of Object.entries(plannedAdditions)) merge(product, marketplaces);
  if (!isUpdate) return selected;

  // Never interpret missing live data as permission to deselect published products.
  if (!liveSummary || typeof liveSummary !== 'object' || Array.isArray(liveSummary)) {
    throw new Error('FAILED_PRODUCT_SELECTION: Live-Marktplatzdaten für Update fehlen; bestehende Produkte können nicht sicher erhalten werden.');
  }
  for (const [product, info] of Object.entries(liveSummary)) {
    merge(product, Array.isArray(info) ? info : (info as { marketplaces?: unknown } | null)?.marketplaces);
  }
  return selected;
}

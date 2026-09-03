import { normalizeCatalogProductId, normalizeMarketplaceCode } from './queueService';

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
    if (normalized.some(mp => !['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'JP'].includes(mp))) {
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

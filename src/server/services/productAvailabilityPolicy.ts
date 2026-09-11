export interface UploadAvailabilityPolicy {
  enabledMarketplaceIds: string[];
  youthEnabled: boolean;
}

export interface PolicyProduct {
  available?: boolean;
  userEnabled?: boolean;
  availableMarketplaces?: string[];
}

export const normalizeMarketplaceId = (value: string): string => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'UK' ? 'GB' : normalized;
};

export function isProductUploadEnabled(product: PolicyProduct): boolean {
  return product.available !== false && product.userEnabled !== false;
}

export function getEnabledMarketplacesForProduct(
  product: PolicyProduct,
  policy: UploadAvailabilityPolicy
): string[] {
  if (!isProductUploadEnabled(product)) return [];
  const enabled = new Set((policy.enabledMarketplaceIds || []).map(normalizeMarketplaceId));
  return [...new Set((product.availableMarketplaces || []).map(normalizeMarketplaceId))]
    .filter(marketplace => enabled.has(marketplace));
}

export function filterActiveProductsMap(
  activeProductsMap: Record<string, string[]>,
  products: Array<PolicyProduct & { id: string }>,
  policy: UploadAvailabilityPolicy
): Record<string, string[]> {
  const productsById = new Map(products.map(product => [product.id.toUpperCase(), product]));
  const filtered: Record<string, string[]> = {};
  for (const [productId, marketplaces] of Object.entries(activeProductsMap || {})) {
    const product = productsById.get(productId.toUpperCase());
    if (!product || !isProductUploadEnabled(product)) continue;
    const allowed = new Set(getEnabledMarketplacesForProduct(product, policy));
    const kept = [...new Set((marketplaces || []).map(normalizeMarketplaceId))]
      .filter(marketplace => allowed.has(marketplace));
    if (kept.length > 0) filtered[productId] = kept;
  }
  return filtered;
}

export function resolveEffectiveFitTypes(
  requestedFitTypes: string[] | undefined,
  policy: Pick<UploadAvailabilityPolicy, 'youthEnabled'>
): string[] {
  const requested = (requestedFitTypes && requestedFitTypes.length > 0
    ? requestedFitTypes
    : ['men', 'women', 'youth'])
    .map(value => String(value).trim().toLowerCase())
    .filter(Boolean);
  const effective = [...new Set(requested.filter(fit => policy.youthEnabled || fit !== 'youth'))];
  return effective.length > 0 ? effective : ['men'];
}

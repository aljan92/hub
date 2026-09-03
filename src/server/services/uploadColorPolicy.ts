export function isUploadColorBlocked(product: { colorMode?: string; colorDiscoveryStatus?: string }): boolean {
  if (product.colorMode === 'none' || product.colorMode === 'customPicker') return false;
  return product.colorMode !== 'predefined' || product.colorDiscoveryStatus === 'FAILED';
}

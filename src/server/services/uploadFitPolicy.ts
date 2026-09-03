/** The catalog declares configurable options; a fixed fit label is not a choice. */
export function getUploadFitPolicy(product: { fitTypes?: unknown[]; fitDiscoveryStatus?: string }) {
  const required = Array.isArray(product.fitTypes) && product.fitTypes.length > 0;
  return { required, blocked: required && product.fitDiscoveryStatus === 'FAILED' };
}

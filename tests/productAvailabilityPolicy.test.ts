import assert from 'node:assert/strict';
import {
  filterActiveProductsMap,
  getEnabledMarketplacesForProduct,
  isProductUploadEnabled,
  resolveEffectiveFitTypes
} from '../src/server/services/productAvailabilityPolicy';

const policy = { enabledMarketplaceIds: ['US', 'DE'], youthEnabled: false };
const products = [
  { id: 'ACTIVE', available: true, userEnabled: true, availableMarketplaces: ['US', 'DE', 'GB'] },
  { id: 'USER_DISABLED', available: true, userEnabled: false, availableMarketplaces: ['US', 'DE'] },
  { id: 'AMAZON_DISABLED', available: false, userEnabled: true, availableMarketplaces: ['US'] }
];

assert.equal(isProductUploadEnabled(products[0]), true);
assert.equal(isProductUploadEnabled(products[1]), false);
assert.equal(isProductUploadEnabled(products[2]), false);
assert.deepEqual(getEnabledMarketplacesForProduct(products[0], policy), ['US', 'DE']);
assert.deepEqual(getEnabledMarketplacesForProduct(products[1], policy), []);
assert.deepEqual(filterActiveProductsMap({
  ACTIVE: ['US', 'GB', 'DE'],
  USER_DISABLED: ['US'],
  AMAZON_DISABLED: ['US']
}, products, policy), { ACTIVE: ['US', 'DE'] });

assert.deepEqual(resolveEffectiveFitTypes(['men', 'women', 'youth'], policy), ['men', 'women']);
assert.deepEqual(resolveEffectiveFitTypes(['youth'], policy), ['men']);
assert.deepEqual(resolveEffectiveFitTypes(['youth'], { youthEnabled: true }), ['youth']);
assert.deepEqual(resolveEffectiveFitTypes(undefined, policy), ['men', 'women']);

console.log('PASS: product, marketplace and Youth policies are deterministic and preserve Men fallback');

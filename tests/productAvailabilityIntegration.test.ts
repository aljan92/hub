import assert from 'node:assert/strict';
import { ProductCatalogService } from '../src/server/services/productCatalogService';
import { QueueService } from '../src/server/services/queueService';

const catalog = ProductCatalogService.getCatalog();
const product = catalog.products.find(entry => entry.available !== false && entry.userEnabled !== false);
assert.ok(product, 'At least one existing product must remain enabled after migration');

const originalProductEnabled = product.userEnabled !== false;
const originalPolicy = ProductCatalogService.getUploadPolicy();
const marketplace = originalPolicy.enabledMarketplaceIds.find(id => product.availableMarketplaces.includes(id));
assert.ok(marketplace, 'At least one enabled marketplace must overlap with the selected product');

let queueItemId: string | undefined;
try {
  const item = QueueService.enqueueDesign({
    taskId: `policy_integration_${Date.now()}`,
    designTitle: 'Policy Integration',
    niche: 'Test',
    brand: 'Policy Test',
    title: 'Policy Integration Test',
    bullet1: 'Policy integration test bullet one',
    bullet2: 'Policy integration test bullet two',
    description: 'Policy integration test description',
    imagePath: '/tmp/policy.png',
    pngPath: '/tmp/policy.png',
    fitTypes: ['youth'],
    source: 'test'
  });
  queueItemId = item.id;

  ProductCatalogService.updateProductEnabled(product.id, false);
  let state = QueueService.rebalanceQueue();
  let updated = state.items.find(entry => entry.id === item.id)!;
  assert.equal(updated.activeProductsMap[product.id], undefined, 'Disabled product must be removed from an existing queue item');

  ProductCatalogService.updateProductEnabled(product.id, true);
  state = QueueService.rebalanceQueue();
  updated = state.items.find(entry => entry.id === item.id)!;
  assert.ok(updated.activeProductsMap[product.id], 'Re-enabled product must return to an existing queue item');

  ProductCatalogService.updateMarketplaceEnabled(marketplace, false);
  state = QueueService.rebalanceQueue();
  updated = state.items.find(entry => entry.id === item.id)!;
  assert.equal(Object.values(updated.activeProductsMap).some(ids => ids.includes(marketplace)), false, 'Disabled marketplace must be removed from every queued product');

  ProductCatalogService.updateYouthEnabled(false);
  state = QueueService.rebalanceQueue();
  updated = state.items.find(entry => entry.id === item.id)!;
  assert.deepEqual(updated.fitTypes, ['youth'], 'Audit fit snapshot must remain unchanged');
  assert.deepEqual(updated.effectiveFitTypes, ['men'], 'Youth-only queue item must use Men fallback while Youth is globally disabled');

  console.log('PASS: persistent product, marketplace and Youth changes recalculate existing queue items');
} finally {
  ProductCatalogService.updateProductEnabled(product.id, originalProductEnabled);
  ProductCatalogService.updateMarketplaceEnabled(marketplace, originalPolicy.enabledMarketplaceIds.includes(marketplace));
  ProductCatalogService.updateYouthEnabled(originalPolicy.youthEnabled);
  QueueService.rebalanceQueue();
  if (queueItemId) QueueService.removeItem(queueItemId);
}

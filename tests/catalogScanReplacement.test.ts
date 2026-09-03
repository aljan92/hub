import assert from 'node:assert/strict';
import { ProductCatalogService } from '../src/server/services/productCatalogService';

// Run the real merge with isolated in-memory storage; never touch user data.
const service = ProductCatalogService as any;
const keys = ['catalogData', 'overridesData', 'ensureLoaded', 'enrichColorsWithHex', 'saveCatalogAtomic', 'getCatalog'];
const original = new Map(keys.map(key => [key, service[key]]));
try {
  service.ensureLoaded = () => {};
  service.enrichColorsWithHex = () => {};
  service.saveCatalogAtomic = () => {};
  service.getCatalog = () => service.catalogData;
  const product = {
    id: 'DYNAMIC_PRODUCT', amazon: { key: 'DYNAMIC_PRODUCT' },
    fitTypes: [{ id: 'men' }, { id: 'women' }],
    colors: [{ id: 'black' }, { id: 'white' }], colorMode: 'predefined',
    presetHexColors: ['#000000'], availableMarketplaces: ['US']
  };
  const overrides = { overrides: { DYNAMIC_PRODUCT: { niceClass: 25, colors: { black: { avoidRule: 'black' } } } } };
  const before = JSON.stringify(overrides);
  service.overridesData = overrides;
  const merge = (scan: any) => {
    service.catalogData = { products: [structuredClone(product)] };
    service.saveCatalog({ products: [{ ...product, ...scan }] });
    assert.equal(JSON.stringify(overrides), before, 'Overrides must never be removed');
    return service.catalogData.products[0];
  };
  const empty = merge({ fitTypes: [], fitDiscoveryStatus: 'SUCCESS', colors: [], colorDiscoveryStatus: 'SUCCESS' });
  assert.deepEqual(empty.fitTypes, []);
  assert.deepEqual(empty.colors, [], 'Confirmed empty predefined list must replace old colors');
  const reduced = merge({ fitTypes: [{ id: 'women' }], fitDiscoveryStatus: 'SUCCESS', colors: [{ id: 'black' }], colorDiscoveryStatus: 'SUCCESS' });
  assert.deepEqual(reduced.fitTypes, [{ id: 'women' }]);
  assert.deepEqual(reduced.colors, [{ id: 'black', avoidRule: 'black' }]);
  for (const status of ['FAILED', undefined]) {
    const failed = merge({ fitTypes: [], fitDiscoveryStatus: status, colors: [], colorDiscoveryStatus: status });
    assert.deepEqual(failed.fitTypes, product.fitTypes);
    assert.deepEqual(failed.colors, product.colors);
    assert.equal(failed.fitDiscoveryStatus, 'FAILED');
    assert.equal(failed.colorDiscoveryStatus, 'FAILED');
  }
  const none = merge({ colorMode: 'none', colors: [], colorDiscoveryStatus: 'SUCCESS', presetHexColors: undefined });
  assert.deepEqual(none.colors, []);
  assert.deepEqual(none.presetHexColors, []);
  assert.equal(none.colorMode, 'none');
  console.log('PASS: confirmed removal/reduction, failed and unknown scans, mode changes, preset removal, persistent overrides');
} finally {
  for (const [key, value] of original) service[key] = value;
}

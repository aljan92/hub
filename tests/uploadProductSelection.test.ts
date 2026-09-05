import assert from 'node:assert/strict';
import {
  buildUploadProductSelection,
  getLiveMarketplacesForProduct,
  isAmazonDesignProcessingNotice,
  reconcileUpdateSelectionFromDom
} from '../src/server/services/uploadProductSelection';
import { normalizeCatalogProductId } from '../src/server/services/queueService';

const additions = { STANDARD_TSHIRT: ['US'], VNECK: [] };
const live = { STANDARD_TSHIRT: { marketplaces: ['UK', 'ES'] }, VNECK: ['DE', 'GB'], TANK_TOP: ['US'] };
const before = JSON.stringify({ additions, live });
const selection = buildUploadProductSelection(additions, true, live);
assert.deepEqual(selection.STANDARD_TSHIRT, ['US', 'GB', 'ES']);
assert.deepEqual(selection[normalizeCatalogProductId('VNECK')], ['DE', 'GB']);
assert.deepEqual(selection[normalizeCatalogProductId('TANK_TOP')], ['US'], 'Live-only products must be retained');
assert.equal(JSON.stringify({ additions, live }), before, 'Slot delta and live metadata must not be mutated');
assert.equal(Object.values(additions).flat().length, 1, 'Only one new slot allocated');
assert.deepEqual(buildUploadProductSelection(additions, false, live), {
  STANDARD_TSHIRT: ['US'], [normalizeCatalogProductId('VNECK')]: []
}, 'New designs must not inherit live selections');
assert.deepEqual(buildUploadProductSelection({ STANDARD_TSHIRT: ['GB'] }, true, {
  STANDARD_TSHIRT: { marketplaces: ['UK', 'A1F83G8C2ARO7P'] }
}), { STANDARD_TSHIRT: ['GB'] }, 'Normalize and deduplicate marketplace aliases');
assert.throws(() => buildUploadProductSelection(additions, true), /Live-Marktplatzdaten/);
assert.throws(() => buildUploadProductSelection(additions, true, { VNECK: {} }), /Ungültige Marktplatzdaten/);
assert.throws(() => buildUploadProductSelection(additions, true, { VNECK: ['INVALID'] }), /Unbekannter Marktplatz/);
assert.deepEqual(
  getLiveMarketplacesForProduct({ TUMBLER: { marketplaces: ['US', 'UK'] } }, 'TUMBLER'),
  ['US', 'GB'],
  'Partially live products must be recognized as artwork-locked across marketplaces'
);
assert.deepEqual(
  getLiveMarketplacesForProduct({ MUG: ['DE'] }, 'CERAMIC_MUG'),
  ['DE'],
  'Dynamic catalog aliases must identify already-live product types'
);
assert.deepEqual(getLiveMarketplacesForProduct(live, 'TRAVEL_TUMBLER'), [], 'Unpublished product types remain artwork-configurable');

const reconciled = reconcileUpdateSelectionFromDom([
  { productId: 'STANDARD_TSHIRT', marketplace: 'US', checked: true, readonly: true },
  { productId: 'STANDARD_TSHIRT', marketplace: 'DE', checked: false, readonly: false },
  { productId: 'STANDARD_TSHIRT', marketplace: 'GB', checked: true, readonly: false },
  { productId: 'REMOVED_BY_CATALOG', marketplace: 'US', checked: true, readonly: true }
], { STANDARD_TSHIRT: ['US', 'DE', 'GB'] });
assert.deepEqual(reconciled.liveSummary, {
  STANDARD_TSHIRT: { marketplaces: ['US'] },
  REMOVED_BY_CATALOG: { marketplaces: ['US'] }
}, 'Readonly DOM state is authoritative even for products absent from the local catalog');
assert.deepEqual(reconciled.additionsMap, { STANDARD_TSHIRT: ['DE', 'GB'] }, 'Every editable catalog combination remains part of the update delta');
assert.deepEqual(reconciled.selectionMap.STANDARD_TSHIRT, ['US', 'DE', 'GB']);
assert.equal(reconciled.liveSlotCount, 2);
assert.equal(reconciled.additionSlotCount, 2);
assert.throws(() => reconcileUpdateSelectionFromDom([], {}), /keine auswertbaren/);
assert.throws(() => reconcileUpdateSelectionFromDom([
  { productId: 'MUG', marketplace: 'US', checked: true, readonly: true },
  { productId: 'MUG', marketplace: 'US', checked: true, readonly: true }
], { MUG: ['US'] }), /Doppelte DOM-Checkbox/);
assert.equal(isAmazonDesignProcessingNotice('This design cannot be edited at this time because products are under review or processing.'), true);
assert.equal(isAmazonDesignProcessingNotice('This design can be edited.'), false);
console.log('PASS: update union, authoritative DOM reconciliation, processing notice, aliases and fail-closed checks');

import assert from 'node:assert/strict';
import { buildUploadProductSelection } from '../src/server/services/uploadProductSelection';
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
console.log('PASS: update union, live-only products, slot immutability, new designs, aliases and fail-closed metadata checks');

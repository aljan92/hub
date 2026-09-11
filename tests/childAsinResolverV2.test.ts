import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAmazonRetailIdentity, AmazonRetailIdentityService } from '../src/server/services/amazonRetailIdentityService';
import { BrowserSessionService } from '../src/server/services/browserSessionService';
import {
  getChildAsinPolicy,
  isChildAsinRequirementSatisfied,
  isLegacyChildAsinWriteEnabled,
  isNewChildAsinShadowType
} from '../src/server/services/childAsinPolicyService';
import { SyncEngine } from '../src/server/services/syncEngine';

test('product policy adds seven shadow types and removes Samsung from resolution', () => {
  const added = ['SPORT_BACKPACK', 'LAPTOP_SLEEVE', 'MOUSE_PAD', 'RETRACTABLE_PEN', 'THROW_BLANKET', 'MATTE_POSTER', 'TRAVEL_TUMBLER'];
  for (const type of added) {
    assert.equal(getChildAsinPolicy(type), 'resolve');
    assert.equal(isNewChildAsinShadowType(type), true);
    assert.equal(isLegacyChildAsinWriteEnabled(type), false);
  }
  assert.equal(getChildAsinPolicy('PHONE_CASE_SAMSUNG_GALAXY'), 'unsupported');
  assert.equal(getChildAsinPolicy('SAMSUNG_CASE'), 'unsupported');
  assert.equal(isLegacyChildAsinWriteEnabled('PHONE_CASE_SAMSUNG_GALAXY'), false);
  assert.equal(getChildAsinPolicy('STANDARD_TSHIRT'), 'identity');
  assert.equal(getChildAsinPolicy('FUTURE_UNKNOWN_PRODUCT'), 'unsupported');
});

test('new product parent placeholder remains intact until a guarded V2 write exists', () => {
  const existing = [{ asin: 'B000000001', parentAsin: 'B000000001', type: 'TRAVEL_TUMBLER', market: 'us' }];
  const built = SyncEngine.buildAdAsins(
    [{ asin: 'B000000001', type: 'TRAVEL_TUMBLER', market: 'us' }],
    existing,
    [{ asin: 'B000000001', type: 'TRAVEL_TUMBLER', market: 'us' }]
  );
  assert.deepEqual(built, existing);
  assert.equal(isChildAsinRequirementSatisfied(built[0]), false);
});

test('existing real child stays immutable and Samsung data is preserved', () => {
  const realChild = [{ asin: 'B000000009', parentAsin: 'B000000001', type: 'MOUSE_PAD', market: 'us' }];
  assert.deepEqual(SyncEngine.buildAdAsins(
    [{ asin: 'B000000001', type: 'MOUSE_PAD', market: 'us' }], realChild,
    [{ asin: 'B000000001', type: 'MOUSE_PAD', market: 'us' }]
  ), realChild);

  const samsung = [{ asin: 'B000000008', parentAsin: 'B000000001', type: 'PHONE_CASE_SAMSUNG_GALAXY', market: 'us' }];
  assert.deepEqual(SyncEngine.buildAdAsins(
    [{ asin: 'B000000001', type: 'PHONE_CASE_SAMSUNG_GALAXY', market: 'us' }], samsung,
    [{ asin: 'B000000001', type: 'PHONE_CASE_SAMSUNG_GALAXY', market: 'us' }]
  ), samsung);
  assert.equal(isChildAsinRequirementSatisfied(samsung[0]), true);
});

test('retail parser follows SNAP source priority', () => {
  assert.deepEqual(
    parseAmazonRetailIdentity('<input id="ASIN" value="B000000002"><div id="detailBullets_feature_div">ASIN B000000003</div>'),
    { asin: 'B000000002', source: 'hidden-input' }
  );
  assert.deepEqual(
    parseAmazonRetailIdentity('<div id="detailBullets_feature_div"><span>ASIN: B000000003</span></div>'),
    { asin: 'B000000003', source: 'detail-bullets' }
  );
  assert.deepEqual(
    parseAmazonRetailIdentity('<table id="productDetails"><tr><th>ASIN</th><td>B000000004</td></tr></table>'),
    { asin: 'B000000004', source: 'product-details' }
  );
  assert.deepEqual(
    parseAmazonRetailIdentity('{"selectedVariationASIN":"B000000005"}'),
    { asin: 'B000000005', source: 'selected-variation' }
  );
});

test('retail parser rejects ambiguous maps and generic asin fields', () => {
  assert.deepEqual(
    parseAmazonRetailIdentity('{"dimensionToAsinMap":{"a":"B000000002","b":"B000000003"}}'),
    { asin: '', ambiguous: true }
  );
  assert.deepEqual(parseAmazonRetailIdentity('{"asin":"B000000002"}'), { asin: '', ambiguous: false });
});

test('retail resolver classifies child, parent, block, auth and 404 without writes', async () => {
  const original = BrowserSessionService.withIsolatedPage;
  const scenarios = [
    { response: { status: () => 200 }, url: 'https://www.amazon.com/dp/B000000002', html: '<input id="ASIN" value="B000000002">', expected: 'resolved' },
    { response: { status: () => 200 }, url: 'https://www.amazon.com/dp/B000000001', html: '<input id="ASIN" value="B000000001">', expected: 'parent_returned' },
    { response: { status: () => 503 }, url: 'https://www.amazon.com/dp/B000000001', html: 'Robot Check', expected: 'amazon_blocked' },
    { response: { status: () => 200 }, url: 'https://www.amazon.com/ap/signin', html: '<input id="ap_email">', expected: 'auth_required' },
    { response: { status: () => 404 }, url: 'https://www.amazon.com/dp/B000000001', html: '', expected: 'http_not_found' }
  ];
  try {
    for (const scenario of scenarios) {
      (BrowserSessionService as any).withIsolatedPage = async (_type: string, work: Function) => work({
        goto: async () => scenario.response,
        url: () => scenario.url,
        content: async () => scenario.html
      });
      const result = await AmazonRetailIdentityService.resolve('B000000001', 'us');
      assert.equal(result.status, scenario.expected);
    }
  } finally {
    BrowserSessionService.withIsolatedPage = original;
  }
});

test('shadow batch resolves a new parent placeholder without any Supabase write', async () => {
  let writeCalls = 0;
  const rows = [{
    design_id: 'D-SHADOW',
    published_products: [{ asin: 'B000000001', type: 'TRAVEL_TUMBLER', market: 'us' }],
    ad_asins: [{ asin: 'B000000001', parentAsin: 'B000000001', type: 'TRAVEL_TUMBLER', market: 'us' }]
  }];
  const client: any = {
    from() {
      return {
        select() {
          return {
            in() {
              return { order() { return { range: async () => ({ data: rows, error: null }) }; } };
            }
          };
        },
        update() { writeCalls++; throw new Error('shadow must not update'); },
        upsert() { writeCalls++; throw new Error('shadow must not upsert'); }
      };
    }
  };
  const originals = {
    getSupabase: (SyncEngine as any).getSupabase,
    loadRuntime: (SyncEngine as any).loadRuntime,
    saveRuntime: (SyncEngine as any).saveRuntime,
    beginWorker: (SyncEngine as any).beginWorker,
    finishWorker: (SyncEngine as any).finishWorker,
    recordTraffic: (SyncEngine as any).recordTraffic,
    resolve: AmazonRetailIdentityService.resolve
  };
  let savedRuntime: any = { version: 1, productWatermark: null };
  try {
    (SyncEngine as any).getSupabase = () => client;
    (SyncEngine as any).loadRuntime = () => structuredClone(savedRuntime);
    (SyncEngine as any).saveRuntime = (value: any) => { savedRuntime = structuredClone(value); };
    (SyncEngine as any).beginWorker = () => 'shadow-run';
    (SyncEngine as any).finishWorker = () => {};
    (SyncEngine as any).recordTraffic = () => {};
    AmazonRetailIdentityService.resolve = async () => ({
      status: 'resolved',
      evidence: { requestedParentAsin: 'B000000001', resolvedAsin: 'B000000002', marketplace: 'us', source: 'hidden-input', finalUrl: 'https://www.amazon.com/dp/B000000002', httpStatus: 200 }
    });
    const result = await SyncEngine.runChildAsinShadowBatch(1);
    assert.deepEqual(result, { checked: 1, resolved: 1, unresolved: 0 });
    assert.equal(writeCalls, 0);
    assert.equal(rows[0].ad_asins[0].asin, 'B000000001');
    assert.match(savedRuntime.resolverShadow.lastResult, /keine Datenbankänderung/i);
  } finally {
    (SyncEngine as any).getSupabase = originals.getSupabase;
    (SyncEngine as any).loadRuntime = originals.loadRuntime;
    (SyncEngine as any).saveRuntime = originals.saveRuntime;
    (SyncEngine as any).beginWorker = originals.beginWorker;
    (SyncEngine as any).finishWorker = originals.finishWorker;
    (SyncEngine as any).recordTraffic = originals.recordTraffic;
    AmazonRetailIdentityService.resolve = originals.resolve;
  }
});

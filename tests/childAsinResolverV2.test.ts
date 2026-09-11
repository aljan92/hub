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

    savedRuntime = { version: 1, productWatermark: null };
    AmazonRetailIdentityService.resolve = async () => ({ status: 'identity_not_found', httpStatus: 200, finalUrl: 'https://www.amazon.com/dp/B000000001' });
    const unresolved = await SyncEngine.runChildAsinShadowBatch(1);
    assert.deepEqual(unresolved, { checked: 1, resolved: 0, unresolved: 1 });
    assert.equal(Object.values(savedRuntime.resolverObservations)[0].source, null);
    assert.equal(writeCalls, 0);

    savedRuntime = {
      version: 1,
      productWatermark: null,
      resolverShadow: { lastRunAt: new Date().toISOString(), checked: 0, resolved: 0, unresolved: 0, lastResult: 'blocked', cursor: 0, blockedUntil: new Date(Date.now() + 60_000).toISOString() }
    };
    let forcedCalls = 0;
    AmazonRetailIdentityService.resolve = async () => {
      forcedCalls++;
      return { status: 'identity_not_found', httpStatus: 200, finalUrl: 'https://www.amazon.com/dp/B000000001' };
    };
    assert.deepEqual(await SyncEngine.runChildAsinShadowBatch(1), { checked: 1, resolved: 0, unresolved: 1 });
    assert.equal(forcedCalls, 1);
    assert.equal(savedRuntime.resolverShadow.blockedUntil, null);
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

test('legacy diagnostics explain entries, retries and stale design flags without exposing identities', () => {
  const rows = [
    {
      design_id: 'D-READY',
      published_products: [{ asin: 'B000000001', type: 'MUG', market: 'us' }],
      ad_asins: [{ asin: 'B000000001', parentAsin: 'B000000001', type: 'MUG', market: 'us' }]
    },
    {
      design_id: 'D-RETRY',
      published_products: [{ asin: 'B000000002', type: 'TOTE_BAG', market: 'de' }],
      ad_asins: [{ asin: null, parentAsin: 'B000000002', type: 'TOTE_BAG', market: 'de' }]
    },
    {
      design_id: 'D-STALE',
      published_products: [{ asin: 'B000000003', type: 'PHONE_CASE_SAMSUNG_GALAXY', market: 'us' }],
      ad_asins: [{ asin: 'B000000003', parentAsin: 'B000000003', type: 'PHONE_CASE_SAMSUNG_GALAXY', market: 'us' }]
    }
  ];
  const diagnostics = SyncEngine.buildChildAsinDiagnostics(rows, {
    'D-RETRY:de:TOTE_BAG': {
      attempts: 2,
      nextAt: new Date(Date.now() + 60_000).toISOString(),
      parentAsin: 'B000000002',
      lastError: 'HTTP 404'
    }
  });

  assert.equal(diagnostics.unresolvedDesigns, 3);
  assert.equal(diagnostics.unresolvedEntries, 2);
  assert.equal(diagnostics.readyNow, 1);
  assert.equal(diagnostics.retryWaiting, 1);
  assert.equal(diagnostics.staleStatusDesigns, 1);
  assert.deepEqual(diagnostics.groups, [
    { type: 'MUG', market: 'us', count: 1 },
    { type: 'TOTE_BAG', market: 'de', count: 1 }
  ]);
  assert.equal(JSON.stringify(diagnostics).includes('D-READY'), false);
  assert.equal(JSON.stringify(diagnostics).includes('B000000001'), false);
});

test('lifecycle audit compares complete Amazon state without mutating source rows', () => {
  const listings = [
    { designId: 'D1', asin: 'B000000001', productType: 'MUG', marketplace: 'us', status: 'PUBLISHED' },
    { designId: 'D1', asin: 'B000000002', productType: 'TUMBLER', marketplace: 'de', status: 'DELETED' },
    { designId: 'D2', asin: 'B000000003', productType: 'TOTE_BAG', marketplace: 'us', status: 'DELETED' },
    { designId: 'D4', asin: 'B000000004', productType: 'MUG', marketplace: 'us', status: 'PUBLISHED' }
  ];
  const databaseRows = [
    {
      design_id: 'D1', status: 'PUBLISHED',
      published_products: [{ asin: 'B000000001', type: 'MUG', market: 'us' }, { asin: 'B000000002', type: 'TUMBLER', market: 'de' }],
      ad_asins: [{ asin: 'B000000002', parentAsin: 'B000000002', type: 'TUMBLER', market: 'de' }]
    },
    { design_id: 'D2', status: 'PUBLISHED', published_products: [{ asin: 'B000000003', type: 'TOTE_BAG', market: 'us' }], ad_asins: [] },
    { design_id: 'D3', status: 'PUBLISHED', published_products: [{ asin: 'B000000005', type: 'MUG', market: 'us' }], ad_asins: [] }
  ];
  const before = structuredClone(databaseRows);
  const audit = SyncEngine.buildLifecycleAudit(listings, databaseRows);

  assert.equal(audit.summary.amazonDesigns, 3);
  assert.equal(audit.summary.databaseDesigns, 3);
  assert.equal(audit.summary.deletedAtAmazonDesigns, 1);
  assert.equal(audit.summary.missingFromAmazonDesigns, 1);
  assert.equal(audit.summary.stalePublishedProducts, 3);
  assert.equal(audit.summary.staleAdAsins, 1);
  assert.equal(audit.summary.missingDatabaseProducts, 1);
  assert.deepEqual(databaseRows, before);
});

test('resolver validation counts unique observations and repeat confirmations', () => {
  const summary = SyncEngine.buildResolverValidation({
    a: { parentAsin: 'B000000001', resolvedAsin: 'B000000002', status: 'resolved', source: 'hidden-input', observedAt: new Date().toISOString(), consistentCount: 2 },
    b: { parentAsin: 'B000000003', resolvedAsin: null, status: 'http_not_found', source: null, observedAt: new Date().toISOString(), consistentCount: 1 }
  });
  assert.equal(summary.observed, 2);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.confirmedTwice, 1);
  assert.deepEqual(summary.statuses, [{ status: 'resolved', count: 1 }, { status: 'http_not_found', count: 1 }]);
});

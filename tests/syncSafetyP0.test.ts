import assert from 'node:assert/strict';
import test from 'node:test';

import { SyncEngine } from '../src/server/services/syncEngine';

function mockSupabase(options: { readError?: string; writeError?: string; existing?: any[] } = {}) {
  const writes: any[][] = [];
  const client: any = {
    from() {
      return {
        select() {
          return {
            in: async () => ({ data: options.existing || [], error: options.readError ? { message: options.readError } : null })
          };
        },
        upsert: async (rows: any[]) => {
          writes.push(rows);
          return { error: options.writeError ? { message: options.writeError } : null };
        }
      };
    }
  };
  return { client, writes };
}

test('product upserts strip internal and foreign fields', async () => {
  const { client, writes } = mockSupabase();
  const originalGetSupabase = (SyncEngine as any).getSupabase;
  const originalRefresh = SyncEngine.refreshDBStats;
  (SyncEngine as any).getSupabase = () => client;
  SyncEngine.refreshDBStats = async () => {};
  try {
    const count = await SyncEngine.mergeAndUpsertDesigns([{
      design_id: 'D1',
      status: 'PUBLISHED',
      asins: ['B000000001'],
      published_products: [],
      _deleted_asins: ['B000000002'],
      mba_hub_updated_at: 'must-not-write',
      skip_update: true,
      unexpected: 'must-not-write'
    }]);
    assert.equal(count, 1);
    assert.equal(writes.length, 1);
    assert.equal('_deleted_asins' in writes[0][0], false);
    assert.equal('mba_hub_updated_at' in writes[0][0], false);
    assert.equal('skip_update' in writes[0][0], false);
    assert.equal('unexpected' in writes[0][0], false);
  } finally {
    (SyncEngine as any).getSupabase = originalGetSupabase;
    SyncEngine.refreshDBStats = originalRefresh;
  }
});

test('product identity replaces a rotated parent by market and type and invalidates its child', async () => {
  const { client, writes } = mockSupabase({ existing: [{
    design_id: 'D1', asins: ['B000000001'], asin_standard_tshirt_us: null, price_standard_tshirt_us: null,
    published_products: [{ asin: 'B000000001', type: 'MUG', market: 'us' }],
    ad_asins: [{ asin: 'B000000009', parentAsin: 'B000000001', type: 'MUG', market: 'us' }], asin_resolved: true
  }] });
  const originalGetSupabase = (SyncEngine as any).getSupabase;
  const originalRefresh = SyncEngine.refreshDBStats;
  (SyncEngine as any).getSupabase = () => client;
  SyncEngine.refreshDBStats = async () => {};
  try {
    await SyncEngine.mergeAndUpsertDesigns([{
      design_id: 'D1', status: 'PUBLISHED', asins: ['B000000002'],
      published_products: [{ asin: 'B000000002', type: 'MUG', market: 'us' }]
    }]);
    assert.deepEqual(writes[0][0].published_products, [{ asin: 'B000000002', type: 'MUG', market: 'us' }]);
    assert.equal(writes[0][0].ad_asins[0].asin, null);
    assert.equal(writes[0][0].ad_asins[0].parentAsin, 'B000000002');
    assert.equal(writes[0][0].asin_resolved, false);
  } finally {
    (SyncEngine as any).getSupabase = originalGetSupabase;
    SyncEngine.refreshDBStats = originalRefresh;
  }
});

test('unknown marketplaces are never silently mapped to US', () => {
  const mapped = SyncEngine.mapListingsToSupabase([{ designId: 'D1', asin: 'B000000001', productType: 'MUG', marketplaceId: 'UNKNOWN', status: 'PUBLISHED' }]);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0].published_products, []);
  assert.deepEqual(mapped[0].products_live_us, []);
});

test('verified child survives only while its parent identity is unchanged', () => {
  const kept = SyncEngine.buildAdAsins(
    [{ asin: 'B000000001', type: 'MUG', market: 'us' }],
    [{ asin: 'B000000009', parentAsin: 'B000000001', type: 'MUG', market: 'us' }],
    [{ asin: 'B000000001', type: 'MUG', market: 'us' }]
  );
  assert.equal(kept[0].asin, 'B000000009');
  const invalidated = SyncEngine.buildAdAsins(
    [{ asin: 'B000000002', type: 'MUG', market: 'us' }], kept,
    [{ asin: 'B000000001', type: 'MUG', market: 'us' }]
  );
  assert.equal(invalidated[0].asin, null);
});

test('failed existing-row read prevents merge and write', async () => {
  const { client, writes } = mockSupabase({ readError: 'read failed' });
  const originalGetSupabase = (SyncEngine as any).getSupabase;
  (SyncEngine as any).getSupabase = () => client;
  try {
    await assert.rejects(
      SyncEngine.mergeAndUpsertDesigns([{ design_id: 'D1', published_products: [] }]),
      /Bestandsread fehlgeschlagen/
    );
    assert.equal(writes.length, 0);
  } finally {
    (SyncEngine as any).getSupabase = originalGetSupabase;
  }
});

test('failed upsert never reports prepared rows as confirmed', async () => {
  const { client } = mockSupabase({ writeError: 'unknown column' });
  const originalGetSupabase = (SyncEngine as any).getSupabase;
  (SyncEngine as any).getSupabase = () => client;
  try {
    await assert.rejects(
      SyncEngine.mergeAndUpsertDesigns([{ design_id: 'D1', published_products: [] }]),
      /Upsert fehlgeschlagen/
    );
  } finally {
    (SyncEngine as any).getSupabase = originalGetSupabase;
  }
});

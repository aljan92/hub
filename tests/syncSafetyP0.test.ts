import assert from 'node:assert/strict';
import test from 'node:test';

import { SyncEngine } from '../src/server/services/syncEngine';

function mockSupabase(options: { readError?: string; writeError?: string } = {}) {
  const writes: any[][] = [];
  const client: any = {
    from() {
      return {
        select() {
          return {
            in: async () => ({ data: [], error: options.readError ? { message: options.readError } : null })
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

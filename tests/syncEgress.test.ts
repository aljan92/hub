import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SyncStateRepository, groupListings, syncScope } from '../src/server/storage/syncStateRepository';
import { SyncEngine } from '../src/server/services/syncEngine';
import { SupabaseService } from '../src/server/services/supabaseService';

const row = (design = 'D1', overrides: any = {}) => ({ designId: design, listingId: `${design}_MUG_US`, marketplace: 'US', productType: 'MUG', asin: 'B000000001', status: 'PUBLISHED', updatedDate: 1789000000, createdDate: 1788000000, listPrice: 19.99, ...overrides });
const scope = syncScope('https://example.supabase.co', 'account-a');
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-egress-'));
  const file = path.join(dir, 'state.sqlite');
  const store = new SyncStateRepository(file);
  return { dir, file, store, close: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('confirmed listing identity survives reordered and partial design pages; parent rotation is a change', () => {
  const f = fixture();
  try {
    const a = row(); const b = row('D1', { listingId: 'D1_MUG_DE', marketplace: 'DE' });
    f.store.stage(scope, [a,b], true); f.store.confirm(scope, [a,b]); f.store.textDone(scope, 'D1');
    assert.equal(f.store.stage(scope, [b,a], true).unchanged, 1);
    assert.equal(f.store.stage(scope, [a], true).jobs.size, 0);
    assert.equal(f.store.stage(scope, [row('D1', { asin: 'B000000002' })], true).jobs.size, 1);
    f.store.confirm(scope, [row('D1', { asin: 'B000000002' })]);
    assert.equal(f.store.stage(scope, [a], true).jobs.size, 1, 'rotating back must not hit an old ASIN confirmation');
    assert.throws(() => groupListings([a, row('D1', { status: 'DELETED' })]), /Widersprüchliche/);
  } finally { f.close(); }
});

test('new/old design changes and text-relevant source changes invalidate only the affected design', () => {
  const f = fixture();
  try {
    const rows = [row('OLD'), row('LATEST')];
    f.store.stage(scope, rows, true); f.store.confirm(scope, rows);
    f.store.textDone(scope, 'OLD'); f.store.textDone(scope, 'LATEST');
    const result = f.store.stage(scope, [row('OLD', { productTitle: 'Changed' }), row('LATEST'), row('NEW')], true);
    assert.deepEqual([...result.jobs.keys()].sort(), ['NEW', 'OLD']);
    assert.equal(result.unchanged, 1);
  } finally { f.close(); }
});

test('pending work survives restart, partial confirmation and cache invalidation', () => {
  const f = fixture();
  f.store.stage(scope, [row('A'),row('B')], true);
  f.store.confirm(scope, [row('A')]);
  f.store.close();
  const reopened = new SyncStateRepository(f.file);
  try {
    assert.deepEqual([...reopened.stage(scope, [], true).jobs.keys()], ['B']);
    assert.deepEqual(reopened.textJobs(scope), ['A']);
    reopened.invalidate();
    assert.deepEqual([...reopened.stage(scope, [], true).jobs.keys()], ['B']);
    assert.equal(reopened.pending(scope), 2);
    assert.equal(reopened.state(scope).watermark, null);
  } finally { reopened.close(); fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('scope isolation, unknown identities and lost cache never skip writes', () => {
  const f = fixture();
  try {
    f.store.stage(scope, [row()], true); f.store.confirm(scope, [row()]);
    const other = syncScope('https://other.supabase.co', 'account-a');
    assert.equal(f.store.stage(other, [row()], true).jobs.size, 1);
    assert.notEqual(scope, syncScope('https://example.supabase.co', 'account-b'));
    assert.throws(() => syncScope('https://example.supabase.co', ''), /nicht verifiziert/);
    const unknown = row('X', { listingId: undefined });
    f.store.stage(scope, [unknown], true); f.store.confirm(scope, [unknown]);
    assert.equal(f.store.stage(scope, [unknown], true).jobs.size, 1);
    f.store.invalidate();
    assert.equal(f.store.stage(scope, [row()], true).jobs.has('D1'), true);
  } finally { f.close(); }
});

test('text retries retain their backoff during unchanged observation passes', () => {
  const f = fixture();
  try {
    f.store.stage(scope, [row()], false); f.store.confirm(scope, [row()]);
    f.store.textFailed(scope, 'D1');
    f.store.stage(scope, [row()], false); f.store.confirm(scope, [row()]);
    assert.equal(f.store.textJobs(scope).length, 0);
    assert.equal(f.store.pending(scope), 1);
  } finally { f.close(); }
});

async function withEngine(run: (h: any) => Promise<void>) {
  const f = fixture();
  const engine = SyncEngine as any;
  const names = ['syncStore','productScope','optimized','getSupabase','fetchProductConfig','parseTextData','shouldStop','currentScope','countsFetchedAt'];
  const saved = Object.fromEntries(names.map(name => [name, engine[name]]));
  const writes: any[][] = []; const reads: string[][] = [];
  const remote = new Map<string, any>();
  const h: any = { ...f, writes, reads, remote, failBlock: 0, productWrites: 0, failText: false, engine };
  engine.syncStore = f.store;
  engine.productScope = () => scope;
  engine.optimized = () => true;
  engine.shouldStop = false;
  engine.fetchProductConfig = async () => { if(h.failText) throw new Error('text failure'); return {}; };
  engine.parseTextData = (id: string) => ({ design_id: id, title_us: 'Title' });
  engine.getSupabase = () => ({ from: () => ({
    select: () => ({ in: async (_column: string, ids: string[]) => { reads.push(ids); return { data: ids.map(id => remote.get(id)).filter(Boolean), error: null }; } }),
    upsert: async (payload: any) => {
      if (!Array.isArray(payload)) { remote.set(payload.design_id, { ...remote.get(payload.design_id), ...payload }); return { error: null }; }
      h.productWrites++;
      if(h.productWrites === h.failBlock) return { error: { message: 'unknown write outcome' } };
      writes.push(payload);
      payload.forEach((r: any) => remote.set(r.design_id, { ...remote.get(r.design_id), ...r }));
      return { error: null };
    }
  }) });
  try { await run(h); } finally { for (const name of names) engine[name] = saved[name]; f.close(); }
}

test('engine performs zero product/text reads or writes for unchanged data after baseline', async () => {
  await withEngine(async h => {
    await h.engine.applyProductChanges({}, 'account-a', [row()], true);
    h.store.checkpoint(scope, new Date().toISOString(), true);
    const readCount = h.reads.length; const writes = h.writes.length;
    const result = await h.engine.applyProductChanges({}, 'account-a', [row()], false);
    assert.equal(result.count, 0); assert.equal(h.reads.length, readCount); assert.equal(h.writes.length, writes);
    assert.equal(h.store.pending(scope), 0);
    await h.engine.applyProductChanges({}, 'account-a', [row('D1', { listPrice: 21 })], false);
    assert.equal(h.writes.length, writes + 1);
  });
});

test('baseline gate and forced control repair missing target rows despite identical source', async () => {
  await withEngine(async h => {
    await h.engine.applyProductChanges({}, 'account-a', [row()], false);
    await h.engine.applyProductChanges({}, 'account-a', [row()], false);
    assert.equal(h.writes.length, 2, 'no full baseline means no skipping');
    h.store.checkpoint(scope, new Date().toISOString(), true);
    h.remote.delete('D1');
    await h.engine.applyProductChanges({}, 'account-a', [row()], true);
    assert.ok(h.remote.has('D1'));
  });
});

test('block failure confirms only successful designs; retry without Amazon rows recovers remaining work', async () => {
  await withEngine(async h => {
    const rows = Array.from({ length: 201 }, (_, i) => row(`D${i}`));
    h.failBlock = 2;
    await assert.rejects(h.engine.applyProductChanges({}, 'account-a', rows, false), /unknown write outcome/);
    assert.equal(h.store.stage(scope, [], true).jobs.size, 1);
    h.failBlock = 0;
    const result = await h.engine.applyProductChanges({}, 'account-a', [], false);
    assert.equal(result.count, 1);
    assert.equal(h.store.stage(scope, [], true).jobs.size, 0);
    assert.equal(h.remote.size, 201);
  });
});

test('failed text work remains independent when unchanged products are skipped', async () => {
  await withEngine(async h => {
    h.failText = true;
    await h.engine.applyProductChanges({}, 'account-a', [row()], true);
    h.store.checkpoint(scope, new Date().toISOString(), true);
    const result = await h.engine.applyProductChanges({}, 'account-a', [row()], false);
    assert.equal(result.count, 0); assert.equal(h.store.pending(scope), 1);
    assert.equal(h.reads.length, 1);
  });
});

test('status polling is coalesced and cached instead of issuing fresh database requests', async () => {
  const engine = SyncEngine as any;
  const oldGet = SupabaseService.getStats;
  const oldAt = engine.countsFetchedAt;
  let calls = 0;
  SupabaseService.getStats = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { totalDesigns: 0, liveDesigns: 0, unresolvedAsins: 0, sales30d: 0, royalties30dEur: 0, royalties30dUsd: 0 }; };
  engine.countsFetchedAt = 0;
  try {
    await Promise.all(Array.from({ length: 20 }, () => SyncEngine.refreshDBStats()));
    await SyncEngine.refreshDBStats();
    assert.equal(calls, 1);
  } finally { SupabaseService.getStats = oldGet; engine.countsFetchedAt = oldAt; }
});

async function smartFixture(h: any, pages: any[], action: (calls: () => number) => Promise<void>) {
  const names = ['getAmazonPage', 'getAccountId', 'fetchListingsPage', 'beginWorker', 'finishWorker', 'sleep'];
  const saved = Object.fromEntries(names.map(n => [n, h.engine[n]]));
  let calls = 0;
  h.engine.getAmazonPage = async () => ({});
  h.engine.getAccountId = async () => 'account-a';
  h.engine.fetchListingsPage = async () => pages[calls++];
  h.engine.beginWorker = () => 'test-run';
  h.engine.finishWorker = () => {};
  h.engine.sleep = async () => {};
  try { await action(() => calls); } finally { for(const n of names) h.engine[n] = saved[n]; }
}

test('smart sync reads past equal boundary timestamps and does not stop at the first equal entry', async () => {
  await withEngine(async h => {
    const boundary = 1789000000;
    h.store.checkpoint(scope, new Date((boundary + 86400) * 1000).toISOString(), true);
    await smartFixture(h, [
      { results: [row('A', { updatedDate: boundary })], pageToken: ['next'] },
      { results: [row('B', { updatedDate: boundary - 1 })], pageToken: [] }
    ], async calls => {
      await SyncEngine.runSmartSync();
      assert.equal(calls(), 2);
      assert.ok(h.remote.has('A')); assert.ok(h.remote.has('B'));
    });
  });
});

test('invalid source date never advances checkpoint or confirms cache', async () => {
  await withEngine(async h => {
    const watermark = new Date(1789000000000).toISOString();
    h.store.checkpoint(scope, watermark, true);
    await smartFixture(h, [{ results: [row('A', { updatedDate: 'not-a-date' })], pageToken: [] }], async () => {
      await assert.rejects(SyncEngine.runSmartSync(), /ungültiges Änderungsdatum/);
      assert.equal(h.store.state(scope).watermark, watermark);
      assert.equal(h.writes.length, 0);
    });
  });
});

test('page limit persists pending coverage instead of advancing the checkpoint', async () => {
  await withEngine(async h => {
    const watermark = new Date(1789000000000).toISOString();
    h.store.checkpoint(scope, watermark, true);
    const pages = Array.from({length: 10}, (_, i) => ({ results: [row(`D${i}`)], pageToken: [`p${i}`] }));
    await smartFixture(h, pages, async calls => {
      await SyncEngine.runSmartSync();
      assert.equal(calls(), 10); assert.equal(h.store.state(scope).watermark, watermark);
    });
  });
});

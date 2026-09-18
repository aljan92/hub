import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSecrets, SyncHealthService } from '../src/server/services/syncHealthService';
import { SyncStateRepository, syncScope } from '../src/server/storage/syncStateRepository';
import { SyncEngine } from '../src/server/services/syncEngine';
import fs from 'fs';
import os from 'os';
import path from 'path';

function healthFixture() {
  return {
    schemaVersion: 1 as const,
    updatedAt: new Date().toISOString(),
    workers: {},
    queues: { productJobs: 0, textJobs: 0, resolverRetries: 0, oldestTextJobAt: null, oldestResolverRetryAt: null },
    scheduler: { autoSyncUserEnabled: true, auditPauseActive: false, auditPauseLeaseUntil: null, lastTickAt: null, lastCatchUpAt: null },
    auditLease: null,
    storageWarning: null
  };
}

async function withInMemoryHealth(run: (data: any) => void | Promise<void>) {
  const service = SyncHealthService as any;
  const previousData = service.data;
  const previousSave = service.save;
  const data = healthFixture();
  service.data = data;
  service.save = () => {};
  try { await run(data); }
  finally { service.data = previousData; service.save = previousSave; }
}

test('health thresholds distinguish current, stale and repeatedly failing workers', async () => {
  await withInMemoryHealth(data => {
    const now = Date.now();
    data.workers.quick_products = {
      lastRunId: 'products', lastStartedAt: new Date(now - 10_000).toISOString(), lastSuccessAt: new Date(now - 30 * 60_000).toISOString(),
      lastFailureAt: null, lastFinishedAt: new Date(now - 9_000).toISOString(), lastDurationMs: 1000, lastStatus: 'complete',
      lastErrorCode: null, lastErrorMessage: null, consecutiveFailures: 0, attempted: 10, confirmed: 2, pages: 1
    };
    data.workers.snap_resolver = { ...data.workers.quick_products, lastRunId: 'resolver', lastSuccessAt: new Date(now - 130 * 60_000).toISOString() };
    const result = SyncHealthService.evaluate({ unresolvedResolveProducts: 4, fullRefreshAt: now - 2 * 24 * 60 * 60_000 });
    assert.equal(result.components.find(item => item.key === 'quick_products')?.status, 'healthy');
    assert.equal(result.components.find(item => item.key === 'snap_resolver')?.status, 'critical');
    assert.equal(result.components.find(item => item.key === 'full_products')?.status, 'healthy');
    assert.equal(result.overall, 'critical');
  });
});

test('resolver partial runs count as operational success while normal failures remain visible', async () => {
  await withInMemoryHealth(data => {
    SyncHealthService.begin('snap_resolver', 'r1');
    SyncHealthService.finish('snap_resolver', 'r1', 'partial', { attempted: 3, confirmed: 1, message: '2 bekannte Retries' });
    assert.ok(data.workers.snap_resolver.lastSuccessAt);
    assert.equal(data.workers.snap_resolver.consecutiveFailures, 0);
    SyncHealthService.begin('quick_products', 'p1');
    SyncHealthService.finish('quick_products', 'p1', 'error', { message: 'Supabase timeout' });
    assert.equal(data.workers.quick_products.lastErrorCode, 'TIMEOUT');
    assert.equal(data.workers.quick_products.consecutiveFailures, 1);
  });
});

test('audit lease preserves the previous preference and is released independently', async () => {
  await withInMemoryHealth(data => {
    const lease = SyncHealthService.acquireAuditLease('audit-1', false, 60_000);
    assert.equal(lease.previousAutoSyncEnabled, false);
    assert.equal(data.scheduler.autoSyncUserEnabled, true, 'audit pause must not rewrite the user preference');
    assert.equal(data.scheduler.auditPauseActive, true);
    SyncHealthService.releaseAuditLease('audit-1');
    assert.equal(data.scheduler.auditPauseActive, false);
    assert.equal(data.auditLease, null);
  });
});

test('startup recovery interrupts stale work and clears an orphaned audit pause', async () => {
  await withInMemoryHealth(data => {
    data.workers.system_audit = {
      lastRunId: 'audit-run', lastStartedAt: new Date(Date.now() - 60_000).toISOString(), lastSuccessAt: null, lastFailureAt: null,
      lastFinishedAt: null, lastDurationMs: null, lastStatus: 'running', lastErrorCode: null, lastErrorMessage: null,
      consecutiveFailures: 0, attempted: 0, confirmed: 0, pages: 0
    };
    data.auditLease = { auditId: 'audit-1', previousAutoSyncEnabled: true, acquiredAt: new Date(Date.now() - 60_000).toISOString(), leaseUntil: new Date(Date.now() + 60_000).toISOString(), status: 'active' };
    data.scheduler.auditPauseActive = true;
    const recovery = SyncHealthService.initialize(true);
    assert.equal(recovery.recoveredAudit, true);
    assert.equal(data.workers.system_audit.lastStatus, 'interrupted');
    assert.equal(data.scheduler.auditPauseActive, false);
    assert.equal(data.auditLease, null);
  });
});

test('audit secret redaction recursively strips credentials but keeps diagnostic identities', () => {
  const report = redactSecrets({
    designId: 'D123', asin: 'B000000001', authorization: 'Bearer secret',
    nested: { cookie: 'session=secret', message: 'Authorization: Bearer abc123; token=def456 request failed' }
  });
  assert.equal(report.designId, 'D123');
  assert.equal(report.asin, 'B000000001');
  assert.equal(report.authorization, '[REDACTED]');
  assert.equal(report.nested.cookie, '[REDACTED]');
  assert.doesNotMatch(report.nested.message || '', /abc123|def456/);
});

test('sync queue health reports product and text work separately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-health-'));
  const store = new SyncStateRepository(path.join(dir, 'state.sqlite'));
  const scope = syncScope('https://example.supabase.co', 'account');
  try {
    const row = { designId: 'D1', listingId: 'L1', marketplace: 'us', productType: 'MUG', asin: 'B000000001', updatedDate: 1789000000 };
    store.stage(scope, [row], false);
    let queue = store.queueHealth(scope);
    assert.equal(queue.productJobs, 1);
    assert.equal(queue.textJobs, 0);
    store.confirm(scope, [row]);
    queue = store.queueHealth(scope);
    assert.equal(queue.productJobs, 0);
    assert.equal(queue.textJobs, 1);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function runAuditHarness(options: { readError?: string; autoEnabled?: boolean } = {}) {
  const engine = SyncEngine as any;
  const service = SyncHealthService as any;
  const methodNames = [
    'beginWorker', 'finishWorker', 'stopSchedulers', 'startSchedulers', 'persistSystemAudit', 'createSystemAuditTextReport',
    'getAmazonPage', 'getAccountId', 'getHealth', 'loadRuntime', 'getSupabase', 'fetchListingsPage', 'recordTraffic',
    'refreshHealthQueues', 'queueCatchUp', 'store', 'sleep', 'productScope'
  ];
  const savedMethods = Object.fromEntries(methodNames.map(name => [name, engine[name]]));
  const savedFields = Object.fromEntries(['systemAudit', 'systemAuditCancelRequested', 'auditRequested', 'activeWorker', 'catchUpQueued', 'state'].map(name => [name, engine[name]]));
  const savedHealth = Object.fromEntries(['acquireAuditLease', 'renewAuditLease', 'releaseAuditLease', 'snapshot'].map(name => [name, service[name]]));
  let schedulerStops = 0;
  let schedulerStarts = 0;
  let catchUps = 0;
  let mutations = 0;
  const auditId = 'audit-test';
  const now = new Date().toISOString();
  engine.systemAudit = {
    schemaVersion: 1, auditId, status: 'queued', startedAt: now, updatedAt: now, finishedAt: null, currentPhase: 'queued',
    progress: { completedPhases: 0, totalPhases: 7, pages: 0, records: 0, message: '' },
    autoSync: { previouslyEnabled: true, pauseActive: false, restored: false },
    health: {}, preflight: {}, schedulerAudit: {}, adAsinAudit: {}, resolverAudit: {}, syncAudit: {}, lifecycleAudit: {}, findings: [],
    reportPath: 'data/audits/test.json', textReportPath: null, error: null
  };
  engine.systemAuditCancelRequested = false;
  engine.auditRequested = true;
  engine.activeWorker = null;
  engine.catchUpQueued = false;
  engine.state = { ...savedFields.state, autoUpdateEnabled: options.autoEnabled !== false, isScanning: false, activeScanType: null };
  const health = { overall: 'healthy', components: [], data: { workers: {}, queues: { productJobs: 0, textJobs: 0, resolverRetries: 0 }, scheduler: {} } };
  const row = {
    design_id: 'D1', status: 'PUBLISHED', asin_resolved: true,
    published_products: [{ asin: 'B000000001', type: 'STANDARD_TSHIRT', market: 'us' }],
    ad_asins: [{ asin: 'B000000001', parentAsin: 'B000000001', type: 'STANDARD_TSHIRT', market: 'us' }]
  };
  engine.beginWorker = () => { engine.activeWorker = 'system_audit'; engine.state.isScanning = true; return 'run-test'; };
  engine.finishWorker = () => { engine.activeWorker = null; engine.state.isScanning = false; };
  engine.stopSchedulers = () => { schedulerStops++; };
  engine.startSchedulers = () => { schedulerStarts++; };
  engine.persistSystemAudit = () => {};
  engine.createSystemAuditTextReport = () => {};
  engine.getAmazonPage = async () => ({});
  engine.getAccountId = async () => 'account';
  engine.productScope = () => 'scope';
  engine.getHealth = () => health;
  engine.loadRuntime = () => ({ version: 1, productWatermark: now, resolverRetries: {}, resolverObservations: {} });
  engine.fetchListingsPage = async () => ({ results: [{ designId: 'D1', asin: 'B000000001', marketplace: 'us', productType: 'STANDARD_TSHIRT', status: 'PUBLISHED' }], pageToken: [] });
  engine.recordTraffic = () => {};
  engine.refreshHealthQueues = () => {};
  engine.queueCatchUp = () => { catchUps++; };
  engine.store = () => ({ metrics: () => [] });
  engine.sleep = async () => {};
  engine.getSupabase = () => ({
    from: () => ({
      select: () => ({ order: () => ({ range: async () => ({ data: options.readError ? null : [row], error: options.readError ? { message: options.readError } : null }) }) }),
      update: () => { mutations++; throw new Error('audit attempted update'); },
      upsert: () => { mutations++; throw new Error('audit attempted upsert'); },
      delete: () => { mutations++; throw new Error('audit attempted delete'); }
    })
  });
  service.acquireAuditLease = () => ({});
  service.renewAuditLease = () => {};
  service.releaseAuditLease = () => {};
  service.snapshot = () => health.data;
  try {
    await engine.executeSystemAudit(auditId);
    return { report: structuredClone(engine.systemAudit), schedulerStops, schedulerStarts, catchUps, mutations };
  } finally {
    for (const [name, value] of Object.entries(savedMethods)) engine[name] = value;
    for (const [name, value] of Object.entries(savedFields)) engine[name] = value;
    for (const [name, value] of Object.entries(savedHealth)) service[name] = value;
  }
}

test('one-click audit is read-only and always restores active auto-sync after success', async () => {
  const result = await runAuditHarness();
  assert.ok(['complete', 'complete_with_warnings'].includes(result.report.status), JSON.stringify(result.report));
  assert.equal(result.report.autoSync.restored, true);
  assert.equal(result.report.autoSync.pauseActive, false);
  assert.equal(result.mutations, 0);
  assert.equal(result.schedulerStops, 1);
  assert.equal(result.schedulerStarts, 1);
  assert.equal(result.catchUps, 1);
});

test('one-click audit restores active auto-sync after a read failure', async () => {
  const result = await runAuditHarness({ readError: 'read failed' });
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.autoSync.restored, true);
  assert.equal(result.report.autoSync.pauseActive, false);
  assert.equal(result.mutations, 0);
  assert.equal(result.schedulerStarts, 1);
  assert.equal(result.catchUps, 1);
});

test('one-click audit never enables auto-sync when it was disabled before the audit', async () => {
  const result = await runAuditHarness({ autoEnabled: false });
  assert.ok(['complete', 'complete_with_warnings'].includes(result.report.status), JSON.stringify(result.report));
  assert.equal(result.report.autoSync.previouslyEnabled, false);
  assert.equal(result.report.autoSync.restored, true);
  assert.equal(result.schedulerStarts, 0);
  assert.equal(result.catchUps, 0);
});

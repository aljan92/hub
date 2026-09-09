import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QueueService } from '../src/server/services/queueService';
import { getHubUpdatePriorityTimestamp, hasVerifiedZeroSales, sortCandidatesByHubUpdatePriority } from '../src/server/services/updateBackfillService';
import { isUpdateQueueItem, UpdateMetadataService, writeSkipUpdateFlag, writeSuccessfulUpdateMetadata } from '../src/server/services/updateMetadataService';

async function run() {
  const ordered = sortCandidatesByHubUpdatePriority([
    { id: 'newer-created', created_date: '2025-01-30T00:00:00Z', mba_hub_updated_at: null },
    { id: 'older-hub', created_date: '2024-01-01T00:00:00Z', mba_hub_updated_at: '2025-01-29T00:00:00Z' },
    { id: 'newest-hub', created_date: '2023-01-01T00:00:00Z', mba_hub_updated_at: '2025-02-01T00:00:00Z' }
  ]);
  assert.deepEqual(ordered.map(x => x.id), ['older-hub', 'newer-created', 'newest-hub']);
  assert.equal(getHubUpdatePriorityTimestamp({ created_date: 'invalid', mba_hub_updated_at: null }), Number.POSITIVE_INFINITY);

  let table = '';
  let values: Record<string, unknown> = {};
  let filter: [string, string] | null = null;
  const fakeClient: any = {
    from(name: string) {
      table = name;
      return {
        update(nextValues: Record<string, unknown>) {
          values = nextValues;
          return {
            eq(column: string, value: string) {
              filter = [column, value];
              return {
                select() {
                  return { maybeSingle: async () => ({ data: { design_id: value }, error: null }) };
                }
              };
            }
          };
        }
      };
    }
  };

  const confirmedAt = '2026-09-05T12:34:56.000Z';
  await writeSuccessfulUpdateMetadata(fakeClient, '#amazon-design-1-U', confirmedAt);
  assert.equal(table, 'mba_designs');
  assert.deepEqual(values, { mba_hub_updated_at: confirmedAt, skip_update: false });
  assert.deepEqual(filter, ['design_id', 'amazon-design-1']);

  await writeSkipUpdateFlag(fakeClient, '#amazon-design-2-U');
  assert.deepEqual(values, { skip_update: true });
  assert.deepEqual(filter, ['design_id', 'amazon-design-2']);

  assert.equal(hasVerifiedZeroSales({ sales_total: 0, sales_history_synced: true }), true);
  assert.equal(hasVerifiedZeroSales({ sales_total: '0', sales_history_synced: true }), true);
  assert.equal(hasVerifiedZeroSales({ sales_total: null, sales_history_synced: true }), false);
  assert.equal(hasVerifiedZeroSales({ sales_total: 0, sales_history_synced: false }), false);
  assert.equal(hasVerifiedZeroSales({ sales_total: 1, sales_history_synced: true }), false);

  const missingClient: any = {
    from: () => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
      })
    })
  };
  await assert.rejects(() => writeSuccessfulUpdateMetadata(missingClient, 'missing', confirmedAt), /nicht gefunden/);

  assert.equal(isUpdateQueueItem({ type: 'update', taskId: '#001-U' }), true);
  assert.equal(isUpdateQueueItem({ type: 'new', source: 'HERMES', taskId: '#001-H' }), false);

  const testDir = path.resolve(process.cwd(), 'scratch', `update_metadata_${Date.now()}`);
  const queuePath = path.join(testDir, 'queue.json');
  fs.mkdirSync(testDir, { recursive: true });
  const originalMarker = UpdateMetadataService.markSuccessfulUpdate;
  try {
    QueueService.setCustomQueuePath(queuePath);
    (QueueService as any).items = [
      {
        id: 'update-item', taskId: '#002-U', type: 'update', source: 'UPDATE', designId: 'design-2',
        status: 'COMPLETED', uploadRecovery: { phase: 'AMAZON_CONFIRMED', attempt: 1, amazonConfirmedAt: confirmedAt }
      },
      {
        id: 'new-item', taskId: '#003-H', type: 'new', source: 'HERMES', designId: 'design-3',
        status: 'COMPLETED', uploadRecovery: { phase: 'AMAZON_CONFIRMED', attempt: 1, amazonConfirmedAt: confirmedAt }
      }
    ];
    (QueueService as any).isLoaded = true;
    QueueService.saveQueue();

    const calls: Array<[string, string]> = [];
    UpdateMetadataService.markSuccessfulUpdate = async (designId: string, timestamp: string) => {
      calls.push([designId, timestamp]);
      return { success: true };
    };
    const retry = await UpdateMetadataService.retryPendingConfirmedUpdates();
    assert.deepEqual(retry, { attempted: 1, succeeded: 1 });
    assert.deepEqual(calls, [['design-2', confirmedAt]]);
    const saved = QueueService.loadQueue();
    assert.equal(saved.find(x => x.id === 'update-item')?.uploadRecovery?.hubMetadataSync?.status, 'SUCCESS');
    assert.equal(saved.find(x => x.id === 'new-item')?.uploadRecovery?.hubMetadataSync, undefined);
  } finally {
    UpdateMetadataService.markSuccessfulUpdate = originalMarker;
    QueueService.setCustomQueuePath();
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const syncSource = fs.readFileSync(new URL('../src/server/services/syncEngine.ts', import.meta.url), 'utf8');
  const allowlistStart = syncSource.indexOf('const PRODUCT_SYNC_COLUMNS');
  const allowlistEnd = syncSource.indexOf(']);', allowlistStart);
  assert(allowlistStart >= 0 && allowlistEnd > allowlistStart, 'Product sync must use an explicit write allowlist');
  const productAllowlist = syncSource.slice(allowlistStart, allowlistEnd);
  assert.doesNotMatch(productAllowlist, /mba_hub_updated_at/);
  assert.doesNotMatch(productAllowlist, /skip_update/);
  const fullSalesStart = syncSource.indexOf('public static async runFullSalesHistory');
  const zeroSalesBaseline = syncSource.indexOf('sales_total: 0', fullSalesStart);
  assert(fullSalesStart >= 0 && zeroSalesBaseline > fullSalesStart, 'Zero-sales baseline must only be written by full sales history sync');
  const quickSalesStart = syncSource.indexOf('public static async runSmartSalesSync');
  assert.doesNotMatch(syncSource.slice(quickSalesStart, fullSalesStart), /sales_total:\s*0/, 'Quick sales sync must not reset all-time sales');

  const backfillSource = fs.readFileSync(new URL('../src/server/services/updateBackfillService.ts', import.meta.url), 'utf8');
  assert.match(backfillSource, /\.eq\('skip_update', false\)/, 'Automatic selection must exclude skip_update=true');
  assert.match(backfillSource, /\.eq\('sales_history_synced', true\)/, 'Automatic selection must require verified sales history');
  assert.match(backfillSource, /\.eq\('sales_total', 0\)/, 'Automatic selection must require exactly zero sales');

  const uploadSource = fs.readFileSync(new URL('../src/server/services/uploadWorkerService.ts', import.meta.url), 'utf8');
  const confirmedBoundary = uploadSource.indexOf("phase: 'AMAZON_CONFIRMED'");
  const metadataWrite = uploadSource.indexOf('UpdateMetadataService.markSuccessfulUpdate', confirmedBoundary);
  assert(confirmedBoundary >= 0 && metadataWrite > confirmedBoundary, 'Metadata write must occur only after AMAZON_CONFIRMED persistence');

  console.log('PASS update metadata: priority, exact fields, update-only retry, sync ownership and confirmation boundary');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

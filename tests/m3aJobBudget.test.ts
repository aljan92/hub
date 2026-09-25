import assert from 'node:assert/strict';
import { getOperationalMetrics, measureJob } from '../src/server/services/operationalMetrics';
import { UpdateMetadataService } from '../src/server/services/updateMetadataService';
import { QueueService } from '../src/server/services/queueService';

let release!: () => void;
const held = new Promise<void>(resolve => { release = resolve; });
const running = measureJob('m3a-test', '#test', async () => { await held; return 7; });
assert(getOperationalMetrics().jobs.active.some(job => job.kind === 'm3a-test' && job.taskId === '#test'));
release();
assert.equal(await running, 7);
assert(getOperationalMetrics().jobs.recent.some(job => job.kind === 'm3a-test' && job.status === 'ok'));

const originalLoadQueue = QueueService.loadQueue;
const originalMark = UpdateMetadataService.markSuccessfulUpdate;
const originalUpdate = QueueService.updateItemUploadRecovery;
let marks = 0;
let unblock!: () => void;
const blocker = new Promise<void>(resolve => { unblock = resolve; });
try {
  QueueService.loadQueue = () => [{
    id: 'queue-test', taskId: '#test-U', source: 'UPDATE', type: 'update', designId: 'test',
    uploadRecovery: { phase: 'AMAZON_CONFIRMED', amazonConfirmedAt: new Date().toISOString() }
  }] as ReturnType<typeof QueueService.loadQueue>;
  UpdateMetadataService.markSuccessfulUpdate = async () => { marks++; await blocker; return { success: true }; };
  QueueService.updateItemUploadRecovery = (() => undefined) as typeof QueueService.updateItemUploadRecovery;
  const first = UpdateMetadataService.retryPendingConfirmedUpdates();
  const second = UpdateMetadataService.retryPendingConfirmedUpdates();
  assert.strictEqual(first, second, 'concurrent timer ticks share one metadata pass');
  unblock();
  assert.deepEqual(await first, { attempted: 1, succeeded: 1 });
  assert.equal(marks, 1);
} finally {
  unblock();
  QueueService.loadQueue = originalLoadQueue;
  UpdateMetadataService.markSuccessfulUpdate = originalMark;
  QueueService.updateItemUploadRecovery = originalUpdate;
}

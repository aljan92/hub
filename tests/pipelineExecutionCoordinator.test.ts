import assert from 'node:assert/strict';
import { PipelineExecutionCoordinator } from '../src/server/services/pipelineExecutionCoordinator';
import { UpdateBackfillService } from '../src/server/services/updateBackfillService';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

PipelineExecutionCoordinator.resetForTests();
let concurrent = 0;
let maximumConcurrent = 0;
const order: string[] = [];
let waitingNoticeCount = 0;

const first = PipelineExecutionCoordinator.runExclusive('design-1', async () => {
  concurrent++;
  maximumConcurrent = Math.max(maximumConcurrent, concurrent);
  order.push('design-1:start');
  await delay(30);
  order.push('design-1:end');
  concurrent--;
});
const second = PipelineExecutionCoordinator.runExclusive('update-2', async () => {
  concurrent++;
  maximumConcurrent = Math.max(maximumConcurrent, concurrent);
  order.push('update-2:start');
  await PipelineExecutionCoordinator.runExclusive('nested', async () => {
    order.push('update-2:nested');
  });
  order.push('update-2:end');
  concurrent--;
}, () => { waitingNoticeCount++; });

await Promise.all([first, second]);
assert.equal(maximumConcurrent, 1, 'Only one resource-intensive pipeline may run at a time');
assert.equal(waitingNoticeCount, 1, 'Queued task receives one waiting notification');
assert.deepEqual(order, [
  'design-1:start', 'design-1:end', 'update-2:start', 'update-2:nested', 'update-2:end'
], 'Pipelines execute FIFO while nested continuation remains re-entrant');
assert.deepEqual(PipelineExecutionCoordinator.getSnapshot(), { activeTaskId: null, waitingTaskIds: [] });

const service = UpdateBackfillService as any;
const originalExclusive = service.runBackfillCycleExclusive;
let backfillCalls = 0;
let releaseBackfill!: () => void;
const held = new Promise<void>(resolve => { releaseBackfill = resolve; });
service.runBackfillCycleExclusive = async () => {
  backfillCalls++;
  await held;
  return { success: true, message: 'done', designId: 'one' };
};
try {
  const running = UpdateBackfillService.runBackfillCycle(false);
  const duplicate = await UpdateBackfillService.runBackfillCycle(false);
  assert.equal(duplicate.success, false);
  assert.match(duplicate.message, /bereits gezogen|zusammengefasst/);
  assert.equal(backfillCalls, 1, 'Concurrent triggers must share one atomic backfill flight');
  releaseBackfill();
  assert.equal((await running).success, true);
} finally {
  service.runBackfillCycleExclusive = originalExclusive;
}

console.log('PASS pipeline coordinator: FIFO capacity one, re-entrancy, waiting state and atomic backfill single-flight');

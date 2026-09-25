import assert from 'node:assert/strict';
import { TaskExecutionLock } from '../src/server/services/taskExecutionLock';
import { PipelineExecutionCoordinator } from '../src/server/services/pipelineExecutionCoordinator';

TaskExecutionLock.clear();
PipelineExecutionCoordinator.resetForTests();

let releaseFirst!: () => void;
const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
let signalFirst!: () => void;
const firstReady = new Promise<void>(resolve => { signalFirst = resolve; });

const first = TaskExecutionLock.runWithExecution(async () => {
  assert.equal(TaskExecutionLock.acquire('task-1', 'NORMAL'), true);
  signalFirst();
  await firstHeld;
  assert.equal(TaskExecutionLock.acquire('task-1', 'NORMAL'), true, 'Nested call in one execution may reenter');
  TaskExecutionLock.release('task-1');
  TaskExecutionLock.release('task-1');
});
await firstReady;

await TaskExecutionLock.runWithExecution(async () => {
  assert.equal(TaskExecutionLock.acquire('task-1', 'NORMAL'), false, 'Same owner in another execution is not reentrant');
  assert.equal(TaskExecutionLock.acquire('task-1', 'RECOVERY'), false, 'Different owner is blocked');
});
releaseFirst();
await first;
assert.equal(TaskExecutionLock.isLocked('task-1'), false);

await TaskExecutionLock.runWithExecution(async () => {
  assert.equal(TaskExecutionLock.acquire('recovery-task', 'RECOVERY'), true);
  await PipelineExecutionCoordinator.runExclusive('recovery-task', async () => {
    assert.equal(TaskExecutionLock.acquire('recovery-task', 'RECOVERY'), true, 'Recovery continuation inherits its execution token');
    TaskExecutionLock.release('recovery-task');
  });
  TaskExecutionLock.release('recovery-task');
});
assert.equal(TaskExecutionLock.isLocked('recovery-task'), false);
assert.deepEqual(PipelineExecutionCoordinator.getSnapshot(), { activeTaskId: null, waitingTaskIds: [] });

let releaseDetached!: () => void;
const detachedGate = new Promise<void>(resolve => { releaseDetached = resolve; });
let detached!: Promise<void>;
const order: string[] = [];
await PipelineExecutionCoordinator.runExclusive('first', async () => {
  detached = (async () => {
    await detachedGate;
    await PipelineExecutionCoordinator.runExclusive('detached', async () => { order.push('detached'); });
  })();
});
let releaseBlocker!: () => void;
const blockerGate = new Promise<void>(resolve => { releaseBlocker = resolve; });
const blocker = PipelineExecutionCoordinator.runExclusive('blocker', async () => {
  order.push('blocker:start');
  await blockerGate;
  order.push('blocker:end');
});
releaseDetached();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(order, ['blocker:start'], 'Detached child cannot reuse a released coordinator slot');
releaseBlocker();
await Promise.all([blocker, detached]);
assert.deepEqual(order, ['blocker:start', 'blocker:end', 'detached']);

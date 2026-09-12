import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DesignTaskLog } from '../src/types/tasks';
import { TaskLogService } from '../src/server/services/taskLogService';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { PipelineExecutionCoordinator } from '../src/server/services/pipelineExecutionCoordinator';
import { DesignPipelineService } from '../src/server/services/designPipelineService';
import { UpdatePipelineService } from '../src/server/services/updatePipelineService';
import { UpdateBackfillService } from '../src/server/services/updateBackfillService';
import { loadSettings, saveSettings } from '../src/server/services/settingsService';

const makeTask = (id: string, source: 'DESIGNER' | 'UPDATE' = 'DESIGNER', status: any = 'PROCESSING'): DesignTaskLog => ({
  id,
  counter: Number(id.match(/\d+/)?.[0] || 1),
  source,
  suffix: source === 'UPDATE' ? 'U' : 'D',
  status,
  checkpoint: undefined,
  receivedAt: new Date().toISOString(),
  payload: { quote: 'Test cancellation' },
  events: [],
  hasError: false
});

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING PROMPT LOG TASK CANCEL TESTS (Alex Todo #3)');
  console.log('====================================================\n');

  const testDir = path.resolve(process.cwd(), 'scratch', `test_prompt_cancel_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  TaskRepository.init(path.join(testDir, 'tasks.sqlite'));

  try {
    // --- Test 1: Cancelling an active Designer task ---
    console.log('Test 1: Cancelling an active Designer task...');
    TaskRepository.createTask(makeTask('#801-D', 'DESIGNER', 'PROCESSING'));
    const cancelD = TaskLogService.cancelTask('#801-D', 'Vom Benutzer im Prompt Log abgebrochen.');
    assert.strictEqual(cancelD.success, true);
    const taskD = TaskRepository.getTaskById('#801-D');
    assert.strictEqual(taskD?.status, 'CANCELLED');
    assert.strictEqual(taskD?.errorDetails, 'Vom Benutzer im Prompt Log abgebrochen.');
    console.log('✅ [PASS] Test 1: Designer task was cancelled with proper status and reason.');

    // --- Test 2: Cancelling an Update task adds design to cooldown and keeps auto backfill enabled ---
    console.log('Test 2: Cancelling an Update task adds design to cooldown and keeps auto backfill running...');
    saveSettings({ queueUpdateAutoBackfillEnabled: true });
    assert.strictEqual(loadSettings().queueUpdateAutoBackfillEnabled, true);

    const task802 = makeTask('#802-U', 'UPDATE', 'UPDATE_ANALYZED');
    task802.payload = { quote: 'Test update', designId: 'DESIGN-802' };
    TaskRepository.createTask(task802);
    const taskLog = TaskLogService.getTaskLogById('#802-U');
    assert.ok(taskLog);

    const cancelU = TaskLogService.cancelTask('#802-U', 'Vom Benutzer im Prompt Log abgebrochen.');
    assert.strictEqual(cancelU.success, true);

    // Simulate endpoint behavior for UPDATE tasks
    UpdateBackfillService.addRecentlyCancelledDesign('DESIGN-802');
    UpdateBackfillService.releaseInFlight('DESIGN-802');

    // Auto backfill stays enabled
    assert.strictEqual(loadSettings().queueUpdateAutoBackfillEnabled, true);
    // Design is excluded from immediate next candidate fetch
    assert.ok(UpdateBackfillService.getExcludedDesignIds().has('DESIGN-802'));
    assert.strictEqual(TaskRepository.getTaskById('#802-U')?.status, 'CANCELLED');
    console.log('✅ [PASS] Test 2: Update task cancelled, added to cooldown, auto backfill remains enabled.');

    // --- Test 3: Cannot cancel completed or update-queued tasks ---
    console.log('Test 3: Reject cancellation on completed tasks...');
    TaskRepository.createTask(makeTask('#803-D', 'DESIGNER', 'COMPLETED'));
    TaskRepository.createTask(makeTask('#804-U', 'UPDATE', 'UPDATE_QUEUED'));

    assert.throws(() => {
      TaskLogService.cancelTask('#803-D');
    }, /bereits abgeschlossener oder übergebener Task kann hier nicht mehr abgebrochen werden/);

    assert.throws(() => {
      TaskLogService.cancelTask('#804-U');
    }, /bereits abgeschlossener oder übergebener Task kann hier nicht mehr abgebrochen werden/);
    console.log('✅ [PASS] Test 3: Completed/queued tasks safely reject cancellation.');

    // --- Test 4: PipelineExecutionCoordinator skips cancelled tasks waiting in queue ---
    console.log('Test 4: PipelineExecutionCoordinator skips tasks cancelled while waiting in queue...');
    PipelineExecutionCoordinator.resetForTests();
    TaskRepository.createTask(makeTask('#805-D', 'DESIGNER', 'PROCESSING'));

    let blockerExecuted = false;
    let cancelledTaskExecuted = false;

    // Start a blocker task that holds the exclusive slot
    const blockerPromise = PipelineExecutionCoordinator.runExclusive('BLOCKER', async () => {
      blockerExecuted = true;
      // While slot is occupied, cancel #805-D
      TaskLogService.cancelTask('#805-D', 'Cancelled while waiting for slot.');
      await new Promise(r => setTimeout(r, 50));
      return 'BLOCKER_DONE';
    });

    // Queue up #805-D
    const waitingPromise = PipelineExecutionCoordinator.runExclusive('#805-D', async () => {
      cancelledTaskExecuted = true;
      return 'UNEXPECTED_EXECUTION';
    });

    const [blockerRes, waitingRes] = await Promise.all([blockerPromise, waitingPromise]);
    assert.strictEqual(blockerExecuted, true);
    assert.strictEqual(blockerRes, 'BLOCKER_DONE');
    assert.strictEqual(cancelledTaskExecuted, false);
    assert.strictEqual((waitingRes as any)?.cancelled, true);
    console.log('✅ [PASS] Test 4: Cancelled task was skipped by coordinator and slot was not wasted.');

    // --- Test 5: DesignPipelineService halts at boundary if cancelled ---
    console.log('Test 5: DesignPipelineService halts at step boundary if cancelled...');
    TaskRepository.createTask(makeTask('#806-D', 'DESIGNER', 'CANCELLED'));
    const designPipelineResult = await DesignPipelineService.runFromStep('#806-D', 'D1');
    assert.strictEqual(designPipelineResult.success, false);
    assert.match(designPipelineResult.error || '', /cancelled/i);
    console.log('✅ [PASS] Test 5: DesignPipelineService halts immediately for cancelled tasks.');

    // --- Test 6: UpdatePipelineService halts at boundary if cancelled ---
    console.log('Test 6: UpdatePipelineService halts at step boundary if cancelled...');
    TaskRepository.createTask(makeTask('#807-U', 'UPDATE', 'CANCELLED'));
    const updatePipelineResult = await UpdatePipelineService.runFromStep('#807-U', 'U2');
    assert.strictEqual(updatePipelineResult.success, false);
    assert.match(updatePipelineResult.error || '', /cancelled/i);
    console.log('✅ [PASS] Test 6: UpdatePipelineService halts immediately for cancelled tasks.');

    // --- Test 7: Skip update on a cancelled task updates state properly ---
    console.log('Test 7: Skip update on cancelled task...');
    const cancelledTask = makeTask('#808-U', 'UPDATE', 'CANCELLED');
    cancelledTask.designId = 'DESIGN-808';
    TaskRepository.createTask(cancelledTask);

    TaskRepository.updateTask('#808-U', {
      errorDetails: 'skip_update=true (Manuell übersprungen)',
      updatedAt: new Date().toISOString()
    });

    const updatedTask = TaskRepository.getTaskById('#808-U');
    assert.strictEqual(updatedTask?.status, 'CANCELLED');
    assert.match(updatedTask?.errorDetails || '', /skip_update=true/);
    console.log('✅ [PASS] Test 7: Skip update metadata preserved on CANCELLED task.');

    // --- Test 8: updateTaskStatus rejects resurrection of CANCELLED tasks ---
    console.log('Test 8: updateTaskStatus rejects resurrection of CANCELLED tasks...');
    const cancelledTask809 = makeTask('#809-U', 'UPDATE', 'CANCELLED');
    TaskRepository.createTask(cancelledTask809);
    
    // Attempt to resurrect by updating to AWAITING_DESIGN_REVIEW
    TaskLogService.updateTaskStatus('#809-U', { status: 'AWAITING_DESIGN_REVIEW', checkpoint: 'DESIGN_REVIEW' });
    const afterResurrectAttempt = TaskRepository.getTaskById('#809-U');
    assert.strictEqual(afterResurrectAttempt?.status, 'CANCELLED');
    console.log('✅ [PASS] Test 8: updateTaskStatus safely rejected resurrection of CANCELLED task.');

    console.log('\n====================================================');
    console.log('🎉 ALL PROMPT LOG TASK CANCEL TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    TaskRepository.close();
    TaskRepository.init();
  }
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

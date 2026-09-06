import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DesignTaskLog } from '../src/types/tasks';
import { TaskLogService } from '../src/server/services/taskLogService';
import { TaskRepository } from '../src/server/storage/taskRepository';

const makeTask = (id: string, source: 'DESIGNER' | 'UPDATE' = 'DESIGNER'): DesignTaskLog => ({
  id,
  counter: Number(id.match(/\d+/)?.[0] || 1),
  source,
  suffix: source === 'UPDATE' ? 'U' : 'D',
  status: source === 'UPDATE' ? 'UPDATE_ANALYZED' : 'AWAITING_DESIGN_REVIEW',
  checkpoint: source === 'UPDATE' ? 'UPDATE_REVIEW' : 'DESIGN_REVIEW',
  receivedAt: new Date().toISOString(),
  payload: { quote: 'Review persistence' },
  events: [],
  hasError: false
});

async function run() {
  const testDir = path.resolve(process.cwd(), 'scratch', `test_review_persistence_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  TaskRepository.init(path.join(testDir, 'tasks.sqlite'));

  try {
    TaskRepository.createTask(makeTask('#901-D'));
    assert.equal(TaskRepository.getAwaitingTaskSummaries().length, 1);

    const discarded = await TaskLogService.submitDesignReview('#901-D', { action: 'DISCARD' });
    assert.equal(discarded.success, true);
    assert.equal(TaskRepository.getTaskById('#901-D')?.status, 'CANCELLED');
    assert.equal(TaskRepository.getAwaitingTaskSummaries().length, 0);

    TaskRepository.createTask(makeTask('#902-U', 'UPDATE'));
    const cancelled = TaskLogService.cancelTask('#902-U');
    assert.equal(cancelled.success, true);
    assert.equal(TaskRepository.getTaskById('#902-U')?.status, 'CANCELLED');
    assert.equal(TaskRepository.getTaskById('#902-U')?.checkpoint, undefined);
    assert.equal(TaskRepository.getAwaitingTaskSummaries().length, 0);

    console.log('✅ Review decisions and cancellation persist atomically.');
  } finally {
    TaskRepository.close();
    TaskRepository.init();
  }
}

void run();

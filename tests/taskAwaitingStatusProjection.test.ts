import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  DesignTaskLog,
  TASK_STATUSES_AWAITING_USER_ACTION,
  TaskStatus,
  isTaskAwaitingUserAction
} from '../src/types/tasks';
import { TaskRepository } from '../src/server/storage/taskRepository';

function makeTask(counter: number, status: TaskStatus): DesignTaskLog {
  return {
    id: `#${String(counter).padStart(3, '0')}-T`,
    counter,
    source: 'TEST',
    suffix: 'T',
    status,
    receivedAt: new Date(1700000000000 + counter * 1000).toISOString(),
    payload: { quote: status },
    events: [],
    hasError: false
  };
}

function run() {
  const testDir = path.resolve(process.cwd(), 'scratch', `test_awaiting_status_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  const testDbPath = path.join(testDir, 'tasks.sqlite');
  TaskRepository.init(testDbPath);

  try {
    const expectedStatuses = [
      'AWAITING_PRE_FLIGHT_REVIEW',
      'AWAITING_DESIGN_REVIEW',
      'AWAITING_TM_REVIEW',
      'AWAITING_SVG_REVIEW',
      'AWAITING_RECOVERY_REVIEW',
      'UPDATE_ANALYZED'
    ] as const;

    assert.deepStrictEqual(TASK_STATUSES_AWAITING_USER_ACTION, expectedStatuses);
    expectedStatuses.forEach(status => assert.strictEqual(isTaskAwaitingUserAction(status), true));
    assert.strictEqual(isTaskAwaitingUserAction('PROCESSING'), false);
    assert.strictEqual(isTaskAwaitingUserAction('COMPLETED'), false);

    expectedStatuses.forEach((status, index) => TaskRepository.createTask(makeTask(index + 1, status)));
    TaskRepository.createTask(makeTask(100, 'PROCESSING'));
    TaskRepository.createTask(makeTask(101, 'COMPLETED'));

    const projectedStatuses = new Set(TaskRepository.getAwaitingTaskSummaries().map(task => task.status));
    assert.strictEqual(projectedStatuses.size, expectedStatuses.length);
    expectedStatuses.forEach(status => assert.strictEqual(projectedStatuses.has(status), true));

    console.log('✅ Awaiting task status projection is centralized and complete.');
  } finally {
    TaskRepository.close();
    TaskRepository.init();
  }
}

run();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskLogService } from '../src/server/services/taskLogService';

test('designer request identity survives reopening the database and rolls back with a failed task insert', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-designer-request-'));
  const dbPath = path.join(dir, 'tasks.sqlite');
  try {
    TaskRepository.init(dbPath);
    const task: any = { id: '#001-D', counter: 1, suffix: 'D', source: 'DESIGNER', status: 'RECEIVED', receivedAt: new Date().toISOString(), payload: { niche1: 'Gardening' }, events: [] };
    TaskRepository.createTask(task, { id: 'request_one', inputHash: 'hash_one' });
    assert.equal(TaskRepository.findDesignerRequest('request_one')?.task.id, '#001-D');
    assert.throws(() => TaskRepository.createTask({ ...task, id: '#002-D', counter: 2 }, { id: 'request_one', inputHash: 'hash_two' }));
    assert.equal(TaskRepository.getTaskById('#002-D'), null);
    TaskRepository.close();
    TaskRepository.init(dbPath);
    assert.equal(TaskRepository.findDesignerRequest('request_one')?.inputHash, 'hash_one');
  } finally {
    TaskRepository.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy GPT Image 2.0 retry is refused before task state changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-legacy-image-'));
  const originalProcess = TaskLogService.processTaskWithOpenRouter;
  (TaskLogService as any).processTaskWithOpenRouter = () => Promise.resolve();
  try {
    TaskRepository.init(path.join(dir, 'tasks.sqlite'));
    const task = TaskLogService.createTaskLog({ source: 'DESIGNER', payload: { niche1: 'Gardening', imageProvider: 'GPT_IMAGE_2' } });
    TaskRepository.updateTask(task.id, { status: 'ERROR', imageGeneration: { ...task.imageGeneration!, model: 'openai/gpt-image-2' } });
    const before = TaskRepository.getTaskById(task.id)!;
    await assert.rejects(TaskLogService.retryFromStep(task.id, 'IDEOGRAM_REQUEST'), /GPT Image 2\.0/);
    const after = TaskRepository.getTaskById(task.id)!;
    assert.deepEqual(after, before);
  } finally {
    (TaskLogService as any).processTaskWithOpenRouter = originalProcess;
    TaskRepository.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Ideogram provider success is counted once even when download finishes later', () => {
  const task: any = {
    id: '#001-D', counter: 1, suffix: 'D', source: 'DESIGNER', status: 'ERROR', receivedAt: new Date().toISOString(), payload: {},
    events: [
      { timestamp: new Date().toISOString(), type: 'IMAGE_PROVIDER_READY', content: { provider: 'IDEOGRAM' } },
      { timestamp: new Date().toISOString(), type: 'IDEOGRAM_RESPONSE', content: { provider: 'IDEOGRAM' } }
    ]
  };
  assert.equal(TaskRepository.taskToColumns(task).image_generations_count, 1);
});

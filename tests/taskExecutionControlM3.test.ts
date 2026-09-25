import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskExecutionControl } from '../src/server/services/taskExecutionControl';
import { DesignPipelineService } from '../src/server/services/designPipelineService';
import { UpdatePipelineService } from '../src/server/services/updatePipelineService';
import { TaskLogService } from '../src/server/services/taskLogService';
import { AmazonInspectService } from '../src/server/services/amazonInspectService';
import { TaskRecoveryService } from '../src/server/services/taskRecoveryService';
import { PipelineExecutionCoordinator } from '../src/server/services/pipelineExecutionCoordinator';
import type { DesignTaskLog } from '../src/types/tasks';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-m3-control-'));
TaskRepository.init(path.join(dir, 'tasks.sqlite'));
const task = (id: string): DesignTaskLog => ({
  id, counter: Number(id.match(/\d+/)?.[0] || 1), source: 'DESIGNER', suffix: 'D',
  status: 'PROCESSING', receivedAt: new Date().toISOString(), payload: { quote: 'Test' }, events: []
});

try {
  TaskRepository.createTask(task('#900-D'));
  let resolveStep!: () => void;
  const heldStep = new Promise<void>(resolve => { resolveStep = resolve; });
  const originals = new Map<string, unknown>();
  const service = DesignPipelineService as any;
  for (const name of ['stepD1_PreflightTrademark', 'stepD2_GeneratePrompt', 'stepD3_GenerateImage', 'stepD4_AnalyzeDesign', 'stepD5_GenerateListing', 'stepD6_TrademarkCheck', 'stepD7_VectorizeAndAudit', 'stepD8_Enqueue']) {
    originals.set(name, service[name]);
    service[name] = async () => ({ success: true });
  }
  let d2Runs = 0;
  service.stepD1_PreflightTrademark = async () => { await heldStep; return { success: true }; };
  service.stepD2_GeneratePrompt = async () => { d2Runs++; return { success: true }; };
  try {
    const first = DesignPipelineService.runFromStep('#900-D', 'D1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(TaskExecutionControl.requestPause('#900-D').status, 'PAUSE_REQUESTED');
    resolveStep();
    await first;
    assert.equal(TaskRepository.getTaskById('#900-D')?.status, 'PAUSED');
    assert.equal(TaskRepository.getTaskById('#900-D')?.executionControl?.nextStep, 'D2');
    assert.equal(d2Runs, 0);

    TaskRepository.close();
    TaskRepository.init(path.join(dir, 'tasks.sqlite'));
    assert.equal(TaskRepository.getTaskById('#900-D')?.status, 'PAUSED', 'Pause survives restart');
    assert.equal(TaskExecutionControl.resume('#900-D'), 'D2');
    assert.throws(() => TaskExecutionControl.resume('#900-D'), /nicht pausiert/, 'Double resume rejected');
    await DesignPipelineService.runFromStep('#900-D', 'D2');
    assert.equal(d2Runs, 1);

    TaskRepository.createTask(task('#901-D'));
    let unblock!: () => void;
    const blocker = new Promise<void>(resolve => { unblock = resolve; });
    const firstSlot = PipelineExecutionCoordinator.runExclusive('blocker', async () => { await blocker; });
    const second = DesignPipelineService.runFromStep('#901-D', 'D1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(TaskRepository.getTaskById('#901-D')?.status, 'WAITING');
    assert.equal(TaskExecutionControl.requestPause('#901-D').status, 'PAUSED');
    assert.equal(PipelineExecutionCoordinator.getSnapshot().waitingTaskIds.includes('#901-D'), false);
    unblock();
    await Promise.all([firstSlot, second]);
    assert.equal(TaskRepository.getTaskById('#901-D')?.status, 'PAUSED');

    TaskRepository.createTask(task('#902-D'));
    let releaseCancel!: () => void;
    const cancelledStep = new Promise<void>(resolve => { releaseCancel = resolve; });
    service.stepD1_PreflightTrademark = async () => { await cancelledStep; return { success: true }; };
    const cancelling = DesignPipelineService.runFromStep('#902-D', 'D1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(TaskExecutionControl.requestCancel('#902-D', 'Testabbruch').status, 'CANCEL_REQUESTED');
    releaseCancel();
    await cancelling;
    assert.equal(TaskRepository.getTaskById('#902-D')?.status, 'CANCELLED');
    assert.equal(d2Runs, 1, 'Cancelled task never enters D2');

    const updateTask = { ...task('#903-U'), source: 'UPDATE' as const, suffix: 'U' as const, payload: { designId: 'test-903' } };
    TaskRepository.createTask(updateTask);
    const updateService = UpdatePipelineService as any;
    const originalU5 = updateService.stepU5_TrademarkCheck;
    const originalU6 = updateService.stepU6_TranslateListing;
    const originalU7 = updateService.stepU7_Enqueue;
    let releaseU5!: () => void;
    const heldU5 = new Promise<void>(resolve => { releaseU5 = resolve; });
    let u6Runs = 0;
    updateService.stepU5_TrademarkCheck = async () => { await heldU5; return { success: true }; };
    updateService.stepU6_TranslateListing = async () => { u6Runs++; return { success: true }; };
    updateService.stepU7_Enqueue = async () => ({ success: true });
    try {
      const updateRun = UpdatePipelineService.runFromStep('#903-U', 'U5');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(TaskExecutionControl.requestPause('#903-U').status, 'PAUSE_REQUESTED');
      releaseU5();
      await updateRun;
      assert.equal(TaskRepository.getTaskById('#903-U')?.executionControl?.nextStep, 'U6');
      assert.equal(u6Runs, 0);
      assert.equal(TaskExecutionControl.resume('#903-U'), 'U6');
      await UpdatePipelineService.runFromStep('#903-U', 'U6');
      assert.equal(u6Runs, 1);
    } finally {
      releaseU5();
      updateService.stepU5_TrademarkCheck = originalU5;
      updateService.stepU6_TranslateListing = originalU6;
      updateService.stepU7_Enqueue = originalU7;
    }

    const retryTask = task('#904-D');
    retryTask.status = 'ERROR';
    retryTask.events = [{ timestamp: new Date().toISOString(), type: 'LLM_REQUEST', title: 'Alter Versuch', content: { request: 'keep' } }];
    retryTask.localSvgPath = '/tmp/keep.svg';
    TaskRepository.createTask(retryTask);
    const originalPrompt = (TaskLogService as any).generatePromptWithOpenRouter;
    (TaskLogService as any).generatePromptWithOpenRouter = async () => undefined;
    try {
      await TaskLogService.retryFromStep('#904-D', 'LLM_REQUEST', 0);
      const retried = TaskRepository.getTaskById('#904-D');
      assert.equal(retried?.events[0].title, 'Alter Versuch', 'Retry retains prior event');
      assert.equal(retried?.localSvgPath, '/tmp/keep.svg', 'Unrelated artwork remains');
      assert.equal(retried?.executionControl?.attempt, 1);
    } finally {
      (TaskLogService as any).generatePromptWithOpenRouter = originalPrompt;
    }

    const amazon = AmazonInspectService as any;
    const originalConfig = amazon.inspectProductConfig;
    const originalFind = amazon.inspectFindListings;
    const originalArtwork = amazon.downloadDesignArtwork;
    let releaseConfig!: () => void;
    const heldConfig = new Promise<void>(resolve => { releaseConfig = resolve; });
    amazon.inspectProductConfig = async () => {
      await heldConfig;
      return { success: true, data: { textData: { en: { title: 'Test', brandName: 'Test', bullets: [] } }, products: { STANDARD_TSHIRT: { marketplaceData: { US: {} } } } } };
    };
    amazon.inspectFindListings = async () => ({ success: false, error: 'offline' });
    amazon.downloadDesignArtwork = async () => ({ success: true });
    try {
      const creating = AmazonInspectService.createUpdateTaskFromAmazon('test-design-905');
      await new Promise(resolve => setImmediate(resolve));
      const pending = TaskRepository.getTasksByStatuses(['UPDATE_EXTRACTING'])[0];
      assert.ok(pending, 'U1 task exists before remote reads finish');
      assert.equal(TaskExecutionControl.requestPause(pending.id).status, 'PAUSE_REQUESTED');
      releaseConfig();
      await creating;
      assert.equal(TaskRepository.getTaskById(pending.id)?.status, 'PAUSED');
      assert.equal(TaskRepository.getTaskById(pending.id)?.executionControl?.nextStep, 'U2');
    } finally {
      releaseConfig();
      amazon.inspectProductConfig = originalConfig;
      amazon.inspectFindListings = originalFind;
      amazon.downloadDesignArtwork = originalArtwork;
    }

    const interrupted = task('#906-D');
    interrupted.status = 'PAUSE_REQUESTED';
    interrupted.executionControl = { phase: 'pause_requested', nextStep: 'D4', attempt: 1, updatedAt: new Date().toISOString() };
    TaskRepository.createTask(interrupted);
    const cancelledOnRestart = task('#907-D');
    cancelledOnRestart.status = 'CANCEL_REQUESTED';
    cancelledOnRestart.executionControl = { phase: 'cancel_requested', nextStep: 'D4', attempt: 1, updatedAt: new Date().toISOString() };
    TaskRepository.createTask(cancelledOnRestart);
    const waiting = task('#908-D');
    waiting.status = 'WAITING';
    waiting.executionControl = { phase: 'queued', nextStep: 'D4', attempt: 1, updatedAt: new Date().toISOString() };
    TaskRepository.createTask(waiting);
    const report = { candidateZombieTasks: 0, detectedZombieTasks: 0, reservedRecoveryJobs: 0, attemptLimitEscalatedTasks: 0, details: [] };
    (TaskRecoveryService as any).classifyAndPrepareRecoveryJobs(report);
    assert.equal(TaskRepository.getTaskById('#906-D')?.status, 'AWAITING_RECOVERY_REVIEW');
    assert.equal(TaskRepository.getTaskById('#907-D')?.status, 'CANCELLED');
    assert.ok(TaskRecoveryService.getReservedJobs().some(job => job.taskId === '#908-D'));
    assert.ok(!TaskRecoveryService.getReservedJobs().some(job => job.taskId === '#901-D'), 'Paused task is never auto recovered');
  } finally {
    resolveStep();
    for (const [name, value] of originals) service[name] = value;
  }
} finally {
  TaskRepository.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

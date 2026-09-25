import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskLogService } from '../src/server/services/taskLogService';
import { DesignPipelineService } from '../src/server/services/designPipelineService';
import type { DesignTaskLog } from '../src/types/tasks';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-vision-resume-'));
TaskRepository.init(path.join(dir, 'tasks.sqlite'));
const originalAnalyze = TaskLogService.analyzeDesignWithOpenRouter;
const originalD5 = DesignPipelineService.stepD5_GenerateListing;
let d5Runs = 0;

const createTask = (id: string): DesignTaskLog => ({
  id, counter: Number(id.match(/\d+/)?.[0] || 1), source: 'DESIGNER', suffix: 'D',
  status: 'WAITING', receivedAt: new Date().toISOString(), payload: {}, events: [],
  imageUrl: `/api/v1/designs/image/${encodeURIComponent(id)}`,
  executionControl: { phase: 'queued', nextStep: 'D4', attempt: 1, updatedAt: new Date().toISOString() }
});

try {
  DesignPipelineService.stepD5_GenerateListing = async () => { d5Runs++; return { success: true }; };

  TaskRepository.createTask(createTask('#990-D'));
  TaskLogService.analyzeDesignWithOpenRouter = async id => {
    TaskLogService.updateTaskStatus(id, {
      status: 'AWAITING_DESIGN_REVIEW', checkpoint: 'DESIGN_REVIEW',
      analysisResult: { overall_verdict: 'APPROVED' }, hasError: false
    });
  };
  const review = await DesignPipelineService.runFromStep('#990-D', 'D4');
  assert.equal(review.pausedAtCheckpoint, 'DESIGN_REVIEW');
  assert.equal(TaskRepository.getTaskById('#990-D')?.status, 'AWAITING_DESIGN_REVIEW');
  assert.equal(d5Runs, 0, 'Manual review blocks listing and vectorization');

  TaskRepository.createTask(createTask('#991-D'));
  TaskLogService.analyzeDesignWithOpenRouter = async id => {
    TaskLogService.updateTaskStatus(id, {
      status: 'ERROR', hasError: true, errorDetails: 'Vision HTTP 400'
    });
  };
  const failed = await DesignPipelineService.runFromStep('#991-D', 'D4');
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'Vision HTTP 400');
  assert.equal(TaskRepository.getTaskById('#991-D')?.status, 'ERROR');
  assert.equal(TaskRepository.getTaskById('#991-D')?.executionControl?.phase, 'finished');
  assert.equal(d5Runs, 0, 'Failed vision must not enter downstream steps');

  const staleReview = createTask('#992-D');
  staleReview.status = 'AWAITING_SVG_REVIEW';
  staleReview.checkpoint = 'SVG_REVIEW';
  staleReview.executionControl = { phase: 'finished', nextStep: 'D7', attempt: 1, updatedAt: new Date().toISOString() };
  TaskRepository.createTask(staleReview);
  TaskLogService.analyzeDesignWithOpenRouter = async () => undefined;
  await TaskLogService.retryFromStep('#992-D', 'ANALYSIS_REQUEST');
  assert.equal(TaskRepository.getTaskById('#992-D')?.checkpoint ?? null, null, 'D4 retry clears a stale SVG review');
} finally {
  TaskLogService.analyzeDesignWithOpenRouter = originalAnalyze;
  DesignPipelineService.stepD5_GenerateListing = originalD5;
  TaskRepository.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

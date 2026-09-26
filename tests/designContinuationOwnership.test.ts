import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { DesignPipelineService } from '../src/server/services/designPipelineService';
import { TaskLogService } from '../src/server/services/taskLogService';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-continuation-'));
const service = DesignPipelineService as any;
const original = {
  d5: service.stepD5_GenerateListing,
  d6: service.stepD6_TrademarkCheck,
  d7: service.stepD7_VectorizeAndAudit,
  d8: service.stepD8_Enqueue
};
const calls: string[] = [];
try {
  TaskRepository.init(path.join(dir, 'tasks.sqlite'));
  for (const step of ['D5', 'D6', 'D7'] as const) {
    const id = `#${step}-D`;
    TaskRepository.createTask({ id, counter: Number(step.slice(1)), source: 'DESIGNER', suffix: 'D',
      status: 'WAITING', receivedAt: new Date().toISOString(), payload: {}, events: [],
      executionControl: { phase: 'queued', nextStep: step, attempt: 1, updatedAt: new Date().toISOString() } });
  }
  service.stepD5_GenerateListing = async (id: string) => {
    calls.push('D5');
    // The production listing service may already reach manual SVG review.
    TaskLogService.updateTaskStatus(id, { status: 'AWAITING_SVG_REVIEW', checkpoint: 'SVG_REVIEW' });
    return { success: true };
  };
  service.stepD6_TrademarkCheck = async () => { calls.push('D6'); return { success: true }; };
  service.stepD7_VectorizeAndAudit = async () => { calls.push('D7'); return { success: true }; };
  service.stepD8_Enqueue = async () => { calls.push('D8'); return { success: true }; };

  for (const step of ['D5', 'D6', 'D7'] as const) {
    calls.length = 0;
    const result = await DesignPipelineService.runFromStep(`#${step}-D`, step);
    assert.equal(result.success, true);
    assert.deepEqual(calls, [step], `${step} must not be executed again by the outer loop`);
  }
  assert.equal(TaskRepository.getTaskById('#D5-D')?.status, 'AWAITING_SVG_REVIEW');
  console.log('PASS D5/D6/D7 nested continuation has a single owner');
} finally {
  Object.assign(service, {
    stepD5_GenerateListing: original.d5, stepD6_TrademarkCheck: original.d6,
    stepD7_VectorizeAndAudit: original.d7, stepD8_Enqueue: original.d8
  });
  TaskRepository.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

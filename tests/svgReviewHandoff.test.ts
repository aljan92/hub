import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskLogService } from '../src/server/services/taskLogService';
import { TaskRecoveryService } from '../src/server/services/taskRecoveryService';

// The HTTP review may finish only after durable state exists; expensive work is deferred.
const previousCwd = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-review-handoff-'));
const originals = {
  get: TaskLogService.getTaskLogById,
  update: TaskLogService.updateTaskStatus,
  event: TaskLogService.addEvent,
  continue: TaskLogService.continueApprovedSvg
};
const task: any = { id: 'review-test', status: 'AWAITING_SVG_REVIEW', checkpoint: 'SVG_REVIEW', svgContent: '<svg/>' };
let continuationStarted = false;
try {
  process.chdir(temp);
  TaskLogService.getTaskLogById = (() => task) as any;
  TaskLogService.updateTaskStatus = ((_id: string, updates: any) => { Object.assign(task, updates); return task; }) as any;
  TaskLogService.addEvent = (() => task) as any;
  TaskLogService.continueApprovedSvg = (async () => { continuationStarted = true; }) as any;
  const edited = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>';
  const result = await TaskLogService.submitSvgReview(task.id, { action: 'APPROVE', editedSvgContent: edited });
  assert.equal(result.success, true);
  assert.equal(continuationStarted, false);
  assert.equal(task.status, 'SVG_AUDITING');
  assert.equal(task.checkpoint, undefined);
  assert.equal(task.svgContent, edited);
  assert.equal(fs.readFileSync(task.svgApproval.path, 'utf8'), edited);
  assert.match(task.svgApproval.sha256, /^[a-f0-9]{64}$/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(continuationStarted, true);
  continuationStarted = false;
  const recovered = await (TaskRecoveryService as any).executeRecoveryPolicy({ ...task, source: 'DESIGNER' });
  assert.equal(recovered.success, true);
  assert.equal(continuationStarted, true);
  assert(TaskRecoveryService.CANDIDATE_ZOMBIE_STATUSES.includes('SVG_AUDITING'));
  console.log('PASS SVG review persists accepted candidate before deferred continuation');
} finally {
  TaskLogService.getTaskLogById = originals.get;
  TaskLogService.updateTaskStatus = originals.update;
  TaskLogService.addEvent = originals.event;
  TaskLogService.continueApprovedSvg = originals.continue;
  process.chdir(previousCwd);
  fs.rmSync(temp, { recursive: true, force: true });
}

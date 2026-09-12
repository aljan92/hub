import assert from 'node:assert/strict';
import { getTaskStatusInfo } from '../src/client/components/TaskStatusBadge';
import { TaskSummary } from '../src/types/tasks';

console.log('====================================================');
console.log('🚀 RUNNING PROMPT LOG STATUS BADGE TESTS (Alex Todo #5)');
console.log('====================================================');

// Test 1: Active step is NOT shadowed by stale checkpoint
console.log('Test 1: Active step takes precedence over stale checkpoint...');
const taskWithStaleCheckpoint: TaskSummary = {
  id: 'test-1-U',
  counter: 1,
  source: 'UPDATE',
  suffix: 'U',
  status: 'CHECKING_TRADEMARKS',
  checkpoint: 'DESIGN_REVIEW' as any,
  receivedAt: new Date().toISOString(),
  hasError: false,
  eventsCount: 5
};
const info1 = getTaskStatusInfo(taskWithStaleCheckpoint);
assert.equal(info1.label, '[U5/7] TM-Prüfung...');
assert.equal(info1.isAnimated, true);
console.log('✅ [PASS] Test 1: Active CHECKING_TRADEMARKS won over stale DESIGN_REVIEW checkpoint.');

// Test 2: Update step numbering across all active steps
console.log('Test 2: Update step numbering [U1-U7]...');
const baseUpdateTask: TaskSummary = {
  id: 'test-update-U',
  counter: 2,
  source: 'UPDATE',
  suffix: 'U',
  status: 'UPDATE_EXTRACTED',
  receivedAt: new Date().toISOString(),
  hasError: false,
  eventsCount: 1
};

assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_EXTRACTED' }).label, '[U1/7] Rohdaten erfasst');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_DOWNLOADING_ARTWORK' }).label, '[U2/7] Artwork Download...');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'ANALYZING_DESIGN' }).label, '[U3/7] Vision & Audit...');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'AWAITING_DESIGN_REVIEW', checkpoint: 'DESIGN_REVIEW' }).label, '[U3/7] Wartet: Update-Review');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_REWRITING' }).label, '[U4/7] Listing Rewrite...');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_REWRITTEN' }).label, '[U4/7] Listing optimiert');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'CHECKING_TRADEMARKS' }).label, '[U5/7] TM-Prüfung...');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'AWAITING_TM_REVIEW', checkpoint: 'TM_REVIEW' }).label, '[U5/7] Wartet: TM-Review');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_TM_CHECKED' }).label, '[U5/7] TM geprüft');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'TRANSLATING_LISTING' }).label, '[U6/7] Übersetzung (DE/FR/ES)...');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_TRANSLATED' }).label, '[U6/7] Übersetzungen bereit');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'FINALIZING' }).label, '[U7/7] Finalisieren…');
assert.equal(getTaskStatusInfo({ ...baseUpdateTask, status: 'UPDATE_QUEUED', inQueue: true }).label, '[U7/7] In Queue übergeben ✓');
console.log('✅ [PASS] Test 2: All update steps [U1-U7] mapped cleanly.');

// Test 3: Rejection tasks retain real-time step information with warning icon
console.log('Test 3: Rejection tasks retain step visibility...');
const rejectionTask: any = {
  ...baseUpdateTask,
  status: 'UPDATE_REWRITING',
  payload: { hasRejection: true }
};
const infoRejectionActive = getTaskStatusInfo(rejectionTask);
assert.equal(infoRejectionActive.label, '⚠️ [U4/7] Listing Rewrite...');
assert.equal(infoRejectionActive.isAnimated, true);

const infoRejectionReview = getTaskStatusInfo({
  ...rejectionTask,
  status: 'AWAITING_DESIGN_REVIEW',
  checkpoint: 'DESIGN_REVIEW'
});
assert.equal(infoRejectionReview.label, '⚠️ [U3/7] Rejection-Review');
console.log('✅ [PASS] Test 3: Amazon Rejection keeps step details visible.');

// Test 4: Designer tasks (non-update) retain their standard labels
console.log('Test 4: Non-update Designer tasks retain clean labels...');
const designerTask: TaskSummary = {
  id: 'test-designer-D',
  counter: 3,
  source: 'DESIGNER',
  suffix: 'D',
  status: 'ANALYZING_DESIGN',
  receivedAt: new Date().toISOString(),
  hasError: false,
  eventsCount: 1
};
assert.equal(getTaskStatusInfo(designerTask).label, 'Vision-Analyse...');
assert.equal(getTaskStatusInfo({ ...designerTask, status: 'GENERATING_LISTING' }).label, 'Listing-Erstellung...');
assert.equal(getTaskStatusInfo({ ...designerTask, status: 'CHECKING_TRADEMARKS' }).label, 'Trademark-Prüfung...');
assert.equal(getTaskStatusInfo({ ...designerTask, status: 'AWAITING_DESIGN_REVIEW', checkpoint: 'DESIGN_REVIEW' }).label, 'Wartet: Design-Review');
console.log('✅ [PASS] Test 4: Designer tasks maintain clean, un-prefixed labels.');

console.log('====================================================');
console.log('🎉 ALL PROMPT LOG STATUS BADGE TESTS PASSED!');
console.log('====================================================');

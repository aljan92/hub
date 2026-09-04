import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualFinalizationService } from '../src/server/services/manualFinalizationService';
import { FinalizationService } from '../src/server/services/finalizationService';
import { TaskLogService } from '../src/server/services/taskLogService';
import { QueueService } from '../src/server/services/queueService';
import { TaskExecutionLock } from '../src/server/services/taskExecutionLock';
import { getGeneratableVariants } from '../src/server/services/productCatalogService';
import { UploadWorkerService } from '../src/server/services/uploadWorkerService';
import { canRepeatFinalization, hasFailedFinalization } from '../src/types/finalizationRetry';

// Isolated orchestration test: no real task repository, queue, renderer or Amazon calls.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-finalization-'));
const png = path.join(dir, 'header.png');
const header = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
header.writeUInt32BE(1, 16); header.writeUInt32BE(1, 20);
fs.writeFileSync(png, header);
const assets = { trimmedPath: png, mugStandardPath: png, mugBrushPath: png, drinkwareStandardPath: png, drinkwareBrushPath: png, productVariants: {} };
let items: any[];
let commits = 0;
let prepare: any;
const originals = {
  getTask: TaskLogService.getTask, update: TaskLogService.updateTaskStatus, event: TaskLogService.addEvent,
  state: QueueService.getState, replace: QueueService.replacePreparedAssets, finalize: FinalizationService.finalizeForQueue, corrupted: QueueService.isCorrupted,
  handoff: FinalizationService.handoffPrepared
};
const reset = () => { items = [{ id: 'queue-test', taskId: 'test', status: 'WAITING', pngPath: 'master.png', resizedAssets: { trimmedPath: 'old.png' } }]; commits = 0; };
try {
  TaskLogService.getTask = (() => ({ id: 'test', status: 'COMPLETED' })) as any;
  TaskLogService.updateTaskStatus = (() => {}) as any;
  TaskLogService.addEvent = (() => {}) as any;
  QueueService.getState = (() => ({ items })) as any;
  QueueService.isCorrupted = () => false;
  QueueService.replacePreparedAssets = ((id: string, patch: any) => { commits++; assert.equal(id, 'queue-test'); Object.assign(items[0], patch); return items[0]; }) as any;
  const success = async (params: any) => { prepare = params; assert(TaskExecutionLock.isLocked('test')); return { success: true, resizedAssets: assets, preparedListing: { root: { title: 'Clean' }, listings: {} } }; };
  FinalizationService.finalizeForQueue = success as any;
  reset();
  await ManualFinalizationService.repeat('test');
  assert.equal(commits, 1); assert.equal(items.length, 1); assert.equal(items[0].status, 'WAITING');
  assert.equal(prepare.prepareOnly, true); assert.match(prepare.artifactRunId, /^test_rebuild_/);
  assert.equal(items[0].title, 'Clean'); assert(!TaskExecutionLock.isLocked('test'));
  const firstRun = prepare.artifactRunId;
  await ManualFinalizationService.repeat('test'); assert.notEqual(prepare.artifactRunId, firstRun);

  for (const patch of [{ status: 'UPLOADING' }, { status: 'COMPLETED' }, { uploadRecovery: { phase: 'REMOTE_REQUEST_INTENT' } }, { uploadRecovery: { remoteRequestIntentAt: 'now' } }]) {
    reset(); Object.assign(items[0], patch);
    await assert.rejects(() => ManualFinalizationService.repeat('test')); assert.equal(commits, 0);
  }
  reset(); items.push({ ...items[0], id: 'duplicate' });
  await assert.rejects(() => ManualFinalizationService.repeat('test')); assert.equal(commits, 0);
  reset(); TaskExecutionLock.acquire('test', 'USER_ACTION');
  await assert.rejects(() => ManualFinalizationService.repeat('test'));
  assert.equal((await UploadWorkerService.startUpload('queue-test')).success, false);
  TaskExecutionLock.release('test');

  reset();
  FinalizationService.finalizeForQueue = (async () => ({ success: false, error: 'renderer failed' })) as any;
  await assert.rejects(() => ManualFinalizationService.repeat('test'), /renderer failed/);
  assert.equal(items[0].resizedAssets.trimmedPath, 'old.png'); assert.equal(commits, 0); assert(!TaskExecutionLock.isLocked('test'));

  reset();
  FinalizationService.finalizeForQueue = (async (params: any) => {
    const result = await success(params);
    return { ...result, resizedAssets: { ...assets, productVariants: { [getGeneratableVariants()[0].id]: png } } };
  }) as any;
  await assert.rejects(() => ManualFinalizationService.repeat('test'), /Unerwartete Bildmaße/); assert.equal(commits, 0);

  reset();
  FinalizationService.finalizeForQueue = (async (params: any) => { items[0].title = 'Concurrent edit'; return success(params); }) as any;
  await assert.rejects(() => ManualFinalizationService.repeat('test'), /inzwischen geändert/); assert.equal(commits, 0);

  // Regression: failed U7 keeps UPDATE_TRANSLATED and has no queue item yet.
  let task: any;
  let handoffs = 0;
  const failedTask = (source = 'UPDATE') => ({
    id:'test', source, status:source === 'UPDATE' ? 'UPDATE_TRANSLATED' : 'COMPLETED', hasError:true, inQueue:false,
    payload:{designId:'design-42',publishedCount:7,liveStats:{publishedCount:7},productTypes:['DYNAMIC_PRODUCT'],niche:'space'},
    listingResult:{en:{brand:'Saved brand',title:'Saved listing',bullet1:'One',bullet2:'Two',description:'Existing'},de:{title:'Gespeichert'}},
    customAnswers:{audience:'Women',avoidColor:'white'},blockedProducts:['BLOCKED_DYNAMIC'],
    localMbaPngPath:'existing-master.png',localImagePath:'downloaded.png',svgContent:source === 'UPDATE' ? undefined : '<svg/>',
    events:[{type:'FINALIZATION_EVENT',content:{phase:'ARTWORK_PREPARATION',status:'FAILED'}}]
  });
  TaskLogService.getTask = (() => task) as any;
  FinalizationService.handoffPrepared = ((params: any, result: any) => {
    assert(TaskExecutionLock.isLocked('test')); assert.equal(items.length,0);
    handoffs++; items.push({id:'first-queue',taskId:'test',status:'WAITING'});
    assert.equal(params.title,'Saved listing');assert.equal(result.preparedListing.root.title,'Clean');
    return {success:true,queueItemId:'first-queue'};
  }) as any;
  FinalizationService.finalizeForQueue = success as any;
  for (const source of ['UPDATE','DESIGNER']) {
    task=failedTask(source);items=[];
    assert(canRepeatFinalization(task));assert(hasFailedFinalization(task));
    const result=await ManualFinalizationService.repeat('test');
    assert(result.success);assert.equal(items.length,1);assert.equal(prepare.prepareOnly,true);
    assert.equal(prepare.pipeline,source === 'UPDATE' ? 'UPDATE' : 'DESIGN');
    assert.equal(prepare.masterPngPath,'existing-master.png');assert.equal(prepare.listings.de.title,'Gespeichert');
    assert.deepEqual(prepare.tmBlockedProductIds,['BLOCKED_DYNAMIC']);assert.equal(prepare.avoidColor,'white');
    if (source === 'UPDATE') {assert.equal(prepare.designId,'design-42');assert.equal(prepare.publishedProductsCount,7);assert.deepEqual(prepare.liveProductTypes,['DYNAMIC_PRODUCT']);}
  }
  assert.equal(handoffs,2);
  assert(!canRepeatFinalization({...failedTask(),events:[{type:'FINALIZATION_EVENT',content:{status:'SUCCESS'}}]}));
  assert(!canRepeatFinalization({...failedTask(),hasError:false}));
  for (const patch of [
    {status:'GENERATING_LISTING'}, {checkpoint:'DESIGN_REVIEW'}, {status:'AWAITING_DESIGN_REVIEW'},
    {status:'ERROR',events:[]}, {inQueue:true},
    {events:[{type:'TASK_HANDOFF',content:{status:'SUCCESS'}},{type:'FINALIZATION_EVENT',content:{status:'FAILED'}}]}
  ]) {
    task={...failedTask(),...patch};items=[];
    await assert.rejects(()=>ManualFinalizationService.repeat('test'));
    assert.equal(handoffs,2);
  }
  task=failedTask();items=[];
  FinalizationService.finalizeForQueue = (async () => ({success:false,error:'renderer retry failed'})) as any;
  await assert.rejects(()=>ManualFinalizationService.repeat('test'),/renderer retry failed/);
  assert.equal(items.length,0);assert(!TaskExecutionLock.isLocked('test'));
  task=failedTask();items=[];
  FinalizationService.finalizeForQueue = (async (params:any) => {task.listingResult.en.title='Concurrent edit';return success(params);}) as any;
  await assert.rejects(()=>ManualFinalizationService.repeat('test'),/inzwischen geändert/);
  assert.equal(handoffs,2);
  task=failedTask();items=[];
  FinalizationService.finalizeForQueue = (async (params:any) => {items.push({taskId:'test',id:'concurrent'});return success(params);}) as any;
  await assert.rejects(()=>ManualFinalizationService.repeat('test'),/inzwischen geändert/);
  assert.equal(handoffs,2);
  console.log('PASS pre-queue finalization retry: UPDATE and DESIGN inputs, stale U7 status, first handoff only, review/duplicate/removed-queue guards, failure and concurrent edit protection');
  console.log('PASS: manual finalization isolation, unique generations, guards, failure retention, dimensions and concurrent edit protection');
} finally {
  TaskLogService.getTask = originals.getTask; TaskLogService.updateTaskStatus = originals.update; TaskLogService.addEvent = originals.event;
  QueueService.getState = originals.state; QueueService.replacePreparedAssets = originals.replace; FinalizationService.finalizeForQueue = originals.finalize;
  QueueService.isCorrupted = originals.corrupted;
  FinalizationService.handoffPrepared = originals.handoff;
  fs.rmSync(dir, { recursive: true, force: true });
}

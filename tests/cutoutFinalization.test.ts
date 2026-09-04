import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskLogService } from '../src/server/services/taskLogService';
import { FinalizationService } from '../src/server/services/finalizationService';
import { QueueService } from '../src/server/services/queueService';
import { LLMService } from '../src/server/services/llmService';
import { VectorizerService } from '../src/server/services/vectorizerService';
import { SvgRenderService } from '../src/server/services/svgRenderService';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { loadSettings } from '../src/server/services/settingsService';
import { getTaskStatusInfo } from '../src/client/components/TaskStatusBadge';

const cwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cutout-finalization-'));
const originals={vector:VectorizerService.vectorizeImage,bg:SvgRenderService.autoRemoveCornerBackground,
  panel:SvgRenderService.render4PanelTestImage,master:SvgRenderService.renderSvgToMbaPng,audit:LLMService.auditSvgCutout,
  finalize:FinalizationService.finalizeForQueue,state:QueueService.getState,enqueue:QueueService.enqueueDesign,corrupted:QueueService.isCorrupted};
const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>';
let count=0, renders=0, verdict='APPROVED';let items:any[]=[];
const create=(inQueue=false)=>{
  const id=`cutout-${++count}`;
  TaskRepository.createTask({id,counter:count,source:'DESIGNER',suffix:'D',status:'VECTORIZING_DESIGN',receivedAt:new Date().toISOString(),
    payload:{},events:[],inQueue,imageUrl:'https://fixture.invalid/image.png',listingResult:{en:{brand:'Fixture',title:'Fixture art',bullet1:'One',bullet2:'Two'}}} as any);
  return id;
};
const success=async(params:any)=>{
  renders++;const saved=TaskRepository.getTaskById(params.taskId)!;
  assert.equal(saved.status,'FINALIZING');assert.equal(saved.inQueue,false);
  assert(saved.svgContent);assert(fs.existsSync(saved.localSvgPath!));assert(fs.existsSync(saved.localMbaPngPath!));
  assert.equal(params.masterPngPath,saved.localMbaPngPath);
  assert.equal(ArtworkResizeService.source(saved,params.masterPngPath).kind,'SVG');
  return FinalizationService.handoffPrepared(params,{success:true,resizedAssets:{mugStandardPath:'mug',mugBrushPath:'brush',drinkwareStandardPath:'drink',drinkwareBrushPath:'brush2'},preparedListing:{root:{title:params.title},listings:params.listings}});
};
try {
  process.chdir(dir);TaskRepository.init(path.join(dir,'test.sqlite'));
  const settings=loadSettings();settings.vectorizerApiKey='fixture';settings.vectorizerApiSecret='fixture';
  VectorizerService.vectorizeImage=(async()=>svg) as any;
  SvgRenderService.autoRemoveCornerBackground=(async()=>({success:true,removedCount:0,modifiedSvg:svg})) as any;
  SvgRenderService.render4PanelTestImage=async()=>Buffer.from('fixture panel');
  SvgRenderService.renderSvgToMbaPng=async()=>Buffer.from('fixture master');
  LLMService.auditSvgCutout=(async()=>({cutout_verdict:verdict,background_removed_cleanly:true,detected_issues:[],explanation:'fixture'})) as any;
  QueueService.getState=(()=>({items})) as any;QueueService.isCorrupted=()=>false;
  QueueService.enqueueDesign=((params:any)=>{assert(!items.some(item=>item.taskId===params.taskId));const item={...params,id:'queue-'+params.taskId,status:'WAITING'};items.push(item);return item;}) as any;
  FinalizationService.finalizeForQueue=success as any;
  const id=create();await TaskLogService.vectorizeDesignTask(id);
  let saved=TaskRepository.getTaskById(id)!;
  assert.equal(renders,1);assert.equal(saved.status,'COMPLETED');assert(saved.inQueue);assert(!saved.checkpoint);
  assert.equal(saved.svgAuditResult.cutout_verdict,'APPROVED');assert(fs.existsSync(saved.localFourPanelImagePath!));
  assert(saved.events.some(e=>e.content?.phase==='QUEUE_HANDOFF'&&e.content.status==='SUCCESS'));
  await TaskLogService.completeTaskAndEnqueue(id);assert.equal(renders,1);assert.equal(items.length,1);

  // A stale legacy inQueue flag alone cannot short-circuit actual finalization.
  const legacy=create(true);await TaskLogService.vectorizeDesignTask(legacy);assert.equal(renders,2);

  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  FinalizationService.finalizeForQueue=(async(params:any)=>{entered();await gate;return success(params);}) as any;
  const pending=create();let completed=false;
  const work=TaskLogService.vectorizeDesignTask(pending).then(()=>{completed=true;});await started;
  saved=TaskRepository.getTaskById(pending)!;
  assert.equal(completed,false);assert.equal(saved.status,'FINALIZING');assert.equal(saved.inQueue,false);
  assert.equal(getTaskStatusInfo(saved).label,'Listing & Druckdateien finalisieren…');
  const duplicate=TaskLogService.completeTaskAndEnqueue(pending);release();await Promise.all([work,duplicate]);assert.equal(renders,3);

  FinalizationService.finalizeForQueue=(async()=>({success:false,error:'resize failed'})) as any;
  const failed=create();await TaskLogService.vectorizeDesignTask(failed);
  saved=TaskRepository.getTaskById(failed)!;assert.equal(saved.status,'ERROR');assert.equal(saved.inQueue,false);
  assert.match(saved.errorDetails!,/resize failed/);assert(!items.some(item=>item.taskId===failed));
  assert(!saved.events.some(e=>e.content?.phase==='QUEUE_HANDOFF'&&e.content.status==='SUCCESS'));

  FinalizationService.finalizeForQueue=success as any;
  const manual=create();TaskRepository.updateTask(manual,{status:'AWAITING_SVG_REVIEW',checkpoint:'SVG_REVIEW',svgContent:svg});
  assert((await TaskLogService.submitSvgReview(manual,{action:'APPROVE',editedSvgContent:svg})).success);
  saved=TaskRepository.getTaskById(manual)!;assert.equal(saved.status,'COMPLETED');assert(!saved.checkpoint);assert(saved.inQueue);

  verdict='REJECTED';const rejected=create();await TaskLogService.vectorizeDesignTask(rejected);
  saved=TaskRepository.getTaskById(rejected)!;assert.equal(saved.status,'AWAITING_SVG_REVIEW');assert(saved.localSvgPath);assert(!saved.inQueue);
  assert(!getTaskStatusInfo({...saved,status:'COMPLETED',inQueue:false}).label.includes('übergeben'));

  // Compatibility trigger starts preparation, never pre-flags queue membership.
  verdict='APPROVED';const compat=create();TaskRepository.updateTask(compat,{svgContent:svg,localSvgPath:TaskRepository.getTaskById(id)!.localSvgPath,localMbaPngPath:TaskRepository.getTaskById(id)!.localMbaPngPath});
  TaskLogService.updateTaskStatus(compat,{status:'COMPLETED'});
  assert.equal(TaskRepository.getTaskById(compat)!.inQueue,false);
  await TaskLogService.completeTaskAndEnqueue(compat);assert(TaskRepository.getTaskById(compat)!.inQueue);
  const removed=create(true);TaskLogService.addEvent(removed,{timestamp:new Date().toISOString(),type:'TASK_HANDOFF',title:'Previous handoff',content:{status:'SUCCESS'}});
  assert.equal((await TaskLogService.completeTaskAndEnqueue(removed)).success,false);
  assert(!items.some(item=>item.taskId===removed));
  console.log('PASS SQLite cutout-to-queue: artifact persistence, awaited finalization, stale flag, deduplication, failure, manual SVG approval, review rejection, legacy completion trigger and status label');
} finally {
  VectorizerService.vectorizeImage=originals.vector;SvgRenderService.autoRemoveCornerBackground=originals.bg;
  SvgRenderService.render4PanelTestImage=originals.panel;SvgRenderService.renderSvgToMbaPng=originals.master;LLMService.auditSvgCutout=originals.audit;
  FinalizationService.finalizeForQueue=originals.finalize;QueueService.getState=originals.state;QueueService.enqueueDesign=originals.enqueue;QueueService.isCorrupted=originals.corrupted;
  TaskRepository.close();process.chdir(cwd);fs.rmSync(dir,{recursive:true,force:true});
}

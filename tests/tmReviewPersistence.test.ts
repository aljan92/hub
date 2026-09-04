import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskLogService } from '../src/server/services/taskLogService';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskExecutionLock } from '../src/server/services/taskExecutionLock';
import { LLMService } from '../src/server/services/llmService';
import { TrademarkService } from '../src/server/services/trademarkService';
import { UpdatePipelineService } from '../src/server/services/updatePipelineService';
import { loadSettings } from '../src/server/services/settingsService';

const cwd=process.cwd(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'tm-review-regression-'));
const original={translate:LLMService.translateApprovedListing,vector:TaskLogService.vectorizeDesignTask,
  audit:TrademarkService.executeTrademarkAuditV2,run:UpdatePipelineService.runFromStep,update:TaskLogService.updateTaskStatus};
let sequence=0, vectors=0, audits=0, translations=0;
const listing={brand:'Night Sky Apparel',title:'Moon Observer Art',bullet1:'Moon artwork for night sky observers.',bullet2:'An astronomy illustration for stargazing fans.',description:'A moon illustration.'};
const create=(source='DESIGNER')=>{
  const id=`tm-fixture-${++sequence}`;
  TaskRepository.createTask({id,counter:sequence,source,suffix:source==='UPDATE'?'U':'D',status:'AWAITING_TM_REVIEW',checkpoint:'TM_REVIEW',
    receivedAt:new Date().toISOString(),payload:{},events:[],listingResult:{en:listing},blockedProducts:['KEEP_BLOCKED'],hasError:false} as any);
  return id;
};
const settle=async(id:string)=>{
  for(let i=0;i<200 && TaskExecutionLock.isLocked(id);i++) await new Promise(resolve=>setImmediate(resolve));
  assert(!TaskExecutionLock.isLocked(id),'Continuation must release its lock');
};
try {
  process.chdir(dir);TaskRepository.init(path.join(dir,'tasks.sqlite'));
  const settings=loadSettings();settings.translationDesignEnabled=true;
  TrademarkService.executeTrademarkAuditV2=(async()=>{audits++;return {finalTrademarkHits:[],finalDecision:'SAFE',blockedProducts:[],isSafe:true};}) as any;
  TaskLogService.vectorizeDesignTask=async(id)=>{
    vectors++;const fresh=TaskRepository.getTaskById(id)!;
    assert.notEqual(fresh.status,'AWAITING_TM_REVIEW');assert(!fresh.checkpoint);
    assert.equal(fresh.listingResult.en.title,'Approved Moon Art');
    assert.deepEqual(fresh.blockedProducts,['KEEP_BLOCKED']);
  };
  let finishTranslation!: (value:any)=>void;
  LLMService.translateApprovedListing=(async(params)=>{
    translations++;assert.equal(params.englishListing.title,'Approved Moon Art');
    return await new Promise(resolve=>{finishTranslation=resolve;});
  }) as any;
  const id=create();
  assert((await TaskLogService.submitTmReview(id,{action:'APPROVE',refinedListing:{title:'Approved Moon Art'}})).success);
  const persisted=TaskRepository.getTaskById(id)!;
  assert.equal(persisted.status,'TRANSLATING_LISTING');assert(!persisted.checkpoint);
  assert.equal(persisted.listingResult.en.title,'Approved Moon Art');
  assert(persisted.events.some(e=>e.content?.verdict==='APPROVED'));
  await assert.rejects(()=>TaskLogService.submitTmReview(id,{action:'APPROVE'}),/bereits verarbeitet/);
  finishTranslation({en:{...listing,title:'Approved Moon Art'},de:{...listing,title:'Mond Illustration'}});
  await settle(id);assert.equal(vectors,1);assert.equal(audits,0);
  assert.equal(TaskRepository.getTaskById(id)!.listingResult.de.title,'Mond Illustration');
  await assert.rejects(()=>TaskLogService.submitTmReview(id,{action:'APPROVE'}),/nicht mehr/);

  settings.translationDesignEnabled=false;
  const noTranslation=create();
  await TaskLogService.submitTmReview(noTranslation,{action:'APPROVE',refinedListing:{title:'Approved Moon Art'}});
  await settle(noTranslation);assert.equal(translations,1);assert.equal(vectors,2);
  assert.equal(TaskRepository.getTaskById(noTranslation)!.status,'VECTORIZING_DESIGN');

  settings.translationDesignEnabled=true;
  LLMService.translateApprovedListing=(async()=>{throw new Error('translation unavailable');}) as any;
  const failure=create();await TaskLogService.submitTmReview(failure,{action:'APPROVE',refinedListing:{title:'Approved Moon Art'}});
  await settle(failure);assert.equal(vectors,2);
  const failed=TaskRepository.getTaskById(failure)!;
  assert.equal(failed.status,'ERROR');assert(!failed.checkpoint);assert.match(failed.errorDetails!,/translation unavailable/);

  const rejected=create();await TaskLogService.submitTmReview(rejected,{action:'REJECT'});
  assert.equal(TaskRepository.getTaskById(rejected)!.status,'REJECTED');assert(!TaskRepository.getTaskById(rejected)!.checkpoint);
  const rechecked=create();await TaskLogService.submitTmReview(rechecked,{action:'RECHECK'});
  assert.equal(audits,1);assert.equal(TaskRepository.getTaskById(rechecked)!.status,'AWAITING_TM_REVIEW');

  let updates=0;
  UpdatePipelineService.runFromStep=(async(id,step,owner)=>{
    updates++;assert.equal(step,'U6');assert.equal(owner,'USER_ACTION');assert(TaskExecutionLock.isLocked(id));
    assert.equal(TaskRepository.getTaskById(id)!.listingResult.en.title,'Approved Moon Art');return {success:true};
  }) as any;
  const update=create('UPDATE');await TaskLogService.submitTmReview(update,{action:'APPROVE',refinedListing:{title:'Approved Moon Art'}});
  await settle(update);assert.equal(updates,1);assert.equal(audits,1);assert.equal(vectors,2);

  const storageFailure=create();
  TaskLogService.updateTaskStatus=()=>{throw new Error('database unavailable');};
  await assert.rejects(()=>TaskLogService.submitTmReview(storageFailure,{action:'APPROVE'}),/database unavailable/);
  assert(!TaskExecutionLock.isLocked(storageFailure));assert.equal(TaskRepository.getTaskById(storageFailure)!.status,'AWAITING_TM_REVIEW');
  assert(!TaskRepository.getTaskById(storageFailure)!.events.some(e=>e.content?.verdict==='APPROVED'));
  console.log('PASS TM review SQLite persistence: approve, listing/locales, no-translation, reject, recheck, duplicate lock, update U6, failure handling; no re-audit after approval');
} finally {
  LLMService.translateApprovedListing=original.translate;TaskLogService.vectorizeDesignTask=original.vector;
  TrademarkService.executeTrademarkAuditV2=original.audit;UpdatePipelineService.runFromStep=original.run;
  TaskLogService.updateTaskStatus=original.update;TaskRepository.close();process.chdir(cwd);
  fs.rmSync(dir,{recursive:true,force:true});
}

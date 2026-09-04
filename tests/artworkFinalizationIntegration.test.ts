import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FinalizationService } from '../src/server/services/finalizationService';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { TaskLogService } from '../src/server/services/taskLogService';
import { QueueService } from '../src/server/services/queueService';
import { getGeneratableVariants } from '../src/server/services/productCatalogService';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artwork-finalization-'));
const file=path.join(dir,'fixture.png');fs.writeFileSync(file,Buffer.from('fixture'));
let task:any={id:'fixture',svgContent:'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'};
let received:any, calls=0, mutate=false;
const events:any[]=[];
const assets={mugStandardPath:file,mugBrushPath:file,drinkwareStandardPath:file,drinkwareBrushPath:file,
  productVariants:Object.fromEntries(getGeneratableVariants().map(v=>[v.id,file]))};
const original={get:TaskLogService.getTask,event:TaskLogService.addEvent,update:TaskLogService.updateTaskStatus,
  render:ArtworkResizeService.generateResizedArtworks,enqueue:QueueService.enqueueDesign};
try {
  TaskLogService.getTask=(()=>task) as any;TaskLogService.addEvent=((_id:any,e:any)=>events.push(e)) as any;
  TaskLogService.updateTaskStatus=(()=>{}) as any;
  QueueService.enqueueDesign=(()=>{throw new Error('prepareOnly must not enqueue');}) as any;
  ArtworkResizeService.generateResizedArtworks=(async (_id:any,source:any)=>{received=source;calls++;if(mutate)task.svgContent+='<changed/>';return assets;}) as any;
  const params={taskId:'fixture',pipeline:'DESIGN' as const,prepareOnly:true,masterPngPath:file,
    brand:'Wilderness Apparel Studio',title:'Retro Sunset Wilderness Adventure Graphic Art',
    bullet1:'Features pine trees and sunset silhouettes for outdoor nature adventures.',
    bullet2:'A graphic for hiking and camping enthusiasts who enjoy mountain trails.',description:'Wilderness illustration.'};
  let result=await FinalizationService.finalizeForQueue(params);
  assert(result.success,result.error);assert.equal(received.kind,'SVG');assert.equal(calls,1);assert(!result.resizedAssets?.trimmedPath);
  assert.equal(Object.keys(result.resizedAssets!.productVariants!).length,4);
  task={id:'fixture'};
  result=await FinalizationService.finalizeForQueue({...params,pipeline:'UPDATE'});
  assert(result.success,result.error);assert.equal(received.kind,'PNG');assert.equal(received.path,file);
  assert(events.some(e=>e.content?.source==='PNG'));
  task={id:'fixture',svgContent:'<svg/>'};mutate=true;
  result=await FinalizationService.finalizeForQueue(params);
  assert.equal(result.success,false);assert.match(result.error!,/Quelle.*geändert/);
  assert.throws(()=>ArtworkResizeService.source({localSvgPath:path.join(dir,'missing.svg')},file),/SVG-Datei fehlt/);
  console.log('PASS finalization: SVG/PNG selection, eight assets without trim, prepare-only isolation, source-change rejection');
} finally {
  TaskLogService.getTask=original.get;TaskLogService.addEvent=original.event;TaskLogService.updateTaskStatus=original.update;
  ArtworkResizeService.generateResizedArtworks=original.render;QueueService.enqueueDesign=original.enqueue;
  fs.rmSync(dir,{recursive:true,force:true});
}

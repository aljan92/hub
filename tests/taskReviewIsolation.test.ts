import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { findChromiumExecutable } from '../src/server/services/browserSessionService';
import { createServer } from 'node:http';

// Exercise the real TasksView, React lifecycle, event handlers and serialized POST.
// Only network boundaries are mocked; no production server or user data is opened.
const baseline = process.env.REVIEW_TEST_BASELINE === '1';
const plugins = baseline ? [{name:'baseline-view',setup(builder:any) {
 builder.onLoad({filter:/src\/client\/views\/TasksView\.tsx$/},() => ({loader:'tsx',contents:execFileSync('git',['show','HEAD:src/client/views/TasksView.tsx'],{encoding:'utf8'}).replace('key={t.id}', 'key={t.id} data-review-select={t.id}') }));
}}] : [];
const bundle = await build({ plugins, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TasksView} from './src/client/views/TasksView'; createRoot(document.getElementById('root')).render(<TasksView/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script>'+bundle.outputFiles[0].text+'</script>'); });
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true });
try {
 const page = await browser.newPage();
 page.setDefaultTimeout(5000);
 const errors: string[] = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(`window.__name = value => value; window.WebSocket = class {
   static OPEN=1; static CONNECTING=0; readyState=1;
   constructor() { window.socket=this; setTimeout(()=>this.onopen?.(),0); }
   close() {} send() {}
 };`);
 const task = (id: string) => ({id, counter: id==='A'?1:2, source: id==='A'?'DESIGNER':'UPDATE', suffix:id==='A'?'D':'U',status:'AWAITING_TM_REVIEW',checkpoint:'TM_REVIEW',reviewVersion:'v1',receivedAt:new Date().toISOString(),payload:{quote:`Quote ${id}`},events:[],listingResult:{en:{brand:`Brand ${id}`,title:`Title ${id}`,bullet1:`Bullet ${id}`,bullet2:`Second ${id}`,description:`Description ${id}`}},hasError:false});
 let tasks:any[]=[task('A'),task('B')];
 let delayB = false;
 let releaseB: (()=>void)|undefined;
 let detailCount=0;
 let post: any;
 let delayRecheck=false;
 let releaseRecheck: (()=>void)|undefined;
 let wrongDetail=false;
 await page.route('**/api/v1/**', async route => {
   const url=new URL(route.request().url());
   const id=url.pathname.split('/')[4];
   if(route.request().method()==='POST') {
     post={path:url.pathname,body:route.request().postDataJSON()};
     if(post.body.action==='RECHECK' && delayRecheck) {
       await new Promise<void>(r=>{releaseRecheck=r;});
       await route.fulfill({json:{success:true,fieldSummaries:{title:{totalHits:1,hits:[{term:'FOREIGN_RESULT_A'}]}}}});return;
     }
     await route.fulfill({json:{success:true,message:'OK'}});return;
   }
   if(url.pathname==='/api/v1/settings') {await route.fulfill({json:{success:true,settings:{}}});return;}
   if(url.pathname==='/api/v1/tasks') {await route.fulfill({json:{success:true,tasks}});return;}
   if(id) {
     detailCount++;
     if(id==='B'&&delayB) { await new Promise<void>(r=>{releaseB=r;}); }
     await route.fulfill({json:{success:true,task:tasks.find(t=>t.id===(wrongDetail?'A':id))}}).catch(()=>{});return;
   }
   await route.fulfill({json:{success:true}});
 });
 await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
 await page.locator('input[value="Title A"]').waitFor();
 delayB=true;
 await page.locator('[data-review-select="B"]').click();
 await page.getByText('Lade Review-Details...').waitFor();
 assert.equal(await page.locator('input[value="Title A"]').count(),0,'old draft is not visible while B loads');
 releaseB!(); delayB=false;
 await page.locator('input[value="Title B"]').waitFor();
 assert.equal(await page.locator('input[value="Brand B"]').count(),1);
 await page.locator('input[value="Title B"]').fill('Edited B');
 // Log-only refresh must preserve manual edits.
 await page.evaluate(t=>(window as any).socket.onmessage({data:JSON.stringify({type:'TASK_UPDATED',payload:t})}),tasks[1]);
 await page.waitForTimeout(100);
 assert.equal(await page.locator('input[value="Edited B"]').count(),1);
 // Burst while a detail request is pending: one current fetch + one follow-up.
 const before=detailCount;delayB=true;
 await page.evaluate(t=>{for(let i=0;i<30;i++)(window as any).socket.onmessage({data:JSON.stringify({type:'TASK_UPDATED',payload:t})});},{...tasks[1],reviewVersion:undefined});
 await page.waitForTimeout(100);
 assert.equal(detailCount-before,1);
 delayB=false;releaseB!();await page.waitForTimeout(150);
 assert.equal(detailCount-before,2);
 // Saving B must carry B's draft and B's review token.
 const approve=page.getByRole('button').filter({hasText:/Freigeben|Freigabe|Genehmigen|Akzeptieren/});
 await approve.last().click();
 await page.waitForTimeout(100);
 assert.equal(post?.body.reviewContext.taskId,'B');
 assert.equal(post?.body.refinedListing.title,'Edited B');
 assert.equal(post?.body.reviewContext.version,'v1');
 // Return to a clean session, then discard an out-of-order B response after A→B→A.
 await page.reload(); await page.locator('input[value="Title A"]').waitFor();
 delayB=true; await page.locator('[data-review-select="B"]').click();
 await page.getByText('Lade Review-Details...').waitFor();
 await page.locator('[data-review-select="A"]').click();
 await page.locator('input[value="Title A"]').waitFor();
 delayB=false; releaseB!(); await page.waitForTimeout(100);
 assert.equal(await page.locator('input[value="Title B"]').count(),0);
 // An old trademark result must not populate B, or a newly reopened A session.
 delayRecheck=true;await page.getByRole('button',{name:'USPTO prüfen'}).click();
 await page.waitForFunction(()=>document.querySelector('button[disabled]'));
 await page.locator('[data-review-select="B"]').click();
 await page.locator('input[value="Title B"]').waitFor();
 await page.locator('[data-review-select="A"]').click();
 await page.locator('input[value="Title A"]').waitFor();
 delayRecheck=false;releaseRecheck!();await page.waitForTimeout(100);
 assert.equal(await page.getByText('FOREIGN_RESULT_A').count(),0);
 // A changed review version cannot silently overwrite unsaved input or be approved.
 await page.locator('input[value="Title A"]').fill('Unsaved A');
 tasks[0]={...tasks[0],reviewVersion:'v2',listingResult:{en:{...tasks[0].listingResult.en,title:'Server A'}}};
 await page.evaluate(t=>(window as any).socket.onmessage({data:JSON.stringify({type:'TASK_UPDATED',payload:t})}),tasks[0]);
 await page.getByText('Dieser Review wurde zwischenzeitlich geändert.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Freigeben & Weiter'}).count(),0);
 await page.getByRole('button',{name:'Aktuellen Review laden und alte Eingaben verwerfen'}).click();
 await page.locator('input[value="Server A"]').waitFor();
 // Even a misrouted successful API response is rejected rather than displayed.
 wrongDetail=true;await page.locator('[data-review-select="B"]').click();
 await page.getByText('Review-Details konnten nicht eindeutig geladen werden.').waitFor();
 assert.equal(await page.getByRole('button',{name:'Freigeben & Weiter'}).count(),0);
 wrongDetail=false;await page.getByRole('button',{name:'Erneut laden'}).click();
 await page.locator('input[value="Title B"]').waitFor();
 // The same session mechanism owns all other checkpoints, including the SVG child.
 for (const checkpoint of ['DESIGN_REVIEW','UPDATE_REVIEW','PRE_FLIGHT','SVG_REVIEW']) {
   const statuses:Record<string,string>={DESIGN_REVIEW:'AWAITING_DESIGN_REVIEW',UPDATE_REVIEW:'UPDATE_ANALYZED',PRE_FLIGHT:'AWAITING_PRE_FLIGHT_REVIEW',SVG_REVIEW:'AWAITING_SVG_REVIEW'};
   tasks=['A','B'].map(id=>({...task(id),status:statuses[checkpoint],checkpoint,
     source:checkpoint==='UPDATE_REVIEW'?'UPDATE':'DESIGNER',
     customAnswers:{niche1:`Niche ${id}`,audience:id==='A'?'Men':'Women',avoidColor:id==='A'?'White':'Black',maxColors:id==='A'?2:5},
     svgContent:`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="20">SVG ${id}</text></svg>`}));
   await page.reload();
   await page.locator('[data-review-select="B"]').waitFor();
   // Ensure A's details have rendered before switching to another same-status task.
   if(checkpoint==='PRE_FLIGHT') await page.locator('input[value="Quote A"]').waitFor();
   else if(checkpoint==='SVG_REVIEW') await page.locator('svg').filter({hasText:'SVG A'}).waitFor();
   else await page.locator('input[value="Niche A"]').waitFor();
   await page.locator('[data-review-select="B"]').click();
   if(checkpoint==='PRE_FLIGHT') await page.locator('input[value="Quote B"]').waitFor();
   else if(checkpoint==='SVG_REVIEW') {await page.locator('svg').filter({hasText:'SVG B'}).waitFor();assert.equal(await page.locator('svg').filter({hasText:'SVG A'}).count(),0);}
   else await page.locator('input[value="Niche B"]').waitFor();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS real React A→B isolation, draft preservation, bounded burst fetches, task-bound POST, A→B→A, stale recheck, version conflict, wrong-ID response');
} finally {await browser.close();await new Promise<void>((r,e)=>server.close(err=>err?e(err):r()));}

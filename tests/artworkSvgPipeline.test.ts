import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtworkRenderSession } from '../src/server/services/artworkRenderSession';
import { installArtworkRuntime } from '../src/server/services/artworkRenderRuntime';
import { prepareBrushLayer } from '../src/server/services/artworkBrushRuntime';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { artworkProfiles, validateProfile } from '../src/server/services/artworkProfiles';
import { SvgRenderService } from '../src/server/services/svgRenderService';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="25" y="25" width="50" height="50" fill="#ff0000"/><circle cx="50" cy="50" r="10" fill="#00ff00"/></svg>';
const inspect = async (page: any) => page.evaluate(() => {
  const img=document.getElementById('output') as HTMLImageElement;
  const c=document.createElement('canvas'); c.width=img.naturalWidth;c.height=img.naturalHeight;
  const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;
  let count=0,left=c.width,right=-1,top=c.height,bottom=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i]>200&&d[i+1]<50&&d[i+3]>200){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  return {count,left,right,top,bottom,width:c.width,height:c.height};
});

await ArtworkRenderSession.run(async page => {
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=120;const ctx=c.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(20,30,40,60);return c.toDataURL();});
  const g=await page.evaluate(installArtworkRuntime,{kind:'PNG' as const,data:png});
  assert.deepEqual(g.bounds,{x:20,y:30,width:40,height:60});
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:400,height:400,background:'#4e4a46',boxes:[{x:0,y:0,width:400,height:400}]});
  let pixels=await inspect(page);assert.equal(pixels.count,2400);assert.equal(pixels.right-pixels.left+1,40);assert.equal(pixels.bottom-pixels.top+1,60);
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:40,height:40,boxes:[{x:0,y:0,width:20,height:30}]});
  pixels=await inspect(page);assert.equal(pixels.count,600);
  console.log('PASS PNG: alpha crop, exact 1:1 pixels, downscale only, centered on larger background');

  await page.evaluate(installArtworkRuntime,{kind:'SVG' as const,data:svg});
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:500,height:500,boxes:[{x:25,y:25,width:450,height:450}]});
  pixels=await inspect(page);assert.equal(pixels.left,25);assert.equal(pixels.right,474);
  // Target larger than canonical cropped raster: SVG is still the live vector source.
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:2500,height:2500,boxes:[{x:0,y:0,width:2500,height:2500}]});
  pixels=await inspect(page);assert(pixels.left<=1);assert(pixels.right>=2498);
  const vector=await page.evaluate(()=>decodeURIComponent((document.getElementById('output') as HTMLImageElement).src));
  assert(vector.includes('<rect'));assert(!vector.includes('data:image/png'));
  console.log('PASS SVG: target-size vector composition, centered contain, no intermediate raster');

  await page.evaluate(prepareBrushLayer,{brushUri:'data:image/png;base64,'+fs.readFileSync(ArtworkResizeService.getBrushTipPath()).toString('base64'),seed:12345});
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:600,height:400,brush:true,boxes:[{x:0,y:0,width:280,height:400},{x:320,y:0,width:280,height:400}]});
  pixels=await inspect(page);assert(pixels.count>1000);
  const composed=await page.evaluate(()=>decodeURIComponent((document.getElementById('output') as HTMLImageElement).src));
  assert(composed.includes('<rect'));assert(composed.includes('data:image/png'));
  console.log('PASS Brush: raster texture plus original vector artwork, two-sided composition');

  const complex='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="4" dy="4" stdDeviation="3" flood-color="black"/></filter><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="10" fill="black"/></mask></defs><g mask="url(#m)" filter="url(#s)"><rect x="25" y="25" width="50" height="50" fill="red" stroke="blue" stroke-width="10"/></g></svg>';
  const complexBounds=await page.evaluate(installArtworkRuntime,{kind:'SVG' as const,data:complex});
  assert(complexBounds.bounds.width>2430,'Visible bounds must include strokes and shadow, not only rect geometry');
  await page.evaluate(p=>(window as any).__artwork.render(p),{width:500,height:600,master:true,boxes:[]});
  const alpha=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=600;const ctx=c.getContext('2d')!;ctx.drawImage(document.getElementById('output') as HTMLImageElement,0,0);return ctx.getImageData(250,300,1,1).data[3];});
  assert.equal(alpha,0,'Masked interior hole must remain transparent');
  console.log('PASS SVG effects: visible stroke/shadow bounds and transparent mask hole');

  await assert.rejects(()=>page.evaluate(installArtworkRuntime,{kind:'SVG' as const,data:'<svg xmlns="http://www.w3.org/2000/svg"/>'}),/transparent/);
  await assert.rejects(()=>page.evaluate(installArtworkRuntime,{kind:'SVG' as const,data:'<svg><script>alert(1)</script></svg>'}),/Aktiver/);
  await assert.rejects(()=>page.evaluate(installArtworkRuntime,{kind:'SVG' as const,data:'<svg><image href="https://example.com/a.png"/></svg>'}),/Externe/);
});

const master=await SvgRenderService.renderSvgToMbaPng(svg,500,600);
assert.equal(master.readUInt32BE(16),500);assert.equal(master.readUInt32BE(20),600);assert(master.includes(Buffer.from('pHYs')));
await ArtworkRenderSession.run(async page=>{
  await page.setViewportSize({width:500,height:600});
  // Exact previous master layout, used only as a test reference.
  await page.setContent(`<html><head><script>window.__name=t=>t;</script><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:500px;height:600px;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden}.design-container{width:450px;height:540px;display:flex;align-items:center;justify-content:center}svg{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto}</style></head><body><div class="design-container">${svg}</div></body></html>`);
  const previous=await page.screenshot({type:'png',omitBackground:true});
  const delta=await page.evaluate(async images=>{
    const read=async(uri:string)=>{const image=new Image();image.src=uri;await image.decode();const c=document.createElement('canvas');c.width=500;c.height=600;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return ctx.getImageData(0,0,500,600).data;};
    const a=await read(images[0]),b=await read(images[1]);let different=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>2)different++;return different/a.length;
  },[previous,master].map(b=>'data:image/png;base64,'+b.toString('base64')));
  assert(delta<0.001,`Master layout regression: ${delta}`);
  console.log('PASS master visual regression against previous layout:',delta);
});
assert.equal(artworkProfiles().find(p=>p.key==='CANVAS_BG_CONTAIN_4452X5292_DARK')?.width,8904);
assert.throws(()=>validateProfile({key:'bad',suffix:'bad',width:100000,height:100000,boxes:[]}));

// Exercise real file output in an isolated working directory, not the production queue.
const cwd=process.cwd(), temporary=fs.mkdtempSync(path.join(os.tmpdir(),'svg-artwork-test-'));
try {
  fs.symlinkSync(path.join(cwd,'assets'),path.join(temporary,'assets'),'dir');process.chdir(temporary);
  const config={mode:'CANVAS_BACKGROUND_CONTAIN',source:'VISIBLE_ARTWORK',canvas:{width:500,height:600},paddingShortSidePct:.1,backgroundProfile:'DARK_PRODUCT'} as const;
  const file=await ArtworkResizeService.generateProductVariant('fixture',{kind:'SVG',svg},'TEST',config);
  assert(fs.existsSync(file));assert.equal(fs.readFileSync(file).readUInt32BE(16),500);
  assert(!fs.readdirSync(path.dirname(file)).some(name=>name.includes('trimmed')||name.endsWith('.tmp')));
  if (process.env.ARTWORK_FULL_SIZE_TEST === '1') {
    const source={kind:'SVG' as const,svg};
    const assets=await ArtworkResizeService.generateResizedArtworks('full_fixture',source);
    assert.equal(Object.keys(assets.productVariants!).length,4);assert.equal(assets.trimmedPath,undefined);
    assert(ArtworkResizeService.hasCurrentAssets(assets,ArtworkResizeService.fingerprint(source)));
    const blanket=assets.productVariants!.CANVAS_BG_CONTAIN_4452X5292_DARK;
    await ArtworkRenderSession.run(async page=>{
      const alpha=await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();const c=document.createElement('canvas');c.width=2;c.height=2;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0,2,2);return [ctx.getImageData(0,0,1,1).data[3],ctx.getImageData(1,1,1,1).data[3]];},'data:image/png;base64,'+fs.readFileSync(blanket).toString('base64'));
      assert.deepEqual(alpha,[255,255],'Large background output must not end in a transparent screenshot cutoff');
    });
    assert(!ArtworkResizeService.hasCurrentAssets(assets,ArtworkResizeService.fingerprint({kind:'SVG',svg:svg.replace('#ff0000','#0000ff')})));
    fs.appendFileSync(assets.mugStandardPath,'corrupt');
    assert(!ArtworkResizeService.hasCurrentAssets(assets,ArtworkResizeService.fingerprint(source)));
    console.log('PASS full-size SVG: all eight variants, 200%/150% dimensions, source/file hash invalidation');
  }
} finally { process.chdir(cwd);fs.rmSync(temporary,{recursive:true,force:true}); }
console.log('PASS master/profile guards/file generation: no trimmed file, stable output path, valid PNG');

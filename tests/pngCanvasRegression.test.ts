import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtworkRenderSession } from '../src/server/services/artworkRenderSession';
import { installArtworkRuntime } from '../src/server/services/artworkRenderRuntime';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { validateArtworkPng } from '../src/server/services/artworkPngValidation';

await ArtworkRenderSession.run(async page => {
  const source = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 120;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(20, 30, 40, 60);
    return c.toDataURL();
  });
  await page.evaluate(installArtworkRuntime, { kind: 'PNG', data: source });
  // Neither a composite SVG decode nor screenshot may be needed by this path.
  await page.evaluate(() => { (window as any).__artwork.render = () => { throw new Error('SVG path used'); }; });
  for (const [size, boxWidth, boxHeight, expected] of [[400, 400, 400, 2400], [40, 20, 30, 600]]) {
    const result = await page.evaluate(async ({size, boxWidth, boxHeight}) => {
      const base64 = await (window as any).__artwork.renderPng({width:size, height:size, boxes:[{x:0,y:0,width:boxWidth,height:boxHeight}]});
      const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d')!; ctx.drawImage(img,0,0);
      const d = ctx.getImageData(0,0,size,size).data;
      let opaque = 0; for (let i=3;i<d.length;i+=4) if(d[i] === 255) opaque++;
      return {base64, opaque};
    }, {size, boxWidth, boxHeight});
    await validateArtworkPng(Buffer.from(result.base64, 'base64'), size, size);
    assert.equal(result.opaque, expected);
  }
  const brushResult = await page.evaluate(async () => {
    const brush = document.createElement('canvas'); brush.width = 60; brush.height = 80;
    const ctx = brush.getContext('2d')!; ctx.fillStyle = 'blue'; ctx.fillRect(0,0,60,80);
    (window as any).__artwork.brush = {uri:brush.toDataURL(),width:60,height:80,padding:10};
    const base64 = await (window as any).__artwork.renderPng({width:200,height:100,brush:true,boxes:[{x:0,y:0,width:100,height:100},{x:100,y:0,width:100,height:100}]});
    const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
    const out = document.createElement('canvas'); out.width=200;out.height=100;
    const outCtx = out.getContext('2d')!;outCtx.drawImage(img,0,0);
    const pixel = (x:number,y:number) => Array.from(outCtx.getImageData(x,y,1,1).data);
    return {left:pixel(30,20),right:pixel(130,20),brush:pixel(20,10),outside:pixel(19,10)};
  });
  assert.deepEqual(brushResult,{left:[255,0,0,255],right:[255,0,0,255],brush:[0,0,255,255],outside:[0,0,0,0]});
});

if (process.env.ARTWORK_FULL_SIZE_TEST === '1') {
  const cwd = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'png-canvas-regression-'));
  try {
    const source = await ArtworkRenderSession.run(async page => page.evaluate(() => {
      const c = document.createElement('canvas'); c.width=4500;c.height=5400;
      const ctx=c.getContext('2d')!;const pixels=ctx.createImageData(4065,3720);
      let seed=12345;
      for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=seed>>>24;pixels.data[i]=v;pixels.data[i+1]=v;pixels.data[i+2]=v;pixels.data[i+3]=255;}
      ctx.putImageData(pixels,200,400);return c.toDataURL().split(',')[1];
    }));
    fs.symlinkSync(path.join(cwd,'assets'),path.join(temporary,'assets'),'dir');
    const input=path.join(temporary,'source.png');fs.writeFileSync(input,Buffer.from(source,'base64'));
    process.chdir(temporary);
    const file=await ArtworkResizeService.generateProductVariant('fixture',{kind:'PNG',path:input},'TEST_LARGE',{
      mode:'CANVAS_BACKGROUND_CONTAIN',source:'VISIBLE_ARTWORK',canvas:{width:8904,height:10584},paddingShortSidePct:.05,backgroundProfile:'DARK_PRODUCT'
    });
    await validateArtworkPng(fs.readFileSync(file),8904,10584);
    assert(!fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')));
    console.log('PASS full-size PNG: 4065×3720 visible source to 8904×10584 output, committed file integrity');
    const assets = await ArtworkResizeService.generateResizedArtworks('all_variants', {kind:'PNG',path:input});
    assert.equal(Object.keys(assets.productVariants!).length, 4);
    assert(ArtworkResizeService.hasCurrentAssets(assets, ArtworkResizeService.fingerprint({kind:'PNG',path:input})));
    console.log('PASS complete PNG job: real brush preparation and all eight output files');
  } finally {process.chdir(cwd);fs.rmSync(temporary,{recursive:true,force:true});}
}
console.log('PASS direct PNG canvas: no upscale, downscale, brush layering and two-sided placement');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ArtworkRenderSession } from '../src/server/services/artworkRenderSession';
import { installArtworkRuntime } from '../src/server/services/artworkRenderRuntime';
import { prepareBrushLayer } from '../src/server/services/artworkBrushRuntime';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';

// Deterministic high-entropy PNG with transparency; unlike a small SVG fixture,
// this exposes regressions proportional to the encoded PNG/data-URI length.
const brushUri = 'data:image/png;base64,' + fs.readFileSync(ArtworkResizeService.getBrushTipPath()).toString('base64');
await ArtworkRenderSession.run(async page => {
  const steps: string[] = [];
  await page.exposeFunction('__reportBrushStep', (detail: string) => { steps.push(detail); });
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800; canvas.height = 1800;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let random = 42;
    for (let y = 40; y < 1760; y++) for (let x = 40; x < 1760; x++) {
      if ((Math.floor(x / 128) + Math.floor(y / 128)) % 5 === 0) continue;
      const index = (y * canvas.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        pixels.data[index + channel] = random >>> 24;
      }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  });
  assert(data.length > 8_000_000, 'Fixture must contain realistic encoded PNG volume');
  const geometry = await page.evaluate(installArtworkRuntime, { kind: 'PNG' as const, data });
  assert.deepEqual(geometry.bounds, { x: 40, y: 40, width: 1720, height: 1720 });
  await page.evaluate(expectedBrushUri => {
    const state = (window as any).__artwork;
    state.crop = () => { throw new Error('Regression: PNG wrapped into cropped SVG'); };
    state.encode = () => { throw new Error('Regression: PNG encoded as SVG'); };
    const load = state.load;
    state.load = (uri: string) => {
      if (uri !== expectedBrushUri) throw new Error('Regression: source decoded again');
      return load(uri);
    };
    // Reading the source URL must not be part of brush generation. Native image
    // decoding/drawing still works; this traps accidental JavaScript getter use.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    (window as any).__restoreSrc = () => Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor, get() { throw new Error('Regression: image.src read during brush preparation'); }
    });
  }, brushUri);
  const seed = createHash('sha256').update(data).digest().readUInt32BE(0);
  try {
    const first = await page.evaluate(prepareBrushLayer, { brushUri, seed });
    assert.deepEqual(steps, ['Bildquelle direkt zuschneiden', 'Brush-Textur laden', 'Konturmaske bereinigen', 'Kontur und Stempel berechnen', 'Brush-Ebene als PNG kodieren']);
    assert.equal(first.passes, 10);
    assert.equal(first.sourceWidth, 1720);
    assert.equal(first.sourceHeight, 1720);
    assert(first.candidates > 0 && first.stamps > 0);
    assert(first.stamps <= first.candidates);
    const digest = await page.evaluate(() => (window as any).__artwork.brush.uri);
    await page.evaluate(prepareBrushLayer, { brushUri, seed });
    assert.equal(await page.evaluate(() => (window as any).__artwork.brush.uri), digest, 'Same source and seed must reproduce the texture');
    await page.evaluate(prepareBrushLayer, { brushUri, seed: (seed ^ 1) >>> 0 });
    assert.notEqual(await page.evaluate(() => (window as any).__artwork.brush.uri), digest);
    console.log('PASS detail-rich PNG brush: direct crop, no source re-decode/src reads, original passes, deterministic short seed');
    console.log(JSON.stringify({ pngUriChars: data.length, metrics: first }));
  } finally {
    await page.evaluate(() => (window as any).__restoreSrc());
  }
  await assert.rejects(() => page.evaluate(prepareBrushLayer, { brushUri, seed: -1 }), /Startwert/);
});

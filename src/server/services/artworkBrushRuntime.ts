/** Existing brush texture/contour algorithm, isolated from artwork rasterization. */
export async function prepareBrushLayer(params: { brushUri: string; seed: number }) {
 if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 0xffffffff) throw new Error('Ungültiger Brush-Startwert');
 const report = async (detail: string) => {
   const callback = (window as any).__reportBrushStep;
   if (callback) await callback(detail);
 };
 await report('Bildquelle direkt zuschneiden');
 const started = performance.now();
 const state = (window as any).__artwork;
 const source: HTMLCanvasElement = state.createBrushSource();
 const sourceMs = performance.now() - started;
 await report('Brush-Textur laden');
 const brushLoadStart = performance.now();
 const brushImage = await state.load(params.brushUri);
 const brushLoadMs = performance.now() - brushLoadStart;
 // Node derives this fixed-size seed from the existing render fingerprint.
 // Never iterate over an HTMLImageElement.src getter or its full data URI here.
 let seed=params.seed >>> 0;
 const metrics = { sourceMs, brushLoadMs, cleanupMs: 0, contourMs: 0, encodeMs: 0, totalMs: 0,
   sourceWidth: source.width, sourceHeight: source.height, candidates: 0, stamps: 0, passes: 10 };
 const random=()=> { seed=(Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
        // Helper: removeSpecks (< 25 px) - Zero-allocation & Early-cutoff optimiert
        const removeSpecks = async (canvas: HTMLCanvasElement, minSize = 25): Promise<void> => {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          const width = canvas.width;
          const height = canvas.height;
          const totalPixels = width * height;
          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;
          const visited = new Uint8Array(totalPixels);
          let modified = false;

          // Wiederverwendbare feste Puffer statt Millionen Array-Objekten im V8-Heap
          const queue = new Int32Array(Math.min(totalPixels, 100000));
          const speckOffsets = new Int32Array(minSize);

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const startIdx = y * width + x;
              if (visited[startIdx] || data[4 * startIdx + 3] === 0) continue;

              let head = 0;
              let tail = 0;
              queue[tail++] = startIdx;
              visited[startIdx] = 1;

              let componentSize = 0;
              let isSpeck = true;

              while (head < tail) {
                const curIdx = queue[head++];
                const cx = curIdx % width;
                const cy = (curIdx / width) | 0;

                if (isSpeck) {
                  if (componentSize < minSize) {
                    speckOffsets[componentSize] = 4 * curIdx;
                  }
                  componentSize++;
                  if (componentSize >= minSize) {
                    // Sobald Komponentengröße >= minSize: Definitiv kein Speck!
                    // Stoppt sofort das Sammeln von Offsets, spart massiv Speicher
                    isSpeck = false;
                  }
                }

                // 8 Nachbarn absuchen
                for (let dy = -1; dy <= 1; dy++) {
                  const ny = cy + dy;
                  if (ny < 0 || ny >= height) continue;
                  const rowOffset = ny * width;
                  for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = cx + dx;
                    if (nx < 0 || nx >= width) continue;
                    const nIdx = rowOffset + nx;
                    if (!visited[nIdx] && data[4 * nIdx + 3] > 0) {
                      visited[nIdx] = 1;
                      if (tail < queue.length) {
                        queue[tail++] = nIdx;
                      }
                    }
                  }
                }
              }

              // Wurde als isolierter Speck (< minSize) identifiziert: Pixel löschen
              if (isSpeck && componentSize < minSize) {
                for (let i = 0; i < componentSize; i++) {
                  const offset = speckOffsets[i];
                  data[offset] = 0;
                  data[offset + 1] = 0;
                  data[offset + 2] = 0;
                  data[offset + 3] = 0;
                }
                modified = true;
              }
            }
          }

          if (modified) {
            ctx.putImageData(imgData, 0, 0);
          }
        };

        // Helper: applyBlackBrush
        const applyBlackBrush = async (
          sourceCanvas: HTMLCanvasElement,
          brushP: HTMLImageElement | null
        ): Promise<HTMLCanvasElement> => {
          await report('Konturmaske bereinigen');
          const cleanupStart = performance.now();
          await removeSpecks(sourceCanvas);
          metrics.cleanupMs = performance.now() - cleanupStart;
          await report('Kontur und Stempel berechnen');

          const n = sourceCanvas.width;
          const o = sourceCanvas.height;
          const r = document.createElement('canvas');
          const s = 0.15 * Math.max(n, o);
          r.width = Math.ceil(n + 2 * s);
          r.height = Math.ceil(o + 2 * s);
          const a = r.getContext('2d');
          if (!a) return sourceCanvas;

          if (!brushP) {
            // Fallback outline if brush_tip is missing
            a.drawImage(sourceCanvas, s, s);
            return r;
          }

          const u = 16;
          const m = 3;
          const h = [0.6, 0.9, 1.2];
          const g: { canvas: HTMLCanvasElement; halfW: number; halfH: number }[] = [];

          for (let e = 0; e < m; e++) {
            const t = h[e];
            const bw = Math.ceil(brushP.width * t);
            const bh = Math.ceil(brushP.height * t);
            const br = Math.ceil(Math.sqrt(bw * bw + bh * bh));
            for (let k = 0; k < u; k++) {
              const rot = (k / u) * Math.PI * 2;
              const bc = document.createElement('canvas');
              bc.width = br;
              bc.height = br;
              const bctx = bc.getContext('2d');
              if (bctx) {
                bctx.translate(br / 2, br / 2);
                bctx.rotate(rot);
                bctx.scale(t, t);
                bctx.drawImage(brushP, -brushP.width / 2, -brushP.height / 2);
                g.push({
                  canvas: bc,
                  halfW: br / 2,
                  halfH: br / 2
                });
              }
            }
          }

          const b = g.length;
          const f = 0.1;
          const y = document.createElement('canvas');
          y.width = Math.ceil(n * f);
          y.height = Math.ceil(o * f);
          const v = y.getContext('2d', { willReadFrequently: true });
          if (!v) return sourceCanvas;

          v.drawImage(sourceCanvas, 0, 0, y.width, y.height);

          for (let e = 0; e < 2; e++) {
            v.drawImage(y, 1, 0);
            v.drawImage(y, -1, 0);
            v.drawImage(y, 0, 1);
            v.drawImage(y, 0, -1);
          }

          const w = v.getImageData(0, 0, y.width, y.height);
          for (let e = 0; e < w.data.length; e += 4) {
            if (w.data[e + 3] > 0) {
              w.data[e] = 0;
              w.data[e + 1] = 0;
              w.data[e + 2] = 0;
              w.data[e + 3] = 255;
            }
          }
          v.putImageData(w, 0, 0);

          const xPts: { x: number; y: number }[] = [];
          const kw = y.width;
          const ch = y.height;
          const ed = v.getImageData(0, 0, kw, ch).data;
          const S = 2;
          for (let e = 1; e < ch - 1; e += S) {
            for (let t = 1; t < kw - 1; t += S) {
              if (ed[4 * (e * kw + t) + 3] > 0) {
                if (
                  ed[4 * ((e - 1) * kw + t) + 3] !== 0 &&
                  ed[4 * ((e + 1) * kw + t) + 3] !== 0 &&
                  ed[4 * (e * kw + (t - 1)) + 3] !== 0 &&
                  ed[4 * (e * kw + (t + 1)) + 3] !== 0
                ) {
                  // Internal pixel, ignore
                } else {
                  xPts.push({
                    x: t / f + s,
                    y: e / f + s
                  });
                }
              }
            }
          }

          const P = document.createElement('canvas');
          P.width = r.width;
          P.height = r.height;
          const A = P.getContext('2d');
          if (A) {
            A.drawImage(sourceCanvas, s, s);
            A.globalCompositeOperation = 'source-in';
            A.fillStyle = 'black';
            A.fillRect(0, 0, P.width, P.height);
          }

          a.drawImage(P, 0, 0);
          // Preserve the original brush contour and density.
          for (let e = 0; e < 10; e++) {
            a.drawImage(r, 1, 0);
            a.drawImage(r, -1, 0);
            a.drawImage(r, 0, 1);
            a.drawImage(r, 0, -1);
          }

          const L = 0.5;
          const TPts: { x: number; y: number }[] = [];
          for (let e = 0; e < xPts.length; e++) {
            if (random() < L) TPts.push(xPts[e]);
          }
          metrics.candidates = xPts.length;
          metrics.stamps = TPts.length;

          for (let e = 0; e < TPts.length; e++) {
            const pt = TPts[e];
            const stamp = g[Math.floor(random() * b)];
            a.drawImage(stamp.canvas, pt.x - stamp.halfW, pt.y - stamp.halfH);
          }

          a.globalCompositeOperation = 'source-over';
          return r;
        };


 const contourStart = performance.now();
 const layer=await applyBlackBrush(source,brushImage);
 metrics.contourMs = performance.now() - contourStart - metrics.cleanupMs;
 await report('Brush-Ebene als PNG kodieren');
 const encodeStart = performance.now();
 state.brush={uri:layer.toDataURL('image/png'),width:layer.width,height:layer.height,padding:0.15*Math.max(source.width,source.height)};
 metrics.encodeMs = performance.now() - encodeStart;
 metrics.totalMs = performance.now() - started;
 source.width=0; source.height=0; layer.width=0; layer.height=0;
 return metrics;
}

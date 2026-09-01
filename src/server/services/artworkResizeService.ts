import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromiumExecutable } from './browserSessionService';

const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    const executablePath = findChromiumExecutable();
    const launchOptions: any = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    sharedBrowser = await chromium.launch(launchOptions);
  }
  return sharedBrowser;
}

// CRC32 table for PNG 300 DPI chunk calculation
const crcTable: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array | Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Injects a 300 DPI (pHYs) chunk into a PNG buffer according to PNG specification
 */
export function inject300Dpi(pngBuffer: Buffer): Buffer {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (pngBuffer[i] !== sig[i]) return pngBuffer;
  }

  const dpi = 300;
  const ppm = Math.round(dpi * 39.3701); // 11811 pixels/meter
  const physData = Buffer.alloc(9);
  physData.writeUInt32BE(ppm, 0);
  physData.writeUInt32BE(ppm, 4);
  physData.writeUInt8(1, 8); // 1 = meters

  const typeAndData = Buffer.concat([Buffer.from('pHYs', 'ascii'), physData]);
  const crc = crc32(typeAndData);

  const chunkHeader = Buffer.alloc(4);
  chunkHeader.writeUInt32BE(9, 0); // length of data is 9

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  const physChunk = Buffer.concat([chunkHeader, typeAndData, crcBuf]);

  // Insert immediately after IHDR chunk (33 bytes: 8 sig + 4 len + 4 IHDR + 13 data + 4 crc)
  return Buffer.concat([
    pngBuffer.subarray(0, 33),
    physChunk,
    pngBuffer.subarray(33)
  ]);
}

export interface ResizedArtworksResult {
  trimmedPath: string;
  mugStandardPath: string;
  mugBrushPath: string;
  drinkwareStandardPath: string;
}

export class ArtworkResizeService {
  /**
   * Resolves the brush_tip.png asset from multiple candidate paths
   */
  public static getBrushTipPath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'assets', 'brush_tip.png'),
      path.resolve(process.cwd(), 'dist', 'assets', 'brush_tip.png'),
      path.resolve(currentDir, '../../assets', 'brush_tip.png'),
      path.resolve(currentDir, '../assets', 'brush_tip.png'),
      path.resolve(process.cwd(), 'Erweiterungen und Programme /Listing Optimizer/assets', 'brush_tip.png')
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return candidates[0];
  }

  /**
   * Generates all resized variants from the master 4500x5400px MBA PNG:
   * 1. ${cleanId}_trimmed.png - Bounding box of artwork with transparent margins trimmed
   * 2. ${cleanId}_two_sided_mug_standard.png - 2700x1050 px, 300 DPI, centered on front/back
   * 3. ${cleanId}_two_sided_mug_brush.png - 2700x1050 px, 300 DPI with black brush contour
   * 4. ${cleanId}_two_sided_drinkware_standard.png - 3000x1400 px, 300 DPI for Tumbler & Water Bottle
   */
  public static async generateResizedArtworks(taskId: string, mbaPngPath: string): Promise<ResizedArtworksResult> {
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    if (!fs.existsSync(designsDir)) {
      try { fs.mkdirSync(designsDir, { recursive: true }); } catch (e) {}
    }

    const trimmedFilePath = path.join(designsDir, `${cleanId}_trimmed.png`);
    const mugStandardFilePath = path.join(designsDir, `${cleanId}_two_sided_mug_standard.png`);
    const mugBrushFilePath = path.join(designsDir, `${cleanId}_two_sided_mug_brush.png`);
    const drinkwareStandardFilePath = path.join(designsDir, `${cleanId}_two_sided_drinkware_standard.png`);

    if (!fs.existsSync(mbaPngPath)) {
      throw new Error(`Master MBA PNG not found at path: ${mbaPngPath}`);
    }

    const masterPngBuffer = fs.readFileSync(mbaPngPath);
    const masterPngDataUri = `data:image/png;base64,${masterPngBuffer.toString('base64')}`;

    const brushTipPath = this.getBrushTipPath();
    let brushTipDataUri = '';
    if (fs.existsSync(brushTipPath)) {
      const brushBuffer = fs.readFileSync(brushTipPath);
      brushTipDataUri = `data:image/png;base64,${brushBuffer.toString('base64')}`;
    } else {
      console.warn(`[ArtworkResizeService] ⚠️ brush_tip.png not found at ${brushTipPath}. Falling back without brush tip.`);
    }

    console.log(`[ArtworkResizeService] 📐 Starte Resize-Generierung für Task #${taskId} (Chromium Engine)...`);
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 3000, height: 2000 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(() => {
        (window as any).__name = (target: any) => target;
      });
      await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/><script>window.__name = function(t){return t;};</script></head><body></body></html>`);

      const evaluatedResults = await page.evaluate(async (params: { masterUri: string; brushUri: string }) => {
        const loadImage = (src: string): Promise<HTMLImageElement> => {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(e);
            img.src = src;
          });
        };

        const masterImg = await loadImage(params.masterUri);
        let brushImg: HTMLImageElement | null = null;
        if (params.brushUri) {
          try {
            brushImg = await loadImage(params.brushUri);
          } catch (e) {
            console.warn('Failed to load brush tip image in browser context', e);
          }
        }

        // 1. Trim Canvas (find exact bounding box where alpha > 0)
        const trimCanvas = (img: HTMLImageElement): HTMLCanvasElement => {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return canvas;

          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;

          let top = 0;
          let bottom = height - 1;
          let left = 0;
          let right = width - 1;

          // Find top
          let found = false;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data[4 * (y * width + x) + 3] > 0) {
                top = y;
                found = true;
                break;
              }
            }
            if (found) break;
          }

          if (!found) {
            // Completely empty image
            return canvas;
          }

          // Find bottom
          found = false;
          for (let y = height - 1; y >= top; y--) {
            for (let x = 0; x < width; x++) {
              if (data[4 * (y * width + x) + 3] > 0) {
                bottom = y;
                found = true;
                break;
              }
            }
            if (found) break;
          }

          // Find left
          found = false;
          for (let x = 0; x < width; x++) {
            for (let y = top; y <= bottom; y++) {
              if (data[4 * (y * width + x) + 3] > 0) {
                left = x;
                found = true;
                break;
              }
            }
            if (found) break;
          }

          // Find right
          found = false;
          for (let x = width - 1; x >= left; x--) {
            for (let y = top; y <= bottom; y++) {
              if (data[4 * (y * width + x) + 3] > 0) {
                right = x;
                found = true;
                break;
              }
            }
            if (found) break;
          }

          const croppedWidth = right - left + 1;
          const croppedHeight = bottom - top + 1;

          const trimmed = document.createElement('canvas');
          trimmed.width = croppedWidth;
          trimmed.height = croppedHeight;
          const trimmedCtx = trimmed.getContext('2d');
          if (trimmedCtx) {
            trimmedCtx.drawImage(img, left, top, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
          }
          return trimmed;
        };

        const trimmedCanvas = trimCanvas(masterImg);

        // Helper: drawCentered
        const drawCentered = (
          ctx: CanvasRenderingContext2D,
          source: HTMLCanvasElement,
          destX: number,
          destY: number,
          targetWidth: number,
          targetHeight: number
        ) => {
          const sw = source.width;
          const sh = source.height;
          const scale = Math.min(targetWidth / sw, targetHeight / sh, 1);
          const dw = sw * scale;
          const dh = sh * scale;
          const x = destX + (targetWidth - dw) / 2;
          const y = destY + (targetHeight - dh) / 2;
          ctx.drawImage(source, x, y, dw, dh);
        };

        // Helper: scaleDesignForProduct
        const scaleDesignForProduct = (
          sourceCanvas: HTMLCanvasElement,
          finalWidth: number,
          finalHeight: number,
          margin = 0.075
        ): HTMLCanvasElement => {
          const sw = sourceCanvas.width;
          const sh = sourceCanvas.height;

          const mt = finalHeight * margin;
          const mb = finalHeight * margin;
          const ml = finalWidth * margin;
          const mr = finalWidth * margin;

          const safeW = finalWidth - ml - mr;
          const safeH = finalHeight - mt - mb;

          const scale = Math.min(safeW / sw, safeH / sh);
          const dw = sw * scale;
          const dh = sh * scale;

          const ox = ml + (safeW - dw) / 2;
          const oy = mt + (safeH - dh) / 2;

          const canvas = document.createElement('canvas');
          canvas.width = finalWidth;
          canvas.height = finalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, finalWidth, finalHeight);
            ctx.drawImage(sourceCanvas, ox, oy, dw, dh);
          }
          return canvas;
        };

        // Helper: createMugCanvas (2700 x 1050)
        const createMugCanvas = (scaledSideDesign: HTMLCanvasElement): HTMLCanvasElement => {
          const canvas = document.createElement('canvas');
          canvas.width = 2700;
          canvas.height = 1050;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, 2700, 1050);
            const w = 1050;
            const h = 1045.646;
            const y = (1050 - h) / 2;
            drawCentered(ctx, scaledSideDesign, 59, y, w, h);
            drawCentered(ctx, scaledSideDesign, 1591, y, w, h);
          }
          return canvas;
        };

        // Helper: createTwoSidedCanvas for Drinkware (3000 x 1400)
        const createDrinkwareCanvas = (scaledSideDesign: HTMLCanvasElement): HTMLCanvasElement => {
          const canvas = document.createElement('canvas');
          canvas.width = 3000;
          canvas.height = 1400;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, 3000, 1400);
            const w = 1400;
            const h = 1400;
            const y = 0;
            drawCentered(ctx, scaledSideDesign, 31, y, w, h);
            drawCentered(ctx, scaledSideDesign, 1566.6667, y, w, h);
          }
          return canvas;
        };

        // Helper: removeSpecks (< 25 px)
        const removeSpecks = async (canvas: HTMLCanvasElement, minSize = 25): Promise<void> => {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const width = canvas.width;
          const height = canvas.height;
          const visited = new Uint8Array(width * height);
          const components: number[][] = [];
          const neighbors = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
          ];

          const floodFill = (startX: number, startY: number): number[] => {
            const queue: [number, number][] = [[startX, startY]];
            const pixels: number[] = [];
            visited[startY * width + startX] = 1;

            while (queue.length > 0) {
              const [cx, cy] = queue.pop()!;
              const idx = cy * width + cx;
              const pixelOffset = 4 * idx;
              if (data[pixelOffset + 3] > 0) {
                pixels.push(pixelOffset);
                for (const [dx, dy] of neighbors) {
                  const nx = cx + dx;
                  const ny = cy + dy;
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (!visited[nIdx] && data[4 * nIdx + 3] > 0) {
                      visited[nIdx] = 1;
                      queue.push([nx, ny]);
                    }
                  }
                }
              }
            }
            return pixels;
          };

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = y * width + x;
              if (!visited[idx] && data[4 * idx + 3] > 0) {
                const pixels = floodFill(x, y);
                if (pixels.length > 0) {
                  components.push(pixels);
                }
              }
            }
          }

          for (const comp of components) {
            if (comp.length < minSize) {
              for (const pixelOffset of comp) {
                data[pixelOffset] = 0;
                data[pixelOffset + 1] = 0;
                data[pixelOffset + 2] = 0;
                data[pixelOffset + 3] = 0;
              }
            }
          }
          ctx.putImageData(imgData, 0, 0);
        };

        // Helper: applyBlackBrush
        const applyBlackBrush = async (
          sourceCanvas: HTMLCanvasElement,
          brushP: HTMLImageElement | null
        ): Promise<HTMLCanvasElement> => {
          await removeSpecks(sourceCanvas);

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
          for (let e = 0; e < 10; e++) {
            a.drawImage(r, 1, 0);
            a.drawImage(r, -1, 0);
            a.drawImage(r, 0, 1);
            a.drawImage(r, 0, -1);
          }

          const L = 0.5;
          const TPts: { x: number; y: number }[] = [];
          for (let e = 0; e < xPts.length; e++) {
            if (Math.random() < L) {
              TPts.push(xPts[e]);
            }
          }

          for (let e = 0; e < TPts.length; e++) {
            const pt = TPts[e];
            const stamp = g[Math.floor(Math.random() * b)];
            a.drawImage(stamp.canvas, pt.x - stamp.halfW, pt.y - stamp.halfH);
          }

          a.globalCompositeOperation = 'source-over';
          a.drawImage(sourceCanvas, s, s);
          return r;
        };

        // Generation 1: Trimmed Master
        const trimmedDataUri = trimmedCanvas.toDataURL('image/png');

        // Generation 2: Mug Standard (2700x1050)
        const mugStandardScaled = scaleDesignForProduct(trimmedCanvas, 1050, 1050, 0.075);
        const mugStandardCanvas = createMugCanvas(mugStandardScaled);
        const mugStandardDataUri = mugStandardCanvas.toDataURL('image/png');

        // Generation 3: Mug Brush (2700x1050)
        const brushCanvas = await applyBlackBrush(trimmedCanvas, brushImg);
        const mugBrushScaled = scaleDesignForProduct(brushCanvas, 1050, 1050, 0.075);
        const mugBrushCanvas = createMugCanvas(mugBrushScaled);
        const mugBrushDataUri = mugBrushCanvas.toDataURL('image/png');

        // Generation 4: Drinkware Standard (3000x1400)
        const drinkwareScaled = scaleDesignForProduct(trimmedCanvas, 1400, 1400, 0.075);
        const drinkwareCanvas = createDrinkwareCanvas(drinkwareScaled);
        const drinkwareStandardDataUri = drinkwareCanvas.toDataURL('image/png');

        return {
          trimmedDataUri,
          mugStandardDataUri,
          mugBrushDataUri,
          drinkwareStandardDataUri
        };
      }, {
        masterUri: masterPngDataUri,
        brushUri: brushTipDataUri
      });

      // Write trimmed PNG (with 300 DPI)
      const trimmedBuf = inject300Dpi(Buffer.from(evaluatedResults.trimmedDataUri.split(',')[1], 'base64'));
      fs.writeFileSync(trimmedFilePath, trimmedBuf);

      // Write Mug Standard PNG (with 300 DPI)
      const mugStandardBuf = inject300Dpi(Buffer.from(evaluatedResults.mugStandardDataUri.split(',')[1], 'base64'));
      fs.writeFileSync(mugStandardFilePath, mugStandardBuf);

      // Write Mug Brush PNG (with 300 DPI)
      const mugBrushBuf = inject300Dpi(Buffer.from(evaluatedResults.mugBrushDataUri.split(',')[1], 'base64'));
      fs.writeFileSync(mugBrushFilePath, mugBrushBuf);

      // Write Drinkware Standard PNG (with 300 DPI)
      const drinkwareBuf = inject300Dpi(Buffer.from(evaluatedResults.drinkwareStandardDataUri.split(',')[1], 'base64'));
      fs.writeFileSync(drinkwareStandardFilePath, drinkwareBuf);

      console.log(`[ArtworkResizeService] ✅ Alle 4 Resized Varianten für Task #${taskId} erfolgreich gespeichert ✓`);

      return {
        trimmedPath: trimmedFilePath,
        mugStandardPath: mugStandardFilePath,
        mugBrushPath: mugBrushFilePath,
        drinkwareStandardPath: drinkwareStandardFilePath
      };
    } finally {
      await context.close();
    }
  }
}

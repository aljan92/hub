import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { findChromiumExecutable } from './browserSessionService';

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

export class VisionOptimizationService {
  /**
   * Generates a 4-color 2x2 Grid (1024x1024) preview for Vision LLMs (OpenRouter/Claude/Gemini)
   * using the container's built-in Playwright Chromium engine (zero native C++ dependencies).
   * - Top-Left: Black (#111827) - checks white/bright graphics & edge halos
   * - Top-Right: White (#ffffff) - checks black/dark graphics & contrast
   * - Bottom-Left: Red / Cranberry (#c53030) - checks color clashes & vibrancy
   * - Bottom-Right: Asphalt (#383E42) - checks midtone legibility & subtle artifacts
   */
  public static async prepareVisionImage(input: string | Buffer, outputPath?: string): Promise<{ base64DataUrl: string; is4Panel: boolean; savedPath?: string }> {
    try {
      let dataUri: string;
      if (typeof input === 'string') {
        if (input.startsWith('data:image')) {
          dataUri = input;
        } else if (fs.existsSync(input)) {
          const fileBuf = fs.readFileSync(input);
          dataUri = `data:image/png;base64,${fileBuf.toString('base64')}`;
        } else {
          throw new Error(`File not found: ${input}`);
        }
      } else if (Buffer.isBuffer(input)) {
        dataUri = `data:image/png;base64,${input.toString('base64')}`;
      } else {
        return { base64DataUrl: '', is4Panel: false };
      }

      const browser = await getBrowser();
      const context = await browser.newContext({
        viewport: { width: 1024, height: 1024 },
        deviceScaleFactor: 1
      });
      const page = await context.newPage();

      try {
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body {
                width: 1024px;
                height: 1024px;
                background: #0f172a;
                display: grid;
                grid-template-columns: 512px 512px;
                grid-template-rows: 512px 512px;
                overflow: hidden;
              }
              .panel {
                width: 512px;
                height: 512px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                padding: 24px;
              }
              .p-black { background: #111827; }
              .p-white { background: #ffffff; }
              .p-red { background: #c53030; }
              .p-asphalt { background: #383E42; }
              .panel img {
                max-width: 464px;
                max-height: 464px;
                width: auto;
                height: auto;
                object-fit: contain;
                display: block;
              }
              .label {
                position: absolute;
                bottom: 8px;
                left: 12px;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 11px;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              .label-dark { background: rgba(255,255,255,0.15); color: #f8fafc; }
              .label-light { background: rgba(0,0,0,0.15); color: #0f172a; }
            </style>
          </head>
          <body>
            <div class="panel p-black">
              <img src="${dataUri}" />
              <span class="label label-dark">1. Black (#111827)</span>
            </div>
            <div class="panel p-white">
              <img src="${dataUri}" />
              <span class="label label-light">2. White (#ffffff)</span>
            </div>
            <div class="panel p-red">
              <img src="${dataUri}" />
              <span class="label label-dark">3. Red (#c53030)</span>
            </div>
            <div class="panel p-asphalt">
              <img src="${dataUri}" />
              <span class="label label-dark">4. Asphalt (#383E42)</span>
            </div>
          </body>
          </html>
        `;

        await page.setContent(html);
        await page.waitForTimeout(30);
        const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 88 });

        if (outputPath) {
          try {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(outputPath, screenshotBuf);
          } catch (e: any) {
            console.warn('[VisionOptimizationService] Failed to save preview file:', e.message);
          }
        }

        return {
          base64DataUrl: `data:image/jpeg;base64,${screenshotBuf.toString('base64')}`,
          is4Panel: true,
          savedPath: outputPath && fs.existsSync(outputPath) ? outputPath : undefined
        };
      } finally {
        await context.close().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[VisionOptimizationService] Playwright render fallback:', err.message);
      if (typeof input === 'string' && input.startsWith('data:image')) {
        return { base64DataUrl: input, is4Panel: false };
      }
      return { base64DataUrl: '', is4Panel: false };
    }
  }

  /**
   * Generates a single, high-contrast, centered 1125x1350 preview image on flat neutral mid-gray (#B8B8B8)
   * specifically designed for Step U4 Master English Listing creation.
   * - Resolution: exactly 1125x1350 (1/4 width, 1/4 height of 4500x5400)
   * - Background: #B8B8B8 (neutral mid-gray, no gradients, no textures, no borders, no text, no watermarks)
   * - Centers transparent PNG, composites alpha seamlessly, preserves aspect ratio
   * - Drastically reduces vision token usage while ensuring both white and dark designs remain legible
   */
  public static async prepareU4PreviewImage(
    input: string | Buffer,
    outputPath?: string
  ): Promise<{ base64DataUrl: string; savedPath?: string }> {
    try {
      let dataUri: string;
      if (typeof input === 'string') {
        if (input.startsWith('data:image')) {
          dataUri = input;
        } else if (fs.existsSync(input)) {
          const fileBuf = fs.readFileSync(input);
          dataUri = `data:image/png;base64,${fileBuf.toString('base64')}`;
        } else {
          throw new Error(`File not found: ${input}`);
        }
      } else if (Buffer.isBuffer(input)) {
        dataUri = `data:image/png;base64,${input.toString('base64')}`;
      } else {
        return { base64DataUrl: '' };
      }

      const browser = await getBrowser();
      const context = await browser.newContext({
        viewport: { width: 1125, height: 1350 },
        deviceScaleFactor: 1
      });
      const page = await context.newPage();

      try {
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body {
                width: 1125px;
                height: 1350px;
                background-color: #B8B8B8;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
              }
              img {
                max-width: 1125px;
                max-height: 1350px;
                width: auto;
                height: auto;
                object-fit: contain;
                display: block;
              }
            </style>
          </head>
          <body>
            <img src="${dataUri}" />
          </body>
          </html>
        `;

        await page.setContent(html);
        await page.waitForTimeout(30);
        const screenshotBuf = await page.screenshot({ type: 'png' });

        if (outputPath) {
          try {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(outputPath, screenshotBuf);
          } catch (e: any) {
            console.warn('[VisionOptimizationService] Failed to save U4 preview file:', e.message);
          }
        }

        return {
          base64DataUrl: `data:image/png;base64,${screenshotBuf.toString('base64')}`,
          savedPath: outputPath && fs.existsSync(outputPath) ? outputPath : undefined
        };
      } finally {
        await context.close().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[VisionOptimizationService] U4 preview generation fallback:', err.message);
      return { base64DataUrl: '' };
    }
  }
}

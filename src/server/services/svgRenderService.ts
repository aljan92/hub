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

export class SvgRenderService {
  /**
   * Cleans XML declarations, doctypes, and whitespace noise from SVG strings
   */
  static cleanSvg(raw: string | undefined | null): string {
    if (!raw) return '';
    return raw
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .trim();
  }

  /**
   * Executes server-side Auto BG Remove (Corner Background detection & deletion)
   */
  static async autoRemoveCornerBackground(svgText: string): Promise<{ success: boolean; modifiedSvg: string; removedCount: number }> {
    const clean = this.cleanSvg(svgText);
    if (!clean) return { success: false, modifiedSvg: svgText, removedCount: 0 };

    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8" /></head>
        <body style="margin: 0; padding: 0;">
          <div id="container">${clean}</div>
        </body>
        </html>
      `);

      const result = await page.evaluate(() => {
        const parseColorToRGB = (colorStr: string | null): { r: number; g: number; b: number } | null => {
          if (!colorStr || colorStr === 'none' || colorStr === 'transparent') return null;
          let s = colorStr.trim().toLowerCase();

          if (s.startsWith('#')) {
            let hex = s.substring(1);
            if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            if (hex.length === 6) {
              return {
                r: parseInt(hex.substring(0, 2), 16),
                g: parseInt(hex.substring(2, 4), 16),
                b: parseInt(hex.substring(4, 6), 16)
              };
            }
          }

          const rgbMatch = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (rgbMatch) {
            return {
              r: parseInt(rgbMatch[1], 10),
              g: parseInt(rgbMatch[2], 10),
              b: parseInt(rgbMatch[3], 10)
            };
          }
          return null;
        };

        const colorsMatch = (color1: string | null, color2: string | null, tolerance: number = 25): boolean => {
          if (!color1 || !color2) return false;
          if (color1 === color2) return true;

          const p1 = parseColorToRGB(color1);
          const p2 = parseColorToRGB(color2);

          if (p1 && p2) {
            return Math.abs(p1.r - p2.r) <= tolerance &&
                   Math.abs(p1.g - p2.g) <= tolerance &&
                   Math.abs(p1.b - p2.b) <= tolerance;
          }
          return color1.toLowerCase() === color2.toLowerCase();
        };

        const getElementFill = (el: Element): string | null => {
          if (el.hasAttribute('fill')) {
            const f = el.getAttribute('fill');
            if (f && f !== 'none' && f !== 'transparent' && f !== 'rgba(0, 0, 0, 0)') return f;
          }
          const styleAttr = el.getAttribute('style');
          if (styleAttr) {
            const match = styleAttr.match(/fill\s*:\s*([^;]+)/);
            if (match && match[1] && match[1].trim() !== 'none') return match[1].trim();
          }
          try {
            const comp = window.getComputedStyle(el).fill;
            if (comp && comp !== 'none' && comp !== 'transparent' && comp !== 'rgba(0, 0, 0, 0)') return comp;
          } catch {}
          return null;
        };

        const isElementSafeToRemove = (el: Element): boolean => {
          if (!el) return false;
          const tag = el.tagName.toLowerCase();
          if (['svg', 'html', 'body', 'head', 'script', 'style', 'defs', 'clippath'].includes(tag)) return false;
          return true;
        };

        const svg = document.querySelector('svg');
        if (!svg) return { success: false, modifiedSvg: '', removedCount: 0 };

        const svgBBox = svg.getBBox();
        let topLeftElement: Element | null = null;
        let minDistance = Infinity;

        svg.querySelectorAll('*').forEach(el => {
          if (!isElementSafeToRemove(el)) return;
          try {
            const bbox = (el as SVGGraphicsElement).getBBox();
            if (bbox.width > 0 || bbox.height > 0) {
              const dist = Math.sqrt(Math.pow(bbox.x - svgBBox.x, 2) + Math.pow(bbox.y - svgBBox.y, 2));
              if (dist < minDistance) {
                topLeftElement = el;
                minDistance = dist;
              }
            }
          } catch {}
        });

        if (!topLeftElement) {
          return { success: false, modifiedSvg: svg.outerHTML, removedCount: 0 };
        }

        const targetColor = getElementFill(topLeftElement);
        if (!targetColor) {
          return { success: false, modifiedSvg: svg.outerHTML, removedCount: 0 };
        }

        let removedCount = 0;
        svg.querySelectorAll('*').forEach(el => {
          if (!isElementSafeToRemove(el)) return;
          const fill = getElementFill(el);
          if (fill && colorsMatch(fill, targetColor, 25)) {
            if (el.hasAttribute('fill')) {
              el.setAttribute('fill', 'none');
            } else {
              el.remove();
            }
            removedCount++;
          }
        });

        return {
          success: true,
          modifiedSvg: svg.outerHTML,
          removedCount
        };
      });

      return result;
    } catch (err: any) {
      console.error('[SvgRenderService] Auto BG remove error:', err);
      return { success: false, modifiedSvg: svgText, removedCount: 0 };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Renders the 4-Panel Verification Image (2048x2048 px: White, Black, Red, Slate)
   */
  static async render4PanelTestImage(svgText: string): Promise<Buffer> {
    const clean = this.cleanSvg(svgText);
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 2048, height: 2048 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            html, body {
              width: 2048px;
              height: 2048px;
              background: #0f172a;
              overflow: hidden;
            }
            .grid-container {
              display: grid;
              grid-template-columns: 1fr 1fr;
              grid-template-rows: 1fr 1fr;
              width: 2048px;
              height: 2048px;
              gap: 12px;
              background: #020617;
              padding: 12px;
            }
            .panel {
              position: relative;
              width: 100%;
              height: 100%;
              border-radius: 20px;
              overflow: hidden;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 60px;
            }
            .panel-1 { background-color: #ffffff; }
            .panel-2 { background-color: #000000; }
            .panel-3 { background-color: #d32f2f; }
            .panel-4 { background-color: #1e293b; }

            .panel-label {
              position: absolute;
              top: 20px;
              left: 20px;
              font-size: 26px;
              font-weight: 800;
              letter-spacing: 0.5px;
              padding: 8px 20px;
              border-radius: 10px;
              text-transform: uppercase;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            .panel-1 .panel-label { background: rgba(15, 23, 42, 0.9); color: #ffffff; border: 1px solid rgba(255,255,255,0.2); }
            .panel-2 .panel-label { background: rgba(255, 255, 255, 0.95); color: #000000; }
            .panel-3 .panel-label { background: rgba(15, 23, 42, 0.9); color: #ffffff; border: 1px solid rgba(255,255,255,0.2); }
            .panel-4 .panel-label { background: rgba(255, 255, 255, 0.95); color: #0f172a; }

            .svg-wrapper {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .svg-wrapper svg {
              width: 100%;
              height: 100%;
              max-width: 92%;
              max-height: 92%;
              object-fit: contain;
              display: block;
              margin: auto;
            }
          </style>
        </head>
        <body>
          <div class="grid-container">
            <div class="panel panel-1">
              <span class="panel-label">1. White BG</span>
              <div class="svg-wrapper">${clean}</div>
            </div>
            <div class="panel panel-2">
              <span class="panel-label">2. Black BG</span>
              <div class="svg-wrapper">${clean}</div>
            </div>
            <div class="panel panel-3">
              <span class="panel-label">3. Red BG</span>
              <div class="svg-wrapper">${clean}</div>
            </div>
            <div class="panel panel-4">
              <span class="panel-label">4. Slate / Dark Grey BG</span>
              <div class="svg-wrapper">${clean}</div>
            </div>
          </div>
        </body>
        </html>
      `;

      await page.setContent(htmlContent);
      await page.waitForTimeout(50); // allow SVG DOM paint
      const buffer = await page.screenshot({ type: 'png' });
      return buffer;
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Renders the optimal Merch by Amazon Print PNG (4500 x 5400 px, 300 DPI, Transparent Background)
   */
  static async renderSvgToMbaPng(svgText: string, width = 4500, height = 5400): Promise<Buffer> {
    const clean = this.cleanSvg(svgText);
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    try {
      // Standard safe area margin of 10% (4050 x 4860 px canvas)
      const containerWidth = Math.round(width * 0.90);
      const containerHeight = Math.round(height * 0.90);

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body {
              width: ${width}px;
              height: ${height}px;
              background: transparent;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            }
            .design-container {
              width: ${containerWidth}px;
              height: ${containerHeight}px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            svg {
              width: 100%;
              height: 100%;
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              display: block;
              margin: auto;
            }
          </style>
        </head>
        <body>
          <div class="design-container">
            ${clean}
          </div>
        </body>
        </html>
      `;

      await page.setContent(htmlContent);
      await page.waitForTimeout(60);
      const buffer = await page.screenshot({ type: 'png', omitBackground: true });
      return buffer;
    } finally {
      await context.close().catch(() => {});
    }
  }
}

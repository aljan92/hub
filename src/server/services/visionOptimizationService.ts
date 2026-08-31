import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class VisionOptimizationService {
  /**
   * Generates a high-contrast Vision-optimized image for LLMs (OpenRouter/Claude/Gemini).
   * For transparent PNGs: Creates a 1024x512 Dual-Panel canvas
   * - Left Panel (512x512, Dark Slate #0f172a): Perfect contrast for pure white/light text and graphics.
   * - Right Panel (512x512, Pure White #ffffff): Perfect contrast for pure black/dark text and graphics.
   *
   * For non-transparent images: Scales to max 1024x1024 for fast inference and token efficiency.
   */
  public static async prepareVisionImage(input: string | Buffer): Promise<{ base64DataUrl: string; isDualPanel: boolean }> {
    try {
      let buffer: Buffer;
      if (typeof input === 'string') {
        if (input.startsWith('data:image')) {
          const cleanBase64 = input.replace(/^data:image\/\w+;base64,/, '');
          buffer = Buffer.from(cleanBase64, 'base64');
        } else if (fs.existsSync(input)) {
          buffer = fs.readFileSync(input);
        } else {
          throw new Error(`File not found: ${input}`);
        }
      } else {
        buffer = input;
      }

      const metadata = await sharp(buffer).metadata();
      const hasAlpha = metadata.hasAlpha || (metadata.channels && metadata.channels >= 4);

      if (hasAlpha) {
        // Create 2-Panel Side-by-Side Image (1024x512)
        const panelSize = 512;
        const padding = 24;
        const maxDesignSize = panelSize - (padding * 2); // 464x464

        // Resize the transparent design to fit cleanly within panel
        const resizedDesignBuffer = await sharp(buffer)
          .resize(maxDesignSize, maxDesignSize, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();

        const resizedMeta = await sharp(resizedDesignBuffer).metadata();
        const designWidth = resizedMeta.width || maxDesignSize;
        const designHeight = resizedMeta.height || maxDesignSize;

        const leftOffset = Math.round((panelSize - designWidth) / 2);
        const topOffset = Math.round((panelSize - designHeight) / 2);

        // Panel 1: Dark Slate (#0f172a)
        const darkPanel = await sharp({
          create: {
            width: panelSize,
            height: panelSize,
            channels: 4,
            background: { r: 15, g: 23, b: 42, alpha: 1 } // #0f172a
          }
        })
          .composite([{ input: resizedDesignBuffer, left: leftOffset, top: topOffset }])
          .png()
          .toBuffer();

        // Panel 2: Pure White (#ffffff)
        const lightPanel = await sharp({
          create: {
            width: panelSize,
            height: panelSize,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 } // #ffffff
          }
        })
          .composite([{ input: resizedDesignBuffer, left: leftOffset, top: topOffset }])
          .png()
          .toBuffer();

        // Combine Panels horizontally (1024x512)
        const dualPanel = await sharp({
          create: {
            width: panelSize * 2,
            height: panelSize,
            channels: 4,
            background: { r: 30, g: 41, b: 59, alpha: 1 } // #1e293b
          }
        })
          .composite([
            { input: darkPanel, left: 0, top: 0 },
            { input: lightPanel, left: panelSize, top: 0 }
          ])
          .jpeg({ quality: 88 })
          .toBuffer();

        return {
          base64DataUrl: `data:image/jpeg;base64,${dualPanel.toString('base64')}`,
          isDualPanel: true
        };
      } else {
        // Solid background image: resize to max 1024x1024
        const resized = await sharp(buffer)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        return {
          base64DataUrl: `data:image/jpeg;base64,${resized.toString('base64')}`,
          isDualPanel: false
        };
      }
    } catch (err: any) {
      console.warn(`[VisionOptimizationService] Fallback to raw buffer:`, err.message);
      if (typeof input === 'string' && input.startsWith('data:image')) {
        return { base64DataUrl: input, isDualPanel: false };
      }
      if (Buffer.isBuffer(input)) {
        return { base64DataUrl: `data:image/png;base64,${input.toString('base64')}`, isDualPanel: false };
      }
      return { base64DataUrl: '', isDualPanel: false };
    }
  }
}

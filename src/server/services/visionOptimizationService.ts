import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class VisionOptimizationService {
  /**
   * Generates a 4-color 2x2 Grid (1024x1024) preview for Vision LLMs (OpenRouter/Claude/Gemini).
   * - Top-Left: Black (#111827) - checks white/bright graphics & edge halos
   * - Top-Right: White (#ffffff) - checks black/dark graphics & contrast
   * - Bottom-Left: Red / Cranberry (#c53030) - checks color clashes & vibrancy
   * - Bottom-Right: Asphalt (#383E42) - checks midtone legibility & subtle artifacts
   *
   * For non-transparent images: Scales down to max 1024x1024 for fast inference and token efficiency.
   */
  public static async prepareVisionImage(input: string | Buffer): Promise<{ base64DataUrl: string; is4Panel: boolean }> {
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
        // Create 2x2 Grid (1024x1024) across 4 standard Merch garment colors
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

        // Panel 1: Black (#111827)
        const blackPanel = await sharp({
          create: {
            width: panelSize,
            height: panelSize,
            channels: 4,
            background: { r: 17, g: 24, b: 39, alpha: 1 } // #111827
          }
        })
          .composite([{ input: resizedDesignBuffer, left: leftOffset, top: topOffset }])
          .png()
          .toBuffer();

        // Panel 2: White (#ffffff)
        const whitePanel = await sharp({
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

        // Panel 3: Red / Cranberry (#c53030)
        const redPanel = await sharp({
          create: {
            width: panelSize,
            height: panelSize,
            channels: 4,
            background: { r: 197, g: 48, b: 48, alpha: 1 } // #c53030
          }
        })
          .composite([{ input: resizedDesignBuffer, left: leftOffset, top: topOffset }])
          .png()
          .toBuffer();

        // Panel 4: Asphalt (#383E42)
        const asphaltPanel = await sharp({
          create: {
            width: panelSize,
            height: panelSize,
            channels: 4,
            background: { r: 56, g: 62, b: 66, alpha: 1 } // #383E42
          }
        })
          .composite([{ input: resizedDesignBuffer, left: leftOffset, top: topOffset }])
          .png()
          .toBuffer();

        // Combine into 2x2 Grid (1024x1024)
        const grid2x2 = await sharp({
          create: {
            width: panelSize * 2,
            height: panelSize * 2,
            channels: 4,
            background: { r: 15, g: 23, b: 42, alpha: 1 } // #0f172a divider background
          }
        })
          .composite([
            { input: blackPanel, left: 0, top: 0 },
            { input: whitePanel, left: panelSize, top: 0 },
            { input: redPanel, left: 0, top: panelSize },
            { input: asphaltPanel, left: panelSize, top: panelSize }
          ])
          .jpeg({ quality: 88 })
          .toBuffer();

        return {
          base64DataUrl: `data:image/jpeg;base64,${grid2x2.toString('base64')}`,
          is4Panel: true
        };
      } else {
        // Solid background image: resize to max 1024x1024
        const resized = await sharp(buffer)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        return {
          base64DataUrl: `data:image/jpeg;base64,${resized.toString('base64')}`,
          is4Panel: false
        };
      }
    } catch (err: any) {
      console.warn(`[VisionOptimizationService] Fallback to raw buffer:`, err.message);
      if (typeof input === 'string' && input.startsWith('data:image')) {
        return { base64DataUrl: input, is4Panel: false };
      }
      if (Buffer.isBuffer(input)) {
        return { base64DataUrl: `data:image/png;base64,${input.toString('base64')}`, is4Panel: false };
      }
      return { base64DataUrl: '', is4Panel: false };
    }
  }
}

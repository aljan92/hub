import fs from 'fs';
import path from 'path';
import { DesignTaskLog } from '../../types/tasks';

export class AssetValidationService {
  /**
   * Validates whether a given file path is a valid, readable PNG (or JPG) image.
   * Checks existence, minimum file size, and header magic bytes.
   */
  public static isValidPngImage(filePath?: string, minSizeBytes = 10000): boolean {
    if (!filePath) return false;
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return false;

      const stats = fs.statSync(resolved);
      if (!stats.isFile() || stats.size < minSizeBytes) return false;

      // Read first 8 bytes to verify PNG or JPEG signature
      const fd = fs.openSync(resolved, 'r');
      const buffer = Buffer.alloc(8);
      fs.readSync(fd, buffer, 0, 8, 0);
      fs.closeSync(fd);

      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      // JPEG signature: FF D8 FF
      const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

      return isPng || isJpg;
    } catch {
      return false;
    }
  }

  /**
   * Validates whether a given file path contains a valid, well-formed SVG.
   */
  public static isValidSvgFile(filePath?: string, minSizeBytes = 20): boolean {
    if (!filePath) return false;
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return false;

      const stats = fs.statSync(resolved);
      if (!stats.isFile() || stats.size < minSizeBytes) return false;

      // Read start and end of file
      const content = fs.readFileSync(resolved, 'utf-8');
      const trimmed = content.trim();
      const hasOpeningTag = trimmed.includes('<svg') || trimmed.includes('<?xml');
      const hasClosingTag = trimmed.includes('</svg>');

      return hasOpeningTag && hasClosingTag;
    } catch {
      return false;
    }
  }

  /**
   * Validates if existing resized assets on a task are intact.
   * Checks legacy assets AND productVariants if present.
   */
  public static areResizeAssetsComplete(task: DesignTaskLog): boolean {
    if (!task.resizedAssets) return false;
    const { mugStandardPath, mugBrushPath, drinkwareStandardPath, drinkwareBrushPath, productVariants } = task.resizedAssets;

    // Validate legacy fixed-field assets
    const legacyPaths = [mugStandardPath, mugBrushPath, drinkwareStandardPath, drinkwareBrushPath];
    if (legacyPaths.some(p => !p)) return false;

    for (const p of legacyPaths) {
      if (!this.isValidPngImage(p, 1000)) {
        return false;
      }
    }

    // Validate productVariants if present
    if (productVariants && typeof productVariants === 'object') {
      for (const [key, variantPath] of Object.entries(productVariants)) {
        if (!this.isValidPngImage(variantPath, 1000)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validates a PNG file has the exact expected dimensions by reading the IHDR chunk.
   * Returns true if dimensions match exactly.
   */
  public static validateProductVariantDimensions(filePath: string, expectedWidth: number, expectedHeight: number): boolean {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return false;

      // PNG IHDR chunk: 8 bytes signature + 4 bytes length + 4 bytes 'IHDR' + 4 bytes width + 4 bytes height
      // Width is at offset 16, Height at offset 20 (both uint32 big-endian)
      const fd = fs.openSync(resolved, 'r');
      const buffer = Buffer.alloc(24);
      fs.readSync(fd, buffer, 0, 24, 0);
      fs.closeSync(fd);

      // Verify PNG signature
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      if (!isPng) return false;

      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);

      return width === expectedWidth && height === expectedHeight;
    } catch {
      return false;
    }
  }
}

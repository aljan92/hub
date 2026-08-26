import { loadSettings } from './settingsService';

export interface VectorizerCustomOptions {
  mode?: 'test' | 'production';
  maxColors?: number;
  minArea?: number;
  drawStyle?: 'fill_shapes' | 'stroke_shapes' | 'stroke_edges';
  shapeStacking?: 'cutouts' | 'stacked';
  groupBy?: 'color' | 'none';
  optimizedShapes?: boolean;
  gapFiller?: boolean;
  lineFitTolerance?: number;
  removeBackground?: boolean;
}

export class VectorizerService {
  /**
   * Test Vectorizer.ai API credentials and query account details
   */
  static async testConnection(customKey?: string, customSecret?: string): Promise<{ 
    success: boolean; 
    latencyMs: number; 
    error?: string; 
    creditsRemaining?: number;
    details?: string;
  }> {
    const settings = loadSettings();
    const key = customKey || settings.vectorizerApiKey;
    const secret = customSecret || settings.vectorizerApiSecret;

    if (!key || !secret) {
      return { success: false, latencyMs: 0, error: 'API Key (ID) oder API Secret fehlt' };
    }

    const start = Date.now();
    try {
      const auth = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
      
      const res = await fetch('https://vectorizer.ai/api/v1/account', {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
        signal: AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const credits = data?.credits?.remaining ?? data?.credits;
        return { 
          success: true, 
          latencyMs, 
          creditsRemaining: credits,
          details: credits !== undefined ? `Guthaben: ${credits} Credits` : 'Account verbunden' 
        };
      }

      if (res.status === 401) {
        return { 
          success: false, 
          latencyMs, 
          error: data?.error?.message || 'Ungültige Vectorizer.ai Zugangsdaten (401)' 
        };
      }

      return { success: false, latencyMs, error: data?.error?.message || `HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout' };
    }
  }

  /**
   * Helper to build FormData with complete MBA Manager parameters
   */
  private static buildFormData(
    imageField: { type: 'url'; value: string } | { type: 'buffer'; buffer: Buffer; filename?: string; mimeType?: string },
    isPreview: boolean = false,
    options?: VectorizerCustomOptions
  ): FormData {
    const settings = loadSettings();
    const formData = new FormData();

    // 1. Image data
    if (imageField.type === 'url') {
      formData.append('image.url', imageField.value);
    } else {
      const blob = new Blob([imageField.buffer], { type: imageField.mimeType || 'image/png' });
      formData.append('image', blob, imageField.filename || 'design.png');
    }

    // 2. Mode (Preview: test vs. Production: production)
    const mode = options?.mode ?? (isPreview 
      ? (settings.vectorizerModePreview || 'test') 
      : (settings.vectorizerModeProduction || 'production'));
    formData.append('mode', mode);

    // 3. Processing Parameters
    const maxColors = options?.maxColors ?? settings.vectorizerMaxColors ?? 2;
    formData.append('processing.max_colors', String(maxColors));

    const removeBg = options?.removeBackground ?? false;
    formData.append('processing.remove_background', String(removeBg));

    const minArea = options?.minArea ?? settings.vectorizerMinArea ?? 10;
    if (minArea > 0) {
      formData.append('processing.shapes.min_area_px', String(minArea));
    }

    // 4. Output SVG Specification
    formData.append('output.svg.version', 'svg_1_1');

    const drawStyle = options?.drawStyle ?? settings.vectorizerDrawStyle ?? 'fill_shapes';
    formData.append('output.draw_style', drawStyle);

    const shapeStacking = options?.shapeStacking ?? settings.vectorizerShapeStacking ?? 'cutouts';
    formData.append('output.shape_stacking', shapeStacking);

    const groupBy = options?.groupBy ?? settings.vectorizerGroupBy ?? 'none';
    formData.append('output.group_by', groupBy);

    // 5. Allowed Curve Types
    formData.append('output.curves.allowed.quadratic_bezier', 'true');
    formData.append('output.curves.allowed.cubic_bezier', 'true');
    formData.append('output.curves.allowed.circular_arc', 'true');
    formData.append('output.curves.allowed.elliptical_arc', 'true');

    // 6. Parameterized Shapes (Optimierte Formen)
    // If optimizedShapes is true -> flatten is false (retain geometric circles & rectangles)
    const optimized = options?.optimizedShapes ?? settings.vectorizerOptimizedShapes ?? true;
    formData.append('output.parameterized_shapes.flatten', String(!optimized));

    // 7. Gap Filler
    const gapFiller = options?.gapFiller ?? settings.vectorizerGapFiller ?? false;
    formData.append('output.gap_filler.enabled', String(gapFiller));
    if (gapFiller) {
      formData.append('output.gap_filler.clip_overflow', 'false');
      formData.append('output.gap_filler.non_scaling_stroke', 'true');
    }

    // 8. Line Fit Tolerance (Stroke-Modes only)
    if (drawStyle.includes('stroke')) {
      const lineFit = options?.lineFitTolerance ?? settings.vectorizerLineFitTolerance ?? 0.1;
      formData.append('output.curves.line_fit_tolerance', String(lineFit));
    }

    return formData;
  }

  /**
   * Vectorize an image URL to SVG
   */
  static async vectorizeImage(
    imageUrl: string, 
    isPreview: boolean = false, 
    options?: VectorizerCustomOptions
  ): Promise<string> {
    const settings = loadSettings();
    const key = settings.vectorizerApiKey;
    const secret = settings.vectorizerApiSecret;

    if (!key || !secret) {
      throw new Error('Vectorizer.ai Credentials fehlen in den Einstellungen.');
    }

    const auth = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
    const formData = this.buildFormData({ type: 'url', value: imageUrl }, isPreview, options);

    const res = await fetch('https://vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
      body: formData,
      signal: AbortSignal.timeout(90000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Vectorizer Fehler (${res.status}): ${errorText || 'Server Error'}`);
    }

    return await res.text();
  }

  /**
   * Vectorize an image Buffer to SVG
   */
  static async vectorizeBuffer(
    buffer: Buffer, 
    mimeType: string = 'image/png', 
    isPreview: boolean = false, 
    options?: VectorizerCustomOptions
  ): Promise<string> {
    const settings = loadSettings();
    const key = settings.vectorizerApiKey;
    const secret = settings.vectorizerApiSecret;

    if (!key || !secret) {
      throw new Error('Vectorizer.ai Credentials fehlen in den Einstellungen.');
    }

    const auth = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
    const formData = this.buildFormData({ type: 'buffer', buffer, mimeType }, isPreview, options);

    const res = await fetch('https://vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
      body: formData,
      signal: AbortSignal.timeout(90000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Vectorizer Fehler (${res.status}): ${errorText || 'Server Error'}`);
    }

    return await res.text();
  }
}

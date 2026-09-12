import { loadSettings } from './settingsService';

export interface IdeogramV4MagicPromptResult {
  json_prompt: any;
  aspect_ratio: string;
}

export interface IdeogramV4GenerateOptions {
  prompt: string;
  magicPromptEnabled?: boolean;
  magicPrompt?: boolean;
  transparent?: boolean;
  aspectRatio?: string;
  renderingSpeed?: 'DEFAULT' | 'TURBO';
  outputResolution?: 'DEFAULT' | '4K';
  enableCopyrightDetection?: boolean;
  customApiKey?: string;
  apiKey?: string;
}

export interface IdeogramV4GenerateResult {
  imageUrl: string;
  bytes: Buffer;
  promptUsed: string;
  resolution?: string;
  seed?: number;
  magicPromptUsed: boolean;
  magicPromptResult?: IdeogramV4MagicPromptResult;
  isTransparent: boolean;
}

export class IdeogramV4Service {
  static readonly MODEL = 'V_4';

  static readonly ALLOWED_V4_RESOLUTIONS = new Set([
    '2048x2048', '1440x2880', '2880x1440', '1664x2496', '2496x1664',
    '1792x2240', '2240x1792', '1440x2560', '2560x1440', '1600x2560',
    '2560x1600', '1728x2304', '2304x1728', '1296x3168', '3168x1296',
    '1152x2944', '2944x1152', '1248x3328', '3328x1248', '1280x3072',
    '3072x1280', '1024x3072', '3072x1024', '1024x1024', '896x1120',
    '1120x896', '864x1152', '1152x864', '832x1248', '1248x832',
    '800x1280', '1280x800', '720x1280', '1280x720', '720x1440',
    '1440x720', '512x1536', '1536x512'
  ]);

  /**
   * Map aspect ratio strings (e.g. '4x5', '10x16', '1x1') to valid Ideogram 4.0 resolution strings
   * required by the standard /generate endpoint.
   */
  static mapAspectRatioToResolution(ratio: string, outputResolution?: string): string {
    const clean = (ratio || '10x16').replace(':', 'x').trim();
    if (this.ALLOWED_V4_RESOLUTIONS.has(clean)) {
      return clean;
    }
    const is4K = outputResolution === '4K';
    switch (clean) {
      case '1x1':
        return is4K ? '2048x2048' : '1024x1024';
      case '4x5':
        return is4K ? '1792x2240' : '896x1120';
      case '5x4':
        return is4K ? '2240x1792' : '1120x896';
      case '10x16':
        return is4K ? '1600x2560' : '800x1280';
      case '16x10':
        return is4K ? '2560x1600' : '1280x800';
      case '9x16':
        return is4K ? '1440x2560' : '720x1280';
      case '16x9':
        return is4K ? '2560x1440' : '1280x720';
      case '3x4':
        return is4K ? '1728x2304' : '864x1152';
      case '4x3':
        return is4K ? '2304x1728' : '1152x864';
      case '2x3':
        return is4K ? '1664x2496' : '832x1248';
      case '3x2':
        return is4K ? '2496x1664' : '1248x832';
      case '1x2':
        return is4K ? '1440x2880' : '720x1440';
      case '2x1':
        return is4K ? '2880x1440' : '1440x720';
      case '1x3':
        return is4K ? '1024x3072' : '512x1536';
      case '3x1':
        return is4K ? '3072x1024' : '1536x512';
      case '1x4':
        return '512x1536';
      case '4x1':
        return '1536x512';
      default:
        return is4K ? '1600x2560' : '800x1280';
    }
  }
  /**
   * Resolve effective API key: specific V4 key if set, otherwise fallback to global Ideogram key.
   */
  static getApiKey(customKey?: string): string {
    const settings = loadSettings();
    const key = (customKey || settings.ideogramV4ApiKey || settings.ideogramApiKey || '').trim();
    if (!key) {
      throw new Error('Ideogram API Token fehlt in den Einstellungen (weder bei Ideogram 4.0 noch bei Ideogram 3.0 hinterlegt).');
    }
    return key;
  }

  /**
   * Test Ideogram API connection (0 credits consumed)
   */
  static async testConnection(customKey?: string): Promise<{
    success: boolean;
    latencyMs: number;
    error?: string;
    details?: string;
  }> {
    const start = Date.now();
    try {
      const key = this.getApiKey(customKey);
      const res = await fetch('https://api.ideogram.ai/models', {
        method: 'GET',
        headers: {
          'Api-Key': key,
        },
        signal: AbortSignal.timeout(15000)
      });

      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          success: true,
          latencyMs,
          details: 'Ideogram 4.0 API-Token verifiziert (0 Credits verbraucht) ✓'
        };
      }

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          latencyMs,
          error: data?.message || 'Ungültiger Ideogram API Key (401 Unauthorized).'
        };
      }

      return { success: false, latencyMs, error: `Ideogram API Status: HTTP ${res.status}` };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: err.message || 'Timeout bei der Verbindung zu Ideogram'
      };
    }
  }

  /**
   * Generate structured Magic Prompt with Ideogram 4.0
   * POST https://api.ideogram.ai/v1/ideogram-v4/magic-prompt
   */
  static async generateMagicPrompt(options: {
    textPrompt: string;
    aspectRatio?: string;
    apiKey?: string;
  }): Promise<IdeogramV4MagicPromptResult> {
    const key = options.apiKey || this.getApiKey();
    const cleanRatio = (options.aspectRatio || '10x16').replace(':', 'x');

    const res = await fetch('https://api.ideogram.ai/v1/ideogram-v4/magic-prompt', {
      method: 'POST',
      headers: {
        'Api-Key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text_prompt: options.textPrompt,
        aspect_ratio: cleanRatio === 'AUTO' ? 'AUTO' : cleanRatio
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ideogram V4 Magic Prompt Fehler (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const jsonPrompt = data?.json_prompt || data?.magic_prompts?.[0]?.json_prompt || data?.data?.[0]?.json_prompt;
    if (!jsonPrompt) {
      throw new Error('Ideogram V4 Magic Prompt lieferte kein gültiges json_prompt zurück.');
    }

    return {
      json_prompt: jsonPrompt,
      aspect_ratio: data.aspect_ratio || data?.magic_prompts?.[0]?.aspect_ratio || data?.data?.[0]?.aspect_ratio || cleanRatio
    };
  }

  /**
   * Synchronous Image Generation with Ideogram 4.0
   * Supports:
   * 1. Magic Prompt pre-pass (if enabled)
   * 2. Transparent Background endpoint (POST /generate-transparent) vs Standard (POST /generate)
   */
  static async generateImage(options: IdeogramV4GenerateOptions): Promise<IdeogramV4GenerateResult> {
    const settings = loadSettings();
    const key = this.getApiKey(options.customApiKey || options.apiKey);

    const magicPromptEnabled = typeof options.magicPromptEnabled === 'boolean'
      ? options.magicPromptEnabled
      : typeof options.magicPrompt === 'boolean'
      ? options.magicPrompt
      : (settings.ideogramV4MagicPrompt ?? true);

    const transparent = typeof options.transparent === 'boolean'
      ? options.transparent
      : (settings.ideogramV4Transparent ?? true);

    const cleanRatio = (options.aspectRatio || settings.ideogramV4AspectRatio || '10x16').replace(':', 'x');
    const renderingSpeed = options.renderingSpeed || settings.ideogramV4RenderingSpeed || 'DEFAULT';
    const outputResolution = options.outputResolution || settings.ideogramV4OutputResolution || 'DEFAULT';

    let magicResult: IdeogramV4MagicPromptResult | undefined;
    let effectiveRatio = cleanRatio;

    // Step 1: Optional Magic Prompt expansion
    if (magicPromptEnabled) {
      magicResult = await this.generateMagicPrompt({
        textPrompt: options.prompt,
        aspectRatio: cleanRatio,
        apiKey: key
      });
      if (magicResult.aspect_ratio && magicResult.aspect_ratio !== 'AUTO') {
        effectiveRatio = magicResult.aspect_ratio;
      }
    }

    // Step 2: Build multipart/form-data payload
    const formData = new FormData();

    if (magicResult?.json_prompt) {
      formData.append('json_prompt', JSON.stringify(magicResult.json_prompt));
    } else {
      formData.append('text_prompt', options.prompt);
    }

    formData.append('rendering_speed', renderingSpeed);

    if (options.enableCopyrightDetection) {
      formData.append('enable_copyright_detection', 'true');
    }

    // Step 3: Select endpoint based on transparency preference
    const endpoint = transparent
      ? 'https://api.ideogram.ai/v1/ideogram-v4/generate-transparent'
      : 'https://api.ideogram.ai/v1/ideogram-v4/generate';

    if (transparent) {
      formData.append('aspect_ratio', effectiveRatio);
      if (outputResolution && outputResolution !== 'DEFAULT') {
        formData.append('output_resolution', outputResolution);
      }
    } else {
      // In standard generate endpoint, resolution must be from the allowed resolution enum
      const validResolution = this.mapAspectRatioToResolution(effectiveRatio, outputResolution);
      formData.append('resolution', validResolution);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Api-Key': key
      },
      body: formData,
      signal: AbortSignal.timeout(180000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ideogram V4 Generate Fehler (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const imgObj = data?.data?.[0];
    const imageUrl = imgObj?.url;

    if (!imageUrl) {
      throw new Error('Ideogram V4 lieferte keine Bild-URL zurück.');
    }

    // Download generated image bytes directly
    const imgFetch = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
    if (!imgFetch.ok) {
      throw new Error(`Konnte generiertes Ideogram V4 Bild nicht herunterladen (HTTP ${imgFetch.status}).`);
    }

    const bytes = Buffer.from(await imgFetch.arrayBuffer());

    return {
      imageUrl,
      bytes,
      promptUsed: imgObj?.prompt || options.prompt,
      resolution: imgObj?.resolution,
      seed: imgObj?.seed,
      magicPromptUsed: Boolean(magicResult),
      magicPromptResult: magicResult,
      isTransparent: Boolean(transparent)
    };
  }
}

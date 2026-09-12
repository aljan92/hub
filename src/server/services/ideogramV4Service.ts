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

    const magicPromptEnabled = options.magicPromptEnabled !== undefined
      ? options.magicPromptEnabled
      : options.magicPrompt !== undefined
      ? options.magicPrompt
      : settings.ideogramV4MagicPrompt;

    const transparent = options.transparent !== undefined
      ? options.transparent
      : settings.ideogramV4Transparent;

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
      // In standard generate endpoint, resolution can be supplied or left to preset
      if (effectiveRatio && effectiveRatio !== 'AUTO') {
        formData.append('resolution', effectiveRatio);
      }
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

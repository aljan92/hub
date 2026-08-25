import { loadSettings } from './settingsService';

export interface IdeogramGenerateOptions {
  prompt: string;
  aspectRatio?: string;
  renderingSpeed?: string;
  styleType?: string;
  magicPromptOption?: string;
  model?: string;
  transparentBackground?: boolean;
}

export interface IdeogramModelItem {
  id: string;
  name: string;
  isCustom?: boolean;
}

export class IdeogramService {
  /**
   * Test Ideogram API connection (0 credits consumed)
   */
  static async testConnection(customKey?: string): Promise<{ 
    success: boolean; 
    latencyMs: number; 
    error?: string;
    details?: string;
  }> {
    const settings = loadSettings();
    const rawKey = customKey || settings.ideogramApiKey;
    if (!rawKey || !rawKey.trim()) {
      return { success: false, latencyMs: 0, error: 'Kein Ideogram API Key hinterlegt' };
    }

    const key = rawKey.trim();
    const start = Date.now();
    try {
      // Test GET /models with Api-Key header
      const res = await fetch('https://api.ideogram.ai/models', {
        method: 'GET',
        headers: {
          'Api-Key': key,
        },
        signal: AbortSignal.timeout(15000)
      });

      const latencyMs = Date.now() - start;

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const customModels = Array.isArray(data?.models) ? data.models : [];
        const customMsg = customModels.length > 0 ? ` (${customModels.length} Custom Models verfügbar)` : '';

        return {
          success: true,
          latencyMs,
          details: `Ideogram Verbindung erfolgreich! (Modelle V4, V3, V2 bereit${customMsg}) ✓`
        };
      }

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          latencyMs,
          error: data?.message || 'Ungültiger Ideogram API Key (401 Unauthorized). Bitte Key prüfen unter https://ideogram.ai/manage-api',
        };
      }

      return { success: false, latencyMs, error: `Ideogram API Status: HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout bei der Verbindung zu Ideogram' };
    }
  }

  /**
   * Get all standard and custom Ideogram models (V4, V3, V2 Turbo, V2)
   */
  static async getAvailableModels(): Promise<IdeogramModelItem[]> {
    const standardModels: IdeogramModelItem[] = [
      { id: 'V_3', name: 'Ideogram 3.0 (T-Shirt & Vektor Spezialist)' },
      { id: 'V_4', name: 'Ideogram 4.0 (Neueste Generation & Transparent)' },
      { id: 'V_2_TURBO', name: 'Ideogram 2.0 Turbo (Schnell & Günstig)' },
      { id: 'V_2', name: 'Ideogram 2.0 (High Quality)' },
    ];

    const settings = loadSettings();
    if (!settings.ideogramApiKey) return standardModels;

    try {
      const res = await fetch('https://api.ideogram.ai/models', {
        headers: { 'Api-Key': settings.ideogramApiKey.trim() },
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.models)) {
          const custom = data.models
            .filter((m: any) => m.is_available_for_generation !== false)
            .map((m: any) => ({
              id: m.model_id || m.name,
              name: `Custom: ${m.name || m.model_id}`,
              isCustom: true,
            }));
          return [...standardModels, ...custom];
        }
      }
    } catch (e) {
      // return standard
    }

    return standardModels;
  }

  /**
   * Generate Image via Ideogram API (supports V3, V4, V2)
   */
  static async generateImage(options: IdeogramGenerateOptions): Promise<{ imageUrl: string; prompt: string }> {
    const settings = loadSettings();
    const key = settings.ideogramApiKey;
    if (!key) {
      throw new Error('Ideogram API Key fehlt in den Einstellungen.');
    }

    const renderingSpeed = options.renderingSpeed || settings.ideogramRenderingSpeed || 'DEFAULT';
    const styleType = options.styleType || settings.ideogramStyle || 'GENERAL';
    const magicPromptOption = options.magicPromptOption || settings.ideogramMagicPromptOption || 'AUTO';
    const selectedModel = options.model || settings.ideogramModel || 'V_3';
    const cleanRatio = (options.aspectRatio || settings.ideogramAspectRatio || '10x16').replace(':', 'x');

    // 1. Ideogram V3 Endpoint (Official)
    if (selectedModel === 'V_3' || selectedModel === 'V_3_TURBO' || selectedModel.startsWith('V_3')) {
      const formData = new FormData();
      formData.append('prompt', options.prompt);
      formData.append('rendering_speed', renderingSpeed);
      formData.append('style_type', styleType);
      formData.append('aspect_ratio', cleanRatio);
      formData.append('magic_prompt', magicPromptOption);
      formData.append('num_images', '1');

      const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
        method: 'POST',
        headers: {
          'Api-Key': key.trim(),
        },
        body: formData,
        signal: AbortSignal.timeout(180000)
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Ideogram V3 API Fehler: ${res.status} - ${errBody}`);
      }

      const data = await res.json();
      const imageUrl = data?.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Ideogram V3 lieferte keine Bild-URL zurück.');
      }

      return {
        imageUrl,
        prompt: data?.data?.[0]?.prompt || options.prompt,
      };
    }

    // 2. Ideogram V4 Endpoint (Official)
    if (selectedModel === 'V_4' || selectedModel.startsWith('V_4')) {
      const formData = new FormData();
      formData.append('text_prompt', options.prompt);
      formData.append('rendering_speed', renderingSpeed);
      formData.append('aspect_ratio', cleanRatio);

      const res = await fetch('https://api.ideogram.ai/v1/ideogram-v4/generate', {
        method: 'POST',
        headers: {
          'Api-Key': key.trim(),
        },
        body: formData,
        signal: AbortSignal.timeout(180000)
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Ideogram V4 API Fehler: ${res.status} - ${errBody}`);
      }

      const data = await res.json();
      const imageUrl = data?.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Ideogram V4 lieferte keine Bild-URL zurück.');
      }

      return {
        imageUrl,
        prompt: data?.data?.[0]?.prompt || options.prompt,
      };
    }

    // 3. Legacy Endpoint for V2 / V1
    const aspectMap: Record<string, string> = {
      '10x16': 'ASPECT_10_16',
      '16x10': 'ASPECT_16_10',
      '9x16': 'ASPECT_9_16',
      '16x9': 'ASPECT_16_9',
      '3x2': 'ASPECT_3_2',
      '2x3': 'ASPECT_2_3',
      '4x3': 'ASPECT_4_3',
      '3x4': 'ASPECT_3_4',
      '1x1': 'ASPECT_1_1',
      '1x3': 'ASPECT_1_3',
      '3x1': 'ASPECT_3_1',
    };
    const mappedRatio = aspectMap[cleanRatio] || 'ASPECT_10_16';

    const payload = {
      image_request: {
        prompt: options.prompt,
        aspect_ratio: mappedRatio,
        model: selectedModel,
        rendering_speed: renderingSpeed,
        style_type: styleType,
        magic_prompt_option: magicPromptOption,
      }
    };

    const res = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': key.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Ideogram API Fehler: ${res.status} - ${errBody}`);
    }

    const data = await res.json();
    const imageUrl = data?.data?.[0]?.url;

    if (!imageUrl) {
      throw new Error('Ideogram lieferte keine Bild-URL zurück.');
    }

    return {
      imageUrl,
      prompt: data?.data?.[0]?.prompt || options.prompt,
    };
  }
}

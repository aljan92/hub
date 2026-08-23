import { loadSettings } from './settingsService';

export interface IdeogramGenerateOptions {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  magicPromptOption?: 'AUTO' | 'ON' | 'OFF';
  styleType?: string;
}

export interface IdeogramModelItem {
  id: string;
  name: string;
  isCustom?: boolean;
}

export class IdeogramService {
  /**
   * Test Ideogram API connection via GET /models (0 credits consumed)
   */
  static async testConnection(customKey?: string): Promise<{ 
    success: boolean; 
    latencyMs: number; 
    error?: string;
    details?: string;
    customModelsCount?: number;
  }> {
    const settings = loadSettings();
    const rawKey = customKey || settings.ideogramApiKey;
    if (!rawKey || !rawKey.trim()) {
      return { success: false, latencyMs: 0, error: 'Kein Ideogram API Key hinterlegt' };
    }

    const key = rawKey.trim();
    const start = Date.now();
    try {
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
        const details = customModels.length > 0
          ? `Ideogram API Token gültig ✓ (${customModels.length} Custom Models verfügbar)`
          : 'Ideogram API Token gültig ✓ (Standard-Modelle bereit)';

        return {
          success: true,
          latencyMs,
          details,
          customModelsCount: customModels.length
        };
      }

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          latencyMs,
          error: data?.message || 'Ungültiger Ideogram API Key (401 Unauthorized)',
        };
      }

      return { success: false, latencyMs, error: `Ideogram API Status: HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout bei der Verbindung zu Ideogram' };
    }
  }

  /**
   * Get all standard and custom Ideogram models
   */
  static async getAvailableModels(): Promise<IdeogramModelItem[]> {
    const standardModels: IdeogramModelItem[] = [
      { id: 'V_2_TURBO', name: 'Ideogram 2.0 Turbo (Schnell, hohe Qualität)' },
      { id: 'V_2', name: 'Ideogram 2.0 (High Quality)' },
      { id: 'V_1', name: 'Ideogram 1.0 (Klassisch)' },
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
      // return standard on error
    }

    return standardModels;
  }

  /**
   * Generate Image via Ideogram API
   */
  static async generateImage(options: IdeogramGenerateOptions): Promise<{ imageUrl: string; prompt: string }> {
    const settings = loadSettings();
    const key = settings.ideogramApiKey;
    if (!key) {
      throw new Error('Ideogram API Key fehlt in den Einstellungen.');
    }

    const aspectMap: Record<string, string> = {
      '1:1': 'ASPECT_1_1',
      '3:4': 'ASPECT_3_4',
      '4:3': 'ASPECT_4_3',
      '16:9': 'ASPECT_16_9',
      '9:16': 'ASPECT_9_16',
    };

    const payload = {
      image_request: {
        prompt: options.prompt,
        aspect_ratio: aspectMap[options.aspectRatio || '1:1'] || 'ASPECT_1_1',
        model: options.model || settings.ideogramModel || 'V_2_TURBO',
        magic_prompt_option: options.magicPromptOption || 'AUTO',
      }
    };

    const res = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': key.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Ideogram API Fehler: ${res.status} - ${errBody}`);
    }

    const data = await res.json();
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('Keine Bild-URL von Ideogram erhalten.');
    }

    return {
      imageUrl,
      prompt: options.prompt
    };
  }
}

import { loadSettings } from './settingsService';

export interface IdeogramGenerateOptions {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  magicPromptOption?: 'AUTO' | 'ON' | 'OFF';
  styleType?: string;
}

export class IdeogramService {
  /**
   * Test Ideogram API connection
   */
  static async testConnection(customKey?: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const settings = loadSettings();
    const key = customKey || settings.ideogramApiKey;
    if (!key) {
      return { success: false, latencyMs: 0, error: 'Kein Ideogram API Key hinterlegt' };
    }

    const start = Date.now();
    try {
      // Test GET /user/manage or simple ping
      const res = await fetch('https://api.ideogram.ai/manage/user', {
        headers: { 'Api-Key': key },
        signal: AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs };
      }
      return { success: false, latencyMs, error: `Ideogram API HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout' };
    }
  }

  /**
   * Generate Image via Ideogram 3.0 API
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
        'Api-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
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

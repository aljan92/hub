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
   * Test Ideogram API connection without spending generation credits
   */
  static async testConnection(customKey?: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const settings = loadSettings();
    const key = customKey || settings.ideogramApiKey;
    if (!key) {
      return { success: false, latencyMs: 0, error: 'Kein Ideogram API Key hinterlegt' };
    }

    const start = Date.now();
    try {
      // Sending an empty prompt payload to test authentication without spending credits
      const res = await fetch('https://api.ideogram.ai/generate', {
        method: 'POST',
        headers: {
          'Api-Key': key.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_request: {
            prompt: ''
          }
        }),
        signal: AbortSignal.timeout(25000)
      });

      const latencyMs = Date.now() - start;
      
      // 401 means invalid key
      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        return { success: false, latencyMs, error: data?.message || 'Ungültiger Ideogram API Token (Access Denied)' };
      }

      // 400 with prompt validation error proves auth is 100% valid
      if (res.status === 400 || res.ok) {
        return { success: true, latencyMs };
      }

      return { success: false, latencyMs, error: `Ideogram API Status: HTTP ${res.status}` };
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted');
      return { 
        success: false, 
        latencyMs: Date.now() - start, 
        error: isTimeout 
          ? 'Ideogram Timeout (25s): Verbindung zum Ideogram Server konnte nicht rechtzeitig aufgebaut werden.'
          : (err.message || 'Verbindungsfehler')
      };
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

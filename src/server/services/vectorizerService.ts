import { loadSettings } from './settingsService';

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
   * Vectorize an image URL or Buffer to SVG
   */
  static async vectorizeImage(imageUrl: string): Promise<string> {
    const settings = loadSettings();
    const key = settings.vectorizerApiKey;
    const secret = settings.vectorizerApiSecret;

    if (!key || !secret) {
      throw new Error('Vectorizer.ai Credentials fehlen in den Einstellungen.');
    }

    const auth = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
    const formData = new FormData();
    formData.append('image.url', imageUrl);
    formData.append('mode', 'production');

    const res = await fetch('https://vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
      body: formData,
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      throw new Error(`Vectorizer Fehler: HTTP ${res.status}`);
    }

    return await res.text();
  }
}

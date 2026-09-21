import { loadSettings } from './settingsService';

export interface OpenRouterImageOptions {
  model?: string;
  prompt: string;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  aspectRatio: string;
  background: 'auto' | 'opaque' | 'transparent';
}

export interface OpenRouterImageResult {
  bytes: Buffer;
  mediaType: string;
}

export class OpenRouterImageService {
  static readonly MODEL_V2 = 'openai/gpt-image-2';
  static readonly MODEL_V25 = 'openai/gpt-image-2.5-sunburst';
  static readonly MODEL = 'openai/gpt-image-2';
  static readonly TIMEOUT_MS = 180000;

  static buildRequestBody(options: OpenRouterImageOptions): Record<string, unknown> {
    const model = options.model || this.MODEL;
    // GPT Image 2.5 Sunburst supports native transparent background over OpenRouter.
    // GPT Image 2.0 rejects transparent on OpenRouter, requiring opaque transport with Chroma-Key.
    const transportBackground = (model === this.MODEL_V25)
      ? options.background
      : (options.background === 'transparent' ? 'opaque' : options.background);

    const requestBody: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      quality: options.quality,
      aspect_ratio: options.aspectRatio,
      background: transportBackground,
      n: 1,
      stream: false
    };
    return requestBody;
  }

  static async generateImage(options: OpenRouterImageOptions): Promise<OpenRouterImageResult> {
    const apiKey = (loadSettings().openRouterApiKey || '').trim();
    if (!apiKey) throw new Error('OpenRouter API Key fehlt in den Einstellungen.');

    const requestBody = this.buildRequestBody(options);
    const modelName = requestBody.model === this.MODEL_V25 ? 'GPT Image 2.5 Sunburst' : 'GPT Image 2';

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/images', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://mba-hub.local',
            'X-Title': 'MBA HUB'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.TIMEOUT_MS)
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = json?.error?.message || response.statusText || 'Unbekannter API-Fehler';
          const error = new Error(`${modelName} über OpenRouter: HTTP ${response.status} – ${detail}.`);
          (error as any).status = response.status;
          if (response.status === 429 && attempt < 3) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            continue;
          }
          throw error;
        }

        const encoded = json?.data?.[0]?.b64_json;
        const mediaType = String(json?.data?.[0]?.media_type || 'image/png').toLowerCase();
        if (!encoded || typeof encoded !== 'string') {
          throw new Error(`${modelName} lieferte keine Bilddaten zurück.`);
        }
        if (mediaType !== 'image/png') {
          throw new Error(`${modelName} lieferte den nicht unterstützten Medientyp ${mediaType}; erwartet wurde image/png.`);
        }

        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length === 0) throw new Error(`${modelName} lieferte leere Bilddaten zurück.`);
        return { bytes, mediaType };
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error?.status !== 429 || attempt === 3) throw lastError;
      }
    }

    throw lastError || new Error(`${modelName} konnte nicht ausgeführt werden.`);
  }
}

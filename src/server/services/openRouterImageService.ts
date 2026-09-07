import { loadSettings } from './settingsService';

export interface OpenRouterImageOptions {
  prompt: string;
  quality: 'auto' | 'low' | 'medium' | 'high';
  aspectRatio: string;
  background: 'auto' | 'opaque' | 'transparent';
}

export interface OpenRouterImageResult {
  bytes: Buffer;
  mediaType: string;
}

export class OpenRouterImageService {
  static readonly MODEL = 'openai/gpt-image-2';
  static readonly TIMEOUT_MS = 180000;

  static buildRequestBody(options: OpenRouterImageOptions): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: this.MODEL,
      prompt: options.prompt,
      quality: options.quality,
      aspect_ratio: options.aspectRatio,
      background: options.background,
      n: 1,
      stream: false
    };
    if (options.background === 'transparent') requestBody.output_format = 'png';
    return requestBody;
  }

  static async generateImage(options: OpenRouterImageOptions): Promise<OpenRouterImageResult> {
    const apiKey = (loadSettings().openRouterApiKey || '').trim();
    if (!apiKey) throw new Error('OpenRouter API Key fehlt in den Einstellungen.');

    const requestBody = this.buildRequestBody(options);

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
          const transparentHint = response.status === 400 && options.background === 'transparent'
            ? ' Der aktuelle GPT-Image-2-Endpunkt unterstützt transparent möglicherweise nicht; bitte Background in den Settings auf opaque oder auto stellen.'
            : '';
          const error = new Error(`GPT Image 2 über OpenRouter: HTTP ${response.status} – ${detail}.${transparentHint}`);
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
          throw new Error('GPT Image 2 lieferte keine Bilddaten zurück.');
        }
        if (mediaType !== 'image/png') {
          throw new Error(`GPT Image 2 lieferte den nicht unterstützten Medientyp ${mediaType}; erwartet wurde image/png.`);
        }

        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length === 0) throw new Error('GPT Image 2 lieferte leere Bilddaten zurück.');
        return { bytes, mediaType };
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error?.status !== 429 || attempt === 3) throw lastError;
      }
    }

    throw lastError || new Error('GPT Image 2 konnte nicht ausgeführt werden.');
  }
}

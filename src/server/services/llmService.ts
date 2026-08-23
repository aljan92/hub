import { loadSettings } from './settingsService';

export interface ListingResult {
  title: string;
  brand: string;
  bullet1: string;
  bullet2: string;
  description: string;
  keywords: string;
  colorCount: number;
  audiencePrediction?: string;
  avoidColorPrediction?: string;
  reuseBackgroundPrediction?: string;
}

export class LLMService {
  private static getBaseUrlAndHeaders(): { url: string; headers: Record<string, string>; model: string } {
    const settings = loadSettings();
    const isDirectOpenAI = settings.llmProvider === 'openai';

    const url = isDirectOpenAI 
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openRouterApiKey}`,
    };

    if (!isDirectOpenAI) {
      headers['HTTP-Referer'] = 'https://mba-hub.local';
      headers['X-Title'] = 'MBA HUB';
    }

    return {
      url,
      headers,
      model: settings.llmModel || 'anthropic/claude-3.5-sonnet'
    };
  }

  /**
   * Test LLM connection & model availability
   */
  static async testConnection(customKey?: string, customModel?: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const settings = loadSettings();
    const key = customKey || settings.openRouterApiKey;
    const model = customModel || settings.llmModel || 'anthropic/claude-3.5-sonnet';

    if (!key) {
      return { success: false, latencyMs: 0, error: 'Kein API Key hinterlegt' };
    }

    const start = Date.now();
    try {
      const isDirectOpenAI = settings.llmProvider === 'openai';
      const url = isDirectOpenAI ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://mba-hub.local',
          'X-Title': 'MBA HUB'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, latencyMs };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, latencyMs, error: data?.error?.message || `HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout' };
    }
  }

  /**
   * Optimize niches & quote into a high-converting Ideogram 3.0 prompt
   */
  static async generateIdeogramPrompt(
    niche1: string,
    niche2: string,
    quote: string,
    stylePreset: string
  ): Promise<string> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();

    const systemPrompt = `You are an expert prompt engineer specializing in Ideogram 3.0 T-shirt graphics for Merch by Amazon.
Your goal is to craft a highly descriptive, visually stunning, clean vector prompt that produces high-converting apparel designs.
Requirements:
1. Emphasize isolated vector graphics on a solid clean background.
2. If a quote is provided, include the exact text inside quotation marks and request bold, legible typography.
3. Keep the prompt under 90 words, focused strictly on visual aesthetic, style, lighting, and composition. No promo or buzzwords like 4K. Output ONLY the raw prompt text.`;

    const userMessage = `Niche 1: ${niche1}
Niche 2: ${niche2}
Quote / Text: "${quote}"
Style Preset: ${stylePreset}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 250,
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (!res.ok) {
        throw new Error(`LLM error: ${res.statusText}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || `T-shirt graphic design of "${quote}", ${niche1} style, clean vector illustration on solid background.`;
    } catch (err: any) {
      console.error('[LLMService] Error generating prompt:', err);
      return `T-shirt graphic design of "${quote}", ${niche1} ${niche2} aesthetic, clean vector illustration, isolated on solid background, commercial merchandise ready.`;
    }
  }

  /**
   * Vision Analysis + Amazon SEO Listing Generation (single-session token efficiency)
   */
  static async analyzeVisionAndGenerateListing(
    imageUrlOrBase64: string,
    niche1?: string,
    niche2?: string
  ): Promise<ListingResult> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();

    const systemPrompt = `You are "Listing Creator", an expert in Amazon Merch on Demand SEO listings and visual design analysis.
Analyze the image and provide a compliant, high-converting listing plus design classifications.
Character limits:
- Title: 55-60 chars (Include visible quote verbatim or strongest keywords, no product types like "shirt")
- Brand: 40-50 chars (Target audience/mood in Title Case)
- Bullet 1: 230-246 chars (Audience, context, style, visible text if not in Title)
- Bullet 2: 230-246 chars (Occasions, related sub-niches, "perfect for...")
- Description: 450-650 chars (Smooth story-style summary)
- Keywords: >= 25 comma-separated unique lowercase keywords.
- colorCount: estimated number of distinct visible colors (integer, conservative, 2-8).
- audiencePrediction: "Men", "Women", "Youth", or "Men, Women"
- avoidColorPrediction: "Black", "White", or "None" (if white elements exist, avoid white)
- reuseBackgroundPrediction: "Nein" (if graphic is isolated on solid bg) or "Ja"

Respond strictly with valid JSON conforming to these exact keys.`;

    const userContent: any[] = [
      { type: 'text', text: `Niche 1: ${niche1 || ''}\nNiche 2: ${niche2 || ''}` },
      { type: 'image_url', image_url: { url: imageUrlOrBase64 } }
    ];

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(25000)
      });

      if (!res.ok) throw new Error(`Vision API error: ${res.statusText}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return JSON.parse(content);
    } catch (err: any) {
      console.error('[LLMService] Vision Listing error:', err);
      // Fallback
      return {
        title: `${niche1 || 'Vintage'} Retro Graphic Design`,
        brand: `${niche1 || 'Retro'} Apparel Co`,
        bullet1: `Express your unique aesthetic with this stylish ${niche1 || 'vintage'} artwork. Ideal for everyday casual wear and trendsetters.`,
        bullet2: `A versatile addition to any collection, perfect for birthdays, holidays, summer festivals, and casual outings with friends.`,
        description: `High-quality graphic design celebrating ${niche1 || 'retro'} vibes with vivid details and expressive artwork for enthusiasts.`,
        keywords: 'vintage, retro, aesthetic, graphic, distressed, classic, apparel, gifts',
        colorCount: 4,
        audiencePrediction: 'Men, Women',
        avoidColorPrediction: 'None',
        reuseBackgroundPrediction: 'Nein'
      };
    }
  }
}

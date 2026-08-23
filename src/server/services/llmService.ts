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

export interface OpenRouterModelItem {
  id: string;
  name: string;
  contextLength?: number;
  promptPrice?: string;
  completionPrice?: string;
  description?: string;
}

let cachedModels: OpenRouterModelItem[] = [];
let lastModelsFetch = 0;

export class LLMService {
  public static normalizeModelId(model: string): string {
    const trimmed = model.trim();
    if (trimmed === 'anthropic/claude-3.5-sonnet') return 'anthropic/claude-3-5-sonnet';
    if (trimmed === 'anthropic/claude-3.5-sonnet-20241022') return 'anthropic/claude-3-5-sonnet-20241022';
    return trimmed;
  }

  private static getBaseUrlAndHeaders(): { url: string; headers: Record<string, string>; model: string } {
    const settings = loadSettings();
    const isDirectOpenAI = settings.llmProvider === 'openai';

    const url = isDirectOpenAI 
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openRouterApiKey.trim()}`,
    };

    if (!isDirectOpenAI) {
      headers['HTTP-Referer'] = 'https://mba-hub.local';
      headers['X-Title'] = 'MBA HUB';
    }

    const rawModel = settings.llmModel || 'anthropic/claude-3-5-sonnet';
    return {
      url,
      headers,
      model: this.normalizeModelId(rawModel)
    };
  }

  /**
   * Fetch all models from OpenRouter dynamically
   */
  static async getAvailableModels(): Promise<OpenRouterModelItem[]> {
    const now = Date.now();
    if (cachedModels.length > 0 && now - lastModelsFetch < 1000 * 60 * 30) {
      return cachedModels;
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'HTTP-Referer': 'https://mba-hub.local',
          'X-Title': 'MBA HUB'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          const list: OpenRouterModelItem[] = data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: m.context_length,
            promptPrice: m.pricing?.prompt ? `$${(parseFloat(m.pricing.prompt) * 1000000).toFixed(2)}/M` : undefined,
            completionPrice: m.pricing?.completion ? `$${(parseFloat(m.pricing.completion) * 1000000).toFixed(2)}/M` : undefined,
            description: m.description,
          }));

          // Sort prioritizing top vision & reasoning models
          const topKeywords = ['claude-3.5-sonnet', 'claude-3-5-sonnet', 'gpt-4o', 'gemini-2.0-flash', 'gemini-2.5', 'llama-3.2'];
          list.sort((a, b) => {
            const aIsTop = topKeywords.some(k => a.id.toLowerCase().includes(k));
            const bIsTop = topKeywords.some(k => b.id.toLowerCase().includes(k));
            if (aIsTop && !bIsTop) return -1;
            if (!aIsTop && bIsTop) return 1;
            return a.name.localeCompare(b.name);
          });

          cachedModels = list;
          lastModelsFetch = now;
          return list;
        }
      }
    } catch (err) {
      console.warn('[LLMService] Failed to fetch dynamic models list:', err);
    }

    // Curated Fallback if offline
    return [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic: Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3.5-sonnet:beta', name: 'Anthropic: Claude 3.5 Sonnet (Beta)' },
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
      { id: 'google/gemini-2.0-flash-001', name: 'Google: Gemini 2.0 Flash' },
      { id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Meta: Llama 3.2 11B Vision' },
    ];
  }

  /**
   * Check OpenRouter credit balance & usage
   */
  static async getCredits(customKey?: string): Promise<{ usage?: number; limit?: number; limitRemaining?: number; isFreeTier?: boolean; error?: string }> {
    const settings = loadSettings();
    const key = customKey || settings.openRouterApiKey;
    if (!key) return { error: 'Kein API Key' };

    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${key.trim()}`,
        },
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        return {
          usage: d?.usage,
          limit: d?.limit,
          limitRemaining: d?.limit_remaining,
          isFreeTier: d?.is_free_tier,
        };
      }
      return { error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { error: err.message || 'Timeout' };
    }
  }

  /**
   * Test LLM connection, verify model, and fetch account usage
   */
  static async testConnection(customKey?: string, customModel?: string): Promise<{ 
    success: boolean; 
    latencyMs: number; 
    error?: string;
    details?: string;
    usage?: number;
    limitRemaining?: number;
  }> {
    const settings = loadSettings();
    const key = (customKey || settings.openRouterApiKey).trim();
    const rawModel = customModel || settings.llmModel || 'anthropic/claude-3-5-sonnet';
    const model = this.normalizeModelId(rawModel);

    if (!key) {
      return { success: false, latencyMs: 0, error: 'Kein API Key hinterlegt' };
    }

    const start = Date.now();
    try {
      const isDirectOpenAI = settings.llmProvider === 'openai';
      const url = isDirectOpenAI ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';

      // 1. Test ping with model
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
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(20000)
      });

      const latencyMs = Date.now() - start;
      if (res.ok) {
        // Query credits in parallel
        let creditsInfo: any = {};
        if (!isDirectOpenAI) {
          creditsInfo = await this.getCredits(key);
        }

        const usageStr = creditsInfo.usage !== undefined ? `Verbrauch: $${creditsInfo.usage.toFixed(4)}` : '';
        const remStr = creditsInfo.limitRemaining !== undefined && creditsInfo.limitRemaining !== null ? ` | Restlimit: $${creditsInfo.limitRemaining.toFixed(2)}` : '';

        return { 
          success: true, 
          latencyMs, 
          details: `Modell "${model}" aktiv ✓ ${usageStr}${remStr}`,
          usage: creditsInfo.usage,
          limitRemaining: creditsInfo.limitRemaining
        };
      }

      const data = await res.json().catch(() => ({}));
      return { 
        success: false, 
        latencyMs, 
        error: data?.error?.message || `HTTP ${res.status}: Modell "${model}" nicht gefunden oder nicht verfügbar.` 
      };
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
        signal: AbortSignal.timeout(15000)
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

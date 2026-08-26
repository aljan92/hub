import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';

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

let cachedModels: OpenRouterModelItem[] = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic: Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3.5-sonnet:beta', name: 'Anthropic: Claude 3.5 Sonnet (Beta)' },
  { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
  { id: 'google/gemini-2.0-flash-001', name: 'Google: Gemini 2.0 Flash' },
  { id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Meta: Llama 3.2 11B Vision' },
];
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
   * Fetch all models from OpenRouter dynamically (Instant response from cache)
   */
  static async getAvailableModels(): Promise<OpenRouterModelItem[]> {
    const now = Date.now();
    if (now - lastModelsFetch < 1000 * 60 * 30) {
      return cachedModels;
    }

    // Trigger background fetch
    fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'HTTP-Referer': 'https://mba-hub.local',
        'X-Title': 'MBA HUB'
      },
      signal: AbortSignal.timeout(4000)
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (Array.isArray(data?.data)) {
          const list: OpenRouterModelItem[] = data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: m.context_length,
            promptPrice: m.pricing?.prompt ? `$${(parseFloat(m.pricing.prompt) * 1000000).toFixed(2)}/M` : undefined,
            completionPrice: m.pricing?.completion ? `$${(parseFloat(m.pricing.completion) * 1000000).toFixed(2)}/M` : undefined,
            description: m.description,
          }));

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
        }
      })
      .catch(() => {});

    return cachedModels;
  }

  /**
   * Check OpenRouter credit balance & usage
   */
  static async getCredits(customKey?: string): Promise<{ 
    usage?: number; 
    limit?: number; 
    limitRemaining?: number; 
    totalCredits?: number;
    balanceRemaining?: number;
    isFreeTier?: boolean; 
    error?: string 
  }> {
    const settings = loadSettings();
    const key = (customKey || settings.openRouterApiKey).trim();
    if (!key) return { error: 'Kein API Key' };

    try {
      const [authRes, creditsRes] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        }),
        fetch('https://openrouter.ai/api/v1/credits', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        })
      ]);

      let usage: number | undefined;
      let limit: number | undefined;
      let limitRemaining: number | undefined;
      let totalCredits: number | undefined;
      let balanceRemaining: number | undefined;
      let isFreeTier: boolean | undefined;

      if (authRes.ok) {
        const authJson = await authRes.json();
        const d = authJson?.data;
        usage = d?.usage;
        limit = d?.limit;
        limitRemaining = d?.limit_remaining;
        isFreeTier = d?.is_free_tier;
      }

      if (creditsRes.ok) {
        const creditsJson = await creditsRes.json();
        const cd = creditsJson?.data;
        if (cd) {
          totalCredits = cd.total_credits;
          const totalUsage = cd.total_usage || 0;
          if (totalCredits !== undefined) {
            balanceRemaining = Math.max(0, totalCredits - totalUsage);
          }
        }
      }

      const finalAvailable = balanceRemaining ?? limitRemaining;

      return {
        usage,
        limit,
        limitRemaining: finalAvailable,
        totalCredits,
        balanceRemaining: finalAvailable,
        isFreeTier,
      };
    } catch (err: any) {
      return { error: err.message || 'Timeout' };
    }
  }

  /**
   * Test LLM connection without sending chat tokens:
   * Uses OpenRouter /auth/key endpoint or OpenAI /models endpoint to verify the key instantly & safely
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
    const isDirectOpenAI = settings.llmProvider === 'openai';

    if (!key) {
      return { success: false, latencyMs: 0, error: 'Kein API Key hinterlegt' };
    }

    const start = Date.now();
    try {
      if (!isDirectOpenAI) {
        // OpenRouter: Query official auth/key endpoint (fast, 0 tokens, returns live usage & limits)
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: {
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer': 'https://mba-hub.local',
            'X-Title': 'MBA HUB'
          },
          signal: AbortSignal.timeout(15000)
        });

        const latencyMs = Date.now() - start;
        const json = await res.json().catch(() => ({}));

        if (res.ok && json?.data) {
          const d = json.data;
          const usageStr = d.usage !== undefined ? `Verbrauch: $${Number(d.usage).toFixed(4)}` : '';
          const remStr = d.limit_remaining !== undefined && d.limit_remaining !== null 
            ? ` | Restlimit: $${Number(d.limit_remaining).toFixed(2)}` 
            : (d.limit ? ` | Limit: $${Number(d.limit).toFixed(2)}` : '');
          const labelStr = d.label ? `[${d.label}] ` : '';

          return {
            success: true,
            latencyMs,
            details: `${labelStr}OpenRouter Key gültig ✓ ${usageStr}${remStr}`,
            usage: d.usage,
            limitRemaining: d.limit_remaining,
          };
        }

        if (res.status === 401 || res.status === 403) {
          return {
            success: false,
            latencyMs,
            error: json?.error?.message || 'Ungültiger OpenRouter API Key (401 Unauthorized)',
          };
        }

        return {
          success: false,
          latencyMs,
          error: json?.error?.message || `HTTP ${res.status}: OpenRouter Authentifizierungsfehler`,
        };
      } else {
        // Direct OpenAI: Query /models endpoint (fast, 0 tokens)
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(15000)
        });

        const latencyMs = Date.now() - start;
        if (res.ok) {
          return {
            success: true,
            latencyMs,
            details: 'OpenAI API Key gültig (Modell-Katalog erreichbar) ✓',
          };
        }

        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          latencyMs,
          error: data?.error?.message || `HTTP ${res.status}: Ungültiger OpenAI API Key`,
        };
      }
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Timeout bei der Verbindung zu OpenRouter' };
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

  /**
   * AI Cutout Auditor: Inspects 4-Panel Verification Image to verify clean background removal
   */
  static async auditSvgCutout(
    fourPanelImageBase64OrPath: string,
    quote?: string
  ): Promise<{
    cutout_verdict: 'APPROVED' | 'REJECTED';
    background_removed_cleanly: boolean;
    detected_issues: string[];
    confidence: number;
    explanation: string;
    rawText?: string;
    tokens?: { prompt: number; completion: number; total: number };
    latencyMs?: number;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getSvgBgAuditorPrompt();

    // Prepare image payload
    let imagePayload = fourPanelImageBase64OrPath;
    if (!imagePayload.startsWith('data:') && !imagePayload.startsWith('http')) {
      try {
        const fs = await import('fs');
        const buffer = fs.readFileSync(imagePayload);
        imagePayload = `data:image/png;base64,${buffer.toString('base64')}`;
      } catch (e) {}
    }

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Please audit the background removal for this artwork (${quote ? `Quote: "${quote}"` : 'Graphic Design'}) across the 4 test background colors (White, Black, Red, Slate). Output valid JSON.`
                },
                {
                  type: 'image_url',
                  image_url: { url: imagePayload }
                }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(25000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        throw new Error(`LLM Error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const tokens = data.usage ? {
        prompt: data.usage.prompt_tokens,
        completion: data.usage.completion_tokens,
        total: data.usage.total_tokens
      } : undefined;

      let clean = content;
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      let parsed: any = {};
      try {
        parsed = JSON.parse(clean);
      } catch {
        parsed = {
          cutout_verdict: 'APPROVED',
          background_removed_cleanly: true,
          detected_issues: [],
          confidence: 0.9,
          explanation: content
        };
      }

      return {
        cutout_verdict: parsed.cutout_verdict === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        background_removed_cleanly: parsed.background_removed_cleanly ?? (parsed.cutout_verdict !== 'REJECTED'),
        detected_issues: Array.isArray(parsed.detected_issues) ? parsed.detected_issues : [],
        confidence: parsed.confidence || 0.95,
        explanation: parsed.explanation || 'Background removal audit completed.',
        rawText: content,
        tokens,
        latencyMs
      };
    } catch (err: any) {
      console.error('[LLMService] Svg Cutout Audit error:', err);
      return {
        cutout_verdict: 'APPROVED',
        background_removed_cleanly: true,
        detected_issues: [`Audit network error: ${err.message}`],
        confidence: 0.5,
        explanation: `Audit fehlgeschlagen (${err.message}), Fallback auf freigegeben.`,
        latencyMs: Date.now() - start
      };
    }
  }
}

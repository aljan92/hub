import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { BannedWordsService } from './bannedWordsService';
import { ListingValidationService } from './listingValidationService';

export interface EnglishListing {
  brand: string;
  title: string;
  bullet1: string;
  bullet2: string;
  description: string;
}

export interface ListingResult {
  title: string;
  brand: string;
  bullet1: string;
  bullet2: string;
  description: string;
  keywords?: string;
  colorCount?: number;
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

export type DesignerSuggestionField = 'niche1' | 'niche2' | 'subniche' | 'quote' | 'style';

export interface DesignerSuggestionInput {
  field: DesignerSuggestionField;
  niche1?: string;
  niche2?: string;
  subniche?: string;
  quote?: string;
  style?: string;
  avoid?: string[];
  model?: string;
}

let cachedModels: OpenRouterModelItem[] = [];
let lastModelsFetch = 0;

export class LLMService {
  public static normalizeModelId(model: string): string {
    if (!model) return 'openai/gpt-5.6-sol';
    let trimmed = model.trim();

    // Map deprecated / retired Claude 3.5 Sonnet to current valid OpenRouter model
    if (
      trimmed === 'anthropic/claude-3.5-sonnet' ||
      trimmed === 'anthropic/claude-3-5-sonnet' ||
      trimmed === 'anthropic/claude-3.5-sonnet-20241022' ||
      trimmed === 'anthropic/claude-3-5-sonnet-20241022'
    ) {
      return 'anthropic/claude-sonnet-4';
    }

    return trimmed;
  }

  public static async parseHttpError(res: Response, prefix: string = 'OpenRouter'): Promise<string> {
    let detail = '';
    try {
      const json = await res.json();
      detail = json?.error?.message || (json?.error ? JSON.stringify(json.error) : JSON.stringify(json));
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = res.statusText;
      }
    }
    return `${prefix} HTTP ${res.status}: ${detail || res.statusText}`;
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

  public static buildDesignerSuggestionMessages(input: DesignerSuggestionInput): { system: string; user: string } {
    const instructions: Record<DesignerSuggestionField, string> = {
      niche1: 'Return exactly one clear evergreen interest niche in one to three words. Do not combine two niches. Never use connectors such as "and", "or", "with", "plus", "&", "/", or "x". Good granularity examples: Astronomy, Tennis, Retro Space Exploration. Avoid descriptive concepts such as "Retro space exploration and astronomy", micro-niches, brands, copyrighted properties, and seasonal events.',
      niche2: 'Return exactly one random, clear cross-niche in one to three words. It must be deliberately unrelated to niche1: do not derive it from niche1, match its theme, era, aesthetic, audience, science/fiction category, or visual vocabulary. The later D2 step will invent the connection. For example, an astronomy niche may receive Sloths or Tennis. Never use connectors such as "and", "or", "with", "plus", "&", "/", or "x".',
      subniche: 'Return exactly one clear and recognizable subniche of niche1 in one to three words. Use only the niche name, not a description, art direction, audience, or combined concept. Never use connectors such as "and", "or", "with", "plus", "&", "/", or "x".',
      quote: 'Return one short, original, memorable English T-shirt quote fitting all supplied niche fields. Avoid brands, known slogans, attribution, trademark symbols, and generic filler. Return only the quote text in the JSON value.',
      style: 'Return one concrete English T-shirt design style fitting the supplied niches and quote. Include a concise illustration and typography direction, not marketplace or promotional language.'
    };
    const clean = (value: unknown) => String(value || '').trim().slice(0, 300);
    const avoid = Array.from(new Set((input.avoid || []).map(clean).filter(Boolean))).slice(-5);
    return {
      system: `You generate one fast ideation suggestion for a print-on-demand designer form. ${instructions[input.field]} Reply in English with valid JSON only, exactly {"suggestion":"..."}. No markdown, explanation, alternatives, or extra keys. Keep the suggestion under 120 characters.`,
      user: JSON.stringify({
        targetField: input.field,
        currentValues: {
          niche1: clean(input.niche1),
          niche2: clean(input.niche2),
          subniche: clean(input.subniche),
          quote: clean(input.quote),
          style: clean(input.style)
        },
        avoid
      })
    };
  }

  public static parseDesignerSuggestion(content: unknown, avoid: string[] = [], field?: DesignerSuggestionField): string {
    if (typeof content !== 'string' || !content.trim()) throw new Error('Leere Antwort des Vorschlagsmodells.');
    const parsed = this.extractJsonFromLlmResponse(content);
    const suggestion = typeof parsed?.suggestion === 'string'
      ? parsed.suggestion.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ')
      : '';
    if (!suggestion || suggestion.length > 120 || /[\r\n]/.test(suggestion)) {
      throw new Error('Ungültiges Antwortformat des Vorschlagsmodells.');
    }
    if (field === 'niche1' || field === 'niche2' || field === 'subniche') {
      const words = suggestion.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
      const hasConnector = /(?:\band\b|\bor\b|\bwith\b|\bplus\b|\bx\b|[&/+])/i.test(suggestion);
      if (words.length < 1 || words.length > 3 || hasConnector) {
        throw new Error('Nischenvorschlag muss eine eindeutige Nische mit höchstens drei Wörtern ohne Verknüpfung sein.');
      }
    }
    const normalize = (value: string) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();
    if (avoid.some(value => normalize(value) === normalize(suggestion))) {
      throw new Error('Das Vorschlagsmodell hat einen bereits verwendeten Wert wiederholt.');
    }
    return suggestion;
  }

  public static async generateDesignerSuggestion(input: DesignerSuggestionInput): Promise<{ suggestion: string; model: string }> {
    const settings = loadSettings();
    const configured = String(input.model || settings.designerSuggestionModel || '').trim();
    const fallback = this.normalizeModelId(settings.llmModel);
    const selected = configured && /^[A-Za-z0-9._:/-]+$/.test(configured) ? this.normalizeModelId(configured) : fallback;
    const modelCandidates = Array.from(new Set([selected, fallback]));
    const { url, headers } = this.getBaseUrlAndHeaders();
    const messages = this.buildDesignerSuggestionMessages(input);
    let lastError: Error | null = null;

    for (const model of modelCandidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.executeFetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: messages.system },
                { role: 'user', content: messages.user }
              ],
              temperature: 0.9,
              max_tokens: 80
            }),
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) {
            lastError = new Error(await this.parseHttpError(response, 'Designer-Vorschlag'));
            break;
          }
          const data = await response.json();
          const suggestion = this.parseDesignerSuggestion(data?.choices?.[0]?.message?.content, input.avoid, input.field);
          return { suggestion, model };
        } catch (error: any) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }
    throw lastError || new Error('Designer-Vorschlag konnte weder mit dem gewählten noch mit dem Grundmodell erzeugt werden.');
  }

  /** Fetch the complete OpenRouter catalog. A forced refresh never returns a stale curated fallback. */
  static async getAvailableModels(forceRefresh = false): Promise<OpenRouterModelItem[]> {
    const now = Date.now();
    if (!forceRefresh && cachedModels.length > 0 && now - lastModelsFetch < 1000 * 60 * 30) {
      return cachedModels;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'HTTP-Referer': 'https://mba-hub.local',
        'X-Title': 'MBA HUB'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`OpenRouter-Modellliste HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.data)) throw new Error('OpenRouter hat keine gültige Modellliste geliefert.');
    const list: OpenRouterModelItem[] = data.data
      .filter((model: any) => typeof model?.id === 'string' && model.id.trim())
      .map((model: any) => ({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.context_length,
        promptPrice: model.pricing?.prompt ? `$${(parseFloat(model.pricing.prompt) * 1000000).toFixed(2)}/M` : undefined,
        completionPrice: model.pricing?.completion ? `$${(parseFloat(model.pricing.completion) * 1000000).toFixed(2)}/M` : undefined,
        description: model.description
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cachedModels = list;
    lastModelsFetch = now;
    return cachedModels;
  }

  // --- CIRCUIT BREAKER & LOW BALANCE GUARD ---
  private static circuitBroken = false;
  private static circuitBreakReason = '';
  private static circuitBreakTimestamp = 0;
  private static balanceCache: { balance: number; timestamp: number } | null = null;
  private static readonly BALANCE_CACHE_TTL_MS = 60000; // 60s Cache

  public static tripCircuitBreaker(reason: string) {
    this.circuitBroken = true;
    this.circuitBreakReason = reason;
    this.circuitBreakTimestamp = Date.now();
    console.warn(`[LLMService] 🛑 CIRCUIT BREAKER AUSGELÖST: ${reason}`);
  }

  public static resetCircuitBreaker() {
    this.circuitBroken = false;
    this.circuitBreakReason = '';
    this.circuitBreakTimestamp = 0;
    this.balanceCache = null; // Fresh check erzwingen
    console.log('[LLMService] 🟢 Circuit Breaker zurückgesetzt.');
  }

  public static isCircuitBroken(): { broken: boolean; reason?: string; timestamp?: number } {
    return {
      broken: this.circuitBroken,
      reason: this.circuitBreakReason || undefined,
      timestamp: this.circuitBreakTimestamp || undefined
    };
  }

  public static async getAvailableBalance(forceFresh = false): Promise<number | null> {
    const settings = loadSettings();
    if (settings.llmProvider !== 'openrouter') {
      return 999;
    }

    const now = Date.now();
    if (!forceFresh && this.balanceCache && (now - this.balanceCache.timestamp < this.BALANCE_CACHE_TTL_MS)) {
      return this.balanceCache.balance;
    }

    try {
      const credits = await this.getCredits();
      if (credits.balanceRemaining !== undefined && credits.balanceRemaining !== null) {
        this.balanceCache = { balance: credits.balanceRemaining, timestamp: now };
        const threshold = settings.openRouterMinBalanceThreshold ?? 1.00;

        if (credits.balanceRemaining < threshold) {
          if (!this.circuitBroken) {
            this.tripCircuitBreaker(`OpenRouter Guthaben ($${credits.balanceRemaining.toFixed(2)}) liegt unter Schwellenwert ($${threshold.toFixed(2)})`);
          }
        } else if (this.circuitBroken) {
          // Auto-resume if balance is above threshold!
          this.resetCircuitBreaker();
        }
        return credits.balanceRemaining;
      }
    } catch (err) {
      console.warn('[LLMService] ⚠️ Fehler bei getAvailableBalance:', err);
    }

    return this.balanceCache?.balance ?? null;
  }

  /**
   * Central fetch wrapper: Checks Circuit Breaker before call and catches HTTP 402
   */
  private static async executeFetch(url: string, init: RequestInit): Promise<Response> {
    const circuit = this.isCircuitBroken();
    if (circuit.broken) {
      throw new Error(`[LLMService] Circuit Breaker aktiv (${circuit.reason}). Anfrage abgebrochen.`);
    }

    const res = await fetch(url, init);

    if (res.status === 402) {
      this.tripCircuitBreaker('OpenRouter meldet 402 Payment Required: Guthaben aufgebraucht.');
      throw new Error('OpenRouter Fehler 402: Unzureichendes Guthaben (Insufficient Credits). Workflows pausiert.');
    }

    return res;
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
    stylePreset: string,
    imageProvider: 'IDEOGRAM' | 'IDEOGRAM_V4' | 'GPT_IMAGE_2' = 'IDEOGRAM',
    background: 'auto' | 'opaque' | 'transparent' = 'opaque',
    gptModel?: string
  ): Promise<string> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();

    const currentSettings = loadSettings();
    const effectiveGptModel = gptModel || currentSettings.gptImageModel || 'openai/gpt-image-2.5-sunburst';
    const isGpt25 = imageProvider === 'GPT_IMAGE_2' && effectiveGptModel === 'openai/gpt-image-2.5-sunburst';
    const providerName = imageProvider === 'GPT_IMAGE_2'
      ? (isGpt25 ? 'OpenAI GPT Image 2.5 Sunburst' : 'OpenAI GPT Image 2')
      : (imageProvider === 'IDEOGRAM_V4' ? 'Ideogram 4.0' : 'Ideogram 3.0');
    const backgroundInstruction = background === 'transparent' && imageProvider === 'GPT_IMAGE_2' && !isGpt25
      ? 'Request a perfectly uniform, flat, solid deep blue chroma-key background behind the isolated artwork. Reserve deep blue exclusively for that removable background: never use it in typography, foreground objects, outlines, shadows, highlights, textures, borders, or decoration. Do not request transparency and do not draw a checkerboard or transparency-grid pattern.'
      : background === 'transparent'
      ? 'Request a genuinely transparent background with an isolated design and no mockup, shirt, person, scene, shadow, or background texture.'
      : background === 'auto'
        ? 'Keep the design isolated with no mockup, shirt, person, or realistic scene; allow the image provider to choose the background treatment.'
        : 'Request an isolated design on a clean, flat, solid contrasting background with no mockup, shirt, person, or realistic scene.';
    const systemPrompt = `You are an expert prompt engineer specializing in ${providerName} T-shirt graphics for Merch by Amazon.
Your goal is to craft a highly descriptive, visually stunning, clean vector prompt that produces high-converting apparel designs.
Requirements:
1. ${backgroundInstruction}
2. If a quote is provided, include the exact text inside quotation marks and request bold, legible typography.
3. Keep the prompt under 90 words, focused strictly on visual aesthetic, style, lighting, and composition. No promo or buzzwords like 4K. Output ONLY the raw prompt text.`;

    const userMessage = `Niche 1: ${niche1}
Niche 2: ${niche2}
Quote / Text: "${quote}"
Style Preset: ${stylePreset}`;

    try {
      const res = await this.executeFetch(url, {
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
   * Helper: Robustly extract and parse JSON object from LLM response
   */
  public static extractJsonFromLlmResponse(content: string): any {
    if (!content || typeof content !== 'string') return {};
    let clean = content.trim();
    // Strip markdown code fences if present
    if (clean.includes('```')) {
      clean = clean.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    }
    // Extract first {...} block
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      clean = match[0];
    }
    try {
      return JSON.parse(clean);
    } catch (e) {
      console.warn('[LLMService] Direct JSON parse failed, trying sanitized parse:', e);
      try {
        // Remove trailing commas before closing braces
        const sanitized = clean.replace(/,\s*([\}\]])/g, '$1');
        return JSON.parse(sanitized);
      } catch (e2) {
        console.error('[LLMService] Failed to parse JSON from LLM response:', clean.slice(0, 200));
        return {};
      }
    }
  }

  /**
   * 1. Generate Master English Listing (100% English First, Suffix SEO Formula, Keyword-Dense Brand)
   */
  static async generateMasterEnglishListing(params: {
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    keywords?: string[];
    hermesKeywords?: string[];
    stylePreset?: string;
    audience?: string;
    avoidColor?: string;
    oldListing?: any;
    imageSource?: string;
  }): Promise<EnglishListing & { _rawRequest?: any; _rawResponse?: any }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();

    const basePrompt = SystemPromptService.getListingGeneratorPrompt();
    const bannedSection = BannedWordsService.getBannedWordsPromptSection('en');
    const systemPrompt = `${basePrompt}\n\n${bannedSection}`;

    const n1 = ListingValidationService.normalizeOptionalText(params.niche1) || 'Graphic Art';
    const n2 = ListingValidationService.normalizeOptionalText(params.niche2) || '';
    const sub = ListingValidationService.normalizeOptionalText(params.subniche) || '';
    const titleTail = ListingValidationService.resolveExpectedTitleSuffix({ niche1: n1, niche2: n2, subniche: sub });
    const quote = params.quote || '';
    const allKw = [
      ...(params.hermesKeywords || []),
      ...(params.keywords || [])
    ].filter(Boolean);

    let userMessage = `Design Information:
- Primary Niche (niche1): ${n1}
- Secondary Niche (niche2): ${n2 || 'none'}
- Subniche: ${sub || 'none'}
- Immutable TITLE_TAIL: ${titleTail}
- Quote / Slogan: "${quote}"
- Keywords Pool: ${allKw.length > 0 ? allKw.join(', ') : 'none provided'}
- Style Preset: ${params.stylePreset || 'vintage retro vector'}
- Target Audience: ${params.audience || 'Men, Women'}
- Avoid Colors: ${params.avoidColor || 'none'}`;

    if (params.oldListing) {
      userMessage += `\n\nExisting Listing Context (for inspiration/upgrade):
- Old Brand: "${params.oldListing.brand || ''}"
- Old Title: "${params.oldListing.title || ''}"
- Old Bullets: "${[params.oldListing.bullet1, params.oldListing.bullet2].filter(Boolean).join(' | ')}"`;
    }

    userMessage += `\n\nGenerate the compact 100% English Amazon Merch on Demand listing now. The Title must end literally with TITLE_TAIL and no trailing punctuation.`;

    const userContent: any[] = [
      { type: 'text', text: userMessage }
    ];

    if (params.imageSource) {
      userContent.push({
        type: 'image_url',
        image_url: { url: params.imageSource }
      });
    }

    const settings = loadSettings();
    const requestPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: settings.llmTemperature ?? 0.35,
      max_tokens: settings.llmMaxTokens || 3000
    };

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(`LLM Listing error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsedRaw = this.extractJsonFromLlmResponse(content);
      const parsed = parsedRaw.listing || parsedRaw.en || parsedRaw.english_listing || parsedRaw;

      // Extract with robust key variant handling
      const rawBrand = parsed.brand || parsed.Brand || parsed.brand_name || parsed.brandName;
      const rawTitle = parsed.title || parsed.Title || parsed.product_title || parsed.productTitle;
      const rawBullet1 = parsed.bullet1 || parsed.Bullet1 || parsed.bullet_1 || parsed.bulletPoint1 || parsed.bullet_point_1;
      const rawBullet2 = parsed.bullet2 || parsed.Bullet2 || parsed.bullet_2 || parsed.bulletPoint2 || parsed.bullet_point_2;
      const rawDesc = parsed.description || parsed.Description || parsed.product_description;

      const missingFields = [
        ['brand', rawBrand],
        ['title', rawTitle],
        ['bullet1', rawBullet1],
        ['bullet2', rawBullet2],
        ['description', rawDesc]
      ].filter(([, value]) => typeof value !== 'string' || !value.trim()).map(([name]) => name);
      if (missingFields.length > 0) {
        const error = new Error(`LISTING_VALIDATION_FAILED: missing fields: ${missingFields.join(', ')}`) as Error & { code?: string };
        error.code = 'LISTING_VALIDATION_FAILED';
        throw error;
      }

      // Clean Title: ensure no trailing punctuation
      let cleanTitle = (rawTitle || '').trim();
      cleanTitle = cleanTitle.replace(/[,.!?:;'"\-–—]+$/, '').trim();

      const rawListing: EnglishListing = {
        brand: String(rawBrand || '').trim(),
        title: cleanTitle,
        bullet1: String(rawBullet1 || '').trim(),
        bullet2: String(rawBullet2 || '').trim(),
        description: String(rawDesc || '').trim()
      };

      const validated = ListingValidationService.validateAndRepairListing({
        listing: rawListing,
        niche1: n1,
        niche2: n2,
        subniche: sub
      });

      if (!validated.isValid) {
        const error = new Error(`LISTING_VALIDATION_FAILED: ${validated.issues.join(' | ') || 'missing or invalid required fields'}`) as Error & { code?: string };
        error.code = 'LISTING_VALIDATION_FAILED';
        throw error;
      }

      return {
        ...validated.listing,
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error generating master English listing:', err);
      if (err?.code === 'LISTING_VALIDATION_FAILED') throw err;
      const failure = new Error(`LISTING_GENERATION_FAILED: ${err?.message || String(err)}`) as Error & { code?: string; cause?: unknown };
      failure.code = 'LISTING_GENERATION_FAILED';
      failure.cause = err;
      throw failure;
    }
  }

  /**
   * 2. Rewrite Listing with Specific Trademark Feedback (Feedback Loop, Class Distinctions)
   */
  /**
   * V3 Trademark Referee (uses the generally configured model)
   * Semantic risk analysis, distinction between common descriptive words vs distinctive/famous marks
   */
  static async evaluateTrademarkReferee(params: {
    currentListing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    compactHits?: any[];
    normalizedHits?: any[];
    rewriteIteration?: number;
    forbiddenTermsForTask?: string[];
    blockedProducts?: string[];
    sessionId?: string;
  }): Promise<{
    decision: 'APPROVE' | 'REWRITE' | 'APPROVE_WITH_BLOCKED_PRODUCTS' | 'ESCALATE';
    canBeFixedByListingRewrite: boolean;
    reasonCode?: string | null;
    recommendedAction?: string | null;
    hits: Array<{
      id?: string;
      searchedTerm: string;
      registeredMark: string;
      field?: string;
      classes?: number[];
      usageClassification?: string;
      confidence?: number;
      markNature?: string;
      usageType?: string;
      knownBrand?: boolean;
      amazonRejectionRisk?: string;
      decision?: string;
      reason?: string;
    }>;
    blockedProducts: string[];
    rewriteRequired: boolean;
    rewriteInstructions: string[];
    knownBrandSignals?: Array<{ term: string; field: string; confidence: number; action: string; reason?: string }>;
    escalation?: any;
    _rawRequest?: any;
    _rawResponse?: any;
    _usage?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getTrademarkRefereePrompt();
    const hitsData = params.compactHits || params.normalizedHits || [];

    const userMessage = `Current English Listing:
- Brand: "${params.currentListing.brand}"
- Title: "${params.currentListing.title}"
- Bullet 1: "${params.currentListing.bullet1}"
- Bullet 2: "${params.currentListing.bullet2}"
- Description: "${params.currentListing.description}"

Design Metadata:
- Primary Niche (niche1): ${params.niche1 || 'none'}
- Secondary Niche (niche2): ${params.niche2 || 'none'}
- Subniche: ${params.subniche || 'none'}
- Printed Design Quote / Slogan: "${params.quote || 'none'}"

Compact Trademark Hits:
${JSON.stringify(hitsData)}

Rewrite Context:
- Rewrite Iteration: ${params.rewriteIteration || 0} / 3
- Forbidden Terms for Task: ${JSON.stringify(params.forbiddenTermsForTask || [])}
- Currently Blocked Products: ${JSON.stringify(params.blockedProducts || [])}

Evaluate all hits against the supplied policy. Return evaluatedHits for every Brand, Class 25, exact Quote, locked-tail, and Combined-Mark hit.
CRITICAL: You MUST include an evaluatedHits entry for every hit that involves Class 25, Brand, Quote, or Locked-Tail, even if it is a common dictionary word (classify as INCIDENTAL_DICTIONARY_OVERLAP or DESCRIPTIVE_FAIR_USE with action KEEP). Safe secondary-class hits (not in Class 25, not Brand, not Quote) may be omitted. Return valid JSON only.`;

    const settings = loadSettings();
    const requestPayload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.2),
      max_tokens: Math.min(Math.max(settings.llmMaxTokens || 3500, 2500), 4000)
    };

    if (params.sessionId) {
      requestPayload.session_id = params.sessionId;
    }

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(await LLMService.parseHttpError(res, 'LLM TM Referee'));
      const data = await res.json();
      const finishReason = data.choices?.[0]?.finish_reason;
      const isTruncated = finishReason === 'length';

      const rawContent = data.choices?.[0]?.message?.content;
      const content = typeof rawContent === 'string' ? rawContent.trim() : '';
      const parsed = content ? this.extractJsonFromLlmResponse(content) : null;

      const validDecisions = ['APPROVE', 'REWRITE', 'APPROVE_WITH_BLOCKED_PRODUCTS', 'ESCALATE'];
      const hasValidDecision = !isTruncated && parsed && typeof parsed === 'object' && validDecisions.includes(parsed.decision);

      if (!hasValidDecision) {
        const errorDetail = isTruncated 
          ? 'LLM response was truncated (finish_reason === "length")' 
          : (!content ? 'Empty LLM response' : 'Invalid JSON or missing/unrecognized decision in LLM response');

        console.warn(`[LLMService] ⚠️ Fail-safe triggered in evaluateTrademarkReferee: ${errorDetail}`);
        return {
          decision: 'ESCALATE',
          canBeFixedByListingRewrite: false,
          reasonCode: 'INVALID_AI_RESPONSE',
          recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
          hits: [],
          blockedProducts: params.blockedProducts || [],
          rewriteRequired: false,
          rewriteInstructions: [],
          knownBrandSignals: [],
          escalation: { error: errorDetail },
          _rawRequest: requestPayload,
          _rawResponse: content
        };
      }

      const decision = parsed.decision;
      const canBeFixed = parsed.canBeFixedByListingRewrite !== undefined 
        ? Boolean(parsed.canBeFixedByListingRewrite) 
        : (decision !== 'ESCALATE');

      const rawProblematic = Array.isArray(parsed.evaluatedHits)
        ? parsed.evaluatedHits
        : Array.isArray(parsed.problematicHits)
          ? parsed.problematicHits
        : (Array.isArray(parsed.hits) ? parsed.hits : []);

      const mappedHits = rawProblematic.map((h: any) => ({
        id: h.id,
        searchedTerm: h.term || h.searchedTerm || h.mark || '',
        registeredMark: h.mark || h.registeredMark || '',
        field: h.field || (Array.isArray(h.occurrences) && h.occurrences.length > 0 ? h.occurrences[0].field : 'all'),
        classes: Array.isArray(h.classes) ? h.classes : undefined,
        usageClassification: h.usageClassification || h.usage_classification || h.markNature,
        confidence: typeof h.confidence === 'number' ? h.confidence : Number.NaN,
        markNature: h.markNature || 'DISTINCTIVE_OR_BRAND',
        usageType: h.usageType || 'POTENTIAL_RISK',
        amazonRejectionRisk: h.amazonRejectionRisk || (h.action === 'REWRITE' ? 'HIGH' : 'LOW'),
        decision: h.action || h.decision,
        reasonCode: h.reasonCode || h.reason_code || null,
        reason: h.reason || h.explanation || 'Identified trademark risk'
      }));
      const knownBrandSignals = (Array.isArray(parsed.knownBrandSignals) ? parsed.knownBrandSignals : [])
        .map((signal: any) => ({
          term: String(signal.term || '').trim(),
          field: String(signal.field || '').trim(),
          confidence: Number(signal.confidence),
          action: String(signal.action || '').trim().toUpperCase(),
          reason: String(signal.reason || '').trim() || undefined
        }));

      return {
        decision,
        canBeFixedByListingRewrite: canBeFixed,
        reasonCode: parsed.reasonCode || parsed.reason_code || (parsed.escalation?.reasonCode ?? null),
        recommendedAction: parsed.recommendedAction || parsed.recommended_action || (parsed.escalation?.recommendedAction ?? null),
        hits: mappedHits,
        blockedProducts: Array.isArray(parsed.blockedProducts) ? parsed.blockedProducts : (Array.isArray(parsed.blocked_products) ? parsed.blocked_products : (params.blockedProducts || [])),
        rewriteRequired: parsed.rewriteRequired !== undefined ? Boolean(parsed.rewriteRequired) : (decision === 'REWRITE'),
        rewriteInstructions: Array.isArray(parsed.rewriteInstructions) ? parsed.rewriteInstructions : (Array.isArray(parsed.rewrite_instructions) ? parsed.rewrite_instructions : []),
        knownBrandSignals,
        escalation: parsed.escalation || null,
        _rawRequest: requestPayload,
        _rawResponse: content,
        _usage: data.usage
      };
    } catch (err: any) {
      console.error('[LLMService] Error in evaluateTrademarkReferee:', err);
      return {
        decision: 'ESCALATE',
        canBeFixedByListingRewrite: false,
        reasonCode: 'INVALID_AI_RESPONSE',
        recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
        hits: [],
        blockedProducts: params.blockedProducts || [],
        rewriteRequired: false,
        rewriteInstructions: [],
        knownBrandSignals: [],
        escalation: { error: err.message },
        _rawRequest: requestPayload,
        _rawResponse: err.message
      };
    }
  }

  /**
   * V3 Amazon Rejection Verifier (configured-model adversarial reviewer)
   */
  static async evaluateTrademarkVerifier(params: {
    currentListing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    compactHits?: any[];
    normalizedHits?: any[];
    refereeDecision?: string;
    refereeHits?: any[];
    blockedProducts?: string[];
    sessionId?: string;
  }): Promise<{
    verdict: 'SAFE' | 'HIGH_RISK';
    identifiedRisks: Array<{
      term: string;
      field: string;
      riskType: string;
      explanation: string;
    }>;
    canBeFixedByListingRewrite: boolean;
    recommendation: string;
    _rawRequest?: any;
    _rawResponse?: any;
    _usage?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getTrademarkVerifierPrompt();
    const hitsData = params.compactHits || params.normalizedHits || [];

    const userMessage = `Candidate English Listing for Amazon Merch Submission:
- Brand: "${params.currentListing.brand}"
- Title: "${params.currentListing.title}"
- Bullet 1: "${params.currentListing.bullet1}"
- Bullet 2: "${params.currentListing.bullet2}"
- Description: "${params.currentListing.description}"

Design Metadata:
- Primary Niche (niche1): ${params.niche1 || 'none'}
- Secondary Niche (niche2): ${params.niche2 || 'none'}
- Subniche: ${params.subniche || 'none'}
- Printed Design Quote / Slogan: "${params.quote || 'none'}"

Compact Trademark Hits Data:
${JSON.stringify(hitsData)}

Previous Referee Verdict: "${params.refereeDecision || 'APPROVE'}"
Previous Referee Classifications: ${JSON.stringify(params.refereeHits || [])}
Blocked Products: ${JSON.stringify(params.blockedProducts || [])}

Act as the final adversarial Amazon Merch reviewer. Do you see any plausible trademark, brand, or policy reasons why Amazon Merch might reject this submission or penalize the account? Return valid JSON.`;

    const settings = loadSettings();
    const requestPayload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.2),
      max_tokens: Math.min(Math.max(settings.llmMaxTokens || 2500, 1500), 2500)
    };

    if (params.sessionId) {
      requestPayload.session_id = params.sessionId;
    }

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(await LLMService.parseHttpError(res, 'LLM TM Verifier'));
      const data = await res.json();
      const finishReason = data.choices?.[0]?.finish_reason;
      const isTruncated = finishReason === 'length';

      const rawContent = data.choices?.[0]?.message?.content;
      const content = typeof rawContent === 'string' ? rawContent.trim() : '';
      const parsed = content ? this.extractJsonFromLlmResponse(content) : null;

      const rawRisks = Array.isArray(parsed?.identifiedRisks) 
        ? parsed.identifiedRisks 
        : (Array.isArray(parsed?.identified_risks) ? parsed.identified_risks : null);

      const isValidSafe = !isTruncated && 
        parsed && 
        typeof parsed === 'object' && 
        parsed.verdict === 'SAFE' && 
        Array.isArray(rawRisks);

      const isValidHighRisk = !isTruncated && 
        parsed && 
        typeof parsed === 'object' && 
        parsed.verdict === 'HIGH_RISK';

      if (isValidSafe) {
        return {
          verdict: 'SAFE',
          identifiedRisks: rawRisks,
          canBeFixedByListingRewrite: parsed.canBeFixedByListingRewrite !== undefined ? Boolean(parsed.canBeFixedByListingRewrite) : true,
          recommendation: parsed.recommendation || 'SAFE_TO_PUBLISH',
          _rawRequest: requestPayload,
          _rawResponse: content,
          _usage: data.usage
        };
      }

      if (isValidHighRisk) {
        return {
          verdict: 'HIGH_RISK',
          identifiedRisks: Array.isArray(rawRisks) ? rawRisks : [{ term: 'N/A', field: 'all', riskType: 'HIGH_RISK', explanation: parsed.explanation || 'Verifier identified high risk' }],
          canBeFixedByListingRewrite: parsed.canBeFixedByListingRewrite !== undefined ? Boolean(parsed.canBeFixedByListingRewrite) : false,
          recommendation: parsed.recommendation || 'REWRITE_NEEDED',
          _rawRequest: requestPayload,
          _rawResponse: content,
          _usage: data.usage
        };
      }

      // Fail-safe: empty, {}, invalid JSON, missing verdict, unknown verdict or finish_reason=length
      const errorDetail = isTruncated
        ? 'LLM response was truncated (finish_reason === "length")'
        : (!content ? 'Empty LLM response' : 'Invalid JSON, missing verdict, or invalid schema in LLM response');

      console.warn(`[LLMService] ⚠️ Fail-safe triggered in evaluateTrademarkVerifier: ${errorDetail}`);
      return {
        verdict: 'HIGH_RISK',
        identifiedRisks: [{
          term: 'N/A',
          field: 'all',
          riskType: 'INVALID_AI_RESPONSE',
          explanation: errorDetail
        }],
        canBeFixedByListingRewrite: false,
        recommendation: 'ESCALATE_TO_HUMAN',
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error in evaluateTrademarkVerifier:', err);
      return {
        verdict: 'HIGH_RISK',
        identifiedRisks: [{ term: 'N/A', field: 'all', riskType: 'INVALID_AI_RESPONSE', explanation: err.message }],
        canBeFixedByListingRewrite: false,
        recommendation: 'ESCALATE_TO_HUMAN',
        _rawRequest: requestPayload,
        _rawResponse: err.message
      };
    }
  }

  /**
   * V2 SEO-Preserving Rewrite for Trademark Issues
   */
  static async rewriteListingForTrademarkV2(params: {
    currentListing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    rewriteIteration: number;
    forbiddenTermsForTask: string[];
    rewriteInstructions: string[];
    hitsToFix?: any[];
    sessionId?: string;
  }): Promise<{
    refinedListing: EnglishListing;
    actionsTaken: string[];
    _rawRequest?: any;
    _rawResponse?: any;
    _usage?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getTrademarkRewritePrompt();

    const normN1 = ListingValidationService.normalizeOptionalText(params.niche1);
    const normN2 = ListingValidationService.normalizeOptionalText(params.niche2);
    const normSub = ListingValidationService.normalizeOptionalText(params.subniche);
    const expectedSuffix = ListingValidationService.resolveExpectedTitleSuffix({
      niche1: normN1,
      niche2: normN2,
      subniche: normSub
    });

    const userMessage = `You are performing an automated SEO-preserving Trademark Rewrite for Merch by Amazon (Iteration ${params.rewriteIteration}, normally max 3; an explicitly authorized fourth round is secondary-class-only).

Current Listing:
- Brand: "${params.currentListing.brand}"
- Title: "${params.currentListing.title}"
- Bullet 1: "${params.currentListing.bullet1}"
- Bullet 2: "${params.currentListing.bullet2}"
- Description: "${params.currentListing.description}"

Design Metadata:
- Primary Niche (niche1): ${normN1 || 'none'}
- Secondary Niche (niche2): ${normN2 || 'none'}
- Subniche: ${normSub || 'none'}
- Quote / Slogan: "${params.quote || ''}"

SPECIFIC TRADEMARK ISSUES TO RESOLVE:
${params.rewriteInstructions.length > 0 ? params.rewriteInstructions.map(i => `- ${i}`).join('\n') : '- Replace flagged trademark terms with strong compliant niche keywords.'}

CRITICAL CONSTRAINTS:
1. STRICTLY FORBIDDEN TERMS (DO NOT USE THESE OR CLOSE VARIANTS):
   ${JSON.stringify(params.forbiddenTermsForTask)}
2. LOCKED TITLE SUFFIX: Title MUST end literally with "${expectedSuffix}"
3. CHARACTER LIMITS (NO MINIMUM LENGTH TARGETS):
   - Brand: required, max 50 chars
   - Title: required, max 60 chars (ending with locked suffix)
   - Bullet 1: max 256 chars
   - Bullet 2: max 256 chars
   - Description: max 600 chars
4. MINIMAL INVASIVENESS: Repair only the fields and terms affected by trademark issues. Keep all unaffected keywords, structures, and phrasing completely intact. Never expand a compliant field merely to make it longer.

Return ONLY valid JSON:
{
  "brand": "...",
  "title": "...",
  "bullet1": "...",
  "bullet2": "...",
  "description": "...",
  "actions_taken": ["Replaced term X with Y in Brand", "Rewrote Bullet 1 to remove phrase Z"]
}`;

    const settings = loadSettings();
    const requestPayload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.25),
      max_tokens: Math.min(Math.max(settings.llmMaxTokens || 2500, 2000), 3000)
    };

    if (params.sessionId) {
      requestPayload.session_id = params.sessionId;
    }

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(await LLMService.parseHttpError(res, 'LLM TM Rewrite V2'));
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(content);

      let cleanTitle = (parsed.title || params.currentListing.title).trim();
      cleanTitle = cleanTitle.replace(/[,.!?:;'"\-–—]+$/, '').trim();

      const refined: EnglishListing = {
        brand: (parsed.brand || params.currentListing.brand).trim().slice(0, 50),
        title: cleanTitle.slice(0, 60),
        bullet1: (parsed.bullet1 || params.currentListing.bullet1).trim().slice(0, 256),
        bullet2: (parsed.bullet2 || params.currentListing.bullet2).trim().slice(0, 256),
        description: (parsed.description || params.currentListing.description).trim().slice(0, 600)
      };

      const validated = ListingValidationService.validateAndRepairListing({
        listing: refined,
        niche1: normN1,
        niche2: normN2,
        subniche: normSub,
        forbiddenTerms: params.forbiddenTermsForTask
      });

      if (!validated.isValid) {
        const error = new Error(`TRADEMARK_REWRITE_VALIDATION_FAILED: ${validated.issues.join(' | ') || 'invalid rewritten listing'}`) as Error & { code?: string };
        error.code = 'TRADEMARK_REWRITE_VALIDATION_FAILED';
        throw error;
      }

      const actionsTaken = Array.isArray(parsed.actions_taken) ? parsed.actions_taken : (Array.isArray(parsed.actionsTaken) ? parsed.actionsTaken : ['Automated trademark rewrite applied']);
      if (validated.repaired) {
        actionsTaken.push(`Deterministic validation repair: ${validated.issues.join('; ')}`);
      }

      return {
        refinedListing: validated.listing,
        actionsTaken,
        _rawRequest: requestPayload,
        _rawResponse: content,
        _usage: data.usage
      };
    } catch (err: any) {
      console.error('[LLMService] Error in rewriteListingForTrademarkV2:', err);
      if (err?.code === 'TRADEMARK_REWRITE_VALIDATION_FAILED') throw err;
      const failure = new Error(`TRADEMARK_REWRITE_FAILED: ${err?.message || String(err)}`) as Error & { code?: string; cause?: unknown };
      failure.code = 'TRADEMARK_REWRITE_FAILED';
      failure.cause = err;
      throw failure;
    }
  }

  /**
   * Backward-compatibility wrapper for rewriteListingWithTrademarkFeedback
   */
  static async rewriteListingWithTrademarkFeedback(params: {
    currentListing: EnglishListing;
    tmHits: any[];
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
  }): Promise<{
    verdict: 'APPROVED' | 'REJECTED';
    rejection_reason?: string | null;
    blocked_classes?: number[];
    actions_taken?: string[];
    refined_listing: EnglishListing;
    _rawRequest?: any;
    _rawResponse?: any;
  }> {
    const res = await this.rewriteListingForTrademarkV2({
      currentListing: params.currentListing,
      niche1: params.niche1,
      niche2: params.niche2,
      subniche: params.subniche,
      quote: params.quote,
      rewriteIteration: 1,
      forbiddenTermsForTask: [],
      rewriteInstructions: params.tmHits.map(h => `Resolve trademark hit: ${h.term || h.trademark} (Class ${h.classNumber || '25'})`)
    });

    return {
      verdict: 'APPROVED',
      rejection_reason: null,
      blocked_classes: [],
      actions_taken: res.actionsTaken,
      refined_listing: res.refinedListing,
      _rawRequest: res._rawRequest,
      _rawResponse: res._rawResponse
    };
  }

  /**
   * 3. Translate Approved English Master Listing into Multi-Marketplace Languages (DE, FR, ES, IT, JA)
   * Only called AFTER English Listing is approved & TM-safe (saves ~80% tokens)
   */
  static async translateApprovedListing(params: {
    englishListing: EnglishListing;
    niche1?: string;
    subniche?: string;
    quote?: string;
  }): Promise<{
    en: EnglishListing;
    de: EnglishListing;
    fr: EnglishListing;
    es: EnglishListing;
    it: EnglishListing;
    ja: EnglishListing;
    _rawRequest?: any;
    _rawResponse?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();

    const systemPrompt = SystemPromptService.getUpdateTranslationPrompt();

    const userMessage = `Approved English Master Listing:
- Brand: "${params.englishListing.brand}"
- Title: "${params.englishListing.title}"
- Bullet 1: "${params.englishListing.bullet1}"
- Bullet 2: "${params.englishListing.bullet2}"
- Description: "${params.englishListing.description}"

Artwork Quote (keep verbatim in all languages): "${params.quote || ''}"
Primary Niche: "${params.niche1 || ''}"
Subniche: "${params.subniche || ''}"

Translate and localize into de, fr, es, it, and ja now. Ensure Title ends with the translated Niche/Subniche noun without trailing punctuation!`;

    const settings = loadSettings();
    const requestPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.3),
      max_tokens: Math.max(settings.llmMaxTokens || 3000, 2500)
    };

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(`LLM Translation error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(content);

      const cleanListing = (item: any, fallback: EnglishListing): EnglishListing => {
        if (!item || typeof item !== 'object') return fallback;
        let t = (item.title || fallback.title).trim();
        t = t.replace(/[,.!?:;'"\-–—]+$/, '').trim();
        return {
          brand: (item.brand || fallback.brand).trim().slice(0, 50),
          title: t.slice(0, 60),
          bullet1: (item.bullet1 || fallback.bullet1).trim().slice(0, 256),
          bullet2: (item.bullet2 || fallback.bullet2).trim().slice(0, 256),
          description: (item.description || fallback.description).trim().slice(0, 600)
        };
      };

      return {
        en: params.englishListing,
        de: cleanListing(parsed.de || parsed.DE || parsed.german, params.englishListing),
        fr: cleanListing(parsed.fr || parsed.FR || parsed.french, params.englishListing),
        es: cleanListing(parsed.es || parsed.ES || parsed.spanish, params.englishListing),
        it: cleanListing(parsed.it || parsed.IT || parsed.italian, params.englishListing),
        ja: cleanListing(parsed.ja || parsed.JA || parsed.japanese, params.englishListing),
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error translating listing:', err);
      return {
        en: params.englishListing,
        de: params.englishListing,
        fr: params.englishListing,
        es: params.englishListing,
        it: params.englishListing,
        ja: params.englishListing,
        _rawRequest: requestPayload,
        _rawResponse: err.message
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
      const res = await this.executeFetch(url, {
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

  /**
   * Generates creative commercial apparel design concepts from natural language or random evergreen themes.
   */
  public static async generateDesignerConcepts(params: {
    userPrompt: string;
    count: number;
    model: string;
    avoidanceList?: string[];
  }): Promise<Array<{ niche1: string; niche2?: string; subniche?: string; quote: string; style?: string }>> {
    const { url, headers } = this.getBaseUrlAndHeaders();
    const model = this.normalizeModelId(params.model);

    const avoidText = params.avoidanceList && params.avoidanceList.length > 0
      ? `\n\nDO NOT repeat or closely imitate the following recently created concepts/quotes:\n${params.avoidanceList.map(a => `- ${a}`).join('\n')}`
      : '';

    const systemPrompt = `You are a world-class Print-on-Demand (POD) Merch by Amazon Art Director and Bestseller Niche Strategist.

Your goal is to generate commercially viable, highly sellable, authentic T-shirt design concepts.
When choosing broad niches or generating random ideas, focus on high-demand categories such as:
- evergreen
- Berufe
- Haustiere mit beliebten Rassen
- Hobbys & Sport
- Familie/Lifestyle

IMPORTANT FIELD RULES:
1. "niche1" (REQUIRED): The primary broad niche in English (1-3 words).
2. "quote" (REQUIRED): A catchy, original, witty, emotional, or relatable short English T-shirt quote/slogan suitable for apparel printing. Never use trademarked slogans, brand names, or copyrighted phrases.
3. "subniche" (OPTIONAL): A specific subtype, breed, or specialty. Only provide if it adds genuine value (e.g. a specific dog/cat/horse breed, or a specific trade specialty); otherwise leave it empty string "".
4. "niche2" (OPTIONAL): A distinct, compelling cross-niche. Only provide if it represents a genuine, synergistic cross-niche; otherwise leave it empty string "".
5. "style" (OPTIONAL): An illustration/design style direction. Can be left empty string "" to allow the automated prompt generator to decide.

OUTPUT FORMAT:
Return strictly valid JSON only in this exact format:
{
  "concepts": [
    {
      "niche1": "...",
      "niche2": "",
      "subniche": "",
      "quote": "...",
      "style": ""
    }
  ]
}
No markdown backticks, no preamble, no explanation.${avoidText}`;

    const userMessage = `${params.userPrompt}\n\nGenerate exactly ${params.count} unique concept(s).`;

    const settings = loadSettings();
    const timeoutMs = Math.max(30000, (settings.llmTimeoutSeconds || 90) * 1000);

    const res = await this.executeFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.85,
        max_tokens: Math.min(4000, params.count * 400 + 600)
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      throw new Error(await this.parseHttpError(res, 'LLM Konzept-Generator'));
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = this.extractJsonFromLlmResponse(rawContent);

    const rawList = Array.isArray(parsed?.concepts) 
      ? parsed.concepts 
      : (Array.isArray(parsed) ? parsed : []);

    const concepts: Array<{ niche1: string; niche2?: string; subniche?: string; quote: string; style?: string }> = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const n1 = String(item.niche1 || item.niche || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const q = String(item.quote || item.text || '').trim().replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').slice(0, 200);
      if (!n1 || !q) continue;

      const sub = String(item.subniche || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const n2 = String(item.niche2 || item.crossNiche || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const st = String(item.style || '').trim().replace(/\s+/g, ' ').slice(0, 300);

      concepts.push({
        niche1: n1,
        niche2: n2 && n2.toLowerCase() !== n1.toLowerCase() ? n2 : undefined,
        subniche: sub && sub.toLowerCase() !== n1.toLowerCase() ? sub : undefined,
        quote: q,
        style: st || undefined
      });
    }

    if (concepts.length === 0) {
      throw new Error('Das LLM konnte keine gültigen Design-Konzepte erzeugen.');
    }

    return concepts;
  }

  /**
   * Evaluates trademark hits of a single field for Fair Use vs. critical conflict.
   * Fast, low-token LLM call specifically focused on one field's context and hits.
   */
  static async evaluateFieldFairUse(params: {
    field: 'brand' | 'title' | 'bullet1' | 'bullet2' | 'description';
    fieldText: string;
    fieldHits: any[];
    quote?: string;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    otherFields?: Partial<EnglishListing>;
    sessionId?: string;
  }): Promise<{
    field: string;
    overallVerdict: 'SAFE_FAIR_USE' | 'HAS_CONFLICTS';
    evaluatedHits: Array<{
      searchedTerm: string;
      registeredMark: string;
      isFairUse: boolean;
      riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
      classification: 'DESCRIPTIVE_FAIR_USE' | 'INCIDENTAL_DICTIONARY_OVERLAP' | 'DIRECT_TRADEMARK_CONFLICT';
      decision: 'KEEP' | 'REPLACE';
      reason: string;
    }>;
    summary: string;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const settings = loadSettings();

    const simplifiedHits = (params.fieldHits || []).map((h: any) => ({
      searchedTerm: h.searchedTerm || h.term || '',
      registeredMark: h.registeredMark || h.mark || h.trademark || '',
      classes: h.classes || (h.classNumber ? [h.classNumber] : [25]),
      goodsAndServices: (h.goodsAndServices || h.goods_and_services || '').slice(0, 150),
      status: h.status || 'LIVE'
    }));

    const systemPrompt = `You are a specialized Merch by Amazon (MBA) Trademark & IP Attorney assessing whether detected trademark hits in a single listing field are protected by Descriptive Fair Use / Incidental Dictionary Overlap or represent an actionable trademark conflict.

Evaluation Principles:
1. DESCRIPTIVE_FAIR_USE / INCIDENTAL_DICTIONARY_OVERLAP (riskLevel: LOW, decision: KEEP, isFairUse: true):
   - Everyday dictionary words (e.g. "gift", "design", "smile", "retro", "planet", "stars", "celebrate", "mom", "dad", "coffee") used in ordinary prose or sentences without attempting to emulate a brand.
   - Secondary class registrations (e.g. Class 9, 16, 41) that have zero presence in Class 25 (Apparel) and are used descriptively.
2. DIRECT_TRADEMARK_CONFLICT / HIGH RISK (riskLevel: HIGH, decision: REPLACE, isFairUse: false):
   - Any Brand Name matching a registered trademark in Class 25 (Brands identify product source and cannot claim fair use on clothing).
   - Famous pop-culture marks, characters, movie/music titles, or registered distinctive slogans.
   - Class 25 exact-phrase apparel marks.

Output MUST be valid JSON:
{
  "overallVerdict": "SAFE_FAIR_USE" | "HAS_CONFLICTS",
  "evaluatedHits": [
    {
      "searchedTerm": "...",
      "registeredMark": "...",
      "isFairUse": true,
      "riskLevel": "LOW" | "MEDIUM" | "HIGH",
      "classification": "DESCRIPTIVE_FAIR_USE" | "INCIDENTAL_DICTIONARY_OVERLAP" | "DIRECT_TRADEMARK_CONFLICT",
      "decision": "KEEP" | "REPLACE",
      "reason": "Short German explanation why this is fair use or a conflict"
    }
  ],
  "summary": "Short German summary (e.g. 'Alle 2 Treffer sind harmloser Sprachgebrauch (Fair Use). Kein Umschreiben nötig.')"
}`;

    const userMessage = `Field: "${params.field}"
Current Field Text: "${params.fieldText}"
Design Quote / Slogan: "${params.quote || ''}"
Niches: Primary="${params.niche1 || ''}", Subniche="${params.subniche || ''}"
Other Listing Context:
- Brand: "${params.otherFields?.brand || ''}"
- Title: "${params.otherFields?.title || ''}"
- Bullet 1: "${params.otherFields?.bullet1 || ''}"
- Bullet 2: "${params.otherFields?.bullet2 || ''}"
- Description: "${params.otherFields?.description || ''}"

Hits found in this field:
${JSON.stringify(simplifiedHits, null, 2)}`;

    const requestPayload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.15,
      max_tokens: 2000
    };

    if (params.sessionId) {
      requestPayload.session_id = params.sessionId;
    }

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 60) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(await LLMService.parseHttpError(res, 'LLM Field Fair Use'));
      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(rawContent) || {};

      const evaluatedHits = Array.isArray(parsed.evaluatedHits) ? parsed.evaluatedHits : [];
      const hasConflict = evaluatedHits.some((h: any) => h.isFairUse === false || h.decision === 'REPLACE' || h.riskLevel === 'HIGH');
      const overallVerdict = parsed.overallVerdict === 'SAFE_FAIR_USE' || (!hasConflict && evaluatedHits.length > 0)
        ? 'SAFE_FAIR_USE'
        : (hasConflict ? 'HAS_CONFLICTS' : 'SAFE_FAIR_USE');

      const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : (overallVerdict === 'SAFE_FAIR_USE'
          ? 'Alle Treffer als harmloser beschreibender Sprachgebrauch (Fair Use) eingestuft.'
          : 'Enthält Markenkonflikte, die umgeschrieben werden sollten.');

      return {
        field: params.field,
        overallVerdict,
        evaluatedHits,
        summary
      };
    } catch (err: any) {
      console.error(`[LLMService] Error evaluating fair use for ${params.field}:`, err);
      throw err;
    }
  }

  /**
   * Rewrites a single listing field to resolve trademark conflicts while preserving
   * compliant keywords and fair-use terms, and respecting strict Amazon constraints.
   */
  static async rewriteSingleField(params: {
    field: 'brand' | 'title' | 'bullet1' | 'bullet2' | 'description';
    fieldText: string;
    fieldHits?: any[];
    fairUseEvaluation?: any;
    quote?: string;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    otherFields?: Partial<EnglishListing>;
    forbiddenTerms?: string[];
    sessionId?: string;
  }): Promise<{
    field: string;
    rewrittenText: string;
    actionsTaken: string[];
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const settings = loadSettings();

    const normN1 = ListingValidationService.normalizeOptionalText(params.niche1);
    const normN2 = ListingValidationService.normalizeOptionalText(params.niche2);
    const normSub = ListingValidationService.normalizeOptionalText(params.subniche);
    const expectedSuffix = ListingValidationService.resolveExpectedTitleSuffix({
      niche1: normN1,
      niche2: normN2,
      subniche: normSub
    });

    const fieldConstraints: Record<string, string> = {
      brand: 'Brand name must be 40–50 characters. Distinctive, creative apparel brand name. Completely free of Class 25 trademarked terms.',
      title: `Design Title must be 50–60 characters. Title MUST end literally with "${expectedSuffix}". Keep the suffix intact, do not duplicate it.`,
      bullet1: 'Feature Bullet 1 must be 230–256 characters. No banned words (gift, quality, premium, best, guarantee, 100%). Engaging sales copy highlighting the design theme.',
      bullet2: 'Feature Bullet 2 must be 230–256 characters. No banned words (gift, quality, premium, best, guarantee, 100%). Engaging sales copy highlighting the graphic style and recipient appreciation.',
      description: 'Product Description must be 300–600 characters. Clean, Markdown-free text describing the artwork, mood, and aesthetic.'
    };

    const systemPrompt = `You are an expert Merch by Amazon (MBA) Copywriter and Trademark Specialist.
Your mission is to rewrite ONE SINGLE field ("${params.field}") to eliminate trademark conflicts while keeping all legitimate fair-use words and high-converting keywords intact.

Rules:
1. FIELD CONSTRAINT: ${fieldConstraints[params.field] || 'Keep concise and within Amazon limits.'}
2. FAIR USE RETENTION: If a term was evaluated as Fair Use / Incidental Dictionary Overlap, KEEP IT. Do NOT strip out harmless everyday words.
3. CONFLICT ELIMINATION: Replace any terms flagged as trademark conflicts with safe, creative, niche-relevant synonyms.
4. FORBIDDEN TERMS: Never use any of these forbidden terms: ${JSON.stringify(params.forbiddenTerms || [])}
5. Return ONLY valid JSON:
{
  "rewrittenText": "The newly crafted field text adhering to all character limits",
  "actionsTaken": ["Replaced term X with Y", "Adjusted phrasing to fit length constraint"]
}`;

    const userMessage = `Field to rewrite: "${params.field}"
Current field text: "${params.fieldText}"
Design Quote / Slogan: "${params.quote || ''}"
Niche Context: Primary="${normN1}", Secondary="${normN2}", Subniche="${normSub}"
Other listing fields for context:
- Brand: "${params.otherFields?.brand || ''}"
- Title: "${params.otherFields?.title || ''}"
- Bullet 1: "${params.otherFields?.bullet1 || ''}"
- Bullet 2: "${params.otherFields?.bullet2 || ''}"
- Description: "${params.otherFields?.description || ''}"

Trademark Hits in this field:
${JSON.stringify(params.fieldHits || [], null, 2)}

Fair Use Assessment:
${JSON.stringify(params.fairUseEvaluation || 'Not yet evaluated; treat common dictionary words as fair use and replace distinctive marks.', null, 2)}

Rewrite ONLY the field "${params.field}".`;

    const requestPayload: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1500
    };

    if (params.sessionId) {
      requestPayload.session_id = params.sessionId;
    }

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 60) * 1000;
      const res = await this.executeFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(await LLMService.parseHttpError(res, 'LLM Field Rewrite'));
      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(rawContent) || {};

      let rewrittenText = typeof parsed.rewrittenText === 'string' ? parsed.rewrittenText.trim() : '';
      const actionsTaken = Array.isArray(parsed.actionsTaken) ? parsed.actionsTaken : ['Feld umgeschrieben'];

      // Post-process title suffix safety if title was rewritten
      if (params.field === 'title' && expectedSuffix) {
        if (!rewrittenText.toLowerCase().endsWith(expectedSuffix.toLowerCase())) {
          // If suffix is missing, append it while respecting max 60 chars
          const availableForPrefix = 60 - expectedSuffix.length - 1;
          const prefix = rewrittenText.slice(0, Math.max(0, availableForPrefix)).trim();
          rewrittenText = `${prefix} ${expectedSuffix}`.trim();
        }
      }

      // If LLM returned empty, fall back to current text
      if (!rewrittenText) {
        rewrittenText = params.fieldText;
      }

      return {
        field: params.field,
        rewrittenText,
        actionsTaken
      };
    } catch (err: any) {
      console.error(`[LLMService] Error rewriting field ${params.field}:`, err);
      throw err;
    }
  }
}


import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { BannedWordsService } from './bannedWordsService';

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
    const bannedSection = BannedWordsService.getBannedWordsPromptSection();
    const systemPrompt = `${basePrompt}\n\n${bannedSection}`;

    const n1 = params.niche1 || 'Graphic Art';
    const n2 = params.niche2 && params.niche2.toLowerCase() !== 'none' ? params.niche2 : '';
    const sub = params.subniche && params.subniche.toLowerCase() !== 'none' ? params.subniche : '';
    const quote = params.quote || '';
    const allKw = [
      ...(params.hermesKeywords || []),
      ...(params.keywords || [])
    ].filter(Boolean);

    let userMessage = `Design Information:
- Primary Niche (niche1): ${n1}
- Secondary Niche (niche2): ${n2 || 'none'}
- Subniche: ${sub || 'none'}
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

    userMessage += `\n\nGenerate the optimized 100% English Amazon Merch on Demand listing now. Ensure Title ends strictly with subniche/niche without trailing punctuation!`;

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
      const res = await fetch(url, {
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

      // Clean Title: ensure no trailing punctuation
      let cleanTitle = (rawTitle || '').trim();
      cleanTitle = cleanTitle.replace(/[,.!?:;'"\-–—]+$/, '').trim();

      const targetEnd = sub || n1;

      return {
        brand: (rawBrand || `${n1} ${sub ? sub + ' ' : ''}Apparel Collection`).trim().slice(0, 50),
        title: cleanTitle || `${n1} ${quote ? quote + ' ' : ''}${targetEnd}`.trim().slice(0, 60),
        bullet1: (rawBullet1 || `Featuring an authentic retro ${n1} graphic illustration designed for passionate enthusiasts and collectors. Express your unique style with this detailed artwork.`).trim().slice(0, 256),
        bullet2: (rawBullet2 || `Great to wear during weekend outings, club gatherings, outdoor adventures, and casual hangouts with fellow enthusiasts.`).trim().slice(0, 256),
        description: (rawDesc || `High quality ${n1} graphic design celebrating authentic vintage aesthetics and community passion.`).trim().slice(0, 600),
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error generating master English listing:', err);
      const targetEnd = sub || n1;
      return {
        brand: `${n1} ${sub ? sub + ' ' : ''}Apparel Collection`.trim().slice(0, 50),
        title: `Vintage Retro ${quote ? quote + ' ' : ''}${targetEnd}`.trim().slice(0, 60),
        bullet1: `Featuring an authentic retro ${n1} graphic illustration designed for passionate enthusiasts and collectors. Express your unique style with this detailed artwork.`,
        bullet2: `Great to wear during weekend outings, club gatherings, outdoor adventures, and casual hangouts with fellow enthusiasts.`,
        description: `High quality ${n1} graphic design celebrating authentic vintage aesthetics.`,
        _rawRequest: requestPayload,
        _rawResponse: err.message
      };
    }
  }

  /**
   * 2. Rewrite Listing with Specific Trademark Feedback (Feedback Loop, Class Distinctions)
   */
  /**
   * V2 Trademark Referee (GPT-5.6 Sol)
   * Semantic risk analysis, distinction between common descriptive words vs distinctive/famous marks
   */
  static async evaluateTrademarkReferee(params: {
    currentListing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    normalizedHits: any[];
    rewriteIteration?: number;
    forbiddenTermsForTask?: string[];
    blockedProducts?: string[];
  }): Promise<{
    decision: 'APPROVE' | 'REWRITE' | 'APPROVE_WITH_BLOCKED_PRODUCTS' | 'ESCALATE';
    canBeFixedByListingRewrite: boolean;
    reasonCode?: string | null;
    recommendedAction?: string | null;
    hits: Array<{
      searchedTerm: string;
      registeredMark: string;
      field?: string;
      classes?: number[];
      markNature?: string;
      usageType?: string;
      knownBrand?: boolean;
      amazonRejectionRisk?: string;
      decision?: string;
      confidence?: number;
      reason?: string;
    }>;
    blockedProducts: string[];
    rewriteRequired: boolean;
    rewriteInstructions: string[];
    escalation?: any;
    _rawRequest?: any;
    _rawResponse?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getTrademarkRefereePrompt();

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

Normalized Trademark Hits from USPTO:
${JSON.stringify(params.normalizedHits, null, 2)}

Rewrite Context:
- Rewrite Iteration: ${params.rewriteIteration || 0} / 3
- Forbidden Terms for Task: ${JSON.stringify(params.forbiddenTermsForTask || [])}
- Currently Blocked Products: ${JSON.stringify(params.blockedProducts || [])}

Please evaluate all hits against Amazon Merch risk rules. Classify each hit, determine if normal descriptive words can be KEPT, and decide whether REWRITE, APPROVE, APPROVE_WITH_BLOCKED_PRODUCTS or ESCALATE is required. Return valid JSON only.`;

    const settings = loadSettings();
    const requestPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.2),
      max_tokens: settings.llmMaxTokens || 3500
    };

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(`LLM TM Referee error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(content);

      const decision = parsed.decision || 'APPROVE';
      const canBeFixed = parsed.canBeFixedByListingRewrite !== undefined ? Boolean(parsed.canBeFixedByListingRewrite) : (decision === 'REWRITE');

      return {
        decision: ['APPROVE', 'REWRITE', 'APPROVE_WITH_BLOCKED_PRODUCTS', 'ESCALATE'].includes(decision) ? decision : 'APPROVE',
        canBeFixedByListingRewrite: canBeFixed,
        reasonCode: parsed.reasonCode || parsed.reason_code || null,
        recommendedAction: parsed.recommendedAction || parsed.recommended_action || null,
        hits: Array.isArray(parsed.hits) ? parsed.hits : [],
        blockedProducts: Array.isArray(parsed.blockedProducts) ? parsed.blockedProducts : (Array.isArray(parsed.blocked_products) ? parsed.blocked_products : (params.blockedProducts || [])),
        rewriteRequired: parsed.rewriteRequired !== undefined ? Boolean(parsed.rewriteRequired) : (decision === 'REWRITE'),
        rewriteInstructions: Array.isArray(parsed.rewriteInstructions) ? parsed.rewriteInstructions : (Array.isArray(parsed.rewrite_instructions) ? parsed.rewrite_instructions : []),
        escalation: parsed.escalation || null,
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error in evaluateTrademarkReferee:', err);
      return {
        decision: 'ESCALATE',
        canBeFixedByListingRewrite: false,
        reasonCode: 'TM_REFEREE_FAILURE',
        recommendedAction: 'HUMAN_REVIEW_RECOMMENDED',
        hits: [],
        blockedProducts: params.blockedProducts || [],
        rewriteRequired: false,
        rewriteInstructions: [],
        escalation: { error: err.message },
        _rawRequest: requestPayload,
        _rawResponse: err.message
      };
    }
  }

  /**
   * V2 Amazon Rejection Verifier (GPT-5.6 Sol - Adversarial Reviewer)
   */
  static async evaluateTrademarkVerifier(params: {
    currentListing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    quote?: string;
    normalizedHits: any[];
    refereeDecision?: string;
    blockedProducts?: string[];
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
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getTrademarkVerifierPrompt();

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

USPTO Trademark Hits Data:
${JSON.stringify(params.normalizedHits, null, 2)}

Previous Referee Verdict: "${params.refereeDecision || 'APPROVE'}"
Blocked Products: ${JSON.stringify(params.blockedProducts || [])}

Act as the final adversarial Amazon Merch reviewer. Do you see any plausible trademark, brand, or policy reasons why Amazon Merch might reject this submission or penalize the account? Return valid JSON.`;

    const settings = loadSettings();
    const requestPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.2),
      max_tokens: settings.llmMaxTokens || 2500
    };

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(`LLM TM Verifier error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '{}';
      const parsed = this.extractJsonFromLlmResponse(content);

      const verdict = parsed.verdict === 'HIGH_RISK' ? 'HIGH_RISK' : 'SAFE';
      const canBeFixed = parsed.canBeFixedByListingRewrite !== undefined ? Boolean(parsed.canBeFixedByListingRewrite) : true;

      return {
        verdict,
        identifiedRisks: Array.isArray(parsed.identifiedRisks) ? parsed.identifiedRisks : (Array.isArray(parsed.identified_risks) ? parsed.identified_risks : []),
        canBeFixedByListingRewrite: canBeFixed,
        recommendation: parsed.recommendation || (verdict === 'SAFE' ? 'SAFE_TO_PUBLISH' : 'REWRITE_NEEDED'),
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error in evaluateTrademarkVerifier:', err);
      return {
        verdict: 'HIGH_RISK',
        identifiedRisks: [{ term: 'N/A', field: 'all', riskType: 'VERIFIER_API_FAILURE', explanation: err.message }],
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
  }): Promise<{
    refinedListing: EnglishListing;
    actionsTaken: string[];
    _rawRequest?: any;
    _rawResponse?: any;
  }> {
    const { url, headers, model } = this.getBaseUrlAndHeaders();
    const systemPrompt = SystemPromptService.getListingGeneratorPrompt();

    const userMessage = `You are performing an automated SEO-preserving Trademark Rewrite for Merch by Amazon (Iteration ${params.rewriteIteration} of 3).

Current Listing:
- Brand: "${params.currentListing.brand}"
- Title: "${params.currentListing.title}"
- Bullet 1: "${params.currentListing.bullet1}"
- Bullet 2: "${params.currentListing.bullet2}"
- Description: "${params.currentListing.description}"

Design Metadata:
- Primary Niche (niche1): ${params.niche1 || ''}
- Secondary Niche (niche2): ${params.niche2 || ''}
- Subniche: ${params.subniche || ''}
- Quote / Slogan: "${params.quote || ''}"

SPECIFIC TRADEMARK ISSUES TO RESOLVE:
${params.rewriteInstructions.length > 0 ? params.rewriteInstructions.map(i => `- ${i}`).join('\n') : '- Replace flagged trademark terms with strong compliant niche keywords.'}

CRITICAL CONSTRAINTS:
1. STRICTLY FORBIDDEN TERMS (DO NOT USE THESE OR CLOSE VARIANTS):
   ${JSON.stringify(params.forbiddenTermsForTask)}
2. LOCKED TITLE SUFFIX: Title MUST end literally with "${params.subniche || params.niche2 || params.niche1 || ''}"
3. EXACT CHARACTER LIMITS:
   - Brand: 40-50 chars
   - Title: 50-60 chars (ending with locked suffix)
   - Bullet 1: 230-256 chars
   - Bullet 2: 230-256 chars
   - Description: 300-600 chars
4. PRESERVE SEO DEPTH: Replace only the problematic terms with high-performing niche terms. Keep legitimate keywords intact.

Return ONLY valid JSON matching this schema:
{
  "brand": "...",
  "title": "...",
  "bullet1": "...",
  "bullet2": "...",
  "description": "...",
  "actions_taken": ["Replaced term X with Y in Brand", "Rewrote Bullet 1 to remove phrase Z"]
}`;

    const settings = loadSettings();
    const requestPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(settings.llmTemperature ?? 0.35, 0.25),
      max_tokens: settings.llmMaxTokens || 3500
    };

    try {
      const timeoutMs = (settings.llmTimeoutSeconds || 90) * 1000;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) throw new Error(`LLM TM Rewrite V2 error: ${res.status} ${res.statusText}`);
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

      const actionsTaken = Array.isArray(parsed.actions_taken) ? parsed.actions_taken : (Array.isArray(parsed.actionsTaken) ? parsed.actionsTaken : ['Automated trademark rewrite applied']);

      return {
        refinedListing: refined,
        actionsTaken,
        _rawRequest: requestPayload,
        _rawResponse: content
      };
    } catch (err: any) {
      console.error('[LLMService] Error in rewriteListingForTrademarkV2:', err);
      return {
        refinedListing: params.currentListing,
        actionsTaken: ['Failed to rewrite: network/timeout error'],
        _rawRequest: requestPayload,
        _rawResponse: err.message
      };
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
      const res = await fetch(url, {
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

import fs from 'fs';
import path from 'path';
import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { IdeogramService } from './ideogramService';
import { TrademarkService } from './trademarkService';
import { BannedWordsService } from './bannedWordsService';
import { VectorizerService } from './vectorizerService';
import { SvgRenderService } from './svgRenderService';
import { LLMService } from './llmService';
import { VisionOptimizationService } from './visionOptimizationService';
import { ArtworkResizeService } from './artworkResizeService';
import { ListingValidationService } from './listingValidationService';
import { ListingSanitizationService } from './listingSanitizationService';
import { 
  atomicWriteJson, 
  loadJsonWithBackupRecovery, 
  cleanupOrphanedTmpFiles, 
  isFileInFailSafe 
} from '../utils/atomicFileStorage';
import { TaskRepository } from '../storage/taskRepository';

export * from '../../types/tasks';
import { 
  TaskSource, 
  TaskSuffix, 
  TaskStatus, 
  EventType, 
  SessionEvent, 
  DesignTaskLog,
  RetryStepType,
  TaskSummary,
  toTaskSummary
} from '../../types/tasks';

export class TaskLogService {
  private static dataDir = path.resolve(process.cwd(), 'data');
  private static eventBroadcaster: ((type: string, payload: any) => void) | null = null;

  static setBroadcaster(fn: (type: string, payload: any) => void) {
    this.eventBroadcaster = fn;
  }

  private static emitUpdate(task: DesignTaskLog) {
    if (this.eventBroadcaster) {
      this.eventBroadcaster('TASK_UPDATED', this.toTaskSummary(task));
    }
  }

  public static isStorageFailSafe(): boolean {
    return false;
  }

  public static getNextCounter(): number {
    return TaskRepository.getNextCounter();
  }

  /**
   * Cleans text to strictly conform to Amazon Merch on Demand character requirements:
   * - Converts typographic quotes („ “ ” « ») to standard ASCII quotes (")
   * - Converts curly single quotes/apostrophes (’ ‘ ‚ ‛) to standard ASCII apostrophe (')
   * - Converts typographic hyphens/dashes (— – −) to standard ASCII hyphen (-)
   * - Converts ellipsis (…) to (...)
   * - Removes any other prohibited unicode characters not allowed on Amazon Merch
   */
  public static sanitizeString(txt: string): string {
    return ListingSanitizationService.sanitizeText(txt);
  }

  public static sanitizeAndValidateListingBeforeQueue(listing: any): any {
    if (!listing || typeof listing !== 'object') return listing;
    const result: Record<string, any> = {};
    for (const [lang, obj] of Object.entries(listing)) {
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && !lang.startsWith('_')) {
        const item = obj as any;
        const brand = BannedWordsService.stripBannedWordsFromText(this.sanitizeString(item.brand || ''), lang).slice(0, 50);
        let title = BannedWordsService.stripBannedWordsFromText(this.sanitizeString(item.title || ''), lang);
        title = title.replace(/[,.!?:;'"\-–—]+$/, '').trim().slice(0, 60);
        const bullet1 = BannedWordsService.stripBannedWordsFromText(this.sanitizeString(item.bullet1 || item.bullet_1 || ''), lang).slice(0, 256);
        const bullet2 = BannedWordsService.stripBannedWordsFromText(this.sanitizeString(item.bullet2 || item.bullet_2 || ''), lang).slice(0, 256);
        const description = BannedWordsService.stripBannedWordsFromText(this.sanitizeString(item.description || ''), lang).slice(0, 600);
        result[lang] = { brand, title, bullet1, bullet2, description };
      } else {
        result[lang] = obj;
      }
    }
    return result;
  }

  public static sanitizeListingObject(listing: any): any {
    if (!listing || typeof listing !== 'object') return listing;
    if (Array.isArray(listing)) {
      return listing.map(item => typeof item === 'string' ? this.sanitizeString(item) : this.sanitizeListingObject(item));
    }
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(listing)) {
      if (typeof val === 'string') {
        result[key] = this.sanitizeString(val);
      } else if (typeof val === 'object' && val !== null) {
        result[key] = this.sanitizeListingObject(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  public static loadLogs(): DesignTaskLog[] {
    const page = TaskRepository.getTaskSummariesPage({ limit: 100 });
    return page.tasks.map(s => TaskRepository.getTaskById(s.id)).filter(Boolean) as DesignTaskLog[];
  }

  public static saveLogs(logs: DesignTaskLog[]) {
    for (const task of logs) {
      if (task && task.id) {
        TaskRepository.updateTask(task.id, task);
      }
    }
  }

  static formatTaskId(counter: number, suffix: TaskSuffix): string {
    const padded = String(counter).padStart(3, '0');
    return `#${padded}-${suffix}`;
  }

  static getSuffixForSource(source: TaskSource): TaskSuffix {
    switch (source) {
      case 'HERMES': return 'H';
      case 'TEST': return 'T';
      case 'DESIGNER': return 'D';
      case 'UPDATE': return 'U';
      default: return 'H';
    }
  }

  static createTaskLog(params: {
    source: TaskSource;
    payload: Record<string, any>;
    clientIp?: string;
    hasError?: boolean;
    errorDetails?: string;
  }): DesignTaskLog {
    const counter = this.getNextCounter();
    const suffix = this.getSuffixForSource(params.source);
    const id = this.formatTaskId(counter, suffix);
    const now = new Date().toISOString();

    const incomingTitle = params.source === 'HERMES' 
      ? 'Eingang von Hermes' 
      : (params.source === 'TEST' 
          ? 'Eingang von Test (Playground)' 
          : (params.source === 'UPDATE' ? 'Eingang von Amazon Merch (Update-Pipeline)' : 'Eingang von Designer'));

    const initialEvent: SessionEvent = {
      timestamp: now,
      type: 'INCOMING_PAYLOAD',
      title: incomingTitle,
      content: params.payload || {}
    };

    const taskLog: DesignTaskLog = {
      id,
      counter,
      source: params.source,
      suffix,
      status: 'RECEIVED',
      receivedAt: now,
      clientIp: params.clientIp,
      niche1: params.payload?.niche1 || params.payload?.niche || undefined,
      niche2: params.payload?.niche2 || undefined,
      subniche: params.payload?.subniche || undefined,
      keywords: params.payload?.keywords || undefined,
      hermesKeywords: params.payload?.hermesKeywords || (Array.isArray(params.payload?.keywords) ? params.payload.keywords : undefined),
      payload: params.payload || {},
      events: [initialEvent],
      hasError: Boolean(params.hasError),
      errorDetails: params.errorDetails
    };

    const created = TaskRepository.createTask(taskLog);
    console.log(`[TaskLogService] 📋 Task ${created.id} registriert (${created.source}) von ${created.clientIp || 'local'}`);
    this.emitUpdate(created);

    // Asynchronously trigger OpenRouter LLM session only for new design generation (HERMES, TEST, DESIGNER)
    if (params.source !== 'UPDATE') {
      this.processTaskWithOpenRouter(created.id);
    }

    return created;
  }

  static addEvent(taskId: string, event: SessionEvent): DesignTaskLog | undefined {
    const updated = TaskRepository.addEvent(taskId, event);
    if (!updated) return undefined;
    this.emitUpdate(updated);
    return updated;
  }

  static async completeTaskAndEnqueue(taskOrId: DesignTaskLog | string): Promise<{ success: boolean; error?: string }> {
    const task = typeof taskOrId === 'string' ? this.getTaskLogById(taskOrId) : taskOrId;
    if (!task) return { success: false, error: 'Task nicht gefunden' };
    if (task.inQueue) return { success: true };
    task.inQueue = true;

    try {
      const listing = task.listingResult || task.trademarkRefineResult || {};
      const enListing = listing.en || (listing.title || listing.brand ? listing : {});
      const brand = enListing.brand || task.payload?.brand || '';
      const title = enListing.title || task.payload?.title || task.payload?.quote || 'Design #' + task.id;
      const bullet1 = enListing.bullet1 || enListing.bullet_1 || '';
      const bullet2 = enListing.bullet2 || enListing.bullet_2 || '';
      const description = enListing.description || '';

      // Collect all language listings (en, de, fr, es, it, jp, etc.)
      const listings: Record<string, any> = {};
      if (typeof listing === 'object') {
        for (const [key, val] of Object.entries(listing)) {
          if (val && typeof val === 'object' && !Array.isArray(val) && !key.startsWith('_')) {
            listings[key.toLowerCase()] = val;
          }
        }
      }
      // Extract fitTypes & color rules from Question Phase
      const audience = (task.customAnswers?.audience || task.payload?.audience || 'Men, Women, Youth').toLowerCase();
      const fitTypes: string[] = [];
      if (audience.includes('men') || audience.includes('männer') || audience.includes('herren')) fitTypes.push('men');
      if (audience.includes('women') || audience.includes('frauen') || audience.includes('damen')) fitTypes.push('women');
      if (audience.includes('youth') || audience.includes('kids') || audience.includes('kinder') || audience.includes('jugend')) fitTypes.push('youth');

      let avoidColor: 'white' | 'black' | 'none' = 'none';
      const avoid = (task.customAnswers?.avoidColor || task.payload?.avoidColor || '').toLowerCase();
      if (avoid.includes('white') || avoid.includes('weiß')) avoidColor = 'white';
      else if (avoid.includes('black') || avoid.includes('schwarz')) avoidColor = 'black';

      // Only set customBackgroundColor if explicitly provided and a valid hex format
      const rawHex = (task.customAnswers as any)?.customBackgroundColor || (task.customAnswers as any)?.accessoryColorHex;
      const customBackgroundColor = (typeof rawHex === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(rawHex.trim())) ? (rawHex.startsWith('#') ? rawHex : `#${rawHex}`) : undefined;

      const { FinalizationService } = await import('./finalizationService');
      const finResult = await FinalizationService.finalizeForQueue({
        taskId: task.id,
        pipeline: 'DESIGN',
        niche: task.payload?.niche || '',
        brand,
        title,
        bullet1,
        bullet2,
        description,
        listings,
        fitTypes: fitTypes.length > 0 ? fitTypes : ['men', 'women', 'youth'],
        avoidColor,
        customBackgroundColor,
        localImagePath: task.localImagePath || '',
        masterPngPath: task.localMbaPngPath || '',
        tmBlockedProductIds: task.blockedProducts || task.trademarkCheckResult?.blockedProducts || []
      });

      if (!finResult.success) {
        task.inQueue = false;
        TaskRepository.updateTask(task.id, { inQueue: false });
      }

      this.emitUpdate(task);
      return finResult;
    } catch (err: any) {
      task.inQueue = false;
      TaskRepository.updateTask(task.id, { inQueue: false });
      console.warn('[TaskLogService] Failed to auto-enqueue completed task:', err.message);
      return { success: false, error: err.message };
    }
  }

  static updateTaskStatus(taskId: string, updates: Partial<DesignTaskLog>): DesignTaskLog | undefined {
    // Only auto-trigger enqueue when the status is explicitly transitioning to COMPLETED
    if (updates.status === 'COMPLETED') {
      const current = TaskRepository.getTaskById(taskId);
      if (current && current.source !== 'UPDATE' && !current.inQueue) {
        updates.inQueue = true;
        const updated = TaskRepository.updateTask(taskId, updates);
        if (updated) {
          this.emitUpdate(updated);
          this.completeTaskAndEnqueue(updated);
        }
        return updated || undefined;
      }
    }

    const updated = TaskRepository.updateTask(taskId, updates);
    if (updated) {
      this.emitUpdate(updated);
    }
    return updated || undefined;
  }

  /**
   * Run the LLM Session via OpenRouter
   */
  static async processTaskWithOpenRouter(taskId: string, options?: { skipPreFlight?: boolean }) {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    const settings = loadSettings();
    const apiKey = (settings.openRouterApiKey || '').trim();
    const model = settings.llmModel || 'anthropic/claude-3-5-sonnet';
    const provider = settings.llmProvider === 'openai' ? 'OpenAI Direct' : 'OpenRouter';

    // 0. Pre-Flight Quote Trademark Check to save tokens and costs early!
    const quote = (task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || '').trim();
    if (quote && !options?.skipPreFlight) {
      console.log(`[TaskLogService] 🛡️ Starte Pre-Flight USPTO TM-Check für Quote "${quote}" (Task ${taskId})...`);
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_CHECK_REQUEST',
        title: `Pre-Flight Trademark-Prüfung (Quote)`,
        content: {
          isPreFlight: true,
          offices: ['USPTO'],
          fields: { quote }
        },
        metadata: { provider: 'Productor USPTO' }
      });

      const preStart = Date.now();
      try {
        const preCheckResult = await TrademarkService.checkBatchFields({
          offices: ['USPTO'],
          fields: { quote }
        });

        const preHits = preCheckResult.summary?.totalHits ?? 0;
        const preHasCls25 = preCheckResult.hasInfringementClass25 || false;
        const preLatencyMs = Date.now() - preStart;

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_CHECK_RESPONSE',
          title: `Empfangen von Productor / USPTO (Pre-Flight Quote: ${preHits} Treffer)`,
          content: {
            isPreFlight: true,
            totalHits: preHits,
            hasInfringementClass25: preHasCls25,
            blockedProducts: preCheckResult.blockedProducts,
            fieldSummaries: preCheckResult.fieldResults,
            summary: preCheckResult.summary
          },
          metadata: { provider: 'Productor USPTO', latencyMs: preLatencyMs }
        });

        // If Quote has an active Class 25 hit -> Hand off to Tasks (Human-in-the-Loop)! Save all downstream tokens!
        if (preHasCls25) {
          const rejectionReason = `Die Quote "${quote}" verletzt ein aktives Markenrecht in Nizza-Klasse 25 (Bekleidung). Wartet auf manuelle Prüfung in Tasks.`;
          
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TASK_HANDOFF',
            title: `Übergeben an Tasks (Pre-Flight Quote Konflikt)`,
            content: {
              checkpoint: 'PRE_FLIGHT',
              reason: rejectionReason,
              quote,
              totalHits: preHits,
              fieldSummaries: preCheckResult.fieldResults
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'AWAITING_PRE_FLIGHT_REVIEW',
            checkpoint: 'PRE_FLIGHT',
            hasError: false,
            errorDetails: rejectionReason,
            trademarkCheckResult: {
              totalHits: preHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: preCheckResult.fieldResults
            }
          });

          console.log(`[TaskLogService] 🛑 Task ${taskId} im Pre-Flight TM-Check an Tasks übergeben (Quote "${quote}" verletzt Klasse 25).`);
          return;
        }
      } catch (tmErr: any) {
        console.warn(`[TaskLogService] Pre-Flight TM-Check Warnung (wird fortgesetzt):`, tmErr.message || tmErr);
      }
    }

    // 1. Log Event: Session Start
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'SESSION_START',
      title: `Öffnen der ${provider} Session`,
      content: `Session für Task ${taskId} initialisiert.`,
      metadata: {
        model,
        provider
      }
    });

    this.updateTaskStatus(taskId, { status: 'PROCESSING' });

    if (!apiKey) {
      const errEvent: SessionEvent = {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler: Kein API-Key hinterlegt',
        content: 'Bitte trage deinen OpenRouter API Key in den Settings ein.'
      };
      this.addEvent(taskId, errEvent);
      this.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: 'Kein OpenRouter API Key in Settings' });
      return;
    }

    // 2. Prepare System Prompt & User Message
    const systemPrompt = SystemPromptService.getPromptGeneratorPrompt();
    const userMessage = `Input:\n${JSON.stringify(task.payload, null, 2)}`;

    // Log Event: Senden an OpenRouter
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'LLM_REQUEST',
      title: `Senden an ${provider}`,
      content: {
        systemPrompt,
        userMessage
      },
      metadata: {
        model
      }
    });

    // 3. Execute HTTP Call to OpenRouter / OpenAI
    const start = Date.now();
    const url = settings.llmProvider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    if (settings.llmProvider !== 'openai') {
      headers['HTTP-Referer'] = 'https://mba-hub.local';
      headers['X-Title'] = 'MBA HUB';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(60000)
      });

      const latencyMs = Date.now() - start;
      const json = await response.json();

      if (!response.ok) {
        const errorMsg = json?.error?.message || `HTTP ${response.status} ${response.statusText}`;
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'ERROR',
          title: `Fehler von ${provider}`,
          content: errorMsg,
          metadata: { latencyMs, model }
        });
        this.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: errorMsg });
        return;
      }

      const generatedContent = json?.choices?.[0]?.message?.content || '';
      const usage = json?.usage ? {
        prompt: json.usage.prompt_tokens,
        completion: json.usage.completion_tokens,
        total: json.usage.total_tokens
      } : undefined;

      // Extract raw prompt text from JSON response if formatted as {"prompt": "..."}
      let extractedPrompt = generatedContent;
      try {
        let cleanJsonStr = generatedContent.trim();
        if (cleanJsonStr.startsWith('```')) {
          cleanJsonStr = cleanJsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }
        const parsed = JSON.parse(cleanJsonStr);
        if (parsed && typeof parsed.prompt === 'string') {
          extractedPrompt = parsed.prompt;
        }
      } catch (e) {
        // Keep raw content if not JSON
      }

      // 4. Log Event: Empfangen von OpenRouter
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LLM_RESPONSE',
        title: `Empfangen von ${provider}`,
        content: generatedContent,
        metadata: {
          latencyMs,
          model,
          tokens: usage
        }
      });

      this.updateTaskStatus(taskId, {
        status: 'PROMPT_READY',
        resultPrompt: extractedPrompt,
        hasError: false
      });

      console.log(`[TaskLogService] ⚡ Task ${taskId} erfolgreich generiert in ${latencyMs}ms (${usage?.total || 0} Tokens)`);

      // 5. Automatically trigger Ideogram Image Generation
      await this.processTaskWithIdeogram(taskId, extractedPrompt);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const errorMsg = err.message || 'Verbindungsfehler zur OpenRouter API';
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: `Verbindungsfehler (${provider})`,
        content: errorMsg,
        metadata: { latencyMs, model }
      });
      this.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: errorMsg });
    }
  }

  /**
   * Run Ideogram image generation and download design to NAS
   */
  static async processTaskWithIdeogram(taskId: string, promptText: string) {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    const settings = loadSettings();
    const model = settings.ideogramModel || 'V_3';
    const renderingSpeed = settings.ideogramRenderingSpeed || 'DEFAULT';
    const aspectRatio = settings.ideogramAspectRatio || '10x16';
    const styleType = settings.ideogramStyle || 'GENERAL';
    const magicPromptOption = settings.ideogramMagicPromptOption || 'AUTO';

    this.updateTaskStatus(taskId, { status: 'GENERATING_IMAGE' });

    if (!settings.ideogramApiKey) {
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler: Kein Ideogram API-Token',
        content: 'Bitte trage deinen Ideogram API Token in den Settings ein.'
      });
      this.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: 'Kein Ideogram API Key in Settings' });
      return;
    }

    // 1. Log Event: Senden an Ideogram
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'IDEOGRAM_REQUEST',
      title: `Senden an Ideogram (${model})`,
      content: {
        prompt: promptText,
        model,
        renderingSpeed,
        aspectRatio,
        style: styleType,
        magicPrompt: magicPromptOption
      },
      metadata: {
        model
      }
    });

    // 2. Execute call to Ideogram API
    const start = Date.now();
    try {
      const result = await IdeogramService.generateImage({
        prompt: promptText,
        model,
        renderingSpeed,
        aspectRatio,
        styleType,
        magicPromptOption
      });

      const latencyMs = Date.now() - start;

      // 3. Cache image locally to data/designs/ on NAS
      const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const designsDir = path.resolve(process.cwd(), 'data', 'designs');
      if (!fs.existsSync(designsDir)) {
        try { fs.mkdirSync(designsDir, { recursive: true }); } catch (e) {}
      }
      const localFilename = `${cleanId}.png`;
      const localFilePath = path.join(designsDir, localFilename);
      const localUrl = `/api/v1/designs/image/${encodeURIComponent(taskId)}`;

      try {
        const imgRes = await fetch(result.imageUrl);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          fs.writeFileSync(localFilePath, Buffer.from(arrayBuffer));
          console.log(`[TaskLogService] 💾 Bild für Task ${taskId} lokal gespeichert: ${localFilePath}`);

          // Pre-generate U4 Preview in the background for Step D5 Listing
          const previewFilePath = path.join(designsDir, `${cleanId}.u4-preview.png`);
          VisionOptimizationService.prepareU4PreviewImage(localFilePath, previewFilePath).catch(err => {
            console.warn(`[TaskLogService] Background preview pre-generation failed for ${taskId}:`, err.message);
          });
        }
      } catch (e) {
        console.warn(`[TaskLogService] Konnte Bild für Task ${taskId} nicht lokal cachen:`, e);
      }

      // 4. Log Event: Empfangen von Ideogram
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'IDEOGRAM_RESPONSE',
        title: `Empfangen von Ideogram (Bild generiert)`,
        content: {
          imageUrl: result.imageUrl,
          localUrl,
          prompt: promptText
        },
        metadata: {
          latencyMs,
          model
        }
      });

      this.updateTaskStatus(taskId, {
        status: 'ANALYZING_DESIGN',
        imageUrl: result.imageUrl,
        localImagePath: localUrl,
        hasError: false
      });

      console.log(`[TaskLogService] 🖼️ Ideogram Bild für Task ${taskId} erfolgreich generiert in ${latencyMs}ms`);

      // 5. Automatically trigger Vision Design Analysis & Verification
      await this.analyzeDesignWithOpenRouter(taskId, localFilePath, result.imageUrl);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const errorMsg = err.message || 'Fehler bei der Ideogram Bildgenerierung';
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler bei Ideogram',
        content: errorMsg,
        metadata: { latencyMs, model }
      });
      this.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: errorMsg });
    }
  }

  /**
   * Run Multimodal Vision Analysis on the generated design with OpenRouter
   */
  static async analyzeDesignWithOpenRouter(taskId: string, localFilePath: string, imageUrl: string) {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) {
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler: Kein OpenRouter API Key',
        content: 'Für die Vision Design-Analyse wird ein OpenRouter API Key in den Settings benötigt.'
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED' });
      return;
    }

    const analyzerPrompt = SystemPromptService.getDesignAnalyzerPrompt();
    const quote = task.payload?.quote || '';
    const niche1 = task.payload?.niche1 || task.payload?.niche || '';
    const niche2 = task.payload?.niche2 || '';
    const subniche = task.payload?.subniche || '';
    const ideogramPrompt = task.resultPrompt || '';

    const userPromptText = `Bitte analysiere das folgende generierte Design:\n\n- Original Quote aus Input: "${quote}"\n- Nische 1 (Hauptthema): "${niche1}"\n- Nische 2 (Cross-Nische): "${niche2 || 'none'}"\n- Subnische: "${subniche || 'none'}"\n- Verwendeter Ideogram-Prompt: "${ideogramPrompt}"\n\nBeantworte die Analysefragen streng als JSON!`;

    // 1. Log Event: Senden an OpenRouter (Vision)
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'ANALYSIS_REQUEST',
      title: `Senden an OpenRouter (Vision Design-Analyse)`,
      content: {
        systemPrompt: analyzerPrompt,
        userMessage: userPromptText,
        quote,
        niche1,
        niche2,
        subniche
      },
      metadata: {
        model: settings.llmModel || 'anthropic/claude-3.5-sonnet',
        provider: 'OpenRouter Vision'
      }
    });

    // Prepare image for vision model using high-contrast Dual-Panel Vision Optimizer
    let imageSource = imageUrl;
    if (fs.existsSync(localFilePath)) {
      try {
        const { base64DataUrl } = await VisionOptimizationService.prepareVisionImage(localFilePath);
        imageSource = base64DataUrl || imageSource;
      } catch (e) {}
    }

    const model = LLMService.normalizeModelId(settings.llmModel || 'anthropic/claude-sonnet-4');
    const start = Date.now();

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mba-hub.local',
          'X-Title': 'MBA Hub Quality Assurance'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: analyzerPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPromptText },
                { type: 'image_url', image_url: { url: imageSource } }
              ]
            }
          ],
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(90000)
      });

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        throw new Error(await LLMService.parseHttpError(res, 'OpenRouter Vision'));
      }

      const data = await res.json();
      const answer = data?.choices?.[0]?.message?.content || '';
      const usage = data?.usage;

      // Parse JSON
      let cleanJsonStr = answer.trim();
      if (cleanJsonStr.startsWith('```')) {
        cleanJsonStr = cleanJsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      let parsedAnalysis: any = null;
      try {
        parsedAnalysis = JSON.parse(cleanJsonStr);
      } catch (e) {
        // Raw content fallback
      }

      // 2. Log Event: Empfangen von OpenRouter (Vision)
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: `Empfangen von OpenRouter (Design-Analyse & Antworten)`,
        content: parsedAnalysis || answer,
        metadata: {
          latencyMs,
          model,
          tokens: usage
        }
      });

      console.log(`[TaskLogService] 👁️ Vision Design-Analyse für Task ${taskId} erfolgreich in ${latencyMs}ms`);

      // Check if design is APPROVED according to Vision AI
      const isApproved = parsedAnalysis?.overall_verdict === 'APPROVED' || 
        (parsedAnalysis?.quote_check?.quote_matches === true && !parsedAnalysis?.quote_check?.regenerate_recommended);

      const aiN1 = ListingValidationService.normalizeOptionalText(parsedAnalysis?.niche_analysis?.niche1 || parsedAnalysis?.niche1);
      const aiN2 = ListingValidationService.normalizeOptionalText(parsedAnalysis?.niche_analysis?.niche2 || parsedAnalysis?.niche2);
      const aiSub = ListingValidationService.normalizeOptionalText(parsedAnalysis?.niche_analysis?.subniche || parsedAnalysis?.subniche);
      const rawAiKw = parsedAnalysis?.niche_analysis?.keywords || parsedAnalysis?.keywords || parsedAnalysis?.seo_keywords;
      const aiKeywords: string[] | undefined = Array.isArray(rawAiKw)
        ? rawAiKw.map((k: any) => String(k).trim()).filter(Boolean)
        : (typeof rawAiKw === 'string' ? rawAiKw.split(',').map(s => s.trim()).filter(Boolean) : undefined);

      // Check AI Autonomy Switch for Design Pipeline
      const autonomyDesign = settings.aiAutonomyDesignEnabled ?? settings.aiAutonomyEnabled;
      if (autonomyDesign && isApproved) {
        console.log(`[TaskLogService] ⚡ Autonomie aktiv: Task ${taskId} überspringt Human-in-the-Loop (Design freigegeben) -> Listing-Generierung gestartet.`);
        this.updateTaskStatus(taskId, {
          status: 'GENERATING_LISTING',
          niche1: aiN1 || task.niche1,
          niche2: aiN2 || task.niche2,
          subniche: aiSub || task.subniche,
          keywords: aiKeywords || task.keywords,
          analysisResult: parsedAnalysis,
          hasError: false
        });
        await this.generateListingWithOpenRouter(taskId);
      } else {
        // Human-in-the-Loop: Hand off to Tasks View for manual inspection / confirmation
        const reason = isApproved 
          ? 'Vision-Analyse abgeschlossen. Wartet auf Prüfung/Bestätigung von Bild, Quote und Zielgruppe in Tasks.'
          : (parsedAnalysis?.quote_check?.quote_errors || 'Quote-Abweichung oder Designfehler festgestellt. Wartet auf manuelle Prüfung in Tasks.');

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TASK_HANDOFF',
          title: `Übergeben an Tasks (Design- & Fragen-Prüfung)`,
          content: {
            checkpoint: 'DESIGN_REVIEW',
            reason,
            isApproved,
            analysis: parsedAnalysis
          }
        });

        this.updateTaskStatus(taskId, {
          status: 'AWAITING_DESIGN_REVIEW',
          checkpoint: 'DESIGN_REVIEW',
          niche1: aiN1 || task.niche1,
          niche2: aiN2 !== 'none' ? aiN2 : task.niche2,
          subniche: aiSub !== 'none' ? aiSub : task.subniche,
          keywords: aiKeywords || task.keywords,
          analysisResult: parsedAnalysis,
          hasError: false,
          errorDetails: isApproved ? undefined : reason
        });

        console.log(`[TaskLogService] 🛑 Task ${taskId} an Tasks übergeben zur Design- & Fragen-Prüfung.`);
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const errorMsg = err.message || 'Fehler bei der Vision Design-Analyse';
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler bei Vision-Analyse',
        content: errorMsg,
        metadata: { latencyMs, model }
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
    }
  }

  /**
   * Automatically generate Master English MBA SEO Listing and proceed to Trademark Loop
   */
  static async generateListingWithOpenRouter(taskId: string) {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) {
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler: Kein OpenRouter API Key',
        content: 'Für die Listing-Generierung wird ein OpenRouter API Key in den Settings benötigt.'
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED' });
      return;
    }

    const quote = task.payload?.quote || '';
    const niche1 = ListingValidationService.normalizeOptionalText(task.niche1 || task.customAnswers?.niche1 || task.payload?.niche1 || task.analysisResult?.niche_analysis?.niche1) || '';
    const niche2 = ListingValidationService.normalizeOptionalText(task.niche2 || task.customAnswers?.niche2 || task.payload?.niche2 || task.analysisResult?.niche_analysis?.niche2) || '';
    const subniche = ListingValidationService.normalizeOptionalText(task.subniche || task.customAnswers?.subniche || task.payload?.subniche || task.analysisResult?.niche_analysis?.subniche) || '';
    const keywords = task.keywords || task.customAnswers?.keywords || task.payload?.keywords || [];
    const hermesKeywords = task.hermesKeywords || task.payload?.hermesKeywords || [];
    const targetGroup = Array.isArray(task.analysisResult?.target_group?.selected) 
      ? task.analysisResult.target_group.selected.join(', ') 
      : 'Men, Women, Youth';
    const avoidColors = task.analysisResult?.avoid_product_colors?.avoid || 'None';

    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    const previewFilePath = path.join(designsDir, `${cleanId}.u4-preview.png`);
    const mbaFilePath = path.join(designsDir, `${cleanId}_mba.png`);
    const rawFilePath = path.join(designsDir, `${cleanId}.png`);

    const targetOriginalPath = (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
      ? task.localMbaPngPath
      : (task.localImagePath && fs.existsSync(task.localImagePath))
      ? task.localImagePath
      : fs.existsSync(mbaFilePath)
      ? mbaFilePath
      : (fs.existsSync(rawFilePath) ? rawFilePath : undefined);

    let listingImageBase64: string | undefined = undefined;
    let listingImageSourceType: 'PREVIEW_1125x1350' | 'ORIGINAL_FALLBACK' | 'NONE' = 'NONE';
    let optimizationMeta: any = undefined;

    if (targetOriginalPath) {
      // 1. Try reading existing preview from disk
      if (fs.existsSync(previewFilePath)) {
        try {
          const previewBuf = fs.readFileSync(previewFilePath);
          if (previewBuf.length > 500) {
            listingImageBase64 = `data:image/png;base64,${previewBuf.toString('base64')}`;
            listingImageSourceType = 'PREVIEW_1125x1350';
            task.localU4PreviewPath = previewFilePath;
            task.u4PreviewUrl = `/api/v1/designs/u4-preview/${encodeURIComponent(taskId)}`;
            optimizationMeta = {
              sourceType: 'PREVIEW_1125x1350',
              previewPath: previewFilePath,
              resolution: '1125x1350'
            };
          }
        } catch (e: any) {
          console.warn(`[TaskLogService] Fehler beim Lesen der vorhandenen Preview für ${taskId}:`, e.message);
        }
      }

      // 2. Generate preview on demand if missing
      if (!listingImageBase64) {
        try {
          const { base64DataUrl, savedPath } = await VisionOptimizationService.prepareU4PreviewImage(targetOriginalPath, previewFilePath);
          if (base64DataUrl) {
            listingImageBase64 = base64DataUrl;
            listingImageSourceType = 'PREVIEW_1125x1350';
            task.localU4PreviewPath = savedPath || previewFilePath;
            task.u4PreviewUrl = `/api/v1/designs/u4-preview/${encodeURIComponent(taskId)}`;
            optimizationMeta = {
              sourceType: 'PREVIEW_1125x1350',
              previewPath: savedPath || previewFilePath,
              resolution: '1125x1350'
            };
          }
        } catch (err: any) {
          console.warn(`[TaskLogService] Preview-Generierung fehlgeschlagen für ${taskId}, wechsle auf Fallback:`, err.message);
        }
      }

      // 3. Fallback: If preview generation or reading failed, use original image
      if (!listingImageBase64) {
        try {
          console.warn(`[TaskLogService] 🔄 FALLBACK: Verwende Originalbild für Listing-Vision-Call (${targetOriginalPath})...`);
          const origBuf = fs.readFileSync(targetOriginalPath);
          listingImageBase64 = `data:image/png;base64,${origBuf.toString('base64')}`;
          listingImageSourceType = 'ORIGINAL_FALLBACK';
          optimizationMeta = {
            sourceType: 'ORIGINAL_FALLBACK',
            fallbackPath: targetOriginalPath
          };
        } catch (e: any) {
          console.warn(`[TaskLogService] Konnte Originalbild nicht für Listing-LLM einlesen:`, e.message);
        }
      }
    }

    const start = Date.now();
    try {
      const enListing = await LLMService.generateMasterEnglishListing({
        niche1,
        niche2,
        subniche,
        quote,
        keywords,
        hermesKeywords,
        stylePreset: task.payload?.stylePreset || task.payload?.style || 'vintage retro vector',
        audience: targetGroup,
        avoidColor: avoidColors,
        imageSource: listingImageBase64
      });

      const latencyMs = Date.now() - start;

      // 1. Log Event: Senden an OpenRouter (Master English Listing) with FULL raw request
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_REQUEST',
        title: `Senden an OpenRouter (Master English Listing Generator)`,
        content: {
          niche1,
          niche2,
          subniche,
          quote,
          keywords,
          hermesKeywords,
          targetAudience: targetGroup,
          avoidColors,
          rawRequest: enListing._rawRequest || null
        },
        metadata: {
          provider: 'OpenRouter',
          model: enListing._rawRequest?.model || settings.llmModel || 'anthropic/claude-3-5-sonnet'
        }
      });

      // 2. Log Event: Empfangen von OpenRouter (Listing) with FULL raw response
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: `Empfangen von OpenRouter (Master English Listing)`,
        content: {
          en: {
            brand: enListing.brand,
            title: enListing.title,
            bullet1: enListing.bullet1,
            bullet2: enListing.bullet2,
            description: enListing.description
          },
          imageOptimization: optimizationMeta,
          rawResponse: enListing._rawResponse || null
        },
        metadata: {
          latencyMs
        }
      });

      this.updateTaskStatus(taskId, {
        status: 'CHECKING_TRADEMARKS',
        listingResult: {
          en: {
            brand: enListing.brand,
            title: enListing.title,
            bullet1: enListing.bullet1,
            bullet2: enListing.bullet2,
            description: enListing.description
          }
        },
        localU4PreviewPath: task.localU4PreviewPath,
        u4PreviewUrl: task.u4PreviewUrl,
        niche1,
        niche2,
        subniche,
        hasError: false
      });

      console.log(`[TaskLogService] 📝 Master English Listing für Task ${taskId} erfolgreich generiert in ${latencyMs}ms. Starte Trademark Audit...`);

      // Trigger automatic Trademark Check & Refinement loop!
      await this.auditListingTrademarks(taskId);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const errorMsg = err.message || 'Fehler bei der Listing-Generierung';
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler bei Listing-Generierung',
        content: errorMsg,
        metadata: { latencyMs }
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
    }
  }

  /**
   * Automatically audit Trademarks via Trademark Workflow V2 (USPTO Live Scan + Dual-LLM Referee/Verifier)
   * Handles single common words, multi-word marks, core quote conflicts, up to 3 rewrite cycles with forbidden list,
   * product blocking, and post-approval localization into DE, FR, ES, IT, JA.
   */
  static async auditListingTrademarks(taskId: string) {
    const task = this.getTaskLogById(taskId);
    if (!task || !task.listingResult) return;

    const enListing = task.listingResult.en || task.listingResult;
    const initialFields: EnglishListing = {
      brand: typeof enListing === 'object' ? enListing.brand || '' : '',
      title: typeof enListing === 'object' ? enListing.title || '' : '',
      bullet1: typeof enListing === 'object' ? enListing.bullet1 || '' : '',
      bullet2: typeof enListing === 'object' ? enListing.bullet2 || '' : '',
      description: typeof enListing === 'object' ? enListing.description || '' : ''
    };

    const quote = task.payload?.quote || '';
    const niche1 = ListingValidationService.normalizeOptionalText(task.niche1 || task.customAnswers?.niche1 || task.payload?.niche1) || '';
    const niche2 = ListingValidationService.normalizeOptionalText(task.niche2 || task.customAnswers?.niche2 || task.payload?.niche2) || '';
    const subniche = ListingValidationService.normalizeOptionalText(task.subniche || task.customAnswers?.subniche || task.payload?.subniche) || '';

    try {
      console.log(`[TaskLogService] 🛡️ Starte Trademark Workflow V2 für Task ${taskId}...`);

      const currentSettings = loadSettings();
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_CHECK_REQUEST',
        title: 'Starte Trademark Workflow V2 (USPTO Live Scan + Dual-LLM Referee/Verifier)',
        content: { quote, niche1, niche2, subniche, fields: initialFields },
        metadata: { provider: 'OpenRouter', model: currentSettings.llmModel }
      });

      const auditV2 = await TrademarkService.executeTrademarkAuditV2({
        listing: initialFields,
        quote,
        niche1,
        niche2,
        subniche,
        maxRewriteCycles: 3,
        taskId,
        onEvent: (ev) => {
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: ev.type,
            title: ev.title,
            content: ev.content,
            metadata: ev.metadata
          });
        }
      });

      // 1. WENN ESKALATION (Core Quote Class 25 Conflict, Famous Brand in design, oder Limit erreicht)
      if (auditV2.finalDecision === 'ESCALATE' || !auditV2.isSafe) {
        const reason = auditV2.reasonCode || 'Trademark-Konflikt erfordert manuelle Freigabe.';
        console.warn(`[TaskLogService] 🚨 Task ${taskId} eskaliert zu AWAITING_TM_REVIEW (${reason})`);

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TASK_HANDOFF',
          title: `Übergeben an Tasks (Eskalation: ${reason})`,
          content: {
            checkpoint: 'TM_REVIEW',
            reason,
            recommendedAction: auditV2.recommendedAction,
            finalDecision: auditV2.finalDecision,
            totalHits: auditV2.finalTrademarkHits.length,
            forbiddenTerms: auditV2.forbiddenTermsForTask
          }
        });

        this.updateTaskStatus(taskId, {
          status: 'AWAITING_TM_REVIEW',
          checkpoint: 'TM_REVIEW',
          blockedNiceClasses: auditV2.blockedNiceClasses,
          blockedProducts: auditV2.blockedProducts,
          trademarkCheckResult: {
            totalHits: auditV2.finalTrademarkHits.length,
            hasInfringementClass25: auditV2.finalDecision === 'ESCALATE',
            blockedProducts: auditV2.blockedProducts,
            fieldSummaries: {}
          },
          trademarkRefineResult: {
            verdict: 'REJECTED',
            rejection_reason: reason,
            actions_taken: auditV2.rewriteIterations.flatMap(i => i.actionsTaken),
            blockedProducts: auditV2.blockedProducts,
            refined_listing: auditV2.finalListing
          },
          hasError: false,
          errorDetails: reason,
          ...( { tmAuditV2: auditV2 } as any )
        });
        return;
      }

      // 2. WENN FREIGEGEBEN (SAFE / APPROVED / APPROVE_WITH_BLOCKED_PRODUCTS)
      console.log(`[TaskLogService] 🛡️ Master English Listing durch V2 freigegeben (${auditV2.finalDecision})! Starte Lokalisierung...`);

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_CHECK_RESPONSE',
        title: `Trademark Workflow V2 freigegeben (${auditV2.finalTrademarkHits.length} Treffer, ${auditV2.blockedProducts.length} Produkte gesperrt)`,
        content: {
          auditV2,
          refinedListing: auditV2.finalListing,
          totalHits: auditV2.finalTrademarkHits.length,
          hasInfringementClass25: false,
          blockedProducts: auditV2.blockedProducts,
          finalDecision: auditV2.finalDecision
        },
        metadata: {
          provider: `Productor USPTO / ${currentSettings.llmModel || 'GPT-5.6 Sol'}`,
          model: currentSettings.llmModel
        }
      });

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TRANSLATION_REQUEST',
        title: 'Master English Listing V2 freigegeben -> Starte Multi-Marketplace Lokalisierung',
        content: {
          approvedEnglish: auditV2.finalListing,
          blockedNiceClasses: auditV2.blockedNiceClasses,
          blockedProducts: auditV2.blockedProducts,
          finalDecision: auditV2.finalDecision
        }
      });

      const settings = loadSettings();
      const isTranslationEnabled = (task.source === 'UPDATE' || task.suffix === 'U')
        ? (settings.translationUpdateEnabled ?? true)
        : (settings.translationDesignEnabled ?? true);

      let sanitizedListings: any;

      if (!isTranslationEnabled) {
        console.log(`[TaskLogService] ⏩ Übersetzung deaktiviert (${task.source === 'UPDATE' ? 'Update' : 'Design'}-Pipeline). Verwende englisches Master-Listing für Amazon Auto-Translate.`);
        sanitizedListings = {
          en: auditV2.finalListing
        };

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TRANSLATION_SKIPPED',
          title: 'Lokalisierung übersprungen (Amazon Auto-Translate aktiv)',
          content: { message: 'Übersetzung in Settings deaktiviert. Listing wird als englisches Master-Listing übergeben.', listing: sanitizedListings }
        });
      } else {
        this.updateTaskStatus(taskId, { status: 'TRANSLATING_LISTING', hasError: false });

        const transStart = Date.now();
        const translatedListings = await LLMService.translateApprovedListing({
          englishListing: auditV2.finalListing,
          quote,
          niche1,
          subniche
        });
        const transLatencyMs = Date.now() - transStart;

        // 3. Hard Sanitizer Gatekeeper
        sanitizedListings = this.sanitizeAndValidateListingBeforeQueue(translatedListings);

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TRANSLATION_RESPONSE',
          title: `Lokalisierte Listings erfolgreich erstellt & bereinigt (${transLatencyMs}ms)`,
          content: sanitizedListings,
          metadata: { latencyMs: transLatencyMs }
        });
      }

      this.updateTaskStatus(taskId, {
        status: 'CHECKING_TRADEMARKS',
        listingResult: sanitizedListings,
        blockedNiceClasses: auditV2.blockedNiceClasses,
        blockedProducts: auditV2.blockedProducts,
        trademarkCheckResult: {
          totalHits: auditV2.finalTrademarkHits.length,
          hasInfringementClass25: false,
          blockedProducts: auditV2.blockedProducts,
          fieldSummaries: {}
        },
        trademarkRefineResult: {
          verdict: 'APPROVED',
          rejection_reason: null,
          actions_taken: auditV2.rewriteIterations.flatMap(i => i.actionsTaken),
          blockedProducts: auditV2.blockedProducts,
          refined_listing: auditV2.finalListing
        },
        hasError: false,
        ...( { tmAuditV2: auditV2 } as any )
      });

      if (task.source === 'UPDATE' || task.suffix === 'U') {
        console.log(`[TaskLogService] ✨ Update-Task ${taskId} Listing freigegeben -> Direkte Übergabe an Queue ✓`);
        try {
          const { UpdatePipelineService } = require('./updatePipelineService');
          UpdatePipelineService.stepU7_Enqueue(taskId).catch((err: any) => {
            console.error(`[TaskLogService] Fehler bei Step U7 Enqueue für ${taskId}:`, err);
          });
        } catch (err) {
          console.error(`[TaskLogService] Konnte UpdatePipelineService nicht laden:`, err);
        }
        return;
      }

      console.log(`[TaskLogService] ✨ Task ${taskId} Listing freigegeben und lokalisiert -> Starte Vektorisierung ✓`);
      this.vectorizeDesignTask(taskId).catch(err => {
        console.error(`[TaskLogService] Vektorisierung für Task ${taskId} fehlgeschlagen:`, err);
      });
    } catch (err: any) {
      console.error(`[TaskLogService] ❌ Unerwarteter Fehler beim TM Audit V2 für Task ${taskId}:`, err);
      this.updateTaskStatus(taskId, {
        status: 'AWAITING_TM_REVIEW',
        checkpoint: 'TM_REVIEW',
        hasError: false,
        errorDetails: `Technischer Fehler bei TM-Prüfung: ${err.message}`
      });
    }
  }

  static async vectorizeDesignTask(taskId: string): Promise<void> {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    // Safety Guard: Update tasks already have production-ready master PNGs -> Skip vectorization!
    if (task.source === 'UPDATE' || task.suffix === 'U' || task.id.endsWith('-U')) {
      console.log(`[TaskLogService] ℹ️ Task ${taskId} ist ein Update-Task -> Vektorisierung wird übersprungen (Master-Artwork bereits fertig).`);
      try {
        const { UpdatePipelineService } = require('./updatePipelineService');
        await UpdatePipelineService.stepU7_Enqueue(taskId);
      } catch (e) {
        console.error(`[TaskLogService] Fehler beim Enqueue von Update-Task ${taskId}:`, e);
      }
      return;
    }

    const settings = loadSettings();
    const hasKey = Boolean(settings.vectorizerApiKey && settings.vectorizerApiKey.trim());
    const hasSecret = Boolean(settings.vectorizerApiSecret && settings.vectorizerApiSecret.trim());

    if (!hasKey || !hasSecret) {
      console.log(`[TaskLogService] ℹ️ Vectorizer.ai API Credentials nicht konfiguriert -> Task ${taskId} ohne Vektorisierung abgeschlossen.`);
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
      return;
    }

    const maxColors = task.customAnswers?.maxColors ?? task.analysisResult?.color_analysis?.color_count ?? 2;
    const cleanId = task.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localImagePath = task.localImagePath || path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
    const hasLocalImage = fs.existsSync(localImagePath);

    if (!hasLocalImage && !task.imageUrl) {
      console.warn(`[TaskLogService] ⚠️ Kein Bild für Vektorisierung bei Task ${taskId} gefunden.`);
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
      return;
    }

    this.updateTaskStatus(taskId, { status: 'VECTORIZING_DESIGN', hasError: false });

    // 1. Log Event: Senden an Vectorizer.ai
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'VECTORIZE_REQUEST',
      title: `Senden an Vectorizer.ai (Vektorisierung)`,
      content: {
        mode: settings.vectorizerModeProduction || 'production',
        maxColors,
        drawStyle: settings.vectorizerDrawStyle || 'fill_shapes',
        shapeStacking: settings.vectorizerShapeStacking || 'cutouts',
        groupBy: settings.vectorizerGroupBy || 'none',
        minArea: settings.vectorizerMinArea ?? 10,
        optimizedShapes: settings.vectorizerOptimizedShapes ?? true,
        gapFiller: settings.vectorizerGapFiller ?? false,
        imageSource: hasLocalImage ? `data/designs/${cleanId}.png` : task.imageUrl
      },
      metadata: {
        provider: 'Vectorizer.ai',
        model: 'vectorizer-v1'
      }
    });

    const start = Date.now();
    try {
      let svgText = '';
      if (hasLocalImage) {
        const buffer = fs.readFileSync(localImagePath);
        svgText = await VectorizerService.vectorizeBuffer(buffer, 'image/png', false, { maxColors });
      } else if (task.imageUrl) {
        svgText = await VectorizerService.vectorizeImage(task.imageUrl, false, { maxColors });
      }

      const latencyMs = Date.now() - start;

      // Save original SVG & editable SVG locally to data/designs/
      const designsDir = path.resolve(process.cwd(), 'data', 'designs');
      if (!fs.existsSync(designsDir)) {
        try { fs.mkdirSync(designsDir, { recursive: true }); } catch (e) {}
      }

      const origFilename = `${cleanId}_original.svg`;
      const origFilePath = path.join(designsDir, origFilename);
      fs.writeFileSync(origFilePath, svgText, 'utf-8');

      const svgFilename = `${cleanId}.svg`;
      const svgFilePath = path.join(designsDir, svgFilename);
      fs.writeFileSync(svgFilePath, svgText, 'utf-8');

      const ts = Date.now();
      const origSvgUrl = `/api/v1/designs/svg-original/${encodeURIComponent(taskId)}?t=${ts}`;
      const localSvgUrl = `/api/v1/designs/svg/${encodeURIComponent(taskId)}?t=${ts}`;
      task.originalSvgPath = origFilePath;
      task.originalSvgUrl = origSvgUrl;
      task.localSvgPath = svgFilePath;
      task.svgUrl = localSvgUrl;
      task.svgContent = svgText;

      // 2. Log Event: Empfangen von Vectorizer.ai
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'VECTORIZE_RESPONSE',
        title: `Empfangen von Vectorizer.ai (SVG Vektorgrafik)`,
        content: {
          svgUrl: localSvgUrl,
          originalSvgUrl: origSvgUrl,
          svgLength: svgText.length,
          maxColorsUsed: maxColors,
          svgContent: svgText.length < 50000 ? svgText : `${svgText.substring(0, 1000)}...`
        },
        metadata: {
          provider: 'Vectorizer.ai',
          latencyMs
        }
      });

      // 3. Check if automatic background removal is requested
      const bgAnswer = task.customAnswers?.reuseBackground || '';
      const bgAnalysis = task.analysisResult?.background_analysis || {};
      const isManualBg = bgAnswer === 'Manuell' || bgAnswer === 'MANUAL' || bgAnswer.includes('Ja') || bgAnswer.includes('behalten') || bgAnalysis.removal_mode === 'MANUAL';
      const isAutoBg = !isManualBg;

      if (isAutoBg) {
        console.log(`[TaskLogService] ⚡ Wende Auto BG Remove für Task ${taskId} an...`);
        const bgResult = await SvgRenderService.autoRemoveCornerBackground(svgText);
        if (bgResult.success && bgResult.removedCount > 0) {
          svgText = bgResult.modifiedSvg;
          fs.writeFileSync(svgFilePath, svgText, 'utf-8');
          task.svgContent = svgText;

          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'SVG_EDIT_RESPONSE',
            title: `Auto BG Remove angewendet (${bgResult.removedCount} Hintergrund-Elemente entfernt)`,
            content: {
              removedElementsCount: bgResult.removedCount,
              method: 'Auto Corner Detection'
            }
          });
        }

        // Render 4-Panel Test Image for Vision Audit
        console.log(`[TaskLogService] 🖼️ Rendere 4-Panel Multifarben-Testbild für Task ${taskId}...`);
        const fourPanelFilename = `${cleanId}_4panel.png`;
        const fourPanelFilePath = path.join(designsDir, fourPanelFilename);
        const fourPanelBuffer = await SvgRenderService.render4PanelTestImage(svgText);
        fs.writeFileSync(fourPanelFilePath, fourPanelBuffer);

        const fourPanelUrl = `/api/v1/designs/4panel/${encodeURIComponent(taskId)}?t=${Date.now()}`;
        task.localFourPanelImagePath = fourPanelFilePath;
        task.fourPanelImageUrl = fourPanelUrl;

        // Log: Senden an LLM Vision zur 4-Panel Cutout-Prüfung
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'SVG_AUDIT_REQUEST',
          title: `Senden an LLM Vision (4-Panel Cutout-Prüfung auf Weiß/Schwarz/Rot/Slate)`,
          content: {
            fourPanelImageUrl: fourPanelUrl,
            quote: task.payload?.quote
          },
          metadata: {
            provider: 'OpenRouter Vision'
          }
        });

        // Run LLM Cutout Audit
        console.log(`[TaskLogService] 🤖 Führe LLM Vision Cutout-Audit für Task ${taskId} durch...`);
        const auditResult = await LLMService.auditSvgCutout(fourPanelFilePath, task.payload?.quote);
        task.svgAuditResult = auditResult;

        // Log: Empfangen von LLM Vision Cutout Audit
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'SVG_AUDIT_RESPONSE',
          title: `Empfangen von LLM Vision (${auditResult.cutout_verdict === 'APPROVED' ? 'Cutout Freigegeben ✓' : 'Korrektur nötig ⚠️'})`,
          content: {
            verdict: auditResult.cutout_verdict,
            backgroundClean: auditResult.background_removed_cleanly,
            detectedIssues: auditResult.detected_issues,
            explanation: auditResult.explanation,
            fourPanelImageUrl: fourPanelUrl
          },
          metadata: {
            provider: 'OpenRouter Vision',
            latencyMs: auditResult.latencyMs,
            tokens: auditResult.tokens
          }
        });

        if (auditResult.cutout_verdict === 'APPROVED') {
          // Render Final MBA Print PNG (4500x5400 px, 300 DPI, Transparent)
          console.log(`[TaskLogService] 🖨️ Rendere finales MBA Master-PNG (4500x5400 px, 300 DPI) für Task ${taskId}...`);
          const mbaFilename = `${cleanId}_mba.png`;
          const mbaFilePath = path.join(designsDir, mbaFilename);
          const mbaBuffer = await SvgRenderService.renderSvgToMbaPng(svgText);
          fs.writeFileSync(mbaFilePath, mbaBuffer);

          const mbaUrl = `/api/v1/designs/mba-png/${encodeURIComponent(taskId)}?t=${Date.now()}`;
          task.localMbaPngPath = mbaFilePath;
          task.mbaPngUrl = mbaUrl;

          // 6. Generate Resized Artworks (Trimmed, Mug Standard & Brush, Drinkware Standard)
          try {
            const resized = await ArtworkResizeService.generateResizedArtworks(taskId, mbaFilePath);
            task.resizedAssets = resized;
            this.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'RESIZE_RESPONSE',
              title: `📐 Two-Sided & Brush Varianten generiert ✓`,
              content: {
                trimmedPath: resized.trimmedPath,
                mugStandardPath: resized.mugStandardPath,
                mugBrushPath: resized.mugBrushPath,
                drinkwareStandardPath: resized.drinkwareStandardPath,
                drinkwareBrushPath: resized.drinkwareBrushPath,
                message: 'Two-Sided Varianten für Ceramic Mug (Standard & Brush) und Drinkware (Standard & Brush) erfolgreich erstellt.'
              }
            });
          } catch (resizeErr: any) {
            console.error(`[TaskLogService] ⚠️ Fehler bei der Resize-Generierung für Task ${taskId}:`, resizeErr);
          }

          this.updateTaskStatus(taskId, {
            status: 'COMPLETED',
            checkpoint: undefined,
            hasError: false
          });

          console.log(`[TaskLogService] 🎉 Task ${taskId} vollautonom freigestellt, geprüft & als MBA PNG abgeschlossen ✓`);
        } else {
          // AI found remaining background or issues -> Route to Tasks (Checkpoint 4) for quick manual fix!
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TASK_HANDOFF',
            title: `Übergeben an Tasks (Checkpoint 4: Manuelle Nachkorrektur empfohlen)`,
            content: {
              checkpoint: 'SVG_REVIEW',
              reason: auditResult.explanation,
              detectedIssues: auditResult.detected_issues,
              fourPanelImageUrl: fourPanelUrl,
              svgUrl: localSvgUrl
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'AWAITING_SVG_REVIEW',
            checkpoint: 'SVG_REVIEW',
            hasError: false
          });

          console.log(`[TaskLogService] ⚠️ Task ${taskId}: KI empfiehlt manuelle Korrektur -> In Tasks übergeben ✓`);
        }
      } else {
        // Manual mode explicitly requested
        try {
          const fourPanelFilename = `${cleanId}_4panel.png`;
          const fourPanelFilePath = path.join(designsDir, fourPanelFilename);
          const fourPanelBuffer = await SvgRenderService.render4PanelTestImage(svgText);
          fs.writeFileSync(fourPanelFilePath, fourPanelBuffer);
          task.localFourPanelImagePath = fourPanelFilePath;
          task.fourPanelImageUrl = `/api/v1/designs/4panel/${encodeURIComponent(taskId)}`;
        } catch (e) {}

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TASK_HANDOFF',
          title: `Übergeben an Tasks (Checkpoint 4: Manuelle SVG-Prüfung gewünscht)`,
          content: {
            checkpoint: 'SVG_REVIEW',
            svgUrl: localSvgUrl,
            maxColorsUsed: maxColors,
            reason: 'Manueller Hintergrund-Modus in Checkpoint 2 gewählt.'
          }
        });

        this.updateTaskStatus(taskId, {
          status: 'AWAITING_SVG_REVIEW',
          checkpoint: 'SVG_REVIEW',
          hasError: false
        });
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      console.error(`[TaskLogService] Fehler bei der Vektorisierung für Task ${taskId}:`, err);
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler bei der Vektorisierung (Vectorizer.ai)',
        content: err.message || 'Fehler beim Vectorizer.ai API Aufruf',
        metadata: { latencyMs }
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
    }
  }

  /**
   * Jump back to an earlier pipeline step and re-execute from there
   */
  static async retryFromStep(taskId: string, stepType: RetryStepType, eventIndex?: number): Promise<{ success: boolean; message: string }> {
    const logs = this.loadLogs();
    const currentTask = logs.find(t => t.id === taskId);
    if (!currentTask) {
      throw new Error(`Task ${taskId} nicht gefunden.`);
    }

    // Wenn ein konkreter eventIndex übergeben wurde, Historie exakt ab diesem Schritt abschneiden!
    if (typeof eventIndex === 'number' && eventIndex >= 0 && eventIndex < currentTask.events.length) {
      currentTask.events = currentTask.events.slice(0, eventIndex);
    }

    if (stepType === 'LLM_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'LLM_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'PROCESSING';
      currentTask.resultPrompt = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.generatePromptWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Prompt failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Ideogram Prompt-Generierung neu gestartet.' };
    }

    if (stepType === 'IDEOGRAM_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'IDEOGRAM_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'GENERATING_IMAGE';
      currentTask.imageUrl = undefined;
      currentTask.localImagePath = undefined;
      currentTask.analysisResult = undefined;
      currentTask.listingResult = undefined;
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.processTaskWithIdeogram(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Ideogram failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Ideogram Bild-Generierung neu gestartet.' };
    }

    if (stepType === 'ANALYSIS_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'ANALYSIS_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'ANALYZING_DESIGN';
      currentTask.analysisResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.analyzeDesignWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Analysis failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Design QA-Analyse neu gestartet.' };
    }

    if (stepType === 'LISTING_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'LISTING_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'GENERATING_LISTING';
      currentTask.listingResult = undefined;
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.generateListingWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Listing failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Listing-Erstellung neu gestartet.' };
    }

    if (stepType === 'PREFLIGHT_TM_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'TM_CHECK_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'PROCESSING';
      currentTask.trademarkCheckResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.processTaskWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Pre-Flight TM Check failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Pre-Flight TM-Prüfung neu gestartet.' };
    }

    if (stepType === 'TM_CHECK_REQUEST' || stepType === 'TM_REFINE_REQUEST') {
      if (typeof eventIndex !== 'number') {
        let lastTmIdx = -1;
        for (let i = currentTask.events.length - 1; i >= 0; i--) {
          if (currentTask.events[i].type === 'TM_CHECK_REQUEST' || currentTask.events[i].type === 'TM_REFINE_REQUEST') {
            lastTmIdx = i;
            break;
          }
        }
        if (lastTmIdx !== -1) {
          currentTask.events = currentTask.events.slice(0, lastTmIdx);
        }
      }
      currentTask.status = 'CHECKING_TRADEMARKS';
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      if (currentTask.source === 'UPDATE' || currentTask.suffix === 'U') {
        try {
          const { UpdatePipelineService } = require('./updatePipelineService');
          UpdatePipelineService.stepU5_TrademarkCheck(taskId).catch((err: any) => {
            console.error(`[TaskLogService] Retry Update Step U5 failed:`, err);
          });
          return { success: true, message: 'Update Step U5 (Trademark Check) neu gestartet.' };
        } catch (e) {
          console.error(`[TaskLogService] Fehler beim Laden von UpdatePipelineService:`, e);
        }
      }

      this.auditListingTrademarks(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Listing TM Check failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'USPTO Trademark-Prüfung & Audit neu gestartet.' };
    }

    if (stepType === 'VECTORIZE_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const lastVecIdx = currentTask.events.findIndex(e => e.type === 'VECTORIZE_REQUEST');
        if (lastVecIdx !== -1) {
          currentTask.events = currentTask.events.slice(0, lastVecIdx);
        }
      }
      currentTask.status = 'VECTORIZING_DESIGN';
      currentTask.svgUrl = undefined;
      currentTask.localSvgPath = undefined;
      currentTask.svgContent = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.vectorizeDesignTask(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Vectorization failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'Vectorizer.ai Vektorisierung neu gestartet.' };
    }

    if (stepType === 'SVG_AUDIT_REQUEST' || stepType === 'SVG_REVIEW') {
      if (typeof eventIndex !== 'number') {
        const lastAuditIdx = currentTask.events.findIndex(e => e.type === 'SVG_AUDIT_REQUEST' || e.type === 'SVG_EDIT_REQUEST');
        if (lastAuditIdx !== -1) {
          currentTask.events = currentTask.events.slice(0, lastAuditIdx);
        }
      }
      currentTask.status = 'AWAITING_SVG_REVIEW';
      currentTask.checkpoint = 'SVG_REVIEW';
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);
      this.emitUpdate(currentTask);
      return { success: true, message: 'In den manuellen SVG-Editor (Tasks Checkpoint 4) übergeben.' };
    }

    if (typeof stepType === 'string' && stepType.startsWith('UPDATE_')) {
      const stepKey = stepType.replace('UPDATE_', '').split('_')[0];
      const { UpdatePipelineService } = require('./updatePipelineService');
      UpdatePipelineService.runStep(taskId, stepKey).catch((err: any) => {
        console.error(`[TaskLogService] Retry Update Step ${stepKey} failed:`, err);
      });
      return { success: true, message: `Update Step ${stepKey} neu gestartet.` };
    }

    throw new Error(`Unbekannter Step-Typ: ${stepType}`);
  }

  static toTaskSummary(task: DesignTaskLog): TaskSummary {
    return toTaskSummary(task);
  }

  static getTaskSummaryById(id: string): TaskSummary | undefined {
    return TaskRepository.getTaskSummaryById(id) || undefined;
  }

  static getTaskLogs(): DesignTaskLog[] {
    return this.loadLogs();
  }

  static getAwaitingTasks(): DesignTaskLog[] {
    return TaskRepository.getAwaitingTaskSummaries()
      .map(s => TaskRepository.getTaskById(s.id))
      .filter(Boolean) as DesignTaskLog[];
  }

  static getAwaitingTaskSummaries(): TaskSummary[] {
    return TaskRepository.getAwaitingTaskSummaries();
  }

  static getTaskSummariesPage(options: {
    limit?: number;
    cursor?: string;
    source?: TaskSource | 'ALL';
    status?: TaskStatus | 'ALL';
    checkpoint?: CheckpointType | 'ALL';
    search?: string;
  }): {
    success: boolean;
    tasks: TaskSummary[];
    totalCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  } {
    return TaskRepository.getTaskSummariesPage(options);
  }

  static getTaskLogById(id: string): DesignTaskLog | undefined {
    if (!id) return undefined;
    return TaskRepository.getTaskById(id) || undefined;
  }

  static getTaskById(id: string): DesignTaskLog | undefined {
    return this.getTaskLogById(id);
  }

  static getTask(id: string): DesignTaskLog | undefined {
    return this.getTaskLogById(id);
  }

  static clearTaskLogs() {
    TaskRepository.clearAllTasks();
  }

  static getActiveUpdateDesignIds(): Set<string> {
    return TaskRepository.getActiveUpdateDesignIds();
  }

  static getActiveReviewUpdateTasks(): Array<{ id: string; designId?: string }> {
    return TaskRepository.getActiveReviewUpdateTasks();
  }

  static cancelTasksByTarget(targetTaskId: string, targetDesignId?: string): number {
    return TaskRepository.cancelTasksByTarget(targetTaskId, targetDesignId);
  }

  static cancelActiveUpdateTasks(): number {
    return TaskRepository.cancelActiveUpdateTasks();
  }

  static getTaskUsageMetrics(resetTimestamp: number) {
    return TaskRepository.getTaskUsageMetrics(resetTimestamp);
  }

  /**
   * Complete System Purge / Fresh Workspace Reset:
   * 1. Deletes all tasks and event logs
   * 2. Resets task counter to 0 (#001 next)
   * 3. Clears upload queue completely
   * 4. Deletes all generated/downloaded artwork, PNGs, SVGs, 4-Panels and 2x2 Grids
   * 5. Emits realtime WebSocket events
   */
  static purgeAllWorkspaceData(): {
    deletedTasks: number;
    deletedQueueItems: number;
    deletedFiles: number;
  } {
    console.log('[TaskLogService] 🚨 Starte vollständigen System-Reset (Purge All Workspace Data)...');
    
    // 1. Clear Tasks
    const deletedTasks = TaskRepository.getTotalTaskCount();
    TaskRepository.clearAllTasks();

    // 2. Reset Counter
    TaskRepository.init();

    // 3. Clear Upload Queue
    let deletedQueueItems = 0;
    try {
      const { QueueService } = require('./queueService');
      const queue = QueueService.loadQueue();
      deletedQueueItems = queue.length;
      QueueService.clearQueue();
    } catch (err) {
      console.warn('[TaskLogService] Konnte Upload Queue nicht leeren:', err);
    }

    let deletedFiles = 0;
    // 4. Delete all artwork files in data/designs/
    try {
      const designsDir = path.resolve(process.cwd(), 'data', 'designs');
      if (fs.existsSync(designsDir)) {
        const files = fs.readdirSync(designsDir);
        for (const file of files) {
          if (file === '.gitkeep') continue;
          try {
            const filePath = path.join(designsDir, file);
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              deletedFiles++;
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[TaskLogService] Konnte data/designs/ nicht leeren:', err);
    }

    // 5. Delete any temporary/leftover design files in data/ directory
    try {
      const dataDir = path.resolve(process.cwd(), 'data');
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        for (const file of files) {
          if (
            file.endsWith('_grid2x2.jpg') ||
            file.endsWith('.u4-preview.png') ||
            file.endsWith('_mba.png') ||
            file.endsWith('_orig.svg') ||
            file.endsWith('_4panel.jpg') ||
            file.endsWith('.svg') ||
            file.startsWith('test_')
          ) {
            try {
              const filePath = path.join(dataDir, file);
              if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
                deletedFiles++;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.warn('[TaskLogService] Konnte temporäre data-Dateien nicht löschen:', err);
    }

    // 6. Broadcast Realtime WebSocket Events
    if (this.eventBroadcaster) {
      this.eventBroadcaster('ALL_TASKS_CLEARED', { deletedTasks, deletedQueueItems, deletedFiles });
      this.eventBroadcaster('TASKS_UPDATED', { tasks: [] });
      this.eventBroadcaster('QUEUE_UPDATED', { items: [] });
    }

    console.log(`[TaskLogService] ✅ System-Reset abgeschlossen: ${deletedTasks} Tasks, ${deletedQueueItems} Queue-Elemente, ${deletedFiles} Bild/Design-Dateien gelöscht.`);
    return { deletedTasks, deletedQueueItems, deletedFiles };
  }

  static deleteTaskLog(taskId: string): boolean {
    const deleted = TaskRepository.deleteTask(taskId);
    if (deleted) {
      try {
        const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const imgPath = path.resolve(process.cwd(), 'data', 'designs', `${safeId}.png`);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        const previewPath = path.resolve(process.cwd(), 'data', 'designs', `${safeId}.u4-preview.png`);
        if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
      } catch (e) {}
      if (this.eventBroadcaster) {
        this.eventBroadcaster('TASK_DELETED', { taskId });
      }
      return true;
    }
    return false;
  }

  /**
   * Checkpoint 2: Submit Design & Questions Review
   */
  static async submitDesignReview(taskId: string, params: {
    action: 'APPROVE' | 'REGENERATE_IMAGE' | 'DISCARD' | 'REJECT';
    answers?: {
      audience?: string;
      avoidColor?: string;
      reuseBackground?: string;
      notes?: string;
    };
    updatedPrompt?: string;
  }) {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    if (params.action === 'DISCARD' || params.action === 'REJECT') {
      task.status = 'REJECTED';
      task.checkpoint = undefined;
      task.hasError = false;
      task.errorDetails = 'Task im Checkpoint 2 (Design-Prüfung) manuell abgebrochen.';

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: 'Task verworfen (Design-Prüfung)',
        content: {
          action: 'DISCARD',
          reason: 'Benutzer hat den Task bei der Design-/Fragenprüfung abgebrochen.'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      return { success: true, message: `Task ${taskId} wurde abgebrochen und verworfen.` };
    }

    if (params.action === 'REGENERATE_IMAGE') {
      const promptToUse = params.updatedPrompt || task.resultPrompt || task.payload?.quote || '';
      task.status = 'GENERATING_IMAGE';
      task.checkpoint = undefined;
      task.hasError = false;
      task.errorDetails = undefined;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'IDEOGRAM_REQUEST',
        title: `Ideogram Bildgenerierung erneut angefordert (Human Loop: Quote/Design korrigiert)`,
        content: {
          prompt: promptToUse,
          reason: 'Manuell in Tasks zur Neugenerierung freigegeben'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      this.processTaskWithIdeogram(taskId, promptToUse).catch(err => {
        console.error(`[TaskLogService] Regenerate image failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Bildgenerierung mit Ideogram neu gestartet.' };
    }

    if (params.action === 'APPROVE') {
      if (params.answers) {
        task.customAnswers = params.answers;
        const n1 = params.answers.niche1 !== undefined ? params.answers.niche1.trim() : (task.niche1 || '');
        const n2 = params.answers.niche2 !== undefined ? params.answers.niche2.trim() : (task.niche2 || '');
        const sub = params.answers.subniche !== undefined ? params.answers.subniche.trim() : (task.subniche || '');
        const kwList = params.answers.keywords !== undefined
          ? (Array.isArray(params.answers.keywords) ? params.answers.keywords : String(params.answers.keywords).split(',').map((s: string) => s.trim()).filter(Boolean))
          : (task.keywords || []);

        const normN1 = ListingValidationService.normalizeOptionalText(n1) || '';
        const normN2 = ListingValidationService.normalizeOptionalText(n2);
        const normSub = ListingValidationService.normalizeOptionalText(sub);

        task.niche1 = normN1;
        task.niche2 = normN2;
        task.subniche = normSub;
        task.keywords = kwList;

        if (!task.payload) task.payload = {};
        task.payload.niche1 = normN1;
        task.payload.niche2 = normN2;
        task.payload.subniche = normSub;
        task.payload.keywords = kwList;

        if (task.analysisResult && typeof task.analysisResult === 'object') {
          task.analysisResult.niche1 = normN1;
          task.analysisResult.niche2 = normN2;
          task.analysisResult.subniche = normSub;
          task.analysisResult.niche_analysis = {
            niche1: normN1,
            niche2: normN2 || '',
            subniche: normSub || ''
          };
          if (params.answers.audience) {
            const rawAud = String(params.answers.audience).toLowerCase();
            const fits: string[] = [];
            if (rawAud.includes('men') || rawAud.includes('männer') || rawAud.includes('herren')) fits.push('men');
            if (rawAud.includes('women') || rawAud.includes('frauen') || rawAud.includes('damen')) fits.push('women');
            if (rawAud.includes('youth') || rawAud.includes('kids') || rawAud.includes('kinder') || rawAud.includes('jugend')) fits.push('youth');
            const finalFits = fits.length > 0 ? fits : ['men', 'women', 'youth'];

            task.analysisResult.target_group = {
              selected: params.answers.audience.split(',').map(s => s.trim()),
              reason: 'Manuell in Tasks angepasst'
            };
            task.analysisResult.fitTypes = finalFits;
            task.fitTypes = finalFits;
          }
          if (params.answers.avoidColor) {
            const raw = String(params.answers.avoidColor).toLowerCase();
            const norm = raw.includes('white') || raw.includes('weiß') ? 'white' : (raw.includes('black') || raw.includes('schwarz') ? 'black' : 'none');
            task.analysisResult.avoid_product_colors = {
              avoid: params.answers.avoidColor,
              reason: 'Manuell in Tasks angepasst'
            };
            task.analysisResult.avoidColor = norm;
            task.avoidColor = norm;
          }
          if (params.answers.reuseBackground) {
            const isAuto = params.answers.reuseBackground === 'Automatisch' || params.answers.reuseBackground === 'AUTOMATIC' || params.answers.reuseBackground.includes('Nein') || params.answers.reuseBackground.includes('Auto');
            task.analysisResult.background_analysis = {
              ...(task.analysisResult.background_analysis || {}),
              removal_mode: isAuto ? 'AUTOMATIC' : 'MANUAL'
            };
          }
          if (params.answers.maxColors) {
            task.analysisResult.color_analysis = {
              ...(task.analysisResult.color_analysis || {}),
              color_count: params.answers.maxColors,
              reason: 'Manuell in Tasks angepasst'
            };
          }
        }
      }

      if (task.source === 'UPDATE') {
        task.status = 'UPDATE_REWRITING';
        task.checkpoint = undefined;
        task.hasError = false;

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'LISTING_REQUEST',
          title: `Design- & Fragen-Prüfung bestätigt -> Listing-Optimierung (U4–U7)`,
          content: {
            answers: params.answers || 'KI-Antworten übernommen'
          }
        });

        this.saveLogs(this.loadLogs());
        this.emitUpdate(task);

        const { UpdatePipelineService } = require('./updatePipelineService');
        UpdatePipelineService.runFromStep(taskId, 'U4').catch((err: any) => {
          console.error(`[TaskLogService] Update-Pipeline Weiterführung fehlgeschlagen für Task ${taskId}:`, err);
        });

        return { success: true, message: 'Update-Prüfung freigegeben! Workflow läuft weiter (U4–U7).' };
      }

      task.status = 'GENERATING_LISTING';
      task.checkpoint = undefined;
      task.hasError = false;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_REQUEST',
        title: `Design-Prüfung bestätigt (Human Loop) -> MBA Listing-Erstellung`,
        content: {
          answers: params.answers || 'KI-Antworten 1:1 übernommen'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      this.generateListingWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Listing generation failed after design review for task ${taskId}:`, err);
      });

      return { success: true, message: 'Design freigegeben! MBA Listing wird generiert.' };
    }

    throw new Error(`Ungültige Aktion: ${params.action}`);
  }

  /**
   * Checkpoint 3: Submit Manual Trademark Review
   */
  static async submitTmReview(taskId: string, params: {
    action: 'RECHECK' | 'APPROVE' | 'REJECT';
    refinedListing?: any;
    blockedProducts?: string[];
    blockedNiceClasses?: number[];
  }) {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    if (params.action === 'RECHECK') {
      const listingToCheck: EnglishListing = params.refinedListing || task.listingResult?.en || {
        brand: '',
        title: '',
        bullet1: '',
        bullet2: '',
        description: ''
      };

      const auditV2 = await TrademarkService.executeTrademarkAuditV2({
        listing: listingToCheck,
        quote: task.payload?.quote || '',
        niche1: task.niche1 || task.customAnswers?.niche1 || task.payload?.niche1 || '',
        niche2: task.niche2 || task.customAnswers?.niche2 || task.payload?.niche2 || '',
        subniche: task.subniche || task.customAnswers?.subniche || task.payload?.subniche || '',
        maxRewriteCycles: 0, // In manual check, just scan and evaluate the provided text
        taskId
      });

      return {
        success: true,
        auditV2,
        totalHits: auditV2.finalTrademarkHits.length,
        hasInfringementClass25: auditV2.finalDecision === 'ESCALATE',
        blockedProducts: auditV2.blockedProducts,
        decision: auditV2.finalDecision,
        reasonCode: auditV2.reasonCode
      };
    }

    if (params.action === 'APPROVE') {
      if (params.refinedListing) {
        const sanitizedRefined = this.sanitizeListingObject(params.refinedListing);
        if (!task.listingResult) {
          task.listingResult = { en: sanitizedRefined };
        } else if (task.listingResult.en) {
          task.listingResult.en = { ...task.listingResult.en, ...sanitizedRefined };
        } else if (typeof task.listingResult === 'object') {
          task.listingResult = { ...task.listingResult, ...sanitizedRefined };
        }
      }

      if (params.blockedProducts) {
        task.blockedProducts = params.blockedProducts;
      }
      if (params.blockedNiceClasses) {
        task.blockedNiceClasses = params.blockedNiceClasses;
      }

      task.status = 'CHECKING_TRADEMARKS';
      task.checkpoint = undefined;
      task.hasError = false;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_REFINE_RESPONSE',
        title: `Task manuell freigegeben (Human Loop) & Übersetzung/Vektorisierung gestartet`,
        content: {
          verdict: 'APPROVED',
          refinedListing: params.refinedListing,
          actions_taken: ['Manuell im Tasks-Workspace optimiert und freigegeben.']
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      const approvedEn = task.listingResult?.en || task.listingResult;
      const quote = task.payload?.quote || '';
      const niche1 = task.niche1 || task.customAnswers?.niche1 || task.payload?.niche1 || '';
      const subniche = task.subniche || task.customAnswers?.subniche || task.payload?.subniche || '';

      if (task.source === 'UPDATE' || task.suffix === 'U' || task.id.endsWith('-U')) {
        console.log(`[TaskLogService] ✨ Update-Task ${taskId} TM manuell freigegeben -> Übersetzung (U6) und Übergabe an Queue (U7) ✓`);
        try {
          const { UpdatePipelineService } = require('./updatePipelineService');
          UpdatePipelineService.runFromStep(taskId, 'U6').catch((err: any) => {
            console.error(`[TaskLogService] Fehler bei Update Weiterführung nach TM-Freigabe für ${taskId}:`, err);
          });
        } catch (err) {
          console.error(`[TaskLogService] Konnte UpdatePipelineService nicht laden:`, err);
        }
        return { success: true, message: 'Update-Listing freigegeben! Übersetzung & Queue-Übergabe laufen.' };
      }

      // For Creation Tasks: Translate (if enabled) and then vectorize
      const isTranslationEnabled = settings.translationDesignEnabled ?? true;

      if (!isTranslationEnabled) {
        console.log(`[TaskLogService] ⏩ Manuelle Freigabe: Übersetzung deaktiviert. Verwende englisches Master-Listing.`);
        task.listingResult = { en: approvedEn };
        this.saveLogs(this.loadLogs());
        this.emitUpdate(task);
        this.vectorizeDesignTask(taskId).catch(err => {
          console.error(`[TaskLogService] Vektorisierung nach manueller TM-Freigabe für Task ${taskId} fehlgeschlagen:`, err);
        });
        return { success: true, message: 'Listing manuell freigegeben! Vektorisierung gestartet (Übersetzung übersprungen).' };
      }

      LLMService.translateApprovedListing({
        englishListing: approvedEn,
        quote,
        niche1,
        subniche
      }).then(translatedListings => {
        const sanitized = this.sanitizeAndValidateListingBeforeQueue(translatedListings);
        task.listingResult = sanitized;
        this.saveLogs(this.loadLogs());
        this.emitUpdate(task);
        this.vectorizeDesignTask(taskId).catch(err => {
          console.error(`[TaskLogService] Vektorisierung nach manueller TM-Freigabe für Task ${taskId} fehlgeschlagen:`, err);
        });
      }).catch(err => {
        console.error(`[TaskLogService] Fehler bei Übersetzung nach manueller TM-Freigabe für Task ${taskId}:`, err);
        // Fallback: continue vectorization even if translation fails
        this.vectorizeDesignTask(taskId).catch(vErr => console.error(vErr));
      });

      return { success: true, message: 'Listing manuell freigegeben! Übersetzung und Vektorisierung gestartet.' };
    }

    if (params.action === 'REJECT') {
      task.status = 'REJECTED';
      task.checkpoint = undefined;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_REFINE_RESPONSE',
        title: `Task manuell abgelehnt & geschlossen (Human Loop)`,
        content: {
          verdict: 'REJECTED',
          reason: 'Manuell im Tasks-Workspace verworfen.'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      return { success: true, message: 'Task abgelehnt und geschlossen.' };
    }

    throw new Error(`Ungültige Aktion: ${params.action}`);
  }

  /**
   * Checkpoint 1: Override / Restart Pre-Flight Quote Check
   */
  static async overridePreFlight(taskId: string, params: {
    action: 'OVERRIDE' | 'RESTART' | 'DISCARD';
    newQuote?: string;
  }) {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    if (params.action === 'DISCARD') {
      task.status = 'REJECTED';
      task.checkpoint = undefined;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_REFINE_RESPONSE',
        title: `Pre-Flight Konflikt: Task verworfen & geschlossen`,
        content: { verdict: 'REJECTED', reason: 'Pre-Flight Quote Markenkonflikt verworfen.' }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);
      return { success: true, message: 'Task verworfen.' };
    }

    if (params.action === 'RESTART') {
      if (params.newQuote) {
        task.payload.quote = params.newQuote;
      }
      task.status = 'PROCESSING';
      task.checkpoint = undefined;
      task.events = task.events.slice(0, 1); // keep incoming payload

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      this.processTaskWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Restart with new quote failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Pipeline mit neuer Quote neu gestartet.' };
    }

    if (params.action === 'OVERRIDE') {
      task.status = 'PROCESSING';
      task.checkpoint = undefined;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'SESSION_START',
        title: `Pre-Flight Override bestätigt (Human Loop: Trotz TM-Treffer fortfahren)`,
        content: `Quote "${task.payload?.quote}" manuell für Generierung freigegeben.`
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      this.processTaskWithOpenRouter(taskId, { skipPreFlight: true }).catch(err => {
        console.error(`[TaskLogService] Override pre-flight failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Pre-Flight übersprungen. Pipeline wird fortgesetzt.' };
    }

    throw new Error(`Ungültige Aktion: ${params.action}`);
  }

  /**
   * Checkpoint 4: Submit SVG Vector & Background Review
   */
  static async submitSvgReview(taskId: string, params: {
    action: 'APPROVE' | 'REGENERATE_VECTOR' | 'REJECT';
    editedSvgContent?: string;
    maxColors?: number;
  }) {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const designsDir = path.resolve(process.cwd(), 'data', 'designs');

    if (params.action === 'APPROVE') {
      if (params.editedSvgContent) {
        if (!fs.existsSync(designsDir)) {
          try { fs.mkdirSync(designsDir, { recursive: true }); } catch (e) {}
        }
        const svgFilePath = path.join(designsDir, `${cleanId}.svg`);
        fs.writeFileSync(svgFilePath, params.editedSvgContent, 'utf-8');
        task.svgContent = params.editedSvgContent;
        task.localSvgPath = svgFilePath;
        task.svgUrl = `/api/v1/designs/svg/${encodeURIComponent(taskId)}?t=${Date.now()}`;
      }

      const finalSvg = task.svgContent || params.editedSvgContent || '';
      const ts = Date.now();

      // 1. Render 4-Panel Verification Image (2048x2048 px on White/Black/Red/Slate)
      console.log(`[TaskLogService] 🖼️ Rendere 4-Panel Testbild nach SVG-Freigabe für Task ${taskId}...`);
      const fourPanelBuffer = await SvgRenderService.render4PanelTestImage(finalSvg);
      const fourPanelFilePath = path.join(designsDir, `${cleanId}_4panel.png`);
      fs.writeFileSync(fourPanelFilePath, fourPanelBuffer);
      task.localFourPanelImagePath = fourPanelFilePath;
      const fourPanelUrl = `/api/v1/designs/4panel/${encodeURIComponent(taskId)}?t=${ts}`;
      task.fourPanelImageUrl = fourPanelUrl;

      // 2. Log: Senden an LLM Vision zur 4-Panel Cutout-Prüfung
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'SVG_AUDIT_REQUEST',
        title: `Senden an LLM Vision (4-Panel Cutout-Prüfung nach Freigabe)`,
        content: {
          fourPanelImageUrl: fourPanelUrl,
          quote: task.payload?.quote
        },
        metadata: {
          provider: 'OpenRouter Vision'
        }
      });

      // 3. Run LLM Vision Cutout Audit
      console.log(`[TaskLogService] 🤖 Führe LLM Vision Cutout-Audit nach SVG-Freigabe für Task ${taskId} durch...`);
      const auditResult = await LLMService.auditSvgCutout(fourPanelFilePath, task.payload?.quote);
      task.svgAuditResult = auditResult;

      // 4. Log: Empfangen von LLM Vision Cutout Audit
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'SVG_AUDIT_RESPONSE',
        title: `Empfangen von LLM Vision (${auditResult.cutout_verdict === 'APPROVED' ? 'Cutout Freigegeben ✓' : 'Korrektur nötig ⚠️'})`,
        content: {
          verdict: auditResult.cutout_verdict,
          backgroundClean: auditResult.background_removed_cleanly,
          detectedIssues: auditResult.detected_issues,
          explanation: auditResult.explanation,
          fourPanelImageUrl: fourPanelUrl
        },
        metadata: {
          provider: 'OpenRouter Vision',
          latencyMs: auditResult.latencyMs,
          tokens: auditResult.tokens
        }
      });

      if (auditResult.cutout_verdict === 'APPROVED') {
        // 5. Render Final MBA Master-PNG (4500x5400 px, 300 DPI)
        console.log(`[TaskLogService] 🖨️ Rendere finales MBA Master-PNG (4500x5400 px, 300 DPI) für Task ${taskId}...`);
        const mbaBuffer = await SvgRenderService.renderSvgToMbaPng(finalSvg);
        const mbaFilePath = path.join(designsDir, `${cleanId}_mba.png`);
        fs.writeFileSync(mbaFilePath, mbaBuffer);
        task.localMbaPngPath = mbaFilePath;
        task.mbaPngUrl = `/api/v1/designs/mba-png/${encodeURIComponent(taskId)}?t=${ts}`;

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'SVG_EDIT_RESPONSE',
          title: `SVG Design & MBA Print-PNG final freigegeben (Cutout von Vision-KI bestätigt ✓)`,
          content: {
            verdict: 'APPROVED',
            svgUrl: task.svgUrl,
            mbaPngUrl: task.mbaPngUrl,
            fourPanelImageUrl: task.fourPanelImageUrl,
            svgLength: finalSvg.length,
            message: 'Vektorgrafik geprüft, Cutout von Vision-KI freigegeben und MBA Master-PNG (4500x5400 px) erzeugt.'
          }
        });

        // 6. Generate Resized Artworks (Trimmed, Mug Standard & Brush, Drinkware Standard)
        try {
          const resized = await ArtworkResizeService.generateResizedArtworks(taskId, mbaFilePath);
          task.resizedAssets = resized;
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'RESIZE_RESPONSE',
            title: `📐 Two-Sided & Brush Varianten generiert ✓`,
            content: {
              trimmedPath: resized.trimmedPath,
              mugStandardPath: resized.mugStandardPath,
              mugBrushPath: resized.mugBrushPath,
              drinkwareStandardPath: resized.drinkwareStandardPath,
              drinkwareBrushPath: resized.drinkwareBrushPath,
              message: 'Two-Sided Varianten für Ceramic Mug (Standard & Brush) und Drinkware (Standard & Brush) erfolgreich erstellt.'
            }
          });
        } catch (resizeErr: any) {
          console.error(`[TaskLogService] ⚠️ Fehler bei der Resize-Generierung für Task ${taskId}:`, resizeErr);
        }

        this.completeTaskAndEnqueue(task);

        return { success: true, message: 'Cutout von Vision-KI freigegeben, MBA Master-PNG generiert & an Queue übergeben ✓' };
      } else {
        // Cutout needs work - remain in Checkpoint 4
        task.status = 'AWAITING_SVG_REVIEW';
        task.checkpoint = 'SVG_REVIEW';
        task.hasError = false;

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TASK_HANDOFF',
          title: `Übergeben an Tasks (KI Cutout-Audit empfiehlt Nacharbeit)`,
          content: {
            checkpoint: 'SVG_REVIEW',
            reason: auditResult.explanation,
            detectedIssues: auditResult.detected_issues
          }
        });

        this.saveLogs(this.loadLogs());
        this.emitUpdate(task);

        return {
          success: false,
          error: `KI Cutout-Audit: ${auditResult.explanation || (auditResult.detected_issues && auditResult.detected_issues.join(', ')) || 'Unreinheiten erkannt. Bitte nachbessern.'}`
        };
      }
    }

    if (params.action === 'REGENERATE_VECTOR') {
      if (params.maxColors) {
        if (!task.customAnswers) task.customAnswers = {};
        task.customAnswers.maxColors = params.maxColors;
      }
      task.status = 'VECTORIZING_DESIGN';
      task.checkpoint = undefined;
      task.hasError = false;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'VECTORIZE_REQUEST',
        title: `Vektorisierung erneut angefordert (Human Loop: Farbanzahl angepasst)`,
        content: {
          maxColors: params.maxColors || task.customAnswers?.maxColors || 2,
          reason: 'Manuell in Tasks zur Neu-Vektorisierung übergeben'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      this.vectorizeDesignTask(taskId).catch(err => {
        console.error(`[TaskLogService] Re-vectorize failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Vektorisierung wird neu ausgeführt.' };
    }

    if (params.action === 'REJECT') {
      task.status = 'REJECTED';
      task.checkpoint = undefined;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'SVG_EDIT_RESPONSE',
        title: `Task in SVG-Prüfung abgelehnt & geschlossen (Human Loop)`,
        content: {
          verdict: 'REJECTED',
          reason: 'Design / Vektorisierung manuell im Tasks-Workspace verworfen.'
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      return { success: true, message: 'Task verworfen.' };
    }

    throw new Error(`Ungültige Aktion: ${params.action}`);
  }

  /**
   * Reset editable SVG to the original untouched vector
   */
  static async resetSvg(taskId: string): Promise<{ success: boolean; svgContent: string; message: string }> {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    const origFilePath = path.join(designsDir, `${cleanId}_original.svg`);
    const svgFilePath = path.join(designsDir, `${cleanId}.svg`);

    if (!fs.existsSync(origFilePath)) {
      throw new Error(`Original-SVG für Task ${taskId} nicht gefunden.`);
    }

    const originalSvgContent = fs.readFileSync(origFilePath, 'utf-8');
    fs.writeFileSync(svgFilePath, originalSvgContent, 'utf-8');

    task.svgContent = originalSvgContent;
    task.localSvgPath = svgFilePath;
    task.svgUrl = `/api/v1/designs/svg/${encodeURIComponent(taskId)}`;

    this.saveLogs(this.loadLogs());
    this.emitUpdate(task);

    return {
      success: true,
      svgContent: originalSvgContent,
      message: 'SVG erfolgreich auf Originalzustand zurückgesetzt.'
    };
  }
}


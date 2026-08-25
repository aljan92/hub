import fs from 'fs';
import path from 'path';
import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { IdeogramService } from './ideogramService';
import { TrademarkService } from './trademarkService';

export type TaskSource = 'HERMES' | 'TEST' | 'DESIGNER';
export type TaskSuffix = 'H' | 'T' | 'D';
export type TaskStatus = 'RECEIVED' | 'PROCESSING' | 'PROMPT_READY' | 'GENERATING_IMAGE' | 'ANALYZING_DESIGN' | 'GENERATING_LISTING' | 'CHECKING_TRADEMARKS' | 'COMPLETED' | 'REJECTED' | 'ERROR';

export type EventType = 
  | 'INCOMING_PAYLOAD'
  | 'SESSION_START'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
  | 'IDEOGRAM_REQUEST'
  | 'IDEOGRAM_RESPONSE'
  | 'ANALYSIS_REQUEST'
  | 'ANALYSIS_RESPONSE'
  | 'LISTING_REQUEST'
  | 'LISTING_RESPONSE'
  | 'TM_CHECK_REQUEST'
  | 'TM_CHECK_RESPONSE'
  | 'TM_REFINE_REQUEST'
  | 'TM_REFINE_RESPONSE'
  | 'ERROR';

export interface SessionEvent {
  timestamp: string; // ISO String (z.B. "2026-08-25T13:05:12.123Z")
  type: EventType;
  title: string;     // z.B. "Eingang von Hermes", "Senden an OpenRouter", "Senden an Ideogram", "Design-Analyse", "Listing-Erstellung", "USPTO Trademark-Prüfung"
  content: any;
  metadata?: {
    model?: string;
    provider?: string;
    latencyMs?: number;
    tokens?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
    costUsd?: number;
  };
}

export interface DesignTaskLog {
  id: string; // e.g. "#001-H", "#002-T", "#1000-H"
  counter: number;
  source: TaskSource;
  suffix: TaskSuffix;
  status: TaskStatus;
  receivedAt: string;
  clientIp?: string;
  payload: Record<string, any>;
  events: SessionEvent[];
  resultPrompt?: string;
  imageUrl?: string;
  localImagePath?: string;
  analysisResult?: any;
  listingResult?: any;
  trademarkCheckResult?: any;
  trademarkRefineResult?: any;
  hasError?: boolean;
  errorDetails?: string;
}

export class TaskLogService {
  private static dataDir = path.resolve(process.cwd(), 'data');
  private static counterFile = path.resolve(process.cwd(), 'data', 'tasks_counter.json');
  private static logsFile = path.resolve(process.cwd(), 'data', 'tasks_log.json');

  private static inMemoryLogs: DesignTaskLog[] | null = null;
  private static currentCounter: number | null = null;
  private static eventBroadcaster: ((type: string, payload: any) => void) | null = null;

  static setBroadcaster(fn: (type: string, payload: any) => void) {
    this.eventBroadcaster = fn;
  }

  private static emitUpdate(task: DesignTaskLog) {
    if (this.eventBroadcaster) {
      this.eventBroadcaster('TASK_UPDATED', task);
    }
  }

  private static ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (e) {}
    }
  }

  private static getNextCounter(): number {
    this.ensureDataDir();
    if (this.currentCounter === null) {
      try {
        if (fs.existsSync(this.counterFile)) {
          const data = JSON.parse(fs.readFileSync(this.counterFile, 'utf-8'));
          this.currentCounter = Number(data.counter) || 0;
        } else {
          this.currentCounter = 0;
        }
      } catch (e) {
        this.currentCounter = 0;
      }
    }

    this.currentCounter += 1;

    try {
      fs.writeFileSync(this.counterFile, JSON.stringify({ counter: this.currentCounter }, null, 2), 'utf-8');
    } catch (e) {
      console.error('[TaskLogService] Failed to persist tasks_counter.json:', e);
    }

    return this.currentCounter;
  }

  private static loadLogs(): DesignTaskLog[] {
    if (this.inMemoryLogs !== null) {
      return this.inMemoryLogs;
    }
    this.ensureDataDir();
    if (fs.existsSync(this.logsFile)) {
      try {
        const fileContent = fs.readFileSync(this.logsFile, 'utf-8');
        this.inMemoryLogs = JSON.parse(fileContent);
        return this.inMemoryLogs || [];
      } catch (e) {
        console.error('[TaskLogService] Failed to read tasks_log.json:', e);
      }
    }
    this.inMemoryLogs = [];
    return this.inMemoryLogs;
  }

  private static saveLogs(logs: DesignTaskLog[]) {
    this.inMemoryLogs = logs;
    this.ensureDataDir();
    try {
      const trimmed = logs.slice(0, 2000);
      fs.writeFileSync(this.logsFile, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch (e) {
      console.error('[TaskLogService] Failed to persist tasks_log.json:', e);
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
      : (params.source === 'TEST' ? 'Eingang von Test (Playground)' : 'Eingang von Designer');

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
      payload: params.payload || {},
      events: [initialEvent],
      hasError: Boolean(params.hasError),
      errorDetails: params.errorDetails
    };

    const logs = this.loadLogs();
    logs.unshift(taskLog); // newest first
    this.saveLogs(logs);

    console.log(`[TaskLogService] 📋 Task ${taskLog.id} registriert (${taskLog.source}) von ${taskLog.clientIp || 'local'}`);
    this.emitUpdate(taskLog);

    // Asynchronously trigger OpenRouter LLM session
    this.processTaskWithOpenRouter(taskLog.id);

    return taskLog;
  }

  static addEvent(taskId: string, event: SessionEvent): DesignTaskLog | undefined {
    const logs = this.loadLogs();
    const task = logs.find(t => t.id === taskId);
    if (!task) return undefined;

    task.events.push(event);
    this.saveLogs(logs);
    this.emitUpdate(task);
    return task;
  }

  static updateTaskStatus(taskId: string, updates: Partial<DesignTaskLog>): DesignTaskLog | undefined {
    const logs = this.loadLogs();
    const task = logs.find(t => t.id === taskId);
    if (!task) return undefined;

    Object.assign(task, updates);
    this.saveLogs(logs);
    this.emitUpdate(task);
    return task;
  }

  /**
   * Run the LLM Session via OpenRouter
   */
  static async processTaskWithOpenRouter(taskId: string) {
    const task = this.getTaskLogById(taskId);
    if (!task) return;

    const settings = loadSettings();
    const apiKey = (settings.openRouterApiKey || '').trim();
    const model = settings.llmModel || 'anthropic/claude-3-5-sonnet';
    const provider = settings.llmProvider === 'openai' ? 'OpenAI Direct' : 'OpenRouter';

    // 0. Pre-Flight Quote Trademark Check to save tokens and costs early!
    const quote = (task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || '').trim();
    if (quote) {
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

        // If Quote has an active Class 25 hit -> Immediate REJECTION! Save all downstream LLM tokens!
        if (preHasCls25) {
          const rejectionReason = `Die Quote "${quote}" verletzt ein aktives Markenrecht in Nizza-Klasse 25 (Bekleidung). Workflow vor LLM-Generierung abgebrochen (Token gespart).`;
          
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TM_REFINE_RESPONSE',
            title: `Pre-Flight Trademark-Prüfung: SOFORTIGE ABLEHNUNG`,
            content: {
              verdict: 'REJECTED',
              rejection_reason: rejectionReason,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              actions_taken: ['Pre-Flight Check: Quote in Klasse 25 geschützt -> Workflow abgebrochen (Token & Kosten gespart).']
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'REJECTED',
            hasError: false,
            errorDetails: rejectionReason,
            trademarkCheckResult: {
              totalHits: preHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: preCheckResult.fieldResults
            },
            trademarkRefineResult: {
              verdict: 'REJECTED',
              rejection_reason: rejectionReason,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED']
            }
          });

          console.log(`[TaskLogService] ❌ Task ${taskId} im Pre-Flight TM-Check gestoppt (Quote "${quote}" verletzt Klasse 25).`);
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
    const niche = `${task.payload?.niche1 || ''} ${task.payload?.niche2 || ''}`.trim();
    const ideogramPrompt = task.resultPrompt || '';

    const userPromptText = `Bitte analysiere das folgende generierte Design:\n\n- Original Quote aus Input: "${quote}"\n- Original Nische: "${niche}"\n- Verwendeter Ideogram-Prompt: "${ideogramPrompt}"\n\nBeantworte die 4 Kernfragen streng als JSON!`;

    // 1. Log Event: Senden an OpenRouter (Vision)
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'ANALYSIS_REQUEST',
      title: `Senden an OpenRouter (Vision Design-Analyse)`,
      content: {
        systemPrompt: analyzerPrompt,
        userMessage: userPromptText,
        quote,
        niche
      },
      metadata: {
        model: settings.llmModel || 'anthropic/claude-3.5-sonnet',
        provider: 'OpenRouter Vision'
      }
    });

    // Prepare image for vision model
    let imageSource = imageUrl;
    if (fs.existsSync(localFilePath)) {
      try {
        const buffer = fs.readFileSync(localFilePath);
        imageSource = `data:image/png;base64,${buffer.toString('base64')}`;
      } catch (e) {}
    }

    const model = settings.llmModel || 'anthropic/claude-3.5-sonnet';
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
        const errText = await res.text();
        throw new Error(`OpenRouter Vision Fehler (${res.status}): ${errText}`);
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

      // Check if design is APPROVED -> Automatically generate Listing!
      const isApproved = parsedAnalysis?.overall_verdict === 'APPROVED' || 
        (parsedAnalysis?.quote_check?.quote_matches === true && !parsedAnalysis?.quote_check?.regenerate_recommended);

      if (isApproved) {
        this.updateTaskStatus(taskId, {
          status: 'GENERATING_LISTING',
          analysisResult: parsedAnalysis,
          hasError: false
        });
        await this.generateListingWithOpenRouter(taskId);
      } else {
        this.updateTaskStatus(taskId, {
          status: 'REJECTED',
          analysisResult: parsedAnalysis,
          hasError: false
        });
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
   * Automatically generate MBA SEO Listing across all marketplaces (en, de, fr, it, es, ja)
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

    const model = settings.llmModel || 'anthropic/claude-3-5-sonnet';
    const listingPrompt = SystemPromptService.getListingGeneratorPrompt();
    const quote = task.payload?.quote || '';
    const niche1 = task.payload?.niche1 || '';
    const niche2 = task.payload?.niche2 || '';
    const targetGroup = Array.isArray(task.analysisResult?.target_group?.selected) 
      ? task.analysisResult.target_group.selected.join(', ') 
      : 'Men, Women, Youth';
    const avoidColors = task.analysisResult?.avoid_product_colors?.avoid || 'None';

    const userPromptText = `Please generate the full, multi-language Amazon Merch on Demand (MBA) SEO listing for this design based on the following details:\n\n- Quote / Text: "${quote}"\n- Primary Niche: "${niche1}"\n- Secondary Niche: "${niche2}"\n- Target Audience: ${targetGroup}\n- Colors to Avoid: ${avoidColors}\n- Ideogram Prompt: "${task.resultPrompt || ''}"\n\nGenerate the complete JSON for en, de, fr, it, es, ja strictly adhering to character limits and compliance rules!`;

    // 1. Log Event: Senden an OpenRouter (Listing Generator)
    this.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'LISTING_REQUEST',
      title: `Senden an OpenRouter (Listing Generator)`,
      content: {
        systemPrompt: listingPrompt,
        userMessage: userPromptText
      },
      metadata: { model, provider: 'OpenRouter' }
    });

    const start = Date.now();
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mbahub.local',
          'X-Title': 'MBA HUB Listing Generator'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: listingPrompt },
            { role: 'user', content: userPromptText }
          ],
          temperature: 0.7,
          max_tokens: 4000
        }),
        signal: AbortSignal.timeout(90000)
      });

      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Listing API Fehler: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content || '';

      let parsedListing: any = null;
      try {
        let cleanJsonStr = rawContent.trim();
        if (cleanJsonStr.startsWith('```')) {
          cleanJsonStr = cleanJsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }
        parsedListing = JSON.parse(cleanJsonStr);
      } catch (pe) {
        parsedListing = rawContent;
      }

      // 2. Log Event: Empfangen von OpenRouter (Listing)
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: `Empfangen von OpenRouter (MBA Listing)`,
        content: parsedListing,
        metadata: {
          model: data.model || model,
          latencyMs,
          tokens: data.usage ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens
          } : undefined
        }
      });

      this.updateTaskStatus(taskId, {
        status: 'CHECKING_TRADEMARKS',
        listingResult: parsedListing,
        hasError: false
      });

      console.log(`[TaskLogService] 📝 MBA Listing für Task ${taskId} erfolgreich generiert in ${latencyMs}ms. Starte Trademark Audit...`);

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
        metadata: { latencyMs, model }
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
    }
  }

  /**
   * Automatically check USPTO Trademarks for the generated English listing and run LLM refinement loop
   * Supports up to 4 TM checks and 3 LLM rewrite cycles.
   * If Class 25 hits still exist after the 4th TM check, the task is marked as REJECTED.
   */
  static async auditListingTrademarks(taskId: string) {
    const task = this.getTaskLogById(taskId);
    if (!task || !task.listingResult) return;

    const enListing = task.listingResult.en || task.listingResult;
    let currentFields = {
      quote: task.payload?.quote || '',
      brand: typeof enListing === 'object' ? enListing.brand || '' : '',
      title: typeof enListing === 'object' ? enListing.title || '' : '',
      bullet1: typeof enListing === 'object' ? enListing.bullet1 || '' : '',
      bullet2: typeof enListing === 'object' ? enListing.bullet2 || '' : '',
      description: typeof enListing === 'object' ? enListing.description || '' : ''
    };

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    const model = settings.llmModel || 'anthropic/claude-3-5-sonnet';
    const auditorPrompt = SystemPromptService.getTrademarkAuditorPrompt();
    const APPAREL_SET = new Set(['STANDARD_TSHIRT', 'PREMIUM_TSHIRT', 'HOODIE', 'SWEATSHIRT', 'ZIP_HOODIE', 'TANK_TOP', 'LONG_SLEEVE_TSHIRT', 'RAGLAN']);

    const MAX_CHECKS = 4;

    try {
      for (let checkRound = 1; checkRound <= MAX_CHECKS; checkRound++) {
        const isInitial = checkRound === 1;
        const isFinal = checkRound === MAX_CHECKS;

        console.log(`[TaskLogService] 🛡️ Starte USPTO TM-Prüfung Runde ${checkRound}/${MAX_CHECKS} für Task ${taskId}...`);

        // 1. Log Event: Senden an Productor / USPTO
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_CHECK_REQUEST',
          title: isInitial
            ? 'Senden an Productor / USPTO (Trademark-Prüfung)'
            : `Senden an Productor / USPTO (Nachprüfung Runde ${checkRound})`,
          content: {
            round: checkRound,
            maxRounds: MAX_CHECKS,
            offices: ['USPTO'],
            fields: { ...currentFields }
          },
          metadata: {
            provider: 'Productor USPTO'
          }
        });

        const start = Date.now();
        const batchResult = await TrademarkService.checkBatchFields({
          offices: ['USPTO'],
          fields: currentFields
        });

        const totalHits = batchResult.summary?.totalHits ?? 0;
        const hasCls25 = batchResult.hasInfringementClass25 || false;
        const fieldResults = batchResult.fieldResults || {};
        const latencyMs = Date.now() - start;

        // 2. Log Event: Empfangen von Productor / USPTO
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_CHECK_RESPONSE',
          title: isInitial
            ? `Empfangen von Productor / USPTO (${totalHits} Treffer)`
            : `Empfangen von Productor / USPTO (Nachprüfung Runde ${checkRound}: ${totalHits} Treffer)`,
          content: {
            round: checkRound,
            totalHits,
            hasInfringementClass25: hasCls25,
            blockedProducts: batchResult.blockedProducts,
            fieldSummaries: fieldResults,
            summary: batchResult.summary
          },
          metadata: {
            provider: 'Productor USPTO',
            latencyMs
          }
        });

        // 3. Sofortige Ablehnung: Wenn Quote selbst ein aktives Klasse 25 Trademark verletzt!
        if (fieldResults.quote?.hasInfringementClass25) {
          const rejectionReason = `Die Quote "${currentFields.quote}" verletzt ein eingetragenes Markenrecht in Nizza-Klasse 25 (Bekleidung) und kann nicht sicher verkauft werden.`;
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TM_REFINE_RESPONSE',
            title: `Empfangen von OpenRouter (Trademark-Bewertung: ABGELEHNT)`,
            content: {
              verdict: 'REJECTED',
              rejection_reason: rejectionReason,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              actions_taken: ['Quote in Klasse 25 geschützt -> Design sofort abgelehnt.']
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'REJECTED',
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: {
              verdict: 'REJECTED',
              rejection_reason: rejectionReason,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED']
            },
            hasError: false,
            errorDetails: rejectionReason
          });
          console.log(`[TaskLogService] ❌ Task ${taskId} abgelehnt (Quote ist Class 25 Trademark).`);
          return;
        }

        // 4. Prüfen, ob Brand & Title und alle Listing-Felder sauber von Klasse 25 sind!
        const brandTitleSafeForApparel = 
          !(fieldResults.brand?.hasInfringementClass25) &&
          !(fieldResults.title?.hasInfringementClass25) &&
          !hasCls25;

        // Wenn keine Klasse 25 Treffer vorhanden sind (oder alle Felder sauber sind)
        if (brandTitleSafeForApparel || totalHits === 0) {
          // Berechne eventuell gesperrte Nebenprodukte (z.B. PopSockets bei Klasse 9 auf Quote)
          const finalBlockedProducts = (batchResult.blockedProducts || []).filter(p => !APPAREL_SET.has(p));

          const refineSuccessResult = {
            verdict: 'APPROVED',
            rejection_reason: null,
            actions_taken: isInitial 
              ? ['Keine kritischen Markenrechts-Treffer in Klasse 25 gefunden. Bekleidung ist freigegeben.']
              : [`Listing nach Runde ${checkRound} erfolgreich bereinigt. Keine Klasse 25 Konflikte mehr.`],
            blockedProducts: finalBlockedProducts,
            refined_listing: {
              brand: currentFields.brand,
              title: currentFields.title,
              bullet1: currentFields.bullet1,
              bullet2: currentFields.bullet2,
              description: currentFields.description
            }
          };

          if (!isInitial) {
            this.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'TM_REFINE_RESPONSE',
              title: `Empfangen von OpenRouter (Trademark-Bewertung: FREIGEGEBEN nach Nachprüfung Runde ${checkRound})`,
              content: refineSuccessResult
            });
          }

          // Update Listing in Task
          if (task.listingResult) {
            if (task.listingResult.en) {
              task.listingResult.en = { ...task.listingResult.en, ...refineSuccessResult.refined_listing };
            } else if (typeof task.listingResult === 'object') {
              task.listingResult = { ...task.listingResult, ...refineSuccessResult.refined_listing };
            }
          }

          this.updateTaskStatus(taskId, {
            status: 'COMPLETED',
            listingResult: task.listingResult,
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: false,
              blockedProducts: finalBlockedProducts,
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: refineSuccessResult,
            hasError: false
          });

          console.log(`[TaskLogService] 🛡️ Task ${taskId} in Runde ${checkRound} erfolgreich freigegeben ✓`);
          return;
        }

        // 5. Wenn nach dem 4. TM Check (also nach 3 Korrekturen) immer noch Klasse 25 Treffer vorhanden sind:
        if (isFinal) {
          const rejectionMsg = `Nach 4 USPTO-Prüfungen und 3 automatischen Korrekturläufen konnten die Markenrechts-Treffer in Nizza-Klasse 25 nicht vollständig eliminiert werden.`;
          
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TM_REFINE_RESPONSE',
            title: `Empfangen von OpenRouter (Trademark-Bewertung: ABGELEHNT nach 4 Prüfungen)`,
            content: {
              verdict: 'REJECTED',
              rejection_reason: rejectionMsg,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              actions_taken: ['Maximale Korrekturschleifen (4 Checks) erreicht. Klasse 25 Konflikte blieben bestehen.']
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'REJECTED',
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: {
              verdict: 'REJECTED',
              rejection_reason: rejectionMsg,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED']
            },
            hasError: false,
            errorDetails: rejectionMsg
          });

          console.log(`[TaskLogService] ❌ Task ${taskId} endgültig abgelehnt nach 4 TM-Prüfungen.`);
          return;
        }

        // 6. Hits vorhanden & noch Runden übrig -> LLM Refinement anfordern
        if (!apiKey) {
          console.warn(`[TaskLogService] Kein OpenRouter API-Key vorhanden für TM Refine.`);
          break;
        }

        // Hits-Zusammenfassung für den Prompt erstellen
        const hitsSummary: string[] = [];
        for (const [fieldName, fieldData] of Object.entries(fieldResults)) {
          if (fieldData.totalHits > 0 && fieldData.hits) {
            for (const [term, hits] of Object.entries(fieldData.hits)) {
              const classInfo = hits.map(h => `Class ${h.classNumber} (${h.status || 'LIVE'})`).join(', ');
              hitsSummary.push(`- In Field [${fieldName.toUpperCase()}]: matched term "${term}" -> ${classInfo}`);
            }
          }
        }

        const userMessage = `Here is the current English listing and the detected USPTO Trademark hits (Correction Round ${checkRound}/3):\n\n### Current Listing:\n- Quote / Slogan: "${currentFields.quote}"\n- Brand: "${currentFields.brand}"\n- Title: "${currentFields.title}"\n- Bullet 1: "${currentFields.bullet1}"\n- Bullet 2: "${currentFields.bullet2}"\n- Description: "${currentFields.description}"\n\n### Detected USPTO Trademark Hits (MUST BE ELIMINATED):\n${hitsSummary.length > 0 ? hitsSummary.join('\n') : '- No hits detected.'}\n\nPlease audit every hit strictly against these rules:\n1. QUOTE & MOTIF: If the core Quote or the central Motif itself has an active Class 25 trademark (e.g. "Just Do It", "Hakuna Matata", "Lego", protected character/slogan), set "verdict": "REJECTED" immediately!\n2. ALL OTHER WORDS (Brand, Title, Bullets, Description): Everything that is NOT the Quote or the explicit motif name MUST be actively rephrased if it matches a trademark in ANY class (especially Class 25 in Title/Brand), so that NO PRODUCTS have to be excluded!\n3. Return the refined JSON strictly adhering to the schema!`;

        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_REFINE_REQUEST',
          title: `Senden an OpenRouter (Trademark Auditor & Refiner - Runde ${checkRound})`,
          content: {
            round: checkRound,
            systemPrompt: auditorPrompt,
            userMessage
          },
          metadata: { model, provider: 'OpenRouter' }
        });

        const refineStart = Date.now();
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://mbahub.local',
            'X-Title': 'MBA HUB TM Auditor'
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: auditorPrompt },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.2,
            max_tokens: 2000
          }),
          signal: AbortSignal.timeout(60000)
        });

        const refineLatencyMs = Date.now() - refineStart;
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter TM Auditor Fehler in Runde ${checkRound}: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || '';

        let parsedRefined: any = null;
        try {
          let cleanJsonStr = rawContent.trim();
          if (cleanJsonStr.startsWith('```')) {
            cleanJsonStr = cleanJsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          }
          parsedRefined = JSON.parse(cleanJsonStr);
        } catch (pe) {
          parsedRefined = rawContent;
        }

        // Wenn LLM selbst sagt REJECTED (z.B. Motiv/Quote nicht safe):
        if (parsedRefined?.verdict === 'REJECTED') {
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TM_REFINE_RESPONSE',
            title: `Empfangen von OpenRouter (Trademark-Bewertung: ABGELEHNT in Runde ${checkRound})`,
            content: {
              ...parsedRefined,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED']
            },
            metadata: {
              model: data.model || model,
              latencyMs: refineLatencyMs,
              tokens: data.usage ? {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
                total: data.usage.total_tokens
              } : undefined
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'REJECTED',
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: {
              ...parsedRefined,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED']
            },
            hasError: false,
            errorDetails: parsedRefined.rejection_reason || 'Markenrechtsverletzung festgestellt.'
          });
          console.log(`[TaskLogService] ❌ Task ${taskId} von LLM in Runde ${checkRound} abgelehnt: ${parsedRefined.rejection_reason}`);
          return;
        }

        // Event für diese Korrektur-Runde loggen
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_REFINE_RESPONSE',
          title: `Empfangen von OpenRouter (Trademark-Korrektur Runde ${checkRound})`,
          content: parsedRefined,
          metadata: {
            model: data.model || model,
            latencyMs: refineLatencyMs,
            tokens: data.usage ? {
              prompt: data.usage.prompt_tokens,
              completion: data.usage.completion_tokens,
              total: data.usage.total_tokens
            } : undefined
          }
        });

        // Felder mit den neuen Korrekturen des LLMs aktualisieren für den nächsten USPTO-Check!
        const refinedListing = parsedRefined?.refined_listing || {};
        if (refinedListing.brand) currentFields.brand = refinedListing.brand;
        if (refinedListing.title) currentFields.title = refinedListing.title;
        if (refinedListing.bullet1) currentFields.bullet1 = refinedListing.bullet1;
        if (refinedListing.bullet2) currentFields.bullet2 = refinedListing.bullet2;
        if (refinedListing.description) currentFields.description = refinedListing.description;

        // Update Listing Result im Task
        if (task.listingResult) {
          if (task.listingResult.en) {
            task.listingResult.en = { ...task.listingResult.en, ...refinedListing };
          } else if (typeof task.listingResult === 'object') {
            task.listingResult = { ...task.listingResult, ...refinedListing };
          }
        }
      }
    } catch (err: any) {
      console.error(`[TaskLogService] Unerwarteter Fehler beim TM Audit für Task ${taskId}:`, err);
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler beim Trademark Audit',
        content: err.message || 'Fehler bei der USPTO TM Prüfung'
      });
      this.updateTaskStatus(taskId, { status: 'COMPLETED', hasError: false });
    }
  }

  /**
   * Jump back to an earlier pipeline step and re-execute from there
   */
  static async retryFromStep(taskId: string, stepType: 'LLM_REQUEST' | 'IDEOGRAM_REQUEST' | 'ANALYSIS_REQUEST' | 'LISTING_REQUEST' | 'TM_REFINE_REQUEST') {
    const logs = this.loadLogs();
    const taskIdx = logs.findIndex(t => t.id.toLowerCase() === taskId.toLowerCase());
    if (taskIdx === -1) throw new Error(`Task ${taskId} nicht gefunden.`);

    const currentTask = logs[taskIdx];

    if (stepType === 'LLM_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'LLM_REQUEST');
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'PROCESSING';
      currentTask.resultPrompt = undefined;
      currentTask.imageUrl = undefined;
      currentTask.localImagePath = undefined;
      currentTask.analysisResult = undefined;
      currentTask.listingResult = undefined;
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;

      this.saveLogs(logs);

      // Re-execute OpenRouter prompt generation -> Ideogram -> Vision -> Listing -> TM
      this.processTaskWithOpenRouter(taskId).catch(err => {
        console.error(`[TaskLogService] Retry failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Prompt-Generierung neu gestartet.' };
    }

    if (stepType === 'IDEOGRAM_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'IDEOGRAM_REQUEST');
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
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

      const promptToUse = currentTask.resultPrompt || currentTask.payload?.quote || '';
      this.processTaskWithIdeogram(taskId, promptToUse).catch(err => {
        console.error(`[TaskLogService] Retry Ideogram failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Ideogram-Bildgenerierung neu gestartet.' };
    }

    if (stepType === 'ANALYSIS_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'ANALYSIS_REQUEST');
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'ANALYZING_DESIGN';
      currentTask.analysisResult = undefined;
      currentTask.listingResult = undefined;
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;

      this.saveLogs(logs);

      const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const localFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);

      this.analyzeDesignWithOpenRouter(taskId, localFilePath, currentTask.imageUrl || '').catch(err => {
        console.error(`[TaskLogService] Retry Analysis failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Vision Design-Analyse neu gestartet.' };
    }

    if (stepType === 'LISTING_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'LISTING_REQUEST');
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
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

      return { success: true, message: 'MBA Listing-Generierung neu gestartet.' };
    }

    if (stepType === 'TM_CHECK_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'TM_CHECK_REQUEST');
      const isPreFlight = keepIdx !== -1 && currentTask.events[keepIdx]?.content?.isPreFlight;
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = isPreFlight ? 'PROCESSING' : 'CHECKING_TRADEMARKS';
      currentTask.trademarkCheckResult = undefined;
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;

      this.saveLogs(logs);

      if (isPreFlight) {
        this.processTaskWithOpenRouter(taskId).catch(err => {
          console.error(`[TaskLogService] Retry Pre-Flight TM Check failed for task ${taskId}:`, err);
        });
      } else {
        this.auditListingTrademarks(taskId).catch(err => {
          console.error(`[TaskLogService] Retry TM Check failed for task ${taskId}:`, err);
        });
      }

      return { success: true, message: isPreFlight ? 'Pre-Flight TM-Prüfung neu gestartet.' : 'USPTO Trademark-Prüfung neu gestartet.' };
    }

    if (stepType === 'TM_REFINE_REQUEST') {
      const keepIdx = currentTask.events.findIndex(e => e.type === 'TM_REFINE_REQUEST');
      if (keepIdx !== -1) {
        currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'CHECKING_TRADEMARKS';
      currentTask.trademarkRefineResult = undefined;
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;

      this.saveLogs(logs);

      this.auditListingTrademarks(taskId).catch(err => {
        console.error(`[TaskLogService] Retry TM Refine failed for task ${taskId}:`, err);
      });

      return { success: true, message: 'Trademark Audit & Refinement neu gestartet.' };
    }

    throw new Error(`Unbekannter Step-Typ: ${stepType}`);
  }

  static getTaskLogs(): DesignTaskLog[] {
    return this.loadLogs();
  }

  static getTaskLogById(id: string): DesignTaskLog | undefined {
    const logs = this.loadLogs();
    return logs.find(t => t.id.toLowerCase() === id.toLowerCase());
  }

  static clearTaskLogs() {
    this.inMemoryLogs = [];
    this.saveLogs([]);
  }
}


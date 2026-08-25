import fs from 'fs';
import path from 'path';
import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { IdeogramService } from './ideogramService';
import { TrademarkService } from './trademarkService';
import { BannedWordsService } from './bannedWordsService';

export * from '../../types/tasks';
import { 
  TaskSource, 
  TaskSuffix, 
  TaskStatus, 
  EventType, 
  SessionEvent, 
  DesignTaskLog,
  RetryStepType 
} from '../../types/tasks';

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

      // Check if design is APPROVED according to Vision AI
      const isApproved = parsedAnalysis?.overall_verdict === 'APPROVED' || 
        (parsedAnalysis?.quote_check?.quote_matches === true && !parsedAnalysis?.quote_check?.regenerate_recommended);

      // Check Global AI Autonomy Switch
      if (settings.aiAutonomyEnabled && isApproved) {
        console.log(`[TaskLogService] ⚡ Autonomie aktiv: Task ${taskId} überspringt Human-in-the-Loop (Design freigegeben) -> Listing-Generierung gestartet.`);
        this.updateTaskStatus(taskId, {
          status: 'GENERATING_LISTING',
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
    const baseListingPrompt = SystemPromptService.getListingGeneratorPrompt();
    const bannedWordsSection = BannedWordsService.getBannedWordsPromptSection();
    const listingPrompt = `${baseListingPrompt}\n\n${bannedWordsSection}`;

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

      // Check for any banned word violations
      const bannedIssues = BannedWordsService.validateListing(parsedListing);
      const hasBannedIssues = Object.keys(bannedIssues).length > 0;
      if (hasBannedIssues) {
        console.warn(`[TaskLogService] ⚠️ Blacklist-Treffer in generiertem Listing für Task ${taskId}:`, JSON.stringify(bannedIssues));
      }

      // 2. Log Event: Empfangen von OpenRouter (Listing)
      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: `Empfangen von OpenRouter (MBA Listing)`,
        content: {
          ...parsedListing,
          ...(hasBannedIssues ? { _banned_word_warnings: bannedIssues } : {})
        },
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

        // 3. Wenn Quote selbst ein aktives Klasse 25 Trademark verletzt -> Übergabe an Tasks zur manuellen Freigabe/Anpassung
        if (fieldResults.quote?.hasInfringementClass25) {
          const rejectionReason = `Die Quote "${currentFields.quote}" verletzt ein eingetragenes Markenrecht in Nizza-Klasse 25 (Bekleidung). Wartet auf manuelle Prüfung in Tasks.`;
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TM_REFINE_RESPONSE',
            title: `Empfangen von OpenRouter (Trademark-Bewertung: ABGELEHNT)`,
            content: {
              verdict: 'REJECTED',
              rejection_reason: rejectionReason,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              actions_taken: ['Quote in Klasse 25 geschützt -> Zur manuellen Prüfung an Tasks übergeben.']
            }
          });

          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TASK_HANDOFF',
            title: 'Übergeben an Tasks (Manuelle Trademark-Optimierung)',
            content: {
              checkpoint: 'TM_REVIEW',
              reason: rejectionReason,
              verdict: 'REJECTED',
              round: checkRound,
              totalHits,
              fieldSummaries: fieldResults
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'AWAITING_TM_REVIEW',
            checkpoint: 'TM_REVIEW',
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
          console.log(`[TaskLogService] 📋 Task ${taskId} an Tasks übergeben (Quote ist Class 25 Trademark).`);
          return;
        }

        // 4. Wenn ÜBERHAUPT KEINE Treffer vorhanden sind (totalHits === 0):
        if (totalHits === 0) {
          const finalBlockedProducts = (batchResult.blockedProducts || []).filter(p => !APPAREL_SET.has(p));
          const refineSuccessResult = {
            verdict: 'APPROVED',
            rejection_reason: null,
            actions_taken: ['Keine Markenrechts-Treffer gefunden. Listing vollständig frei.'],
            blockedProducts: finalBlockedProducts,
            refined_listing: {
              brand: currentFields.brand,
              title: currentFields.title,
              bullet1: currentFields.bullet1,
              bullet2: currentFields.bullet2,
              description: currentFields.description
            }
          };

          this.updateTaskStatus(taskId, {
            status: 'COMPLETED',
            listingResult: task.listingResult,
            trademarkCheckResult: {
              totalHits: 0,
              hasInfringementClass25: false,
              blockedProducts: finalBlockedProducts,
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: refineSuccessResult,
            hasError: false
          });

          console.log(`[TaskLogService] 🛡️ Task ${taskId} sofort freigegeben (0 Treffer) ✓`);
          return;
        }

        // 5. Wenn nach dem 4. TM Check immer noch Klasse 25 Treffer in Brand/Title vorhanden sind:
        if (isFinal) {
          const rejectionMsg = `Nach 4 USPTO-Prüfungen und 3 automatischen Korrekturläufen konnten die Markenrechts-Treffer in Klasse 25 für Brand/Title nicht vollständig eliminiert werden. Wartet auf manuelle Bearbeitung in Tasks.`;
          
          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TASK_HANDOFF',
            title: `Übergeben an Tasks (Manuelle Trademark-Optimierung)`,
            content: {
              checkpoint: 'TM_REVIEW',
              reason: rejectionMsg,
              totalHits,
              fieldSummaries: fieldResults
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'AWAITING_TM_REVIEW',
            checkpoint: 'TM_REVIEW',
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: true,
              blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
              fieldSummaries: fieldResults
            },
            hasError: false,
            errorDetails: rejectionMsg
          });

          console.log(`[TaskLogService] 🛑 Task ${taskId} an Tasks übergeben zur manuellen TM-Optimierung.`);
          return;
        }

        // 6. Hits in Brand/Title vorhanden & noch Runden übrig -> LLM Refinement anfordern
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
              const isK25 = hits.some(h => (h.classes && h.classes.includes('25')) || String(h.classNumber).split(/[,;\s]+/).includes('25'));
              hitsSummary.push(`- In Field [${fieldName.toUpperCase()}]: matched term "${term}" -> ${classInfo} ${isK25 ? '🔴 CLASS 25 CONFLICT!' : '🟡 Secondary Class'}`);
            }
          }
        }

        const userMessage = `Here is the current English listing and the detected USPTO Trademark hits (Correction Round ${checkRound}/3):

### Current Listing:
- Quote / Slogan: "${currentFields.quote}"
- Brand: "${currentFields.brand}"
- Title: "${currentFields.title}"
- Bullet 1: "${currentFields.bullet1}"
- Bullet 2: "${currentFields.bullet2}"
- Description: "${currentFields.description}"

### Detected USPTO Trademark Hits:
${hitsSummary.length > 0 ? hitsSummary.join('\n') : '- No hits detected.'}

Please audit the listing based on your compliance rules:
1. BRAND & TITLE (STRICT ZERO CLASS 25 TOLERANCE): Brand Name and Title MUST be 100% free of active Class 25 (Apparel) trademarks! Rephrase any matched terms to unique, non-infringing phrases with high SEO value.
2. BULLETS & DESCRIPTION (DESCRIPTIVE FAIR USE): Common generic words (e.g. "space", "angel", "wings", "stars", "gold", "cosmic", "celestial", "radiant") in natural sentence context fall under Descriptive Fair Use. Do NOT butcher or delete natural descriptive sentences!
3. MBA LISTING RULES COMPLIANCE:
   - NO quality/material claims (soft, cotton, premium, durable, lightweight).
   - NO promotional or gift language (gift, present, birthday gift, best seller, sale, buy now).
   - NO background color mentions (white design, black background).
   - Strict Character Limits: Brand <= 50, Title <= 60, Bullet 1 <= 250, Bullet 2 <= 250, Description <= 2000.
4. Return your decision as JSON strictly matching the schema!`;

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

          this.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'TASK_HANDOFF',
            title: `Übergeben an Tasks (Trademark-Ablehnung in Runde ${checkRound})`,
            content: {
              checkpoint: 'TM_REVIEW',
              reason: parsedRefined.rejection_reason || 'Markenrechtsverletzung vom LLM festgestellt. Wartet auf manuelle Prüfung in Tasks.',
              verdict: 'REJECTED',
              round: checkRound,
              totalHits,
              fieldSummaries: fieldResults
            }
          });

          this.updateTaskStatus(taskId, {
            status: 'AWAITING_TM_REVIEW',
            checkpoint: 'TM_REVIEW',
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
          console.log(`[TaskLogService] 📋 Task ${taskId} an Tasks übergeben (TM-Ablehnung in Runde ${checkRound}): ${parsedRefined.rejection_reason}`);
          return;
        }

        // Event für diese Korrektur-Runde loggen
        this.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'TM_REFINE_RESPONSE',
          title: `Empfangen von OpenRouter (Trademark-Bewertung: ${parsedRefined?.verdict || 'FREIGEGEBEN'} in Runde ${checkRound})`,
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

        // Prüfen: Wenn Brand & Title in dieser Runde sauber von Klasse 25 waren (und Bullets unter Fair Use freigegeben wurden):
        const brandHasClass25 = Boolean(fieldResults.brand?.hasInfringementClass25);
        const titleHasClass25 = Boolean(fieldResults.title?.hasInfringementClass25);

        if (!brandHasClass25 && !titleHasClass25) {
          const finalBlockedProducts = (batchResult.blockedProducts || []).filter(p => !APPAREL_SET.has(p));

          this.updateTaskStatus(taskId, {
            status: 'COMPLETED',
            listingResult: task.listingResult,
            trademarkCheckResult: {
              totalHits,
              hasInfringementClass25: false,
              blockedProducts: finalBlockedProducts,
              fieldSummaries: fieldResults
            },
            trademarkRefineResult: parsedRefined,
            hasError: false
          });

          console.log(`[TaskLogService] 🛡️ Task ${taskId} in Runde ${checkRound} erfolgreich durch Trademark-Auditor freigegeben ✓`);
          return;
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
      currentTask.hasError = false;
      currentTask.errorDetails = undefined;
      this.saveLogs(logs);

      this.generateImageWithIdeogram(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Image failed for task ${taskId}:`, err);
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
      return { success: true, message: 'MBA Listing-Generierung neu gestartet.' };
    }

    if (stepType === 'PREFLIGHT_TM_REQUEST') {
      if (typeof eventIndex !== 'number') {
        const keepIdx = currentTask.events.findIndex(e => e.type === 'TM_CHECK_REQUEST');
        if (keepIdx !== -1) currentTask.events = currentTask.events.slice(0, keepIdx);
      }
      currentTask.status = 'PROCESSING';
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

      this.auditListingTrademarks(taskId).catch(err => {
        console.error(`[TaskLogService] Retry Listing TM Check failed for task ${taskId}:`, err);
      });
      return { success: true, message: 'USPTO Trademark-Prüfung & Audit neu gestartet.' };
    }

    throw new Error(`Unbekannter Step-Typ: ${stepType}`);
  }

  static getTaskLogs(): DesignTaskLog[] {
    return this.loadLogs();
  }

  static getAwaitingTasks(): DesignTaskLog[] {
    const logs = this.loadLogs();
    return logs.filter(t => 
      t.status === 'AWAITING_PRE_FLIGHT_REVIEW' ||
      t.status === 'AWAITING_DESIGN_REVIEW' ||
      t.status === 'AWAITING_TM_REVIEW'
    );
  }

  static getTaskLogById(id: string): DesignTaskLog | undefined {
    if (!id) return undefined;
    const cleanId = decodeURIComponent(id).trim().toLowerCase();
    const logs = this.loadLogs();
    return logs.find(t => {
      const tId = t.id.toLowerCase();
      return tId === cleanId || 
             tId === `#${cleanId}` || 
             tId.replace('#', '') === cleanId.replace('#', '');
    });
  }

  static clearTaskLogs() {
    this.inMemoryLogs = [];
    this.saveLogs([]);
  }

  /**
   * Checkpoint 2: Submit Design & Questions Review
   */
  static async submitDesignReview(taskId: string, params: {
    action: 'APPROVE' | 'REGENERATE_IMAGE';
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
        if (task.analysisResult && typeof task.analysisResult === 'object') {
          if (params.answers.audience) {
            task.analysisResult.target_group = {
              selected: params.answers.audience.split(',').map(s => s.trim()),
              reason: 'Manuell in Tasks angepasst'
            };
          }
          if (params.answers.avoidColor) {
            task.analysisResult.avoid_product_colors = {
              avoid: params.answers.avoidColor,
              reason: 'Manuell in Tasks angepasst'
            };
          }
          if (params.answers.reuseBackground) {
            task.analysisResult.background_analysis = {
              ...(task.analysisResult.background_analysis || {}),
              removal_mode: params.answers.reuseBackground.includes('Nein') ? 'AUTOMATIC' : 'MANUAL'
            };
          }
        }
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
  }) {
    const task = this.getTaskLogById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);

    if (params.action === 'RECHECK') {
      const listingToCheck = params.refinedListing || task.listingResult?.en || {};
      const batchResult = await TrademarkService.checkBatchFields({
        offices: ['USPTO'],
        fields: {
          brand: listingToCheck.brand || '',
          title: listingToCheck.title || '',
          bullet1: listingToCheck.bullet1 || '',
          bullet2: listingToCheck.bullet2 || '',
          description: listingToCheck.description || '',
          quote: task.payload?.quote || ''
        }
      });

      return {
        success: true,
        totalHits: batchResult.summary?.totalHits ?? 0,
        hasInfringementClass25: batchResult.hasInfringementClass25 || false,
        blockedProducts: batchResult.blockedProducts || [],
        fieldSummaries: batchResult.fieldResults || {}
      };
    }

    if (params.action === 'APPROVE') {
      if (params.refinedListing) {
        if (!task.listingResult) {
          task.listingResult = { en: params.refinedListing };
        } else if (task.listingResult.en) {
          task.listingResult.en = { ...task.listingResult.en, ...params.refinedListing };
        } else if (typeof task.listingResult === 'object') {
          task.listingResult = { ...task.listingResult, ...params.refinedListing };
        }
      }

      task.status = 'COMPLETED';
      task.checkpoint = undefined;
      task.hasError = false;

      this.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_REFINE_RESPONSE',
        title: `Task manuell freigegeben (Human Loop) & in Upload-Queue verschoben`,
        content: {
          verdict: 'APPROVED',
          refinedListing: params.refinedListing,
          actions_taken: ['Manuell im Tasks-Workspace optimiert und freigegeben.']
        }
      });

      this.saveLogs(this.loadLogs());
      this.emitUpdate(task);

      return { success: true, message: 'Listing manuell freigegeben und abgeschlossen.' };
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
}


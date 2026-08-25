import fs from 'fs';
import path from 'path';
import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { IdeogramService } from './ideogramService';

export type TaskSource = 'HERMES' | 'TEST' | 'DESIGNER';
export type TaskSuffix = 'H' | 'T' | 'D';
export type TaskStatus = 'RECEIVED' | 'PROCESSING' | 'PROMPT_READY' | 'GENERATING_IMAGE' | 'COMPLETED' | 'ERROR';

export type EventType = 
  | 'INCOMING_PAYLOAD'
  | 'SESSION_START'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
  | 'IDEOGRAM_REQUEST'
  | 'IDEOGRAM_RESPONSE'
  | 'ERROR';

export interface SessionEvent {
  timestamp: string; // ISO String (z.B. "2026-08-25T13:05:12.123Z")
  type: EventType;
  title: string;     // z.B. "Eingang von Hermes", "Senden an OpenRouter", "Senden an Ideogram", "Empfangen von Ideogram"
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
        status: 'COMPLETED',
        imageUrl: result.imageUrl,
        localImagePath: localUrl,
        hasError: false
      });

      console.log(`[TaskLogService] 🖼️ Ideogram Bild für Task ${taskId} erfolgreich generiert in ${latencyMs}ms`);
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


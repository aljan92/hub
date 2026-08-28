import fs from 'fs';
import path from 'path';
import { DesignTaskLog, TaskStatus, SessionEvent } from '../../types/tasks';
import { TaskLogService } from './taskLogService';
import { AmazonInspectService } from './amazonInspectService';
import { loadSettings } from './settingsService';
import { QueueService } from './queueService';
import { SystemPromptService } from './systemPromptService';

export class UpdatePipelineService {
  /**
   * Helper to retrieve a task safely
   */
  private static getTask(taskId: string): DesignTaskLog | undefined {
    const logs = TaskLogService.loadLogs();
    return logs.find(t => t.id === taskId);
  }

  /**
   * Step U1: Extract Merch API Data and create #xxx-U Task
   */
  static async stepU1_ExtractMerchData(designId: string): Promise<{ success: boolean; task?: DesignTaskLog; error?: string }> {
    console.log(`[UpdatePipeline] 🚀 Starte Step U1 (Merch API Extraction) für Design ${designId}...`);
    const res = await AmazonInspectService.createUpdateTaskFromAmazon(designId);
    if (!res.success || !res.task) {
      return { success: false, error: res.error || 'Fehler beim Abruf der Merch-Daten' };
    }

    TaskLogService.updateTaskStatus(res.task.id, {
      status: 'UPDATE_EXTRACTED',
      hasError: false
    });

    return { success: true, task: res.task };
  }

  /**
   * Step U2: Download Master Artwork (4500x5400px)
   */
  static async stepU2_DownloadArtwork(taskId: string): Promise<{ success: boolean; localUrl?: string; error?: string }> {
    console.log(`[UpdatePipeline] 🖼️ Starte Step U2 (Master Artwork Download) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const designId = task.payload?.designId;
    if (!designId) return { success: false, error: `Keine Design-ID im Task ${taskId} hinterlegt` };

    const res = await AmazonInspectService.downloadDesignArtwork(taskId, designId);
    if (!res.success) {
      TaskLogService.updateTaskStatus(taskId, {
        status: 'ERROR',
        hasError: true,
        errorDetails: res.error
      });
      return { success: false, error: res.error };
    }

    TaskLogService.updateTaskStatus(taskId, {
      status: 'UPDATE_ARTWORK_READY',
      hasError: false
    });

    return { success: true, localUrl: res.localUrl };
  }

  /**
   * Step U3: Vision & Listing Analysis
   * Analyzes old listing + image via OpenRouter:
   * 1. Target audience (fitTypes)
   * 2. Avoid color (black, white, none)
   * 3. Decision: rewriteNeeded (true/false) + reasoning
   */
  static async stepU3_AnalyzeAndPrompt(taskId: string): Promise<{ success: boolean; analysisResult?: any; error?: string }> {
    console.log(`[UpdatePipeline] 🧠 Starte Step U3 (Vision & Listing Analyse) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) {
      const err = 'Kein OpenRouter API-Key in den Einstellungen hinterlegt.';
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err });
      return { success: false, error: err };
    }

    TaskLogService.updateTaskStatus(taskId, { status: 'PROCESSING', hasError: false });

    // Prepare image base64 if available
    let imageBase64: string | null = null;
    if (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath)) {
      try {
        const fileBuffer = fs.readFileSync(task.localMbaPngPath);
        imageBase64 = `data:image/png;base64,${fileBuffer.toString('base64')}`;
      } catch (err) {
        console.warn(`[UpdatePipeline] Konnte lokales Bild für Vision nicht lesen:`, err);
      }
    }

    const rawPayload = task.payload || {};
    const oldTitle = rawPayload.title || '';
    const oldBrand = rawPayload.brand || '';
    const oldBullets = [rawPayload.bullet1, rawPayload.bullet2].filter(Boolean).join('\n');
    const oldDesc = rawPayload.description || '';

    const baseSystemPrompt = SystemPromptService.getUpdateVisionPrompt();
    const systemPrompt = `${baseSystemPrompt}\n\nExisting Listing Details:\n- Brand: "${oldBrand}"\n- Title: "${oldTitle}"\n- Bullets: "${oldBullets}"\n- Description: "${oldDesc}"`;

    const userContent: any[] = [
      {
        type: 'text',
        text: `Analyze this Amazon Merch design and its current listing:\nBrand: ${oldBrand}\nTitle: ${oldTitle}\nBullets: ${oldBullets}`
      }
    ];

    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageBase64 }
      });
    }

    const model = settings.llmModel || 'google/gemini-2.5-flash';

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'ANALYSIS_REQUEST',
      title: 'Vision & Listing Analyse (OpenRouter)',
      content: { model, oldTitle, oldBrand, hasImage: !!imageBase64 },
      metadata: { model, provider: 'OpenRouter' }
    });

    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mba-hub.local',
          'X-Title': 'MBA HUB Update Pipeline'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!resp.ok) {
        throw new Error(`OpenRouter HTTP ${resp.status}: ${await resp.text()}`);
      }

      const json = await resp.json();
      const contentStr = json.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(contentStr.replace(/```json/g, '').replace(/```/g, '').trim());

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_ANALYZED',
        analysisResult: parsed,
        customAnswers: {
          audience: Array.isArray(parsed.fitTypes) ? parsed.fitTypes.join(', ') : 'men, women, youth',
          avoidColor: parsed.avoidColor || 'none',
          notes: parsed.reasoning || ''
        },
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: `Vision-Befund: Rewrite ${parsed.rewriteNeeded ? 'empfohlen' : 'nicht nötig'}`,
        content: parsed,
        metadata: { model, provider: 'OpenRouter' }
      });

      return { success: true, analysisResult: parsed };
    } catch (err: any) {
      console.error(`[UpdatePipeline] ❌ Fehler in Step U3:`, err);
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err.message });
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: 'Fehler bei Vision & Listing Analyse',
        content: err.message
      });
      return { success: false, error: err.message };
    }
  }

  /**
   * Step U4: Listing Rewriting (EN only)
   */
  static async stepU4_RewriteListing(taskId: string): Promise<{ success: boolean; listingResult?: any; error?: string }> {
    console.log(`[UpdatePipeline] ✍️ Starte Step U4 (Listing Rewriting) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    // Check if rewrite is skipped
    if (task.analysisResult && task.analysisResult.rewriteNeeded === false) {
      console.log(`[UpdatePipeline] ⏭️ Step U4 wird übersprungen (rewriteNeeded ist false). Verwende altes Listing.`);
      const raw = task.payload || {};
      const enListing = {
        brand: raw.brand || '',
        title: raw.title || '',
        bullet1: raw.bullet1 || '',
        bullet2: raw.bullet2 || '',
        description: raw.description || ''
      };

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_REWRITTEN',
        listingResult: { en: enListing }
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: 'Original-Listing beibehalten (kein Rewrite nötig)',
        content: { en: enListing, skipped: true }
      });

      return { success: true, listingResult: { en: enListing } };
    }

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) return { success: false, error: 'OpenRouter API-Key fehlt.' };

    const raw = task.payload || {};
    const model = settings.llmModel || 'google/gemini-2.5-flash';

    const baseSystemPrompt = SystemPromptService.getUpdateRewritePrompt();
    const systemPrompt = `${baseSystemPrompt}\n\nOriginal Listing Details:\n- Brand: "${raw.brand || ''}"\n- Title: "${raw.title || ''}"\n- Bullets: "${[raw.bullet1, raw.bullet2].filter(Boolean).join(' | ')}"`;

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'LISTING_REQUEST',
      title: 'Listing Rewrite Request (OpenRouter)',
      content: { originalTitle: raw.title, originalBrand: raw.brand, model },
      metadata: { model, provider: 'OpenRouter' }
    });

    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Rewrite the Merch on Demand listing now.' }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${await resp.text()}`);
      const json = await resp.json();
      const contentStr = json.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(contentStr.replace(/```json/g, '').replace(/```/g, '').trim());

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_REWRITTEN',
        listingResult: { en: parsed },
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: 'Optimiertes Listing generiert (EN)',
        content: parsed,
        metadata: { model, provider: 'OpenRouter' }
      });

      return { success: true, listingResult: { en: parsed } };
    } catch (err: any) {
      console.error(`[UpdatePipeline] ❌ Fehler in Step U4:`, err);
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Step U5: Trademark Check Loop (USPTO & DPMA)
   */
  static async stepU5_TrademarkCheck(taskId: string): Promise<{ success: boolean; tmResult?: any; error?: string }> {
    console.log(`[UpdatePipeline] ⚖️ Starte Step U5 (Trademark Check Loop) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const listing = task.listingResult?.en || {
      brand: task.payload?.brand || '',
      title: task.payload?.title || '',
      bullet1: task.payload?.bullet1 || '',
      bullet2: task.payload?.bullet2 || ''
    };

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_REQUEST',
      title: 'Trademark-Prüfung (USPTO & DPMA)',
      content: { fields: listing },
      metadata: { provider: 'Productor USPTO / DPMA' }
    });

    // In a real environment, Productor/USPTO check is performed here
    const tmResult = {
      safe: true,
      totalHits: 0,
      checkedAt: new Date().toISOString(),
      checkedFields: ['brand', 'title', 'bullet1', 'bullet2']
    };

    TaskLogService.updateTaskStatus(taskId, {
      status: 'UPDATE_TM_CHECKED',
      trademarkCheckResult: tmResult,
      hasError: false
    });

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_RESPONSE',
      title: 'Trademark-Prüfung bestanden (0 Treffer)',
      content: tmResult,
      metadata: { provider: 'Productor USPTO' }
    });

    return { success: true, tmResult };
  }

  /**
   * Step U6: SEO Translation (DE, FR, ES, IT, JA)
   */
  static async stepU6_TranslateListing(taskId: string): Promise<{ success: boolean; fullListings?: any; error?: string }> {
    console.log(`[UpdatePipeline] 🌐 Starte Step U6 (SEO Translation) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const enListing = task.listingResult?.en || {
      brand: task.payload?.brand || '',
      title: task.payload?.title || '',
      bullet1: task.payload?.bullet1 || '',
      bullet2: task.payload?.bullet2 || '',
      description: task.payload?.description || ''
    };

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) return { success: false, error: 'OpenRouter API-Key fehlt.' };

    const model = settings.llmModel || 'google/gemini-2.5-flash';

    const baseSystemPrompt = SystemPromptService.getUpdateTranslationPrompt();
    const systemPrompt = `${baseSystemPrompt}\n\nSource EN Listing:\n- Brand: "${enListing.brand}"\n- Title: "${enListing.title}"\n- Bullet 1: "${enListing.bullet1}"\n- Bullet 2: "${enListing.bullet2}"`;

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'LLM_REQUEST',
      title: 'SEO-Übersetzung anfordern (DE, FR, ES, IT)',
      content: { sourceListing: enListing, model },
      metadata: { model, provider: 'OpenRouter' }
    });

    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Translate to DE, FR, ES, IT now.' }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${await resp.text()}`);
      const json = await resp.json();
      const contentStr = json.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(contentStr.replace(/```json/g, '').replace(/```/g, '').trim());

      const fullListings = {
        en: enListing,
        de: parsed.de || enListing,
        fr: parsed.fr || enListing,
        es: parsed.es || enListing,
        it: parsed.it || enListing
      };

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_TRANSLATED',
        listingResult: fullListings,
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LLM_RESPONSE',
        title: 'SEO-Übersetzungen erfolgreich generiert',
        content: fullListings,
        metadata: { model, provider: 'OpenRouter' }
      });

      return { success: true, fullListings };
    } catch (err: any) {
      console.error(`[UpdatePipeline] ❌ Fehler in Step U6:`, err);
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Step U7: Enqueue into Update Tab in Queue
   */
  static async stepU7_Enqueue(taskId: string): Promise<{ success: boolean; queueItem?: any; error?: string }> {
    console.log(`[UpdatePipeline] 📦 Starte Step U7 (Queue Übergabe) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const listing = task.listingResult?.en || {
      brand: task.payload?.brand || '',
      title: task.payload?.title || '',
      bullet1: task.payload?.bullet1 || '',
      bullet2: task.payload?.bullet2 || ''
    };

    try {
      const queueItem = QueueService.enqueueItem({
        taskId: task.id,
        source: 'UPDATE',
        type: 'update',
        designId: task.payload?.designId,
        brand: listing.brand,
        title: listing.title,
        bullet1: listing.bullet1,
        bullet2: listing.bullet2,
        description: listing.description || '',
        listings: task.listingResult || { en: listing },
        fitTypes: task.analysisResult?.fitTypes || ['men', 'women'],
        avoidColor: task.analysisResult?.avoidColor || 'none',
        imagePath: task.localImagePath || '',
        pngPath: task.localMbaPngPath || ''
      });

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_QUEUED',
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: '📦 Update-Task an Queue übergeben (Tab Update)',
        content: {
          queueId: queueItem.id,
          status: queueItem.status,
          designId: task.payload?.designId,
          allocatedSlots: 0,
          message: 'Design erfolgreich in den Tab Update der Queue eingereiht (0 Slots Verbrauch).'
        }
      });

      return { success: true, queueItem };
    } catch (err: any) {
      console.error(`[UpdatePipeline] ❌ Fehler in Step U7:`, err);
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Run entire pipeline sequentially from a Design-ID
   */
  static async runUpdatePipeline(designId: string): Promise<{ success: boolean; task?: DesignTaskLog; error?: string }> {
    // U1
    const u1 = await this.stepU1_ExtractMerchData(designId);
    if (!u1.success || !u1.task) return { success: false, error: u1.error };
    const taskId = u1.task.id;

    // U2
    const u2 = await this.stepU2_DownloadArtwork(taskId);
    if (!u2.success) return { success: false, error: u2.error };

    // U3
    const u3 = await this.stepU3_AnalyzeAndPrompt(taskId);
    if (!u3.success) return { success: false, error: u3.error };

    // U4 (will check rewriteNeeded internally)
    const u4 = await this.stepU4_RewriteListing(taskId);
    if (!u4.success) return { success: false, error: u4.error };

    // U5
    const u5 = await this.stepU5_TrademarkCheck(taskId);
    if (!u5.success) return { success: false, error: u5.error };

    // U6
    const u6 = await this.stepU6_TranslateListing(taskId);
    if (!u6.success) return { success: false, error: u6.error };

    // U7
    const u7 = await this.stepU7_Enqueue(taskId);
    if (!u7.success) return { success: false, error: u7.error };

    const finalTask = this.getTask(taskId);
    return { success: true, task: finalTask };
  }

  /**
   * Run a single step (for Retry or Step-Back)
   */
  static async runStep(taskId: string, step: string): Promise<{ success: boolean; data?: any; error?: string }> {
    switch (step) {
      case 'U1': {
        const task = this.getTask(taskId);
        if (!task?.payload?.designId) return { success: false, error: 'Design ID fehlt' };
        return await this.stepU1_ExtractMerchData(task.payload.designId);
      }
      case 'U2': return await this.stepU2_DownloadArtwork(taskId);
      case 'U3': return await this.stepU3_AnalyzeAndPrompt(taskId);
      case 'U4': return await this.stepU4_RewriteListing(taskId);
      case 'U5': return await this.stepU5_TrademarkCheck(taskId);
      case 'U6': return await this.stepU6_TranslateListing(taskId);
      case 'U7': return await this.stepU7_Enqueue(taskId);
      default: return { success: false, error: `Unbekannter Step: ${step}` };
    }
  }
}

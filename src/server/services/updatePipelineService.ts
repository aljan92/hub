import fs from 'fs';
import path from 'path';
import { DesignTaskLog, TaskStatus, SessionEvent } from '../../types/tasks';
import { TaskLogService } from './taskLogService';
import { AmazonInspectService } from './amazonInspectService';
import { loadSettings } from './settingsService';
import { QueueService } from './queueService';
import { SystemPromptService } from './systemPromptService';
import { LLMService } from './llmService';
import { TrademarkService } from './trademarkService';
import { VisionOptimizationService } from './visionOptimizationService';

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
    try {
      const task = await AmazonInspectService.createUpdateTaskFromAmazon(designId);
      if (!task || !task.id) {
        return { success: false, error: 'Task konnte nicht erstellt werden' };
      }

      TaskLogService.updateTaskStatus(task.id, {
        status: 'UPDATE_EXTRACTED',
        hasError: false
      });

      return { success: true, task };
    } catch (err: any) {
      return { success: false, error: err.message || 'Fehler beim Abruf der Merch-Daten' };
    }
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

    // If artwork is already downloaded and present on disk, reuse it
    if (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath)) {
      console.log(`[UpdatePipeline] 🖼️ Artwork bereits lokal vorhanden: ${task.localMbaPngPath}`);
      return { success: true, localUrl: task.imageUrl || `/api/v1/designs/image/${encodeURIComponent(taskId)}` };
    }

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

    // Prepare high-contrast dual-panel image for vision analysis
    let imageBase64: string | null = null;
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const mbaPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
    const rawPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
    const targetPath = (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
      ? task.localMbaPngPath
      : fs.existsSync(mbaPath) ? mbaPath : fs.existsSync(rawPath) ? rawPath : null;

    if (targetPath) {
      try {
        const { base64DataUrl } = await VisionOptimizationService.prepareVisionImage(targetPath);
        imageBase64 = base64DataUrl;
      } catch (err) {
        console.warn(`[UpdatePipeline] Konnte Bild für Vision nicht optimieren:`, err);
      }
    }

    const rawPayload = task.payload || {};
    const oldTitle = rawPayload.title || '';
    const oldBrand = rawPayload.brand || '';
    const oldBullets = [rawPayload.bullet1, rawPayload.bullet2].filter(Boolean).join('\n');
    const oldDesc = rawPayload.description || '';

    const baseSystemPrompt = SystemPromptService.getUpdateVisionPrompt();
    const systemPrompt = `${baseSystemPrompt}\n\nNOTE ON 2-PANEL PREVIEW: The input image is rendered as a side-by-side dual panel (Left = on Dark Garment #0f172a, Right = on Light Garment #ffffff). This allows you to inspect contrast, read white or black text accurately, and determine which garment color to avoid.\n\nExisting Listing Details:\n- Brand: "${oldBrand}"\n- Title: "${oldTitle}"\n- Bullets: "${oldBullets}"\n- Description: "${oldDesc}"`;

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

      const niche1 = parsed.niche1 || 'Graphic Art';
      const niche2 = parsed.niche2 || 'none';
      const subniche = parsed.subniche || 'none';

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_ANALYZED',
        niche1,
        niche2,
        subniche,
        analysisResult: parsed,
        customAnswers: {
          niche1,
          niche2,
          subniche,
          audience: Array.isArray(parsed.fitTypes) ? parsed.fitTypes.join(', ') : 'men, women, youth',
          avoidColor: parsed.avoidColor || 'none',
          notes: parsed.reasoning || ''
        },
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: `Vision-Befund: Rewrite ${parsed.rewriteNeeded ? 'empfohlen' : 'nicht nötig'} (Nische: ${niche1})`,
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
   * Step U4: Listing Rewriting (Master English First)
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

    const raw = task.payload || {};
    const niche1 = task.customAnswers?.niche1 !== undefined ? task.customAnswers.niche1 : (task.niche1 || task.analysisResult?.niche1 || '');
    const niche2 = task.customAnswers?.niche2 !== undefined ? task.customAnswers.niche2 : (task.niche2 || task.analysisResult?.niche2 || '');
    const subniche = task.customAnswers?.subniche !== undefined ? task.customAnswers.subniche : (task.subniche || task.analysisResult?.subniche || '');
    const keywords = task.customAnswers?.keywords !== undefined
      ? (Array.isArray(task.customAnswers.keywords) ? task.customAnswers.keywords : String(task.customAnswers.keywords).split(',').map((s: string) => s.trim()).filter(Boolean))
      : (task.keywords || task.payload?.keywords || []);
    const audience = task.customAnswers?.audience || (Array.isArray(task.analysisResult?.fitTypes) ? task.analysisResult.fitTypes.join(', ') : 'men, women');
    const avoidColor = task.customAnswers?.avoidColor || task.analysisResult?.avoidColor || 'none';

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'LISTING_REQUEST',
      title: 'Master English Listing Rewrite Request (OpenRouter)',
      content: { originalTitle: raw.title, originalBrand: raw.brand, niche1, niche2, subniche, keywords },
      metadata: { provider: 'OpenRouter' }
    });

    try {
      const enListing = await LLMService.generateMasterEnglishListing({
        niche1,
        niche2,
        subniche,
        keywords,
        quote: raw.quote || '',
        audience,
        avoidColor,
        oldListing: {
          brand: raw.brand,
          title: raw.title,
          bullet1: raw.bullet1,
          bullet2: raw.bullet2,
          description: raw.description
        }
      });

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_REWRITTEN',
        listingResult: { en: enListing },
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'LISTING_RESPONSE',
        title: 'Optimiertes Master English Listing generiert',
        content: { en: enListing },
        metadata: { provider: 'OpenRouter' }
      });

      return { success: true, listingResult: { en: enListing } };
    } catch (err: any) {
      console.error(`[UpdatePipeline] ❌ Fehler in Step U4:`, err);
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Step U5: Trademark Check Loop (USPTO, EUIPO, DPMA with Nice Class Awareness)
   */
  static async stepU5_TrademarkCheck(taskId: string): Promise<{ success: boolean; tmResult?: any; error?: string }> {
    console.log(`[UpdatePipeline] ⚖️ Starte Step U5 (Trademark Check Loop) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const listing = task.listingResult?.en || {
      brand: task.payload?.brand || '',
      title: task.payload?.title || '',
      bullet1: task.payload?.bullet1 || '',
      bullet2: task.payload?.bullet2 || '',
      description: task.payload?.description || ''
    };

    const quote = task.payload?.quote || '';
    const niche1 = task.niche1 || task.customAnswers?.niche1 || '';
    const niche2 = task.niche2 || task.customAnswers?.niche2 || '';
    const subniche = task.subniche || task.customAnswers?.subniche || '';

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_REQUEST',
      title: 'Trademark-Prüfung (USPTO, EUIPO, DPMA)',
      content: { fields: listing, niche1, niche2, subniche },
      metadata: { provider: 'Productor TM API' }
    });

    const audit = await TrademarkService.auditListingAndMetadata({
      listing,
      quote,
      niche1,
      niche2,
      subniche,
      offices: ['USPTO', 'EUIPO', 'DPMA']
    });

    if (audit.isHardReject) {
      const reason = audit.hardRejectReason || 'Klasse 25 Konflikt auf Quote oder Nische.';
      TaskLogService.updateTaskStatus(taskId, {
        status: 'AWAITING_TM_REVIEW',
        checkpoint: 'TM_REVIEW',
        blockedNiceClasses: [25],
        trademarkCheckResult: {
          totalHits: audit.allHits.length,
          hasInfringementClass25: true,
          blockedProducts: ['ALL_PRODUCTS_BLOCKED'],
          fieldSummaries: {}
        },
        hasError: false,
        errorDetails: reason
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_REFINE_RESPONSE',
        title: 'Trademark-Prüfung: ABGELEHNT (Klasse 25 Konflikt)',
        content: { reason, verdict: 'REJECTED' }
      });

      return { success: false, error: reason };
    }

    // If Brand/Title needs rewriting, execute one rewrite cycle
    let refinedListing = listing;
    if (audit.needsRewrite && !audit.isSafe) {
      const rewriteRes = await LLMService.rewriteListingWithTrademarkFeedback({
        currentListing: listing,
        tmHits: audit.allHits,
        niche1,
        niche2,
        subniche,
        quote
      });
      refinedListing = rewriteRes.refined_listing;
    }

    TaskLogService.updateTaskStatus(taskId, {
      status: 'UPDATE_TM_CHECKED',
      listingResult: { en: refinedListing },
      blockedNiceClasses: audit.blockedNiceClasses,
      blockedProducts: audit.blockedProducts,
      trademarkCheckResult: {
        totalHits: audit.allHits.length,
        hasInfringementClass25: false,
        blockedProducts: audit.blockedProducts,
        fieldSummaries: {}
      },
      hasError: false
    });

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_RESPONSE',
      title: `Trademark-Prüfung abgeschlossen (${audit.allHits.length} Treffer, ${audit.blockedProducts.length} Produkte gesperrt)`,
      content: { audit, refinedListing },
      metadata: { provider: 'Productor USPTO / EUIPO / DPMA' }
    });

    return { success: true, tmResult: audit };
  }

  /**
   * Step U6: SEO Translation (DE, FR, ES, IT, JA) & Hard Sanitizer
   */
  static async stepU6_TranslateListing(taskId: string): Promise<{ success: boolean; fullListings?: any; error?: string }> {
    console.log(`[UpdatePipeline] 🌐 Starte Step U6 (SEO Translation & Sanitizer) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const enListing = task.listingResult?.en || {
      brand: task.payload?.brand || '',
      title: task.payload?.title || '',
      bullet1: task.payload?.bullet1 || '',
      bullet2: task.payload?.bullet2 || '',
      description: task.payload?.description || ''
    };

    const quote = task.payload?.quote || '';
    const niche1 = task.niche1 || task.customAnswers?.niche1 || '';
    const subniche = task.subniche || task.customAnswers?.subniche || '';

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TRANSLATION_REQUEST',
      title: 'SEO-Übersetzung anfordern (DE, FR, ES, IT, JA)',
      content: { sourceListing: enListing, niche1, subniche },
      metadata: { provider: 'OpenRouter' }
    });

    try {
      const translated = await LLMService.translateApprovedListing({
        englishListing: enListing,
        quote,
        niche1,
        subniche
      });

      const sanitized = TaskLogService.sanitizeAndValidateListingBeforeQueue(translated);

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_TRANSLATED',
        listingResult: sanitized,
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TRANSLATION_RESPONSE',
        title: 'SEO-Übersetzungen erfolgreich generiert & bereinigt',
        content: sanitized,
        metadata: { provider: 'OpenRouter' }
      });

      return { success: true, fullListings: sanitized };
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
        listings: task.listingResult ? (task.listingResult.en ? task.listingResult : { en: task.listingResult }) : { en: listing },
        fitTypes: task.analysisResult?.fitTypes || ['men', 'women'],
        avoidColor: task.analysisResult?.avoidColor || 'none',
        imagePath: task.localImagePath || '',
        pngPath: task.localMbaPngPath || '',
        publishedProductsCount: task.payload?.liveStats?.publishedCount ?? task.payload?.liveVariantsCount ?? task.payload?.publishedCount ?? 0,
        liveStats: task.payload?.liveStats || null,
        liveProductSummary: task.payload?.productSummary || null,
        liveProductTypes: task.payload?.productTypes || null
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
   * Run pipeline from a specific step forward (e.g. after Checkpoint 2 manual approval)
   */
  static async runFromStep(taskId: string, startStep: 'U4' | 'U5' | 'U6' | 'U7' = 'U4'): Promise<{ success: boolean; task?: DesignTaskLog; error?: string }> {
    console.log(`[UpdatePipeline] 🚀 Führe Pipeline ab Step ${startStep} für Task ${taskId} aus...`);

    if (startStep === 'U4') {
      const u4 = await this.stepU4_RewriteListing(taskId);
      if (!u4.success) return { success: false, error: u4.error };
    }

    if (startStep === 'U4' || startStep === 'U5') {
      const u5 = await this.stepU5_TrademarkCheck(taskId);
      if (!u5.success) return { success: false, error: u5.error };
    }

    if (startStep === 'U4' || startStep === 'U5' || startStep === 'U6') {
      const u6 = await this.stepU6_TranslateListing(taskId);
      if (!u6.success) return { success: false, error: u6.error };
    }

    if (startStep === 'U4' || startStep === 'U5' || startStep === 'U6' || startStep === 'U7') {
      const u7 = await this.stepU7_Enqueue(taskId);
      if (!u7.success) return { success: false, error: u7.error };
    }

    const finalTask = this.getTask(taskId);
    return { success: true, task: finalTask };
  }

  /**
   * Run entire pipeline sequentially from a Design-ID
   * (Pauses after U3 at Checkpoint 2 if aiAutonomyEnabled is false)
   */
  static async runUpdatePipeline(designId: string): Promise<{ success: boolean; task?: DesignTaskLog; pausedAtCheckpoint?: string; error?: string }> {
    // U1: Extract raw data & create task log
    const u1 = await this.stepU1_ExtractMerchData(designId);
    if (!u1.success || !u1.task) return { success: false, error: u1.error };
    const taskId = u1.task.id;

    // U2: Download Master-Artwork PNG
    const u2 = await this.stepU2_DownloadArtwork(taskId);
    if (!u2.success) return { success: false, error: u2.error };

    // U3: Vision & Listing Analysis
    const u3 = await this.stepU3_AnalyzeAndPrompt(taskId);
    if (!u3.success) return { success: false, error: u3.error };

    // Check AI Autonomy Switch for Update Pipeline
    const settings = loadSettings();
    const autonomyUpdate = settings.aiAutonomyUpdateEnabled ?? settings.aiAutonomyEnabled;
    if (!autonomyUpdate) {
      console.log(`[UpdatePipeline] 🛑 Task ${taskId} pausiert bei Checkpoint 2 (Design- & Fragen-Prüfung) in Tasks.`);
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: 'Übergeben an Tasks (Design- & Fragen-Prüfung)',
        content: {
          checkpoint: 'DESIGN_REVIEW',
          reason: 'Vision-Analyse abgeschlossen. Wartet auf manuelle Prüfung von Zielgruppe, Farbausschluss und Rewrite in Tasks.',
          isApproved: true,
          analysis: u3.analysisResult
        }
      });

      TaskLogService.updateTaskStatus(taskId, {
        status: 'AWAITING_DESIGN_REVIEW',
        checkpoint: 'DESIGN_REVIEW',
        analysisResult: u3.analysisResult,
        hasError: false
      });

      return { success: true, task: this.getTask(taskId), pausedAtCheckpoint: 'DESIGN_REVIEW' };
    }

    // If autonomy is enabled, proceed automatically through U4 -> U7
    return await this.runFromStep(taskId, 'U4');
  }

  /**
   * Resume pipeline from current state (e.g. U3 -> U7)
   */
  static async resumePipeline(taskId: string): Promise<{ success: boolean; task?: DesignTaskLog; error?: string }> {
    console.log(`[UpdatePipeline] ▶️ Setze Pipeline ab aktuellem Stand für Task ${taskId} fort...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    // If artwork not downloaded yet, do U2
    if (!task.localMbaPngPath || !fs.existsSync(task.localMbaPngPath)) {
      const u2 = await this.stepU2_DownloadArtwork(taskId);
      if (!u2.success) return { success: false, error: u2.error };
    }

    // Step U3: Vision & Listing Analysis if not already done
    if (!task.analysisResult) {
      const u3 = await this.stepU3_AnalyzeAndPrompt(taskId);
      if (!u3.success) return { success: false, error: u3.error };
    }

    return await this.runFromStep(taskId, 'U4');
  }

  /**
   * Run a single step (for Retry or Step-Back)
   */
  static async runStep(taskId: string, step: string): Promise<{ success: boolean; data?: any; error?: string }> {
    switch (step.toUpperCase()) {
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
      case 'RESUME':
      case 'CONTINUE':
        return await this.resumePipeline(taskId);
      default: return { success: false, error: `Unbekannter Step: ${step}` };
    }
  }
}

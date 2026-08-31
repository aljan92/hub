import fs from 'fs';
import path from 'path';
import { DesignTaskLog, TaskStatus, SessionEvent } from '../../types/tasks';
import { TaskLogService } from './taskLogService';
import { AmazonInspectService } from './amazonInspectService';
import { loadSettings } from './settingsService';
import { QueueService } from './queueService';
import { SystemPromptService } from './systemPromptService';
import { LLMService, EnglishListing } from './llmService';
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

    TaskLogService.updateTaskStatus(taskId, { status: 'UPDATE_DOWNLOADING_ARTWORK', hasError: false });

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

    TaskLogService.updateTaskStatus(taskId, { status: 'ANALYZING_DESIGN', hasError: false });

    // Prepare high-contrast 2x2 grid image for vision analysis & UI preview
    let imageBase64: string | null = null;
    let gridPreviewUrl: string | undefined;
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const mbaPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
    const rawPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
    const targetPath = (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
      ? task.localMbaPngPath
      : fs.existsSync(mbaPath) ? mbaPath : fs.existsSync(rawPath) ? rawPath : null;

    const gridOutputPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_grid2x2.jpg`);

    if (targetPath) {
      try {
        const { base64DataUrl, savedPath } = await VisionOptimizationService.prepareVisionImage(targetPath, gridOutputPath);
        imageBase64 = base64DataUrl;
        if (savedPath || fs.existsSync(gridOutputPath)) {
          gridPreviewUrl = `/api/v1/designs/grid2x2/${encodeURIComponent(taskId)}`;
        }
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

      const niche1 = parsed.niche_analysis?.niche1 || parsed.niche1 || 'Graphic Art';
      const rawNiche2 = parsed.niche_analysis?.niche2 || parsed.niche2 || 'none';
      const niche2 = rawNiche2 && rawNiche2.toLowerCase() !== 'none' ? rawNiche2 : 'none';
      const rawSub = parsed.niche_analysis?.subniche || parsed.subniche || 'none';
      const subniche = rawSub && rawSub.toLowerCase() !== 'none' ? rawSub : 'none';
      const rawKw = parsed.niche_analysis?.keywords || parsed.keywords || parsed.seo_keywords || [];
      const keywords: string[] = Array.isArray(rawKw)
        ? rawKw.map((k: any) => String(k).trim()).filter(Boolean)
        : (typeof rawKw === 'string' ? rawKw.split(',').map(s => s.trim()).filter(Boolean) : []);
      const avoidColor = parsed.avoid_product_colors?.avoid || parsed.avoidColor || 'none';
      const fitTypes = parsed.target_group?.selected || (Array.isArray(parsed.fitTypes) ? parsed.fitTypes : ['Men', 'Women', 'Youth']);
      const detectedQuote = parsed.quote_check?.detected_quote || parsed.detected_quote || rawPayload.quote || '';
      const rewriteNeeded = parsed.listing_audit?.rewrite_recommended ?? parsed.rewriteNeeded ?? true;
      const reasoning = parsed.listing_audit?.current_weaknesses || parsed.reasoning || '';

      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_ANALYZED',
        niche1,
        niche2,
        subniche,
        keywords,
        previewUrl: gridPreviewUrl || task.previewUrl,
        grid2x2Url: gridPreviewUrl,
        analysisResult: {
          ...parsed,
          niche1,
          niche2,
          subniche,
          keywords,
          avoidColor,
          fitTypes,
          rewriteNeeded,
          reasoning,
          detectedQuote,
          grid2x2Url: gridPreviewUrl
        },
        customAnswers: {
          niche1,
          niche2,
          subniche,
          keywords,
          audience: Array.isArray(fitTypes) ? fitTypes.join(', ') : 'Men, Women, Youth',
          avoidColor,
          notes: reasoning
        },
        hasError: false
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ANALYSIS_RESPONSE',
        title: `Vision-Befund: Rewrite ${rewriteNeeded ? 'empfohlen' : 'nicht nötig'} (Nische: ${niche1})`,
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
    console.log(`[UpdatePipeline] ✍️ Starte Step U4 (Master English Listing Rewrite) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const settings = loadSettings();
    const apiKey = settings.openRouterApiKey;
    if (!apiKey) {
      const err = 'Kein OpenRouter API-Key in den Einstellungen hinterlegt.';
      TaskLogService.updateTaskStatus(taskId, { status: 'ERROR', hasError: true, errorDetails: err });
      return { success: false, error: err };
    }

    TaskLogService.updateTaskStatus(taskId, { status: 'GENERATING_LISTING', hasError: false });

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

    let originalImageBase64: string | undefined;
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const mbaPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
    const rawPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
    const targetPath = (task.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
      ? task.localMbaPngPath
      : fs.existsSync(mbaPath) ? mbaPath : fs.existsSync(rawPath) ? rawPath : null;

    if (targetPath && fs.existsSync(targetPath)) {
      try {
        const buf = fs.readFileSync(targetPath);
        originalImageBase64 = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (e) {
        console.warn(`[UpdatePipeline] Konnte Original-PNG für Listing-LLM nicht einlesen:`, e);
      }
    }

    try {
      const enListing = await LLMService.generateMasterEnglishListing({
        niche1,
        niche2,
        subniche,
        keywords,
        quote: raw.quote || task.analysisResult?.quote_check?.detected_quote || '',
        audience,
        avoidColor,
        imageSource: originalImageBase64,
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

    TaskLogService.updateTaskStatus(taskId, { status: 'CHECKING_TRADEMARKS', hasError: false });

    const rawListing = task.listingResult?.en || task.payload?.listing || {};
    const listing: EnglishListing = {
      brand: rawListing.brand || task.payload?.brand || '',
      title: rawListing.title || task.payload?.title || '',
      bullet1: rawListing.bullet1 || task.payload?.bullet1 || '',
      bullet2: rawListing.bullet2 || task.payload?.bullet2 || '',
      description: rawListing.description || task.payload?.description || ''
    };

    const quote = task.payload?.quote || '';
    const niche1 = task.niche1 || task.customAnswers?.niche1 || '';
    const niche2 = task.niche2 || task.customAnswers?.niche2 || '';
    const subniche = task.subniche || task.customAnswers?.subniche || '';

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_REQUEST',
      title: 'Trademark Workflow V2 (USPTO Live Scan + Dual-LLM Referee/Verifier)',
      content: { fields: listing, niche1, niche2, subniche, quote },
      metadata: { provider: 'Productor USPTO / GPT-5.6 Sol' }
    });

    const auditV2 = await TrademarkService.executeTrademarkAuditV2({
      listing,
      quote,
      niche1,
      niche2,
      subniche,
      maxRewriteCycles: 3,
      onEvent: (ev) => {
        TaskLogService.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: ev.type,
          title: ev.title,
          content: ev.content
        });
      }
    });

    if (auditV2.finalDecision === 'ESCALATE' || !auditV2.isSafe) {
      const reason = auditV2.reasonCode || 'Trademark-Konflikt erfordert manuelle Freigabe.';
      TaskLogService.updateTaskStatus(taskId, {
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

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: `Übergeben an Tasks (Update TM Eskalation: ${reason})`,
        content: {
          checkpoint: 'TM_REVIEW',
          reason,
          finalDecision: auditV2.finalDecision,
          totalHits: auditV2.finalTrademarkHits.length,
          forbiddenTerms: auditV2.forbiddenTermsForTask
        }
      });

      return { success: false, error: reason };
    }

    TaskLogService.updateTaskStatus(taskId, {
      status: 'UPDATE_TM_CHECKED',
      listingResult: { en: auditV2.finalListing },
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

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'TM_CHECK_RESPONSE',
      title: `Trademark Workflow V2 freigegeben (${auditV2.finalTrademarkHits.length} Treffer, ${auditV2.blockedProducts.length} Produkte gesperrt)`,
      content: { auditV2, refinedListing: auditV2.finalListing },
      metadata: { provider: 'Productor USPTO / GPT-5.6 Sol' }
    });

    return { success: true, tmResult: auditV2 };
  }

  /**
   * Step U6: SEO Translation (DE, FR, ES, IT, JA) & Hard Sanitizer
   */
  static async stepU6_TranslateListing(taskId: string): Promise<{ success: boolean; fullListings?: any; error?: string }> {
    console.log(`[UpdatePipeline] 🌐 Starte Step U6 (SEO Translation & Sanitizer) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    TaskLogService.updateTaskStatus(taskId, { status: 'TRANSLATING_LISTING', hasError: false });

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

    // Robust fitTypes resolution
    let resolvedFitTypes: string[] = ['men', 'women', 'youth'];
    const rawAudience = task.customAnswers?.audience || (Array.isArray(task.analysisResult?.target_group?.selected) ? task.analysisResult.target_group.selected.join(', ') : '');
    if (rawAudience) {
      const aud = String(rawAudience).toLowerCase();
      const fits: string[] = [];
      if (aud.includes('men') || aud.includes('männer') || aud.includes('herren')) fits.push('men');
      if (aud.includes('women') || aud.includes('frauen') || aud.includes('damen')) fits.push('women');
      if (aud.includes('youth') || aud.includes('kids') || aud.includes('kinder') || aud.includes('jugend')) fits.push('youth');
      if (fits.length > 0) resolvedFitTypes = fits;
    } else if (Array.isArray(task.analysisResult?.fitTypes)) {
      resolvedFitTypes = task.analysisResult.fitTypes.map((s: string) => String(s).toLowerCase());
    }

    // Robust avoidColor resolution
    let resolvedAvoidColor: 'white' | 'black' | 'none' = 'none';
    const rawAvoid = String(
      task.customAnswers?.avoidColor || 
      task.analysisResult?.avoid_product_colors?.avoid || 
      task.analysisResult?.avoidColor || 
      task.payload?.avoidColor || 
      'none'
    ).toLowerCase();

    if (rawAvoid.includes('white') || rawAvoid.includes('weiß')) {
      resolvedAvoidColor = 'white';
    } else if (rawAvoid.includes('black') || rawAvoid.includes('schwarz')) {
      resolvedAvoidColor = 'black';
    }

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
        fitTypes: resolvedFitTypes,
        avoidColor: resolvedAvoidColor,
        imagePath: task.localImagePath || '',
        pngPath: task.localMbaPngPath || '',
        publishedProductsCount: task.payload?.liveStats?.publishedCount ?? task.payload?.liveVariantsCount ?? task.payload?.publishedCount ?? 0,
        liveStats: task.payload?.liveStats || null,
        liveProductSummary: task.payload?.productSummary || null,
        liveProductTypes: task.payload?.productTypes || null,
        tmBlockedProductIds: task.blockedProducts || task.trademarkCheckResult?.blockedProducts || []
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

    // Check AI Autonomy Switch & Quality Assessment for Update Pipeline
    const settings = loadSettings();
    const autonomyUpdate = settings.aiAutonomyUpdateEnabled ?? settings.aiAutonomyEnabled;
    const isDefective = u3.analysisResult?.design_quality?.quality_verdict === 'DEFECTIVE' || u3.analysisResult?.overall_verdict === 'REJECTED';
    const qualityReason = u3.analysisResult?.design_quality?.quality_issues;
    const taskCurrent = this.getTask(taskId);
    const hasRejection = Boolean(taskCurrent?.payload?.hasRejection);
    const rejectionReason = taskCurrent?.payload?.rejectionReason;

    if (!autonomyUpdate || isDefective || hasRejection) {
      const pauseReason = hasRejection
        ? `⚠️ Amazon Rejection / Richtlinien-Hinweis auf Amazon festgestellt (${rejectionReason || 'Mindestens ein Produkt/Marktplatz abgelehnt oder beanstandet'}). Autonomie gestoppt zur manuellen Freigabe in Tasks.`
        : isDefective
          ? `⚠️ Mangelhafte Design-Qualität erkannt (${qualityReason || 'Kantenfehler/Halos/Artefakte'}). Autonomie pausiert zur manuellen Sichtprüfung.`
          : 'Vision-Analyse abgeschlossen. Wartet auf manuelle Prüfung von Zielgruppe, Farbausschluss und Rewrite in Tasks.';

      console.log(`[UpdatePipeline] 🛑 Task ${taskId} pausiert bei Checkpoint 2 (Design- & Rejection-Prüfung) in Tasks: ${pauseReason}`);
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: hasRejection 
          ? '⚠️ Amazon Rejection erkannt: Übergeben an Tasks zur manuellen Freigabe'
          : (isDefective ? '⚠️ Qualitätswarnung: Übergeben an Tasks' : 'Übergeben an Tasks (Design- & Fragen-Prüfung)'),
        content: {
          checkpoint: 'DESIGN_REVIEW',
          reason: pauseReason,
          hasRejection,
          rejectionReason,
          isApproved: !isDefective && !hasRejection,
          analysis: u3.analysisResult,
          isDefective,
          qualityIssues: qualityReason
        }
      });

      TaskLogService.updateTaskStatus(taskId, {
        status: 'AWAITING_DESIGN_REVIEW',
        checkpoint: 'DESIGN_REVIEW',
        analysisResult: u3.analysisResult,
        needsManualReview: true,
        hasError: isDefective || hasRejection
      });

      return { success: true, task: this.getTask(taskId), pausedAtCheckpoint: 'DESIGN_REVIEW' };
    }

    // If autonomy is enabled and design quality is approved, proceed automatically through U4 -> U7
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

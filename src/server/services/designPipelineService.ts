import fs from 'fs';
import path from 'path';
import { DesignTaskLog, TaskStatus, SessionEvent } from '../../types/tasks';
import { TaskLogService } from './taskLogService';
import { loadSettings } from './settingsService';
import { SystemPromptService } from './systemPromptService';
import { IdeogramService } from './ideogramService';
import { TrademarkService } from './trademarkService';
import { BannedWordsService } from './bannedWordsService';
import { VectorizerService } from './vectorizerService';
import { SvgRenderService } from './svgRenderService';
import { LLMService } from './llmService';
import { ArtworkResizeService } from './artworkResizeService';

export class DesignPipelineService {
  /**
   * Helper to retrieve task safely
   */
  private static getTask(taskId: string): DesignTaskLog | undefined {
    const logs = TaskLogService.loadLogs();
    return logs.find(t => t.id === taskId);
  }

  /**
   * Step D1: Pre-Flight Trademark Check on Quote / Slogan
   */
  static async stepD1_PreflightTrademark(taskId: string): Promise<{ success: boolean; tmResult?: any; error?: string }> {
    console.log(`[DesignPipeline] 🔍 Starte Step D1 (Pre-Flight TM Check) für Task ${taskId}...`);
    const task = this.getTask(taskId);
    if (!task) return { success: false, error: `Task ${taskId} nicht gefunden` };

    const quote = task.quote || task.payload?.quote || '';
    if (!quote.trim()) {
      console.log(`[DesignPipeline] Kein Quote vorhanden, überspringe Pre-Flight TM.`);
      return { success: true };
    }

    try {
      const tmResult = await TrademarkService.checkText(quote, ['25']);
      const isInfringing = tmResult.totalHits > 0 && tmResult.hasInfringementClass25;

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TM_CHECK_RESPONSE',
        title: isInfringing ? `Pre-Flight USPTO Treffer (${tmResult.totalHits} Treffer)` : 'Pre-Flight USPTO sauber (0 Treffer)',
        content: { ...tmResult, isPreFlight: true },
        metadata: { provider: 'Productor / USPTO' }
      });

      if (isInfringing) {
        console.warn(`[DesignPipeline] ⚠️ Pre-Flight TM Treffer für Quote "${quote}"`);
      }

      return { success: true, tmResult };
    } catch (err: any) {
      console.warn(`[DesignPipeline] Pre-Flight TM Check Fehler:`, err.message);
      return { success: true, tmResult: { skipped: true, reason: err.message } };
    }
  }

  /**
   * Step D2: Generate Ideogram Prompt via OpenRouter
   */
  static async stepD2_GeneratePrompt(taskId: string): Promise<{ success: boolean; prompt?: string; error?: string }> {
    console.log(`[DesignPipeline] 🧠 Starte Step D2 (Ideogram Prompt Generation) für Task ${taskId}...`);
    try {
      await TaskLogService.generatePromptWithOpenRouter(taskId);
      const updated = this.getTask(taskId);
      return { success: true, prompt: updated?.resultPrompt };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D2:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D3: Image Generation via Ideogram API (V_3)
   */
  static async stepD3_GenerateImage(taskId: string): Promise<{ success: boolean; imageUrl?: string; localPath?: string; error?: string }> {
    console.log(`[DesignPipeline] 🎨 Starte Step D3 (Ideogram Bild-Generierung) für Task ${taskId}...`);
    try {
      await TaskLogService.processTaskWithIdeogram(taskId);
      const updated = this.getTask(taskId);
      return { success: true, imageUrl: updated?.imageUrl, localPath: updated?.localImagePath };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D3:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D4: Vision QA & Color Count Analysis (OpenRouter)
   */
  static async stepD4_AnalyzeDesign(taskId: string): Promise<{ success: boolean; analysisResult?: any; error?: string }> {
    console.log(`[DesignPipeline] 👁️ Starte Step D4 (Design QA Analyse) für Task ${taskId}...`);
    try {
      await TaskLogService.analyzeDesignWithOpenRouter(taskId);
      const updated = this.getTask(taskId);
      return { success: true, analysisResult: updated?.analysisResult };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D4:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D5: Multi-Marketplace MBA SEO Listing Generation (OpenRouter)
   */
  static async stepD5_GenerateListing(taskId: string): Promise<{ success: boolean; listingResult?: any; error?: string }> {
    console.log(`[DesignPipeline] 📝 Starte Step D5 (Listing Erstellung) für Task ${taskId}...`);
    try {
      await TaskLogService.generateListingWithOpenRouter(taskId);
      const updated = this.getTask(taskId);
      return { success: true, listingResult: updated?.listingResult };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D5:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D6: Trademark Validation & Refinement Loop
   */
  static async stepD6_TrademarkCheck(taskId: string): Promise<{ success: boolean; tmResult?: any; error?: string }> {
    console.log(`[DesignPipeline] ⚖️ Starte Step D6 (Trademark Check & Refine Loop) für Task ${taskId}...`);
    try {
      await TaskLogService.performTrademarkCheck(taskId);
      const updated = this.getTask(taskId);
      return { success: true, tmResult: updated?.trademarkCheckResult };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D6:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D7: Vectorization & 4-Panel Cutout Audit
   */
  static async stepD7_VectorizeAndAudit(taskId: string): Promise<{ success: boolean; svgUrl?: string; error?: string }> {
    console.log(`[DesignPipeline] ⚡ Starte Step D7 (Vektorisierung & Cutout-Audit) für Task ${taskId}...`);
    try {
      await TaskLogService.vectorizeDesignTask(taskId);
      const updated = this.getTask(taskId);
      return { success: true, svgUrl: updated?.svgUrl };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D7:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D7.5: Resize Artworks (Trimmed, Mug Standard & Brush, Drinkware Standard)
   */
  static async stepD7_5_ResizeArtworks(taskId: string): Promise<{ success: boolean; resizedAssets?: any; error?: string }> {
    console.log(`[DesignPipeline] 📐 Starte Step D7.5 (Resize Artworks) für Task ${taskId}...`);
    try {
      const task = this.getTask(taskId);
      if (!task || !task.localMbaPngPath) {
        throw new Error(`Task #${taskId} hat kein lokales Master MBA-PNG.`);
      }
      const resized = await ArtworkResizeService.generateResizedArtworks(taskId, task.localMbaPngPath);
      task.resizedAssets = resized;
      TaskLogService.updateTaskStatus(taskId, { resizedAssets: resized });
      return { success: true, resizedAssets: resized };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D7.5:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Step D8: Hand-off to Upload Queue (106 Slots)
   */
  static async stepD8_Enqueue(taskId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[DesignPipeline] 📦 Starte Step D8 (Upload Queue Handoff) für Task ${taskId}...`);
    try {
      await TaskLogService.completeTaskAndEnqueue(taskId);
      return { success: true };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D8:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Executes a single specific step
   */
  static async runStep(taskId: string, stepName: string): Promise<{ success: boolean; error?: string; result?: any }> {
    const norm = stepName.toUpperCase().trim();
    switch (norm) {
      case 'D1':
      case 'PREFLIGHT':
      case 'PREFLIGHT_TM_REQUEST':
        return await this.stepD1_PreflightTrademark(taskId);
      case 'D2':
      case 'PROMPT':
      case 'LLM_REQUEST':
        return await this.stepD2_GeneratePrompt(taskId);
      case 'D3':
      case 'IMAGE':
      case 'IDEOGRAM':
      case 'IDEOGRAM_REQUEST':
        return await this.stepD3_GenerateImage(taskId);
      case 'D4':
      case 'ANALYZE':
      case 'VISION':
      case 'ANALYSIS_REQUEST':
        return await this.stepD4_AnalyzeDesign(taskId);
      case 'D5':
      case 'LISTING':
      case 'LISTING_REQUEST':
        return await this.stepD5_GenerateListing(taskId);
      case 'D6':
      case 'TRADEMARK':
      case 'TM':
      case 'TM_CHECK_REQUEST':
      case 'TM_REFINE_REQUEST':
        return await this.stepD6_TrademarkCheck(taskId);
      case 'D7':
      case 'VECTORIZE':
      case 'SVG':
      case 'VECTORIZE_REQUEST':
      case 'SVG_AUDIT_REQUEST':
        return await this.stepD7_VectorizeAndAudit(taskId);
      case 'D7_5':
      case 'RESIZE':
      case 'RESIZE_REQUEST':
        return await this.stepD7_5_ResizeArtworks(taskId);
      case 'D8':
      case 'QUEUE':
      case 'ENQUEUE':
        return await this.stepD8_Enqueue(taskId);
      default:
        return { success: false, error: `Unbekannter Step: ${stepName}` };
    }
  }

  /**
   * Runs the full Design Creation Pipeline end-to-end
   */
  static async runDesignPipeline(taskId: string): Promise<{ success: boolean; currentStep?: string; error?: string }> {
    console.log(`[DesignPipeline] 🚀 Starte Full Design Creation Pipeline für Task ${taskId}...`);
    
    // Step D1: Pre-Flight TM
    await this.stepD1_PreflightTrademark(taskId);

    // Step D2: Generate Prompt
    const r2 = await this.stepD2_GeneratePrompt(taskId);
    if (!r2.success) return { success: false, currentStep: 'D2', error: r2.error };

    // Step D3: Generate Image (Ideogram)
    const r3 = await this.stepD3_GenerateImage(taskId);
    if (!r3.success) return { success: false, currentStep: 'D3', error: r3.error };

    // Step D4: Analyze Design (Vision QA)
    const r4 = await this.stepD4_AnalyzeDesign(taskId);
    if (!r4.success) return { success: false, currentStep: 'D4', error: r4.error };

    // Step D5: Generate Listing
    const r5 = await this.stepD5_GenerateListing(taskId);
    if (!r5.success) return { success: false, currentStep: 'D5', error: r5.error };

    // Step D6: TM Check & Refine
    const r6 = await this.stepD6_TrademarkCheck(taskId);
    if (!r6.success) return { success: false, currentStep: 'D6', error: r6.error };

    // Step D7: Vectorize & SVG Audit
    const r7 = await this.stepD7_VectorizeAndAudit(taskId);
    if (!r7.success) return { success: false, currentStep: 'D7', error: r7.error };

    // Step D8: Enqueue
    const r8 = await this.stepD8_Enqueue(taskId);
    if (!r8.success) return { success: false, currentStep: 'D8', error: r8.error };

    return { success: true, currentStep: 'D8' };
  }
}

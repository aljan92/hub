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
import { TaskExecutionLock } from './taskExecutionLock';
import { PipelineExecutionCoordinator } from './pipelineExecutionCoordinator';

export class DesignPipelineService {
  /**
   * Helper to retrieve task safely
   */
  private static getTask(taskId: string): DesignTaskLog | undefined {
    return TaskLogService.getTaskLogById(taskId);
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
    
    // Pre-Flight Check: OpenRouter Guthaben & Circuit Breaker
    const circuit = LLMService.isCircuitBroken();
    if (circuit.broken) {
      return { success: false, error: `Design-Pipeline pausiert: ${circuit.reason}` };
    }
    const balance = await LLMService.getAvailableBalance();
    const settings = loadSettings();
    const threshold = settings.openRouterMinBalanceThreshold ?? 1.00;
    if (balance !== null && balance < threshold) {
      return { success: false, error: `Design-Pipeline pausiert: OpenRouter Guthaben ($${balance.toFixed(2)}) unter Schwellenwert ($${threshold.toFixed(2)})` };
    }

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
      if (updated?.hasError || updated?.status === 'ERROR') return { success: false, error: updated.errorDetails || 'Vektorisierung/Finalisierung fehlgeschlagen' };
      return { success: true, svgUrl: updated?.svgUrl };
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D7:`, err);
      return { success: false, error: err.message };
    }
  }


  /**
   * Step D8: Hand-off to Upload Queue (106 Slots)
   */
  static async stepD8_Enqueue(taskId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[DesignPipeline] 📦 Starte Step D8 (Upload Queue Handoff) für Task ${taskId}...`);
    try {
      return await TaskLogService.completeTaskAndEnqueue(taskId);
    } catch (err: any) {
      console.error(`[DesignPipeline] ❌ Fehler in Step D8:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Executes a single specific step
   */
  static async runStep(taskId: string, stepName: string): Promise<{ success: boolean; error?: string; result?: any }> {
    return PipelineExecutionCoordinator.runExclusive(taskId, () => this.runStepExclusive(taskId, stepName));
  }

  private static async runStepExclusive(taskId: string, stepName: string): Promise<{ success: boolean; error?: string; result?: any }> {
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
      case 'D8':
      case 'QUEUE':
      case 'ENQUEUE':
        return await this.stepD8_Enqueue(taskId);
      default:
        return { success: false, error: `Unbekannter Step: ${stepName}` };
    }
  }

  /**
   * Runs Design Creation Pipeline sequentially from a specific step forward
   */
  static async runFromStep(
    taskId: string, 
    startStep: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' = 'D1',
    owner: 'NORMAL' | 'RECOVERY' | 'USER_ACTION' = 'NORMAL'
  ): Promise<{ success: boolean; currentStep?: string; pausedAtCheckpoint?: string; error?: string }> {
    return PipelineExecutionCoordinator.runExclusive(taskId, async () => {
      return this.runFromStepWithTaskLock(taskId, startStep, owner);
    }, () => {
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: '⏳ Wartet auf freien Verarbeitungsslot',
        content: { phase: 'WAITING_FOR_PIPELINE_SLOT', status: 'WAITING' }
      });
    });
  }

  private static async runFromStepWithTaskLock(
    taskId: string,
    startStep: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' = 'D1',
    owner: 'NORMAL' | 'RECOVERY' | 'USER_ACTION' = 'NORMAL'
  ): Promise<{ success: boolean; currentStep?: string; pausedAtCheckpoint?: string; error?: string }> {
    console.log(`[DesignPipeline] 🚀 Führe Design Pipeline ab Step ${startStep} für Task ${taskId} aus (Owner: ${owner})...`);

    if (!TaskExecutionLock.acquire(taskId, owner)) {
      console.warn(`[DesignPipeline] ⚠️ Task ${taskId} wird bereits ausgeführt (${JSON.stringify(TaskExecutionLock.getLockInfo(taskId))}). Abgebrochen.`);
      return { success: false, error: `Task ${taskId} is currently executing.` };
    }

    try {
      const stepOrder: Array<'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8'> = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
      const startIndex = stepOrder.indexOf(startStep);

      for (let i = startIndex; i < stepOrder.length; i++) {
        const step = stepOrder[i];
        if (step === 'D1') {
          await this.stepD1_PreflightTrademark(taskId);
        } else if (step === 'D2') {
          const r2 = await this.stepD2_GeneratePrompt(taskId);
          if (!r2.success) return { success: false, currentStep: 'D2', error: r2.error };
        } else if (step === 'D3') {
          const r3 = await this.stepD3_GenerateImage(taskId);
          if (!r3.success) return { success: false, currentStep: 'D3', error: r3.error };
        } else if (step === 'D4') {
          const r4 = await this.stepD4_AnalyzeDesign(taskId);
          if (!r4.success) return { success: false, currentStep: 'D4', error: r4.error };

          // Post-Analysis Decision Gate: Check for defective design or manual review requirement
          const task = this.getTask(taskId);
          const isDefective = task?.analysisResult?.design_quality?.quality_verdict === 'DEFECTIVE' || task?.analysisResult?.overall_verdict === 'REJECTED';
          if (isDefective) {
            const reason = task?.analysisResult?.design_quality?.quality_issues || 'Defective design quality detected';
            TaskLogService.updateTaskStatus(taskId, {
              status: 'AWAITING_DESIGN_REVIEW',
              checkpoint: 'DESIGN_REVIEW',
              hasError: true,
              errorDetails: reason
            });
            return { success: true, currentStep: 'D4', pausedAtCheckpoint: 'DESIGN_REVIEW' };
          }
        } else if (step === 'D5') {
          const r5 = await this.stepD5_GenerateListing(taskId);
          if (!r5.success) return { success: false, currentStep: 'D5', error: r5.error };
        } else if (step === 'D6') {
          const r6 = await this.stepD6_TrademarkCheck(taskId);
          if (!r6.success) return { success: false, currentStep: 'D6', error: r6.error };

          const task = this.getTask(taskId);
          if (task?.status === 'AWAITING_TM_REVIEW') {
            return { success: true, currentStep: 'D6', pausedAtCheckpoint: 'TM_REVIEW' };
          }
        } else if (step === 'D7') {
          const r7 = await this.stepD7_VectorizeAndAudit(taskId);
          if (!r7.success) return { success: false, currentStep: 'D7', error: r7.error };

          const task = this.getTask(taskId);
          if (task?.status === 'AWAITING_SVG_REVIEW') {
            return { success: true, currentStep: 'D7', pausedAtCheckpoint: 'SVG_REVIEW' };
          }
        } else if (step === 'D8') {
          const r8 = await this.stepD8_Enqueue(taskId);
          if (!r8.success) return { success: false, currentStep: 'D8', error: r8.error };
        }
      }

      return { success: true, currentStep: 'D8' };
    } finally {
      TaskExecutionLock.release(taskId);
    }
  }

  /**
   * Runs the full Design Creation Pipeline end-to-end
   */
  static async runDesignPipeline(taskId: string): Promise<{ success: boolean; currentStep?: string; error?: string }> {
    return await this.runFromStep(taskId, 'D1', 'NORMAL');
  }
}

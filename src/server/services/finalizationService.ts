import fs from 'fs';
import path from 'path';
import { TaskLogService, DesignTaskLog } from './taskLogService';
import { QueueService, QueueItem } from './queueService';
import { ListingSanitizationService } from './listingSanitizationService';
import { ListingValidationService } from './listingValidationService';
import { ArtworkResizeService, ResizedArtworksResult } from './artworkResizeService';

export interface FinalizationParams {
  taskId: string;
  pipeline: 'DESIGN' | 'UPDATE';
  brand?: string;
  title?: string;
  bullet1?: string;
  bullet2?: string;
  description?: string;
  listings?: Record<string, any>;
  fitTypes?: string[];
  avoidColor?: 'white' | 'black' | 'none';
  customBackgroundColor?: string;
  masterPngPath: string;
  localImagePath?: string;
  niche?: string;
  designId?: string;
  publishedProductsCount?: number;
  liveStats?: any;
  liveProductSummary?: any;
  liveProductTypes?: string[];
  tmBlockedProductIds?: string[];
}

export interface FinalizationResult {
  success: boolean;
  error?: string;
  queueItemId?: string;
  resizedAssets?: ResizedArtworksResult;
}

export class FinalizationService {
  /**
   * Single unified finalization pipeline for both Design and Update pipelines.
   * Atomically executes:
   * 1. Deterministic Listing Sanitization (Amazon Charset safe, preserving Umlauts/Kanji/Accents)
   * 2. Final Strict Validation (no semantic mutations, strictly enforces limits)
   * 3. Master Artwork & Trimmed Resizes (exactly once, using trimmed content as source)
   * 4. Asset Verification on disk
   * 5. Atomic Queue Handoff with all task completion side-effects preserved
   */
  public static async finalizeForQueue(params: FinalizationParams): Promise<FinalizationResult> {
    const { taskId, pipeline } = params;
    console.log(`[FinalizationService] 🚀 Starte Unified Finalization für Task #${taskId} (Pipeline: ${pipeline})...`);
    const task = TaskLogService.getTask(taskId);
    const masterPngPath = params.masterPngPath || task?.localMbaPngPath || task?.localImagePath || '';

    // =========================================================================
    // PHASE 1: LISTING SANITIZATION
    // =========================================================================
    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '🧹 Listing wird bereinigt & normalisiert (Amazon-safe Charset)...',
      content: { phase: 'SANITIZING', status: 'RUNNING' }
    });

    const rootListing = {
      brand: params.brand || '',
      title: params.title || '',
      bullet1: params.bullet1 || '',
      bullet2: params.bullet2 || '',
      description: params.description || ''
    };

    const sanitizedRoot = ListingSanitizationService.sanitizeListing(rootListing);
    const rawListings = params.listings && typeof params.listings === 'object' ? params.listings : { en: rootListing };
    const sanitizedListings = ListingSanitizationService.sanitizeAllListings(rawListings);

    // Ensure 'en' is in sanitizedListings
    sanitizedListings.en = {
      ...sanitizedRoot,
      ...(sanitizedListings.en || {})
    };

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '✓ Listing sanitisiert (Smart Quotes, typografische Dashes & Amazon Charset normalisiert)',
      content: { phase: 'SANITIZING', status: 'SUCCESS', listing: sanitizedRoot }
    });

    // =========================================================================
    // PHASE 2: FINAL LISTING VALIDATION
    // =========================================================================
    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '🔍 Finale Validierung der Listing-Limits vor Queue-Handoff...',
      content: { phase: 'FINAL_VALIDATION', status: 'RUNNING' }
    });

    const validation = ListingValidationService.validateFinalListing({
      listing: sanitizedRoot,
      allListings: sanitizedListings
    });

    if (!validation.isValid) {
      const errorMsg = `Final Listing Validation fehlgeschlagen: ${validation.errors.join('; ')}`;
      console.error(`[FinalizationService] ❌ ${errorMsg}`);

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'FINALIZATION_EVENT' as any,
        title: '❌ Finale Listing-Validierung fehlgeschlagen',
        content: { phase: 'FINAL_VALIDATION', status: 'FAILED', errors: validation.errors }
      });

      TaskLogService.updateTaskStatus(taskId, {
        hasError: true,
        errorDetails: errorMsg
      });

      return { success: false, error: errorMsg };
    }

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '✓ Finale Validierung bestanden (Title ≤60, Brand ≤50, Bullets ≤256, alle Locales geprüft)',
      content: { phase: 'FINAL_VALIDATION', status: 'SUCCESS' }
    });

    // =========================================================================
    // PHASE 3: MASTER ARTWORK VALIDATION & RESIZE PREPARATION
    // =========================================================================
    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '📐 Artwork-Vorbereitung (Alpha Trim & Two-Sided Resizes)...',
      content: { phase: 'ARTWORK_PREPARATION', status: 'RUNNING' }
    });

    if (!masterPngPath || !fs.existsSync(masterPngPath)) {
      const err = `Master-Artwork nicht gefunden unter: ${masterPngPath}`;
      console.error(`[FinalizationService] ❌ ${err}`);

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'FINALIZATION_EVENT' as any,
        title: '❌ Master-Artwork fehlt auf Disk',
        content: { phase: 'ARTWORK_PREPARATION', status: 'FAILED', error: err }
      });

      TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
      return { success: false, error: err };
    }

    let resizedAssets = task?.resizedAssets;
    const areAssetsValid = resizedAssets &&
      resizedAssets.trimmedPath && fs.existsSync(resizedAssets.trimmedPath) &&
      resizedAssets.mugStandardPath && fs.existsSync(resizedAssets.mugStandardPath) &&
      resizedAssets.mugBrushPath && fs.existsSync(resizedAssets.mugBrushPath) &&
      resizedAssets.drinkwareStandardPath && fs.existsSync(resizedAssets.drinkwareStandardPath) &&
      resizedAssets.drinkwareBrushPath && fs.existsSync(resizedAssets.drinkwareBrushPath);

    if (areAssetsValid) {
      console.log(`[FinalizationService] ⚡ Resized Assets für Task #${taskId} bereits vorhanden. Überspringe doppelten Resize.`);
    } else {
      try {
        // Execute resize exactly once via ArtworkResizeService mutex
        resizedAssets = await ArtworkResizeService.generateResizedArtworks(taskId, masterPngPath);
      } catch (resizeErr: any) {
        const err = `Fehler bei Artwork-Resize: ${resizeErr.message}`;
        console.error(`[FinalizationService] ❌ ${err}`);

        TaskLogService.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'FINALIZATION_EVENT' as any,
          title: '❌ Artwork-Resize fehlgeschlagen',
          content: { phase: 'ARTWORK_PREPARATION', status: 'FAILED', error: err }
        });

        TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
        return { success: false, error: err };
      }
    }

    // =========================================================================
    // PHASE 4: FINAL ASSET VALIDATION (Verifying files on disk)
    // =========================================================================
    const requiredFiles = [
      { name: 'Trimmed Master', path: resizedAssets.trimmedPath },
      { name: 'Mug Standard', path: resizedAssets.mugStandardPath },
      { name: 'Mug Brush', path: resizedAssets.mugBrushPath },
      { name: 'Drinkware Standard', path: resizedAssets.drinkwareStandardPath },
      { name: 'Drinkware Brush', path: resizedAssets.drinkwareBrushPath }
    ];

    for (const f of requiredFiles) {
      if (!f.path || !fs.existsSync(f.path)) {
        const err = `Generiertes Asset "${f.name}" nicht auf Disk gefunden: ${f.path}`;
        console.error(`[FinalizationService] ❌ ${err}`);
        TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
        return { success: false, error: err };
      }
    }

    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: '✓ Getrimmtes Master & alle 4 Two-Sided Varianten erfolgreich auf Disk verifiziert',
      content: { phase: 'ARTWORK_PREPARATION', status: 'SUCCESS', assets: resizedAssets }
    });

    // =========================================================================
    // PHASE 5: QUEUE HANDOFF & SIDE EFFECTS
    // =========================================================================
    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: `📦 Übergabe an die Upload-Queue (${pipeline === 'UPDATE' ? 'Tab Update' : 'Tab New'})...`,
      content: { phase: 'QUEUE_HANDOFF', status: 'RUNNING' }
    });

    let queueItem: QueueItem;

    if (pipeline === 'DESIGN') {
      queueItem = QueueService.enqueueDesign({
        taskId,
        designTitle: sanitizedRoot.title || 'Design #' + taskId,
        niche: params.niche || '',
        brand: sanitizedRoot.brand,
        title: sanitizedRoot.title,
        bullet1: sanitizedRoot.bullet1,
        bullet2: sanitizedRoot.bullet2,
        description: sanitizedRoot.description,
        listings: sanitizedListings,
        fitTypes: params.fitTypes && params.fitTypes.length > 0 ? params.fitTypes : ['men', 'women', 'youth'],
        avoidColor: params.avoidColor || 'none',
        customBackgroundColor: params.customBackgroundColor,
        imagePath: params.localImagePath || '',
        pngPath: params.masterPngPath,
        resizedAssets,
        tmBlockedProductIds: params.tmBlockedProductIds || []
      });

      // Preserve Design Task Completion Side Effects
      if (task) {
        task.status = 'COMPLETED';
        task.inQueue = true;
        task.checkpoint = undefined;
        task.hasError = false;
        task.resizedAssets = resizedAssets;
      }
      TaskLogService.updateTaskStatus(taskId, {
        status: 'COMPLETED',
        inQueue: true,
        hasError: false,
        resizedAssets
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: '📦 Design erfolgreich in die Upload-Queue übergeben',
        content: {
          phase: 'QUEUE_HANDOFF',
          status: 'SUCCESS',
          queueId: queueItem.id,
          allocatedSlots: queueItem.allocatedSlots,
          message: `Design mit 4500x5400px Master-PNG und sanitisiertem Listing an die Queue übergeben (${queueItem.allocatedSlots} Slots geplant).`
        }
      });
    } else {
      // UPDATE Pipeline
      queueItem = QueueService.enqueueItem({
        taskId,
        source: 'UPDATE',
        type: 'update',
        designId: params.designId,
        brand: sanitizedRoot.brand,
        title: sanitizedRoot.title,
        bullet1: sanitizedRoot.bullet1,
        bullet2: sanitizedRoot.bullet2,
        description: sanitizedRoot.description,
        listings: sanitizedListings,
        fitTypes: params.fitTypes && params.fitTypes.length > 0 ? params.fitTypes : ['men', 'women', 'youth'],
        avoidColor: params.avoidColor || 'none',
        imagePath: params.localImagePath || '',
        pngPath: params.masterPngPath,
        resizedAssets,
        publishedProductsCount: params.publishedProductsCount ?? 0,
        liveStats: params.liveStats || null,
        liveProductSummary: params.liveProductSummary || null,
        liveProductTypes: params.liveProductTypes || null,
        tmBlockedProductIds: params.tmBlockedProductIds || []
      });

      // Preserve Update Task Completion Side Effects
      if (task) {
        task.status = 'UPDATE_QUEUED';
        task.hasError = false;
        task.resizedAssets = resizedAssets;
      }
      TaskLogService.updateTaskStatus(taskId, {
        status: 'UPDATE_QUEUED',
        hasError: false,
        resizedAssets
      });

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'TASK_HANDOFF',
        title: '📦 Update-Task an Queue übergeben (Tab Update)',
        content: {
          phase: 'QUEUE_HANDOFF',
          status: 'SUCCESS',
          queueId: queueItem.id,
          statusText: queueItem.status,
          designId: params.designId,
          allocatedSlots: queueItem.totalBaseSlots ?? queueItem.allocatedSlots ?? 0,
          message: `Design erfolgreich in den Tab Update der Queue eingereiht (${queueItem.totalBaseSlots ?? queueItem.allocatedSlots ?? 0} neue Slots werden ergänzt).`
        }
      });
    }

    console.log(`[FinalizationService] ✅ Task #${taskId} erfolgreich finalisiert und in Queue übergeben (QueueId: ${queueItem.id}).`);
    return {
      success: true,
      queueItemId: queueItem.id,
      resizedAssets
    };
  }
}

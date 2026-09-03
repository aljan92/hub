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

    const validationAttempts = ((task as any)?.validationAttempts || 0) + 1;
    if (task) {
      (task as any).validationAttempts = validationAttempts;
      TaskLogService.updateTaskStatus(taskId, { validationAttempts } as any);
    }

    if (!validation.isValid) {
      const errorMsg = `Final Listing Validation fehlgeschlagen (Versuch ${validationAttempts}/3): ${validation.errors.join('; ')}`;
      console.error(`[FinalizationService] ❌ ${errorMsg}`);

      if (validationAttempts >= 3) {
        const limitErrorMsg = `LISTING_VALIDATION_RETRY_LIMIT_REACHED: Finale Listing-Validierung nach ${validationAttempts} Versuchen endgültig fehlgeschlagen: ${validation.errors.join('; ')}`;
        console.error(`[FinalizationService] 🛑 ${limitErrorMsg}`);

        TaskLogService.addEvent(taskId, {
          timestamp: new Date().toISOString(),
          type: 'FINALIZATION_EVENT' as any,
          title: '🛑 Finale Listing-Validierung: Retry-Limit erreicht (3/3 Versuche fehlgeschlagen)',
          content: {
            phase: 'FINAL_VALIDATION',
            status: 'FAILED',
            reason: 'LISTING_VALIDATION_RETRY_LIMIT_REACHED',
            attempts: validationAttempts,
            errors: validation.errors
          }
        });

        TaskLogService.updateTaskStatus(taskId, {
          status: 'ERROR',
          hasError: true,
          errorDetails: limitErrorMsg
        });

        return { success: false, error: limitErrorMsg };
      }

      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'FINALIZATION_EVENT' as any,
        title: `❌ Finale Listing-Validierung fehlgeschlagen (Versuch ${validationAttempts}/3)`,
        content: { phase: 'FINAL_VALIDATION', status: 'FAILED', attempt: validationAttempts, errors: validation.errors }
      });

      TaskLogService.updateTaskStatus(taskId, {
        hasError: true,
        errorDetails: errorMsg
      });

      return { success: false, error: errorMsg };
    }

    if (task) {
      (task as any).validationAttempts = 0;
      TaskLogService.updateTaskStatus(taskId, { validationAttempts: 0 } as any);
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
    const areLegacyAssetsValid = resizedAssets &&
      resizedAssets.trimmedPath && fs.existsSync(resizedAssets.trimmedPath) &&
      resizedAssets.mugStandardPath && fs.existsSync(resizedAssets.mugStandardPath) &&
      resizedAssets.mugBrushPath && fs.existsSync(resizedAssets.mugBrushPath) &&
      resizedAssets.drinkwareStandardPath && fs.existsSync(resizedAssets.drinkwareStandardPath) &&
      resizedAssets.drinkwareBrushPath && fs.existsSync(resizedAssets.drinkwareBrushPath);

    if (areLegacyAssetsValid) {
      console.log(`[FinalizationService] ⚡ Legacy Resized Assets für Task #${taskId} bereits vorhanden. Überspringe doppelten Resize.`);
    } else {
      try {
        // Execute legacy resize exactly once via ArtworkResizeService mutex
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

    // ─── PHASE 3b: PRODUCT VARIANT GENERATION (CANVAS_BACKGROUND_CONTAIN) ───
    // Every task receives ALL registered product variants, regardless of product selection.
    // Product Catalog only decides which variant is used at upload time.
    const { getGeneratableVariants: getGenVariants } = await import('./productCatalogService');
    const generatableVariants = getGenVariants();

    if (generatableVariants.length > 0) {
      // Check if all product variants are already valid on disk
      const existingProductVariants = resizedAssets?.productVariants || {};
      const allProductVariantsValid = generatableVariants.every(v =>
        existingProductVariants[v.id] && fs.existsSync(existingProductVariants[v.id])
      );

      if (allProductVariantsValid) {
        console.log(`[FinalizationService] ⚡ Alle ${generatableVariants.length} Product-Varianten für Task #${taskId} bereits vorhanden.`);
        // Ensure productVariants is set on resizedAssets
        if (!resizedAssets!.productVariants) {
          resizedAssets!.productVariants = existingProductVariants;
        }
      } else {
        try {
          const trimmedPath = resizedAssets!.trimmedPath;
          if (!trimmedPath || !fs.existsSync(trimmedPath)) {
            throw new Error(`Trimmed PNG nicht gefunden für Product-Variant-Generierung: ${trimmedPath}`);
          }

          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'FINALIZATION_EVENT' as any,
            title: `🎨 ${generatableVariants.length} Product-Varianten werden generiert...`,
            content: { phase: 'PRODUCT_VARIANT_GENERATION', status: 'RUNNING', variants: generatableVariants.map(v => v.id) }
          });

          const productVariants = await ArtworkResizeService.generateAllProductVariants(taskId, trimmedPath);
          resizedAssets!.productVariants = productVariants;
        } catch (pvErr: any) {
          const err = `Fehler bei Product-Variant-Generierung: ${pvErr.message}`;
          console.error(`[FinalizationService] ❌ ${err}`);

          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'FINALIZATION_EVENT' as any,
            title: '❌ Product-Variant-Generierung fehlgeschlagen',
            content: { phase: 'PRODUCT_VARIANT_GENERATION', status: 'FAILED', error: err }
          });

          TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
          return { success: false, error: err };
        }
      }
    }

    // =========================================================================
    // PHASE 4: FINAL ASSET VALIDATION (Verifying files on disk)
    // =========================================================================
    const requiredFiles = [
      { name: 'Trimmed Master', path: resizedAssets!.trimmedPath },
      { name: 'Mug Standard', path: resizedAssets!.mugStandardPath },
      { name: 'Mug Brush', path: resizedAssets!.mugBrushPath },
      { name: 'Drinkware Standard', path: resizedAssets!.drinkwareStandardPath },
      { name: 'Drinkware Brush', path: resizedAssets!.drinkwareBrushPath }
    ];

    for (const f of requiredFiles) {
      if (!f.path || !fs.existsSync(f.path)) {
        const err = `Generiertes Asset "${f.name}" nicht auf Disk gefunden: ${f.path}`;
        console.error(`[FinalizationService] ❌ ${err}`);
        TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
        return { success: false, error: err };
      }
    }

    // Validate product variants
    const productVariants = resizedAssets!.productVariants || {};
    for (const variant of generatableVariants) {
      const variantPath = productVariants[variant.id];
      if (!variantPath || !fs.existsSync(variantPath)) {
        const err = `Product-Variant "${variant.id}" (${variant.label}) nicht auf Disk gefunden: ${variantPath}`;
        console.error(`[FinalizationService] ❌ ${err}`);
        TaskLogService.updateTaskStatus(taskId, { hasError: true, errorDetails: err });
        return { success: false, error: err };
      }
    }

    const totalAssets = requiredFiles.length + Object.keys(productVariants).length;
    TaskLogService.addEvent(taskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT' as any,
      title: `✓ Alle ${totalAssets} Assets (${requiredFiles.length} Legacy + ${Object.keys(productVariants).length} Product-Varianten) auf Disk verifiziert`,
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

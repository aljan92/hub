import fs from 'fs';
import path from 'path';
import { getSupabaseClient } from './settingsService';
import { BrowserSessionService } from './browserSessionService';
import { AmazonDeleteDesignService } from './amazonDeleteDesignService';
import { UpdateMetadataService } from './updateMetadataService';
import { VisionOptimizationService } from './visionOptimizationService';
import { atomicWriteJson, loadJsonWithBackupRecovery } from '../utils/atomicFileStorage';

export interface CleanupReviewedData {
  version: 1;
  updatedAt: string;
  reviewedIds: string[];
}

export interface CleanupDesignItem {
  designId: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
}

export interface CleanupBatchAction {
  designId: string;
  action: 'keep' | 'delete';
}

export interface CleanupProcessResult {
  success: boolean;
  totalProcessed: number;
  deletedCount: number;
  keptCount: number;
  errors: Array<{ designId: string; error: string }>;
}

const REVIEWED_FILE_PATH = path.resolve(process.cwd(), 'data', 'cleanup_reviewed.json');

export class CleanupService {
  /**
   * Load the set of already reviewed/kept design IDs
   */
  public static getReviewedIds(): Set<string> {
    const recovery = loadJsonWithBackupRecovery<CleanupReviewedData>(REVIEWED_FILE_PATH, {
      defaultValue: { version: 1, updatedAt: new Date().toISOString(), reviewedIds: [] }
    });

    const ids = Array.isArray(recovery.data?.reviewedIds) ? recovery.data.reviewedIds : [];
    return new Set(ids.map(id => String(id).replace(/^#/, '').replace(/-U$/, '').trim()).filter(Boolean));
  }

  /**
   * Get total count of reviewed designs
   */
  public static getReviewedCount(): number {
    return this.getReviewedIds().size;
  }

  /**
   * Add IDs to the reviewed list
   */
  public static addReviewedIds(newIds: string[]): void {
    if (!newIds || newIds.length === 0) return;

    const currentSet = this.getReviewedIds();
    for (const id of newIds) {
      const clean = String(id).replace(/^#/, '').replace(/-U$/, '').trim();
      if (clean) currentSet.add(clean);
    }

    const payload: CleanupReviewedData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      reviewedIds: Array.from(currentSet)
    };

    atomicWriteJson(REVIEWED_FILE_PATH, payload, { backup: true, space: 2 });
    console.log(`[CleanupService] 📝 ${newIds.length} Design(s) zur Behalten-Liste hinzugefügt. Gesamt: ${currentSet.size}`);
  }

  /**
   * Reset / clear the reviewed list
   */
  public static clearReviewedList(): { success: boolean; clearedCount: number } {
    const count = this.getReviewedCount();
    const payload: CleanupReviewedData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      reviewedIds: []
    };

    atomicWriteJson(REVIEWED_FILE_PATH, payload, { backup: true, space: 2 });
    console.log(`[CleanupService] 🧹 Behalten-Liste zurückgesetzt (${count} Einträge entfernt).`);
    return { success: true, clearedCount: count };
  }

  /**
   * Ensure artwork PNG and thumbnail exist locally for a design ID
   */
  public static async ensureArtworkAvailable(rawDesignId: string): Promise<boolean> {
    const cleanId = String(rawDesignId).replace(/^#/, '').replace(/-U$/, '').trim();
    if (!cleanId) return false;

    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    if (!fs.existsSync(designsDir)) {
      fs.mkdirSync(designsDir, { recursive: true });
    }

    const safeId = cleanId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const mbaPath = path.join(designsDir, `${safeId}_mba.png`);
    const rawPath = path.join(designsDir, `${safeId}.png`);
    const thumbPath = path.join(designsDir, `${safeId}_thumb.png`);

    // 1. Check if already exists on disk
    const existingFile = fs.existsSync(mbaPath) ? mbaPath : fs.existsSync(rawPath) ? rawPath : null;
    if (existingFile) {
      if (!fs.existsSync(thumbPath)) {
        VisionOptimizationService.prepareThumbnailImage(existingFile, thumbPath, 320).catch(() => {});
      }
      return true;
    }

    // 2. Download from Amazon Merch Session 1
    console.log(`[CleanupService] 🖼️ Lade Master-Artwork für Design ${cleanId} über Session 1...`);
    let newTab: any = null;
    try {
      const session = await BrowserSessionService.getSession('sync');
      newTab = await session.page.context().newPage();

      const editUrl = `https://merch.amazon.com/designs/${cleanId}/edit`;
      await newTab.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Selector for artwork preview on edit page
      await newTab.waitForSelector(
        'img[alt$=".png"], img[alt="null"], img.artwork, #global-uploader-container img, .global-uploader img',
        { timeout: 20000 }
      ).catch(() => null);

      const extractResult = await newTab.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img[alt$=".png"], img[alt="null"]'));
        let targetImg = images.find(e => e.getAttribute('alt') && e.getAttribute('alt')!.endsWith('.png'));
        if (!targetImg) {
          targetImg = images.find(e => e.getAttribute('alt') === 'null');
        }
        if (!targetImg) {
          targetImg = (document.querySelector('img.artwork.ng-star-inserted') ||
                       document.querySelector('.artwork') ||
                       document.querySelector('#global-uploader-container img') ||
                       document.querySelector('.global-uploader img')) as HTMLImageElement;
        }

        if (!targetImg || !(targetImg as HTMLImageElement).src) {
          return { ok: false, error: 'Kein Artwork Bild-Element auf Amazon Edit-Seite gefunden.' };
        }

        const rawSrc = (targetImg as HTMLImageElement).src;
        const fullResUrl = rawSrc.replace(/\._[^_]+_\.(png|jpg|jpeg)$/i, '.$1');
        return { ok: true, fullResUrl };
      });

      if (!extractResult.ok || !extractResult.fullResUrl) {
        console.warn(`[CleanupService] ⚠️ Artwork-URL für ${cleanId} nicht gefunden.`);
        return false;
      }

      // Fetch within session context
      const base64Data = await newTab.evaluate(async (imgUrl: string) => {
        const resp = await fetch(imgUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} beim Laden des Artworks`);
        const blob = await resp.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('FileReader Fehler'));
          reader.readAsDataURL(blob);
        });
      }, extractResult.fullResUrl);

      const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(rawPath, buffer);

      // Create thumbnail
      VisionOptimizationService.prepareThumbnailImage(rawPath, thumbPath, 320).catch(() => {});
      console.log(`[CleanupService] ✅ Master-Artwork für ${cleanId} gespeichert (${(buffer.length / 1024 / 1024).toFixed(2)} MB).`);
      return true;
    } catch (err: any) {
      console.error(`[CleanupService] ❌ Fehler beim Artwork-Download für ${cleanId}:`, err.message);
      return false;
    } finally {
      if (newTab) {
        await newTab.close().catch(() => {});
      }
    }
  }

  /**
   * Scan random published designs from Supabase (Egress-optimized)
   */
  public static async scanRandomDesigns(limit = 10): Promise<{
    success: boolean;
    items: CleanupDesignItem[];
    totalReviewed: number;
    allReviewed: boolean;
    error?: string;
  }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        success: false,
        items: [],
        totalReviewed: 0,
        allReviewed: false,
        error: 'Keine Supabase-Verbindung konfiguriert.'
      };
    }

    const reviewedIds = this.getReviewedIds();

    console.log(`[CleanupService] 🔍 Frage Supabase nach PUBLISHED-Designs ab (bereits ignoriert: ${reviewedIds.size})...`);

    // Minimal egress: only select design_id and title_us
    const { data, error } = await supabase
      .from('mba_designs')
      .select('design_id, title_us')
      .eq('status', 'PUBLISHED')
      .limit(1000);

    if (error) {
      console.error('[CleanupService] ❌ Supabase-Fehler:', error.message);
      return {
        success: false,
        items: [],
        totalReviewed: reviewedIds.size,
        allReviewed: false,
        error: error.message
      };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        items: [],
        totalReviewed: reviewedIds.size,
        allReviewed: true
      };
    }

    // Filter out reviewed designs
    const candidates = data.filter(row => {
      const clean = String(row.design_id || '').replace(/^#/, '').replace(/-U$/, '').trim();
      return clean && !reviewedIds.has(clean);
    });

    if (candidates.length === 0) {
      console.log(`[CleanupService] ℹ️ Alle gefundenen ${data.length} Designs wurden bereits geprüft.`);
      return {
        success: true,
        items: [],
        totalReviewed: reviewedIds.size,
        allReviewed: true
      };
    }

    // Shuffle and pick random candidates
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(limit, shuffled.length));

    console.log(`[CleanupService] 🎯 ${selected.length} Designs ausgewählt. Lade Grafiken...`);

    const items: CleanupDesignItem[] = [];
    for (const cand of selected) {
      const cleanId = String(cand.design_id).replace(/^#/, '').replace(/-U$/, '').trim();
      await this.ensureArtworkAvailable(cleanId);

      items.push({
        designId: cleanId,
        title: cand.title_us?.trim() || 'Kein Titel hinterlegt',
        imageUrl: `/api/v1/designs/image/${encodeURIComponent(cleanId)}`,
        thumbnailUrl: `/api/v1/designs/thumbnail/${encodeURIComponent(cleanId)}`
      });
    }

    return {
      success: true,
      items,
      totalReviewed: reviewedIds.size,
      allReviewed: false
    };
  }

  /**
   * Process a batch of decisions (delete on Amazon / keep in ignore-list)
   */
  public static async processBatch(actions: CleanupBatchAction[]): Promise<CleanupProcessResult> {
    if (!actions || actions.length === 0) {
      return {
        success: true,
        totalProcessed: 0,
        deletedCount: 0,
        keptCount: 0,
        errors: []
      };
    }

    const errors: Array<{ designId: string; error: string }> = [];
    const idsToMarkReviewed: string[] = [];
    let deletedCount = 0;
    let keptCount = 0;

    for (const item of actions) {
      const cleanId = String(item.designId || '').replace(/^#/, '').replace(/-U$/, '').trim();
      if (!cleanId) continue;

      if (item.action === 'delete') {
        console.log(`[CleanupService] 🗑️ Verarbeite Löschung für Design ${cleanId}...`);
        try {
          // 1. Delete from Amazon
          const deleteResult = await AmazonDeleteDesignService.deleteDesignFromAmazon(cleanId);
          if (!deleteResult.success) {
            console.error(`[CleanupService] ❌ Amazon-Löschung fehlgeschlagen für ${cleanId}:`, deleteResult.error);
            errors.push({ designId: cleanId, error: deleteResult.error || 'Amazon Löschung fehlgeschlagen.' });
            continue;
          }

          // 2. Mark skip_update in Supabase
          const markResult = await UpdateMetadataService.markSkipUpdate(cleanId);
          if (!markResult.success) {
            console.warn(`[CleanupService] ⚠️ Supabase skip_update konnte nicht gesetzt werden für ${cleanId}:`, markResult.error);
          }

          deletedCount++;
          idsToMarkReviewed.push(cleanId);
        } catch (err: any) {
          console.error(`[CleanupService] ❌ Unerwarteter Fehler beim Löschen von ${cleanId}:`, err.message);
          errors.push({ designId: cleanId, error: err.message || 'Unerwarteter Fehler' });
        }
      } else if (item.action === 'keep') {
        keptCount++;
        idsToMarkReviewed.push(cleanId);
      }
    }

    // Persist all reviewed IDs (both kept and successfully deleted designs)
    if (idsToMarkReviewed.length > 0) {
      this.addReviewedIds(idsToMarkReviewed);
    }

    return {
      success: errors.length === 0,
      totalProcessed: deletedCount + keptCount,
      deletedCount,
      keptCount,
      errors
    };
  }
}

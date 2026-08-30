import { createClient } from '@supabase/supabase-js';
import { loadSettings, saveSettings } from './settingsService';
import { QueueService } from './queueService';
import { TaskLogService } from './taskLogService';
import { UpdatePipelineService } from './updatePipelineService';

export class UpdateBackfillService {
  private static inFlightDesigns = new Set<string>();
  private static isRunningLoop = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Collect all design IDs that must NOT be pulled again
   * (Already in Queue, active in Tasks, or currently in flight)
   */
  public static getExcludedDesignIds(extraExcludedIds?: Set<string>): Set<string> {
    const excluded = new Set<string>();

    // 1. In-flight locks
    for (const id of this.inFlightDesigns) {
      if (id) excluded.add(id.trim());
    }

    // 2. Extra excluded IDs for the current cycle (in-memory only)
    if (extraExcludedIds) {
      for (const id of extraExcludedIds) {
        if (id) excluded.add(id.trim());
      }
    }

    // 3. All items in the Queue (Tab Queue & Tab Update)
    const queueItems = QueueService.loadQueue();
    for (const item of queueItems) {
      if (item.designId) excluded.add(item.designId.trim());
      if (item.taskId) {
        const cleanTask = item.taskId.replace(/^#/, '').replace(/-U$/, '').trim();
        excluded.add(cleanTask);
      }
    }

    // 4. All non-rejected tasks in TaskLogService
    const tasks = TaskLogService.loadLogs();
    for (const task of tasks) {
      if (task.status === 'REJECTED') continue;
      if (task.payload?.designId) excluded.add(task.payload.designId.trim());
      if (task.id) {
        const cleanTask = task.id.replace(/^#/, '').replace(/-U$/, '').trim();
        excluded.add(cleanTask);
      }
    }

    return excluded;
  }

  /**
   * Query Supabase `mba_designs` table for the oldest updated design
   * that matches the active product count threshold and is not already in the Hub.
   * Strictly checks that the "published_products" cell is NOT empty.
   */
  public static async fetchNextCandidateFromSupabase(extraExcludedIds?: Set<string>): Promise<{ designId: string; title?: string; activeProductsCount: number; updatedDate?: string } | null> {
    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      console.warn('[UpdateBackfillService] ⚠️ Supabase URL oder Service Role Key fehlt in den Einstellungen.');
      return null;
    }

    const supabase = createClient(settings.supabaseUrl, settings.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const excludedIds = this.getExcludedDesignIds(extraExcludedIds);
    const maxActiveProducts = settings.queueUpdateMaxActiveProducts ?? 100;

    console.log(`[UpdateBackfillService] 🔍 Frage Supabase mba_designs nach Kandidaten ab (Exkludiert: ${excludedIds.size} Designs, Max. Produkte: < ${maxActiveProducts})...`);

    // Fetch batch of oldest published designs with non-null published_products
    const { data: candidates, error } = await supabase
      .from('mba_designs')
      .select('design_id, asin_standard_tshirt_us, created_date, updated_date, published_products, asins, status')
      .eq('status', 'PUBLISHED')
      .not('published_products', 'is', null)
      .order('updated_date', { ascending: true, nullsFirst: true })
      .limit(300);

    if (error) {
      console.error('[UpdateBackfillService] ❌ Supabase Abfrage-Fehler:', error.message);
      return null;
    }

    if (!candidates || candidates.length === 0) {
      console.log('[UpdateBackfillService] ℹ️ Keine Designs mit status="PUBLISHED" und gefüllter published_products Spalte in mba_designs gefunden.');
      return null;
    }

    for (const cand of candidates) {
      const dId = cand.design_id ? String(cand.design_id).replace(/^#/, '').replace(/-U$/, '').trim() : '';
      if (!dId) continue;

      // Filter 0: Ensure status is strictly PUBLISHED
      if (cand.status && cand.status !== 'PUBLISHED') {
        continue;
      }

      // Filter 1: Check duplicate / active in Hub / in-flight
      if (excludedIds.has(dId)) {
        continue;
      }

      // Filter 2: Verify "published_products" cell is NOT empty
      let activeCount = 0;
      if (Array.isArray(cand.published_products)) {
        activeCount = cand.published_products.length;
      } else if (cand.published_products && typeof cand.published_products === 'object') {
        activeCount = Object.keys(cand.published_products).length;
      } else if (Array.isArray(cand.asins)) {
        activeCount = cand.asins.length;
      }

      // If published_products cell is empty (0 products), skip immediately
      if (activeCount === 0) {
        continue;
      }

      if (activeCount >= maxActiveProducts) {
        console.log(`[UpdateBackfillService] ⏭️ Design ${dId} übersprungen: Bereits ${activeCount} aktive Produkte (Limit: < ${maxActiveProducts}).`);
        continue;
      }

      console.log(`[UpdateBackfillService] 🎯 Valider Kandidat gefunden: Design ${dId} (${activeCount} aktive Produkte in published_products, zuletzt geupdatet: ${cand.updated_date || 'nie'}).`);
      return {
        designId: dId,
        activeProductsCount: activeCount,
        updatedDate: cand.updated_date
      };
    }

    console.log('[UpdateBackfillService] ℹ️ Alle abgefragten Designs überschritten das Produktlimit oder sind bereits in Bearbeitung.');
    return null;
  }

  /**
   * Get exact count of active update designs recognized by the system
   * (Prevents double counting designs that exist in both Queue and Tasks)
   */
  public static getActiveUpdateCount(): { currentCount: number; queueCount: number; tasksReviewCount: number; inFlightCount: number } {
    const queueItems = QueueService.loadQueue();
    const isUpdateItem = (i: any) => (i.type === 'UPDATE' || i.type === 'update' || i.source === 'UPDATE' || (i.id && String(i.id).startsWith('update_')) || (i.taskId && String(i.taskId).endsWith('-U')));
    const activeQueueItems = queueItems.filter(i => isUpdateItem(i) && i.status !== 'COMPLETED' && i.status !== 'ERROR');

    const queuedTaskIds = new Set(activeQueueItems.map(i => i.taskId ? i.taskId.replace(/^#/, '').replace(/-U$/, '').trim() : '').filter(Boolean));
    const queuedDesignIds = new Set(activeQueueItems.map(i => i.designId ? i.designId.trim() : '').filter(Boolean));

    const activeTasks = TaskLogService.loadLogs();
    const activeTasksReview = activeTasks.filter(t => {
      if (t.source !== 'UPDATE') return false;
      if (['COMPLETED', 'REJECTED', 'CANCELLED', 'QUEUED', 'UPDATE_QUEUED'].includes(t.status)) return false;
      const cleanTaskId = t.id ? t.id.replace(/^#/, '').replace(/-U$/, '').trim() : '';
      if (queuedTaskIds.has(cleanTaskId)) return false;
      const designId = t.payload?.designId ? t.payload.designId.trim() : '';
      if (designId && queuedDesignIds.has(designId)) return false;
      return true;
    });

    const inFlightCount = this.inFlightDesigns.size;
    const currentCount = activeQueueItems.length + activeTasksReview.length + inFlightCount;

    return {
      currentCount,
      queueCount: activeQueueItems.length,
      tasksReviewCount: activeTasksReview.length,
      inFlightCount
    };
  }

  /**
   * Run one backfill cycle (pulls 1 design and runs U1–U7 or pauses at Tasks review)
   */
  public static async runBackfillCycle(forceSingle = false): Promise<{ success: boolean; message: string; designId?: string }> {
    const settings = loadSettings();

    if (!forceSingle && !settings.queueUpdateAutoBackfillEnabled) {
      return { success: false, message: 'Automatik ist ausgeschaltet.' };
    }

    const counts = this.getActiveUpdateCount();
    const targetCount = settings.queueUpdateTargetCount ?? 10;

    if (!forceSingle && counts.currentCount >= targetCount) {
      return { success: false, message: `Update-Pool ist bereits voll (${counts.currentCount}/${targetCount} aktive Designs im Pool).` };
    }

    let lastError = 'Kein passendes Design mit aktiven Produkten in Supabase gefunden.';
    const maxAttempts = 30;
    const cycleFailedIds = new Set<string>();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const candidate = await this.fetchNextCandidateFromSupabase(cycleFailedIds);
      if (!candidate) {
        return { success: false, message: lastError };
      }

      const designId = candidate.designId;
      this.inFlightDesigns.add(designId);

      try {
        console.log(`[UpdateBackfillService] 🚀 (Versuch ${attempt}/${maxAttempts}) Starte Update-Workflow für Design ${designId}...`);
        const result = await UpdatePipelineService.runUpdatePipeline(designId);

        if (result.success) {
          return {
            success: true,
            designId,
            message: result.pausedAtCheckpoint 
              ? `Design ${designId} erfolgreich gezogen und an Tasks übergeben.` 
              : `Design ${designId} erfolgreich verarbeitet und in Update-Queue eingereiht.`
          };
        } else {
          lastError = result.error || 'Fehler beim Abruf der Merch-Daten';
          console.warn(`[UpdateBackfillService] ⚠️ Design ${designId} auf Amazon nicht abrufbar (${lastError}). Überspringe und teste nächsten Kandidaten...`);
          cycleFailedIds.add(designId);
        }
      } catch (err: any) {
        lastError = err.message || 'Unbekannter Fehler';
        console.error(`[UpdateBackfillService] ❌ Fehler beim Verarbeiten von Design ${designId}:`, err);
        cycleFailedIds.add(designId);
      } finally {
        this.inFlightDesigns.delete(designId);
      }
    }

    return { success: false, message: `Nach ${maxAttempts} Versuchen kein valides Design auf Amazon gefunden (${lastError}).` };
  }

  /**
   * Start background polling scheduler
   */
  public static startScheduler() {
    if (this.intervalId) return;

    console.log('[UpdateBackfillService] ⏱️ Update-Backfill Scheduler gestartet (Prüfintervall: 10s).');
    this.intervalId = setInterval(async () => {
      try {
        const settings = loadSettings();
        if (settings.queueUpdateAutoBackfillEnabled && !this.isRunningLoop) {
          const counts = this.getActiveUpdateCount();
          const target = settings.queueUpdateTargetCount ?? 10;
          if (counts.currentCount < target) {
            this.isRunningLoop = true;
            await this.runBackfillCycle(false);
            this.isRunningLoop = false;
          }
        }
      } catch (err) {
        this.isRunningLoop = false;
        console.error('[UpdateBackfillService] Scheduler-Fehler:', err);
      }
    }, 10000);
  }

  /**
   * Stop background polling scheduler
   */
  public static stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[UpdateBackfillService] 🛑 Update-Backfill Scheduler gestoppt.');
    }
  }
}

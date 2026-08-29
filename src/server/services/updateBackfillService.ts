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
  public static getExcludedDesignIds(): Set<string> {
    const excluded = new Set<string>();

    // 1. In-flight locks
    for (const id of this.inFlightDesigns) {
      if (id) excluded.add(id.trim());
    }

    // 2. All items in the Queue (Tab Queue & Tab Update)
    const queueItems = QueueService.loadQueue();
    for (const item of queueItems) {
      if (item.designId) excluded.add(item.designId.trim());
      if (item.taskId) {
        const cleanTask = item.taskId.replace(/^#/, '').replace(/-U$/, '').trim();
        excluded.add(cleanTask);
      }
    }

    // 3. All non-rejected tasks in TaskLogService
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
   */
  public static async fetchNextCandidateFromSupabase(): Promise<{ designId: string; title?: string; activeProductsCount: number; updatedDate?: string } | null> {
    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      console.warn('[UpdateBackfillService] ⚠️ Supabase URL oder Service Role Key fehlt in den Einstellungen.');
      return null;
    }

    const supabase = createClient(settings.supabaseUrl, settings.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const excludedIds = this.getExcludedDesignIds();
    const maxActiveProducts = settings.queueUpdateMaxActiveProducts ?? 100;

    console.log(`[UpdateBackfillService] 🔍 Frage Supabase mba_designs nach Kandidaten ab (Exkludiert: ${excludedIds.size} Designs, Max. Produkte: < ${maxActiveProducts})...`);

    // Fetch batch of oldest designs (sorted by updated_date ascending)
    const { data: candidates, error } = await supabase
      .from('mba_designs')
      .select('design_id, asin_standard_tshirt_us, created_date, updated_date, published_products, asins, status')
      .order('updated_date', { ascending: true, nullsFirst: true })
      .limit(60);

    if (error) {
      console.error('[UpdateBackfillService] ❌ Supabase Abfrage-Fehler:', error.message);
      return null;
    }

    if (!candidates || candidates.length === 0) {
      console.log('[UpdateBackfillService] ℹ️ Keine Designs in mba_designs gefunden.');
      return null;
    }

    for (const cand of candidates) {
      const dId = cand.design_id ? String(cand.design_id).trim() : '';
      if (!dId) continue;

      // Filter 1: Check duplicate / active in Hub
      if (excludedIds.has(dId)) {
        continue;
      }

      // Filter 2: Active products count threshold (< maxActiveProducts)
      let activeCount = 0;
      if (Array.isArray(cand.published_products)) {
        activeCount = cand.published_products.length;
      } else if (Array.isArray(cand.asins)) {
        activeCount = cand.asins.length;
      }

      if (activeCount >= maxActiveProducts) {
        console.log(`[UpdateBackfillService] ⏭️ Design ${dId} übersprungen: Bereits ${activeCount} aktive Produkte (Limit: < ${maxActiveProducts}).`);
        continue;
      }

      console.log(`[UpdateBackfillService] 🎯 Kandidat gefunden: Design ${dId} (${activeCount} aktive Produkte, zuletzt geupdatet: ${cand.updated_date || 'nie'}).`);
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
   * Run one backfill cycle (pulls 1 design and runs U1–U7 or pauses at Tasks review)
   */
  public static async runBackfillCycle(forceSingle = false): Promise<{ success: boolean; message: string; designId?: string }> {
    const settings = loadSettings();

    if (!forceSingle && !settings.queueUpdateAutoBackfillEnabled) {
      return { success: false, message: 'Automatik ist ausgeschaltet.' };
    }

    const queueItems = QueueService.loadQueue();
    const isUpdateItem = (i: any) => (i.type === 'UPDATE' || i.type === 'update' || i.source === 'UPDATE');
    const currentUpdateCount = queueItems.filter(i => isUpdateItem(i) && i.status !== 'COMPLETED' && i.status !== 'ERROR').length;
    const targetCount = settings.queueUpdateTargetCount ?? 10;

    if (!forceSingle && currentUpdateCount >= targetCount) {
      return { success: false, message: `Update-Pool ist bereits voll (${currentUpdateCount}/${targetCount} Designs).` };
    }

    const candidate = await this.fetchNextCandidateFromSupabase();
    if (!candidate) {
      return { success: false, message: 'Kein passendes Design in Supabase gefunden.' };
    }

    const designId = candidate.designId;
    this.inFlightDesigns.add(designId);

    try {
      console.log(`[UpdateBackfillService] 🚀 Starte automatischen Update-Workflow für Design ${designId}...`);
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
        return { success: false, designId, message: result.error || 'Fehler beim Ausführen des Workflows' };
      }
    } catch (err: any) {
      console.error(`[UpdateBackfillService] ❌ Fehler beim Verarbeiten von Design ${designId}:`, err);
      return { success: false, designId, message: err.message };
    } finally {
      this.inFlightDesigns.delete(designId);
    }
  }

  /**
   * Start background polling scheduler
   */
  public static startScheduler() {
    if (this.intervalId) return;

    console.log('[UpdateBackfillService] ⏱️ Update-Backfill Scheduler gestartet (Prüfintervall: 30s).');
    this.intervalId = setInterval(async () => {
      try {
        const settings = loadSettings();
        if (settings.queueUpdateAutoBackfillEnabled && !this.isRunningLoop) {
          this.isRunningLoop = true;
          await this.runBackfillCycle(false);
          this.isRunningLoop = false;
        }
      } catch (err) {
        this.isRunningLoop = false;
        console.error('[UpdateBackfillService] Scheduler-Fehler:', err);
      }
    }, 30000);
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

import { createClient } from '@supabase/supabase-js';
import { loadSettings, saveSettings } from './settingsService';
import { QueueService } from './queueService';
import { TaskLogService } from './taskLogService';
import { UpdatePipelineService } from './updatePipelineService';
import { LLMService } from './llmService';
import { TaskRecoveryService } from './taskRecoveryService';
import { UpdateMetadataService } from './updateMetadataService';

export function getHubUpdatePriorityTimestamp(candidate: { mba_hub_updated_at?: string | null; created_date?: string | null }): number {
  const raw = candidate.mba_hub_updated_at || candidate.created_date;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function sortCandidatesByHubUpdatePriority<T extends { mba_hub_updated_at?: string | null; created_date?: string | null }>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => getHubUpdatePriorityTimestamp(a) - getHubUpdatePriorityTimestamp(b));
}

export class UpdateBackfillService {
  private static inFlightDesigns = new Set<string>();
  private static isRunningLoop = false;
  private static activeCycle: Promise<{ success: boolean; message: string; designId?: string }> | null = null;
  private static intervalId: NodeJS.Timeout | null = null;
  private static lastWarningTime = 0;
  private static readonly WARNING_THROTTLE_MS = 5 * 60 * 1000; // 5 Minuten Drosselung

  public static getTokenburnProtection(settings = loadSettings()) {
    const threshold = Math.max(1, settings.updateAutoBackfillTokenFailureThreshold ?? 3);
    const failureCount = Math.max(0, settings.updateAutoBackfillTokenFailureCount ?? 0);
    return {
      failureCount,
      threshold,
      paused: Boolean(settings.updateAutoBackfillTokenPausedAt) || failureCount >= threshold,
      pausedAt: settings.updateAutoBackfillTokenPausedAt,
      reason: settings.updateAutoBackfillTokenPauseReason,
      lastFailedTaskId: settings.updateAutoBackfillTokenLastFailedTaskId,
      lastFailedStep: settings.updateAutoBackfillTokenLastFailedStep
    };
  }

  public static resetTokenburnProtection(): { success: boolean; message: string } {
    saveSettings({
      queueUpdateAutoBackfillEnabled: true,
      updateAutoBackfillTokenFailureCount: 0,
      updateAutoBackfillTokenPausedAt: undefined,
      updateAutoBackfillTokenPauseReason: undefined,
      updateAutoBackfillTokenLastFailedTaskId: undefined,
      updateAutoBackfillTokenLastFailedStep: undefined
    });
    return { success: true, message: 'Tokenburn-Schutz zurückgesetzt. Update-Automatik ist wieder aktiv.' };
  }

  private static resetTokenburnFailureCount(): void {
    const settings = loadSettings();
    if ((settings.updateAutoBackfillTokenFailureCount ?? 0) > 0 || settings.updateAutoBackfillTokenPausedAt) {
      saveSettings({
        updateAutoBackfillTokenFailureCount: 0,
        updateAutoBackfillTokenPausedAt: undefined,
        updateAutoBackfillTokenPauseReason: undefined,
        updateAutoBackfillTokenLastFailedTaskId: undefined,
        updateAutoBackfillTokenLastFailedStep: undefined
      });
    }
  }

  public static registerTokenburnFailure(taskId: string | undefined, step: string | undefined, error: string): { paused: boolean; failureCount: number; threshold: number } {
    const settings = loadSettings();
    const threshold = Math.max(1, settings.updateAutoBackfillTokenFailureThreshold ?? 3);
    const failureCount = Math.min(threshold, Math.max(0, settings.updateAutoBackfillTokenFailureCount ?? 0) + 1);
    const paused = failureCount >= threshold;
    const reason = `Tokenrelevanter Update-Fehler${step ? ` in ${step}` : ''}: ${error}`;
    saveSettings({
      updateAutoBackfillTokenFailureCount: failureCount,
      ...(paused ? {
        queueUpdateAutoBackfillEnabled: false,
        updateAutoBackfillTokenPausedAt: new Date().toISOString(),
        updateAutoBackfillTokenPauseReason: reason
      } : {}),
      updateAutoBackfillTokenLastFailedTaskId: taskId,
      updateAutoBackfillTokenLastFailedStep: step
    });
    if (paused && taskId) {
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        title: `🛡️ Tokenburn-Schutz aktiviert (${failureCount}/${threshold})`,
        content: {
          phase: 'UPDATE_AUTOMATION_GUARD',
          reason,
          failedStep: step,
          failureCount,
          threshold,
          action: 'UPDATE_AUTO_BACKFILL_PAUSED'
        }
      });
    }
    return { paused, failureCount, threshold };
  }

  /**
   * Collect all design IDs that must NOT be pulled again
   * (Already in Queue, active in Tasks, currently in flight, or reserved for recovery)
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

    // 4. All non-rejected and active tasks in TaskLogService
    const activeIds = TaskLogService.getActiveUpdateDesignIds();
    for (const id of activeIds) {
      excluded.add(id);
    }

    // 5. Designs currently reserved for recovery in TaskRecoveryService
    for (const resId of TaskRecoveryService.getReservedDesignIds()) {
      if (resId) excluded.add(resId.trim());
    }

    return excluded;
  }

  /**
   * Clears in-flight design memory locks and cancels any hanging/stale update tasks
   */
  public static resetInFlightLocks(): { success: boolean; releasedCount: number; activeCount: number; message: string } {
    const count = this.inFlightDesigns.size;
    this.inFlightDesigns.clear();

    const cancelledCount = TaskLogService.cancelActiveUpdateTasks();

    const counts = this.getActiveUpdateCount();
    console.log(`[UpdateBackfillService] 🔄 In-Flight Locks (${count}) & ${cancelledCount} offene Update-Tasks zurückgesetzt. Neuer Ist-Bestand: ${counts.currentCount}`);
    return {
      success: true,
      releasedCount: count + cancelledCount,
      activeCount: counts.currentCount,
      message: `In-Flight Locks und ${cancelledCount} offene Update-Tasks zurückgesetzt (Aktueller Ist-Bestand: ${counts.currentCount}).`
    };
  }

  /**
   * Query Supabase `mba_designs` table for the oldest updated design
   * that matches the active product count threshold and is not already in the Hub.
   * Strictly checks that the "published_products" cell is NOT empty.
   */
  public static async fetchNextCandidateFromSupabase(extraExcludedIds?: Set<string>): Promise<{ designId: string; title?: string; activeProductsCount: number; updatedDate?: string; priorityDate?: string } | null> {
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

    const candidateColumns = 'design_id, asin_standard_tshirt_us, created_date, updated_date, mba_hub_updated_at, skip_update, published_products, asins, status, sales_total';

    // PostgREST cannot order by COALESCE without an RPC/view. Fetch the oldest
    // slice of both groups, then merge them by the same effective timestamp.
    const [neverUpdatedResult, previouslyUpdatedResult] = await Promise.all([
      supabase
        .from('mba_designs')
        .select(candidateColumns)
        .eq('status', 'PUBLISHED')
        .eq('skip_update', false)
        .not('published_products', 'is', null)
        .or('sales_total.eq.0,sales_total.is.null')
        .is('mba_hub_updated_at', null)
        .order('created_date', { ascending: true, nullsFirst: false })
        .limit(300),
      supabase
        .from('mba_designs')
        .select(candidateColumns)
        .eq('status', 'PUBLISHED')
        .eq('skip_update', false)
        .not('published_products', 'is', null)
        .or('sales_total.eq.0,sales_total.is.null')
        .not('mba_hub_updated_at', 'is', null)
        .order('mba_hub_updated_at', { ascending: true, nullsFirst: false })
        .limit(300)
    ]);

    const queryError = neverUpdatedResult.error || previouslyUpdatedResult.error;
    if (queryError) {
      console.error('[UpdateBackfillService] ❌ Supabase Abfrage-Fehler:', queryError.message);
      return null;
    }

    const uniqueCandidates = new Map<string, any>();
    for (const candidate of [...(neverUpdatedResult.data || []), ...(previouslyUpdatedResult.data || [])]) {
      if (candidate?.design_id) uniqueCandidates.set(String(candidate.design_id), candidate);
    }
    const candidates = sortCandidatesByHubUpdatePriority(Array.from(uniqueCandidates.values()));

    if (!candidates || candidates.length === 0) {
      console.log('[UpdateBackfillService] ℹ️ Keine Designs mit status="PUBLISHED", 0 Sales und gefüllter published_products Spalte in mba_designs gefunden.');
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

      // Filter 2: Strictly verify 0 sales (protect bestsellers and selling designs)
      const salesTotal = Number((cand as any).sales_total ?? 0);
      if (salesTotal > 0) {
        console.log(`[UpdateBackfillService] ⏭️ Design ${dId} übersprungen: ${salesTotal} Verkäufe vorhanden (nur Designs mit 0 Sales erlaubt).`);
        continue;
      }

      // Filter 3: Verify "published_products" cell is NOT empty
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

      const priorityDate = cand.mba_hub_updated_at || cand.created_date;
      console.log(`[UpdateBackfillService] 🎯 Valider Kandidat gefunden: Design ${dId} (0 Sales, ${activeCount} aktive Produkte, Hub-Prioritätsdatum: ${priorityDate || 'nicht verfügbar'}).`);
      return {
        designId: dId,
        activeProductsCount: activeCount,
        updatedDate: cand.updated_date,
        priorityDate
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

    const activeTasksReview = TaskLogService.getActiveReviewUpdateTasks();

    // Collect distinct design identifiers across Queue, active Tasks, and In-Flight
    const uniqueDesignIds = new Set<string>();

    for (const q of activeQueueItems) {
      const id = (q.designId ? q.designId.trim() : '') || (q.taskId ? q.taskId.replace(/^#/, '').replace(/-U$/, '').trim() : '') || q.id;
      if (id) uniqueDesignIds.add(id.toLowerCase());
    }

    for (const t of activeTasksReview) {
      const id = (t.designId ? t.designId.trim() : '') || (t.id ? t.id.replace(/^#/, '').replace(/-U$/, '').trim() : '');
      if (id) uniqueDesignIds.add(id.toLowerCase());
    }

    for (const inflightId of this.inFlightDesigns) {
      if (inflightId) uniqueDesignIds.add(inflightId.trim().toLowerCase());
    }

    for (const resId of TaskRecoveryService.getReservedDesignIds()) {
      if (resId) uniqueDesignIds.add(resId.trim().toLowerCase());
    }

    return {
      currentCount: uniqueDesignIds.size,
      queueCount: activeQueueItems.length,
      tasksReviewCount: activeTasksReview.length,
      inFlightCount: this.inFlightDesigns.size
    };
  }

  /**
   * Release a specific design lock from inFlight
   */
  public static releaseInFlight(designId: string) {
    if (!designId) return;
    this.inFlightDesigns.delete(designId.trim().toLowerCase());
    this.inFlightDesigns.delete(designId.trim());
  }

  /**
   * Run one backfill cycle (pulls 1 design and runs U1–U7 or pauses at Tasks review)
   */
  public static async runBackfillCycle(forceSingle = false): Promise<{ success: boolean; message: string; designId?: string }> {
    if (this.activeCycle) {
      return { success: false, message: 'Ein Update-Design wird bereits gezogen oder verarbeitet. Der neue Auslöser wurde zusammengefasst.' };
    }
    this.isRunningLoop = true;
    const cycle = this.runBackfillCycleExclusive(forceSingle);
    this.activeCycle = cycle;
    try {
      return await cycle;
    } finally {
      if (this.activeCycle === cycle) this.activeCycle = null;
      this.isRunningLoop = false;
    }
  }

  private static async runBackfillCycleExclusive(forceSingle = false): Promise<{ success: boolean; message: string; designId?: string }> {
    const settings = loadSettings();

    if (!forceSingle && !settings.queueUpdateAutoBackfillEnabled) {
      return { success: false, message: 'Automatik ist ausgeschaltet.' };
    }

    const protection = this.getTokenburnProtection(settings);
    if (!forceSingle && protection.paused) {
      return { success: false, message: `Update-Automatik durch Tokenburn-Schutz pausiert (${protection.failureCount}/${protection.threshold}).` };
    }

    const counts = this.getActiveUpdateCount();
    const targetCount = settings.queueUpdateTargetCount ?? 10;

    if (!forceSingle && counts.currentCount >= targetCount) {
      return { success: false, message: `Update-Pool ist bereits voll (${counts.currentCount}/${targetCount} aktive Designs im Pool).` };
    }

    // Pre-Flight Guard: OpenRouter Guthaben & Circuit Breaker
    const circuit = LLMService.isCircuitBroken();
    const balance = await LLMService.getAvailableBalance();
    const threshold = settings.openRouterMinBalanceThreshold ?? 1.00;

    if (circuit.broken || (balance !== null && balance < threshold)) {
      const reason = circuit.reason || `OpenRouter Guthaben ($${balance?.toFixed(2)}) unter Schwellenwert ($${threshold.toFixed(2)})`;
      console.warn(`[UpdateBackfillService] ⏸️ runBackfillCycle übersprungen: ${reason}`);
      return { success: false, message: `Update-Automatik pausiert: ${reason}.` };
    }

    let lastError = 'Kein passendes Design mit aktiven Produkten in Supabase gefunden.';
    const maxAttempts = 30;
    const cycleFailedIds = new Set<string>();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check circuit breaker before each attempt in case it tripped during this cycle
      if (LLMService.isCircuitBroken().broken) {
        console.warn('[UpdateBackfillService] 🛑 Circuit Breaker aktiv! Breche Schleife sofort ab.');
        return { success: false, message: 'Update-Automatik pausiert (Circuit Breaker ausgelöst).' };
      }

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
          if (!forceSingle) this.resetTokenburnFailureCount();
          return {
            success: true,
            designId,
            message: result.pausedAtCheckpoint 
              ? `Design ${designId} erfolgreich gezogen und an Tasks übergeben.` 
              : `Design ${designId} erfolgreich verarbeitet und in Update-Queue eingereiht.`
          };
        } else {
          lastError = result.error || 'Fehler beim Abruf der Merch-Daten';
          if (!forceSingle && result.tokenRelevantFailure) {
            const tokenburn = this.registerTokenburnFailure(result.task?.id, result.failedStep, lastError);
            if (tokenburn.paused) {
              return {
                success: false,
                message: `Tokenburn-Schutz aktiviert (${tokenburn.failureCount}/${tokenburn.threshold}). Update-Automatik wurde pausiert.`
              };
            }
          }
          console.warn(`[UpdateBackfillService] ⚠️ Design ${designId} auf Amazon nicht abrufbar (${lastError}). Überspringe und teste nächsten Kandidaten...`);
          cycleFailedIds.add(designId);

          // If result failed due to circuit breaker or 402, abort loop immediately
          if (LLMService.isCircuitBroken().broken || lastError.includes('402') || lastError.includes('Circuit Breaker')) {
            console.warn('[UpdateBackfillService] 🛑 Abbruch der Kandidatenschleife wegen fehlendem OpenRouter-Guthaben.');
            return { success: false, message: 'Update-Automatik pausiert wegen fehlendem OpenRouter-Guthaben.' };
          }
        }
      } catch (err: any) {
        lastError = err.message || 'Unbekannter Fehler';
        console.error(`[UpdateBackfillService] ❌ Fehler beim Verarbeiten von Design ${designId}:`, err);
        cycleFailedIds.add(designId);

        if (LLMService.isCircuitBroken().broken || lastError.includes('402') || lastError.includes('Circuit Breaker')) {
          console.warn('[UpdateBackfillService] 🛑 Abbruch der Kandidatenschleife wegen fehlendem OpenRouter-Guthaben.');
          return { success: false, message: 'Update-Automatik pausiert wegen fehlendem OpenRouter-Guthaben.' };
        }
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
    void UpdateMetadataService.retryPendingConfirmedUpdates().catch(err => {
      console.warn('[UpdateBackfillService] Initialer Metadaten-Nachlauf fehlgeschlagen:', err?.message || err);
    });
    this.intervalId = setInterval(async () => {
      try {
        await UpdateMetadataService.retryPendingConfirmedUpdates();
        const settings = loadSettings();
        const tokenburn = this.getTokenburnProtection(settings);
        if (settings.queueUpdateAutoBackfillEnabled && !tokenburn.paused && !this.isRunningLoop) {
          // Pre-Flight Check: OpenRouter Guthaben & Circuit Breaker
          const circuit = LLMService.isCircuitBroken();
          const balance = await LLMService.getAvailableBalance();
          const threshold = settings.openRouterMinBalanceThreshold ?? 1.00;

          if (circuit.broken || (balance !== null && balance < threshold)) {
            const now = Date.now();
            if (now - this.lastWarningTime > this.WARNING_THROTTLE_MS) {
              const reason = circuit.reason || `Guthaben ($${balance?.toFixed(2)}) unter Schwellenwert ($${threshold.toFixed(2)})`;
              console.warn(`[UpdateBackfillService] ⏸️ Update-Automatik pausiert: ${reason}. Bitte OpenRouter aufladen.`);
              this.lastWarningTime = now;
            }
            return;
          }

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

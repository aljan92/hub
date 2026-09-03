import crypto from 'crypto';
import { QueueService, QueueItem } from './queueService';
import { TaskRepository } from '../storage/taskRepository';
import { TaskLogService } from './taskLogService';
import { AmazonInspectService } from './amazonInspectService';
import { ListingSanitizationService } from './listingSanitizationService';
import { 
  RemoteVerificationResult, 
  RemoteBaselineInfo,
  RemoteResponseInfo,
  UploadRecoveryHistoryEntry 
} from '../../types/tasks';

export interface CanonicalRemoteState {
  locales: Record<string, {
    title: string;
    brand: string;
    bullet1: string;
    bullet2: string;
    description: string;
  }>;
  products: Record<string, {
    marketplaces: string[];
    fits?: string[];
    colors?: string[];
  }>;
}

export class AmazonRecoveryVerificationService {
  private static isVerificationWorkerRunning = false;
  private static verificationTimer: NodeJS.Timeout | null = null;
  private static readonly BACKOFF_INTERVALS_MS = [0, 120_000, 360_000, 720_000]; // 0m, 2m, 6m, 12m
  private static readonly MAX_VERIFY_ATTEMPTS = 4;

  /**
   * Translates arbitrary Amazon inspect data or MBA Hub intended upload payload
   * into an identical, normalized canonical structure for deterministic fingerprinting.
   */
  public static canonicalizeRemoteState(raw: any): CanonicalRemoteState {
    const canonical: CanonicalRemoteState = {
      locales: {},
      products: {}
    };

    if (!raw) return canonical;

    // 1. Normalize Listings / textData
    // Format A: Amazon API textData { en: { title, brandName, bullets: [], description } }
    // Format B: MBA Hub immutableListings / listings { en: { title, brand, bullet1, bullet2, description } }
    const rawTexts = raw.textData || raw.immutableListings || raw.listings || {};
    const candidateLocales = ['en', 'de', 'fr', 'it', 'es', 'ja'];

    for (const loc of candidateLocales) {
      const locData = rawTexts[loc] || rawTexts[loc.toUpperCase()] || null;
      if (locData) {
        const title = ListingSanitizationService.sanitizeText(locData.title || '');
        const brand = ListingSanitizationService.sanitizeText(locData.brandName || locData.brand || '');
        let bullet1 = '';
        let bullet2 = '';
        if (Array.isArray(locData.bullets)) {
          bullet1 = ListingSanitizationService.sanitizeText(locData.bullets[0] || '');
          bullet2 = ListingSanitizationService.sanitizeText(locData.bullets[1] || '');
        } else {
          bullet1 = ListingSanitizationService.sanitizeText(locData.bullet1 || locData.bullet_1 || '');
          bullet2 = ListingSanitizationService.sanitizeText(locData.bullet2 || locData.bullet_2 || '');
        }
        const description = ListingSanitizationService.sanitizeText(locData.description || '');

        // Only register if at least title or brand is non-empty
        if (title || brand) {
          canonical.locales[loc] = {
            title: title.trim(),
            brand: brand.trim(),
            bullet1: bullet1.trim(),
            bullet2: bullet2.trim(),
            description: description.trim()
          };
        }
      }
    }

    // 2. Normalize Products & Marketplaces
    // Format A: Amazon API products { STANDARD_TSHIRT: { marketplaceData: { US: { status }, DE: {} }, dimensions: { FIT, COLOR } } }
    // Format B: MBA Hub activeProductsMap { STANDARD_TSHIRT: ['US', 'DE'] }
    if (raw.products && typeof raw.products === 'object') {
      const pKeys = Object.keys(raw.products).sort();
      for (const pk of pKeys) {
        const pVal = raw.products[pk];
        const mps: string[] = [];
        if (pVal?.marketplaceData && typeof pVal.marketplaceData === 'object') {
          mps.push(...Object.keys(pVal.marketplaceData).map(m => m.toUpperCase()));
        }
        mps.sort();

        const fits = Array.isArray(pVal?.dimensions?.FIT) ? [...pVal.dimensions.FIT].sort() : undefined;
        const colors = Array.isArray(pVal?.dimensions?.COLOR) ? [...pVal.dimensions.COLOR].sort() : undefined;

        canonical.products[pk.toUpperCase()] = {
          marketplaces: mps,
          fits,
          colors
        };
      }
    } else if (raw.activeProductsMap && typeof raw.activeProductsMap === 'object') {
      const pKeys = Object.keys(raw.activeProductsMap).sort();
      for (const pk of pKeys) {
        const mps = Array.isArray(raw.activeProductsMap[pk]) ? [...raw.activeProductsMap[pk]].map((m: string) => m.toUpperCase()).sort() : [];
        canonical.products[pk.toUpperCase()] = {
          marketplaces: mps
        };
      }
    }

    return canonical;
  }

  /**
   * Computes a deterministic SHA-256 fingerprint for a canonical remote state.
   */
  public static computeRemoteFingerprint(state: CanonicalRemoteState): string {
    const stringifyDeterministic = (obj: any): string => {
      if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
      }
      if (Array.isArray(obj)) {
        return '[' + obj.map(stringifyDeterministic).join(',') + ']';
      }
      const keys = Object.keys(obj).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + stringifyDeterministic(obj[k])).join(',') + '}';
    };

    const sortedJson = stringifyDeterministic(state);
    return crypto.createHash('sha256').update(sortedJson).digest('hex');
  }

  /**
   * Creates a compact baseline snapshot from an Amazon Inspect result before submission.
   */
  public static createBaselineSnapshot(designId: string, inspectData: any): RemoteBaselineInfo {
    const canonical = this.canonicalizeRemoteState(inspectData);
    const fingerprint = this.computeRemoteFingerprint(canonical);
    let status: string | undefined;
    let updatedDate: string | undefined;

    if (inspectData?.marketplaceData) {
      // Find top status
      const firstMp = Object.values(inspectData.marketplaceData)[0] as any;
      status = firstMp?.status;
    }

    return {
      designId,
      status,
      updatedDate,
      fingerprint
    };
  }

  /**
   * Evaluates the current remote state of a design against baseline and intended fingerprints.
   */
  public static async verifySingleDesignRemote(
    designId: string,
    options: {
      intendedFingerprint?: string;
      baselineFingerprint?: string;
      baselineStatus?: string;
    }
  ): Promise<{
    result: RemoteVerificationResult;
    currentFingerprint?: string;
    currentStatus?: string;
    details: string;
    data?: any;
  }> {
    const cleanId = (designId || '').trim();
    if (!cleanId) {
      return {
        result: 'AMBIGUOUS',
        details: 'Keine Amazon Design-ID für Verifikation vorhanden.'
      };
    }

    console.log(`[RemoteVerification] 🔍 Prüfe Remote-Zustand für Design ${cleanId} via Session 1...`);
    const inspectRes = await AmazonInspectService.inspectProductConfig(cleanId);

    if (inspectRes.status === 401 || (inspectRes.error && inspectRes.error.includes('ausgeloggt'))) {
      console.warn(`[RemoteVerification] ⚠️ Session 1 ist ausgeloggt. Verifikation erfordert Amazon-Login.`);
      return {
        result: 'AUTH_REQUIRED',
        details: 'Session 1 ist ausgeloggt. Bitte im Screencast bei Amazon anmelden.'
      };
    }

    if (inspectRes.status === 429) {
      console.warn(`[RemoteVerification] ⏳ Amazon Rate Limit (429) erreicht.`);
      return {
        result: 'RATE_LIMITED',
        details: 'Amazon Rate Limit erreicht (HTTP 429).'
      };
    }

    if (inspectRes.status === 0) {
      return {
        result: 'NETWORK_ERROR',
        details: inspectRes.error || 'Netzwerkfehler im Browser'
      };
    }

    if (inspectRes.status === 404) {
      return {
        result: 'VERIFY_PENDING',
        details: 'Design noch nicht unter productconfiguration auffindbar (Amazon eventuelle Konsistenz).'
      };
    }

    if (!inspectRes.success || !inspectRes.data) {
      return {
        result: 'REMOTE_ERROR',
        details: inspectRes.error || 'Fehler beim Abruf der Produktkonfiguration.'
      };
    }

    // Design document found! Canonicalize and compare fingerprints
    const currentCanonical = this.canonicalizeRemoteState(inspectRes.data);
    const currentFingerprint = this.computeRemoteFingerprint(currentCanonical);

    // Extract current status from marketplaceData if available
    let currentStatus: string | undefined;
    if (inspectRes.data?.products) {
      for (const pk of Object.keys(inspectRes.data.products)) {
        const mpData = inspectRes.data.products[pk]?.marketplaceData;
        if (mpData) {
          const firstSt = Object.values(mpData)[0] as any;
          if (firstSt?.status) {
            currentStatus = firstSt.status;
            break;
          }
        }
      }
    }

    console.log(`[RemoteVerification] 📊 Fingerprint: current=${currentFingerprint.substring(0, 8)}, intended=${options.intendedFingerprint?.substring(0, 8) || 'none'}, baseline=${options.baselineFingerprint?.substring(0, 8) || 'none'}`);

    // Rule 1: Exact Intended Fingerprint Match -> 100% Deterministic Success!
    if (options.intendedFingerprint && currentFingerprint === options.intendedFingerprint) {
      return {
        result: 'CONFIRMED_SUCCESS',
        currentFingerprint,
        currentStatus,
        details: 'Exakter Fingerprint-Match: Intendierter Zielzustand existiert auf Amazon.',
        data: inspectRes.data
      };
    }

    // Rule 2: Status transition into Amazon processing pipeline (UNDER_REVIEW / PROCESSING / TRANSLATING)
    // ONLY valid evidence if baseline status was NOT already that same status!
    const processingStatuses = new Set(['UNDER_REVIEW', 'REVIEW', 'PROCESSING', 'TRANSLATING', 'PUBLISHING']);
    const baselineWasProcessing = options.baselineStatus && processingStatuses.has(options.baselineStatus.toUpperCase());
    const isNowProcessing = currentStatus && processingStatuses.has(currentStatus.toUpperCase());

    if (isNowProcessing && !baselineWasProcessing) {
      return {
        result: 'CONFIRMED_SUCCESS',
        currentFingerprint,
        currentStatus,
        details: `Statuswechsel nachgewiesen: Design ist nun in Amazon-Verarbeitung (${currentStatus}).`,
        data: inspectRes.data
      };
    }

    // Rule 3: Baseline unchanged -> Remote state has not updated yet (Eventual Consistency)
    if (options.baselineFingerprint && currentFingerprint === options.baselineFingerprint) {
      return {
        result: 'VERIFY_PENDING',
        currentFingerprint,
        currentStatus,
        details: 'Remote-Zustand entspricht noch der Baseline vor Submit. Amazon verarbeitet möglicherweise noch.',
        data: inspectRes.data
      };
    }

    // Rule 4: Neither baseline nor intended -> Ambiguous
    return {
      result: 'AMBIGUOUS',
      currentFingerprint,
      currentStatus,
      details: `Remote-Zustand unterscheidet sich von Baseline und Ziel (Status: ${currentStatus || 'unbekannt'}).`,
      data: inspectRes.data
    };
  }

  /**
   * Idempotent, crash-recoverable Saga to finalize a confirmed remote action across Queue and SQLite.
   */
  public static finalizeConfirmedRemoteAction(
    queueItemId: string,
    amazonDesignId: string,
    verifiedRemoteStatus?: string,
    details?: string
  ): { success: boolean; error?: string } {
    console.log(`[RemoteVerification] 🏁 Finalisiere bestätigte Remote-Aktion für Queue-Item ${queueItemId} (Amazon-ID: ${amazonDesignId})...`);

    const queue = QueueService.loadQueue();
    const item = queue.find(i => i.id === queueItemId);
    if (!item) {
      return { success: false, error: `Queue Item ${queueItemId} nicht gefunden` };
    }

    const taskId = item.taskId;
    const now = new Date().toISOString();

    // Step 1: Record confirmed state in Queue Item (Write-Ahead)
    QueueService.updateItemUploadRecovery(queueItemId, {
      phase: 'AMAZON_CONFIRMED',
      amazonDesignId,
      amazonConfirmedAt: now,
      recoveryReason: details || 'Remote-Aktion deterministisch verifiziert',
      remoteVerification: {
        status: 'CONFIRMED_SUCCESS',
        attempts: (item.uploadRecovery?.remoteVerification?.attempts || 0) + 1,
        firstAttemptAt: item.uploadRecovery?.remoteVerification?.firstAttemptAt || now,
        lastAttemptAt: now,
        matchedDesignId: amazonDesignId,
        details: details || 'Deterministisch bestätigt'
      }
    });

    // Step 2: Finalize SQLite Task
    if (taskId) {
      try {
        const existingTask = TaskRepository.getTaskById(taskId);
        if (existingTask && existingTask.status !== 'COMPLETED') {
          TaskLogService.updateTaskStatus(taskId, {
            status: 'COMPLETED',
            hasError: false,
            errorDetails: undefined,
            designId: amazonDesignId,
            inQueue: true,
            recovery: {
              recoveryAttempts: existingTask.recovery?.recoveryAttempts || 1,
              lastAttemptAt: now,
              recoveredAt: now,
              recoveredSuccessfully: true,
              amazonDesignId,
              verifiedRemoteStatus: verifiedRemoteStatus || 'CONFIRMED',
              remoteVerificationResult: 'CONFIRMED_SUCCESS',
              recoveryReason: details || 'Remote Verification Confirmed'
            }
          });

          TaskLogService.addEvent(taskId, {
            timestamp: now,
            type: 'RECOVERY_COMPLETED',
            title: 'Remote-Aktion erfolgreich auf Amazon verifiziert',
            content: {
              amazonDesignId,
              verifiedRemoteStatus: verifiedRemoteStatus || 'CONFIRMED',
              details
            }
          });
        }
      } catch (dbErr: any) {
        console.warn(`[RemoteVerification] SQLite Task ${taskId} konnte nicht aktualisiert werden:`, dbErr.message);
      }
    }

    // Step 3: Complete Queue Item
    QueueService.updateItemStatus(queueItemId, 'COMPLETED', undefined, item.uploadResultSummary);
    QueueService.rebalanceQueue();

    console.log(`[RemoteVerification] ✅ Queue-Item ${queueItemId} & Task ${taskId} erfolgreich als COMPLETED synchronisiert.`);
    return { success: true };
  }

  /**
   * Starts the background verification worker for in-flight VERIFY_PENDING uploads.
   * Runs asynchronously without blocking system readiness.
   */
  public static startVerificationWorker(): void {
    if (this.isVerificationWorkerRunning) return;
    this.isVerificationWorkerRunning = true;

    console.log('[RemoteVerification] ⚙️ Starte Remote Verification Worker (Intervall: 30s)...');

    this.verificationTimer = setInterval(async () => {
      try {
        await this.runPendingVerificationCycle();
      } catch (err: any) {
        console.warn('[RemoteVerification] Fehler im Verifikations-Zyklus:', err.message);
      }
    }, 30_000);
  }

  /**
   * Executes a single verification pass over all pending queue items.
   */
  public static async runPendingVerificationCycle(): Promise<void> {
    const queue = QueueService.loadQueue();
    const pendingItems = queue.filter(item => {
      const v = item.uploadRecovery?.remoteVerification;
      return v && v.status === 'VERIFY_PENDING';
    });

    if (pendingItems.length === 0) return;

    for (const item of pendingItems) {
      const designId = item.uploadRecovery?.amazonDesignId || item.designId;
      if (!designId) continue;

      const vInfo = item.uploadRecovery?.remoteVerification!;
      const attempts = vInfo.attempts || 1;
      const nextDelayMs = this.BACKOFF_INTERVALS_MS[Math.min(attempts, this.BACKOFF_INTERVALS_MS.length - 1)];
      const lastCheckTime = new Date(vInfo.lastAttemptAt).getTime();

      if (Date.now() - lastCheckTime < nextDelayMs) {
        continue; // Wait for backoff window
      }

      console.log(`[RemoteVerification] 🔄 Prüfe Versuch ${attempts + 1}/${this.MAX_VERIFY_ATTEMPTS} für Item ${item.id}...`);
      const verifyRes = await this.verifySingleDesignRemote(designId, {
        intendedFingerprint: item.uploadRecovery?.intendedRemoteFingerprint,
        baselineFingerprint: item.uploadRecovery?.remoteBaseline?.fingerprint,
        baselineStatus: item.uploadRecovery?.remoteBaseline?.status
      });

      const now = new Date().toISOString();
      const nextAttempts = attempts + 1;

      if (verifyRes.result === 'CONFIRMED_SUCCESS') {
        this.finalizeConfirmedRemoteAction(item.id, designId, verifyRes.currentStatus, verifyRes.details);
      } else if (verifyRes.result === 'VERIFY_PENDING' && nextAttempts < this.MAX_VERIFY_ATTEMPTS) {
        QueueService.updateItemUploadRecovery(item.id, {
          remoteVerification: {
            status: 'VERIFY_PENDING',
            attempts: nextAttempts,
            firstAttemptAt: vInfo.firstAttemptAt,
            lastAttemptAt: now,
            details: verifyRes.details
          }
        });
      } else {
        // Exceeded max attempts OR ambiguous -> Escalate to Human Review! (NEVER blind retry)
        const finalStatus: RemoteVerificationResult = verifyRes.result === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'AMBIGUOUS';
        console.warn(`[RemoteVerification] ⚠️ Verifikation für Item ${item.id} nicht automatisch auflösbar (${finalStatus}). Eskaliere zu AWAITING_RECOVERY_REVIEW.`);

        QueueService.updateItemUploadRecovery(item.id, {
          remoteVerification: {
            status: finalStatus,
            attempts: nextAttempts,
            firstAttemptAt: vInfo.firstAttemptAt,
            lastAttemptAt: now,
            details: verifyRes.details
          }
        });

        QueueService.updateItemStatus(item.id, 'ERROR', `Remote-Aktion unklar: ${verifyRes.details}`);

        if (item.taskId) {
          TaskLogService.updateTaskStatus(item.taskId, {
            status: 'AWAITING_RECOVERY_REVIEW',
            checkpoint: 'RECOVERY_REVIEW',
            hasError: true,
            errorDetails: `Remote-Verifikation unklar: ${verifyRes.details}`
          });
        }
      }
    }
  }

  /**
   * Human Review Action 1: REVERIFY_REMOTE
   * Triggers an immediate remote verification check on demand.
   */
  public static async reverifyRemote(taskId: string): Promise<{ success: boolean; result: RemoteVerificationResult; details: string }> {
    const queue = QueueService.loadQueue();
    const item = queue.find(i => i.taskId === taskId);
    if (!item) {
      return { success: false, result: 'AMBIGUOUS', details: `Kein Queue-Item für Task ${taskId} gefunden.` };
    }

    const designId = item.uploadRecovery?.amazonDesignId || item.designId;
    if (!designId) {
      return { success: false, result: 'AMBIGUOUS', details: 'Keine Amazon Design-ID hinterlegt.' };
    }

    const res = await this.verifySingleDesignRemote(designId, {
      intendedFingerprint: item.uploadRecovery?.intendedRemoteFingerprint,
      baselineFingerprint: item.uploadRecovery?.remoteBaseline?.fingerprint,
      baselineStatus: item.uploadRecovery?.remoteBaseline?.status
    });

    if (res.result === 'CONFIRMED_SUCCESS') {
      this.finalizeConfirmedRemoteAction(item.id, designId, res.currentStatus, res.details);
    }

    return { success: true, result: res.result, details: res.details };
  }

  /**
   * Human Review Action 2: MARK_CONFIRMED
   * User explicitly confirms that Amazon has accepted the design.
   */
  public static markConfirmed(taskId: string, amazonDesignId: string): { success: boolean; error?: string } {
    const queue = QueueService.loadQueue();
    const item = queue.find(i => i.taskId === taskId);
    if (!item) {
      return { success: false, error: `Kein Queue-Item für Task ${taskId} gefunden.` };
    }

    return this.finalizeConfirmedRemoteAction(item.id, amazonDesignId, 'MANUALLY_CONFIRMED', 'Vom Benutzer manuell als erfolgreich bestätigt');
  }

  /**
   * Human Review Action 3: FORCE_RETRY
   * Conscious user override: User confirms design was NOT submitted.
   * Archives previous attempt in history and cleanly resets to WAITING.
   */
  public static forceRetry(taskId: string, reason: string): { success: boolean; error?: string } {
    const queue = QueueService.loadQueue();
    const item = queue.find(i => i.taskId === taskId);
    if (!item) {
      return { success: false, error: `Kein Queue-Item für Task ${taskId} gefunden.` };
    }

    const now = new Date().toISOString();
    const prevRecovery = item.uploadRecovery;
    const historyEntry: UploadRecoveryHistoryEntry = {
      attempt: prevRecovery?.attempt || 1,
      phase: prevRecovery?.phase || 'UNKNOWN',
      action: prevRecovery?.action,
      remoteRequestIntentAt: prevRecovery?.remoteRequestIntentAt || prevRecovery?.remoteActionIntentAt,
      result: prevRecovery?.remoteVerification?.status || 'FORCE_RETRIED',
      manualOverride: 'FORCE_RETRY',
      overrideAt: now,
      reason: reason || 'Benutzer hat erneuten Upload-Versuch erzwungen'
    };

    const currentHistory = prevRecovery?.history || [];
    currentHistory.push(historyEntry);

    // Clean reset to WAITING with incremented attempt
    QueueService.updateItemUploadRecovery(item.id, {
      phase: 'STARTING',
      attempt: (prevRecovery?.attempt || 1) + 1,
      startedAt: now,
      remoteRequestIntentAt: undefined,
      remoteActionIntentAt: undefined,
      amazonConfirmedAt: undefined,
      recoveryReason: `Manueller Retry: ${reason}`,
      manualOverride: {
        action: 'FORCE_RETRY',
        timestamp: now,
        reason
      },
      history: currentHistory
    });

    QueueService.updateItemStatus(item.id, 'WAITING', undefined);
    QueueService.rebalanceQueue();

    TaskLogService.updateTaskStatus(taskId, {
      status: 'PROCESSING',
      hasError: false,
      errorDetails: undefined
    });

    TaskLogService.addEvent(taskId, {
      timestamp: now,
      type: 'RECOVERY_OVERRIDDEN' as any,
      title: 'Manueller Upload-Retry erteilt (Override)',
      content: { reason, previousAttempt: prevRecovery?.attempt }
    });

    console.log(`[RemoteVerification] 🔄 FORCE_RETRY für Task ${taskId} ausgeführt. Item ${item.id} ist wieder WAITING.`);
    return { success: true };
  }

  /**
   * Human Review Action 4: CANCEL
   * Aborts upload workflow while preserving full recovery evidence.
   */
  public static cancelUpload(taskId: string, reason: string): { success: boolean; error?: string } {
    const queue = QueueService.loadQueue();
    const item = queue.find(i => i.taskId === taskId);
    if (!item) {
      return { success: false, error: `Kein Queue-Item für Task ${taskId} gefunden.` };
    }

    const now = new Date().toISOString();
    const prevRecovery = item.uploadRecovery;
    const historyEntry: UploadRecoveryHistoryEntry = {
      attempt: prevRecovery?.attempt || 1,
      phase: prevRecovery?.phase || 'UNKNOWN',
      action: prevRecovery?.action,
      remoteRequestIntentAt: prevRecovery?.remoteRequestIntentAt,
      result: 'CANCELLED_BY_USER',
      manualOverride: 'CANCEL',
      overrideAt: now,
      reason: reason || 'Vom Benutzer abgebrochen'
    };

    const currentHistory = prevRecovery?.history || [];
    currentHistory.push(historyEntry);

    QueueService.updateItemUploadRecovery(item.id, {
      recoveryReason: `Abgebrochen: ${reason}`,
      manualOverride: {
        action: 'CANCEL',
        timestamp: now,
        reason
      },
      history: currentHistory
    });

    // Mark as ERROR / Cancelled in Queue
    QueueService.updateItemStatus(item.id, 'ERROR', `Upload abgebrochen: ${reason}`);
    QueueService.rebalanceQueue();

    TaskLogService.updateTaskStatus(taskId, {
      status: 'REJECTED',
      hasError: true,
      errorDetails: `Upload abgebrochen: ${reason}`
    });

    return { success: true };
  }

  /**
   * Finds possible Amazon candidate designs in Coral FindListings to assist the user in Human Review.
   * Matches by title, brand or time window (UI helper only - never triggers automated state changes).
   */
  public static async findPossibleAmazonCandidates(taskId: string): Promise<{
    candidates: Array<{
      designId: string;
      title: string;
      brand?: string;
      status: string;
      createdDate?: string;
      updatedDate?: string;
      similarity: 'HIGH' | 'MEDIUM';
    }>;
  }> {
    const task = TaskRepository.getTaskById(taskId);
    if (!task) return { candidates: [] };

    const quoteOrTitle = (task.payload?.title || task.payload?.quote || '').toLowerCase();
    if (!quoteOrTitle) return { candidates: [] };

    try {
      const inspectRes = await AmazonInspectService.inspectFindListings();
      if (!inspectRes.success || !inspectRes.data?.items) return { candidates: [] };

      const items = inspectRes.data.items as any[];
      const candidates: any[] = [];

      for (const it of items) {
        const dId = it.designId;
        const itTitle = (it.title || '').toLowerCase();
        if (dId && itTitle) {
          if (itTitle === quoteOrTitle || itTitle.includes(quoteOrTitle) || quoteOrTitle.includes(itTitle)) {
            candidates.push({
              designId: dId,
              title: it.title,
              brand: it.brandName,
              status: it.status || 'UNKNOWN',
              createdDate: it.createdDate,
              updatedDate: it.updatedDate,
              similarity: itTitle === quoteOrTitle ? 'HIGH' : 'MEDIUM'
            });
          }
        }
      }

      return { candidates: candidates.slice(0, 5) };
    } catch {
      return { candidates: [] };
    }
  }

  /**
   * Stops the verification worker (used in testing).
   */
  public static stopVerificationWorker(): void {
    if (this.verificationTimer) {
      clearInterval(this.verificationTimer);
      this.verificationTimer = null;
    }
    this.isVerificationWorkerRunning = false;
  }
}

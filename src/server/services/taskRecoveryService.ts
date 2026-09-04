import fs from 'fs';
import path from 'path';
import { QueueService, QueueItem } from './queueService';
import { TaskRepository } from '../storage/taskRepository';
import { TaskLogService } from './taskLogService';
import { TaskStatus, TaskSource, DesignTaskLog } from '../../types/tasks';
import { TaskExecutionLock } from './taskExecutionLock';
import { AssetValidationService } from './assetValidationService';
import { DesignPipelineService } from './designPipelineService';
import { UpdatePipelineService } from './updatePipelineService';
import { SvgRenderService } from './svgRenderService';
import { TrademarkService } from './trademarkService';
import { loadSettings } from './settingsService';
import { LLMService } from './llmService';
import { AmazonRecoveryVerificationService } from './amazonRecoveryVerificationService';

export interface ReservedRecoveryJob {
  taskId: string;
  source: TaskSource;
  status: TaskStatus;
  designId?: string;
}

export interface TaskRecoveryReport {
  timestamp: string;
  queueCorrupted: boolean;
  preRemoteUploadsReset: number;
  unsafeUploadsEscalated: number;
  confirmedUploadsCompleted: number;
  legacyUploadsEscalated: number;
  tasksLinkedToQueue: number;
  orphanQueueItemsWaiting: number;
  orphanQueueItemsUploading: number;
  tasksWithMissingQueueItem: number;
  detectedZombieTasks: number;
  candidateZombieTasks: number;
  reservedRecoveryJobs: number;
  attemptLimitEscalatedTasks: number;
  details: string[];
}

export class TaskRecoveryService {
  private static reservedRecoveryJobs: ReservedRecoveryJob[] = [];
  private static reservedDesignIds: Set<string> = new Set();
  private static isWorkerRunning = false;

  public static readonly CANDIDATE_ZOMBIE_STATUSES: TaskStatus[] = [
    'RECEIVED',
    'PROCESSING',
    'PROMPT_READY',
    'GENERATING_IMAGE',
    'ANALYZING_DESIGN',
    'GENERATING_LISTING',
    'CHECKING_TRADEMARKS',
    'UPDATE_EXTRACTED',
    'UPDATE_DOWNLOADING_ARTWORK',
    'UPDATE_ARTWORK_READY',
    'UPDATE_ANALYZED',
    'UPDATE_REWRITING',
    'UPDATE_REWRITTEN',
    'UPDATE_TM_CHECKED',
    'TRANSLATING_LISTING',
    'VECTORIZING_DESIGN',
    'FINALIZING',
    'UPDATE_TRANSLATED'
  ];

  /**
   * Main recovery and reconciliation entrypoint.
   * MUST run during server startup before any background schedulers, upload workers, or mutating APIs are allowed.
   */
  public static initAndReconcile(): TaskRecoveryReport {
    const report: TaskRecoveryReport = {
      timestamp: new Date().toISOString(),
      queueCorrupted: false,
      preRemoteUploadsReset: 0,
      unsafeUploadsEscalated: 0,
      confirmedUploadsCompleted: 0,
      legacyUploadsEscalated: 0,
      tasksLinkedToQueue: 0,
      orphanQueueItemsWaiting: 0,
      orphanQueueItemsUploading: 0,
      tasksWithMissingQueueItem: 0,
      detectedZombieTasks: 0,
      candidateZombieTasks: 0,
      reservedRecoveryJobs: 0,
      attemptLimitEscalatedTasks: 0,
      details: []
    };

    console.log('[TaskRecovery] 🛡️ Starting Phase P3.1/P3.2 Crash Recovery & Storage Reconciliation...');

    // 1. Ensure Queue is loaded
    QueueService.ensureLoaded();

    // 2. Check for queue corruption (Fail-Closed)
    if (QueueService.isCorrupted()) {
      report.queueCorrupted = true;
      const msg = 'CRITICAL: Queue storage is in fail-safe corrupted mode. Auto-recovery and uploads are blocked.';
      report.details.push(msg);
      console.error(`[TaskRecovery] 🚨 ${msg}`);
      return report;
    }

    const queueItems = QueueService.loadQueue();
    let hasQueueChanges = false;

    // 3. Cross-Storage Saga & Upload Queue Items Reconciliation
    for (const item of queueItems) {
      const recovery = item.uploadRecovery;
      const designId = recovery?.amazonDesignId || item.designId;

      // SAGA RECOVERY: If remote verification succeeded or AMAZON_CONFIRMED was persisted,
      // but SQLite task or Queue status is not COMPLETED:
      if (recovery?.remoteVerification?.status === 'CONFIRMED_SUCCESS' || recovery?.phase === 'AMAZON_CONFIRMED') {
        const targetDesignId = designId || (item.taskId ? TaskRepository.getTaskById(item.taskId)?.designId : undefined);
        const taskObj = item.taskId ? TaskRepository.getTaskById(item.taskId) : null;
        if (targetDesignId && (item.status !== 'COMPLETED' || (taskObj && taskObj.status !== 'COMPLETED'))) {
          AmazonRecoveryVerificationService.finalizeConfirmedRemoteAction(
            item.id,
            targetDesignId,
            recovery?.remoteVerification?.details || 'Startup Reconciled',
            'Cross-Storage Recovery: Finalized verified remote state'
          );
          hasQueueChanges = true;
          report.confirmedUploadsCompleted++;
          report.details.push(`Reconciled confirmed item ${item.id} across Queue and Task`);
          continue;
        }
      }

      if (item.status === 'UPLOADING') {
        if (recovery && recovery.phase) {
          const preRemotePhases = ['STARTING', 'NAVIGATING', 'CONFIGURING', 'VALIDATING', 'READY_TO_SUBMIT'];

          if (preRemotePhases.includes(recovery.phase)) {
            // SAFE PRE-REMOTE CRASH: No remote side effects could have occurred yet
            item.status = 'WAITING';
            item.uploadRecovery = {
              ...recovery,
              phase: 'STARTING',
              attempt: (recovery.attempt || 1) + 1,
              recoveryReason: `Recovered from pre-remote interruption in phase ${recovery.phase} (safe to retry)`
            };
            hasQueueChanges = true;
            report.preRemoteUploadsReset++;
            report.details.push(`Reset pre-remote item ${item.id} (${item.title || item.designTitle}) to WAITING`);
            console.log(`[TaskRecovery] 🔄 Pre-Remote Recovery: Reset item ${item.id} (${recovery.phase}) back to WAITING.`);

          } else if (recovery.phase === 'REMOTE_ACTION_INTENT' && recovery.action === 'PUBLISH' && !recovery.remoteRequestIntentAt) {
            // P3.1 LEGACY PUBLISH: REMOTE_ACTION_INTENT was recorded before opening modal!
            // First submit button only opens modal without sending HTTP request.
            // Safe to restart!
            item.status = 'WAITING';
            item.uploadRecovery = {
              ...recovery,
              phase: 'STARTING',
              attempt: (recovery.attempt || 1) + 1,
              recoveryReason: 'Recovered from legacy pre-remote publish intent (modal not submitted, safe to retry)'
            };
            hasQueueChanges = true;
            report.preRemoteUploadsReset++;
            report.details.push(`Reset legacy pre-remote publish item ${item.id} to WAITING`);
            console.log(`[TaskRecovery] 🔄 Pre-Remote Publish Recovery: Reset legacy item ${item.id} to WAITING.`);

          } else if (recovery.phase === 'REMOTE_ACTION_INTENT' && recovery.action === 'SAVE_DRAFT') {
            // P3.1 LEGACY SAVE_DRAFT: Draft button fires HTTP request immediately!
            // Unsafe unknown remote state.
            const hasKnownId = Boolean(recovery.amazonDesignId || item.designId);
            const now = new Date().toISOString();

            item.status = 'ERROR';
            item.errorMessage = 'Upload während Save-Draft unterbrochen. Remote-Zustand unbekannt.';
            item.uploadRecovery = {
              ...recovery,
              recoveryReason: 'Interrupted during SAVE_DRAFT intent. Automated retry blocked to prevent duplicates.',
              remoteVerification: hasKnownId ? {
                status: 'VERIFY_PENDING',
                attempts: 1,
                firstAttemptAt: now,
                lastAttemptAt: now,
                matchedDesignId: recovery.amazonDesignId || item.designId,
                details: 'Prüfe remote Draft-Status auf Amazon'
              } : undefined
            };
            hasQueueChanges = true;
            report.unsafeUploadsEscalated++;
            report.details.push(`Escalated legacy draft item ${item.id} to ${hasKnownId ? 'VERIFY_PENDING' : 'Human Review'}`);

            if (item.taskId) {
              TaskLogService.updateTaskStatus(item.taskId, {
                status: 'AWAITING_RECOVERY_REVIEW',
                checkpoint: 'RECOVERY_REVIEW',
                hasError: true,
                errorDetails: 'Upload während Save-Draft unterbrochen. Bitte in Amazon Manage prüfen.'
              });
            }

          } else if (recovery.phase === 'REMOTE_REQUEST_INTENT' || recovery.phase === 'AWAITING_AMAZON_CONFIRMATION') {
            // P3.3 UNIFIED REMOTE REQUEST INTENT: Remote side effects possibly in-flight!
            const hasKnownId = Boolean(recovery.amazonDesignId || item.designId);
            const now = new Date().toISOString();

            item.status = 'ERROR';
            item.errorMessage = 'Upload während des Amazon Remote-Requests unterbrochen.';
            item.uploadRecovery = {
              ...recovery,
              recoveryReason: `Interrupted during ${recovery.phase}. Remote request was possibly received.`,
              remoteVerification: hasKnownId ? {
                status: 'VERIFY_PENDING',
                attempts: 1,
                firstAttemptAt: now,
                lastAttemptAt: now,
                matchedDesignId: recovery.amazonDesignId || item.designId,
                details: 'Automatische Remote-Verifikation aktiv'
              } : undefined
            };
            hasQueueChanges = true;
            report.unsafeUploadsEscalated++;
            report.details.push(`Escalated remote request item ${item.id} (${hasKnownId ? 'ID known: VERIFY_PENDING' : 'NEW without ID: Human Review'})`);

            if (item.taskId) {
              TaskLogService.updateTaskStatus(item.taskId, {
                status: 'AWAITING_RECOVERY_REVIEW',
                checkpoint: 'RECOVERY_REVIEW',
                hasError: true,
                errorDetails: hasKnownId 
                  ? 'Upload während Amazon-Request unterbrochen. Automatische Remote-Verifikation wird ausgeführt...'
                  : 'Upload während Amazon-Request unterbrochen. Keine Design-ID vorhanden. Manuelle Prüfung erforderlich.'
              });
            }

          } else if (recovery.phase === 'AMAZON_CONFIRMED') {
            // AMAZON CONFIRMED: Remote action succeeded before the crash
            item.status = 'COMPLETED';
            item.uploadRecovery = {
              ...recovery,
              recoveryReason: 'Reconciled to COMPLETED: Amazon confirmation was persisted prior to crash'
            };
            hasQueueChanges = true;
            report.confirmedUploadsCompleted++;
            report.details.push(`Marked confirmed item ${item.id} (${item.title || item.designTitle}) as COMPLETED`);
            console.log(`[TaskRecovery] ✅ Confirmed Recovery: Item ${item.id} was already confirmed by Amazon. Reconciled to COMPLETED.`);

            if (item.taskId) {
              const task = TaskRepository.getTaskById(item.taskId);
              if (task && task.status !== 'COMPLETED' && task.status !== 'UPDATE_QUEUED') {
                TaskLogService.updateTaskStatus(task.id, {
                  status: task.source === 'UPDATE' ? 'UPDATE_QUEUED' : 'COMPLETED',
                  inQueue: true,
                  hasError: false
                });
              }
            }
          }
        } else {
          // LEGACY UPLOADING ITEM: Missing phase metadata. Fail-conservative!
          item.status = 'ERROR';
          item.errorMessage = 'Legacy-Upload ohne Phaseninformation unterbrochen. Human Review erforderlich.';
          item.uploadRecovery = {
            phase: 'REMOTE_ACTION_INTENT',
            attempt: 1,
            recoveryReason: 'Legacy item in UPLOADING state without phase metadata. Auto-retry blocked.'
          };
          hasQueueChanges = true;
          report.legacyUploadsEscalated++;
          report.details.push(`Legacy item ${item.id} without phase metadata escalated to Human Review`);
          console.warn(`[TaskRecovery] ⚠️ Legacy Upload Item: ${item.id} has no phase metadata. Escalating to Human Review.`);

          if (item.taskId) {
            const task = TaskRepository.getTaskById(item.taskId);
            if (task) {
              TaskLogService.updateTaskStatus(task.id, {
                status: 'AWAITING_RECOVERY_REVIEW',
                checkpoint: 'RECOVERY_REVIEW',
                hasError: true,
                errorDetails: 'Legacy-Task im Status UPLOADING ohne Phaseninformation unterbrochen. Bitte vor erneutem Upload den Amazon-Zustand manuell prüfen.'
              });
            }
          }
        }
      }
    }

    // 4. Cross-Storage Reconciliation: Check Queue Items vs SQLite Tasks
    const queueTaskIdSet = new Set<string>();
    for (const item of queueItems) {
      if (item.taskId) {
        queueTaskIdSet.add(item.taskId);
        const task = TaskRepository.getTaskById(item.taskId);

        if (task) {
          if (!task.inQueue) {
            const targetStatus = (task.status === 'COMPLETED' || task.status === 'UPDATE_QUEUED' || task.status === 'AWAITING_RECOVERY_REVIEW')
              ? task.status
              : (task.source === 'UPDATE' ? 'UPDATE_QUEUED' : 'COMPLETED');

            TaskLogService.updateTaskStatus(task.id, {
              inQueue: true,
              status: targetStatus
            });
            report.tasksLinkedToQueue++;
            report.details.push(`Reconciled task ${task.id}: set inQueue=true and status=${targetStatus}`);
            console.log(`[TaskRecovery] 🔗 Reconciled task ${task.id}: linked to existing queue item.`);
          }
        } else {
          if (item.status === 'WAITING') {
            report.orphanQueueItemsWaiting++;
            report.details.push(`Orphan WAITING queue item found: ${item.id} (task ${item.taskId} not found)`);
            console.warn(`[TaskRecovery] ⚠️ Orphan WAITING queue item: ${item.id} (Task ${item.taskId} missing).`);
          } else if (item.status === 'UPLOADING') {
            report.orphanQueueItemsUploading++;
            report.details.push(`Orphan UPLOADING queue item found: ${item.id} (task ${item.taskId} not found)`);
            console.warn(`[TaskRecovery] 🚨 Orphan UPLOADING queue item: ${item.id} (preserved without deletion).`);
          }
        }
      }
    }

    // 5. Cross-Storage Reconciliation: Tasks with inQueue=true but missing Queue item
    const inQueueTasks = TaskRepository.getInQueueTasks();
    for (const task of inQueueTasks) {
      if (!queueTaskIdSet.has(task.id)) {
        if (task.status !== 'COMPLETED' && task.status !== 'UPDATE_QUEUED') {
          report.tasksWithMissingQueueItem++;
          report.details.push(`Task ${task.id} has inQueue=true, status=${task.status}, but queue item is missing`);
          console.warn(`[TaskRecovery] ⚠️ Task ${task.id} flagged inQueue=true, but missing from upload_queue.json.`);
        }
      }
    }

    // 6. Phase P3.2 Classification & Job Reservation (O(1) Targeted SQLite Query)
    this.classifyAndPrepareRecoveryJobs(report);

    // 7. Atomically save queue if any items were updated
    if (hasQueueChanges) {
      try {
        QueueService.saveQueue();
        console.log('[TaskRecovery] 💾 Queue changes successfully saved to disk.');
      } catch (err: any) {
        console.error('[TaskRecovery] ❌ Failed to save reconciled queue:', err.message);
        report.details.push(`Failed to save reconciled queue: ${err.message}`);
      }
    }

    console.log(`[TaskRecovery] ✅ Phase P3.1/P3.2 Reconciliation complete. (${report.reservedRecoveryJobs} reserved jobs, ${report.attemptLimitEscalatedTasks} attempt escalations).`);
    return report;
  }

  /**
   * Phase P3.2: Classify candidate zombie tasks and reserve them in memory before system becomes ready.
   * Does NOT increment recoveryAttempts here (increment happens when worker actually starts the task).
   */
  private static classifyAndPrepareRecoveryJobs(report: TaskRecoveryReport): void {
    this.reservedRecoveryJobs = [];
    this.reservedDesignIds.clear();

    // Use fast indexed query for candidate statuses only
    const candidateTasks = TaskRepository.getTasksByStatuses(this.CANDIDATE_ZOMBIE_STATUSES);
    report.candidateZombieTasks = candidateTasks.length;
    report.detectedZombieTasks = candidateTasks.length;

    for (const task of candidateTasks) {
      // Ignore tasks that have error flag set or are in terminal/review state
      if (task.hasError || task.status === 'ERROR' || task.status === 'COMPLETED' || task.status === 'UPDATE_QUEUED' || task.status === 'REJECTED') {
        continue;
      }

      // Ignore tasks awaiting human reviews
      if (task.status.startsWith('AWAITING_')) {
        continue;
      }

      const designId = (task.designId || task.payload?.designId || '').trim();
      const currentAttempts = task.recovery?.recoveryAttempts || 0;

      // Rule: Strictly max 2 automated recovery attempts
      if (currentAttempts >= 2) {
        console.warn(`[TaskRecovery] 🚨 Task ${task.id} exceeded max recovery attempts (${currentAttempts}). Escalating to AWAITING_RECOVERY_REVIEW.`);
        TaskLogService.updateTaskStatus(task.id, {
          status: 'AWAITING_RECOVERY_REVIEW',
          checkpoint: 'RECOVERY_REVIEW',
          hasError: true,
          errorDetails: `Maximales Recovery-Limit von 2 Versuchen erreicht. Automatischer Neustart blockiert.`
        });
        TaskLogService.addEvent(task.id, {
          timestamp: new Date().toISOString(),
          type: 'RECOVERY_ESCALATED',
          title: 'Recovery-Limit erreicht ➔ Human Review',
          content: { attempts: currentAttempts, reason: 'RECOVERY_ATTEMPT_LIMIT_REACHED' }
        });
        report.attemptLimitEscalatedTasks++;
        report.details.push(`Task ${task.id} escalated to AWAITING_RECOVERY_REVIEW (attempts: ${currentAttempts})`);
        continue;
      }

      // Reserve job
      this.reservedRecoveryJobs.push({
        taskId: task.id,
        source: task.source,
        status: task.status,
        designId: designId || undefined
      });

      if (designId) {
        this.reservedDesignIds.add(designId.toLowerCase());
      }

      TaskLogService.addEvent(task.id, {
        timestamp: new Date().toISOString(),
        type: 'RECOVERY_DETECTED',
        title: 'Unterbrochener Pipeline-Task für Recovery vorgemerkt',
        content: { status: task.status, source: task.source, attemptsAlreadyMade: currentAttempts }
      });

      report.reservedRecoveryJobs++;
      report.details.push(`Reserved recovery job for task ${task.id} (${task.source} / ${task.status})`);
    }

    console.log(`[TaskRecovery] 📋 Reserved ${this.reservedRecoveryJobs.length} recovery jobs (${this.reservedDesignIds.size} unique designs).`);
  }

  /**
   * Returns whether a designId is currently reserved for recovery.
   * Used by UpdateBackfillService to prevent creating duplicate UPDATE tasks.
   */
  public static isDesignReserved(designId?: string): boolean {
    if (!designId) return false;
    return this.reservedDesignIds.has(designId.trim().toLowerCase());
  }

  /**
   * Returns list of currently reserved design IDs.
   */
  public static getReservedDesignIds(): string[] {
    return Array.from(this.reservedDesignIds);
  }

  /**
   * Returns list of currently reserved recovery jobs.
   */
  public static getReservedJobs(): ReservedRecoveryJob[] {
    return [...this.reservedRecoveryJobs];
  }

  /**
   * Starts the controlled background recovery worker.
   * Runs asynchronously after server is ready (isSystemReady = true).
   */
  public static async startRecoveryQueueWorker(concurrency = 1): Promise<void> {
    // Start asynchronous remote verification worker for in-flight pending uploads
    AmazonRecoveryVerificationService.startVerificationWorker();

    if (this.isWorkerRunning) {
      console.log('[TaskRecovery] ℹ️ Recovery Worker is already running.');
      return;
    }

    if (this.reservedRecoveryJobs.length === 0) {
      console.log('[TaskRecovery] ℹ️ No reserved recovery jobs to process.');
      return;
    }

    this.isWorkerRunning = true;
    console.log(`[TaskRecovery] ⚙️ Starting background recovery worker (${this.reservedRecoveryJobs.length} jobs queued, concurrency: ${concurrency})...`);

    // Process asynchronously so caller is never blocked
    (async () => {
      try {
        while (this.reservedRecoveryJobs.length > 0) {
          const job = this.reservedRecoveryJobs.shift();
          if (!job) break;

          await this.processSingleRecoveryJob(job);
        }
      } catch (err: any) {
        console.error('[TaskRecovery] ❌ Unhandled error in recovery worker:', err);
      } finally {
        this.isWorkerRunning = false;
        console.log('[TaskRecovery] 🏁 Recovery worker finished all queued jobs.');
      }
    })();
  }

  /**
   * Resets worker state (used in testing).
   */
  public static resetWorkerStateForTest(): void {
    this.isWorkerRunning = false;
    this.reservedRecoveryJobs = [];
    this.reservedDesignIds.clear();
  }

  /**
   * Executes recovery for a single reserved task.
   * Increments recoveryAttempts ONLY here when execution actually starts.
   */
  public static async processSingleRecoveryJob(job: ReservedRecoveryJob): Promise<void> {
    const { taskId, source, status } = job;
    console.log(`[TaskRecovery] 🔄 Processing recovery for task ${taskId} (${source}, ${status})...`);

    // Check lock
    if (!TaskExecutionLock.acquire(taskId, 'RECOVERY')) {
      console.warn(`[TaskRecovery] ⚠️ Task ${taskId} is currently locked. Skipping.`);
      if (job.designId) this.reservedDesignIds.delete(job.designId.toLowerCase());
      return;
    }

    try {
      const task = TaskLogService.getTaskLogById(taskId);
      if (!task) {
        console.warn(`[TaskRecovery] Task ${taskId} no longer exists. Skipping.`);
        return;
      }

      // Check terminal/human review
      if (task.status.startsWith('AWAITING_') || task.status === 'COMPLETED' || task.status === 'UPDATE_QUEUED' || task.status === 'ERROR') {
        console.log(`[TaskRecovery] Task ${taskId} is already in state ${task.status}. No action.`);
        return;
      }

      const currentAttempts = task.recovery?.recoveryAttempts || 0;
      if (currentAttempts >= 2) {
        console.warn(`[TaskRecovery] Task ${taskId} reached attempt limit right before execution. Escalating.`);
        TaskLogService.updateTaskStatus(taskId, {
          status: 'AWAITING_RECOVERY_REVIEW',
          checkpoint: 'RECOVERY_REVIEW',
          hasError: true,
          errorDetails: 'Maximales Recovery-Limit von 2 Versuchen erreicht.'
        });
        return;
      }

      // Increment attempt counter upon ACTUAL start
      const nextAttempt = currentAttempts + 1;
      const now = new Date().toISOString();

      TaskLogService.updateTaskStatus(taskId, {
        recovery: {
          recoveryAttempts: nextAttempt,
          lastAttemptAt: now,
          interruptedStatus: task.status,
          recoveryReason: `Automated recovery attempt ${nextAttempt} started`
        }
      });

      TaskLogService.addEvent(taskId, {
        timestamp: now,
        type: 'RECOVERY_STARTED',
        title: `Recovery-Versuch ${nextAttempt} von 2 gestartet`,
        content: { previousStatus: task.status, attempt: nextAttempt }
      });

      // Dispatch recovery based on (source, status) matrix
      const result = await this.executeRecoveryPolicy(task);

      if (result.success) {
        const completedNow = new Date().toISOString();
        TaskLogService.updateTaskStatus(taskId, {
          recovery: {
            recoveryAttempts: nextAttempt,
            lastAttemptAt: now,
            interruptedStatus: task.status,
            recoveredAt: completedNow,
            recoveredSuccessfully: true,
            recoveryReason: 'Automated recovery completed successfully'
          }
        });
        TaskLogService.addEvent(taskId, {
          timestamp: completedNow,
          type: 'RECOVERY_COMPLETED',
          title: `Recovery für Task ${taskId} erfolgreich abgeschlossen`,
          content: { pausedAtCheckpoint: result.pausedAtCheckpoint }
        });
      } else {
        const failedNow = new Date().toISOString();
        TaskLogService.addEvent(taskId, {
          timestamp: failedNow,
          type: 'RECOVERY_FAILED',
          title: `Recovery für Task ${taskId} fehlgeschlagen`,
          content: { error: result.error }
        });
      }
    } catch (err: any) {
      console.error(`[TaskRecovery] ❌ Exception during recovery of task ${taskId}:`, err);
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(),
        type: 'RECOVERY_FAILED',
        title: `Unerwarteter Fehler bei Task-Recovery`,
        content: { error: err.message }
      });
    } finally {
      TaskExecutionLock.release(taskId);
      if (job.designId) {
        this.reservedDesignIds.delete(job.designId.toLowerCase());
      }
    }
  }

  /**
   * Evaluates the recovery policy based on (source, status).
   * Reuses valid existing assets while executing normal decision/review gates.
   */
  private static async executeRecoveryPolicy(task: DesignTaskLog): Promise<{ success: boolean; pausedAtCheckpoint?: string; error?: string }> {
    const taskId = task.id;
    const isUpdate = task.source === 'UPDATE' || (task.id && task.id.endsWith('-U'));
    const cleanId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');

    console.log(`[TaskRecovery] 🧭 Policy dispatch for ${taskId} (isUpdate: ${isUpdate}, status: ${task.status})...`);

    // ==========================================
    // 1. UPDATE PIPELINE RECOVERY
    // ==========================================
    if (isUpdate) {
      switch (task.status) {
        case 'UPDATE_EXTRACTED':
          return await UpdatePipelineService.runFromStep(taskId, 'U2', 'RECOVERY');

        case 'UPDATE_DOWNLOADING_ARTWORK': {
          const mbaPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
          const rawPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
          const existingPath = (task.localMbaPngPath && AssetValidationService.isValidPngImage(task.localMbaPngPath, 50000))
            ? task.localMbaPngPath
            : AssetValidationService.isValidPngImage(mbaPath, 50000)
              ? mbaPath
              : AssetValidationService.isValidPngImage(rawPath, 50000)
                ? rawPath
                : null;

          if (existingPath) {
            TaskLogService.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'RECOVERY_ASSET_REUSED',
              title: 'Master Artwork wiederverwendet',
              content: { path: existingPath }
            });
            return await UpdatePipelineService.runFromStep(taskId, 'U3', 'RECOVERY');
          }
          return await UpdatePipelineService.runFromStep(taskId, 'U2', 'RECOVERY');
        }

        case 'UPDATE_ARTWORK_READY':
          return await UpdatePipelineService.runFromStep(taskId, 'U3', 'RECOVERY');

        case 'ANALYZING_DESIGN':
        case 'UPDATE_ANALYZED': {
          // Check if analysisResult is already persisted
          if (task.analysisResult) {
            TaskLogService.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'RECOVERY_ASSET_REUSED',
              title: 'Analyse-Ergebnis wiederverwendet ➔ Post-Analysis Gate ausführen',
              content: { analysisResult: task.analysisResult }
            });

            // Post-Analysis Decision Gate: Must NOT skip review!
            const settings = loadSettings();
            const autonomyUpdate = settings.aiAutonomyUpdateEnabled ?? settings.aiAutonomyEnabled;
            const isDefective = task.analysisResult?.design_quality?.quality_verdict === 'DEFECTIVE' || task.analysisResult?.overall_verdict === 'REJECTED';
            const hasRejection = Boolean(task.payload?.hasRejection);

            if (!autonomyUpdate || isDefective || hasRejection) {
              let pauseReason = 'Manuelle Freigabe nach Vision Analyse erforderlich';
              if (isDefective) {
                pauseReason = `Design-Qualität mangelhaft (${task.analysisResult?.design_quality?.quality_issues || 'Defekt'})`;
              } else if (hasRejection) {
                pauseReason = 'Amazon Rejection erkannt – Manuelle Überprüfung empfohlen';
              }

              TaskLogService.updateTaskStatus(taskId, {
                status: 'AWAITING_DESIGN_REVIEW',
                checkpoint: 'DESIGN_REVIEW',
                hasError: isDefective || hasRejection,
                errorDetails: (isDefective || hasRejection) ? pauseReason : undefined
              });
              return { success: true, pausedAtCheckpoint: 'DESIGN_REVIEW' };
            }

            // If autonomy allows and no defects: proceed to U4
            return await UpdatePipelineService.runFromStep(taskId, 'U4', 'RECOVERY');
          }

          // If analysisResult was not yet completed: retry U3
          return await UpdatePipelineService.runFromStep(taskId, 'U3', 'RECOVERY');
        }

        case 'GENERATING_LISTING':
        case 'UPDATE_REWRITING':
        case 'UPDATE_REWRITTEN': {
          if (task.listingResult?.en?.title && task.listingResult?.en?.brand) {
            TaskLogService.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'RECOVERY_ASSET_REUSED',
              title: 'Rewritten Listing wiederverwendet',
              content: { listing: task.listingResult.en }
            });
            return await UpdatePipelineService.runFromStep(taskId, 'U5', 'RECOVERY');
          }
          return await UpdatePipelineService.runFromStep(taskId, 'U4', 'RECOVERY');
        }

        case 'CHECKING_TRADEMARKS':
        case 'UPDATE_TM_CHECKED': {
          // If TM state exists or TM already checked:
          if (task.status === 'UPDATE_TM_CHECKED') {
            const settings = loadSettings();
            const translationEnabled = settings.translationUpdateEnabled !== false;
            return await UpdatePipelineService.runFromStep(taskId, translationEnabled ? 'U6' : 'U7', 'RECOVERY');
          }

          // Resume TM check with preserved trademarkWorkflowState
          return await UpdatePipelineService.runFromStep(taskId, 'U5', 'RECOVERY');
        }

        case 'TRANSLATING_LISTING':
        case 'UPDATE_TRANSLATED': {
          if (task.listingResult?.de && task.listingResult?.fr && task.listingResult?.es && task.listingResult?.it && task.listingResult?.ja) {
            TaskLogService.addEvent(taskId, {
              timestamp: new Date().toISOString(),
              type: 'RECOVERY_ASSET_REUSED',
              title: 'Übersetzungen wiederverwendet',
              content: { languages: ['de', 'fr', 'es', 'it', 'ja'] }
            });
            return await UpdatePipelineService.runFromStep(taskId, 'U7', 'RECOVERY');
          }
          return await UpdatePipelineService.runFromStep(taskId, 'U6', 'RECOVERY');
        }

        default:
          console.warn(`[TaskRecovery] No automated recovery policy for UPDATE task in status: ${task.status}.`);
          return { success: false, error: `Unsupported UPDATE status: ${task.status}` };
      }
    }

    // ==========================================
    // 2. DESIGN PIPELINE RECOVERY
    // ==========================================
    switch (task.status) {
      case 'RECEIVED':
      case 'PROCESSING':
        return await DesignPipelineService.runFromStep(taskId, 'D1', 'RECOVERY');

      case 'PROMPT_READY':
        return await DesignPipelineService.runFromStep(taskId, 'D3', 'RECOVERY');

      case 'GENERATING_IMAGE': {
        const rawPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
        const targetPng = (task.localImagePath && AssetValidationService.isValidPngImage(task.localImagePath, 10000))
          ? task.localImagePath
          : (task.localMbaPngPath && AssetValidationService.isValidPngImage(task.localMbaPngPath, 10000))
            ? task.localMbaPngPath
            : AssetValidationService.isValidPngImage(rawPath, 10000)
              ? rawPath
              : null;

        if (targetPng) {
          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'RECOVERY_ASSET_REUSED',
            title: 'Vorhandenes Design-Bild wiederverwendet',
            content: { path: targetPng }
          });
          return await DesignPipelineService.runFromStep(taskId, 'D4', 'RECOVERY');
        }
        return await DesignPipelineService.runFromStep(taskId, 'D3', 'RECOVERY');
      }

      case 'ANALYZING_DESIGN': {
        if (task.analysisResult) {
          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'RECOVERY_ASSET_REUSED',
            title: 'Analyse-Ergebnis wiederverwendet ➔ Post-Analysis Gate ausführen',
            content: { analysisResult: task.analysisResult }
          });

          // Post-Analysis Gate: If defective, pause at AWAITING_DESIGN_REVIEW!
          const isDefective = task.analysisResult?.design_quality?.quality_verdict === 'DEFECTIVE' || task.analysisResult?.overall_verdict === 'REJECTED';
          if (isDefective) {
            const reason = task.analysisResult?.design_quality?.quality_issues || 'Defective design quality detected';
            TaskLogService.updateTaskStatus(taskId, {
              status: 'AWAITING_DESIGN_REVIEW',
              checkpoint: 'DESIGN_REVIEW',
              hasError: true,
              errorDetails: reason
            });
            return { success: true, pausedAtCheckpoint: 'DESIGN_REVIEW' };
          }

          return await DesignPipelineService.runFromStep(taskId, 'D5', 'RECOVERY');
        }
        return await DesignPipelineService.runFromStep(taskId, 'D4', 'RECOVERY');
      }

      case 'GENERATING_LISTING': {
        if (task.listingResult?.en?.title && task.listingResult?.en?.brand) {
          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'RECOVERY_ASSET_REUSED',
            title: 'Generiertes Listing wiederverwendet',
            content: { listing: task.listingResult.en }
          });
          return await DesignPipelineService.runFromStep(taskId, 'D6', 'RECOVERY');
        }
        return await DesignPipelineService.runFromStep(taskId, 'D5', 'RECOVERY');
      }

      case 'CHECKING_TRADEMARKS': {
        // Step D6 uses preserved trademarkWorkflowState automatically if present
        return await DesignPipelineService.runFromStep(taskId, 'D6', 'RECOVERY');
      }

      case 'FINALIZING': {
        return await TaskLogService.completeTaskAndEnqueue(taskId);
      }

      case 'VECTORIZING_DESIGN': {
        const svgPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.svg`);
        const targetSvg = (task.localSvgPath && AssetValidationService.isValidSvgFile(task.localSvgPath, 20))
          ? task.localSvgPath
          : AssetValidationService.isValidSvgFile(svgPath, 20)
            ? svgPath
            : null;

        if (targetSvg) {
          TaskLogService.addEvent(taskId, {
            timestamp: new Date().toISOString(),
            type: 'RECOVERY_ASSET_REUSED',
            title: 'SVG-Vektordatei wiederverwendet ➔ Post-Vectorization Audit ausführen',
            content: { path: targetSvg }
          });

          // Execute normal Cutout / SVG Audit (Rule 3)
          try {
            const svgContent = fs.readFileSync(targetSvg, 'utf-8');
            const fourPanelFilename = `${cleanId}_4panel.png`;
            const fourPanelFilePath = path.resolve(process.cwd(), 'data', 'designs', fourPanelFilename);
            const fourPanelBuffer = await SvgRenderService.render4PanelTestImage(svgContent);
            fs.writeFileSync(fourPanelFilePath, fourPanelBuffer);

            const auditRes = await LLMService.auditSvgCutout(fourPanelFilePath, task.payload?.quote);

            if (auditRes.cutout_verdict === 'REJECTED') {
              console.log(`[TaskRecovery] ⏸️ SVG Audit verlangt manuelle Überprüfung für Task ${taskId}. Pausiere bei AWAITING_SVG_REVIEW.`);
              TaskLogService.updateTaskStatus(taskId, {
                status: 'AWAITING_SVG_REVIEW',
                checkpoint: 'SVG_REVIEW',
                hasError: true,
                errorDetails: auditRes.explanation || auditRes.detected_issues?.join(', ') || 'Cutout audit requires human review'
              });
              return { success: true, pausedAtCheckpoint: 'SVG_REVIEW' };
            }

            // Render MBA PNG if missing
            const mbaFilename = `${cleanId}_mba.png`;
            const mbaFilePath = path.resolve(process.cwd(), 'data', 'designs', mbaFilename);
            if (!AssetValidationService.isValidPngImage(mbaFilePath, 50000)) {
              const mbaBuffer = await SvgRenderService.renderSvgToMbaPng(svgContent);
              fs.writeFileSync(mbaFilePath, mbaBuffer);
              TaskLogService.updateTaskStatus(taskId, { localMbaPngPath: mbaFilePath });
            }

            // If audit passes: proceed to finalization and enqueue
            return await DesignPipelineService.stepD8_Enqueue(taskId);
          } catch (err: any) {
            console.warn(`[TaskRecovery] Cutout-Audit für wiederverwendetes SVG fehlgeschlagen:`, err.message);
          }
        }

        // If SVG missing or invalid: run D7 from start
        return await DesignPipelineService.runFromStep(taskId, 'D7', 'RECOVERY');
      }

      default:
        console.warn(`[TaskRecovery] No automated recovery policy for DESIGN task in status: ${task.status}.`);
        return { success: false, error: `Unsupported DESIGN status: ${task.status}` };
    }
  }
}

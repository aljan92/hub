import { QueueService, QueueItem } from './queueService';
import { TaskRepository } from '../storage/taskRepository';
import { TaskLogService } from './taskLogService';
import { TaskStatus } from '../../types/tasks';

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
  details: string[];
}

export class TaskRecoveryService {
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
      details: []
    };

    console.log('[TaskRecovery] 🛡️ Starting Phase P3.1 Crash Recovery & Storage Reconciliation...');

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

    // 3. Reconcile Upload Queue Items in 'UPLOADING' state
    for (const item of queueItems) {
      if (item.status === 'UPLOADING') {
        const recovery = item.uploadRecovery;

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

          } else if (recovery.phase === 'REMOTE_ACTION_INTENT' || recovery.phase === 'AWAITING_AMAZON_CONFIRMATION') {
            // UNSAFE / UNKNOWN REMOTE STATE: Remote submission may have reached Amazon!
            item.status = 'ERROR';
            item.errorMessage = 'Upload wurde während oder nach dem Remote-Submit-Intent unterbrochen. Human Review erforderlich.';
            item.uploadRecovery = {
              ...recovery,
              recoveryReason: `Interrupted during/after ${recovery.phase}. Automated retry blocked to prevent duplicate submission.`
            };
            hasQueueChanges = true;
            report.unsafeUploadsEscalated++;
            report.details.push(`Escalated unsafe item ${item.id} (${item.title || item.designTitle}) in phase ${recovery.phase} to Human Review`);
            console.warn(`[TaskRecovery] ⚠️ Unsafe Remote Intent: Item ${item.id} was in ${recovery.phase}. Escalating to Human Review.`);

            // Escalate associated SQLite Task
            if (item.taskId) {
              const task = TaskRepository.getTaskById(item.taskId);
              if (task) {
                TaskLogService.updateTaskStatus(task.id, {
                  status: 'AWAITING_RECOVERY_REVIEW',
                  checkpoint: 'RECOVERY_REVIEW',
                  hasError: true,
                  errorDetails: 'Upload wurde nach dem Absenden des Remote-Intents an Amazon unterbrochen. Bitte in Amazon Manage prüfen, ob das Produkt veröffentlicht wurde, bevor erneut hochgeladen wird.'
                });
              }
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
          // Case: Queue item exists, but task.inQueue is false
          if (!task.inQueue) {
            const targetStatus = task.status === 'COMPLETED' || task.status === 'UPDATE_QUEUED'
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
          // Case: Orphan queue item without SQLite task
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
    // In P3.1: Only detect and warn if task is in an active review/pipeline state
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

    // 6. Scan Zombie Tasks in SQLite (DETECTION ONLY for P3.1 - no auto-resume yet)
    const zombieStatuses: TaskStatus[] = [
      'PROCESSING',
      'GENERATING_IMAGE',
      'ANALYZING_DESIGN',
      'GENERATING_LISTING',
      'CHECKING_TRADEMARKS',
      'TRANSLATING_LISTING',
      'VECTORIZING_DESIGN',
      'UPDATE_DOWNLOADING_ARTWORK'
    ];

    const detectedZombies = TaskRepository.getTasksByStatuses(zombieStatuses);
    report.detectedZombieTasks = detectedZombies.length;
    if (detectedZombies.length > 0) {
      console.log(`[TaskRecovery] 🧟 Detected ${detectedZombies.length} in-flight zombie tasks (Detection only in P3.1; auto-resume follows in P3.2).`);
    }

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

    console.log(`[TaskRecovery] ✅ Phase P3.1 Recovery complete. (${report.preRemoteUploadsReset} resets, ${report.unsafeUploadsEscalated} escalations, ${report.confirmedUploadsCompleted} confirmed).`);
    return report;
  }
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { TaskRepository } from '../storage/taskRepository';
import { TaskExecutionLock } from './taskExecutionLock';
import { measureJob } from './operationalMetrics';

export interface PipelineExecutionSnapshot {
  activeTaskId: string | null;
  waitingTaskIds: string[];
}

/** Process-wide FIFO gate for all resource-intensive task pipelines. */
export class PipelineExecutionCoordinator {
  private static activeTaskId: string | null = null;
  private static waiters: Array<{ taskId: string; resolve: (granted: boolean) => void }> = [];
  private static context = new AsyncLocalStorage<{ taskId: string; active: boolean }>();

  public static getSnapshot(): PipelineExecutionSnapshot {
    return {
      activeTaskId: this.activeTaskId,
      waitingTaskIds: this.waiters.map(waiter => waiter.taskId)
    };
  }

  public static cancelWaiting(taskId: string): void {
    const index = this.waiters.findIndex(waiter => waiter.taskId === taskId);
    if (index >= 0) this.waiters.splice(index, 1)[0].resolve(false);
  }

  public static async runExclusive<T>(
    taskId: string,
    work: () => Promise<T>,
    onWaiting?: () => void | Promise<void>
  ): Promise<T> {
    const cleanTaskId = String(taskId || '').trim() || 'unknown-task';
    // Nested pipeline continuations in the same async execution already own the slot.
    if (this.context.getStore()?.active) return work();

    if (this.activeTaskId !== null) {
      await onWaiting?.();
      const granted = await new Promise<boolean>(resolve => this.waiters.push({ taskId: cleanTaskId, resolve }));
      if (!granted) {
        let cancelled = false;
        try { cancelled = TaskRepository.getTaskById(cleanTaskId)?.status === 'CANCELLED'; } catch { /* test reset */ }
        return { success: false, cancelled, paused: !cancelled, error: 'Task left the waiting queue.' } as unknown as T;
      }
    } else {
      this.activeTaskId = cleanTaskId;
    }

    const executionContext = { taskId: cleanTaskId, active: true };
    try {
      try {
        const existingTask = TaskRepository.getTaskById(cleanTaskId);
        if (existingTask && (existingTask.status === 'CANCELLED' || existingTask.status === 'PAUSED')) {
          console.log(`[PipelineExecutionCoordinator] 🛑 Task ${cleanTaskId} wurde vor Slot-Zuteilung abgebrochen. Überspringe Ausführung.`);
          return { success: false, cancelled: true, error: 'Task was cancelled while waiting for execution slot.' } as unknown as T;
        }
      } catch {
        // In tests or if TaskRepository is not yet initialized, proceed normally
      }

      return await measureJob('pipeline', cleanTaskId, () => TaskExecutionLock.runWithExecution(() => this.context.run(executionContext, work)));
    } finally {
      executionContext.active = false;
      const next = this.waiters.shift();
      if (next) {
        this.activeTaskId = next.taskId;
        next.resolve(true);
      } else {
        this.activeTaskId = null;
      }
    }
  }

  /** Test-only reset; production code must let active work release normally. */
  public static resetForTests(): void {
    this.activeTaskId = null;
    this.waiters.splice(0).forEach(waiter => waiter.resolve(false));
  }
}

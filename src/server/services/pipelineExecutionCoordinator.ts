import { AsyncLocalStorage } from 'node:async_hooks';

export interface PipelineExecutionSnapshot {
  activeTaskId: string | null;
  waitingTaskIds: string[];
}

/** Process-wide FIFO gate for all resource-intensive task pipelines. */
export class PipelineExecutionCoordinator {
  private static activeTaskId: string | null = null;
  private static waiters: Array<{ taskId: string; resolve: () => void }> = [];
  private static context = new AsyncLocalStorage<{ taskId: string }>();

  public static getSnapshot(): PipelineExecutionSnapshot {
    return {
      activeTaskId: this.activeTaskId,
      waitingTaskIds: this.waiters.map(waiter => waiter.taskId)
    };
  }

  public static async runExclusive<T>(
    taskId: string,
    work: () => Promise<T>,
    onWaiting?: () => void | Promise<void>
  ): Promise<T> {
    const cleanTaskId = String(taskId || '').trim() || 'unknown-task';
    // Nested pipeline continuations in the same async execution already own the slot.
    if (this.context.getStore()) return work();

    if (this.activeTaskId !== null) {
      await onWaiting?.();
      await new Promise<void>(resolve => this.waiters.push({ taskId: cleanTaskId, resolve }));
    } else {
      this.activeTaskId = cleanTaskId;
    }

    try {
      return await this.context.run({ taskId: cleanTaskId }, work);
    } finally {
      const next = this.waiters.shift();
      if (next) {
        this.activeTaskId = next.taskId;
        next.resolve();
      } else {
        this.activeTaskId = null;
      }
    }
  }

  /** Test-only reset; production code must let active work release normally. */
  public static resetForTests(): void {
    this.activeTaskId = null;
    this.waiters.splice(0).forEach(waiter => waiter.resolve());
  }
}

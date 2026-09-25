import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Process-local guard. Reentrancy belongs to one execution, not to an owner label. */
export type LockOwner = 'NORMAL' | 'RECOVERY' | 'USER_ACTION';

export class TaskExecutionLock {
  private static activeLocks = new Map<string, { owner: LockOwner; token: string; depth: number; acquiredAt: string }>();
  private static execution = new AsyncLocalStorage<{ token: string }>();

  /** Nested asynchronous calls inherit the token of their concrete execution. */
  public static runWithExecution<T>(work: () => T): T {
    if (this.execution.getStore()) return work();
    return this.execution.run({ token: randomUUID() }, work);
  }

  /**
   * Attempts to acquire execution lock for a given taskId.
   * Re-entrant only inside the same asynchronous execution and owner.
   * Calls outside runWithExecution are independent, even if their owner labels match.
   */
  public static acquire(taskId: string, owner: LockOwner): boolean {
    const cleanId = taskId.trim();
    const existing = this.activeLocks.get(cleanId);
    const token = this.execution.getStore()?.token || randomUUID();
    if (existing) {
      if (existing.owner === owner && existing.token === token) {
        existing.depth++;
        return true;
      }
      return false;
    }
    this.activeLocks.set(cleanId, { owner, token, depth: 1, acquiredAt: new Date().toISOString() });
    return true;
  }

  /**
   * Releases execution lock for a given taskId.
   * Decrements depth and removes lock when depth reaches 0.
   */
  public static release(taskId: string): void {
    const cleanId = taskId.trim();
    const existing = this.activeLocks.get(cleanId);
    if (existing) {
      existing.depth--;
      if (existing.depth <= 0) {
        this.activeLocks.delete(cleanId);
      }
    }
  }

  /**
   * Checks whether a task is currently executing.
   */
  public static isLocked(taskId: string): boolean {
    return this.activeLocks.has(taskId.trim());
  }

  /**
   * Returns current lock owner info if locked.
   */
  public static getLockInfo(taskId: string): { owner: LockOwner; acquiredAt: string } | undefined {
    const existing = this.activeLocks.get(taskId.trim());
    return existing ? { owner: existing.owner, acquiredAt: existing.acquiredAt } : undefined;
  }

  /**
   * Clears all locks (used in tests or system resets).
   */
  public static clear(): void {
    this.activeLocks.clear();
  }
}

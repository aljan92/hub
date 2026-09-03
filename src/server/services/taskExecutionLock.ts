/**
 * Unified Process-Wide Task Execution Guard.
 * Ensures that a task is never executed concurrently by Recovery, normal pipeline triggers, or user actions.
 * Supports re-entrant acquisition by the same owner.
 */
export type LockOwner = 'NORMAL' | 'RECOVERY' | 'USER_ACTION';

export class TaskExecutionLock {
  private static activeLocks = new Map<string, { owner: LockOwner; depth: number; acquiredAt: string }>();

  /**
   * Attempts to acquire execution lock for a given taskId.
   * Re-entrant: If already acquired by the same owner, increments depth and returns true.
   * Returns false if task is already running under a DIFFERENT owner.
   */
  public static acquire(taskId: string, owner: LockOwner): boolean {
    const cleanId = taskId.trim();
    const existing = this.activeLocks.get(cleanId);
    if (existing) {
      if (existing.owner === owner) {
        existing.depth++;
        return true;
      }
      return false;
    }
    this.activeLocks.set(cleanId, { owner, depth: 1, acquiredAt: new Date().toISOString() });
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

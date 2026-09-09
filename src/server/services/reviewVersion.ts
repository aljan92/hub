import { createHash } from 'node:crypto';
import { DesignTaskLog } from '../../types/tasks';

/** Exclude operational metadata: log traffic must not invalidate manual edits.
 * All other persisted properties are conservatively review-relevant, including
 * future domain fields. Repository writes rotate a nonce when this digest changes.
 */
export function reviewFingerprint(task: DesignTaskLog): string {
  const { events, eventsCount, updatedAt, reviewVersion, trademarkWorkflowState, ...domain } = task;
  return createHash('sha256').update(JSON.stringify(domain)).digest('hex');
}
export function reviewVersion(task: DesignTaskLog): string {
  return task.reviewVersion || `legacy:${reviewFingerprint(task)}`;
}
export class ReviewConflict extends Error {
  constructor() { super('Review ist veraltet oder gehört zu einer anderen Task. Bitte aktuellen Review neu laden.'); }
}

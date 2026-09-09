import { TaskRepository } from '../storage/taskRepository';
import { TaskExecutionLock } from './taskExecutionLock';
import { ReviewConflict } from './reviewVersion';

const active = new Set<string>();
export const hasActiveReviewAction = (taskId: string) => active.has(taskId);
const allowed: Record<string, string[]> = {
  'submit-design-review': ['AWAITING_DESIGN_REVIEW', 'UPDATE_ANALYZED'],
  'submit-tm-review': ['AWAITING_TM_REVIEW'],
  'override-preflight': ['AWAITING_PRE_FLIGHT_REVIEW'],
  'submit-svg-review': ['AWAITING_SVG_REVIEW'],
  'reset-svg': ['AWAITING_SVG_REVIEW']
};
/** Synchronous claim before awaiting. Mutations consume the token durably;
 * read-only TM rechecks validate it and hold the same in-flight guard. */
export function claimReviewAction(taskId: string, action: string, context: unknown, operation?: string): () => void {
  const value = context as { taskId?: unknown; version?: unknown } | undefined;
  if (!value || value.taskId !== taskId || typeof value.version !== 'string' || !value.version || active.has(taskId) || TaskExecutionLock.isLocked(taskId)) throw new ReviewConflict();
  const task = TaskRepository.getTaskById(taskId);
  const checkpoints: Record<string, string> = { AWAITING_DESIGN_REVIEW: 'DESIGN_REVIEW', UPDATE_ANALYZED: 'UPDATE_REVIEW', AWAITING_TM_REVIEW: 'TM_REVIEW', AWAITING_PRE_FLIGHT_REVIEW: 'PRE_FLIGHT', AWAITING_SVG_REVIEW: 'SVG_REVIEW' };
  if (!task || !allowed[action]?.includes(task.status) || task.checkpoint !== checkpoints[task.status]) throw new ReviewConflict();
  if (!TaskRepository.updateTask(taskId, {}, value.version, !(action === 'submit-tm-review' && operation === 'RECHECK'))) throw new ReviewConflict();
  active.add(taskId);
  return () => { active.delete(taskId); };
}

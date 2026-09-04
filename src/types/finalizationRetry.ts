/** Shared UI/server eligibility. Execution locks and queue/remote guards are server-only. */
type RetryTask = {
  status: string;
  checkpoint?: string;
  hasError?: boolean;
  events?: Array<{ type: string; content?: any }>;
};

export function hasFailedFinalization(task: RetryTask): boolean {
  const latest = [...(task.events || [])].reverse().find(event => String(event.type) === 'FINALIZATION_EVENT');
  return latest?.content?.status === 'FAILED';
}

export function canRepeatFinalization(task: RetryTask): boolean {
  if (task.checkpoint || task.status.startsWith('AWAITING_')) return false;
  if (['COMPLETED', 'UPDATE_QUEUED', 'ERROR'].includes(task.status)) return true;
  // Older failures kept the preceding U7 status rather than setting ERROR.
  return task.status === 'UPDATE_TRANSLATED' && Boolean(task.hasError) && hasFailedFinalization(task);
}

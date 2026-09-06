export type QueueTodayMode = 'draft' | 'live' | 'hybrid';

export interface QueueTodayUpdateItem {
  status: string;
  isPaused?: boolean;
  allocatedSlots?: number;
  totalBaseSlots?: number;
}

/** Uses the server optimizer's persisted allocation; it never recalculates capacity in the UI. */
export function isUpdateScheduledToday(item: QueueTodayUpdateItem, mode: QueueTodayMode): boolean {
  if (mode === 'draft' || item.isPaused) return false;
  if (item.status === 'UPLOADING') return true;
  return item.status === 'WAITING'
    && ((item.allocatedSlots ?? 0) > 0 || item.totalBaseSlots === 0);
}

import { loadSettings } from './settingsService';
import { UploadWorkerService } from './uploadWorkerService';

const SCHEDULE_PATTERN = /^(?:[01]\d|2[0-3]):(?:[0-5]\d)$/;

export function isUploadScheduleMinute(schedule: string, now = new Date()): boolean {
  if (!SCHEDULE_PATTERN.test(schedule)) return false;
  const [hour, minute] = schedule.split(':').map(Number);
  return now.getHours() === hour && now.getMinutes() === minute;
}

/**
 * Triggers exactly during the configured local minute and then drains the queue.
 */
export class UploadScheduleService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static startRequestRunning = false;
  private static activeTriggerKey: string | null = null;
  private static lastTriggerKey: string | null = null;

  public static startScheduler(): void {
    if (this.intervalId) return;
    const tick = () => void this.runTick();
    tick();
    this.intervalId = setInterval(tick, 5000);
    console.log('[UploadSchedule] Daily upload scheduler started.');
  }

  public static stopScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  public static async runTick(now = new Date()): Promise<void> {
    const settings = loadSettings();
    if (!settings.queueUploadScheduleEnabled) {
      this.activeTriggerKey = null;
      return;
    }

    const schedule = settings.queueUploadScheduleTime || '04:00';
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const triggerKey = `${localDate}|${schedule}`;

    if (isUploadScheduleMinute(schedule, now) && this.lastTriggerKey !== triggerKey) {
      this.lastTriggerKey = triggerKey;
      this.activeTriggerKey = triggerKey;
      console.log(`[UploadSchedule] Trigger reached exactly at ${schedule}. Queue automation activated.`);
    }

    if (this.activeTriggerKey !== triggerKey) return;
    if (this.startRequestRunning || UploadWorkerService.getStatus().isUploading) return;

    this.startRequestRunning = true;
    try {
      const result = await UploadWorkerService.startUpload(undefined, settings.queueUploadMode || 'draft', false);
      if (result.success) {
        console.log(`[UploadSchedule] ${result.message}`);
      } else if (result.message.includes('Kein bereitstehendes Design')) {
        this.activeTriggerKey = null;
        console.log('[UploadSchedule] Scheduled queue run completed; no further ready designs.');
      }
    } catch (error: any) {
      console.error('[UploadSchedule] Automatic upload start failed:', error?.message || error);
    } finally {
      this.startRequestRunning = false;
    }
  }
}

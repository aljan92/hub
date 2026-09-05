import { loadSettings } from './settingsService';
import { UploadWorkerService } from './uploadWorkerService';

const SCHEDULE_PATTERN = /^(?:[01]\d|2[0-3]):(?:[0-5]\d)$/;

export function hasUploadScheduleStarted(schedule: string, now = new Date()): boolean {
  if (!SCHEDULE_PATTERN.test(schedule)) return false;
  const [hour, minute] = schedule.split(':').map(Number);
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
}

/**
 * Starts and drains the queue every day from the configured local time.
 * Polling makes this resilient to server restarts and missed timer ticks.
 */
export class UploadScheduleService {
  private static intervalId: NodeJS.Timeout | null = null;
  private static startRequestRunning = false;

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
    if (this.startRequestRunning || UploadWorkerService.getStatus().isUploading) return;

    const settings = loadSettings();
    const schedule = settings.queueUploadScheduleTime || 'off';
    if (schedule === 'off' || !hasUploadScheduleStarted(schedule, now)) return;

    this.startRequestRunning = true;
    try {
      const result = await UploadWorkerService.startUpload(undefined, settings.queueUploadMode || 'draft', false);
      if (result.success) console.log(`[UploadSchedule] ${result.message}`);
    } catch (error: any) {
      console.error('[UploadSchedule] Automatic upload start failed:', error?.message || error);
    } finally {
      this.startRequestRunning = false;
    }
  }
}

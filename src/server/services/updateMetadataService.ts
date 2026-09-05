import { createClient } from '@supabase/supabase-js';
import { loadSettings } from './settingsService';
import { QueueItem, QueueService } from './queueService';

type SupabaseClientLike = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): {
        select(columns: string): {
          maybeSingle(): Promise<{ data: any; error: any }>;
        };
      };
    };
  };
};

export function normalizeAmazonDesignId(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/^#/, '').replace(/-U$/, '').trim()
    : '';
}

export function isUpdateQueueItem(item: Pick<QueueItem, 'type' | 'source' | 'taskId'>): boolean {
  return item.type === 'update'
    || String(item.type || '').toUpperCase() === 'UPDATE'
    || String(item.source || '').toUpperCase() === 'UPDATE'
    || String(item.taskId || '').endsWith('-U');
}

export async function writeSuccessfulUpdateMetadata(
  supabase: SupabaseClientLike,
  designId: string,
  confirmedAt: string
): Promise<void> {
  const normalizedId = normalizeAmazonDesignId(designId);
  if (!normalizedId) throw new Error('Keine gültige Amazon Design-ID für Supabase-Metadaten vorhanden.');
  if (!Number.isFinite(Date.parse(confirmedAt))) throw new Error('Ungültiger Amazon-Bestätigungszeitpunkt.');

  const { data, error } = await supabase
    .from('mba_designs')
    .update({
      mba_hub_updated_at: confirmedAt,
      skip_update: false
    })
    .eq('design_id', normalizedId)
    .select('design_id')
    .maybeSingle();

  if (error) throw new Error(`Supabase-Update-Metadaten fehlgeschlagen: ${error.message || String(error)}`);
  if (!data?.design_id) throw new Error(`Supabase-Datensatz für Design ${normalizedId} nicht gefunden.`);
}

export class UpdateMetadataService {
  private static readonly RETRY_INTERVAL_MS = 5 * 60 * 1000;
  private static readonly REQUEST_TIMEOUT_MS = 15_000;

  public static async markSuccessfulUpdate(designId: string, confirmedAt: string): Promise<{ success: boolean; error?: string }> {
    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      return { success: false, error: 'Supabase URL oder Service Role Key fehlt.' };
    }

    try {
      const supabase = createClient(settings.supabaseUrl.trim(), settings.supabaseServiceRoleKey.trim(), {
        auth: { persistSession: false, autoRefreshToken: false }
      }) as unknown as SupabaseClientLike;
      let timeoutId: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          writeSuccessfulUpdateMetadata(supabase, designId, confirmedAt),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Supabase-Metadaten Timeout nach 15 Sekunden.')), this.REQUEST_TIMEOUT_MS);
          })
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Unbekannter Supabase-Metadatenfehler.' };
    }
  }

  /**
   * Retry only the metadata write for Amazon-confirmed update uploads.
   * This never starts or repeats an Amazon action.
   */
  public static async retryPendingConfirmedUpdates(): Promise<{ attempted: number; succeeded: number }> {
    const now = Date.now();
    const items = QueueService.loadQueue().filter(item =>
      isUpdateQueueItem(item)
      && item.uploadRecovery?.phase === 'AMAZON_CONFIRMED'
      && item.uploadRecovery?.hubMetadataSync?.status !== 'SUCCESS'
      && (
        !item.uploadRecovery?.hubMetadataSync?.attemptedAt
        || !Number.isFinite(Date.parse(item.uploadRecovery.hubMetadataSync.attemptedAt))
        || now - Date.parse(item.uploadRecovery.hubMetadataSync.attemptedAt) >= this.RETRY_INTERVAL_MS
      )
    );

    let succeeded = 0;
    for (const item of items) {
      const designId = normalizeAmazonDesignId(item.designId || item.uploadRecovery?.amazonDesignId);
      const confirmedAt = item.uploadRecovery?.amazonConfirmedAt;
      if (!designId || !confirmedAt) continue;

      const result = await this.markSuccessfulUpdate(designId, confirmedAt);
      QueueService.updateItemUploadRecovery(item.id, {
        hubMetadataSync: result.success
          ? { status: 'SUCCESS', attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
          : { status: 'PENDING', attemptedAt: new Date().toISOString(), error: result.error }
      });
      if (result.success) succeeded += 1;
    }

    return { attempted: items.length, succeeded };
  }
}

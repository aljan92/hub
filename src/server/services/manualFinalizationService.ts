import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { FinalizationService } from './finalizationService';
import { QueueService } from './queueService';
import { TaskLogService } from './taskLogService';
import { TaskExecutionLock } from './taskExecutionLock';
import { getGeneratableVariants } from './productCatalogService';

export class ManualFinalizationService {
  private static running = false;

  public static async repeat(taskId: string) {
    if (this.running || TaskExecutionLock.isLocked(taskId)) throw new Error('Eine Finalisierung oder Task-Verarbeitung läuft bereits.');
    const task = TaskLogService.getTask(taskId);
    if (!task || !['COMPLETED', 'UPDATE_QUEUED', 'ERROR'].includes(task.status)) {
      throw new Error('Task noch in Verarbeitung oder Review; Finalisierung hier nicht wiederholbar.');
    }
    const matches = QueueService.getState().items.filter(item => item.taskId === taskId);
    if (matches.length !== 1) throw new Error('Genau ein vorhandener Queue-Eintrag erforderlich. Es wird kein neuer Eintrag angelegt.');
    const item = structuredClone(matches[0]);
    if (!['WAITING', 'ERROR'].includes(item.status) || item.uploadRecovery?.remoteRequestIntentAt
      || ['REMOTE_ACTION_INTENT', 'REMOTE_REQUEST_INTENT', 'AWAITING_AMAZON_CONFIRMATION', 'AMAZON_CONFIRMED'].includes(item.uploadRecovery?.phase || '')) {
      throw new Error('Upload läuft, wurde abgeschlossen oder ist remote ungeklärt; Wiederholung gesperrt.');
    }
    if (!TaskExecutionLock.acquire(taskId, 'USER_ACTION')) throw new Error('Task ist gesperrt.');
    this.running = true;
    try {
      const result = await FinalizationService.finalizeForQueue({
        ...item,
        taskId,
        pipeline: item.designId || item.source === 'UPDATE' || item.type === 'update' ? 'UPDATE' : 'DESIGN',
        masterPngPath: item.pngPath,
        prepareOnly: true,
        artifactRunId: `${taskId}_rebuild_${randomUUID()}`
      });
      if (!result.success || !result.resizedAssets || !result.preparedListing) throw new Error(result.error || 'Vorbereitung fehlgeschlagen');

      const assets = result.resizedAssets;
      const paths = [assets.trimmedPath, assets.mugStandardPath, assets.mugBrushPath, assets.drinkwareStandardPath, assets.drinkwareBrushPath, ...Object.values(assets.productVariants || {})];
      for (const file of paths) {
        const descriptor = fs.openSync(file!, 'r');
        const header = Buffer.alloc(24);
        try { fs.readSync(descriptor, header, 0, 24, 0); } finally { fs.closeSync(descriptor); }
        if (header.toString('hex', 0, 8) !== '89504e470d0a1a0a' || !header.readUInt32BE(16) || !header.readUInt32BE(20)) {
          throw new Error(`Ungültiges PNG: ${file}`);
        }
        const variant = getGeneratableVariants().find(v => assets.productVariants?.[v.id] === file);
        if (variant?.generator && (header.readUInt32BE(16) !== variant.generator.canvas.width || header.readUInt32BE(20) !== variant.generator.canvas.height)) {
          throw new Error(`Unerwartete Bildmaße: ${variant.id}`);
        }
      }
      if (!TaskLogService.getTask(taskId)) throw new Error('Task wurde während der Vorbereitung entfernt.');
      const current = QueueService.getState().items.find(candidate => candidate.id === item.id);
      const fingerprint = (value: typeof item) => JSON.stringify([value.brand, value.title, value.bullet1, value.bullet2, value.description, value.listings, value.pngPath, value.resizedAssets]);
      if (!current || fingerprint(current) !== fingerprint(item)) throw new Error('Queue-Inhalt wurde inzwischen geändert; keine Übernahme.');
      const root = result.preparedListing.root;
      QueueService.replacePreparedAssets(item.id, {
        brand: root.brand, title: root.title, bullet1: root.bullet1, bullet2: root.bullet2, description: root.description,
        listings: result.preparedListing.listings, resizedAssets: assets
      });
      TaskLogService.updateTaskStatus(taskId, { resizedAssets: assets });
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(), type: 'FINALIZATION_EVENT' as any,
        title: '✓ Listing & Druckdateien erneuert – vorhandener Queue-Eintrag aktualisiert, kein Upload gestartet',
        content: { phase: 'MANUAL_FINALIZATION', status: 'SUCCESS', queueId: item.id }
      });
      return { success: true, message: 'Listing geprüft und Druckdateien neu erzeugt. Queue-Status unverändert; kein Upload gestartet.' };
    } catch (error: any) {
      TaskLogService.addEvent(taskId, {
        timestamp: new Date().toISOString(), type: 'FINALIZATION_EVENT' as any,
        title: '❌ Manuelle Finalisierung fehlgeschlagen', content: { phase: 'MANUAL_FINALIZATION', status: 'FAILED', error: error.message }
      });
      throw error;
    } finally {
      this.running = false;
      TaskExecutionLock.release(taskId);
    }
  }
}

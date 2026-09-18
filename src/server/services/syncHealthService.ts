import fs from 'fs';
import path from 'path';
import { atomicWriteJson, loadJsonWithBackupRecovery, setFileFailSafe } from '../utils/atomicFileStorage';

export type SyncWorkerName =
  | 'quick_products'
  | 'full_products'
  | 'quick_listings'
  | 'full_listings'
  | 'queued_texts'
  | 'snap_resolver'
  | 'ad_asin_audit'
  | 'lifecycle_audit'
  | 'system_audit';

export type SyncWorkerStatus = 'never_run' | 'running' | 'complete' | 'partial' | 'truncated' | 'cancelled' | 'unknown_write_outcome' | 'error' | 'interrupted';

export interface SyncWorkerHealth {
  lastRunId: string | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastStatus: SyncWorkerStatus;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  attempted: number;
  confirmed: number;
  pages: number;
}

export interface AuditLease {
  auditId: string;
  previousAutoSyncEnabled: boolean;
  acquiredAt: string;
  leaseUntil: string;
  status: 'active';
}

export interface SyncHealthData {
  schemaVersion: 1;
  updatedAt: string;
  workers: Partial<Record<SyncWorkerName, SyncWorkerHealth>>;
  queues: {
    productJobs: number;
    textJobs: number;
    resolverRetries: number;
    oldestTextJobAt: string | null;
    oldestResolverRetryAt: string | null;
  };
  scheduler: {
    autoSyncUserEnabled: boolean;
    auditPauseActive: boolean;
    auditPauseLeaseUntil: string | null;
    lastTickAt: string | null;
    lastCatchUpAt: string | null;
  };
  auditLease: AuditLease | null;
  storageWarning: string | null;
}

export interface HealthComponent {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'critical' | 'paused' | 'unknown';
  message: string;
  lastSuccessAt: string | null;
}

const HEALTH_PATH = path.resolve(process.cwd(), 'data', 'sync_health.json');
const EMPTY_WORKER = (): SyncWorkerHealth => ({
  lastRunId: null,
  lastStartedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastStatus: 'never_run',
  lastErrorCode: null,
  lastErrorMessage: null,
  consecutiveFailures: 0,
  attempted: 0,
  confirmed: 0,
  pages: 0
});

function defaultHealth(): SyncHealthData {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    workers: {},
    queues: { productJobs: 0, textJobs: 0, resolverRetries: 0, oldestTextJobAt: null, oldestResolverRetryAt: null },
    scheduler: { autoSyncUserEnabled: true, auditPauseActive: false, auditPauseLeaseUntil: null, lastTickAt: null, lastCatchUpAt: null },
    auditLease: null,
    storageWarning: null
  };
}

function safeMessage(message: unknown): string | null {
  if (!message) return null;
  return String(message)
    .replace(/(authorization|cookie)(\s*[:=]\s*)([^\n,;]+)/gi, '$1$2[REDACTED]')
    .replace(/(apikey|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/(token)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .slice(0, 500);
}

function errorCode(message: unknown): string | null {
  const text = String(message || '').toLowerCase();
  if (!text) return null;
  if (text.includes('auth') || text.includes('login') || text.includes('session')) return 'AUTH';
  if (text.includes('timeout')) return 'TIMEOUT';
  if (text.includes('supabase')) return 'SUPABASE';
  if (text.includes('amazon')) return 'AMAZON';
  if (text.includes('unknown') && text.includes('write')) return 'UNKNOWN_WRITE_OUTCOME';
  return 'WORKER_ERROR';
}

export class SyncHealthService {
  private static data: SyncHealthData | null = null;

  private static load(): SyncHealthData {
    if (this.data) return this.data;
    const loaded = loadJsonWithBackupRecovery<SyncHealthData>(HEALTH_PATH, {
      defaultValue: defaultHealth(),
      validate: value => value?.schemaVersion === 1 && value?.workers && value?.scheduler && value?.queues
    });
    if (!loaded.success) {
      this.data = { ...defaultHealth(), storageWarning: loaded.error || 'Health-Datei ist beschädigt.' };
      try {
        if (fs.existsSync(HEALTH_PATH)) fs.renameSync(HEALTH_PATH, `${HEALTH_PATH}.corrupt.${Date.now()}`);
        if (fs.existsSync(`${HEALTH_PATH}.bak`)) fs.renameSync(`${HEALTH_PATH}.bak`, `${HEALTH_PATH}.bak.corrupt.${Date.now()}`);
        setFileFailSafe(HEALTH_PATH, false);
        atomicWriteJson(HEALTH_PATH, this.data, { backup: false, space: 2 });
      } catch { /* Health telemetry must never prevent the productive scheduler from starting. */ }
      return this.data;
    }
    this.data = loaded.data;
    if (loaded.recoveredFromBackup) this.data.storageWarning = 'Health-Datei wurde aus dem Backup wiederhergestellt.';
    return this.data;
  }

  private static save(): void {
    const data = this.load();
    data.updatedAt = new Date().toISOString();
    atomicWriteJson(HEALTH_PATH, data, { backup: true, space: 2 });
  }

  public static initialize(autoSyncUserEnabled: boolean): { recoveredAudit: boolean; previousAutoSyncEnabled: boolean | null } {
    const data = this.load();
    let recoveredAudit = false;
    let previousAutoSyncEnabled: boolean | null = null;
    for (const worker of Object.values(data.workers)) {
      if (worker?.lastStatus === 'running') {
        worker.lastStatus = 'interrupted';
        worker.lastFinishedAt = new Date().toISOString();
        worker.lastFailureAt = worker.lastFinishedAt;
        worker.lastErrorCode = 'PROCESS_RESTART';
        worker.lastErrorMessage = 'Lauf wurde durch einen Prozessneustart unterbrochen.';
        worker.consecutiveFailures += 1;
      }
    }
    if (data.auditLease) {
      previousAutoSyncEnabled = data.auditLease.previousAutoSyncEnabled;
      // No in-memory audit can survive a process restart. Any persisted lease is
      // therefore orphaned, regardless of its nominal expiry timestamp.
      data.auditLease = null;
      data.scheduler.auditPauseActive = false;
      data.scheduler.auditPauseLeaseUntil = null;
      recoveredAudit = true;
    }
    data.scheduler.autoSyncUserEnabled = autoSyncUserEnabled;
    this.save();
    return { recoveredAudit, previousAutoSyncEnabled };
  }

  public static begin(workerName: SyncWorkerName, runId: string, startedAt = new Date().toISOString()): void {
    const data = this.load();
    const worker = data.workers[workerName] || EMPTY_WORKER();
    data.workers[workerName] = {
      ...worker,
      lastRunId: runId,
      lastStartedAt: startedAt,
      lastFinishedAt: null,
      lastDurationMs: null,
      lastStatus: 'running',
      lastErrorCode: null,
      lastErrorMessage: null,
      attempted: 0,
      confirmed: 0,
      pages: 0
    };
    this.save();
  }

  public static finish(workerName: SyncWorkerName, runId: string, status: SyncWorkerStatus, details: { pages?: number; attempted?: number; confirmed?: number; message?: string } = {}): void {
    const data = this.load();
    const worker = data.workers[workerName] || EMPTY_WORKER();
    if (worker.lastRunId && worker.lastRunId !== runId) return;
    const finishedAt = new Date().toISOString();
    const success = status === 'complete' || (workerName === 'snap_resolver' && status === 'partial');
    const failure = ['error', 'unknown_write_outcome', 'interrupted'].includes(status);
    data.workers[workerName] = {
      ...worker,
      lastRunId: runId,
      lastFinishedAt: finishedAt,
      lastDurationMs: worker.lastStartedAt ? Math.max(0, Date.now() - Date.parse(worker.lastStartedAt)) : null,
      lastStatus: status,
      lastSuccessAt: success ? finishedAt : worker.lastSuccessAt,
      lastFailureAt: failure ? finishedAt : worker.lastFailureAt,
      lastErrorCode: failure ? errorCode(details.message) : null,
      lastErrorMessage: failure ? safeMessage(details.message) : null,
      consecutiveFailures: success ? 0 : failure ? worker.consecutiveFailures + 1 : worker.consecutiveFailures,
      attempted: details.attempted ?? worker.attempted,
      confirmed: details.confirmed ?? worker.confirmed,
      pages: details.pages ?? worker.pages
    };
    this.save();
  }

  public static setScheduler(autoSyncUserEnabled: boolean, patch: Partial<SyncHealthData['scheduler']> = {}): void {
    const data = this.load();
    const next = { ...data.scheduler, ...patch, autoSyncUserEnabled };
    if (JSON.stringify(next) === JSON.stringify(data.scheduler)) return;
    data.scheduler = next;
    this.save();
  }

  public static setQueues(patch: Partial<SyncHealthData['queues']>): void {
    const data = this.load();
    const next = { ...data.queues, ...patch };
    if (JSON.stringify(next) === JSON.stringify(data.queues)) return;
    data.queues = next;
    this.save();
  }

  public static acquireAuditLease(auditId: string, previousAutoSyncEnabled: boolean, leaseMs = 10 * 60 * 1000): AuditLease {
    const now = new Date();
    const lease: AuditLease = {
      auditId,
      previousAutoSyncEnabled,
      acquiredAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      status: 'active'
    };
    const data = this.load();
    data.auditLease = lease;
    data.scheduler.auditPauseActive = true;
    data.scheduler.auditPauseLeaseUntil = lease.leaseUntil;
    this.save();
    return lease;
  }

  public static renewAuditLease(auditId: string, leaseMs = 10 * 60 * 1000): void {
    const data = this.load();
    if (data.auditLease?.auditId !== auditId) throw new Error('Audit-Lease gehört nicht zum aktiven Audit.');
    data.auditLease.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    data.scheduler.auditPauseLeaseUntil = data.auditLease.leaseUntil;
    this.save();
  }

  public static releaseAuditLease(auditId: string): void {
    const data = this.load();
    if (data.auditLease && data.auditLease.auditId !== auditId) return;
    data.auditLease = null;
    data.scheduler.auditPauseActive = false;
    data.scheduler.auditPauseLeaseUntil = null;
    this.save();
  }

  public static snapshot(): SyncHealthData {
    return JSON.parse(JSON.stringify(this.load()));
  }

  public static evaluate(options: { unresolvedResolveProducts?: number; fullRefreshAt?: number | null } = {}) {
    const data = this.snapshot();
    const now = Date.now();
    const age = (iso: string | null) => iso ? now - Date.parse(iso) : Number.POSITIVE_INFINITY;
    const workerComponent = (key: SyncWorkerName, label: string, warnMs: number, criticalMs: number, optionalWhen = false): HealthComponent => {
      const worker = data.workers[key];
      const fallbackSuccessAt = key === 'full_products' && options.fullRefreshAt ? new Date(options.fullRefreshAt).toISOString() : null;
      const lastSuccessAt = worker?.lastSuccessAt || fallbackSuccessAt;
      if (data.scheduler.auditPauseActive) return { key, label, status: 'paused', message: 'Für System-Audit kontrolliert pausiert.', lastSuccessAt };
      if (optionalWhen) return { key, label, status: 'healthy', message: 'Keine offene Arbeit.', lastSuccessAt };
      if (!lastSuccessAt) return { key, label, status: 'unknown', message: 'Noch kein erfolgreicher Lauf aufgezeichnet.', lastSuccessAt: null };
      const elapsed = age(lastSuccessAt);
      const failures = worker?.consecutiveFailures || 0;
      const status = failures >= 3 || elapsed > criticalMs ? 'critical' : failures > 0 || elapsed > warnMs ? 'warning' : 'healthy';
      const minutes = Math.floor(elapsed / 60000);
      return { key, label, status, message: `Letzter Erfolg vor ${minutes} Min.${worker?.consecutiveFailures ? ` · ${worker.consecutiveFailures} Fehler in Folge` : ''}`, lastSuccessAt };
    };
    const components: HealthComponent[] = [
      workerComponent('quick_products', 'Produkte', 45 * 60000, 120 * 60000),
      workerComponent('queued_texts', 'Listingtexte', 24 * 60 * 60000, 48 * 60 * 60000, data.queues.textJobs === 0),
      workerComponent('snap_resolver', 'ASIN Resolver', 15 * 60000, 120 * 60000, (options.unresolvedResolveProducts || 0) === 0),
      workerComponent('full_products', 'Full Refresh', 8 * 24 * 60 * 60000, 10 * 24 * 60 * 60000)
    ];
    const textComponent = components.find(component => component.key === 'queued_texts');
    if (textComponent && data.queues.textJobs > 0 && data.queues.oldestTextJobAt) {
      const jobAge = age(data.queues.oldestTextJobAt);
      if (jobAge > 48 * 60 * 60000) textComponent.status = 'critical';
      else if (jobAge > 24 * 60 * 60000) textComponent.status = 'warning';
      textComponent.message = `${data.queues.textJobs} offen · älteste Aufgabe vor ${Math.floor(jobAge / 3600000)} Std.`;
    }
    if (data.storageWarning) components.push({ key: 'storage', label: 'Health-Speicher', status: 'warning', message: data.storageWarning, lastSuccessAt: null });
    const rank = { healthy: 0, unknown: 1, paused: 2, warning: 3, critical: 4 } as const;
    const overall = components.reduce<HealthComponent['status']>((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, 'healthy');
    return { overall, components, data };
  }
}

export function redactSecrets<T>(value: T): T {
  const visit = (input: any, key = ''): any => {
    if (/authorization|cookie|password|secret|service.?role|api.?key|access.?token|refresh.?token/i.test(key)) return '[REDACTED]';
    if (typeof input === 'string') return safeMessage(input);
    if (Array.isArray(input)) return input.map(item => visit(item));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    return input;
  };
  return visit(value) as T;
}

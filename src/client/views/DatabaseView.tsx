import React, { useState, useEffect } from 'react';
import { 
  Database, 
  RefreshCw, 
  Square, 
  Layers, 
  FileText, 
  Clock,
  Activity,
  Download
} from 'lucide-react';

interface SyncLogEntry {
  id: string;
  timestamp: number;
  text: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface SyncState {
  isScanning: boolean;
  activeScanType: string | null;
  scanStatus: 'ready' | 'scanning' | 'error';
  lastStatusMessage: string;
  autoUpdateEnabled: boolean;
  lastPeriodicSync: string | null;
  lastPeriodicSyncCount: number;
  lastQuickDesigns: number | null;
  lastFullDesigns: number | null;
  lastQuickListings: number | null;
  lastFullListings: number | null;
  lastQuickSales: number | null;
  lastFullSalesAll: number | null;
  lastAsinSync: string | null;
  liveDesignsCount: number;
  unresolvedAsinsCount: number;
  lastRun?: { status: string; type: string; startedAt: string; finishedAt?: string; pages: number; attempted: number; confirmed: number; message?: string };
  health?: {
    overall: 'healthy' | 'warning' | 'critical' | 'paused' | 'unknown';
    components: Array<{ key: string; label: string; status: string; message: string; lastSuccessAt: string | null }>;
    data: { scheduler: { auditPauseActive: boolean; auditPauseLeaseUntil: string | null }; queues: { productJobs: number; textJobs: number; resolverRetries: number } };
  };
  systemAudit?: {
    auditId: string; status: string; currentPhase: string; startedAt: string; finishedAt: string | null;
    progress: { completedPhases: number; totalPhases: number; pages: number; records: number; message: string };
    autoSync: { previouslyEnabled: boolean; pauseActive: boolean; restored: boolean };
    findings: Array<{ severity: string; code: string; message: string; count?: number }>;
    adAsinAudit?: { validAdEntries?: number; unresolvedResolveProducts?: number };
    resolverAudit?: { resolved?: number; observed?: number };
    lifecycleAudit?: {
      stalePublishedProducts?: number; staleAdAsins?: number; missingDatabaseProducts?: number;
      reviewAmazonProducts?: number; processingAmazonProducts?: number; timedOutAmazonProducts?: number;
      finalAmazonProductsWithoutAsin?: number;
    };
    reportPath: string; error: string | null;
  } | null;
  actionAvailability?: {
    systemAudit: { enabled: boolean; reason: string | null };
    runNow: { enabled: boolean; reason: string | null; queued: boolean };
  };
}

export const DatabaseView: React.FC = () => {
  const [syncState, setSyncState] = useState<SyncState>({
    isScanning: false,
    activeScanType: null,
    scanStatus: 'ready',
    lastStatusMessage: 'Bereit',
    autoUpdateEnabled: false,
    lastPeriodicSync: null,
    lastPeriodicSyncCount: 0,
    lastQuickDesigns: null,
    lastFullDesigns: null,
    lastQuickListings: null,
    lastFullListings: null,
    lastQuickSales: null,
    lastFullSalesAll: null,
    lastAsinSync: null,
    liveDesignsCount: 0,
    unresolvedAsinsCount: 0,
  });

  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [totalDesigns, setTotalDesigns] = useState(0);
  const [isActionRunning, setIsActionRunning] = useState<string | null>(null);

  const fetchState = () => {
    fetch('/api/v1/sync/state')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.state) {
          setSyncState(data.state);
        }
      })
      .catch(() => {});

    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTotalDesigns(data.designsCount || 0);
          if (data.liveDesignsCount !== undefined) {
            setSyncState(prev => ({
              ...prev,
              liveDesignsCount: data.liveDesignsCount,
              unresolvedAsinsCount: data.unresolvedAsinsCount ?? prev.unresolvedAsinsCount
            }));
          }
        }
      })
      .catch(() => {});
  };

  const fetchLogs = () => {
    fetch('/api/v1/sync/logs')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchState();
    fetchLogs();
    const interval = setInterval(() => {
      fetchState();
      fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAuto = async () => {
    const next = !syncState.autoUpdateEnabled;
    setSyncState(prev => ({ ...prev, autoUpdateEnabled: next }));
    try {
      await fetch('/api/v1/sync/toggle-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      fetchState();
      fetchLogs();
    } catch (e) {}
  };

  const handleRunScan = async (type: string) => {
    setIsActionRunning(type);
    try {
      const response = await fetch('/api/v1/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Scan konnte nicht gestartet werden');
      if (data.state) setSyncState(data.state);
      fetchState();
      fetchLogs();
    } catch (e) {
      alert('Scan konnte nicht gestartet werden');
    } finally {
      setTimeout(() => setIsActionRunning(null), 1000);
    }
  };

  const handleStopScan = async () => {
    try {
      const auditRunning = syncState.systemAudit && ['queued', 'waiting_for_worker', 'running'].includes(syncState.systemAudit.status);
      await fetch(auditRunning ? '/api/v1/sync/system-audit/cancel' : '/api/v1/sync/stop', { method: 'POST' });
      fetchState();
      fetchLogs();
    } catch (e) {}
  };

  const handleRunNow = async () => {
    setIsActionRunning('run_now');
    try {
      const response = await fetch('/api/v1/sync/run-now', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Synchronisierung konnte nicht gestartet werden.');
      fetchState(); fetchLogs();
    } catch (error: any) { alert(error.message); }
    finally { setIsActionRunning(null); }
  };

  const handleSystemAudit = async () => {
    setIsActionRunning('system_audit');
    try {
      const response = await fetch('/api/v1/sync/system-audit/start', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'System-Audit konnte nicht gestartet werden.');
      fetchState(); fetchLogs();
    } catch (error: any) { alert(error.message); }
    finally { setIsActionRunning(null); }
  };

  const handleCancelSystemAudit = async () => {
    await fetch('/api/v1/sync/system-audit/cancel', { method: 'POST' }).catch(() => {});
    fetchState(); fetchLogs();
  };

  const handleCopyAudit = async () => {
    try {
      const response = await fetch('/api/v1/sync/system-audit/latest/download');
      if (!response.ok) throw new Error('Bericht ist noch nicht verfügbar.');
      await navigator.clipboard.writeText(await response.text());
      alert('System-Audit wurde in die Zwischenablage kopiert.');
    } catch (error: any) { alert(error.message); }
  };

  const handleClearLogs = async () => {
    try {
      await fetch('/api/v1/sync/logs/clear', { method: 'POST' });
      setLogs([]);
    } catch (e) {}
  };

  const handleCopyLogs = () => {
    if (logs.length === 0) return alert('Keine Logs vorhanden.');
    const text = logs.map(l => {
      const dt = new Date(l.timestamp).toLocaleString('de-DE');
      return `[${dt}] [${l.type.toUpperCase()}] ${l.text}`;
    }).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs in die Zwischenablage kopiert!');
  };

  const formatDate = (ts: number | null) => {
    if (!ts) return '–';
    const d = new Date(ts);
    return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-surface/80 border border-slate-800/80 backdrop-blur-md shadow-lg shadow-black/20">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-primary-500/15 text-primary-400 border border-primary-500/30 shadow-inner">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              MBA ⇄ Supabase Engine
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                v3.0 Native
              </span>
            </h1>
            {syncState.lastRun && (
              <p className="text-[10px] text-slate-500 mt-1">
                Letzter Lauf: {syncState.lastRun.type} · {syncState.lastRun.status} · {syncState.lastRun.confirmed}/{syncState.lastRun.attempted} bestätigt
                {syncState.lastRun.message ? ` · ${syncState.lastRun.message}` : ''}
              </p>
            )}
          </div>
        </div>

        {/* Live DB Count Badge */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-primary-500/30 shadow-sm">
            <span className="text-xs text-slate-400 font-medium">Live Designs:</span>
            <span className="text-sm font-bold text-primary-400 font-mono">
              {syncState.liveDesignsCount.toLocaleString('de-DE')}
            </span>
            {totalDesigns > 0 && (
              <span className="text-[10px] text-slate-400">
                / {totalDesigns.toLocaleString('de-DE')} gesamt
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global Status Banner & Stop Control */}
      <div className="p-4 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full shrink-0 ${
            syncState.scanStatus === 'scanning' 
              ? 'bg-primary-500 animate-ping' 
              : syncState.scanStatus === 'error'
                ? 'bg-rose-500 shadow-lg shadow-rose-500/50'
                : 'bg-emerald-400 shadow-lg shadow-emerald-500/50'
          }`} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Synchronisierungs-Status
            </div>
            <div className="text-xs font-semibold text-slate-200">
              {syncState.lastStatusMessage}
            </div>
            {syncState.isScanning && syncState.activeScanType && (
              <div className="text-[10px] text-slate-500 mt-0.5">Aktiver Worker: {syncState.activeScanType} · nur unvereinbare Einzelaktionen sind vorübergehend gesperrt.</div>
            )}
          </div>
        </div>

        {syncState.isScanning && (
          <button
            onClick={handleStopScan}
            className="flex items-center justify-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-500/30 transition-all"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{syncState.systemAudit && ['queued', 'waiting_for_worker', 'running'].includes(syncState.systemAudit.status) ? 'System-Audit abbrechen' : 'Laufenden Scan abbrechen'}</span>
          </button>
        )}
      </div>

      {/* Main Grid: Sync Controls & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Sync Modules (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">

          <div className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary-400" />
                  Sync-Gesundheit
                </div>
                <p className="text-xs text-slate-400 mt-1">Dauerhafte Überwachung von Produkten, Listingtexten, SNAP-Resolver und Full Refresh.</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase ${
                syncState.health?.overall === 'healthy' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                syncState.health?.overall === 'critical' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
                syncState.health?.overall === 'paused' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' :
                'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>{syncState.health?.overall || 'unknown'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(syncState.health?.components || []).map(component => (
                <div key={component.key} className="rounded-xl bg-slate-900/60 border border-slate-800/80 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-200">{component.label}</span>
                    <span className={`w-2 h-2 rounded-full ${component.status === 'healthy' ? 'bg-emerald-400' : component.status === 'critical' ? 'bg-rose-400' : component.status === 'paused' ? 'bg-cyan-400' : 'bg-amber-400'}`} />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{component.message}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button onClick={handleRunNow} disabled={isActionRunning === 'run_now'} title={syncState.actionAvailability?.runNow.reason || 'Produkt-, Text- und Resolver-Catch-up einreihen'}
                className="px-3 py-2.5 rounded-xl bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/30 text-xs font-semibold disabled:opacity-50">
                {syncState.actionAvailability?.runNow.queued ? 'Synchronisierung vorgemerkt' : 'Jetzt synchronisieren'}
              </button>
              <button onClick={handleSystemAudit} disabled={!syncState.actionAvailability?.systemAudit.enabled || isActionRunning === 'system_audit'} title={syncState.actionAvailability?.systemAudit.reason || 'Vollständigen read-only Diagnosebericht erstellen'}
                className="px-3 py-2.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 text-xs font-semibold disabled:opacity-50">
                System-Audit erstellen
              </button>
            </div>
            {syncState.systemAudit && (
              <div className="rounded-xl border border-violet-500/25 bg-violet-950/15 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-violet-200">System-Audit · {syncState.systemAudit.status.replaceAll('_', ' ')}</div>
                  <div className="text-[10px] text-slate-400">{syncState.systemAudit.progress.completedPhases}/{syncState.systemAudit.progress.totalPhases} Phasen</div>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-violet-400 transition-all" style={{ width: `${Math.min(100, (syncState.systemAudit.progress.completedPhases / syncState.systemAudit.progress.totalPhases) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-slate-300">{syncState.systemAudit.progress.message}</div>
                {(syncState.systemAudit.progress.pages > 0 || syncState.systemAudit.progress.records > 0) && <div className="text-[10px] text-slate-500">{syncState.systemAudit.progress.pages} Amazon-Seiten · {syncState.systemAudit.progress.records.toLocaleString('de-DE')} Datensätze</div>}
                {syncState.systemAudit.autoSync.pauseActive && <div className="text-[10px] text-cyan-300">Auto-Sync kontrolliert pausiert; der vorherige Zustand wird danach automatisch wiederhergestellt.</div>}
                {syncState.systemAudit.finishedAt && syncState.systemAudit.autoSync.restored && (
                  <div className="text-[10px] text-emerald-300">Auto-Sync-Zustand wiederhergestellt{syncState.systemAudit.autoSync.previouslyEnabled ? '; Catch-up wurde eingereiht.' : '.'}</div>
                )}
                {syncState.systemAudit.error && <div className="text-[10px] text-rose-300">{syncState.systemAudit.error}</div>}
                {syncState.systemAudit.finishedAt && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[10px] text-slate-300">
                      <div className="font-semibold text-slate-200">Ad-ASINs &amp; Resolver</div>
                      <div>{(syncState.systemAudit.adAsinAudit?.validAdEntries || 0).toLocaleString('de-DE')} gültige Ziele · {syncState.systemAudit.adAsinAudit?.unresolvedResolveProducts || 0} offen</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[10px] text-slate-300">
                      <div className="font-semibold text-slate-200">Produktbestand</div>
                      <div>{syncState.systemAudit.lifecycleAudit?.missingDatabaseProducts || 0} final live mit ASIN fehlen · {syncState.systemAudit.lifecycleAudit?.stalePublishedProducts || 0} veraltet</div>
                    </div>
                    <div className="sm:col-span-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[10px] text-slate-400">
                      Amazon ausstehend: {syncState.systemAudit.lifecycleAudit?.reviewAmazonProducts || 0} Review · {syncState.systemAudit.lifecycleAudit?.processingAmazonProducts || 0} Verarbeitung · {syncState.systemAudit.lifecycleAudit?.timedOutAmazonProducts || 0} Timeout
                    </div>
                  </div>
                )}
                {!!syncState.systemAudit.findings?.length && (
                  <div className="space-y-1 pt-1">
                    {syncState.systemAudit.findings.map((finding, index) => (
                      <div key={`${finding.code}-${index}`} className={`rounded-lg border px-2 py-1.5 text-[10px] ${finding.severity === 'critical' ? 'border-rose-500/30 bg-rose-950/20 text-rose-300' : finding.severity === 'warning' ? 'border-amber-500/30 bg-amber-950/20 text-amber-300' : 'border-slate-700 bg-slate-900/40 text-slate-400'}`}>
                        {finding.message}{finding.count !== undefined ? ` (${finding.count})` : ''}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {['queued', 'waiting_for_worker', 'running'].includes(syncState.systemAudit.status) ? (
                    <button onClick={handleCancelSystemAudit} className="text-[10px] px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300">Audit abbrechen</button>
                  ) : (
                    <>
                      <a href="/api/v1/sync/system-audit/latest/download" className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300">
                        <Download className="w-3 h-3" /> Bericht herunterladen
                      </a>
                      <button onClick={handleCopyAudit} className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">In Zwischenablage kopieren</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Auto-Update Switch Card */}
          <div className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-primary-400 ${syncState.autoUpdateEnabled ? 'animate-spin' : ''}`} />
                  Auto-Update im Hintergrund
                </div>
                <div className="text-xs text-slate-400">
                  Prüft Produkte, Listingtexte und offene Child-ASINs. Sales derzeit gesperrt.
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                onClick={handleToggleAuto}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  syncState.autoUpdateEnabled ? 'bg-primary-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    syncState.autoUpdateEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="pt-2.5 border-t border-slate-800/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>
                {syncState.autoUpdateEnabled 
                  ? (syncState.lastPeriodicSync 
                      ? `Letzter Auto-Check: ${syncState.lastPeriodicSync} (${syncState.lastPeriodicSyncCount} aktualisiert)` 
                      : 'Hintergrund-Scheduler aktiv (Scan läuft alle 15 Min)...')
                  : 'Auto-Update ist aktuell deaktiviert.'}
              </span>
              <span className="font-mono text-slate-400">Intervall: 15m</span>
            </div>
          </div>

          <details className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              Erweiterte Wartung
            </summary>
            <p className="text-[11px] text-slate-500 mt-3">Vollständige Läufe sind normalerweise nicht nötig. Der Hintergrund-Sync übernimmt neue und geänderte Produkte automatisch.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-200">Produkte</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Zuletzt: {formatDate(syncState.lastFullDesigns)}</div>
                <button onClick={() => handleRunScan('full_products')} disabled={syncState.isScanning}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold disabled:opacity-50">
                  Produkt-Full-Refresh
                </button>
              </div>
              <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-200">Listingtexte</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Zuletzt: {formatDate(syncState.lastFullListings)}</div>
                <button onClick={() => handleRunScan('full_listings')} disabled={syncState.isScanning}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold disabled:opacity-50">
                  Listing-Full-Refresh
                </button>
              </div>
            </div>
          </details>
        </div>

        {/* Right Column: Live Terminal Logs (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md flex flex-col h-full min-h-[520px]">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-800/80">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-primary-400" />
                System-Logs
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyLogs}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors"
                >
                  Kopieren
                </button>
                <button
                  onClick={handleClearLogs}
                  className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-[10px] font-medium transition-colors"
                >
                  Leeren
                </button>
              </div>
            </div>

            {/* Log Stream Container */}
            <div className="flex-1 overflow-y-auto space-y-2 mt-3.5 pr-1 font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-xs font-sans">
                  Keine Log-Einträge vorhanden.
                </div>
              ) : (
                logs.map((log) => {
                  const dt = new Date(log.timestamp);
                  const timeStr = `${dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
                  return (
                    <div 
                      key={log.id}
                      className={`p-2 rounded-lg border leading-relaxed break-words ${
                        log.type === 'success'
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                          : log.type === 'error'
                            ? 'bg-rose-950/30 border-rose-800/40 text-rose-300'
                            : log.type === 'warn'
                              ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                              : 'bg-slate-900/60 border-slate-800/60 text-slate-300'
                      }`}
                    >
                      <div className="text-[9px] text-slate-400 mb-0.5">{timeStr}</div>
                      <div>{log.text}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
export default DatabaseView;

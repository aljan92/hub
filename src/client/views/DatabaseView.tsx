import React, { useState, useEffect } from 'react';
import { 
  Database, 
  RefreshCw, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Trash2, 
  Copy, 
  ShieldAlert, 
  Layers, 
  FileText, 
  DollarSign, 
  Link as LinkIcon,
  Sparkles,
  ArrowUpRight,
  Clock
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
              unresolvedAsinsCount: data.unresolvedAsinsCount || prev.unresolvedAsinsCount
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
      await fetch('/api/v1/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
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
      await fetch('/api/v1/sync/stop', { method: 'POST' });
      fetchState();
      fetchLogs();
    } catch (e) {}
  };

  const handleResetSales = async () => {
    if (!confirm('ACHTUNG: Alle Sales-Daten in deiner Supabase-Datenbank werden auf 0 gesetzt. Fortfahren?')) return;
    try {
      await fetch('/api/v1/sync/reset-sales', { method: 'POST' });
      fetchState();
      fetchLogs();
    } catch (e) {}
  };

  const handleResetAsins = async () => {
    if (!confirm('ACHTUNG: Der ASIN-Auflösungsstatus aller Designs wird zurückgesetzt. Fortfahren?')) return;
    try {
      await fetch('/api/v1/sync/reset-asins', { method: 'POST' });
      fetchState();
      fetchLogs();
    } catch (e) {}
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
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
              MBA ⇄ Supabase Engine
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                v3.0 Native
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Direkte Synchronisierung zwischen Amazon Merch on Demand und PostgreSQL
            </p>
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
          </div>
        </div>

        {syncState.isScanning && (
          <button
            onClick={handleStopScan}
            className="flex items-center justify-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-500/30 transition-all"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Laufenden Scan abbrechen</span>
          </button>
        )}
      </div>

      {/* Main Grid: Sync Controls & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Sync Modules (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* 1. Auto-Update Switch Card */}
          <div className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-primary-400 ${syncState.autoUpdateEnabled ? 'animate-spin' : ''}`} />
                  Auto-Update im Hintergrund
                </div>
                <div className="text-xs text-slate-400">
                  Automatischer zyklischer Hintergrund-Scan für Produkte, Listings &amp; Sales
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

          {/* 2. Manual Scans Group Card */}
          <div className="p-5 rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-md space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-primary-400 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              Manuelle Synchronisierung
            </div>

            {/* Row 1: Produkte */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  📦 Produkte (FindListings)
                </span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Zuletzt: {formatDate(syncState.lastQuickDesigns || syncState.lastFullDesigns)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => handleRunScan('quick_products')}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Synchronisiert nur Produkte, die in den letzten Tagen geändert wurden"
                >
                  Quick Update
                </button>
                <button
                  onClick={() => handleRunScan('full_products')}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Führt eine vollständige Synchronisierung aller Produkte im Account durch"
                >
                  Full Refresh
                </button>
              </div>
            </div>

            {/* Row 2: Listings */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  📝 Listings (Texte &amp; Bullets)
                </span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Zuletzt: {formatDate(syncState.lastQuickListings || syncState.lastFullListings)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => handleRunScan('quick_listings')}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Lädt nur Texte für neu hinzugefügte Listings herunter"
                >
                  Quick Update
                </button>
                <button
                  onClick={() => handleRunScan('full_listings')}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Aktualisiert die Texte aller Listings in der Datenbank"
                >
                  Full Refresh
                </button>
              </div>
            </div>

            {/* Row 3: Sales */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  💰 Sales &amp; Royalties
                </span>
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Zuletzt: {formatDate(syncState.lastQuickSales || syncState.lastFullSalesAll)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => handleRunScan('quick_sales')}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Aktualisiert die Verkäufe der letzten 30 Tage"
                >
                  Quick Update (30 Tage)
                </button>
                <button
                  onClick={() => {
                    if (confirm('Gesamte Sales-Historie laden? Das kann einige Minuten dauern.')) {
                      handleRunScan('full_sales');
                    }
                  }}
                  disabled={syncState.isScanning}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Synchronisiert alle Verkaufszahlen der gesamten Historie"
                >
                  Full Refresh (All-Time)
                </button>
              </div>
            </div>

            {/* Row 4: ASINs */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <LinkIcon className="w-3.5 h-3.5 text-amber-400" />
                  🔗 ASIN Resolver
                </span>
                <span className="text-[11px] text-amber-400/90 font-mono">
                  {syncState.unresolvedAsinsCount} offen
                </span>
              </div>
              <button
                onClick={() => handleRunScan('resolve_asins')}
                disabled={syncState.isScanning}
                className="w-full px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
                title="Löst Parent-ASINs zu bewerbbaren Child-ASINs für Varianten-Produkte auf"
              >
                <span>🔗 ASINs auflösen ({syncState.unresolvedAsinsCount})</span>
              </button>
            </div>
          </div>

          {/* 3. Danger Zone */}
          <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-900/40 backdrop-blur-md space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              Gefahrenzone
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={handleResetAsins}
                className="px-3 py-2 rounded-xl bg-rose-900/30 hover:bg-rose-900/50 text-rose-200 border border-rose-800/40 text-[11px] font-semibold transition-all"
              >
                🔄 ASIN-Status resetten
              </button>
              <button
                onClick={handleResetSales}
                className="px-3 py-2 rounded-xl bg-rose-900/30 hover:bg-rose-900/50 text-rose-200 border border-rose-800/40 text-[11px] font-semibold transition-all"
              >
                🗑️ Sales in DB resetten
              </button>
            </div>
          </div>
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

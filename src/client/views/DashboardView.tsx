import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  UploadCloud, 
  CheckCircle2, 
  ExternalLink,
  Sparkles, 
  Terminal,
  MonitorPlay,
  FolderSync,
  ArrowRight
} from 'lucide-react';

import { BrowserScreencast } from '../components/BrowserScreencast';
import { ConnectorTopology } from '../components/ConnectorTopology';

interface DashboardViewProps {
  onNavigateTab: (tab: any) => void;
}

let moduleCachedHealth: any = null;
let moduleCachedStats: any = null;
let moduleCachedSyncState: any = null;

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigateTab }) => {
  const [browserViewActive, setBrowserViewActive] = useState(false);
  const [healthData, setHealthData] = useState<any>(moduleCachedHealth);
  const [statsData, setStatsData] = useState<any>(moduleCachedStats);
  const [syncState, setSyncState] = useState<any>(moduleCachedSyncState);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const fetchDashboardData = (forceSpinner = false) => {
    if (forceSpinner) setLoadingHealth(true);
    
    // 1. Health
    fetch('/api/v1/connectors/health')
      .then(res => res.json())
      .then(data => {
        moduleCachedHealth = data;
        setHealthData(data);
      })
      .catch(err => console.warn('[Dashboard] Health fetch error:', err))
      .finally(() => setLoadingHealth(false));

    // 2. Stats
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          moduleCachedStats = data;
          setStatsData(data);
        }
      })
      .catch(() => {});

    // 3. Sync State
    fetch('/api/v1/sync/state')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.state) {
          moduleCachedSyncState = data.state;
          setSyncState(data.state);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchDashboardData(moduleCachedHealth === null);
    const interval = setInterval(() => fetchDashboardData(false), 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Systemübersicht &amp; Dashboard</h2>
          <p className="text-sm text-slate-400">Echtzeit-Metriken, Konnektor-Topologie und Upload-Kontrolle auf deinem NAS.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setBrowserViewActive(!browserViewActive)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              browserViewActive 
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <MonitorPlay className="w-4 h-4" />
            <span>{browserViewActive ? 'Browser Stream schließen' : 'Amazon Browser (Live Stream)'}</span>
          </button>
        </div>
      </div>

      {/* Embedded Native CDP Browser Screencast Panel */}
      {browserViewActive && (
        <div className="w-full h-[620px] rounded-2xl overflow-hidden shadow-2xl border border-slate-800 animate-fadeIn">
          <BrowserScreencast />
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Daily Slots Card */}
        <div className="glass-card p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Tages-Slots (Offen)</span>
            <div className="p-2 rounded-lg bg-accent-cyan/10 text-accent-cyan">
              <UploadCloud className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {statsData?.slots ? statsData.slots.total - statsData.slots.used : 100}
            </span>
            <span className="text-xs text-slate-400 font-medium">/ 100 verfügbar</span>
          </div>
          <div className="flex items-center text-xs text-emerald-400 space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Bereit für Auto Slot-Filling (04:00 Uhr)</span>
          </div>
        </div>

        {/* MBA Live Designs Card */}
        <div 
          onClick={() => onNavigateTab('database')}
          className="glass-card p-5 rounded-2xl space-y-3 cursor-pointer hover:border-emerald-500/40 group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Live Designs (Amazon)</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {statsData?.liveDesignsCount !== undefined ? statsData.liveDesignsCount.toLocaleString('de-DE') : (statsData?.designsCount || '0')}
            </span>
            <span className="text-xs text-slate-400 font-medium">
              {statsData?.designsCount ? `von ${statsData.designsCount.toLocaleString('de-DE')} gesamt` : 'Live auf Amazon'}
            </span>
          </div>
          <div className="text-xs text-emerald-400 flex items-center space-x-1 group-hover:underline">
            <span>Zur Database Engine</span>
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </div>
        </div>

        {/* Upload Queue Count Card */}
        <div 
          onClick={() => onNavigateTab('queue')}
          className="glass-card p-5 rounded-2xl space-y-3 cursor-pointer hover:border-accent-cyan/40 group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Upload-Queue</span>
            <div className="p-2 rounded-lg bg-accent-cyan/10 text-accent-cyan group-hover:scale-110 transition-transform">
              <FolderSync className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {statsData?.queueCount !== undefined ? statsData.queueCount : 0}
            </span>
            <span className="text-xs text-slate-400 font-medium">Bereit für Upload</span>
          </div>
          <div className="text-xs text-accent-cyan flex items-center space-x-1 group-hover:underline">
            <span>Zur Warteschlange</span>
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </div>
        </div>

        {/* Task Review Loop Card */}
        <div 
          onClick={() => onNavigateTab('tasks')}
          className="glass-card p-5 rounded-2xl space-y-3 cursor-pointer hover:border-primary-500/40 group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Tasks im Review</span>
            <div className="p-2 rounded-lg bg-accent-amber/10 text-accent-amber group-hover:scale-110 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {statsData?.tasksCount !== undefined ? statsData.tasksCount : 0}
            </span>
            <span className="text-xs text-slate-400 font-medium">Offene Aufgaben</span>
          </div>
          <div className="text-xs text-primary-400 flex items-center space-x-1 group-hover:underline">
            <span>Jetzt prüfen &amp; freigeben</span>
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </div>
        </div>
      </div>

      {/* Interactive System Architecture & Connector Topology Schema */}
      <ConnectorTopology 
        healthData={healthData}
        syncState={syncState}
        onNavigateTab={onNavigateTab}
        onRefreshHealth={() => fetchDashboardData(true)}
        isLoading={loadingHealth}
      />

      {/* Quick Navigation Banner to System Logs */}
      <div 
        onClick={() => onNavigateTab('logs')}
        className="glass-card p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-800/80 hover:border-accent-cyan/40 cursor-pointer transition-all group bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-900/90"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20 group-hover:scale-110 transition-transform">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100 group-hover:text-accent-cyan transition-colors flex items-center space-x-2">
              <span>System- &amp; Aktivitäts-Logs Konsole</span>
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 font-semibold">
                Live Terminal
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Vollständige Fehleranalysen, Synchronisierungs-Verläufe und Echtzeit-Serverereignisse im separaten Menü aufrufen.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-semibold text-accent-cyan group-hover:underline shrink-0">
          <span>Log-Terminal öffnen</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  ShoppingBag, 
  UploadCloud, 
  CheckCircle2, 
  ExternalLink,
  ShieldCheck,
  Cpu,
  Database,
  Image as ImageIcon,
  Sparkles,
  Search,
  Globe,
  Terminal,
  MonitorPlay,
  RefreshCw,
  FolderSync
} from 'lucide-react';

interface DashboardViewProps {
  onNavigateTab: (tab: any) => void;
}

let moduleCachedHealth: any = null;
let moduleCachedStats: any = null;
let moduleCachedActivity: any[] = [];

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigateTab }) => {
  const [browserViewActive, setBrowserViewActive] = useState(false);
  const [healthData, setHealthData] = useState<any>(moduleCachedHealth);
  const [statsData, setStatsData] = useState<any>(moduleCachedStats);
  const [activityEvents, setActivityEvents] = useState<any[]>(moduleCachedActivity);
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

    // 3. Activity
    fetch('/api/v1/activity')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.activity)) {
          moduleCachedActivity = data.activity;
          setActivityEvents(data.activity);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchDashboardData(moduleCachedHealth === null);
  }, []);

  const connectors = [
    { 
      name: 'OpenRouter Vision', 
      status: healthData?.openRouter?.success ? 'Online' : (healthData ? 'API Key benötigt' : 'Prüfe...'), 
      desc: 'Claude 3.5 / GPT-4o Listing AI', 
      icon: Cpu, 
      ping: healthData?.openRouter?.latencyMs ? `${healthData.openRouter.latencyMs}ms` : '—', 
      isOnline: healthData?.openRouter?.success,
      color: 'text-accent-amber' 
    },
    { 
      name: 'Productor TM API', 
      status: healthData?.productorTM?.success ? 'Online' : (healthData ? 'Offline' : 'Prüfe...'), 
      desc: 'USPTO / DPMA / EUIPO Check', 
      icon: Search, 
      ping: healthData?.productorTM?.latencyMs ? `${healthData.productorTM.latencyMs}ms` : '62ms', 
      isOnline: healthData?.productorTM?.success !== false,
      color: 'text-accent-purple' 
    },
    { 
      name: 'Vectorizer.ai API', 
      status: healthData?.vectorizer?.success ? 'Online' : (healthData ? 'API Key benötigt' : 'Prüfe...'), 
      desc: 'Auto-Vektorisierung (SVG)', 
      icon: Sparkles, 
      ping: healthData?.vectorizer?.latencyMs ? `${healthData.vectorizer.latencyMs}ms` : '—', 
      isOnline: healthData?.vectorizer?.success,
      color: 'text-accent-cyan' 
    },
    { 
      name: 'Ideogram 3.0 API', 
      status: healthData?.ideogram?.success ? 'Online' : (healthData ? 'Token prüfen' : 'Prüfe...'), 
      desc: 'Bildgenerierung & Prompts', 
      icon: ImageIcon, 
      ping: healthData?.ideogram?.latencyMs ? `${healthData.ideogram.latencyMs}ms` : '—', 
      isOnline: healthData?.ideogram?.success,
      color: 'text-primary-400' 
    },
    { 
      name: 'Supabase Sync', 
      status: healthData?.supabase?.success ? 'Online' : (healthData ? 'URL/Key benötigt' : 'Prüfe...'), 
      desc: 'MBA Database (Designs & Sales)', 
      icon: Database, 
      ping: healthData?.supabase?.latencyMs ? `${healthData.supabase.latencyMs}ms` : '—', 
      isOnline: healthData?.supabase?.success,
      color: 'text-emerald-400' 
    },
    { 
      name: 'Amazon Chrome Worker', 
      status: 'Session Warm', 
      desc: 'Uploads & DOM Automation', 
      icon: Globe, 
      ping: 'Local', 
      isOnline: true,
      color: 'text-emerald-400' 
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">Systemübersicht &amp; Dashboard</h2>
          <p className="text-sm text-slate-400">Echtzeit-Metriken, Konnektor-Status und Upload-Kontrolle auf deinem NAS.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setBrowserViewActive(!browserViewActive)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              browserViewActive 
                ? 'bg-accent-cyan text-slate-900 border-accent-cyan font-bold shadow-lg shadow-accent-cyan/20'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <MonitorPlay className="w-4 h-4" />
            <span>{browserViewActive ? 'Browser Stream schließen' : 'Amazon Browser (noVNC)'}</span>
          </button>
        </div>
      </div>

      {/* Embedded noVNC Stream Modal */}
      {browserViewActive && (
        <div className="glass-panel p-5 rounded-2xl border border-accent-cyan/40 shadow-2xl relative overflow-hidden animate-fadeIn">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-bold text-slate-100">Live Amazon Merch Chrome Session (noVNC)</span>
              <span className="text-[11px] text-slate-400 font-mono">Port 6080</span>
            </div>
            <span className="text-xs text-slate-400">Nutze dieses Fenster für den initialen Amazon Login &amp; 2FA / MFA</span>
          </div>

          <div className="w-full h-[520px] bg-slate-950 rounded-xl border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
            <iframe 
              src="http://192.168.178.141:6080/vnc.html?autoconnect=true&resize=scale" 
              className="w-full h-full border-0 rounded-xl"
              title="noVNC Browser Stream"
            />
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6 text-center bg-slate-950/40 backdrop-blur-[2px]">
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-6 max-w-md shadow-2xl space-y-3 pointer-events-auto">
                <Globe className="w-10 h-10 text-accent-cyan mx-auto animate-bounce" />
                <h4 className="font-bold text-slate-100 text-sm">Persistente Browser Session</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Über diesen Stream hast du direkten Zugriff auf den Docker Chromium-Browser zur Überwachung von Amazon Merch Uploads.
                </p>
                <div className="text-[11px] font-mono text-accent-cyan bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                  Target: http://192.168.178.141:6080
                </div>
              </div>
            </div>
          </div>
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

      {/* Main Grid: Connector Health & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connector Status Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-200 text-sm flex items-center">
              <Cpu className="w-4 h-4 mr-2 text-primary-400" />
              Schnittstellen &amp; Konnektoren
            </h3>
            <button
              onClick={() => fetchDashboardData(true)}
              disabled={loadingHealth}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
            >
              <RefreshCw className={`w-3 h-3 ${loadingHealth ? 'animate-spin text-primary-400' : ''}`} />
              <span>Status neu laden</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {connectors.map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={i} className="glass-card p-4 rounded-xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 ${c.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-slate-100">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.desc}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                      c.isOnline
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {c.status}
                    </span>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">{c.ping}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-200 text-sm flex items-center">
              <Terminal className="w-4 h-4 mr-2 text-accent-cyan" />
              Aktivitäts-Log
            </h3>
            <span className="text-xs text-slate-400">Live Server Events</span>
          </div>

          <div className="glass-card p-4 rounded-2xl space-y-3.5 max-h-[340px] overflow-y-auto">
            {activityEvents.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">Noch keine Events protokolliert.</div>
            ) : (
              activityEvents.map((evt, idx) => (
                <div key={idx} className="flex items-start space-x-3 text-xs pb-3 border-b border-slate-800/60 last:border-0 last:pb-0">
                  <span className="font-mono text-[11px] text-slate-400 shrink-0 mt-0.5">{evt.time}</span>
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-200">{evt.title}</div>
                    <div className="text-slate-400 text-[11px] leading-snug">{evt.desc}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

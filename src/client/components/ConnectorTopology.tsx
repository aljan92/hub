import React, { useState } from 'react';
import { 
  Bot, 
  ImageIcon, 
  Sparkles, 
  Globe, 
  Database, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Activity, 
  Zap, 
  ArrowRight
} from 'lucide-react';

export interface ConnectorTopologyProps {
  healthData: any;
  syncState?: any;
  onNavigateTab: (tab: any) => void;
  onRefreshHealth: () => void;
  isLoading?: boolean;
}

export const ConnectorTopology: React.FC<ConnectorTopologyProps> = ({
  healthData,
  syncState,
  onNavigateTab,
  onRefreshHealth,
  isLoading = false
}) => {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [testingConnector, setTestingConnector] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  // Real-time 1s ticker for live countdown / age counter
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTestConnection = async (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTestingConnector(type);
    try {
      const res = await fetch('/api/v1/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector: type })
      });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [type]: data }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [type]: { success: false, error: err.message } }));
    } finally {
      setTestingConnector(null);
      onRefreshHealth();
    }
  };

  const getHermesPingAge = (lastPingTime?: number): string => {
    if (!lastPingTime || lastPingTime <= 0) return 'Kein Heartbeat';
    const diffSec = Math.max(0, Math.floor((currentTime - lastPingTime) / 1000));
    if (diffSec < 5) return 'Gerade eben';
    if (diffSec < 60) return `vor ${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    if (mins < 60) return `vor ${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `vor ${hours}h ${remMins}m`;
  };

  const hermesLastPing = healthData?.hermes?.lastPingTime;
  const isHermesOnline = Boolean(
    healthData?.hermes?.success || 
    (hermesLastPing && (currentTime - hermesLastPing < 10 * 60 * 1000))
  );

  // Node definitions with minimal, clean labels
  const nodes = {
    ideogram: {
      id: 'ideogram',
      title: 'Ideogram',
      protocol: 'API',
      icon: ImageIcon,
      color: 'from-pink-500 to-rose-600',
      borderColor: 'border-pink-500/30 hover:border-pink-400',
      activeColor: 'text-pink-400',
      glowColor: 'hover:shadow-pink-500/10',
      isOnline: healthData?.ideogram?.success,
      statusText: healthData?.ideogram?.success ? 'Online' : 'API-Key fehlt',
      ping: healthData?.ideogram?.latencyMs ? `${healthData.ideogram.latencyMs}ms` : '—',
      endpoint: 'https://api.ideogram.ai/generate',
      settingsTab: 'settings'
    },
    vectorizer: {
      id: 'vectorizer',
      title: 'Vectorizer',
      protocol: 'API',
      icon: Sparkles,
      color: 'from-cyan-500 to-teal-600',
      borderColor: 'border-cyan-500/30 hover:border-cyan-400',
      activeColor: 'text-cyan-400',
      glowColor: 'hover:shadow-cyan-500/10',
      isOnline: healthData?.vectorizer?.success,
      statusText: healthData?.vectorizer?.success ? 'Online' : 'API-Key fehlt',
      ping: healthData?.vectorizer?.latencyMs ? `${healthData.vectorizer.latencyMs}ms` : '—',
      endpoint: 'https://vectorizer.ai/api/v1/vectorize',
      settingsTab: 'settings'
    },
    hermes: {
      id: 'hermes',
      title: 'Hermes Agent',
      protocol: 'MCP / Cron',
      icon: Bot,
      color: 'from-blue-500 to-indigo-600',
      borderColor: isHermesOnline ? 'border-blue-500/40 hover:border-blue-400' : 'border-slate-700/60',
      activeColor: 'text-blue-400',
      glowColor: 'hover:shadow-blue-500/10',
      isOnline: isHermesOnline,
      statusText: isHermesOnline ? 'Heartbeat aktiv' : (hermesLastPing ? 'Timeout / Standby' : 'Wartet auf Ping'),
      ping: getHermesPingAge(hermesLastPing),
      endpoint: 'hub.angermann.work/api/v1/mcp/ping',
      settingsTab: 'settings',
      extraInfo: hermesLastPing ? `Zuletzt: ${new Date(hermesLastPing).toLocaleTimeString('de-DE')} • ${healthData?.hermes?.totalPings || 1} Pings` : undefined
    },
    amazon: {
      id: 'amazon',
      title: 'Amazon Merch',
      protocol: 'Chrome',
      icon: Globe,
      color: 'from-amber-500 to-orange-600',
      borderColor: 'border-amber-500/30 hover:border-amber-400',
      activeColor: 'text-amber-400',
      glowColor: 'hover:shadow-amber-500/10',
      isOnline: true,
      statusText: syncState?.isScanning ? 'Syncing' : 'Session 1 & 2',
      ping: 'CDP Local',
      endpoint: 'merch.amazon.com',
      settingsTab: 'dashboard'
    },
    supabase: {
      id: 'supabase',
      title: 'MBA Database',
      protocol: 'Supabase',
      icon: Database,
      color: 'from-emerald-500 to-teal-600',
      borderColor: 'border-emerald-500/30 hover:border-emerald-400',
      activeColor: 'text-emerald-400',
      glowColor: 'hover:shadow-emerald-500/10',
      isOnline: healthData?.supabase?.success,
      statusText: healthData?.supabase?.success ? 'Verbunden' : 'Offline',
      ping: healthData?.supabase?.latencyMs ? `${healthData.supabase.latencyMs}ms` : '—',
      endpoint: 'Supabase Cloud (mba_designs)',
      settingsTab: 'database'
    },
    productor: {
      id: 'productor',
      title: 'Productor TM',
      protocol: 'API',
      icon: Search,
      color: 'from-purple-500 to-violet-600',
      borderColor: 'border-purple-500/30 hover:border-purple-400',
      activeColor: 'text-purple-400',
      glowColor: 'hover:shadow-purple-500/10',
      isOnline: healthData?.productorTM?.success !== false,
      statusText: healthData?.productorTM?.success !== false ? 'Online' : 'Offline',
      ping: healthData?.productorTM?.latencyMs ? `${healthData.productorTM.latencyMs}ms` : '58ms',
      endpoint: 'Productor TM Endpoints',
      settingsTab: 'settings'
    },
  };

  const currentNode = Object.values(nodes).find(n => n.id === selectedNode);

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 relative overflow-hidden border border-slate-800 shadow-2xl">
      {/* Topology Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800/80 mb-6">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/20">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 tracking-tight">
              Schnittstellen &amp; Konnektoren
            </h3>
            <p className="text-xs text-slate-400">
              Interaktive Übersicht aller angebundenen Dienste &amp; Sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-1" />
            <span className="font-semibold text-emerald-400">Core Aktiv</span>
          </div>
          <button
            onClick={onRefreshHealth}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center space-x-1.5 border border-slate-700/60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-primary-400' : ''}`} />
            <span>Neu prüfen</span>
          </button>
        </div>
      </div>

      {/* Symmetric 3-Column Architecture Matrix */}
      <div className="relative py-4 flex items-center justify-center">
        {/* Background Network Grid Dots */}
        <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-20 pointer-events-none" />

        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 items-center relative z-10">
          
          {/* ═══════════ LEFT COLUMN (Ideogram, Hermes, MBA Database) ═══════════ */}
          <div className="flex flex-col space-y-4">
            {renderCard(nodes.ideogram)}
            {renderCard(nodes.hermes)}
            {renderCard(nodes.supabase)}
          </div>

          {/* ═══════════ CENTER COLUMN (Prominent MBA HUB) ═══════════ */}
          <div className="flex flex-col items-center justify-center py-2">
            <div 
              onClick={() => setSelectedNode('hub')}
              className="w-full relative group cursor-pointer"
            >
              <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500 rounded-2xl blur-md opacity-35 group-hover:opacity-60 transition duration-300" />
              <div className="relative bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border-2 border-primary-500/50 rounded-2xl p-6 text-center shadow-xl transition-all group-hover:scale-[1.02]">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-primary-600 to-cyan-500 text-white shadow-lg shadow-primary-500/25 mb-2.5">
                  <Zap className="w-6 h-6" />
                </div>
                <h4 className="text-xl font-black tracking-wider text-white uppercase">
                  MBA HUB
                </h4>
                <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mt-0.5">
                  Zentrale Integrationsplattform
                </p>
                <div className="mt-3 inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-slate-950/80 border border-slate-800 text-[10px] text-slate-300 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Port 3000 • NAS Core</span>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════ RIGHT COLUMN (Vectorizer, Amazon Merch, Productor TM) ═══════════ */}
          <div className="flex flex-col space-y-4">
            {renderCard(nodes.vectorizer)}
            {renderCard(nodes.amazon)}
            {renderCard(nodes.productor)}
          </div>

        </div>
      </div>

      {/* Selected Connector Detail / Test Modal */}
      {selectedNode && selectedNode !== 'hub' && currentNode && (
        <div 
          onClick={() => setSelectedNode(null)}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative animate-scaleUp"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-2.5 rounded-xl bg-gradient-to-tr ${currentNode.color} text-white shadow-lg`}>
                  <currentNode.icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">{currentNode.title}</h4>
                  <p className="text-[11px] text-slate-400 font-mono uppercase">{currentNode.protocol}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-white font-bold p-1 text-sm"
              >
                ✕
              </button>
            </div>

            {/* Details Box */}
            <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Status:</span>
                <span className={`font-semibold flex items-center space-x-1 ${currentNode.isOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {currentNode.isOnline ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <AlertCircle className="w-3.5 h-3.5 mr-1" />}
                  {currentNode.statusText}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Ping:</span>
                <span className="font-mono text-cyan-400 font-bold">{currentNode.ping}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Endpunkt:</span>
                <span className="font-mono text-[11px] text-slate-300 truncate max-w-[180px]">{currentNode.endpoint}</span>
              </div>
              {(currentNode as any).extraInfo && (
                <div className="flex justify-between items-center text-slate-400 pt-1 border-t border-slate-900">
                  <span>Heartbeat Details:</span>
                  <span className="font-mono text-[10px] text-accent-cyan font-medium">{(currentNode as any).extraInfo}</span>
                </div>
              )}
            </div>

            {/* Test result feedback */}
            {testResults[currentNode.id] && (
              <div className={`p-2.5 rounded-xl text-xs border ${
                testResults[currentNode.id].success 
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' 
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
              }`}>
                <div className="font-bold mb-0.5">
                  {testResults[currentNode.id].success ? '✓ Verbindung erfolgreich:' : '❌ Verbindungsfehler:'}
                </div>
                <div>{testResults[currentNode.id].message || testResults[currentNode.id].error}</div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                onClick={(e) => handleTestConnection(currentNode.id, e)}
                disabled={testingConnector === currentNode.id}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${testingConnector === currentNode.id ? 'animate-spin text-primary-400' : ''}`} />
                <span>{testingConnector === currentNode.id ? 'Teste...' : 'Testen'}</span>
              </button>
              
              <button
                onClick={() => {
                  setSelectedNode(null);
                  onNavigateTab(currentNode.settingsTab);
                }}
                className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold flex items-center space-x-1 shadow-md shadow-primary-500/20 transition-all"
              >
                <span>Einstellungen</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderCard(node: any) {
    const Icon = node.icon;
    const isSelected = selectedNode === node.id;

    return (
      <div
        key={node.id}
        onClick={() => setSelectedNode(node.id)}
        className="w-full group cursor-pointer transition-all duration-200"
      >
        <div className={`glass-card p-3.5 rounded-xl border ${
          isSelected 
            ? 'border-primary-400 ring-2 ring-primary-500/30 shadow-lg' 
            : `${node.borderColor} shadow-md ${node.glowColor}`
        } bg-slate-900/90 backdrop-blur-md flex items-center justify-between hover:bg-slate-800/80`}>
          
          {/* Left: Icon & Title & Protocol */}
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-lg bg-slate-800/90 border border-slate-700/60 ${node.activeColor} group-hover:scale-105 transition-transform shrink-0`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-sm text-slate-100 group-hover:text-white">
                {node.title}
              </div>
              <div className="text-[10px] font-mono font-medium text-slate-400 uppercase tracking-wider">
                {node.protocol}
              </div>
            </div>
          </div>

          {/* Right: Status Dot & Ping */}
          <div className="text-right pl-2 shrink-0">
            <div className="flex items-center justify-end space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${
                node.isOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-amber-400'
              }`} />
              <span className={`text-xs font-semibold ${
                node.isOnline ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {node.statusText}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              {node.ping}
            </div>
          </div>

        </div>
      </div>
    );
  }
};

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
  ArrowRight,
  MonitorPlay
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

  // Node states & config
  const nodes = [
    {
      id: 'hermes',
      title: 'Hermes Agent',
      subtitle: 'AI Co-Pilot & Prompt Engine',
      protocol: 'MCP / REST',
      direction: 'left',
      icon: Bot,
      color: 'from-blue-500 to-indigo-600',
      borderColor: 'border-blue-500/40 hover:border-blue-400',
      activeColor: 'text-blue-400',
      glowColor: 'shadow-blue-500/20',
      isOnline: true,
      isActive: false,
      statusText: 'Bereit / Standby',
      ping: 'Local (1ms)',
      endpoint: '/api/v1/hermes/task',
      settingsTab: 'settings'
    },
    {
      id: 'ideogram',
      title: 'Ideogram 3.0',
      subtitle: 'Image Generation API',
      protocol: 'API (v3)',
      direction: 'top-left',
      icon: ImageIcon,
      color: 'from-pink-500 to-rose-600',
      borderColor: 'border-pink-500/40 hover:border-pink-400',
      activeColor: 'text-pink-400',
      glowColor: 'shadow-pink-500/20',
      isOnline: healthData?.ideogram?.success,
      isActive: false,
      statusText: healthData?.ideogram?.success ? 'Online' : 'API-Key fehlt',
      ping: healthData?.ideogram?.latencyMs ? `${healthData.ideogram.latencyMs}ms` : '—',
      endpoint: 'https://api.ideogram.ai/generate',
      settingsTab: 'settings'
    },
    {
      id: 'vectorizer',
      title: 'Vectorizer.ai',
      subtitle: 'SVG Vector Engine & AI',
      protocol: 'API (SVG)',
      direction: 'top-right',
      icon: Sparkles,
      color: 'from-cyan-500 to-teal-600',
      borderColor: 'border-cyan-500/40 hover:border-cyan-400',
      activeColor: 'text-cyan-400',
      glowColor: 'shadow-cyan-500/20',
      isOnline: healthData?.vectorizer?.success,
      isActive: false,
      statusText: healthData?.vectorizer?.success ? 'Online' : 'API-Key fehlt',
      ping: healthData?.vectorizer?.latencyMs ? `${healthData.vectorizer.latencyMs}ms` : '—',
      endpoint: 'https://vectorizer.ai/api/v1/vectorize',
      settingsTab: 'settings'
    },
    {
      id: 'amazon',
      title: 'Amazon Merch Upload',
      subtitle: 'Chrome Automation & Uploads',
      protocol: 'Chrome CDP',
      direction: 'right',
      icon: Globe,
      color: 'from-amber-500 to-orange-600',
      borderColor: 'border-amber-500/40 hover:border-amber-400',
      activeColor: 'text-amber-400',
      glowColor: 'shadow-amber-500/20',
      isOnline: true,
      isActive: syncState?.isScanning || false,
      statusText: syncState?.isScanning ? 'Syncing / Aktiv' : 'Session 1 & 2 Warm',
      ping: 'Local CDP',
      endpoint: 'merch.amazon.com',
      settingsTab: 'dashboard'
    },
    {
      id: 'supabase',
      title: 'MBA Database',
      subtitle: 'Supabase Cloud (Designs & Sales)',
      protocol: 'Supabase REST',
      direction: 'bottom-left',
      icon: Database,
      color: 'from-emerald-500 to-teal-600',
      borderColor: 'border-emerald-500/40 hover:border-emerald-400',
      activeColor: 'text-emerald-400',
      glowColor: 'shadow-emerald-500/20',
      isOnline: healthData?.supabase?.success,
      isActive: syncState?.isScanning || false,
      statusText: healthData?.supabase?.success ? 'Verbunden' : 'URL/Key fehlt',
      ping: healthData?.supabase?.latencyMs ? `${healthData.supabase.latencyMs}ms` : '—',
      endpoint: 'Supabase (mba_designs)',
      settingsTab: 'database'
    },
    {
      id: 'productor',
      title: 'Productor TM',
      subtitle: 'USPTO / DPMA / EUIPO',
      protocol: 'API (Class 25)',
      direction: 'bottom-right',
      icon: Search,
      color: 'from-purple-500 to-violet-600',
      borderColor: 'border-purple-500/40 hover:border-purple-400',
      activeColor: 'text-purple-400',
      glowColor: 'shadow-purple-500/20',
      isOnline: healthData?.productorTM?.success !== false,
      isActive: false,
      statusText: healthData?.productorTM?.success !== false ? 'Online' : 'Offline',
      ping: healthData?.productorTM?.latencyMs ? `${healthData.productorTM.latencyMs}ms` : '58ms',
      endpoint: 'Productor TM Endpoints',
      settingsTab: 'settings'
    },
  ];

  const currentNode = nodes.find(n => n.id === selectedNode);

  return (
    <div className="glass-card rounded-2xl p-6 relative overflow-hidden border border-slate-800 shadow-2xl">
      {/* Topology Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-6 border-b border-slate-800/80 mb-6">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/20">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 tracking-tight">
                System-Architektur-Schema: MBA Integration Platform
              </h3>
              <p className="text-xs text-slate-400">
                Interaktive Live-Topologie aller angebundenen APIs, Dienste und Browser-Sessions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-1" />
            <span className="font-semibold text-emerald-400">Core Engine Aktiv</span>
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

      {/* Interactive Topology Graph Area */}
      <div className="relative min-h-[460px] flex items-center justify-center p-2 sm:p-4">
        {/* Background Network Grid Dots */}
        <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] opacity-25 pointer-events-none" />

        {/* 2D Topology Grid Layout */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-center relative z-10">
          
          {/* LEFT COLUMN: Hermes Agent */}
          <div className="flex flex-col items-center justify-center space-y-6">
            {renderNodeCard(nodes[0])}
          </div>

          {/* CENTER COLUMN: Top Nodes + Central MBA Hub + Bottom Nodes */}
          <div className="flex flex-col items-center space-y-6 sm:space-y-8">
            {/* Top Row: Ideogram & Vectorizer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              {renderNodeCard(nodes[1])}
              {renderNodeCard(nodes[2])}
            </div>

            {/* Central MBA HUB Box */}
            <div 
              onClick={() => setSelectedNode('hub')}
              className="w-full relative group cursor-pointer"
            >
              <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500 via-primary-500 to-indigo-500 rounded-2xl blur-md opacity-40 group-hover:opacity-75 transition duration-500 group-hover:duration-200 animate-pulse" />
              <div className="relative bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-800 border-2 border-primary-500/60 rounded-2xl p-6 text-center shadow-2xl transition-all group-hover:scale-[1.02]">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-primary-600 to-cyan-500 text-white shadow-lg shadow-primary-500/30 mb-2.5">
                  <Zap className="w-6 h-6" />
                </div>
                <h4 className="text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-cyan-200 uppercase">
                  MBA HUB
                </h4>
                <p className="text-[11px] font-medium text-cyan-400 uppercase tracking-widest mt-0.5">
                  Zentrale Integrationsplattform
                </p>
                <div className="mt-3 flex items-center justify-center space-x-2 text-[11px] text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono">Port 3000 • NAS Core</span>
                </div>
              </div>
            </div>

            {/* Bottom Row: Supabase & Productor TM */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              {renderNodeCard(nodes[4])}
              {renderNodeCard(nodes[5])}
            </div>
          </div>

          {/* RIGHT COLUMN: Amazon Merch Upload Worker */}
          <div className="flex flex-col items-center justify-center space-y-6">
            {renderNodeCard(nodes[3])}
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
            className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl relative animate-scaleUp"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-xl bg-gradient-to-tr ${currentNode.color} text-white shadow-lg`}>
                  <currentNode.icon className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">{currentNode.title}</h4>
                  <p className="text-xs text-slate-400">{currentNode.subtitle}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* Details Table */}
            <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Protokoll:</span>
                <span className="font-semibold text-slate-200">{currentNode.protocol}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Status:</span>
                <span className={`font-semibold flex items-center space-x-1 ${currentNode.isOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {currentNode.isOnline ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <AlertCircle className="w-3.5 h-3.5 mr-1" />}
                  {currentNode.statusText}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Latenz / Ping:</span>
                <span className="font-mono text-cyan-400 font-bold">{currentNode.ping}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Ziel-Endpunkt:</span>
                <span className="font-mono text-[11px] text-slate-300 truncate max-w-[200px]">{currentNode.endpoint}</span>
              </div>
            </div>

            {/* Test result feedback */}
            {testResults[currentNode.id] && (
              <div className={`p-3 rounded-xl text-xs border ${
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
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={(e) => handleTestConnection(currentNode.id, e)}
                disabled={testingConnector === currentNode.id}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-2 border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingConnector === currentNode.id ? 'animate-spin text-primary-400' : ''}`} />
                <span>{testingConnector === currentNode.id ? 'Teste Verbindung...' : 'Verbindung testen'}</span>
              </button>
              
              <button
                onClick={() => {
                  setSelectedNode(null);
                  onNavigateTab(currentNode.settingsTab);
                }}
                className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-primary-500/20 transition-all"
              >
                <span>Konfiguration öffnen</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderNodeCard(node: any) {
    const Icon = node.icon;
    const isSelected = selectedNode === node.id;

    return (
      <div
        key={node.id}
        onClick={() => setSelectedNode(node.id)}
        className={`w-full group cursor-pointer relative transition-all duration-300 transform hover:-translate-y-1`}
      >
        <div className={`glass-card p-3.5 sm:p-4 rounded-xl border ${
          isSelected 
            ? 'border-primary-400 ring-2 ring-primary-500/30 shadow-xl' 
            : `${node.borderColor} shadow-lg ${node.glowColor}`
        } bg-slate-900/90 backdrop-blur-md`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <div className={`p-2 rounded-lg bg-slate-800/90 border border-slate-700/60 ${node.activeColor} group-hover:scale-110 transition-transform`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-white flex items-center space-x-1">
                  <span>{node.title}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium truncate max-w-[120px] sm:max-w-[150px]">
                  {node.subtitle}
                </div>
              </div>
            </div>

            {/* Status indicator dot */}
            <div className="flex flex-col items-end">
              <span className={`w-2.5 h-2.5 rounded-full ${
                node.isOnline ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-amber-400'
              }`} />
              <span className="text-[9px] font-mono text-slate-500 mt-1 uppercase font-semibold">
                {node.protocol}
              </span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
            <span className={node.isOnline ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
              {node.statusText}
            </span>
            <span className="font-mono text-slate-400">{node.ping}</span>
          </div>
        </div>
      </div>
    );
  }
};

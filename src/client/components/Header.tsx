import React, { useState, useEffect } from 'react';
import { Layers, Activity, Server, RefreshCw, Cpu, Sparkles } from 'lucide-react';

interface HeaderProps {
  onSync: () => void;
  isSyncing: boolean;
  activeSlots: { used: number; total: number };
}

export const Header: React.FC<HeaderProps> = ({ onSync, isSyncing, activeSlots }) => {
  const [credits, setCredits] = useState<{
    openrouter?: { usage?: number; limitRemaining?: number; limit?: number; hasKey?: boolean };
    vectorizer?: { credits?: number; details?: string; hasKey?: boolean };
  } | null>(null);

  const fetchCredits = () => {
    fetch('/api/v1/credits')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCredits(data);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchCredits();
    const interval = setInterval(fetchCredits, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const remainingSlots = Math.max(0, activeSlots.total - activeSlots.used);
  const percentage = Math.round((activeSlots.used / activeSlots.total) * 100) || 0;

  // Format OpenRouter string: Rest & Used
  const getOpenRouterText = () => {
    if (!credits?.openrouter) return 'Aktiv';
    const usage = credits.openrouter.usage !== undefined ? `$${Number(credits.openrouter.usage).toFixed(2)}` : null;
    const remaining = credits.openrouter.limitRemaining !== undefined && credits.openrouter.limitRemaining !== null
      ? `$${Number(credits.openrouter.limitRemaining).toFixed(2)}`
      : null;

    if (remaining !== null && usage !== null) {
      return `${remaining} Rest • ${usage} Used`;
    }
    if (usage !== null) {
      return `${usage} Used`;
    }
    return 'Aktiv';
  };

  return (
    <header className="h-16 border-b border-slate-800/80 bg-surface/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-accent-cyan flex items-center justify-center shadow-lg shadow-primary-500/20 ring-1 ring-white/20">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              MBA HUB
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20">
              v1.0 • TOS 6.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium hidden sm:block">Merch by Amazon Command Center</p>
        </div>
      </div>

      {/* Center Status & Live API Credits */}
      <div className="flex items-center space-x-2 sm:space-x-3 overflow-x-auto py-1">
        {/* OpenRouter Credits (Rest & Used) */}
        {credits?.openrouter?.hasKey && (
          <div className="flex items-center space-x-1.5 bg-slate-900/90 border border-accent-amber/30 px-3 py-1.5 rounded-xl text-xs font-mono">
            <Cpu className="w-3.5 h-3.5 text-accent-amber shrink-0" />
            <span className="text-slate-400 text-[11px]">OR:</span>
            <span className="font-bold text-accent-amber">{getOpenRouterText()}</span>
          </div>
        )}

        {/* Vectorizer.ai Credits */}
        {credits?.vectorizer?.hasKey && (
          <div className="flex items-center space-x-1.5 bg-slate-900/90 border border-accent-cyan/30 px-3 py-1.5 rounded-xl text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
            <span className="text-slate-400 text-[11px]">Vec:</span>
            <span className="font-bold text-accent-cyan">
              {credits.vectorizer.credits !== undefined ? `${credits.vectorizer.credits} Cr` : 'Aktiv'}
            </span>
          </div>
        )}

        {/* Daily Slot Gauge */}
        <div className="hidden lg:flex items-center space-x-3 bg-slate-900/70 border border-slate-800 rounded-xl px-3.5 py-1.5">
          <Activity className="w-3.5 h-3.5 text-accent-cyan" />
          <div className="flex flex-col">
            <div className="flex items-center space-x-2 text-xs font-semibold">
              <span className="text-slate-400">Slots:</span>
              <span className="text-slate-100">{activeSlots.used} / {activeSlots.total} ({remainingSlots} frei)</span>
            </div>
            <div className="w-28 h-1 bg-slate-800 rounded-full mt-0.5 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-accent-cyan to-primary-500 rounded-full transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Server NAS IP */}
        <div className="hidden xl:flex items-center space-x-1.5 text-xs font-medium text-slate-400 bg-slate-900/70 border border-slate-800 rounded-xl px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <Server className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          <span>NAS: <strong className="text-slate-200">192.168.178.141</strong></span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2 shrink-0">
        <button
          onClick={() => {
            fetchCredits();
            onSync();
          }}
          disabled={isSyncing}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-primary-400' : 'text-slate-400'}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Synchronisiere...' : 'Sync'}</span>
        </button>
      </div>
    </header>
  );
};

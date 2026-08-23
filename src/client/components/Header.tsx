import React from 'react';
import { Layers, Activity, Wifi, ShieldCheck, RefreshCw, Server } from 'lucide-react';

interface HeaderProps {
  onSync: () => void;
  isSyncing: boolean;
  activeSlots: { used: number; total: number };
}

export const Header: React.FC<HeaderProps> = ({ onSync, isSyncing, activeSlots }) => {
  const remainingSlots = Math.max(0, activeSlots.total - activeSlots.used);
  const percentage = Math.round((activeSlots.used / activeSlots.total) * 100) || 0;

  return (
    <header className="h-16 border-b border-slate-800/80 bg-surface/60 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-accent-cyan flex items-center justify-center shadow-lg shadow-primary-500/20 ring-1 ring-white/20">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              MBA HUB
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20">
              v1.0 • TOS 6.0
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium">Merch by Amazon Command Center</p>
        </div>
      </div>

      {/* Center Status Indicators */}
      <div className="hidden lg:flex items-center space-x-6">
        {/* Daily Slot Gauge */}
        <div className="flex items-center space-x-3 bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-2">
          <Activity className="w-4 h-4 text-accent-cyan" />
          <div className="flex flex-col">
            <div className="flex items-center justify-between space-x-4 text-xs font-semibold">
              <span className="text-slate-400">Tages-Slots:</span>
              <span className="text-slate-100">{activeSlots.used} / {activeSlots.total} ({remainingSlots} frei)</span>
            </div>
            <div className="w-36 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-accent-cyan to-primary-500 rounded-full transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Server & Keep-Alive Status */}
        <div className="flex items-center space-x-2 text-xs font-medium text-slate-400 bg-slate-900/70 border border-slate-800 rounded-xl px-3.5 py-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <Server className="w-3.5 h-3.5 text-slate-400 ml-1" />
          <span>Docker NAS: <strong className="text-slate-200">192.168.178.141</strong></span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-primary-400' : 'text-slate-400'}`} />
          <span>{isSyncing ? 'Synchronisiere...' : 'MBA Quick Sync'}</span>
        </button>

        <div className="h-8 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

        <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400 hidden sm:inline">Amazon Session Warm</span>
        </div>
      </div>
    </header>
  );
};

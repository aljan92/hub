import React, { useState } from 'react';
import { 
  UploadCloud, 
  Play, 
  Clock, 
  ToggleLeft, 
  ToggleRight, 
  Layers, 
  Scissors, 
  Coffee, 
  Smartphone, 
  CheckCircle2, 
  AlertTriangle,
  Settings as SettingsIcon,
  Trash2
} from 'lucide-react';

export const QueueView: React.FC = () => {
  const [globalMode, setGlobalMode] = useState<'live' | 'draft'>('draft');
  const [isUploading, setIsUploading] = useState(false);

  const [queueItems, setQueueItems] = useState([
    {
      id: 'q-1',
      title: 'Vintage Sunset Surfer Cat',
      productCount: 102,
      optimizedCount: 100,
      slotPruned: '2 Marktplätze (US Zip Hoodie) abgewählt um in 100 Slots zu passen',
      mode: 'draft',
      status: 'Ready',
      features: {
        generalResize: true,
        mugBrush: true,
        popSocket: true,
        phoneCase: true,
      },
      image: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=300&auto=format&fit=crop&q=80'
    },
    {
      id: 'q-2',
      title: 'Retro Synthwave Mountain Cyberpunk',
      productCount: 84,
      optimizedCount: 84,
      slotPruned: 'Passt vollständig in freie Slots',
      mode: 'draft',
      status: 'Ready',
      features: {
        generalResize: true,
        mugBrush: false,
        popSocket: true,
        phoneCase: true,
      },
      image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&auto=format&fit=crop&q=80'
    }
  ]);

  const handleStartQueue = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      alert('Upload-Queue gestartet! Der Chrome-Worker führt den Upload über die persistente Session durch.');
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <UploadCloud className="w-6 h-6 mr-2 text-accent-cyan" />
            Upload Queue &amp; Slot-Optimierung
          </h2>
          <p className="text-sm text-slate-400">Automatische Upload-Warteschlange mit General Resize, Mug-Brush und dynamischem Slot-Filling.</p>
        </div>

        {/* Global Live/Draft Toggle & Start Action */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2">
            <span className="text-xs font-semibold text-slate-300">Upload Modus:</span>
            <button
              onClick={() => setGlobalMode(globalMode === 'draft' ? 'live' : 'draft')}
              className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                globalMode === 'live' 
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-primary-500/20 text-primary-300 border-primary-500/40'
              }`}
            >
              {globalMode === 'live' ? '🔴 Live Publish' : '🟡 Draft (Entwurf)'}
            </button>
          </div>

          <button
            onClick={handleStartQueue}
            disabled={isUploading || queueItems.length === 0}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-accent-cyan to-primary-600 hover:from-accent-cyan/90 hover:to-primary-500 text-slate-950 shadow-lg shadow-accent-cyan/20 flex items-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{isUploading ? 'Wird hochgeladen...' : 'Queue jetzt starten'}</span>
          </button>
        </div>
      </div>

      {/* Dynamic Slot Filler Banner */}
      <div className="glass-panel p-4 rounded-2xl border border-primary-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-primary-950/40 to-slate-900/80">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-primary-500/20 text-primary-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-100">Automatischer Slot-Filler Scheduler</h4>
            <p className="text-xs text-slate-400">
              Nächster geplanter Durchlauf: <strong className="text-slate-200">Heute um 04:00 Uhr früh</strong> (Füllt verbleibende Tages-Slots automatisch).
            </p>
          </div>
        </div>
        <div className="text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-accent-cyan">
          Tages-Limit Ziel: 100 / 100 Slots
        </div>
      </div>

      {/* Queue Items List */}
      <div className="space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Warteschlangen-Einträge ({queueItems.length})
        </div>

        {queueItems.map((item) => (
          <div key={item.id} className="glass-card p-5 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Item Info */}
              <div className="flex items-center space-x-4">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-800 shrink-0"
                />
                <div>
                  <h4 className="font-bold text-sm text-slate-100">{item.title}</h4>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20">
                      {item.status}
                    </span>
                    <span className="text-xs text-slate-400">
                      Produkte: <strong className="text-slate-200">{item.optimizedCount}</strong> (von {item.productCount})
                    </span>
                  </div>
                </div>
              </div>

              {/* Optimization Badges */}
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1.5 text-xs text-slate-400 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800">
                  {item.features.mugBrush && (
                    <span className="flex items-center text-accent-amber" title="Schwarzer Brush für weiße Tasse aktiv">
                      <Coffee className="w-3.5 h-3.5 mr-1" /> Mug Brush
                    </span>
                  )}
                  <span className="text-slate-600">•</span>
                  <span className="flex items-center text-accent-cyan" title="Auto Resizing für PopSockets & Phone Cases">
                    <Smartphone className="w-3.5 h-3.5 mr-1" /> General Resize
                  </span>
                </div>

                <button
                  onClick={() => setQueueItems(queueItems.filter(q => q.id !== item.id))}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Slot-Filling Optimization Reason Box */}
            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-xs flex items-center justify-between text-slate-400">
              <span className="flex items-center">
                <Scissors className="w-3.5 h-3.5 mr-1.5 text-primary-400" />
                Slot-Optimizer Anpassung: <strong className="text-slate-300 ml-1">{item.slotPruned}</strong>
              </span>
              <span className="text-[11px] font-mono text-emerald-400">Optimal fit ✓</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

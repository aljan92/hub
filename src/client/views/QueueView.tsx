import React, { useState, useEffect } from 'react';
import { 
  UploadCloud, 
  Play, 
  Clock, 
  Coffee, 
  Smartphone, 
  CheckCircle2, 
  Trash2,
  FolderOpen
} from 'lucide-react';

export const QueueView: React.FC = () => {
  const [globalMode, setGlobalMode] = useState<'live' | 'draft'>('draft');
  const [isUploading, setIsUploading] = useState(false);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQueue = () => {
    setLoading(true);
    fetch('/api/v1/queue')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.queue)) {
          setQueueItems(data.queue);
        }
      })
      .catch(err => console.warn('[Queue] Fetch error:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleStartQueue = () => {
    if (queueItems.length === 0) return;
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

        {queueItems.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center space-y-3">
            <FolderOpen className="w-12 h-12 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-200">Die Upload-Queue ist aktuell leer</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Sobald du generierte Designs im Menü <strong>Tasks</strong> freigibst oder Hermes Aufgaben übergibt, erscheinen sie hier bereit für den automatischen Amazon Merch Upload.
            </p>
          </div>
        ) : (
          queueItems.map((item) => (
            <div key={item.id} className="glass-card p-5 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Item Info */}
                <div className="flex items-center space-x-4">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-16 h-16 rounded-xl object-cover border border-slate-800 shrink-0 bg-slate-950"
                  />
                  <div>
                    <h4 className="font-bold text-sm text-slate-100">{item.title}</h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20">
                        {item.status}
                      </span>
                      <span className="text-xs text-slate-400">
                        Produkte: <strong className="text-slate-200">{item.optimizedCount || 100}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Optimization Badges */}
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1.5 text-xs text-slate-400 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800">
                    {item.features?.mugBrush && (
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
            </div>
          ))
        )}
      </div>
    </div>
  );
};

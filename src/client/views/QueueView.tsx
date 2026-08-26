import React, { useState, useEffect } from 'react';
import { 
  UploadCloud, 
  Play, 
  Clock, 
  Lock, 
  Unlock, 
  Trash2, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  Globe, 
  Sparkles, 
  ShieldCheck, 
  ShieldAlert, 
  Scissors, 
  ExternalLink,
  Sliders,
  Check,
  GripVertical,
  Monitor,
  Square,
  X,
  Users,
  Palette
} from 'lucide-react';
import { BrowserScreencast } from '../components/BrowserScreencast';

interface QueueItem {
  id: string;
  taskId: string;
  designTitle: string;
  niche: string;
  bullet1: string;
  bullet2: string;
  description: string;
  listings?: Record<string, {
    brand?: string;
    title?: string;
    bullet1?: string;
    bullet2?: string;
    description?: string;
  }>;
  fitTypes?: string[];
  avoidColor?: 'white' | 'black' | 'none';
  customBackgroundColor?: string;
  brand: string;
  title: string;
  imagePath: string;
  pngPath: string;
  addedAt: string;
  status: 'SCHEDULED_TODAY' | 'WAITING_FOR_SLOTS' | 'UPLOADING' | 'COMPLETED' | 'ERROR';
  isLocked: boolean;
  allocatedSlots: number;
  totalBaseSlots: number;
  activeProductsMap: Record<string, string[]>;
  droppedSlotsMap: Record<string, string[]>;
  tmBlockedProductIds: string[];
  errorMessage?: string;
  sortOrder: number;
}

interface QueueState {
  items: QueueItem[];
  freeDailySlots: number;
  usedSlotsToday: number;
  totalDailySlots: number;
  scheduledSlotsToday: number;
  uploadScheduleTime: string;
  maxDropPerDesign: number;
  autoBalance: boolean;
  maxDroppableCapacity: number;
}

interface UploadProgressState {
  isUploading: boolean;
  currentQueueId: string | null;
  taskId: string | null;
  designTitle: string | null;
  mode: 'draft' | 'publish';
  currentStep: string;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  logs: string[];
  error?: string;
}

const SCHEDULE_OPTIONS = [
  { value: 'off', label: 'Aus (Nur Manuell)' },
  { value: '01:00', label: '01:00 Uhr' },
  { value: '02:00', label: '02:00 Uhr' },
  { value: '03:00', label: '03:00 Uhr' },
  { value: '04:00', label: '04:00 Uhr (Standard)' },
  { value: '05:00', label: '05:00 Uhr' },
  { value: '06:00', label: '06:00 Uhr' },
  { value: '07:00', label: '07:00 Uhr' },
  { value: '08:00', label: '08:00 Uhr' },
  { value: '12:00', label: '12:00 Uhr (Mittags)' },
  { value: '18:00', label: '18:00 Uhr' },
  { value: '22:00', label: '22:00 Uhr' },
];

export const QueueView: React.FC = () => {
  const [queueState, setQueueState] = useState<QueueState>({
    items: [],
    freeDailySlots: 200,
    usedSlotsToday: 0,
    totalDailySlots: 200,
    scheduledSlotsToday: 0,
    uploadScheduleTime: 'off',
    maxDropPerDesign: 10,
    autoBalance: true,
    maxDroppableCapacity: 0
  });

  const [loading, setLoading] = useState(false);
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemLanguageMap, setItemLanguageMap] = useState<Record<string, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [globalMode, setGlobalMode] = useState<'live' | 'draft'>('draft');
  const [isScreencastOpen, setIsScreencastOpen] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/v1/queue');
      const data = await res.json();
      if (data.success) {
        setQueueState(data);
      }
    } catch (err) {
      console.warn('[Queue] Fetch error:', err);
    }
  };

  const fetchUploadStatus = async () => {
    try {
      const res = await fetch('/api/v1/upload/status');
      const data = await res.json();
      if (data.success && data.status) {
        setUploadProgress(data.status);
      }
    } catch (err) {
      console.warn('[Queue] Upload status error:', err);
    }
  };

  useEffect(() => {
    fetchQueue();
    fetchUploadStatus();
    const interval = setInterval(() => {
      fetchQueue();
      fetchUploadStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRebalance = async () => {
    setIsRebalancing(true);
    try {
      const res = await fetch('/api/v1/queue/rebalance', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Rebalance error:', err);
    } finally {
      setIsRebalancing(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<{ uploadScheduleTime: string; maxDropPerDesign: number; autoBalance: boolean }>) => {
    try {
      const res = await fetch('/api/v1/queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Settings update error:', err);
    }
  };

  const handleToggleLock = async (queueId: string) => {
    try {
      const res = await fetch(`/api/v1/queue/item/${queueId}/lock`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Toggle lock error:', err);
    }
  };

  const handleRemoveItem = async (queueId: string) => {
    if (!confirm('Dieses Design wirklich aus der Upload-Queue entfernen?')) return;
    try {
      const res = await fetch(`/api/v1/queue/item/${queueId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Remove item error:', err);
    }
  };

  const handleClearQueue = async (onlyCompleted = true) => {
    try {
      const res = await fetch(`/api/v1/queue?onlyCompleted=${onlyCompleted}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Clear queue error:', err);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newItems = [...queueState.items];
    const [movedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(dropIndex, 0, movedItem);

    // Instant optimistic UI update
    setQueueState(prev => ({ ...prev, items: newItems }));
    setDraggedIndex(null);

    // Persist reorder to server & rebalance
    try {
      const itemIds = newItems.map(i => i.id);
      const res = await fetch('/api/v1/queue/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds })
      });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Reorder error:', err);
    }
  };

  const handleStartUpload = async (queueId?: string) => {
    try {
      const res = await fetch('/api/v1/upload/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId, mode: globalMode })
      });
      const data = await res.json();
      if (data.success) {
        fetchUploadStatus();
        fetchQueue();
      } else {
        alert(data.message || data.error || 'Fehler beim Starten des Uploads');
      }
    } catch (err) {
      console.error('Start upload error:', err);
    }
  };

  const handleCancelUpload = async () => {
    try {
      const res = await fetch('/api/v1/upload/cancel', { method: 'POST' });
      const data = await res.json();
      fetchUploadStatus();
      fetchQueue();
    } catch (err) {
      console.error('Cancel upload error:', err);
    }
  };

  const scheduledDesigns = queueState.items.filter(i => i.status === 'SCHEDULED_TODAY' || i.status === 'UPLOADING');
  const waitingDesigns = queueState.items.filter(i => i.status === 'WAITING_FOR_SLOTS');
  const slotUtilizationPct = queueState.freeDailySlots > 0 
    ? Math.min(100, Math.round((queueState.scheduledSlotsToday / queueState.freeDailySlots) * 100))
    : 0;

  const isUploadActive = uploadProgress?.isUploading ?? false;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20 text-accent-cyan">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                Upload Queue &amp; Slot-Optimizer
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                  Phase 6 Upload Worker
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Intelligentes Slot-Balancing, Kaskaden-Kürzung und vollautomatisierter Playwright-Upload in Session 2
              </p>
            </div>
          </div>
        </div>

        {/* Global Action & Upload Trigger */}
        <div className="flex items-center flex-wrap gap-3">
          {/* Live Screencast Button */}
          <button
            onClick={() => setIsScreencastOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700/80 flex items-center space-x-2 transition-all shadow-sm"
            title="Session 2 Live-Screencast ansehen"
          >
            <Monitor className="w-4 h-4 text-accent-cyan" />
            <span>Screencast (Session 2)</span>
          </button>

          {/* Mode Selector */}
          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2">
            <span className="text-xs font-semibold text-slate-300">Modus:</span>
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

          {/* Start / Cancel Upload Button */}
          {isUploadActive ? (
            <button
              onClick={handleCancelUpload}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 flex items-center space-x-2 transition-all active:scale-98"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Upload abbrechen</span>
            </button>
          ) : (
            <button
              onClick={() => handleStartUpload()}
              disabled={scheduledDesigns.length === 0}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-accent-cyan to-primary-600 hover:from-accent-cyan/90 hover:to-primary-500 text-slate-950 shadow-lg shadow-accent-cyan/20 flex items-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Jetzt hochladen</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Upload Progress Banner (if upload is running or recently finished) */}
      {uploadProgress && (uploadProgress.isUploading || uploadProgress.currentStep !== 'Bereit') && (
        <div className={`border rounded-2xl p-4.5 shadow-lg backdrop-blur-md transition-all ${
          uploadProgress.isUploading 
            ? 'bg-primary-950/40 border-primary-500/40 shadow-primary-500/10 animate-pulse'
            : uploadProgress.error 
              ? 'bg-rose-950/40 border-rose-500/40 shadow-rose-500/10'
              : 'bg-emerald-950/40 border-emerald-500/40 shadow-emerald-500/10'
        }`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-xl border ${
                uploadProgress.isUploading 
                  ? 'bg-primary-500/20 text-primary-300 border-primary-500/30' 
                  : uploadProgress.error
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}>
                {uploadProgress.isUploading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : uploadProgress.error ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                    Task #{uploadProgress.taskId || '—'}
                  </span>
                  <h3 className="text-sm font-bold text-slate-100">
                    {uploadProgress.designTitle || 'Aktiver Upload-Vorgang'}
                  </h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    uploadProgress.mode === 'publish'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}>
                    {uploadProgress.mode === 'publish' ? '🔴 LIVE PUBLISH' : '🟡 DRAFT'}
                  </span>
                </div>
                <div className="text-xs text-slate-300 mt-1 font-medium flex items-center space-x-2">
                  <span>{uploadProgress.currentStep}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <span className="text-xl font-bold font-mono text-slate-100">
                {uploadProgress.percent}%
              </span>
              <button
                onClick={() => setIsScreencastOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700 flex items-center space-x-1.5 transition-all"
              >
                <Monitor className="w-3.5 h-3.5 text-accent-cyan" />
                <span>Live ansehen</span>
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-900/80 rounded-full h-2 overflow-hidden border border-slate-800 mb-2">
            <div 
              className={`h-full transition-all duration-500 ${
                uploadProgress.error 
                  ? 'bg-rose-500' 
                  : 'bg-gradient-to-r from-accent-cyan via-primary-500 to-emerald-400'
              }`}
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>

          {/* Recent Log Snippet */}
          {uploadProgress.logs && uploadProgress.logs.length > 0 && (
            <div className="text-[11px] font-mono text-slate-400 bg-slate-950/70 rounded-xl p-2 border border-slate-800/80 max-h-20 overflow-y-auto space-y-0.5">
              {uploadProgress.logs.slice(-3).map((log, idx) => (
                <div key={idx} className="truncate">{log}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Daily Free Slots */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Freie Tages-Slots</span>
            <Layers className="w-4 h-4 text-accent-cyan" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-100 font-mono">{queueState.freeDailySlots}</span>
            <span className="text-xs text-slate-400">von {queueState.totalDailySlots} Slots</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Bereits verbraucht heute: {queueState.usedSlotsToday}
          </div>
        </div>

        {/* Scheduled Today Slots */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Geplante Slots Heute</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-emerald-400 font-mono">{queueState.scheduledSlotsToday}</span>
            <span className="text-xs text-slate-400">Slots gebucht</span>
          </div>
          {/* Capacity Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                slotUtilizationPct > 95 ? 'bg-amber-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${slotUtilizationPct}%` }}
            />
          </div>
        </div>

        {/* Designs in Queue */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Designs in Queue</span>
            <Clock className="w-4 h-4 text-primary-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-100 font-mono">{queueState.items.length}</span>
            <span className="text-xs text-slate-400">
              ({scheduledDesigns.length} heute aktiv / {waitingDesigns.length} wartend)
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Reihenfolge per Drag &amp; Drop anpassbar
          </div>
        </div>

        {/* Droppable Capacity Indicator */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Kürzungs-Puffer</span>
            <Scissors className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-amber-400 font-mono">{queueState.maxDroppableCapacity}</span>
            <span className="text-xs text-slate-400">Slots max. kürzbar</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Max. {queueState.maxDropPerDesign} Slots pro Design
          </div>
        </div>
      </div>

      {/* Control Panel: Scheduling & Balancing Settings */}
      <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center flex-wrap gap-4">
          {/* Upload Schedule Time Control */}
          <div className="flex items-center space-x-2.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">Upload Startzeit:</span>

            {/* Enable/Disable Toggle */}
            <button
              onClick={() => {
                const nextVal = queueState.uploadScheduleTime === 'off' ? '04:00' : 'off';
                handleUpdateSettings({ uploadScheduleTime: nextVal });
              }}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                queueState.uploadScheduleTime !== 'off'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {queueState.uploadScheduleTime !== 'off' ? 'Aktiv' : 'Aus (Nur Manuell)'}
            </button>

            {/* Native Time Picker for precise Hours & Minutes */}
            {queueState.uploadScheduleTime !== 'off' && (
              <input
                type="time"
                value={queueState.uploadScheduleTime}
                onChange={(e) => handleUpdateSettings({ uploadScheduleTime: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent-cyan"
              />
            )}
          </div>

          {/* Stepper for Max Drop Tolerance per Design */}
          <div className="flex items-center space-x-2.5 border-l border-slate-800 pl-4">
            <Sliders className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">Max. Kürzungs-Toleranz:</span>
            
            <div className="flex items-center space-x-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => {
                  const next = Math.max(0, queueState.maxDropPerDesign - 1);
                  handleUpdateSettings({ maxDropPerDesign: next });
                }}
                className="px-2 py-0.5 rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                title="Toleranz verringern"
              >
                -
              </button>

              <input
                type="number"
                min="0"
                max="50"
                value={queueState.maxDropPerDesign}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(50, Number(e.target.value) || 0));
                  handleUpdateSettings({ maxDropPerDesign: val });
                }}
                className="w-10 text-center bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none"
              />

              <button
                onClick={() => {
                  const next = Math.min(50, queueState.maxDropPerDesign + 1);
                  handleUpdateSettings({ maxDropPerDesign: next });
                }}
                className="px-2 py-0.5 rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                title="Toleranz erhöhen"
              >
                +
              </button>
            </div>
            <span className="text-[11px] text-slate-500">Slots / Design</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRebalance}
            disabled={isRebalancing}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700 flex items-center space-x-1.5 transition-all shadow-sm"
            title="Slot-Berechnung manuell neu anstoßen"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebalancing ? 'animate-spin' : ''}`} />
            <span>Neu ausbalancieren</span>
          </button>

          {queueState.items.some(i => i.status === 'COMPLETED') && (
            <button
              onClick={() => handleClearQueue(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 transition-all"
            >
              Erledigte leeren
            </button>
          )}
        </div>
      </div>

      {/* Queue Items List */}
      {queueState.items.length === 0 ? (
        <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
            <UploadCloud className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-200">Keine Designs in der Queue</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
            Sobald ein Design in der Ideogram- &amp; Vision-Pipeline final freigegeben wird, wandert es vollautomatisch hier in die Queue.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>Reihenfolge der Designs (Priorität von oben nach unten)</span>
            <span>{queueState.items.length} Designs in Warteschlange</span>
          </div>

          <div className="space-y-3">
            {queueState.items.map((item, index) => {
              const isScheduled = item.status === 'SCHEDULED_TODAY' || item.status === 'UPLOADING';
              const isExpanded = expandedItemId === item.id;
              const isDragging = draggedIndex === index;
              const isDragOver = dragOverIndex === index;
              const droppedCount = Object.values(item.droppedSlotsMap).reduce((sum, list) => sum + list.length, 0);

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`bg-surface/90 border rounded-2xl p-4 shadow-sm backdrop-blur-md transition-all overflow-hidden relative ${
                    isDragging ? 'opacity-40 scale-[0.99] border-dashed border-accent-cyan' : ''
                  } ${
                    isDragOver ? 'border-accent-cyan ring-2 ring-accent-cyan/30 scale-[1.01]' : ''
                  } ${
                    isScheduled && !isDragging && !isDragOver
                      ? 'border-emerald-500/40 shadow-emerald-500/5'
                      : (!isDragging && !isDragOver ? 'border-slate-800/80 opacity-75 hover:opacity-100' : '')
                  }`}
                >
                  {/* Top Row: Drag Handle, Thumbnail, Title, Badges, Lock & Actions */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3 sm:space-x-4">
                      {/* Drag Handle */}
                      <div 
                        className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-200 p-1 -ml-1 rounded transition-colors"
                        title="Ziehen um Reihenfolge zu ändern"
                      >
                        <GripVertical className="w-5 h-5" />
                      </div>

                      {/* Image Thumbnail */}
                      <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 relative group">
                        {item.imagePath ? (
                          <img 
                            src={item.imagePath.startsWith('/') ? item.imagePath : `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`} 
                            alt={item.designTitle}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <Layers className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      {/* Title & Task ID */}
                      <div className="max-w-xl">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                            #{index + 1}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary-500/15 text-primary-300 border border-primary-500/30 shrink-0 font-bold">
                            Task {item.taskId.startsWith('#') ? item.taskId : `#${item.taskId}`}
                          </span>
                          <h3 className="text-sm font-bold text-slate-100 leading-snug" title={item.title || item.designTitle}>
                            {item.title || item.designTitle}
                          </h3>
                        </div>
                      </div>
                    </div>

                    {/* Status Badges, Hero-Lock & Controls */}
                    <div className="flex items-center flex-wrap gap-2.5">
                      {/* Allocation Badge */}
                      <div className="flex flex-col items-end">
                        <span className={`px-3 py-1 rounded-xl text-xs font-bold font-mono border ${
                          item.status === 'COMPLETED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : item.status === 'UPLOADING'
                              ? 'bg-primary-500/20 text-primary-300 border-primary-500/40 animate-pulse'
                              : isScheduled
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}>
                          {item.status === 'COMPLETED'
                            ? '✓ Hochgeladen'
                            : item.status === 'UPLOADING'
                              ? '⚡ Lädt hoch...'
                              : isScheduled 
                                ? `⚡ ${item.allocatedSlots} Slots Heute Aktiv` 
                                : `⏳ ${item.allocatedSlots} Slots Wartend`}
                        </span>
                        {droppedCount > 0 && isScheduled && item.status !== 'COMPLETED' && (
                          <span className="text-[10px] text-amber-400/90 font-mono mt-0.5">
                            ({droppedCount} Slots gekürzt)
                          </span>
                        )}
                      </div>

                      {/* Upload Single Button */}
                      <button
                        onClick={() => handleStartUpload(item.id)}
                        disabled={isUploadActive}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-accent-cyan border border-slate-700 transition-colors disabled:opacity-50"
                        title="Dieses Design einzeln hochladen"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>

                      {/* Hero-Lock Button */}
                      <button
                        onClick={() => handleToggleLock(item.id)}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                          item.isLocked
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700/80'
                        }`}
                        title={item.isLocked ? 'Hero-Lock aktiv: Behält 100% seiner Slots' : 'Hero-Lock aktivieren'}
                      >
                        {item.isLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                        <span>{item.isLocked ? 'Hero Locked' : 'Optimierbar'}</span>
                      </button>

                      {/* Expand / Details Button */}
                      <button
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors"
                        title="Details aufklappen"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>

                      {/* Remove Button */}
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-500/30 transition-colors"
                        title="Aus Queue entfernen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Accordion: Details & Question-Phase Settings */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-4 animate-fadeIn">
                      {/* Question-Phase Preferences Bar */}
                      <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-950/50 border border-slate-800 p-2.5 rounded-xl">
                        <div className="flex items-center space-x-1.5 text-slate-300">
                          <Users className="w-3.5 h-3.5 text-primary-400" />
                          <span className="font-semibold">Fit-Types:</span>
                          <span className="font-mono text-slate-200">
                            {(item.fitTypes && item.fitTypes.length > 0) ? item.fitTypes.join(', ').toUpperCase() : 'MEN, WOMEN, YOUTH'}
                          </span>
                        </div>

                        <span className="text-slate-700">•</span>

                        <div className="flex items-center space-x-1.5 text-slate-300">
                          <Palette className="w-3.5 h-3.5 text-amber-400" />
                          <span className="font-semibold">Farbregel:</span>
                          <span className="font-mono text-slate-200">
                            {item.avoidColor === 'white' 
                              ? 'Weiß vermieden (Raglan white_* ausgeschlossen)' 
                              : item.avoidColor === 'black'
                                ? 'Schwarz vermieden (Hex-Picker #FFFFFF)'
                                : 'Standard (Alle Swatches / Hex #000000)'}
                          </span>
                        </div>
                      </div>

                      {/* SEO Listing Section with Multi-Language Switcher */}
                      {(() => {
                        const activeLang = itemLanguageMap[item.id] || 'en';
                        const listingsObj = item.listings || {};
                        const availableLangs = Object.keys(listingsObj).length > 0 ? Object.keys(listingsObj) : ['en'];
                        if (!availableLangs.includes('en')) availableLangs.unshift('en');

                        // Ensure standard languages are present in list if exists
                        const standardLangs = ['en', 'de', 'fr', 'es', 'it', 'jp'];
                        const allLangs = Array.from(new Set([...standardLangs.filter(l => listingsObj[l] || l === 'en'), ...availableLangs]));

                        const currentListing = listingsObj[activeLang] || listingsObj.en || {
                          brand: item.brand,
                          title: item.title,
                          bullet1: item.bullet1,
                          bullet2: item.bullet2,
                          description: item.description
                        };

                        const langFlags: Record<string, { label: string; flag: string }> = {
                          en: { label: 'Englisch', flag: '🇺🇸 / 🇬🇧' },
                          de: { label: 'Deutsch', flag: '🇩🇪' },
                          fr: { label: 'Französisch', flag: '🇫🇷' },
                          es: { label: 'Spanisch', flag: '🇪🇸' },
                          it: { label: 'Italienisch', flag: '🇮🇹' },
                          jp: { label: 'Japanisch', flag: '🇯🇵' }
                        };

                        return (
                          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                              <div className="flex items-center space-x-2">
                                <Globe className="w-4 h-4 text-accent-cyan" />
                                <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                                  Vollständiges SEO Listing
                                </span>
                                <span className="text-[10px] font-mono text-slate-500">Task #{item.taskId}</span>
                              </div>

                              {/* Language Switcher Tabs */}
                              <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
                                {allLangs.map((langKey) => {
                                  const langInfo = langFlags[langKey] || { label: langKey.toUpperCase(), flag: '🌐' };
                                  const isSelected = activeLang === langKey;
                                  return (
                                    <button
                                      key={langKey}
                                      onClick={() => setItemLanguageMap(prev => ({ ...prev, [item.id]: langKey }))}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                                        isSelected
                                          ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40 shadow-sm'
                                          : 'bg-slate-950/80 text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-800/60'
                                      }`}
                                    >
                                      <span>{langInfo.flag}</span>
                                      <span className="uppercase font-mono text-[11px]">{langKey}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Detailed Listing Fields */}
                            <div className="space-y-2 text-xs">
                              {/* Title */}
                              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider mb-1 flex items-center justify-between">
                                  <span>Titel</span>
                                  <span className="text-slate-500">{(currentListing.title || item.title || '').length} / 60 Zeichen</span>
                                </div>
                                <div className="text-slate-100 font-semibold leading-relaxed">
                                  {currentListing.title || item.title || <span className="text-slate-600 italic">— Kein Titel hinterlegt —</span>}
                                </div>
                              </div>

                              {/* Brand */}
                              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider mb-1 flex items-center justify-between">
                                  <span>Brand / Marke</span>
                                  <span className="text-slate-500">{(currentListing.brand || item.brand || '').length} / 50 Zeichen</span>
                                </div>
                                <div className="text-slate-200 font-medium">
                                  {currentListing.brand || item.brand || <span className="text-slate-600 italic">— Keine Brand hinterlegt —</span>}
                                </div>
                              </div>

                              {/* Bullet Points */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider mb-1 flex items-center justify-between">
                                    <span>Bullet Point 1</span>
                                    <span className="text-slate-500">{(currentListing.bullet1 || item.bullet1 || '').length} / 256</span>
                                  </div>
                                  <div className="text-slate-300 text-[11px] leading-relaxed">
                                    {currentListing.bullet1 || item.bullet1 || <span className="text-slate-600 italic">— Kein Bullet 1 —</span>}
                                  </div>
                                </div>

                                <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider mb-1 flex items-center justify-between">
                                    <span>Bullet Point 2</span>
                                    <span className="text-slate-500">{(currentListing.bullet2 || item.bullet2 || '').length} / 256</span>
                                  </div>
                                  <div className="text-slate-300 text-[11px] leading-relaxed">
                                    {currentListing.bullet2 || item.bullet2 || <span className="text-slate-600 italic">— Kein Bullet 2 —</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Description */}
                              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider mb-1 flex items-center justify-between">
                                  <span>Produktbeschreibung (Description)</span>
                                  <span className="text-slate-500">{(currentListing.description || item.description || '').length} / 2000</span>
                                </div>
                                <div className="text-slate-300 text-[11px] leading-relaxed whitespace-pre-line">
                                  {currentListing.description || item.description || <span className="text-slate-600 italic">— Keine Beschreibung —</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* TM Blocked Items Notice (if any) */}
                      {item.tmBlockedProductIds && item.tmBlockedProductIds.length > 0 && (
                        <div className="flex items-center space-x-2 text-xs text-rose-300 bg-rose-950/30 border border-rose-500/30 p-2.5 rounded-xl">
                          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>Durch Trademark (TM) gesperrte Produkt-Klassen: <strong>{item.tmBlockedProductIds.join(', ')}</strong> (Hero-Lock hebt TM-Sperren nicht auf).</span>
                        </div>
                      )}

                      {/* Active & Dropped Marketplace Matrix */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                          <span>Zugewiesene Produkte &amp; Marktplätze ({item.allocatedSlots} Slots)</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {Object.entries(item.activeProductsMap).map(([prodId, mps]) => {
                            const droppedMps = item.droppedSlotsMap[prodId] || [];
                            return (
                              <div key={prodId} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                                <div className="font-bold text-slate-200 truncate">{prodId}</div>
                                <div className="flex items-center flex-wrap gap-1 mt-1 font-mono text-[10px]">
                                  {/* Active Markets */}
                                  {mps.map(mp => (
                                    <span key={mp} className={`px-1.5 py-0.2 rounded ${
                                      mp.toUpperCase() === 'US' 
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold'
                                        : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                    }`}>
                                      {mp}
                                    </span>
                                  ))}
                                  {/* Dropped Markets (Strikethrough) */}
                                  {droppedMps.map(mp => (
                                    <span key={mp} className="px-1.5 py-0.2 rounded bg-rose-950/40 text-rose-400/80 border border-rose-900/60 line-through">
                                      {mp}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Screencast Modal */}
      {isScreencastOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border border-slate-800 rounded-3xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden shadow-2xl relative">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center space-x-2">
                <Monitor className="w-5 h-5 text-accent-cyan" />
                <h3 className="text-sm font-bold text-slate-100">
                  Live Browser-Screencast (Session 2: Upload Worker)
                </h3>
              </div>
              <button
                onClick={() => setIsScreencastOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                title="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Screencast Container */}
            <div className="flex-1 p-2 bg-slate-950 overflow-hidden">
              <BrowserScreencast onClose={() => setIsScreencastOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueueView;

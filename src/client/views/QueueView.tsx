import React, { useState, useEffect, useRef } from 'react';
import { 
  UploadCloud, 
  Play, 
  Pause,
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
  ShieldAlert, 
  Scissors, 
  Sliders, 
  GripVertical, 
  Monitor, 
  Square, 
  X, 
  Users, 
  RotateCcw,
  ListOrdered,
  Package,
  Plus,
  Minus,
  Info,
  Database,
  Power,
  Loader2
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
  brand: string;
  title: string;
  status: QueueItemStatus;
  isLocked: boolean;
  isPaused?: boolean;
  allocatedSlots: number;
  totalBaseSlots: number;
  activeProductsMap: Record<string, string[]>;
  droppedSlotsMap: Record<string, string[]>;
  tmBlockedProductIds: string[];
  sortOrder: number;
  addedAt: string;
  uploadedAt?: string;
  lastUploadAttempt?: string;
  errorMessage?: string;
  fitTypes?: string[];
  avoidColor?: 'white' | 'black' | 'none';
  customBackgroundColor?: string;
  imagePath?: string;
}

interface QueueState {
  items: QueueItem[];
  freeDailySlots: number;
  usedSlotsToday: number;
  totalDailySlots: number;
  scheduledSlotsToday: number;
  scheduledItemsCount?: number;
  overflowItemsCount?: number;
  uploadScheduleTime: string;
  maxDropPerDesign: number;
  autoBalance: boolean;
  maxDroppableCapacity: number;
  uploadMode?: 'draft' | 'live';
  draftProductsPerDesign?: number;
  maxCatalogSlots?: number;
  updateTargetCount?: number;
  updateAutoBackfillEnabled?: boolean;
  updateMaxActiveProducts?: number;
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

  const [activeTab, setActiveTab] = useState<'queue' | 'paused' | 'update' | 'completed' | 'errors'>('queue');
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<QueueItem | null>(null);
  const [updateTargetCount, setUpdateTargetCount] = useState<number>(10);
  const [updateAutoBackfill, setUpdateAutoBackfill] = useState<boolean>(false);
  const [updateMaxActiveProducts, setUpdateMaxActiveProducts] = useState<number>(100);
  const [savingTargetCount, setSavingTargetCount] = useState<boolean>(false);
  const [isTriggeringBackfill, setIsTriggeringBackfill] = useState<boolean>(false);
  const [backfillToast, setBackfillToast] = useState<{ message: string; success: boolean } | null>(null);
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemLanguageMap, setItemLanguageMap] = useState<Record<string, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [globalMode, setGlobalMode] = useState<'live' | 'draft'>('draft');
  const [isScreencastOpen, setIsScreencastOpen] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);

  // 1-Second Delayed Hover Popover State
  const [hoveredItem, setHoveredItem] = useState<QueueItem | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnterThumbnail = (item: QueueItem, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredItem(item);
      const popoverWidth = 320;
      const popoverHeight = 440;
      let x = rect.right + 12;
      if (x + popoverWidth > window.innerWidth) {
        x = rect.left - popoverWidth - 12;
      }
      let y = rect.top - 80;
      if (y + popoverHeight > window.innerHeight) {
        y = window.innerHeight - popoverHeight - 16;
      }
      if (y < 70) {
        y = 70;
      }
      setHoverPosition({ x, y });
    }, 1000);
  };

  const handleMouseLeaveThumbnail = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredItem(null);
    setHoverPosition(null);
  };

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

  useEffect(() => {
    if (queueState.updateTargetCount !== undefined) {
      setUpdateTargetCount(queueState.updateTargetCount);
    }
    if (queueState.updateAutoBackfillEnabled !== undefined) {
      setUpdateAutoBackfill(queueState.updateAutoBackfillEnabled);
    }
    if (queueState.updateMaxActiveProducts !== undefined) {
      setUpdateMaxActiveProducts(queueState.updateMaxActiveProducts);
    }
  }, [queueState.updateTargetCount, queueState.updateAutoBackfillEnabled, queueState.updateMaxActiveProducts]);

  const handleSetUpdateTargetCount = async (count: number) => {
    const clamped = Math.max(1, Math.min(50, count));
    setUpdateTargetCount(clamped);
    setSavingTargetCount(true);
    try {
      await fetch('/api/v1/queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueUpdateTargetCount: clamped })
      });
      fetchQueue();
    } catch (e) {
      console.warn('Failed to update target count:', e);
    } finally {
      setSavingTargetCount(false);
    }
  };

  const handleToggleAutoBackfill = async (enabled: boolean) => {
    setUpdateAutoBackfill(enabled);
    try {
      await fetch('/api/v1/queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueUpdateAutoBackfillEnabled: enabled })
      });
      fetchQueue();
    } catch (e) {
      console.warn('Failed to toggle auto backfill:', e);
    }
  };

  const handleSetMaxActiveProducts = async (count: number) => {
    const clamped = Math.max(1, Math.min(500, count));
    setUpdateMaxActiveProducts(clamped);
    try {
      await fetch('/api/v1/queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueUpdateMaxActiveProducts: clamped })
      });
      fetchQueue();
    } catch (e) {
      console.warn('Failed to set max active products:', e);
    }
  };

  const handleTriggerSingleBackfill = async () => {
    setIsTriggeringBackfill(true);
    setBackfillToast(null);
    try {
      const res = await fetch('/api/v1/queue/update-backfill/run-once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setBackfillToast({ message: data.message || '1 Design erfolgreich gezogen!', success: true });
      } else {
        setBackfillToast({ message: data.message || data.error || 'Kein passendes Design gefunden', success: false });
      }
      fetchQueue();
    } catch (e: any) {
      setBackfillToast({ message: `Fehler: ${e.message}`, success: false });
    } finally {
      setIsTriggeringBackfill(false);
      setTimeout(() => setBackfillToast(null), 6000);
    }
  };

  const handleToggleLock = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/queue/item/${itemId}/lock`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Lock error:', err);
    }
  };

  const handleTogglePause = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/queue/item/${encodeURIComponent(itemId)}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Pause error:', err);
    }
  };

  const handleRetryItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/queue/item/${itemId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
        setActiveTab('queue');
      } else {
        fetchQueue();
      }
    } catch (err) {
      console.error('Retry error:', err);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/v1/queue/item/${itemId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Remove error:', err);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmItem) return;
    await handleRemoveItem(deleteConfirmItem.id);
    setDeleteConfirmItem(null);
  };

  const handleClearQueue = async (onlyCompleted = true) => {
    try {
      const res = await fetch(`/api/v1/queue?onlyCompleted=${onlyCompleted}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success && data.state) {
        setQueueState(data.state);
      }
    } catch (err) {
      console.error('Clear error:', err);
    }
  };

  const handleUpdateSettings = async (updates: { uploadScheduleTime?: string; maxDropPerDesign?: number }) => {
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

  // Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    const newItems = [...queueState.items];
    const [movedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, movedItem);

    setQueueState(prev => ({ ...prev, items: newItems }));
    setDraggedIndex(null);

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

  const isUpdateItem = (i: any) => (i.type === 'UPDATE' || i.type === 'update' || i.source === 'UPDATE' || (i.id && i.id.startsWith('update_')));
  const isNewItem = (i: any) => !isUpdateItem(i);

  const activeQueueDesigns = queueState.items.filter(i => isNewItem(i) && (!i.isPaused) && ((i.status as any) === 'WAITING' || (i.status as any) === 'UPLOADING' || (i.status as any) === 'SCHEDULED_TODAY' || (i.status as any) === 'WAITING_FOR_SLOTS'));
  const pausedDesigns = queueState.items.filter(i => isNewItem(i) && (!!i.isPaused) && ((i.status as any) === 'WAITING' || (i.status as any) === 'UPLOADING' || (i.status as any) === 'SCHEDULED_TODAY' || (i.status as any) === 'WAITING_FOR_SLOTS'));
  const updateDesigns = queueState.items.filter(i => isUpdateItem(i) && i.status !== 'COMPLETED' && i.status !== 'ERROR');
  const completedDesigns = queueState.items.filter(i => i.status === 'COMPLETED');
  const errorDesigns = queueState.items.filter(i => i.status === 'ERROR');

  const waitingOrUploadingDesigns = activeQueueDesigns;

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
              </h1>
            </div>
          </div>
        </div>

        {/* Global Action & Upload Trigger */}
        <div className="flex items-center flex-wrap gap-3">
          {/* Live Screencast Button */}
          <button
            onClick={() => setIsScreencastOpen(true)}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700/80 flex items-center justify-center transition-all shadow-sm"
            title="Session 2 Live-Screencast ansehen"
          >
            <Monitor className="w-4 h-4 text-accent-cyan" />
          </button>

          {/* Mode Selector */}
          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2">
            <span className="text-xs font-semibold text-slate-300">Modus:</span>
            <button
              onClick={() => {
                const nextMode = (queueState?.uploadMode || globalMode) === 'draft' ? 'live' : 'draft';
                setGlobalMode(nextMode);
                handleUpdateSettings({ uploadMode: nextMode });
              }}
              className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                (queueState?.uploadMode || globalMode) === 'live' 
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-primary-500/20 text-primary-300 border-primary-500/40'
              }`}
            >
              {(queueState?.uploadMode || globalMode) === 'live' ? '🔴 Live Publish' : '🟡 Draft (Entwurf)'}
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
              disabled={waitingOrUploadingDesigns.length === 0}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-accent-cyan to-primary-600 hover:from-accent-cyan/90 hover:to-primary-500 text-slate-950 shadow-lg shadow-accent-cyan/20 flex items-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Jetzt hochladen</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        {/* 1. Warteschlange */}
        <button
          onClick={() => setActiveTab('queue')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'queue'
              ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>Warteschlange</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
            {activeQueueDesigns.length}
          </span>
        </button>

        {/* 2. Pausiert */}
        <button
          onClick={() => setActiveTab('paused')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'paused'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Pause className="w-4 h-4 text-amber-400" />
          <span>Pausiert</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono border ${
            pausedDesigns.length > 0
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            {pausedDesigns.length}
          </span>
        </button>

        {/* 3. Update */}
        <button
          onClick={() => setActiveTab('update')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'update'
              ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <RotateCcw className="w-4 h-4 text-teal-400" />
          <span>Update</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-teal-950/60 text-teal-300 border border-teal-800/60">
            {updateDesigns.length}
          </span>
        </button>

        {/* 4. Hochgeladen */}
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'completed'
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Hochgeladen</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
            {completedDesigns.length}
          </span>
        </button>

        {/* 5. Fehler */}
        <button
          onClick={() => setActiveTab('errors')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'errors'
              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          <AlertTriangle className={`w-4 h-4 ${errorDesigns.length > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
          <span>Fehler</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono border ${
            errorDesigns.length > 0
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            {errorDesigns.length}
          </span>
        </button>
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
                  : uploadProgress.isUploading 
                    ? 'bg-gradient-to-r from-accent-cyan to-primary-500' 
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>

          {/* Real-time terminal log feed */}
          {uploadProgress.logs && uploadProgress.logs.length > 0 && (
            <div className="bg-slate-950/80 rounded-xl p-2.5 font-mono text-[11px] text-slate-300 max-h-24 overflow-y-auto space-y-1 border border-slate-800/80">
              {uploadProgress.logs.slice(-4).map((log, idx) => (
                <div key={idx} className="truncate">
                  <span className="text-slate-600 mr-1.5">&gt;</span>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 1: WARTESCHLANGE ================= */}
      {activeTab === 'queue' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Slot Metrics & Capacity Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Tages-Uploads (Amazon Kontingent) */}
            <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-medium">Tages-Uploads (Amazon)</span>
                <Layers className="w-4 h-4 text-accent-cyan" />
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-slate-100 font-mono">
                  {queueState.usedSlotsToday || 0} von {queueState.totalDailySlots || 200}
                </span>
                <span className="text-xs text-slate-400">verbraucht</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1.5 mt-3 overflow-hidden border border-slate-800">
                <div 
                  className={`h-full transition-all duration-500 ${
                    ((queueState.usedSlotsToday || 0) / (queueState.totalDailySlots || 200)) * 100 > 90 
                      ? 'bg-rose-500' 
                      : ((queueState.usedSlotsToday || 0) / (queueState.totalDailySlots || 200)) * 100 > 70 
                        ? 'bg-amber-400' 
                        : 'bg-accent-cyan'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, ((queueState.usedSlotsToday || 0) / (queueState.totalDailySlots || 200)) * 100))}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 mt-2 flex items-center justify-between">
                <span>{queueState.freeDailySlots || 0} freie Slots heute</span>
                {(queueState.uploadMode || globalMode) === 'draft' && (
                  <span className="text-primary-300 font-medium">🟡 Drafts aktiv</span>
                )}
              </div>
            </div>

            {/* Card 2: Geplante Slots (Queue) */}
            <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-medium">Geplante Slots (Queue)</span>
                <UploadCloud className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-baseline space-x-2">
                {(queueState.uploadMode || globalMode) === 'live' ? (
                  <>
                    <span className="text-2xl font-bold text-slate-100 font-mono">
                      {queueState.scheduledSlotsToday || 0} von {queueState.freeDailySlots || 0}
                    </span>
                    <span className="text-xs text-slate-400">Slots belegt</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl font-bold text-accent-cyan font-mono">
                      {queueState.scheduledSlotsToday || 0} Produkte
                    </span>
                    <span className="text-xs text-slate-400">geplant</span>
                  </>
                )}
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1.5 mt-3 overflow-hidden border border-slate-800">
                <div 
                  className={`h-full transition-all duration-500 ${
                    (queueState.uploadMode || globalMode) === 'live'
                      ? (queueState.scheduledSlotsToday || 0) > (queueState.freeDailySlots || 0)
                        ? 'bg-rose-500'
                        : 'bg-emerald-500'
                      : 'bg-gradient-to-r from-accent-cyan to-primary-500'
                  }`}
                  style={{ 
                    width: (queueState.uploadMode || globalMode) === 'live'
                      ? `${Math.min(100, Math.max(0, ((queueState.scheduledSlotsToday || 0) / (queueState.freeDailySlots || 1)) * 100))}%`
                      : '100%' 
                  }}
                />
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                {(queueState.uploadMode || globalMode) === 'live' ? (
                  <span>
                    {queueState.scheduledItemsCount || 0} von {waitingOrUploadingDesigns.length} Designs heute einplanbar
                    {(queueState.overflowItemsCount || 0) > 0 ? ` (${queueState.overflowItemsCount} warten auf freie Slots)` : ''}
                  </span>
                ) : (
                  <span>Alle {waitingOrUploadingDesigns.length} Designs bereit zum Upload</span>
                )}
              </div>
            </div>

            {/* Card 3: Designs in Warteschlange */}
            <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                <span className="font-medium">Designs in Warteschlange</span>
                <Clock className="w-4 h-4 text-primary-400" />
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold text-slate-100 font-mono">{waitingOrUploadingDesigns.length}</span>
                <span className="text-xs text-slate-400">Designs</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-3 pt-1 border-t border-slate-800/60">
                {(queueState.uploadMode || globalMode) === 'live' ? (
                  <span>Kürzungs-Puffer: Max. {queueState.maxDropPerDesign || 10} Slots / Design</span>
                ) : (
                  <span>Eingestellt: {queueState.draftProductsPerDesign || queueState.maxCatalogSlots || 106} Produkte / Design</span>
                )}
              </div>
            </div>
          </div>

          {/* Control Panel: Scheduling & Balancing Settings */}
          <div className="bg-surface/80 border border-slate-800/80 rounded-2xl px-4 py-3 shadow-sm backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center flex-wrap gap-4">
              {/* Upload Startzeit */}
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-300">Upload Startzeit:</span>

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
              <div className="flex items-center space-x-2 border-l border-slate-800 pl-4">
                <Sliders className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-300">Max. Kürzungs-Toleranz:</span>
                
                <div className="flex items-center space-x-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                  <button
                    onClick={() => {
                      const next = Math.max(0, queueState.maxDropPerDesign - 1);
                      handleUpdateSettings({ maxDropPerDesign: next });
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
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
                    className="w-8 text-center bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none"
                  />

                  <button
                    onClick={() => {
                      const next = Math.min(50, queueState.maxDropPerDesign + 1);
                      handleUpdateSettings({ maxDropPerDesign: next });
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                    title="Toleranz erhöhen"
                  >
                    +
                  </button>
                </div>
                <span className="text-[11px] text-slate-500">Slots / Design</span>
              </div>

              {/* Draft Mode Specific Stepper: Produkte pro Design */}
              {(queueState.uploadMode || globalMode) === 'draft' && (
                <div className="flex items-center space-x-2 border-l border-slate-800 pl-4">
                  <Package className="w-4 h-4 text-accent-cyan shrink-0" />
                  <span className="font-semibold text-slate-300">Produkte pro Design:</span>
                  
                  {(() => {
                    const maxSlots = queueState.maxCatalogSlots || 106;
                    const minSlots = Math.max(1, maxSlots - (queueState.maxDropPerDesign || 10));
                    const currentVal = queueState.draftProductsPerDesign !== undefined ? queueState.draftProductsPerDesign : maxSlots;

                    return (
                      <div className="flex items-center space-x-1.5">
                        <div className="flex items-center space-x-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
                          <button
                            onClick={() => {
                              const next = Math.max(minSlots, currentVal - 1);
                              handleUpdateSettings({ draftProductsPerDesign: next });
                            }}
                            disabled={currentVal <= minSlots}
                            className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={`Verringern (Mindestens ${minSlots} Produkte)`}
                          >
                            -
                          </button>

                          <input
                            type="number"
                            min={minSlots}
                            max={maxSlots}
                            value={currentVal}
                            onChange={(e) => {
                              const val = Math.max(minSlots, Math.min(maxSlots, Number(e.target.value) || minSlots));
                              handleUpdateSettings({ draftProductsPerDesign: val });
                            }}
                            className="w-9 text-center bg-transparent text-xs font-mono font-bold text-accent-cyan focus:outline-none"
                          />

                          <button
                            onClick={() => {
                              const next = Math.min(maxSlots, currentVal + 1);
                              handleUpdateSettings({ draftProductsPerDesign: next });
                            }}
                            disabled={currentVal >= maxSlots}
                            className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={`Erhöhen (Maximal ${maxSlots} Produkte)`}
                          >
                            +
                          </button>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          (Min: {minSlots} / Max: {maxSlots})
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Action Controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={handleRebalance}
                disabled={isRebalancing}
                className="p-2 rounded-xl text-slate-400 hover:text-accent-cyan bg-slate-900 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center transition-all shadow-sm shrink-0"
                title="Slot-Berechnung manuell neu anstoßen"
              >
                <RefreshCw className={`w-4 h-4 ${isRebalancing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Queue Items List */}
          {waitingOrUploadingDesigns.length === 0 ? (
            <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
                <UploadCloud className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Keine aktiven Designs in der Warteschlange</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Sobald ein Design in der Ideogram- &amp; Vision-Pipeline final freigegeben wird, wandert es vollautomatisch hier in die Queue.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>Reihenfolge der Designs (Priorität von oben nach unten)</span>
                <span>{waitingOrUploadingDesigns.length} Designs in Warteschlange</span>
              </div>

              <div className="space-y-3">
                {waitingOrUploadingDesigns.map((item, index) => {
                  const isUploading = item.status === 'UPLOADING';
                  const isPaused = item.isPaused ?? false;
                  const isDraftMode = (queueState.uploadMode || globalMode) === 'draft';
                  const canUploadToday = !isPaused && (isDraftMode || (item.allocatedSlots && item.allocatedSlots > 0));
                  const isExpanded = expandedItemId === item.id;
                  const isDragging = draggedIndex === index;
                  const isDragOver = dragOverIndex === index;
                  const droppedCount = Object.values(item.droppedSlotsMap || {}).reduce((sum, list) => sum + list.length, 0);

                  // Border & Glow styling:
                  // Lila = Uploading (gerade im Upload)
                  // Grün = Heute eingeplant / zum Upload bereit (canUploadToday)
                  // Gelb = Wartend, aber heute nicht mehr dran (Slot-Limit im Live Mode erreicht)
                  // Orange = Pausiert (isPaused)
                  let borderClass = 'border-emerald-500/70 shadow-emerald-500/10 ring-1 ring-emerald-500/30 hover:border-emerald-400';
                  if (isUploading) {
                    borderClass = 'border-purple-500/80 shadow-purple-500/20 ring-1 ring-purple-500/50';
                  } else if (isPaused) {
                    borderClass = 'border-amber-500/80 shadow-amber-500/15 ring-1 ring-amber-500/40 hover:border-amber-500/90 opacity-80';
                  } else if (!canUploadToday) {
                    borderClass = 'border-amber-300/80 shadow-amber-300/10 ring-1 ring-amber-300/30 hover:border-amber-300';
                  }

                  return (
                    <div
                      key={item.id}
                      draggable={!isUploading}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`bg-surface/90 border rounded-2xl p-4 shadow-sm backdrop-blur-md transition-all overflow-hidden relative ${
                        isDragging ? 'opacity-40 scale-[0.99] border-dashed border-accent-cyan' : ''
                      } ${
                        isDragOver ? 'border-accent-cyan ring-2 ring-accent-cyan/30 scale-[1.01]' : ''
                      } ${borderClass}`}
                    >
                      {/* Top Row: Drag Handle, Pause Button, Thumbnail, Title, Badges, Lock & Actions */}
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center space-x-2.5 sm:space-x-3">
                          {/* Drag Handle */}
                          <div 
                            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-200 p-1 -ml-1 rounded transition-colors"
                            title="Ziehen um Reihenfolge zu ändern"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>

                          {/* Pause / Resume Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePause(item.id);
                            }}
                            disabled={isUploading}
                            className={`p-1.5 rounded-lg border transition-all shrink-0 ${
                              isPaused
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20 hover:bg-amber-500/30'
                                : 'bg-slate-900/90 text-slate-400 hover:text-amber-300 border-slate-800 hover:border-amber-500/30'
                            } disabled:opacity-40`}
                            title={isPaused ? 'Design fortsetzen (wieder in Queue einplanen)' : 'Design pausieren (von Upload & Slot-Berechnung ausschließen)'}
                          >
                            {isPaused ? (
                              <Play className="w-3.5 h-3.5 fill-current text-amber-400" />
                            ) : (
                              <Pause className="w-3.5 h-3.5 text-slate-400 hover:text-amber-300" />
                            )}
                          </button>

                          {/* Image Thumbnail with 1s Hover Zoom Trigger */}
                          <div 
                            onMouseEnter={(e) => handleMouseEnterThumbnail(item, e)}
                            onMouseLeave={handleMouseLeaveThumbnail}
                            className="w-14 h-14 rounded-xl border border-slate-800 overflow-hidden shrink-0 relative group cursor-zoom-in transition-transform hover:scale-105"
                            style={{
                              backgroundImage: `
                                linear-gradient(45deg, #1e293b 25%, transparent 25%),
                                linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                                linear-gradient(45deg, transparent 75%, #1e293b 75%),
                                linear-gradient(-45deg, transparent 75%, #1e293b 75%)
                              `,
                              backgroundSize: '10px 10px',
                              backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
                              backgroundColor: '#090d16'
                            }}
                          >
                            {item.imagePath ? (
                              <img 
                                src={item.imagePath.startsWith('/') ? item.imagePath : `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`} 
                                alt={item.designTitle}
                                className="w-full h-full object-contain p-0.5"
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
                              isUploading
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 animate-pulse'
                                : isPaused
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : canUploadToday
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-amber-300/15 text-amber-300 border-amber-300/30'
                            }`}>
                              {isUploading 
                                ? '🟣 Lädt hoch...' 
                                : isPaused
                                  ? '⏸️ Pausiert'
                                  : canUploadToday
                                    ? `🟢 ${item.allocatedSlots} Slots`
                                    : '🟡 Wartet auf freie Slots'}
                            </span>
                            {droppedCount > 0 && !isUploading && canUploadToday && (
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
                            onClick={() => setDeleteConfirmItem(item)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-500/30 transition-colors"
                            title="Aus Queue löschen"
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
                              jp: { label: 'Japanisch', flag: '🇯🇵' },
                              ja: { label: 'Japanisch', flag: '🇯🇵' }
                            };

                            return (
                              <div className="space-y-3 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-center space-x-2 text-xs font-bold text-slate-200">
                                    <Globe className="w-4 h-4 text-accent-cyan" />
                                    <span>Mehrsprachige Listings &amp; SEO-Metadaten</span>
                                  </div>

                                  {/* Language Tabs */}
                                  <div className="flex items-center flex-wrap gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                                    {allLangs.map((langKey) => {
                                      const meta = langFlags[langKey] || { label: langKey.toUpperCase(), flag: '🌐' };
                                      const isSelected = activeLang === langKey;
                                      return (
                                        <button
                                          key={langKey}
                                          onClick={() => setItemLanguageMap(prev => ({ ...prev, [item.id]: langKey }))}
                                          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 ${
                                            isSelected 
                                              ? 'bg-accent-cyan text-slate-950 shadow-sm' 
                                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                                          }`}
                                        >
                                          <span>{meta.flag}</span>
                                          <span className="uppercase">{langKey}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Listing Content Preview */}
                                <div className="space-y-2 text-xs font-mono bg-slate-900/90 p-3 rounded-lg border border-slate-800 text-slate-300">
                                  <div>
                                    <span className="text-slate-500">Brand: </span>
                                    <span className="text-slate-200 font-semibold">{currentListing.brand || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Titel: </span>
                                    <span className="text-slate-100 font-bold">{currentListing.title || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Bullet 1: </span>
                                    <span className="text-slate-300">{currentListing.bullet1 || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Bullet 2: </span>
                                    <span className="text-slate-300">{currentListing.bullet2 || '—'}</span>
                                  </div>
                                  {currentListing.description && (
                                    <div>
                                      <span className="text-slate-500">Beschreibung: </span>
                                      <span className="text-slate-400">{currentListing.description}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* TM Blocked Items Notice */}
                          {item.tmBlockedProductIds && item.tmBlockedProductIds.length > 0 && (
                            <div className="flex items-center space-x-2 text-xs text-rose-300 bg-rose-950/30 border border-rose-500/30 p-2.5 rounded-xl">
                              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                              <span>Durch Trademark (TM) gesperrte Produkt-Klassen: <strong>{item.tmBlockedProductIds.join(', ')}</strong></span>
                            </div>
                          )}

                          {/* Active & Dropped Marketplace Matrix */}
                          <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                              <span>Zugewiesene Produkte &amp; Marktplätze ({item.allocatedSlots} Slots)</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {Object.entries(item.activeProductsMap || {}).map(([prodId, mps]) => {
                                const droppedMps = item.droppedSlotsMap?.[prodId] || [];
                                return (
                                  <div key={prodId} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                                    <div className="font-bold text-slate-200 truncate">{prodId}</div>
                                    <div className="flex items-center flex-wrap gap-1 mt-1 font-mono text-[10px]">
                                      {mps.map(mp => (
                                        <span key={mp} className={`px-1.5 py-0.2 rounded ${
                                          mp.toUpperCase() === 'US' 
                                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold'
                                            : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                        }`}>
                                          {mp}
                                        </span>
                                      ))}
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
        </div>
      )}

      {/* ================= TAB 2: PAUSIERT ================= */}
      {activeTab === 'paused' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Pause className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-300 font-semibold">
                {pausedDesigns.length} Designs aktuell pausiert (von Upload &amp; Slot-Berechnung ausgeschlossen)
              </span>
            </div>
          </div>

          {pausedDesigns.length === 0 ? (
            <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-950/20 border border-amber-500/20 flex items-center justify-center mx-auto mb-3 text-amber-400">
                <Pause className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Keine pausierten Designs</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Klicke bei einem Design in der Warteschlange auf den Pause-Button <code>⏸️</code>, um es vorübergehend hierher zu verschieben.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pausedDesigns.map((item) => (
                <div
                  key={item.id}
                  className="bg-surface/90 border border-amber-500/60 shadow-amber-500/10 ring-1 ring-amber-500/30 rounded-2xl p-4 shadow-sm backdrop-blur-md transition-all space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3 sm:space-x-4">
                      {/* Image Thumbnail with 1s Hover Zoom Trigger */}
                      <div 
                        onMouseEnter={(e) => handleMouseEnterThumbnail(item, e)}
                        onMouseLeave={handleMouseLeaveThumbnail}
                        className="w-14 h-14 rounded-xl border border-amber-500/30 overflow-hidden shrink-0 relative group cursor-zoom-in transition-transform hover:scale-105"
                        style={{
                          backgroundImage: `
                            linear-gradient(45deg, #1e293b 25%, transparent 25%),
                            linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                            linear-gradient(45deg, transparent 75%, #1e293b 75%),
                            linear-gradient(-45deg, transparent 75%, #1e293b 75%)
                          `,
                          backgroundSize: '10px 10px',
                          backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
                          backgroundColor: '#090d16'
                        }}
                      >
                        {item.imagePath ? (
                          <img 
                            src={item.imagePath.startsWith('/') ? item.imagePath : `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`} 
                            alt={item.designTitle}
                            className="w-full h-full object-contain p-0.5"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <Layers className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold flex items-center space-x-1">
                            <Pause className="w-3 h-3" />
                            <span>Pausiert</span>
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Task #{item.taskId}
                          </span>
                          {item.niche && (
                            <span className="text-[10px] text-slate-400 font-semibold">
                              {item.niche}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-slate-100 mt-1">
                          {item.title || item.designTitle}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {item.brand} • {item.totalBaseSlots || 106} Basis-Slots
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleTogglePause(item.id)}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 flex items-center space-x-1.5 transition-all shadow-md shadow-amber-500/20 active:scale-95"
                        title="Design reaktivieren (wird ganz unten an das Ende der Warteschlange angehängt)"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Reaktivieren</span>
                      </button>

                      <button
                        onClick={() => setDeleteConfirmItem(item)}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 flex items-center space-x-1.5 transition-colors"
                        title="Design komplett löschen"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Löschen</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: UPDATE ================= */}
      {activeTab === 'update' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Clean Update Header & Controls */}
          <div className="space-y-3 bg-surface/80 border border-slate-800/80 p-4 rounded-2xl shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Update Queue
                  </h3>
                </div>
              </div>

              {/* Controls Bar */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* 1. Automatik Toggle */}
                <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-semibold text-slate-300">Automatik:</span>
                  <button
                    type="button"
                    onClick={() => handleToggleAutoBackfill(!updateAutoBackfill)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all flex items-center space-x-1.5 ${
                      updateAutoBackfill 
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-950/40' 
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Power className="w-3 h-3" />
                    <span>{updateAutoBackfill ? 'AKTIV' : 'AUS'}</span>
                  </button>
                </div>

                {/* 2. Vorhalten Stepper */}
                <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-semibold text-slate-300">Vorhalten:</span>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => handleSetUpdateTargetCount(updateTargetCount - 1)}
                      disabled={updateTargetCount <= 1 || savingTargetCount}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono font-bold text-xs text-teal-400 w-7 text-center">
                      {updateTargetCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSetUpdateTargetCount(updateTargetCount + 1)}
                      disabled={updateTargetCount >= 50 || savingTargetCount}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500">Designs</span>
                </div>

                {/* 3. Max Live Products Filter */}
                <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl" title="Überspringt Designs aus Supabase mit dieser oder höherer Anzahl an Live-Produkten">
                  <span className="text-xs font-semibold text-slate-300">Max. Live-Produkte:</span>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => handleSetMaxActiveProducts(updateMaxActiveProducts - 10)}
                      disabled={updateMaxActiveProducts <= 10}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono font-bold text-xs text-teal-400 w-11 text-center">
                      &lt; {updateMaxActiveProducts}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSetMaxActiveProducts(updateMaxActiveProducts + 10)}
                      disabled={updateMaxActiveProducts >= 500}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 4. Trigger 1x Backfill Button */}
                <button
                  type="button"
                  onClick={handleTriggerSingleBackfill}
                  disabled={isTriggeringBackfill}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50 shadow-sm shadow-teal-950/40"
                  title="Zieht das älteste passende Design aus Supabase"
                >
                  {isTriggeringBackfill ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isTriggeringBackfill ? 'Zieht Design...' : '1x Design ziehen'}</span>
                </button>
              </div>
            </div>

            {/* Backfill Feedback Toast */}
            {backfillToast && (
              <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
                backfillToast.success 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>
                <div className="flex items-center space-x-2">
                  {backfillToast.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  )}
                  <span>{backfillToast.message}</span>
                </div>
                <button
                  onClick={() => setBackfillToast(null)}
                  className="text-slate-400 hover:text-slate-200 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Update Items Pool */}
          {updateDesigns.length === 0 ? (
            <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-teal-950/30 border border-teal-500/20 flex items-center justify-center mx-auto mb-3 text-teal-400">
                <RotateCcw className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Update-Pool aktuell leer</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Sobald Designs über den Update-Workflow (U1–U7) verarbeitet werden, erscheinen sie hier im Update-Pool bereit zur Amazon-Veröffentlichung.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>Vorbereitete Update-Designs</span>
                <span className="font-mono text-teal-400 font-bold">{updateDesigns.length} im Pool</span>
              </div>

              <div className="space-y-3">
                {updateDesigns.map((item) => {
                  const isExpanded = expandedItemId === item.id;
                  const thumbUrl = item.imagePath || `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`;

                  return (
                    <div 
                      key={item.id} 
                      className="bg-surface/90 border border-teal-500/50 shadow-teal-500/10 ring-1 ring-teal-500/30 rounded-2xl p-4 shadow-sm backdrop-blur-md transition-all overflow-hidden relative hover:border-teal-400"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center space-x-3 sm:space-x-4">
                          {/* Thumbnail with Hover Zoom */}
                          <div 
                            onMouseEnter={(e) => handleMouseEnterThumbnail(item, e)}
                            onMouseLeave={handleMouseLeaveThumbnail}
                            className="w-14 h-14 rounded-xl border border-teal-500/30 bg-slate-950 overflow-hidden shrink-0 relative group cursor-zoom-in transition-transform hover:scale-105 p-0.5 flex items-center justify-center"
                          >
                            <img
                              src={thumbUrl}
                              alt={item.title}
                              className="w-full h-full object-contain rounded-lg"
                              loading="lazy"
                            />
                          </div>

                          {/* Info Column */}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <h4 className="text-sm font-bold text-slate-100 line-clamp-1">
                                {item.title || item.designTitle}
                              </h4>
                              
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-teal-500/20 text-teal-300 border border-teal-500/30">
                                0 Slots (Update)
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                Update Bereit
                              </span>
                              {item.fitTypes && item.fitTypes.length > 0 && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-purple-300 bg-purple-500/10 border border-purple-500/20">
                                  {item.fitTypes.join(', ')}
                                </span>
                              )}
                              {item.avoidColor && item.avoidColor !== 'none' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20">
                                  Kein {item.avoidColor}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                              <div>
                                Brand: <span className="text-slate-300 font-semibold">{item.brand || 'MBA Hub'}</span>
                              </div>
                              {item.designId && (
                                <div className="font-mono text-[11px] text-slate-500">
                                  Amazon ID: <span className="text-slate-400">{item.designId}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
                          {/* Toggle Expand Listing Details */}
                          <button
                            onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700/80 flex items-center space-x-1.5 transition-all shadow-sm"
                            title="Listing & Details ansehen"
                          >
                            <span>Details</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                          </button>

                          {/* Delete Item */}
                          <button
                            onClick={() => setDeleteConfirmItem(item)}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all"
                            title="Aus Update-Pool entfernen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Details Accordion */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3 animate-fadeIn text-xs">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                            <div className="space-y-1">
                              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Bullet 1:</span>
                              <p className="text-slate-300 font-mono text-[11px] leading-relaxed bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                {item.bullet1 || '-'}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Bullet 2:</span>
                              <p className="text-slate-300 font-mono text-[11px] leading-relaxed bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                {item.bullet2 || '-'}
                              </p>
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
        </div>
      )}

      {/* ================= TAB 4: HOCHGELADEN ================= */}
      {activeTab === 'completed' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {completedDesigns.length} Designs erfolgreich auf Amazon Merch hochgeladen
            </span>
            {completedDesigns.length > 0 && (
              <button
                onClick={() => handleClearQueue(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-all"
              >
                Historie leeren
              </button>
            )}
          </div>

          {completedDesigns.length === 0 ? (
            <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Noch keine hochgeladenen Designs</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Sobald Designs aus der Warteschlange erfolgreich als Draft oder Live hochgeladen wurden, erscheinen sie hier in der Historie.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedDesigns.map((item) => (
                <div 
                  key={item.id}
                  className="bg-surface/90 border border-teal-500/50 shadow-teal-500/10 ring-1 ring-teal-500/30 rounded-2xl p-4 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-center space-x-3 sm:space-x-4">
                    <div 
                      onMouseEnter={(e) => handleMouseEnterThumbnail(item, e)}
                      onMouseLeave={handleMouseLeaveThumbnail}
                      className="w-14 h-14 rounded-xl border border-slate-800 overflow-hidden shrink-0 relative group cursor-zoom-in transition-transform hover:scale-105"
                      style={{
                        backgroundImage: `
                          linear-gradient(45deg, #1e293b 25%, transparent 25%),
                          linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #1e293b 75%),
                          linear-gradient(-45deg, transparent 75%, #1e293b 75%)
                        `,
                        backgroundSize: '10px 10px',
                        backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
                        backgroundColor: '#090d16'
                      }}
                    >
                      {item.imagePath ? (
                        <img 
                          src={item.imagePath.startsWith('/') ? item.imagePath : `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`} 
                          alt={item.designTitle}
                          className="w-full h-full object-contain p-0.5"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <Layers className="w-6 h-6" />
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/40 font-bold">
                          ✓ Hochgeladen
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          Task #{item.taskId}
                        </span>
                        {item.uploadedAt && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(item.uploadedAt).toLocaleString('de-DE')}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-100 mt-1">
                        {item.title || item.designTitle}
                      </h3>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Brand: {item.brand || '—'} • {item.allocatedSlots} Slots belegt
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleRetryItem(item.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-accent-cyan border border-slate-700 flex items-center space-x-1.5 transition-all"
                      title="Wieder in die aktive Warteschlange einreihen"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Wieder in Queue</span>
                    </button>

                    <button
                      onClick={() => setDeleteConfirmItem(item)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-500/30 transition-colors"
                      title="Aus Historie löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: FEHLER ================= */}
      {activeTab === 'errors' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {errorDesigns.length} Designs mit aufgetretenen Upload-Fehlern
            </span>
          </div>

          {errorDesigns.length === 0 ? (
            <div className="bg-surface/50 border border-slate-800/80 rounded-2xl p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3 text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Keine Fehler aufgetreten 🎉</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Alle Uploads laufen stabil und fehlerfrei durch.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {errorDesigns.map((item) => (
                <div 
                  key={item.id}
                  className="bg-surface/90 border border-rose-500/60 shadow-rose-500/10 ring-1 ring-rose-500/30 rounded-2xl p-4 shadow-sm backdrop-blur-md space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3 sm:space-x-4">
                      <div 
                        onMouseEnter={(e) => handleMouseEnterThumbnail(item, e)}
                        onMouseLeave={handleMouseLeaveThumbnail}
                        className="w-14 h-14 rounded-xl border border-slate-800 overflow-hidden shrink-0 relative group cursor-zoom-in transition-transform hover:scale-105"
                        style={{
                          backgroundImage: `
                            linear-gradient(45deg, #1e293b 25%, transparent 25%),
                            linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                            linear-gradient(45deg, transparent 75%, #1e293b 75%),
                            linear-gradient(-45deg, transparent 75%, #1e293b 75%)
                          `,
                          backgroundSize: '10px 10px',
                          backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
                          backgroundColor: '#090d16'
                        }}
                      >
                        {item.imagePath ? (
                          <img 
                            src={item.imagePath.startsWith('/') ? item.imagePath : `/api/v1/designs/image/${encodeURIComponent(item.taskId)}`} 
                            alt={item.designTitle}
                            className="w-full h-full object-contain p-0.5"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <Layers className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold flex items-center space-x-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Upload Fehler</span>
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Task #{item.taskId}
                          </span>
                          {item.lastUploadAttempt && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              Versuch: {new Date(item.lastUploadAttempt).toLocaleString('de-DE')}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-slate-100 mt-1">
                          {item.title || item.designTitle}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleRetryItem(item.id)}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-accent-cyan hover:bg-accent-cyan/90 text-slate-950 flex items-center space-x-1.5 transition-all shadow-md shadow-accent-cyan/20"
                        title="Fehler beheben & wieder in die aktive Queue stellen"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Wieder einreihen</span>
                      </button>

                      <button
                        onClick={() => setDeleteConfirmItem(item)}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5 transition-colors"
                        title="Design komplett löschen"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Löschen</span>
                      </button>
                    </div>
                  </div>

                  {/* Prominent Error Box */}
                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs font-mono break-all flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Fehlermeldung: </span>
                      <span>{item.errorMessage || 'Unbekannter Upload-Fehler während des Playwright-Vorgangs.'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Permanent Delete */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-100">Design wirklich löschen?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Möchtest du das Design <strong className="text-slate-100">"{deleteConfirmItem.title || deleteConfirmItem.designTitle}"</strong> (Task #{deleteConfirmItem.taskId}) unwiderruflich aus der Queue entfernen?
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setDeleteConfirmItem(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-md shadow-rose-600/20"
              >
                Endgültig löschen
              </button>
            </div>
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

      {/* 1-Second Delayed High-Res Hover Preview Popover with Checkerboard Grid */}
      {hoveredItem && hoverPosition && (
        <div 
          className="fixed z-50 pointer-events-none animate-fadeIn shadow-2xl rounded-2xl border border-slate-700/80 bg-slate-950/95 backdrop-blur-xl p-3 w-80 max-w-sm space-y-2.5"
          style={{
            left: hoveredItem ? `${hoverPosition.x}px` : undefined,
            top: hoveredItem ? `${hoverPosition.y}px` : undefined,
          }}
        >
          {/* Header Info */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-primary-500/20 text-primary-300 border border-primary-500/40">
              Task #{hoveredItem.taskId}
            </span>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 font-semibold">
              4500×5400 Master-PNG
            </span>
          </div>

          {/* Big Preview Area with Transparency Checkerboard */}
          <div 
            className="w-full h-80 rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center p-3 relative shadow-inner"
            style={{
              backgroundImage: `
                linear-gradient(45deg, #1e293b 25%, transparent 25%),
                linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #1e293b 75%),
                linear-gradient(-45deg, transparent 75%, #1e293b 75%)
              `,
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              backgroundColor: '#090d16'
            }}
          >
            <img 
              src={hoveredItem.imagePath && hoveredItem.imagePath.startsWith('/') ? hoveredItem.imagePath : `/api/v1/designs/image/${encodeURIComponent(hoveredItem.taskId)}`}
              alt={hoveredItem.designTitle}
              className="w-full h-full object-contain filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
            />
          </div>

          {/* Title & Details */}
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-slate-100 line-clamp-2 leading-snug">
              {hoveredItem.title || hoveredItem.designTitle}
            </h4>
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Brand: <strong className="text-slate-300">{hoveredItem.brand || '—'}</strong></span>
              <span className="font-mono text-slate-400">{hoveredItem.allocatedSlots} Slots</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueueView;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import PromptLogTimeline from './PromptLogTimeline';
import { Terminal, Send, Search, Copy, Check, Trash2, RefreshCw, Bot, TestTube, Sparkles, Clock, Globe, Code2, CheckCircle2, Image as ImageIcon, ExternalLink, RotateCcw, AlertTriangle, FileJson, Database, SearchCode, Ban, FastForward, Pause, Play } from 'lucide-react';

import { 
  DesignTaskLog, 
  RetryStepType,
  TaskSummary 
} from '../../types/tasks';
import { TaskStatusBadge, getTaskStatusInfo } from '../components/TaskStatusBadge';
import { useTaskWebSocket } from '../hooks/useTaskWebSocket';

// ---------------------------------------------------------------------------
// Helper: Copy Button
// ---------------------------------------------------------------------------
interface CopyBtnProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

const CopyButton: React.FC<CopyBtnProps> = ({ 
  text, 
  label = 'Kopieren', 
  copiedLabel = 'Kopiert', 
  className = '' 
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
        copied 
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
      } ${className}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const PromptLogView: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<DesignTaskLog | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [filterSource, setFilterSource] = useState<'ALL' | 'HERMES' | 'TEST' | 'DESIGNER' | 'UPDATE'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [finalizingTaskId, setFinalizingTaskId] = useState<string | null>(null);
  const [finalizationMessage, setFinalizationMessage] = useState<{ taskId: string; text: string; success: boolean } | null>(null);

  // Mini Playground State
  const [playNiche1, setPlayNiche1] = useState('Angel Numbers');
  const [playQuote, setPlayQuote] = useState('111 Manifest Your Reality');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);
  const [pushingToQueueTaskId, setPushingToQueueTaskId] = useState<string | null>(null);
  const [pushSuccessTaskId, setPushSuccessTaskId] = useState<string | null>(null);
  const [showPlayground, setShowPlayground] = useState(false);
  const [showInspector, setShowInspector] = useState(false);

  // Amazon Merch API Inspector State
  const [inspectDesignId, setInspectDesignId] = useState('495f452e-8245-42be-96e3-a1d3dcc752d9');
  const [inspectLoadingConfig, setInspectLoadingConfig] = useState(false);
  const [inspectLoadingListings, setInspectLoadingListings] = useState(false);
  const [inspectLoadingDom, setInspectLoadingDom] = useState(false);
  const [inspectConfigResult, setInspectConfigResult] = useState<any>(null);
  const [inspectListingsResult, setInspectListingsResult] = useState<any>(null);
  const [inspectDomResult, setInspectDomResult] = useState<any>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [creatingUpdateTask, setCreatingUpdateTask] = useState(false);
  const [updateTaskSuccessMessage, setUpdateTaskSuccessMessage] = useState<string | null>(null);

  const handleInspectDomLive = async () => {
    if (!inspectDesignId.trim()) return;
    setInspectLoadingDom(true);
    setInspectError(null);
    try {
      const res = await fetch('/api/v1/debug/amazon-inspect-dom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: inspectDesignId.trim() })
      });
      const data = await res.json();
      setInspectDomResult(data);
      if (!data.success && data.error) {
        setInspectError(`DOM-Inspektion Fehler: ${data.error}`);
      }
    } catch (err: any) {
      setInspectError(`Netzwerkfehler: ${err.message}`);
    } finally {
      setInspectLoadingDom(false);
    }
  };

  const handleInspectProductConfig = async () => {
    if (!inspectDesignId.trim()) return;
    setInspectLoadingConfig(true);
    setInspectError(null);
    try {
      const res = await fetch('/api/v1/debug/amazon-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: inspectDesignId.trim(), endpoint: 'productconfig' })
      });
      const data = await res.json();
      setInspectConfigResult(data);
      if (!data.success && data.error) {
        setInspectError(`ProductConfig Fehler: ${data.error}`);
      }
    } catch (err: any) {
      setInspectError(`Netzwerkfehler: ${err.message}`);
    } finally {
      setInspectLoadingConfig(false);
    }
  };

  const handleInspectFindListings = async () => {
    if (!inspectDesignId.trim()) return;
    setInspectLoadingListings(true);
    setInspectError(null);
    try {
      const res = await fetch('/api/v1/debug/amazon-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: inspectDesignId.trim(), endpoint: 'findlistings' })
      });
      const data = await res.json();
      setInspectListingsResult(data);
      if (!data.success && data.error) {
        setInspectError(`FindListings Fehler: ${data.error}`);
      }
    } catch (err: any) {
      setInspectError(`Netzwerkfehler: ${err.message}`);
    } finally {
      setInspectLoadingListings(false);
    }
  };

  const handleCreateUpdateTask = async () => {
    if (!inspectDesignId.trim()) return;
    setCreatingUpdateTask(true);
    setInspectError(null);
    setUpdateTaskSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/debug/amazon-create-update-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: inspectDesignId.trim() })
      });
      const data = await res.json();
      if (data.success && data.task) {
        setUpdateTaskSuccessMessage(`✅ Update-Task ${data.task.id} erfolgreich erstellt!`);
        await fetchTasks();
        setFilterSource('UPDATE');
        setSelectedTaskId(data.task.id);
        setTimeout(() => setUpdateTaskSuccessMessage(null), 8000);
      } else {
        setInspectError(data.error || 'Fehler beim Erstellen des Update-Tasks');
      }
    } catch (err: any) {
      setInspectError(`Netzwerkfehler: ${err.message}`);
    } finally {
      setCreatingUpdateTask(false);
    }
  };

  const [downloadingArtworkTaskId, setDownloadingArtworkTaskId] = useState<string | null>(null);
  const [runningUpdatePipelineTaskId, setRunningUpdatePipelineTaskId] = useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [controllingTaskId, setControllingTaskId] = useState<string | null>(null);
  const [skippingUpdateTaskId, setSkippingUpdateTaskId] = useState<string | null>(null);

  const handleRunFullUpdatePipeline = async (designId: string) => {
    if (!designId.trim()) return;
    setCreatingUpdateTask(true);
    setInspectError(null);
    setUpdateTaskSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/update-pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: designId.trim() })
      });
      const data = await res.json();
      if (data.success && data.task) {
        setUpdateTaskSuccessMessage(`🚀 Update Pipeline für Task ${data.task.id} erfolgreich gestartet & abgearbeitet!`);
        await fetchTasks();
        setFilterSource('UPDATE');
        setSelectedTaskId(data.task.id);
        setTimeout(() => setUpdateTaskSuccessMessage(null), 8000);
      } else {
        setInspectError(data.error || 'Fehler beim Ausführen der Update-Pipeline');
        await fetchTasks();
      }
    } catch (err: any) {
      setInspectError(`Netzwerkfehler: ${err.message}`);
    } finally {
      setCreatingUpdateTask(false);
    }
  };

  const handleResumeUpdatePipeline = async (taskId: string) => {
    if (!taskId) return;
    setRunningUpdatePipelineTaskId(taskId);
    try {
      const res = await fetch('/api/v1/update-pipeline/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, step: 'RESUME' })
      });
      const data = await res.json();
      if (data.success) {
        await fetchTasks();
      } else {
        alert(data.error || 'Fehler bei der Fortsetzung der Update-Pipeline');
        await fetchTasks();
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    } finally {
      setRunningUpdatePipelineTaskId(null);
    }
  };

  const handleDownloadArtwork = async (taskId: string, designId: string) => {
    if (!taskId || !designId) return;
    setDownloadingArtworkTaskId(taskId);
    try {
      const res = await fetch('/api/v1/debug/amazon-download-artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, designId })
      });
      const data = await res.json();
      if (data.success) {
        await fetchTasks();
      } else {
        alert(data.error || 'Fehler beim Herunterladen des Original-Designs');
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    } finally {
      setDownloadingArtworkTaskId(null);
    }
  };

  const selectedSummary = tasks.find(t => t.id === selectedTaskId) || tasks[0] || null;
  const selectedTask = selectedTaskDetail;

  const abortControllerRef = useRef<AbortController | null>(null);
  const detailRequestTaskIdRef = useRef<string | null>(null);
  const detailRefreshPendingRef = useRef(false);
  const detailRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSummaryUpdatedAtRef = useRef<Record<string, string>>({});
  const selectedTaskIdRef = useRef<string | null>(null);
  const selectedTaskDetailRef = useRef<DesignTaskLog | null>(null);
  const detailCacheRef = useRef<Map<string, DesignTaskLog>>(new Map());
  const listRequestSeqRef = useRef(0);
  const listQueryRef = useRef('');
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  selectedTaskIdRef.current = selectedTaskId;
  selectedTaskDetailRef.current = selectedTaskDetail;

  const fetchTaskDetail = useCallback(async (taskId: string, showInitialLoader = false) => {
    if (!taskId) {
      setSelectedTaskDetail(null);
      return;
    }

    // Coalesce updates for the same task instead of aborting and restarting the
    // request for every WebSocket event. One trailing refresh picks up mutations
    // that arrived while the current request was in flight.
    if (detailRequestTaskIdRef.current === taskId) {
      detailRefreshPendingRef.current = true;
      return;
    }

    if (abortControllerRef.current && detailRequestTaskIdRef.current !== taskId) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    detailRequestTaskIdRef.current = taskId;

    const isInitialLoad = (showInitialLoader || selectedTaskDetailRef.current?.id !== taskId) && !detailCacheRef.current.has(taskId);
    if (isInitialLoad) setLoadingDetail(true);
    setDetailError('');
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/prompt-log`, {
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.task && selectedTaskIdRef.current === taskId) {
        const latestSummaryUpdatedAt = latestSummaryUpdatedAtRef.current[taskId];
        const responseUpdatedAt = data.task.updatedAt;
        const responseIsCurrent = !latestSummaryUpdatedAt ||
          !responseUpdatedAt ||
          responseUpdatedAt >= latestSummaryUpdatedAt;

        if (!responseIsCurrent) {
          detailRefreshPendingRef.current = true;
          return;
        }
        detailCacheRef.current.delete(taskId);
        detailCacheRef.current.set(taskId, data.task);
        if (detailCacheRef.current.size > 8) detailCacheRef.current.delete(detailCacheRef.current.keys().next().value!);
        setSelectedTaskDetail(data.task);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setDetailError('Task-Details konnten nicht aktualisiert werden. Der letzte Stand bleibt sichtbar.');
        console.warn(`[PromptLogView] Failed to fetch task detail for ${taskId}:`, err);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        detailRequestTaskIdRef.current = null;
        setLoadingDetail(false);

        if (detailRefreshPendingRef.current && selectedTaskIdRef.current === taskId) {
          detailRefreshPendingRef.current = false;
          window.setTimeout(() => fetchTaskDetail(taskId), 0);
        }
      }
    }
  }, []);

  const scheduleTaskDetailRefresh = useCallback((taskId: string) => {
    if (detailRefreshTimerRef.current) {
      clearTimeout(detailRefreshTimerRef.current);
    }
    detailRefreshTimerRef.current = setTimeout(() => {
      detailRefreshTimerRef.current = null;
      fetchTaskDetail(taskId);
    }, 150);
  }, [fetchTaskDetail]);

  useEffect(() => {
    if (selectedTaskId) {
      if (detailRefreshTimerRef.current) {
        clearTimeout(detailRefreshTimerRef.current);
        detailRefreshTimerRef.current = null;
      }
      detailRefreshPendingRef.current = false;
      const cached = detailCacheRef.current.get(selectedTaskId);
      if (cached) setSelectedTaskDetail(cached);
      else if (selectedTaskDetailRef.current?.id !== selectedTaskId) setSelectedTaskDetail(null);
      const newest = latestSummaryUpdatedAtRef.current[selectedTaskId];
      if (isActive && (!cached || (newest && newest > (cached.updatedAt || '')))) {
        fetchTaskDetail(selectedTaskId, !cached);
      }
    } else {
      setSelectedTaskDetail(null);
    }
  }, [selectedTaskId, isActive, fetchTaskDetail]);

  useEffect(() => () => {
    if (detailRefreshTimerRef.current) clearTimeout(detailRefreshTimerRef.current);
    abortControllerRef.current?.abort();
  }, []);

  const fetchTasks = useCallback(async (source = filterSource, search = searchQuery) => {
    const requestSeq = ++listRequestSeqRef.current;
    const queryKey = `${source}\u0000${search.trim()}`;
    setLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '10');
      if (source !== 'ALL') params.set('source', source);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/v1/tasks/log?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestSeq !== listRequestSeqRef.current) return;
      if (data.success && Array.isArray(data.tasks)) {
        const sameQuery = listQueryRef.current === queryKey;
        listQueryRef.current = queryKey;
        for (const task of data.tasks as TaskSummary[]) {
          if (task.updatedAt) latestSummaryUpdatedAtRef.current[task.id] = task.updatedAt;
        }
        setTasks(prev => sameQuery ? [...data.tasks, ...prev.filter(task => !data.tasks.some((fresh: TaskSummary) => fresh.id === task.id))] : data.tasks);
        if (!sameQuery) {
          setHasMore(Boolean(data.hasMore));
          setNextCursor(data.nextCursor || null);
        }
        setTotalCount(data.totalCount ?? data.tasks.length);

        setSelectedTaskId(prev => {
          if (prev && (sameQuery || data.tasks.some((t: TaskSummary) => t.id === prev))) {
            return prev;
          }
          return data.tasks[0]?.id || null;
        });
      }
    } catch (err) {
      if (requestSeq === listRequestSeqRef.current) setListError('Task-Liste konnte nicht aktualisiert werden. Der letzte Stand bleibt sichtbar.');
      console.warn('[PromptLogView] Failed to fetch task summaries:', err);
    } finally {
      if (requestSeq === listRequestSeqRef.current) setLoading(false);
    }
  }, [filterSource, searchQuery]);

  const loadMoreTasks = async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    const queryKey = listQueryRef.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '10');
      params.set('cursor', nextCursor);
      if (filterSource !== 'ALL') params.set('source', filterSource);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/v1/tasks/log?${params.toString()}`);
      const data = await res.json();
      if (queryKey !== listQueryRef.current) return;
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          const newItems = data.tasks.filter((t: TaskSummary) => !existingIds.has(t.id));
          return [...prev, ...newItems];
        });
        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.warn('[PromptLogView] Failed to load more tasks:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const { isConnected } = useTaskWebSocket({
    onTaskUpdated: (updatedSummary) => {
      if (updatedSummary.updatedAt) {
        latestSummaryUpdatedAtRef.current[updatedSummary.id] = updatedSummary.updatedAt;
      }
      const cached = detailCacheRef.current.get(updatedSummary.id);
      if (cached) detailCacheRef.current.set(updatedSummary.id, {
        ...cached, status: updatedSummary.status, checkpoint: updatedSummary.checkpoint,
        hasError: updatedSummary.hasError, errorDetails: updatedSummary.errorDetails,
        inQueue: updatedSummary.inQueue
      });
      setTasks(prev => {
        const exists = prev.some(t => t.id === updatedSummary.id);
        if (exists) {
          return prev.map(t => t.id === updatedSummary.id ? updatedSummary : t);
        }
        if (filterSource === 'ALL' || updatedSummary.source === filterSource) {
          return [updatedSummary, ...prev];
        }
        return prev;
      });

      if (selectedTaskIdRef.current === updatedSummary.id) {
        // Status/checkpoint are summary fields and can be shown immediately.
        // Heavy fields/events arrive through the coalesced background refresh.
        setSelectedTaskDetail(prev => prev?.id === updatedSummary.id ? {
          ...prev,
          status: updatedSummary.status,
          checkpoint: updatedSummary.checkpoint,
          hasError: updatedSummary.hasError,
          errorDetails: updatedSummary.errorDetails,
          inQueue: updatedSummary.inQueue,
          updatedAt: updatedSummary.updatedAt || prev.updatedAt
        } : prev);
        if (isActiveRef.current) scheduleTaskDetailRefresh(updatedSummary.id);
      }
    },
    onTaskCreated: (newSummary) => {
      setTasks(prev => {
        const exists = prev.some(t => t.id === newSummary.id);
        if (exists) return prev;
        if (filterSource === 'ALL' || newSummary.source === filterSource) {
          return [newSummary, ...prev];
        }
        return prev;
      });
      setTotalCount(c => c + 1);
    },
    onTasksCleared: () => {
      setTasks([]);
      setSelectedTaskId(null);
      setSelectedTaskDetail(null);
      setTotalCount(0);
      setHasMore(false);
      setNextCursor(null);
    },
    onReconnect: () => {
      fetchTasks(filterSource, searchQuery);
    }
  });

  // Debounced server search / filter
  useEffect(() => {
    listRequestSeqRef.current++;
    const timer = setTimeout(() => {
      fetchTasks(filterSource, searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterSource, searchQuery, fetchTasks]);

  // Fallback polling ONLY if WebSocket is disconnected
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => {
      fetchTasks(filterSource, searchQuery);
    }, 25000);
    return () => clearInterval(interval);
  }, [isConnected, filterSource, searchQuery, fetchTasks]);

  const handleRepeatFinalization = async (taskId: string) => {
    if (finalizingTaskId) return;
    if (!window.confirm('Nur Listing & Druckdateien finalisieren wiederholen? Das vorhandene Listing wird geprüft und alle Druckdateien werden neu erzeugt. Frühere Workflow-Schritte bleiben unverändert. Nach Erfolg wird der Queue-Eintrag aktualisiert oder die bisher fehlgeschlagene erste Übergabe abgeschlossen. Eine aktive automatische Queue arbeitet anschließend regulär weiter.')) return;
    setFinalizingTaskId(taskId);
    setFinalizationMessage(null);
    try {
      const response = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/repeat-finalization`, { method: 'POST' });
      const result = await response.json();
      setFinalizationMessage({ taskId, text: result.message || result.error || 'Unbekanntes Ergebnis', success: response.ok && result.success });
      fetchTaskDetail(taskId);
    } catch {
      setFinalizationMessage({ taskId, text: 'Verbindung unterbrochen. Status im Log prüfen, bevor erneut gestartet wird.', success: false });
    } finally { setFinalizingTaskId(null); }
  };

  const handleRetryStep = async (taskId: string, stepType: RetryStepType, eventIndex?: number) => {
    setRetryingStep(`${taskId}-${stepType}-${eventIndex ?? 0}`);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepType, eventIndex })
      });
      if (res.ok) {
        fetchTaskDetail(taskId);
      }
    } catch (e) {
      console.warn('Failed to retry task step:', e);
    } finally {
      setTimeout(() => setRetryingStep(null), 1000);
    }
  };

  const handleSendTestTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playQuote.trim()) return;

    setSubmittingTest(true);
    setTestSuccessMessage(null);

    try {
      const payload = {
        niche1: playNiche1.trim(),
        quote: playQuote.trim(),
      };

      const res = await fetch('/api/v1/design?source=test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-source': 'hub-ui'
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setTestSuccessMessage(`Task ${data.taskId} gestartet`);
        fetchTasks();
        setTimeout(() => setTestSuccessMessage(null), 4000);
      } else {
        alert(`Fehler: ${data.error || 'Task konnte nicht erstellt werden'}`);
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    } finally {
      setSubmittingTest(false);
    }
  };

  const handlePushToQueue = async (taskId: string) => {
    setPushingToQueueTaskId(taskId);
    try {
      const res = await fetch('/api/v1/tasks/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      const data = await res.json();
      if (data.success) {
        setPushSuccessTaskId(taskId);
        setTimeout(() => setPushSuccessTaskId(null), 3000);
        fetchTasks();
      } else {
        alert(`Fehler: ${data.error || 'Konnte nicht in Queue übertragen werden'}`);
      }
    } catch (err: any) {
      alert(`Fehler beim Übertragen: ${err.message}`);
    } finally {
      setPushingToQueueTaskId(null);
    }
  };

  const isTaskCancellable = (task?: TaskSummary | DesignTaskLog | null) => {
    if (!task) return false;
    return !['COMPLETED', 'UPDATE_QUEUED', 'CANCELLED', 'CANCEL_REQUESTED', 'REJECTED'].includes(task.status);
  };

  const canPauseTask = (task?: TaskSummary | DesignTaskLog | null) =>
    Boolean(task && !task.checkpoint && !task.inQueue && !['COMPLETED', 'UPDATE_QUEUED', 'CANCELLED', 'CANCEL_REQUESTED', 'REJECTED', 'ERROR', 'PAUSED', 'PAUSE_REQUESTED'].includes(task.status));

  const handleTaskControl = async (taskId: string, action: 'pause' | 'resume', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (controllingTaskId) return;
    setControllingTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Task-Steuerung fehlgeschlagen');
      // The pipeline can leave WAITING before this response reaches the browser.
      // Do not overwrite a newer WebSocket update with the response's old status.
      void fetchTasks();
      if (selectedTaskIdRef.current === taskId) scheduleTaskDetailRefresh(taskId);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setControllingTaskId(null);
    }
  };

  const handleCancelTask = async (taskId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (cancellingTaskId) return;

    const targetTask = tasks.find(t => t.id === taskId) || (selectedTask?.id === taskId ? selectedTask : null);
    const isUpdate = targetTask?.source === 'UPDATE' || taskId.endsWith('-U');
    const confirmMsg = isUpdate
      ? `Möchtest du den Update-Task ${taskId} wirklich abbrechen? Die Vorhalte-Automatik zieht anschließend das nächste Design.`
      : `Möchtest du den Task ${taskId} wirklich abbrechen?`;

    if (!confirm(confirmMsg)) return;

    setCancellingTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Vom Benutzer im Prompt Log abgebrochen.' })
      });
      const data = await res.json();
      if (data.success) {
        setTasks(prev => prev.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            status: data.status || 'CANCELLED',
            checkpoint: undefined,
            hasError: false,
            errorDetails: 'Vom Benutzer im Prompt Log abgebrochen.'
          };
        }));
        if (selectedTask?.id === taskId) {
          setSelectedTaskDetail(prev => prev ? {
            ...prev,
            status: data.status || 'CANCELLED',
            checkpoint: undefined,
            hasError: false,
            errorDetails: 'Vom Benutzer im Prompt Log abgebrochen.'
          } : null);
        }
      } else {
        alert(data.error || 'Fehler beim Abbrechen des Tasks');
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    } finally {
      setCancellingTaskId(null);
    }
  };

  const canSkipUpdate = (task?: TaskSummary | DesignTaskLog | null) => {
    if (!task) return false;
    const isUpdate = task.source === 'UPDATE' || task.id.endsWith('-U');
    const alreadySkipped = task.errorDetails?.includes('skip_update=true');
    return isUpdate && task.status === 'CANCELLED' && !alreadySkipped;
  };

  const handleSkipUpdate = async (taskId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (skippingUpdateTaskId) return;

    const targetTask = tasks.find(t => t.id === taskId) || (selectedTask?.id === taskId ? selectedTask : null);
    const designId = (targetTask && 'payload' in targetTask ? targetTask.payload?.designId : undefined) || targetTask?.designId;

    const confirmMsg = designId
      ? `Design ${designId} (Task ${taskId}) dauerhaft von automatischen Updates ausschließen? (skip_update=true in Supabase)`
      : `Task ${taskId} dauerhaft von automatischen Updates ausschließen?`;

    if (!confirm(confirmMsg)) return;

    setSkippingUpdateTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/skip-update`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setTasks(prev => prev.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            status: 'CANCELLED',
            checkpoint: undefined,
            hasError: false,
            errorDetails: 'Design dauerhaft von automatischen Updates ausgeschlossen (skip_update=true).'
          };
        }));
        if (selectedTask?.id === taskId) {
          setSelectedTaskDetail(prev => prev ? {
            ...prev,
            status: 'CANCELLED',
            checkpoint: undefined,
            hasError: false,
            errorDetails: 'Design dauerhaft von automatischen Updates ausgeschlossen (skip_update=true).'
          } : null);
        }
        alert(data.message || 'Design wurde erfolgreich mit Skip Update markiert.');
      } else {
        alert(data.error || 'Fehler beim Setzen von Skip Update');
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    } finally {
      setSkippingUpdateTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Möchtest du den Task ${taskId} wirklich löschen?`)) return;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setTasks(prev => {
          const updated = prev.filter(t => t.id !== taskId);
          if (selectedTaskId === taskId) {
            setSelectedTaskId(updated[0]?.id || null);
          }
          return updated;
        });
      } else {
        alert(data.error || 'Fehler beim Löschen des Tasks');
      }
    } catch (err: any) {
      alert(`Netzwerkfehler: ${err.message}`);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Möchtest du wirklich alle Logs leeren?')) return;
    try {
      const res = await fetch('/api/v1/tasks/log', { method: 'DELETE' });
      if (res.ok) {
        setTasks([]);
        setSelectedTaskId(null);
      }
    } catch (err) {
      alert('Fehler beim Leeren der Logs');
    }
  };

  // Filter tasks (filtering & search happen on server across full history)
  const filteredTasks = tasks.filter(t => {
    if (filterSource !== 'ALL' && t.source !== filterSource) return false;
    return true;
  });

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'HERMES': return <Bot className="w-3.5 h-3.5 text-cyan-400" />;
      case 'TEST': return <TestTube className="w-3.5 h-3.5 text-amber-400" />;
      case 'DESIGNER': return <Sparkles className="w-3.5 h-3.5 text-purple-400" />;
      case 'UPDATE': return <RotateCcw className="w-3.5 h-3.5 text-teal-400" />;
      default: return <Terminal className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getSourceBadgeClass = (source: string) => {
    switch (source) {
      case 'HERMES': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'TEST': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'DESIGNER': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'UPDATE': return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      default: return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diffSec < 10) return 'Gerade eben';
      if (diffSec < 60) return `vor ${diffSec}s`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `vor ${diffMin}m`;
      const diffHours = Math.floor(diffMin / 60);
      return `vor ${diffHours}h`;
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Terminal className="w-6 h-6 text-cyan-400" />
            Prompt Log
          </h2>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPlayground(!showPlayground)}
            title={showPlayground ? 'Playground ausblenden' : 'Playground einblenden'}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              showPlayground
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            <TestTube className="w-3.5 h-3.5" />
            <span>Playground</span>
          </button>

          <button
            type="button"
            onClick={() => setShowInspector(!showInspector)}
            title={showInspector ? 'Amazon Merch API Inspector ausblenden' : 'Amazon Merch API Inspector einblenden'}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              showInspector
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            <SearchCode className="w-3.5 h-3.5" />
            <span>Inspector</span>
          </button>

          <button
            onClick={() => fetchTasks()}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Aktualisieren</span>
          </button>
          {tasks.length > 0 && (
            <button
              onClick={handleClearLogs}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Logs leeren</span>
            </button>
          )}
        </div>
      </div>

      {/* Mini Playground */}
      {showPlayground && (
        <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <TestTube className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-200">Playground</h3>
              <p className="text-[10px] text-slate-400">Test-Task simulieren (Präfix <code>#xxx-T</code>)</p>
            </div>
          </div>
          {testSuccessMessage && (
            <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Check className="w-3 h-3" />
              <span>{testSuccessMessage}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSendTestTask} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-5 space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nische</label>
            <input
              type="text"
              value={playNiche1}
              onChange={e => setPlayNiche1(e.target.value)}
              placeholder="z.B. Angel Numbers"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="sm:col-span-5 space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Quote</label>
            <input
              type="text"
              value={playQuote}
              onChange={e => setPlayQuote(e.target.value)}
              placeholder="z.B. 111 Manifest Your Reality"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submittingTest || !playQuote.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submittingTest ? 'Sendet...' : 'Test senden'}</span>
            </button>
          </div>
        </form>
      </div>
      )}

      {/* Amazon Merch API Inspector Test Area */}
      {showInspector && (
      <div className="glass-panel p-4 rounded-2xl border border-teal-500/20 bg-slate-950/40 space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <SearchCode className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Amazon Merch API Inspector</h3>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-500/10 text-teal-400 border border-teal-500/20">Session 1 Live</span>
              </div>
              <p className="text-[10px] text-slate-400">Teste Live-Endpunkte mit einer echten Merch by Amazon Design-ID (UUID)</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {(inspectConfigResult || inspectListingsResult || inspectDomResult) && (
              <button
                onClick={() => {
                  setInspectConfigResult(null);
                  setInspectListingsResult(null);
                  setInspectDomResult(null);
                  setInspectError(null);
                }}
                className="px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
              >
                Ergebnisse zurücksetzen
              </button>
            )}
          </div>
        </div>

        {/* Input Bar & Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-end">
          <div className="lg:col-span-4 space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Design ID (UUID)</span>
              <span className="text-[9px] font-normal text-slate-500 font-mono">Format: xxxxxxxx-...</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={inspectDesignId}
                onChange={e => setInspectDesignId(e.target.value)}
                placeholder="z.B. 495f452e-8245-42be-96e3-a1d3dcc752d9"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-teal-300 placeholder-slate-600 focus:outline-none focus:border-teal-500/60 shadow-inner"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <button
              onClick={handleInspectProductConfig}
              disabled={inspectLoadingConfig || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-all shadow-md active:scale-95"
            >
              <FileJson className={`w-3.5 h-3.5 ${inspectLoadingConfig ? 'animate-spin' : ''}`} />
              <span>{inspectLoadingConfig ? 'Lade...' : '1. Config'}</span>
            </button>
          </div>

          <div className="lg:col-span-2">
            <button
              onClick={handleInspectFindListings}
              disabled={inspectLoadingListings || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-50 transition-all shadow-md active:scale-95"
            >
              <Database className={`w-3.5 h-3.5 ${inspectLoadingListings ? 'animate-spin' : ''}`} />
              <span>{inspectLoadingListings ? 'Suche...' : '2. Listings'}</span>
            </button>
          </div>

          <div className="lg:col-span-2">
            <button
              onClick={handleInspectDomLive}
              disabled={inspectLoadingDom || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-2.5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-all shadow-md active:scale-95 border border-purple-400/30"
              title="Öffnet die Merch Edit-Seite im Browser und liest die echte Select-Products Live-Tabelle im DOM aus"
            >
              <SearchCode className={`w-3.5 h-3.5 ${inspectLoadingDom ? 'animate-spin' : ''}`} />
              <span>{inspectLoadingDom ? 'Scannt DOM...' : '3. 🔍 DOM Live'}</span>
            </button>
          </div>

          <div className="lg:col-span-2">
            <button
              onClick={() => handleRunFullUpdatePipeline(inspectDesignId.trim())}
              disabled={creatingUpdateTask || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1 px-2 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white disabled:opacity-50 transition-all shadow-lg active:scale-95 border border-amber-400/30"
              title="Führt die gesamte Update-Pipeline von U1 bis U7 durch und reiht in die Queue ein"
            >
              <Sparkles className={`w-3.5 h-3.5 ${creatingUpdateTask ? 'animate-spin' : ''}`} />
              <span>{creatingUpdateTask ? 'Läuft...' : '4. 🚀 Pipeline'}</span>
            </button>
          </div>
        </div>

        {updateTaskSuccessMessage && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-semibold">{updateTaskSuccessMessage}</span>
            </div>
            <span className="text-[10px] text-amber-400/80 font-mono">Im Prompt Log unter "Updates" geöffnet</span>
          </div>
        )}

        {inspectError && (
          <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="font-mono text-[11px]">{inspectError}</span>
          </div>
        )}

        {/* Results Dual Grid */}
        {(inspectConfigResult || inspectListingsResult) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            {/* Panel 1: Product Config */}
            <div className="glass-panel p-3.5 rounded-xl border border-slate-800/90 bg-slate-950 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex items-center space-x-1.5">
                  <FileJson className="w-3.5 h-3.5 text-teal-400" />
                  <span className="text-xs font-bold text-slate-200">Product Config</span>
                  {inspectConfigResult?.status && (
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${inspectConfigResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      HTTP {inspectConfigResult.status}
                    </span>
                  )}
                </div>
                {inspectConfigResult?.data && (
                  <CopyButton text={JSON.stringify(inspectConfigResult.data, null, 2)} label="JSON kopieren" />
                )}
              </div>

              {inspectConfigResult ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Sprachen im TextData:</span>
                    {inspectConfigResult.metadata?.languages?.length > 0 ? (
                      inspectConfigResult.metadata.languages.map((l: string) => (
                        <span key={l} className="px-1.5 py-0.2 rounded bg-slate-800 text-teal-300 font-mono font-semibold">{l}</span>
                      ))
                    ) : (
                      <span className="text-slate-500 italic">Keine</span>
                    )}
                  </div>
                  <pre className="p-2.5 bg-slate-900/90 rounded-lg text-teal-200 font-mono text-[10px] border border-slate-800 overflow-x-auto max-h-72 custom-scrollbar whitespace-pre-wrap">
                    {JSON.stringify(inspectConfigResult.data, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic py-6 text-center">Noch nicht abgefragt. Klicke auf "1. Product Config".</p>
              )}
            </div>

            {/* Panel 2: FindListings */}
            <div className="glass-panel p-3.5 rounded-xl border border-slate-800/90 bg-slate-950 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex items-center space-x-1.5">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-bold text-slate-200">FindListings RPC</span>
                  {inspectListingsResult?.status && (
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${inspectListingsResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      HTTP {inspectListingsResult.status}
                    </span>
                  )}
                </div>
                {inspectListingsResult?.data && (
                  <CopyButton text={JSON.stringify(inspectListingsResult.data, null, 2)} label="JSON kopieren" />
                )}
              </div>

              {inspectListingsResult ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Treffer für Design:</span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 font-mono font-bold">
                      {inspectListingsResult.metadata?.matchedCount ?? 0} Varianten
                    </span>
                    {inspectListingsResult.metadata?.statusSummary && (
                      Object.entries(inspectListingsResult.metadata.statusSummary).map(([st, cnt]) => (
                        <span key={st} className="px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 font-mono text-[9px]">
                          {st}: {String(cnt)}
                        </span>
                      ))
                    )}
                  </div>
                  <pre className="p-2.5 bg-slate-900/90 rounded-lg text-cyan-200 font-mono text-[10px] border border-slate-800 overflow-x-auto max-h-72 custom-scrollbar whitespace-pre-wrap">
                    {JSON.stringify(inspectListingsResult.data, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic py-6 text-center">Noch nicht abgefragt. Klicke auf "2. FindListings".</p>
              )}
            </div>
          </div>
        )}

        {/* Panel 3: Standalone DOM Live Products Inspector */}
        {inspectDomResult && (
          <div className="glass-panel p-4 rounded-xl border border-purple-500/40 bg-slate-950/90 space-y-3 shadow-xl">
            <div className="flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-2.5 gap-2">
              <div className="flex items-center space-x-2">
                <SearchCode className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">DOM Live-Inspektion (Select Products)</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  ⚡ {inspectDomResult.totalLiveSlots ?? 0} Live-Slots auf Amazon
                </span>
                {inspectDomResult.hasRejection ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>⚠️ Rejections / Policy erkannt</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Keine Rejections</span>
                  </span>
                )}
              </div>
              <CopyButton text={JSON.stringify(inspectDomResult, null, 2)} label="DOM-JSON kopieren" />
            </div>

            {inspectDomResult.rejectionReason && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span><strong>Rejection-Hinweis:</strong> {inspectDomResult.rejectionReason}</span>
              </div>
            )}

            {/* Live Products Matrix Chips */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Verifizierte Live-Produkte &amp; Marktplätze:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries<string[]>(inspectDomResult.liveProducts || {}).map(([prod, mps]) => (
                  <div key={prod} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1">
                    <div className="font-mono text-[11px] font-bold text-slate-200 truncate">{prod}</div>
                    <div className="flex flex-wrap gap-1">
                      {mps.map(mp => (
                        <span key={mp} className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          {mp} ✓
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(inspectDomResult.liveProducts || {}).length === 0 && (
                  <div className="text-xs text-slate-500 italic col-span-full py-2">Keine aktiven Live-Produkte im DOM gefunden.</div>
                )}
              </div>
            </div>

            {/* Unapproved / Draft Checkboxes */}
            {inspectDomResult.unapprovedOrDraftProducts?.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Nicht publizierte / Entwurf-Checkboxen ({inspectDomResult.unapprovedOrDraftProducts.length}):</span>
                <div className="flex flex-wrap gap-1.5">
                  {inspectDomResult.unapprovedOrDraftProducts.map((p: string) => (
                    <span key={p} className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Full JSON Foldout */}
            <details className="pt-2 text-xs text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200 font-mono text-[11px] select-none">
                ▶ Vollständiges DOM-Ergebnis anzeigen ({inspectDomResult.detailedElements?.length ?? 0} Elemente)
              </summary>
              <pre className="mt-2 p-2.5 bg-slate-900/90 rounded-lg text-purple-200 font-mono text-[10px] border border-slate-800 overflow-x-auto max-h-64 custom-scrollbar whitespace-pre-wrap">
                {JSON.stringify(inspectDomResult, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setFilterSource('ALL')}
            className={`px-3 py-1 rounded-lg transition-all ${filterSource === 'ALL' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Alle ({tasks.length})
          </button>
          <button
            onClick={() => setFilterSource('HERMES')}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg transition-all ${filterSource === 'HERMES' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Bot className="w-3 h-3" />
            <span>Hermes ({tasks.filter(t => t.source === 'HERMES').length})</span>
          </button>
          <button
            onClick={() => setFilterSource('TEST')}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg transition-all ${filterSource === 'TEST' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <TestTube className="w-3 h-3" />
            <span>Tests ({tasks.filter(t => t.source === 'TEST').length})</span>
          </button>
          <button
            onClick={() => setFilterSource('DESIGNER')}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg transition-all ${filterSource === 'DESIGNER' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Designer ({tasks.filter(t => t.source === 'DESIGNER').length})</span>
          </button>
          <button
            onClick={() => setFilterSource('UPDATE')}
            className={`flex items-center space-x-1 px-3 py-1 rounded-lg transition-all ${filterSource === 'UPDATE' ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <RotateCcw className="w-3 h-3" />
            <span>Updates ({tasks.filter(t => t.source === 'UPDATE').length})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ID, Nische oder Quote suchen..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-700"
          />
        </div>
      </div>

      {/* Main Two-Column Layout */}
      {listError && <p role="alert" className="text-xs text-amber-300">{listError}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Task List (4 cols) */}
        <div className="lg:col-span-4 glass-panel rounded-2xl p-2.5 border border-slate-800 space-y-2 overflow-y-auto max-h-[720px] custom-scrollbar" onScroll={e => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) loadMoreTasks();
        }}>
          {filteredTasks.length === 0 ? (
            <div className="text-center py-14 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Code2 className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-300">Keine Tasks gefunden</p>
              <p className="text-[11px] text-slate-500">Nutze den Playground oder sende einen Request.</p>
            </div>
          ) : (
            filteredTasks.map(task => {
              const isSelected = selectedTaskId === task.id;
              const displayQuote = task.quote || (task.source === 'UPDATE' ? 'Amazon Update Task' : 'Kein Quote');
              const displayNiche = [task.niche1, task.niche2].filter(Boolean).join(' • ') || (task.source === 'UPDATE' ? `ID: ${task.designId?.slice(0, 8) || ''}...` : '');
              const isUpdateDownloading = task.source === 'UPDATE' && (task.status === 'PROCESSING' || downloadingArtworkTaskId === task.id || (!task.imageUrl && !task.hasError && (task.eventsCount || 0) <= 2));

              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                    isSelected
                      ? 'bg-slate-900 border-cyan-500/60 ring-1 ring-cyan-500/20 shadow-md'
                      : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-mono text-xs font-bold text-white bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {task.id}
                      </span>
                      <span className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getSourceBadgeClass(task.source)}`}>
                        {getSourceIcon(task.source)}
                        <span>{task.source}</span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(task.receivedAt)}
                      </span>
                      {isTaskCancellable(task) && (
                        <button
                          onClick={(e) => handleCancelTask(task.id, e)}
                          disabled={cancellingTaskId === task.id}
                          className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                          title={`Task ${task.id} abbrechen`}
                        >
                          <Ban className={`w-3 h-3 ${cancellingTaskId === task.id ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                      {canPauseTask(task) && <button onClick={(e) => handleTaskControl(task.id, 'pause', e)} disabled={controllingTaskId === task.id} className="p-1 rounded text-amber-300 hover:bg-amber-500/10 disabled:opacity-50" title="Am nächsten sicheren Schritt pausieren"><Pause className="w-3 h-3" /></button>}
                      {task.status === 'PAUSED' && <button onClick={(e) => handleTaskControl(task.id, 'resume', e)} disabled={controllingTaskId === task.id} className="p-1 rounded text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50" title="Task fortsetzen"><Play className="w-3 h-3" /></button>}
                      {canSkipUpdate(task) && (
                        <button
                          onClick={(e) => handleSkipUpdate(task.id, e)}
                          disabled={skippingUpdateTaskId === task.id}
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors flex items-center gap-1 disabled:opacity-50"
                          title={`Design dauerhaft von automatischen Updates ausschließen (skip_update=true)`}
                        >
                          <FastForward className={`w-2.5 h-2.5 ${skippingUpdateTaskId === task.id ? 'animate-spin' : ''}`} />
                          <span>Skip</span>
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteTask(task.id, e)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title={`Task ${task.id} löschen`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-200 line-clamp-1">
                      "{displayQuote}"
                    </p>
                    {displayNiche && (
                      <p className="text-[10px] text-slate-400 line-clamp-1">
                        {displayNiche}
                      </p>
                    )}
                  </div>

                  {/* Status row */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                    <TaskStatusBadge task={task} size="sm" />

                    <span className="text-slate-500 font-mono">
                      {task.eventsCount || 1} Events
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* Load More Button */}
          {hasMore && (
            <button
              onClick={loadMoreTasks}
              disabled={loadingMore}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 text-xs font-semibold text-cyan-400 hover:bg-slate-850 flex items-center justify-center gap-2 transition-all mt-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMore ? 'animate-spin' : ''}`} />
              <span>{loadingMore ? 'Lade weitere Tasks...' : 'Mehr Tasks laden (10 weitere)'}</span>
            </button>
          )}
          {!hasMore && tasks.length > 0 && (
            <p className="text-[10px] text-slate-500 text-center py-2">
              Alle {totalCount || tasks.length} Tasks geladen
            </p>
          )}
        </div>

        {/* Right Column: Timeline Logbook (8 cols) */}
        <div className="lg:col-span-8 glass-panel rounded-2xl p-5 border border-slate-800 space-y-5 max-h-[720px] overflow-y-auto custom-scrollbar">
          {detailError && <p role="alert" className="mb-3 text-xs text-amber-300">{detailError}</p>}
          {loadingDetail && !selectedTask ? (
            <div className="flex flex-col items-center justify-center py-28 space-y-3">
              <RefreshCw className="w-7 h-7 text-cyan-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-300">Lade vollständige Task-Details...</p>
              <p className="text-[11px] text-slate-500">Events, Listings und Metadaten werden abgerufen</p>
            </div>
          ) : selectedTask ? (
            <div className="space-y-5">
              {/* Task Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-white bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                    {selectedTask.id}
                  </span>
                  <span className={`flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold border ${getSourceBadgeClass(selectedTask.source)}`}>
                    {getSourceIcon(selectedTask.source)}
                    <span>{selectedTask.source}</span>
                  </span>
                  <TaskStatusBadge task={selectedTask} size="md" />
                </div>
                <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
                  {selectedTask.clientIp && (
                    <div className="flex items-center space-x-1">
                      <Globe className="w-3 h-3" />
                      <span>{selectedTask.clientIp}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(selectedTask.receivedAt).toLocaleTimeString()}</span>
                  </div>
                  {isTaskCancellable(selectedTask) && (
                    <button
                      onClick={(e) => handleCancelTask(selectedTask.id, e)}
                      disabled={cancellingTaskId === selectedTask.id}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-colors disabled:opacity-50"
                      title="Diesen Task abbrechen"
                    >
                      <Ban className={`w-3.5 h-3.5 ${cancellingTaskId === selectedTask.id ? 'animate-spin' : ''}`} />
                      <span>Abbrechen</span>
                    </button>
                  )}
                  {canPauseTask(selectedTask) && <button onClick={(e) => handleTaskControl(selectedTask.id, 'pause', e)} disabled={controllingTaskId === selectedTask.id} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 disabled:opacity-50"><Pause className="w-3.5 h-3.5" />Pausieren</button>}
                  {selectedTask.status === 'PAUSED' && <button onClick={(e) => handleTaskControl(selectedTask.id, 'resume', e)} disabled={controllingTaskId === selectedTask.id} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 disabled:opacity-50"><Play className="w-3.5 h-3.5" />Fortsetzen</button>}
                  {canSkipUpdate(selectedTask) && (
                    <button
                      onClick={(e) => handleSkipUpdate(selectedTask.id, e)}
                      disabled={skippingUpdateTaskId === selectedTask.id}
                      className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 transition-colors disabled:opacity-50"
                      title="Design dauerhaft von automatischen Updates ausschließen (skip_update=true)"
                    >
                      <FastForward className={`w-3.5 h-3.5 ${skippingUpdateTaskId === selectedTask.id ? 'animate-spin' : ''}`} />
                      <span>Skip Update</span>
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDeleteTask(selectedTask.id, e)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 transition-colors"
                    title="Diesen Task löschen"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Löschen</span>
                  </button>
                </div>
              </div>

              {/* Dedicated Update Task Overview Banner */}
              {selectedTask.source === 'UPDATE' && selectedTask.payload?.designId && (
                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-3 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Amazon Update Rohdaten
                      </span>
                      <span className="font-mono text-xs text-slate-300">
                        Design-ID: <span className="text-amber-400 font-bold">{selectedTask.payload.designId}</span>
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleDownloadArtwork(selectedTask.id, selectedTask.payload.designId)}
                        disabled={downloadingArtworkTaskId === selectedTask.id}
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${downloadingArtworkTaskId === selectedTask.id ? 'animate-spin' : ''}`} />
                        <span>{downloadingArtworkTaskId === selectedTask.id ? 'Lädt Design...' : 'Artwork erneut laden'}</span>
                      </button>

                      {selectedTask.payload.editUrl && (
                        <a
                          href={selectedTask.payload.editUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700 transition-colors"
                        >
                          <span>Amazon Edit</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Summary Details Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 text-xs">
                    {/* Left: Master Listing Info */}
                    <div className="lg:col-span-5 space-y-1.5 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Original Master-Listing (EN)</div>
                      <div className="font-bold text-white text-sm line-clamp-2">{selectedTask.payload.title || selectedTask.payload.masterListing?.title || 'Kein Titel'}</div>
                      <div className="text-slate-400 text-xs font-medium">Brand: <span className="text-slate-200 font-semibold">{selectedTask.payload.brand || selectedTask.payload.masterListing?.brandName || '-'}</span></div>
                      {selectedTask.payload.bullets && selectedTask.payload.bullets.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px] pt-1">
                          {selectedTask.payload.bullets.map((b: string, i: number) => (
                            <li key={i} className="line-clamp-2">{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Middle: Live Stats & Products */}
                    <div className="lg:col-span-4 space-y-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Live Status & Slot-Kalkulation</div>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold text-xs border border-emerald-500/30">
                            {selectedTask.payload.liveStats?.publishedCount || 0} Varianten PUBLISHED
                          </span>
                          <span className="text-[11px] text-emerald-300 font-mono font-bold">
                            ➔ 0 Slots
                          </span>
                        </div>
                        {selectedTask.payload.globalArtworkUrn && (
                          <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                            URN: <span className="text-cyan-400">{selectedTask.payload.globalArtworkUrn}</span>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Produkte: <strong className="text-slate-200">{selectedTask.payload.productTypes?.length || 0} Typen</strong></span>
                        <span>Sprachen: <strong className="text-slate-200">{Object.keys(selectedTask.payload.textData || {}).join(', ').toUpperCase() || 'EN'}</strong></span>
                      </div>
                    </div>

                    {/* Right: Downloaded Artwork Preview */}
                    <div className="lg:col-span-3 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 flex flex-col items-center justify-center text-center space-y-1.5">
                      <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider self-start">Master-Artwork</div>
                      {selectedTask.localImagePath || selectedTask.imageUrl ? (
                        <div className="relative group w-full flex flex-col items-center">
                          <img
                            src={selectedTask.localImagePath || selectedTask.imageUrl}
                            alt="Original Design"
                            className="w-24 h-24 object-contain rounded-lg border border-slate-700 bg-slate-950 shadow p-0.5"
                          />
                          <div className="flex items-center space-x-1 mt-1.5">
                            <a
                              href={selectedTask.localImagePath || selectedTask.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                            >
                              Vollbild ↗
                            </a>
                            <a
                              href={selectedTask.localImagePath || selectedTask.imageUrl}
                              download={`${selectedTask.id}-original.png`}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
                            >
                              PNG ⬇
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-24 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/50 text-slate-500 text-[10px] space-y-1">
                          <ImageIcon className="w-5 h-5 opacity-40 animate-pulse" />
                          <span>{downloadingArtworkTaskId === selectedTask.id ? 'Lade herunter...' : 'Nicht geladen'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Timeline */}
              <PromptLogTimeline
                task={selectedTask}
                retryingStep={retryingStep}
                onRetry={handleRetryStep}
                onRepeatFinalization={handleRepeatFinalization}
                finalizingTaskId={finalizingTaskId}
                finalizationMessage={finalizationMessage}
                onPushToQueue={handlePushToQueue}
                pushingToQueueTaskId={pushingToQueueTaskId}
                pushSuccessTaskId={pushSuccessTaskId}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-16 space-y-2">
              <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-600">
                <Terminal className="w-6 h-6" />
              </div>
              <h4 className="text-xs font-semibold text-slate-300">Kein Task ausgewählt</h4>
              <p className="text-[11px] text-slate-500 max-w-xs">Wähle links einen Task aus, um das Logbuch einzusehen.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  Send, 
  Search, 
  Copy, 
  Check, 
  Trash2, 
  RefreshCw, 
  Bot, 
  TestTube, 
  Sparkles, 
  Clock, 
  Globe, 
  AlertCircle,
  Code2,
  CheckCircle2,
  Zap,
  Image as ImageIcon,
  ExternalLink,
  Download,
  Eye,
  Users,
  Palette,
  Scissors,
  CheckSquare,
  RotateCcw,
  FileText,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  UploadCloud,
  FileJson,
  Database,
  SearchCode,
  PlusCircle
} from 'lucide-react';

import { 
  DesignTaskLog, 
  SessionEvent, 
  RetryStepType,
  EventCategory 
} from '../../types/tasks';

// ---------------------------------------------------------------------------
// Helper: Event Category & Color System
// ---------------------------------------------------------------------------
export const getEventCategory = (event: SessionEvent): EventCategory => {
  const t = event.type;
  if (t === 'ERROR') return 'ERROR';
  if (t === 'INCOMING_PAYLOAD' || t === 'TASK_HANDOFF') return 'SYSTEM';
  if (t.startsWith('TM_')) return 'TRADEMARK';
  if (t.startsWith('IDEOGRAM_')) return 'IDEOGRAM';
  if (t.startsWith('VECTORIZE_') || t.startsWith('SVG_')) return 'VECTORIZE';
  return 'OPENROUTER';
};

export const getCategoryStyles = (category: EventCategory) => {
  switch (category) {
    case 'SYSTEM':
      return {
        dotBg: 'bg-teal-400',
        dotBorder: 'border-teal-950',
        dotRing: 'ring-2 ring-teal-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-teal-500/30',
        badgeBg: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
        headerText: 'text-teal-300',
        actionBtn: 'hover:bg-teal-500/20 text-teal-300 border-teal-500/40'
      };
    case 'OPENROUTER':
      return {
        dotBg: 'bg-sky-400',
        dotBorder: 'border-sky-950',
        dotRing: 'ring-2 ring-sky-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-sky-500/30',
        badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
        headerText: 'text-sky-300',
        actionBtn: 'hover:bg-sky-500/20 text-sky-300 border-sky-500/40'
      };
    case 'TRADEMARK':
      return {
        dotBg: 'bg-amber-400',
        dotBorder: 'border-amber-950',
        dotRing: 'ring-2 ring-amber-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-amber-500/30',
        badgeBg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
        headerText: 'text-amber-300',
        actionBtn: 'hover:bg-amber-500/20 text-amber-300 border-amber-500/40'
      };
    case 'IDEOGRAM':
      return {
        dotBg: 'bg-purple-400',
        dotBorder: 'border-purple-950',
        dotRing: 'ring-2 ring-purple-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-purple-500/30',
        badgeBg: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
        headerText: 'text-purple-300',
        actionBtn: 'hover:bg-purple-500/20 text-purple-300 border-purple-500/40'
      };
    case 'VECTORIZE':
      return {
        dotBg: 'bg-pink-400',
        dotBorder: 'border-pink-950',
        dotRing: 'ring-2 ring-pink-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-pink-500/30',
        badgeBg: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
        headerText: 'text-pink-300',
        actionBtn: 'hover:bg-pink-500/20 text-pink-300 border-pink-500/40'
      };
    case 'ERROR':
    default:
      return {
        dotBg: 'bg-rose-500',
        dotBorder: 'border-rose-950',
        dotRing: 'ring-2 ring-rose-500/30',
        cardBg: 'bg-slate-950',
        cardBorder: 'border-rose-500/30',
        badgeBg: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
        headerText: 'text-rose-300',
        actionBtn: 'hover:bg-rose-500/20 text-rose-300 border-rose-500/40'
      };
  }
};

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
// Helper: Collapsible JSON Details
// ---------------------------------------------------------------------------
const JsonDetails: React.FC<{ title: string; data: any; defaultOpen?: boolean }> = ({ title, data, defaultOpen = false }) => {
  if (!data) return null;
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <details className="text-[11px] text-slate-400 group" open={defaultOpen}>
      <summary className="cursor-pointer font-semibold text-slate-400 hover:text-cyan-400 flex items-center justify-between py-1">
        <span>{title}</span>
        <CopyButton text={jsonStr} label="JSON" className="opacity-0 group-hover:opacity-100" />
      </summary>
      <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-slate-300 font-mono text-[11px] border border-slate-800/80 overflow-x-auto max-h-56 custom-scrollbar whitespace-pre-wrap">
        {jsonStr}
      </pre>
    </details>
  );
};

// ---------------------------------------------------------------------------
// Helper: Cache-Busting Image URLs
// ---------------------------------------------------------------------------
const getCacheBustedUrl = (url?: string, timestamp?: string) => {
  if (!url) return '';
  const buster = timestamp ? new Date(timestamp).getTime() : Date.now();
  return url.includes('?') ? `${url}&_t=${buster}` : `${url}?_t=${buster}`;
};

// ---------------------------------------------------------------------------
// Helper: Event Timeline Header
// ---------------------------------------------------------------------------
interface EventHeaderProps {
  event: SessionEvent;
  taskId: string;
  category: EventCategory;
  onRetry?: (stepType: RetryStepType) => void;
  retryStepType?: RetryStepType;
  isRetrying?: boolean;
}

const EventHeader: React.FC<EventHeaderProps> = ({
  event,
  taskId,
  category,
  onRetry,
  retryStepType,
  isRetrying
}) => {
  const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const styles = getCategoryStyles(category);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center space-x-2">
        <span className="font-mono text-[11px] font-semibold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
          {timeStr}
        </span>
        <span className={`font-semibold ${styles.headerText}`}>
          {event.title}
        </span>
      </div>

      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
        {event.metadata?.provider && (
          <span className={`px-2 py-0.5 rounded border font-semibold ${styles.badgeBg}`}>
            {event.metadata.provider}
          </span>
        )}
        {event.metadata?.model && (
          <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
            {event.metadata.model}
          </span>
        )}
        {event.metadata?.latencyMs !== undefined && (
          <span className="text-cyan-400">
            {event.metadata.latencyMs > 1000 ? `${(event.metadata.latencyMs / 1000).toFixed(1)}s` : `${event.metadata.latencyMs}ms`}
          </span>
        )}
        {event.metadata?.tokens?.total && (
          <span className="text-purple-400">
            {event.metadata.tokens.total} Tokens
          </span>
        )}
        {onRetry && retryStepType && (
          <button
            onClick={() => onRetry(retryStepType)}
            disabled={isRetrying}
            type="button"
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors disabled:opacity-50 ${styles.actionBtn}`}
            title="Ab diesem Schritt neu ausführen"
          >
            <RotateCcw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>Neu ausführen</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const PromptLogView: React.FC = () => {
  const [tasks, setTasks] = useState<DesignTaskLog[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'ALL' | 'HERMES' | 'TEST' | 'DESIGNER' | 'UPDATE'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [selectedListingLang, setSelectedListingLang] = useState<Record<string, string>>({});

  // Mini Playground State
  const [playNiche1, setPlayNiche1] = useState('Angel Numbers');
  const [playQuote, setPlayQuote] = useState('111 Manifest Your Reality');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);
  const [pushingToQueueTaskId, setPushingToQueueTaskId] = useState<string | null>(null);
  const [pushSuccessTaskId, setPushSuccessTaskId] = useState<string | null>(null);

  // Amazon Merch API Inspector State
  const [inspectDesignId, setInspectDesignId] = useState('495f452e-8245-42be-96e3-a1d3dcc752d9');
  const [inspectLoadingConfig, setInspectLoadingConfig] = useState(false);
  const [inspectLoadingListings, setInspectLoadingListings] = useState(false);
  const [inspectConfigResult, setInspectConfigResult] = useState<any>(null);
  const [inspectListingsResult, setInspectListingsResult] = useState<any>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [creatingUpdateTask, setCreatingUpdateTask] = useState(false);
  const [updateTaskSuccessMessage, setUpdateTaskSuccessMessage] = useState<string | null>(null);

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

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || tasks[0] || null;

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/v1/tasks/log');
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        setSelectedTaskId(prev => {
          if (prev && data.tasks.some((t: any) => t.id === prev)) {
            return prev;
          }
          return data.tasks[0]?.id || null;
        });
      }
    } catch (err) {
      console.warn('Failed to fetch task logs:', err);
    } finally {
      setLoading(false);
    }
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
        await fetchTasks();
      }
    } catch (e) {
      console.warn('Failed to retry task step:', e);
    } finally {
      setTimeout(() => setRetryingStep(null), 1000);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

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

  // Filter tasks
  const filteredTasks = tasks.filter(t => {
    if (filterSource !== 'ALL' && t.source !== filterSource) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const idMatch = t.id.toLowerCase().includes(q);
    const nicheMatch = t.payload?.niche1?.toLowerCase().includes(q) || t.payload?.niche2?.toLowerCase().includes(q);
    const quoteMatch = t.payload?.quote?.toLowerCase().includes(q);
    return idMatch || nicheMatch || quoteMatch;
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
          <p className="text-xs text-slate-400 mt-0.5">
            Chronologisches Audit-Logbuch aller LLM- und Tool-Aufrufe.
          </p>
        </div>
        <div className="flex items-center space-x-2.5">
          <button
            onClick={fetchTasks}
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

      {/* Amazon Merch API Inspector Test Area */}
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
            {(inspectConfigResult || inspectListingsResult) && (
              <button
                onClick={() => {
                  setInspectConfigResult(null);
                  setInspectListingsResult(null);
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5 space-y-1">
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
              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-all shadow-md active:scale-95"
            >
              <FileJson className={`w-3.5 h-3.5 ${inspectLoadingConfig ? 'animate-spin' : ''}`} />
              <span>{inspectLoadingConfig ? 'Lade...' : '1. Config'}</span>
            </button>
          </div>

          <div className="lg:col-span-2">
            <button
              onClick={handleInspectFindListings}
              disabled={inspectLoadingListings || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-50 transition-all shadow-md active:scale-95"
            >
              <Database className={`w-3.5 h-3.5 ${inspectLoadingListings ? 'animate-spin' : ''}`} />
              <span>{inspectLoadingListings ? 'Suche...' : '2. Listings'}</span>
            </button>
          </div>

          <div className="lg:col-span-3">
            <button
              onClick={() => handleRunFullUpdatePipeline(inspectDesignId.trim())}
              disabled={creatingUpdateTask || !inspectDesignId.trim()}
              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white disabled:opacity-50 transition-all shadow-lg active:scale-95 border border-amber-400/30"
              title="Führt die gesamte Update-Pipeline von U1 bis U7 durch und reiht in die Queue ein"
            >
              <Sparkles className={`w-3.5 h-3.5 ${creatingUpdateTask ? 'animate-spin' : ''}`} />
              <span>{creatingUpdateTask ? 'Pipeline läuft...' : '3. 🚀 Pipeline Starten'}</span>
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
      </div>

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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Task List (4 cols) */}
        <div className="lg:col-span-4 glass-panel rounded-2xl p-2.5 border border-slate-800 space-y-2 overflow-y-auto max-h-[720px] custom-scrollbar">
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
              const isSelected = selectedTask?.id === task.id;
              const displayQuote = task.payload?.title || task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || (task.source === 'UPDATE' ? 'Amazon Update Task' : 'Kein Quote');
              const displayNiche = [task.payload?.niche1, task.payload?.niche2].filter(Boolean).join(' • ') || (task.source === 'UPDATE' ? `ID: ${task.payload?.designId?.slice(0, 8)}...` : '');
              const isUpdateDownloading = task.source === 'UPDATE' && (task.status === 'PROCESSING' || downloadingArtworkTaskId === task.id || (!task.imageUrl && !task.hasError && (task.events?.length || 0) <= 2));

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
                    {task.source === 'UPDATE' ? (
                      isUpdateDownloading ? (
                        <span className="text-amber-400 font-semibold animate-pulse flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Downloading Design...
                        </span>
                      ) : task.hasError ? (
                        <span className="text-rose-400 font-semibold">Download Fehler</span>
                      ) : (task.imageUrl || task.localImagePath) ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Design bereit
                        </span>
                      ) : (
                        <span className="text-teal-400 font-semibold">Rohdaten erfasst</span>
                      )
                    ) : (
                      <>
                        {task.status === 'PROCESSING' && (
                          <span className="text-amber-400 font-semibold animate-pulse">OpenRouter Prompt...</span>
                        )}
                        {task.status === 'GENERATING_IMAGE' && (
                          <span className="text-purple-400 font-semibold animate-pulse">Ideogram Bild...</span>
                        )}
                        {task.status === 'ANALYZING_DESIGN' && (
                          <span className="text-cyan-400 font-semibold animate-pulse">Vision-Analyse...</span>
                        )}
                        {task.status === 'GENERATING_LISTING' && (
                          <span className="text-emerald-400 font-semibold animate-pulse">MBA Listing...</span>
                        )}
                        {task.status === 'CHECKING_TRADEMARKS' && (
                          <span className="text-amber-400 font-semibold animate-pulse">USPTO TM Check...</span>
                        )}
                        {task.status === 'AWAITING_PRE_FLIGHT_REVIEW' && (
                          <span className="text-amber-400 font-semibold">Wartet: Quote TM</span>
                        )}
                        {task.status === 'AWAITING_DESIGN_REVIEW' && (
                          <span className="text-cyan-300 font-semibold">Wartet: Design</span>
                        )}
                        {task.status === 'AWAITING_TM_REVIEW' && (
                          <span className="text-purple-300 font-semibold">Wartet: TM Review</span>
                        )}
                        {task.status === 'VECTORIZING_DESIGN' && (
                          <span className="text-emerald-400 font-semibold animate-pulse">Vektorisierung...</span>
                        )}
                        {task.status === 'AWAITING_SVG_REVIEW' && (
                          <span className="text-emerald-300 font-semibold">Wartet: SVG Prüfung</span>
                        )}
                        {task.status === 'COMPLETED' && (
                          <span className="text-emerald-400 font-semibold">Abgeschlossen</span>
                        )}
                        {task.status === 'REJECTED' && (
                          <span className="text-rose-400 font-semibold">Abgelehnt</span>
                        )}
                        {task.hasError && (
                          <span className="text-rose-400 font-semibold">Fehler</span>
                        )}
                      </>
                    )}

                    <span className="text-slate-500 font-mono">
                      {task.events?.length || 1} Events
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Timeline Logbook (8 cols) */}
        <div className="lg:col-span-8 glass-panel rounded-2xl p-5 border border-slate-800 space-y-5 max-h-[720px] overflow-y-auto custom-scrollbar">
          {selectedTask ? (
            <div className="space-y-5">
              {/* Task Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
                <div className="flex items-center space-x-2.5">
                  <span className="font-mono text-sm font-bold text-white bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                    {selectedTask.id}
                  </span>
                  <span className={`flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold border ${getSourceBadgeClass(selectedTask.source)}`}>
                    {getSourceIcon(selectedTask.source)}
                    <span>{selectedTask.source}</span>
                  </span>
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
              <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {(selectedTask.events || []).map((event, idx) => {
                  const isPreFlight = event.content?.isPreFlight || (event.type === 'TM_CHECK_REQUEST' && idx <= 3);
                  const category = getEventCategory(event);
                  const styles = getCategoryStyles(category);
                  const retryType: RetryStepType | undefined = 
                    event.type === 'LLM_REQUEST' ? 'LLM_REQUEST' :
                    event.type === 'IDEOGRAM_REQUEST' ? 'IDEOGRAM_REQUEST' :
                    event.type === 'ANALYSIS_REQUEST' ? 'ANALYSIS_REQUEST' :
                    event.type === 'LISTING_REQUEST' ? 'LISTING_REQUEST' :
                    event.type === 'TM_CHECK_REQUEST' ? (isPreFlight ? 'PREFLIGHT_TM_REQUEST' : 'TM_CHECK_REQUEST') :
                    event.type === 'TM_REFINE_REQUEST' ? 'TM_REFINE_REQUEST' :
                    event.type === 'VECTORIZE_REQUEST' ? 'VECTORIZE_REQUEST' :
                    event.type === 'SVG_AUDIT_REQUEST' ? 'SVG_AUDIT_REQUEST' :
                    event.type === 'SVG_EDIT_REQUEST' ? 'SVG_REVIEW' : undefined;

                  return (
                    <div key={idx} className="relative pl-7 space-y-2">
                      {/* Timeline Bullet */}
                      <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 -translate-x-1/2 transition-colors ${styles.dotBg} ${styles.dotBorder} ${styles.dotRing}`} />

                      {/* Header */}
                      <EventHeader
                        event={event}
                        taskId={selectedTask.id}
                        category={category}
                        onRetry={retryType ? (st) => handleRetryStep(selectedTask.id, st, idx) : undefined}
                        retryStepType={retryType}
                        isRetrying={retryingStep === `${selectedTask.id}-${retryType}-${idx}`}
                      />

                      {/* Event Body */}
                      {event.type === 'INCOMING_PAYLOAD' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-teal-500/30 space-y-1.5 shadow-sm">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="font-semibold text-teal-300">Empfangenes Payload:</span>
                            <CopyButton text={JSON.stringify(event.content, null, 2)} label="JSON" />
                          </div>
                          <pre className="font-mono text-xs text-slate-300 overflow-x-auto max-h-40 custom-scrollbar">
                            {JSON.stringify(event.content, null, 2)}
                          </pre>
                        </div>
                      )}

                      {event.type === 'SESSION_START' && (
                        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                          <span>{event.content}</span>
                          <span className="font-mono text-cyan-400 text-[11px]">{event.metadata?.provider}</span>
                        </div>
                      )}

                      {event.type === 'LLM_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 space-y-2">
                          {event.content?.systemPrompt && (
                            <JsonDetails title="System Prompt (Klick zum Aufklappen)" data={event.content.systemPrompt} />
                          )}
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase text-slate-400 block">Prompt / Request:</span>
                            <pre className="p-2 bg-slate-900 rounded-lg text-xs text-cyan-300 font-mono whitespace-pre-wrap border border-slate-800">
                              {typeof event.content === 'string'
                                ? event.content
                                : (event.content?.userMessage || JSON.stringify(event.content, null, 2))}
                            </pre>
                          </div>
                        </div>
                      )}

                      {event.type === 'LLM_RESPONSE' && (() => {
                        let displayPrompt = '';
                        let isJson = false;

                        if (typeof event.content === 'string') {
                          let str = event.content.trim();
                          if (str.startsWith('```')) {
                            str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                          }
                          try {
                            const parsed = JSON.parse(str);
                            if (parsed && typeof parsed === 'object') {
                              if (typeof parsed.prompt === 'string') {
                                displayPrompt = parsed.prompt;
                              } else {
                                displayPrompt = JSON.stringify(parsed, null, 2);
                                isJson = true;
                              }
                            } else {
                              displayPrompt = str;
                            }
                          } catch {
                            displayPrompt = str;
                          }
                        } else if (typeof event.content === 'object' && event.content !== null) {
                          if (typeof event.content.prompt === 'string') {
                            displayPrompt = event.content.prompt;
                          } else {
                            displayPrompt = JSON.stringify(event.content, null, 2);
                            isJson = true;
                          }
                        } else {
                          displayPrompt = String(event.content ?? '');
                        }

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-emerald-400">
                                {isJson ? 'Generierte Daten (JSON):' : 'Generierter Ideogram-Prompt:'}
                              </span>
                              <CopyButton text={displayPrompt} label="Kopieren" />
                            </div>
                            <pre className="font-mono text-xs text-slate-100 bg-slate-900 p-2.5 rounded-lg border border-slate-800 leading-relaxed select-all whitespace-pre-wrap">
                              {displayPrompt}
                            </pre>
                          </div>
                        );
                      })()}

                      {event.type === 'IDEOGRAM_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-purple-500/30 space-y-2">
                          <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Speed: {event.content?.renderingSpeed || 'default'}
                            </span>
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Ratio: {event.content?.aspectRatio || '1:1'}
                            </span>
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Style: {event.content?.style || 'AUTO'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 font-mono bg-slate-900 p-2 rounded-lg border border-slate-800 line-clamp-2">
                            {event.content?.prompt || JSON.stringify(event.content)}
                          </p>
                        </div>
                      )}

                      {event.type === 'IDEOGRAM_RESPONSE' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-purple-500/30 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                              Generiertes Design
                            </span>
                            <div className="flex items-center space-x-1.5">
                              <a
                                href={event.content?.localUrl || event.content?.imageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Vollbild</span>
                              </a>
                              <a
                                href={event.content?.localUrl || event.content?.imageUrl}
                                download={`${selectedTask.id}.png`}
                                className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>PNG</span>
                              </a>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                            <img
                              src={event.content?.localUrl || event.content?.imageUrl}
                              alt="Design"
                              className="w-36 h-36 object-contain rounded-lg border border-slate-800 bg-slate-950"
                              loading="lazy"
                            />
                            <div className="flex-1 space-y-1 text-xs">
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Prompt:</span>
                              <p className="text-slate-300 font-mono text-[11px] bg-slate-950 p-2 rounded-lg border border-slate-800 max-h-24 overflow-y-auto custom-scrollbar">
                                {event.content?.prompt || JSON.stringify(event.content)}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {event.type === 'ANALYSIS_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-cyan-500/30 space-y-2">
                          {event.content?.systemPrompt ? (
                            <JsonDetails title="Vision System Prompt (Klick zum Aufklappen)" data={event.content.systemPrompt} />
                          ) : (
                            <JsonDetails title="Vision Request Details" data={event.content} />
                          )}
                        </div>
                      )}

                      {event.type === 'ANALYSIS_RESPONSE' && (() => {
                        const isArtworkDownload = event.title === 'Original-Design heruntergeladen' || !!event.content?.originalUrl || !!event.content?.localUrl;
                        if (isArtworkDownload) {
                          const imgUrl = selectedTask.localImagePath || selectedTask.imageUrl || event.content?.localUrl || `/api/v1/designs/image/${encodeURIComponent(selectedTask.id)}`;
                          return (
                            <div className="bg-slate-950 rounded-xl p-4 border border-amber-500/40 space-y-3 shadow-lg">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                                  <ImageIcon className="w-4 h-4 text-amber-400" />
                                  Original-Design heruntergeladen (Master-Auflösung)
                                </span>
                                <div className="flex items-center space-x-1.5">
                                  {imgUrl && (
                                    <>
                                      <a
                                        href={imgUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        <span>Vollbild</span>
                                      </a>
                                      <a
                                        href={imgUrl}
                                        download={`${selectedTask.id}-original.png`}
                                        className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>PNG herunterladen</span>
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                                {imgUrl ? (
                                  <div className="relative group w-44 h-44 shrink-0 rounded-xl border border-slate-700 bg-slate-950 shadow-md flex items-center justify-center p-1">
                                    <img
                                      src={imgUrl}
                                      alt="Original Master Design"
                                      className="w-full h-full object-contain rounded-lg"
                                      referrerPolicy="no-referrer"
                                      loading="lazy"
                                    />
                                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/80 text-amber-300 border border-amber-500/30 backdrop-blur-sm shadow-sm pointer-events-none">
                                      4500 × 5400 px
                                    </span>
                                  </div>
                                ) : (
                                  <div className="w-44 h-44 shrink-0 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950 text-slate-500 text-xs">
                                    <ImageIcon className="w-8 h-8 mb-1 opacity-50" />
                                    <span>Wird geladen...</span>
                                  </div>
                                )}

                                <div className="flex-1 space-y-2 text-xs">
                                  <div className="flex items-center space-x-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Direkter DOM-Abzug (Session 1)
                                    </span>
                                    {event.content?.fileSizeMb && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300">
                                        {event.content.fileSizeMb}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono space-y-1">
                                    {event.content?.originalUrl && (
                                      <div className="truncate">
                                        Amazon CDN: <span className="text-slate-300 select-all">{event.content.originalUrl}</span>
                                      </div>
                                    )}
                                    {event.content?.downloadedAt && (
                                      <div>
                                        Heruntergeladen um: <span className="text-slate-300">{new Date(event.content.downloadedAt).toLocaleString()}</span>
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-slate-400 text-[11px] leading-relaxed pt-1">
                                    Die unkomprimierte Master-Grafik steht nun lokal für den Update-Prozess und automatische Resizes bereit.
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const analysis = typeof event.content === 'object' && event.content !== null ? event.content : null;
                        const isUpdateVision = analysis && analysis.rewriteNeeded !== undefined;

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-cyan-500/30 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                                <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                                {isUpdateVision ? 'Update Vision & Quality Audit (U3)' : 'Vision-Analyse Befund'}
                              </span>
                              <CopyButton text={JSON.stringify(event.content, null, 2)} label="JSON" />
                            </div>

                            {isUpdateVision ? (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-300">Rewrite nötig?</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      analysis.rewriteNeeded ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    }`}>
                                      {analysis.rewriteNeeded ? 'JA (Optimieren)' : 'NEIN (Behalten)'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {analysis.reasoning || '-'}
                                  </div>
                                </div>

                                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                                  <span className="font-semibold text-slate-300 block">Zielgruppe</span>
                                  <div className="text-purple-300 font-semibold text-[11px]">
                                    {Array.isArray(analysis.fitTypes) ? analysis.fitTypes.join(', ') : (analysis.fitTypes || 'Standard')}
                                  </div>
                                </div>

                                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                                  <span className="font-semibold text-slate-300 block">Avoid Color</span>
                                  <div className="text-cyan-300 font-semibold text-[11px]">
                                    {analysis.avoidColor || 'None'}
                                  </div>
                                </div>
                              </div>
                            ) : analysis ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-300">Quote</span>
                                    <span className={`text-[10px] font-semibold ${analysis.quote_check?.quote_matches ? 'text-emerald-400' : 'text-amber-400'}`}>
                                      {analysis.quote_check?.quote_matches ? 'Exakt' : 'Abweichung'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-400">
                                    Erkannt: <span className="text-slate-200">"{analysis.quote_check?.detected_quote_text || analysis.quote_check?.detected_quote || '-'}"</span>
                                  </div>
                                </div>

                                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-300">Zielgruppe</span>
                                    <span className="text-[10px] font-semibold text-purple-300">
                                      {Array.isArray(analysis.target_group?.selected) ? analysis.target_group.selected.join(', ') : (analysis.target_group?.selected || '-')}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 truncate">
                                    {analysis.target_group?.reason || 'Standard-Fit'}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <pre className="p-2 bg-slate-900 rounded-lg text-xs font-mono text-slate-200">
                                {typeof event.content === 'string' ? event.content : JSON.stringify(event.content, null, 2)}
                              </pre>
                            )}

                            <JsonDetails title="Vollständiges Analyse-JSON" data={event.content} />
                          </div>
                        );
                      })()}

                      {event.type === 'LISTING_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-3">
                          <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-800">
                            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                              Listing Prompt Request
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {event.metadata?.model || 'OpenRouter'}
                            </span>
                          </div>

                          {/* Quick Parameters Overview */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <span className="text-slate-500 block text-[9px] uppercase">Nische 1</span>
                              <span className="text-slate-200 font-bold">{event.content?.niche1 || '-'}</span>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <span className="text-slate-500 block text-[9px] uppercase">Cross-Nische</span>
                              <span className="text-slate-200 font-bold">{event.content?.niche2 || 'none'}</span>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <span className="text-slate-500 block text-[9px] uppercase">Subnische</span>
                              <span className="text-cyan-300 font-bold">{event.content?.subniche || 'none'}</span>
                            </div>
                            <div className="p-2 rounded bg-slate-900 border border-slate-800">
                              <span className="text-slate-500 block text-[9px] uppercase">Keywords</span>
                              <span className="text-slate-200 font-bold truncate block" title={Array.isArray(event.content?.keywords) ? event.content.keywords.join(', ') : '-'}>
                                {Array.isArray(event.content?.keywords) ? event.content.keywords.join(', ') : '-'}
                              </span>
                            </div>
                          </div>

                          {/* Full Raw Request (System Prompt + User Message) */}
                          {event.content?.rawRequest ? (
                            <div className="space-y-2 pt-1">
                              <details className="text-[11px] text-slate-400 group" open={false}>
                                <summary className="cursor-pointer font-semibold text-emerald-400 hover:text-emerald-300 flex items-center justify-between py-1 px-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/20">
                                  <span>🔍 Vollständigen Raw Request anzeigen (System Prompt + User Message)</span>
                                  <CopyButton text={JSON.stringify(event.content.rawRequest, null, 2)} label="Request Kopieren" />
                                </summary>
                                <div className="mt-2 space-y-2">
                                  {event.content.rawRequest.messages?.map((m: any, idx: number) => (
                                    <div key={idx} className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold bg-slate-800 text-cyan-300">
                                          Role: {m.role}
                                        </span>
                                        <CopyButton text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)} label="Text kopieren" />
                                      </div>
                                      <pre className="text-slate-200 font-mono text-[11px] whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                                        {typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                          ) : (
                            <JsonDetails title="Listing Request Parameter" data={event.content} />
                          )}
                        </div>
                      )}

                      {event.type === 'LISTING_RESPONSE' && (() => {
                        const listing = typeof event.content === 'object' && event.content !== null ? event.content : null;
                        const currentLang = selectedListingLang[selectedTask.id] || 'en';
                        
                        const langListing = listing 
                          ? (listing[currentLang] || listing['en'] || (listing.title ? listing : null))
                          : null;

                        const isMultiLang = listing && (listing.en || listing.de || listing.fr);

                        const languages = [
                          { code: 'en', label: 'EN' },
                          { code: 'de', label: 'DE' },
                          { code: 'fr', label: 'FR' },
                          { code: 'it', label: 'IT' },
                          { code: 'es', label: 'ES' },
                          { code: 'ja', label: 'JA' },
                        ];

                        const fullListingText = langListing 
                          ? `Brand: ${langListing.brand || langListing.brandName || ''}\nTitle: ${langListing.title || ''}\nBullet 1: ${langListing.bullet1 || ''}\nBullet 2: ${langListing.bullet2 || ''}\nDescription:\n${langListing.description || ''}`
                          : '';

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                                {isMultiLang ? 'MBA SEO Listing (Multi-Marketplace)' : 'Optimiertes Listing'}
                              </span>
                              <div className="flex items-center space-x-1.5">
                                <CopyButton text={fullListingText} label="Alle kopieren" />
                                <CopyButton text={JSON.stringify(event.content, null, 2)} label="JSON" />
                              </div>
                            </div>

                            {/* Language Sub-Tabs (only for multi-language listings) */}
                            {isMultiLang && (
                              <div className="flex space-x-1 border-b border-slate-800 pb-2">
                                {languages.map(lang => (
                                  <button
                                    key={lang.code}
                                    onClick={() => setSelectedListingLang(prev => ({ ...prev, [selectedTask.id]: lang.code }))}
                                    className={`px-2.5 py-0.5 rounded text-xs font-semibold transition-all ${
                                      currentLang === lang.code
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                                    }`}
                                  >
                                    {lang.label}
                                  </button>
                                ))}
                              </div>
                            )}

                            {langListing && (
                              <div className="space-y-2 text-xs">
                                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Brand</span>
                                  <p className="font-mono text-slate-200">{langListing.brand || langListing.brandName || '-'}</p>
                                </div>
                                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Title</span>
                                  <p className="font-mono text-emerald-300 font-semibold">{langListing.title || '-'}</p>
                                </div>
                                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Bullet 1</span>
                                  <p className="font-mono text-slate-300">{langListing.bullet1 || '-'}</p>
                                </div>
                                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Bullet 2</span>
                                  <p className="font-mono text-slate-300">{langListing.bullet2 || '-'}</p>
                                </div>
                              </div>
                            )}

                            {event.content?.rawResponse && (
                              <details className="text-[11px] text-slate-400 group">
                                <summary className="cursor-pointer font-semibold text-slate-400 hover:text-cyan-400 flex items-center justify-between py-1">
                                  <span>🔍 Raw LLM Antwort</span>
                                  <CopyButton text={typeof event.content.rawResponse === 'string' ? event.content.rawResponse : JSON.stringify(event.content.rawResponse, null, 2)} label="Raw Kopieren" />
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-900 rounded-lg text-slate-300 font-mono text-[11px] border border-slate-800 overflow-x-auto max-h-56 custom-scrollbar whitespace-pre-wrap">
                                  {typeof event.content.rawResponse === 'string' ? event.content.rawResponse : JSON.stringify(event.content.rawResponse, null, 2)}
                                </pre>
                              </details>
                            )}

                            <JsonDetails title="Vollständiges Listing-JSON" data={event.content} />
                          </div>
                        );
                      })()}

                      {event.type === 'TM_CHECK_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-amber-500/30 space-y-2">
                          <JsonDetails title="USPTO Check Request Parameter" data={event.content} />
                        </div>
                      )}

                      {event.type === 'TM_CHECK_RESPONSE' && (() => {
                        const result = typeof event.content === 'object' && event.content !== null ? event.content : null;
                        const totalHits = result?.totalHits || 0;
                        const hasCls25 = result?.hasInfringementClass25 || false;

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-amber-500/30 space-y-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                                USPTO Prüfergebnis
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                hasCls25 ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                              }`}>
                                {hasCls25 ? `${totalHits} Treffer in Klasse 25` : '0 Treffer in Klasse 25 (Sauber)'}
                              </span>
                            </div>

                            <JsonDetails title="USPTO Prüfprotokoll Details" data={event.content} />
                          </div>
                        );
                      })()}

                      {event.type === 'TM_REFINE_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-amber-500/30 space-y-2">
                          <JsonDetails title="Auditor System Prompt" data={event.content.systemPrompt} />
                        </div>
                      )}

                      {event.type === 'TM_REFINE_RESPONSE' && (() => {
                        const refine = typeof event.content === 'object' && event.content !== null ? event.content : null;
                        const isApproved = refine?.verdict === 'APPROVED';

                        return (
                          <div className={`bg-slate-950 rounded-xl p-3.5 border space-y-2.5 ${isApproved ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
                            <div className="flex items-center justify-between text-xs">
                              <span className={`font-semibold flex items-center gap-1.5 ${isApproved ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {isApproved ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                                Trademark Bewertung
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                isApproved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                              }`}>
                                {isApproved ? 'Freigegeben' : 'Abgelehnt'}
                              </span>
                            </div>

                            <JsonDetails title="Details der TM-Bewertung" data={event.content} />
                          </div>
                        );
                      })()}

                      {event.type === 'VECTORIZE_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-pink-500/30 space-y-2.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-pink-300 flex items-center gap-1.5">
                              <Zap className="w-3.5 h-3.5 text-pink-400" />
                              Vektorisierungs-Anfrage (Vectorizer.ai)
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-pink-500/10 text-pink-300 border border-pink-500/30">
                              Max. {event.content?.maxColors || 2} Farben (aus QA-Phase)
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-500 block">Farben (QA-Phase)</span>
                              <span className="font-semibold text-pink-300">{event.content?.maxColors} Farben</span>
                            </div>
                            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-500 block">Modus</span>
                              <span className="font-mono text-slate-200">{event.content?.mode || 'production'}</span>
                            </div>
                            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-500 block">Shape Stacking</span>
                              <span className="font-mono text-slate-200">{event.content?.shapeStacking || 'cutouts'}</span>
                            </div>
                            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-500 block">Draw Style</span>
                              <span className="font-mono text-slate-200">{event.content?.drawStyle || 'fill_shapes'}</span>
                            </div>
                          </div>

                          <JsonDetails title="Gesamte Vektorisierungs-Parameter" data={event.content} />
                        </div>
                      )}

                      {event.type === 'VECTORIZE_RESPONSE' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-pink-500/30 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-pink-300 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                              Vektorisierung erfolgreich (SVG generiert)
                            </span>
                            <div className="flex items-center space-x-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                {event.content?.maxColorsUsed || 2} Farben
                              </span>
                              {event.content?.svgUrl && (
                                <a
                                  href={getCacheBustedUrl(event.content.svgUrl, event.timestamp)}
                                  download={`design-${selectedTask.id}.svg`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-pink-600 hover:bg-pink-500 text-white transition-colors shadow-sm"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>SVG Download</span>
                                </a>
                              )}
                            </div>
                          </div>

                          {/* SVG Preview Card */}
                          {event.content?.svgUrl && (
                            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 flex flex-col md:flex-row items-center gap-4">
                              <div className="w-44 h-44 rounded-lg bg-slate-950/80 border border-slate-800 p-2 flex items-center justify-center overflow-hidden shrink-0">
                                <img
                                  src={getCacheBustedUrl(event.content.svgUrl, event.timestamp)}
                                  alt="Vectorized SVG"
                                  className="max-w-full max-h-full object-contain"
                                />
                              </div>
                              <div className="flex-1 space-y-2 text-xs">
                                <div className="text-slate-200 font-semibold flex items-center space-x-2">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                  <span>Reine Vektorgrafik (SVG) verlustfrei skaliert</span>
                                </div>
                                <p className="text-slate-400 text-[11px] leading-relaxed">
                                  Die Grafik wurde basierend auf den {event.content?.maxColorsUsed || 2} gewählten Farben mit Vectorizer.ai aufbereitet und für den Merch by Amazon Export optimiert.
                                </p>
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  {event.content?.svgContent && (
                                    <CopyButton text={event.content.svgContent} label="SVG Quellcode kopieren" />
                                  )}
                                  <a
                                    href={getCacheBustedUrl(event.content.svgUrl, event.timestamp)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>In neuem Tab öffnen</span>
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}

                          <JsonDetails title="Details zur SVG Vektorisierung" data={event.content} />
                        </div>
                      )}

                      {event.type === 'SVG_AUDIT_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-pink-500/30 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-pink-300 flex items-center gap-1.5">
                              <Eye className="w-3.5 h-3.5 text-pink-400" />
                              Senden an LLM Vision (4-Panel Multifarben Cutout-Prüfung)
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Modell: {event.metadata?.model || 'OpenRouter Vision'}
                            </span>
                          </div>

                          {event.content?.fourPanelImageUrl && (
                            <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                              <img
                                src={getCacheBustedUrl(event.content.fourPanelImageUrl, event.timestamp)}
                                alt="4-Panel Test Preview"
                                className="w-32 h-32 rounded-lg object-cover border border-slate-700 shrink-0"
                              />
                              <div className="text-xs text-slate-300 space-y-1">
                                <p className="font-semibold text-slate-200">2x2 Multifarben-Prüfgitter</p>
                                <p className="text-slate-400 text-[11px] leading-relaxed">
                                  Das isolierte Design wird parallel auf 4 extremen Kontrastflächen (Weiß, Schwarz, Rot, Slate) getestet, um Kastenrahmen und gefüllte Buchstaben-Inseln aufzudecken.
                                </p>
                              </div>
                            </div>
                          )}

                          <JsonDetails title="Audit Request Payload" data={event.content} />
                        </div>
                      )}

                      {event.type === 'SVG_AUDIT_RESPONSE' && (
                        <div className={`rounded-xl p-3.5 border space-y-3 ${
                          event.content?.verdict === 'APPROVED'
                            ? 'bg-slate-950 border-emerald-500/50 text-emerald-200'
                            : 'bg-slate-950 border-amber-500/50 text-amber-200'
                        }`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold flex items-center gap-1.5">
                              {event.content?.verdict === 'APPROVED' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                              )}
                              <span>
                                LLM Cutout-Audit: {event.content?.verdict === 'APPROVED' ? 'Freigabe erteilt (Sauber freigestellt)' : 'Manuelle Korrektur empfohlen'}
                              </span>
                            </span>
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                event.content?.verdict === 'APPROVED'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}>
                                {event.content?.verdict || 'AUDIT'}
                              </span>
                            </div>
                          </div>

                          {/* 4-Panel Verification Image Card */}
                          {event.content?.fourPanelImageUrl && (
                            <div className="bg-slate-900/90 rounded-xl p-3.5 border border-slate-800 flex flex-col md:flex-row items-center gap-4">
                              <div className="w-48 h-48 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shrink-0">
                                <img
                                  src={getCacheBustedUrl(event.content.fourPanelImageUrl, event.timestamp)}
                                  alt="4-Panel Verification Image"
                                  className="w-full h-full object-contain"
                                />
                              </div>
                              <div className="flex-1 space-y-2 text-xs">
                                <p className="text-slate-300 leading-relaxed font-sans">
                                  {event.content?.explanation || 'Ergebnis der 4-Panel Hintergrundprüfung.'}
                                </p>

                                {Array.isArray(event.content?.detectedIssues) && event.content.detectedIssues.length > 0 && (
                                  <div className="space-y-1 pt-1">
                                    <span className="text-[10px] font-semibold text-rose-300 uppercase tracking-wide">Erkannte Unreinheiten:</span>
                                    <div className="space-y-0.5">
                                      {event.content.detectedIssues.map((issue: string, i: number) => (
                                        <div key={i} className="text-[11px] text-rose-200 flex items-center space-x-1.5 font-mono">
                                          <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                          <span>{issue}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-2 pt-2">
                                  <a
                                    href={getCacheBustedUrl(event.content.fourPanelImageUrl, event.timestamp)}
                                    download={`4panel-${selectedTask.id}.png`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                                  >
                                    <Download className="w-3 h-3" />
                                    <span>4-Panel Bild Download</span>
                                  </a>
                                  {selectedTask.mbaPngUrl && (
                                    <a
                                      href={getCacheBustedUrl(selectedTask.mbaPngUrl, event.timestamp)}
                                      download={`mba-print-${selectedTask.id}.png`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
                                    >
                                      <Download className="w-3 h-3" />
                                      <span>MBA PNG (4500x5400)</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          <JsonDetails title="Vollständiges Cutout-Audit Ergebnis" data={event.content} />
                        </div>
                      )}

                      {event.type === 'SVG_EDIT_RESPONSE' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/40 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                              <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                              {event.title || 'SVG & MBA Print-PNG bereitgestellt'}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              FERTIG
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed">
                            {event.content?.message || 'Design geprüft, freigestellt und als hochauflösendes MBA Print-PNG (4500 × 5400 px, 300 DPI) generiert.'}
                          </p>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {selectedTask.mbaPngUrl && (
                              <a
                                href={selectedTask.mbaPngUrl}
                                download={`mba-print-${selectedTask.id}.png`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>MBA Print-PNG (4500x5400 px)</span>
                              </a>
                            )}
                            {selectedTask.svgUrl && (
                              <a
                                href={selectedTask.svgUrl}
                                download={`design-${selectedTask.id}.svg`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>SVG Vektordatei</span>
                              </a>
                            )}
                          </div>

                          <JsonDetails title="Details zur Fertigstellung" data={event.content} />
                        </div>
                      )}

                      {event.type === 'TASK_HANDOFF' && (() => {
                        const isQueueEvent = Boolean(event.title?.includes('Upload-Queue') || event.content?.queueId);
                        const hasCompletedDesign = Boolean(selectedTask && (selectedTask.status === 'COMPLETED' || selectedTask.mbaPngUrl || selectedTask.localMbaPngPath));

                        if (isQueueEvent) {
                          return (
                            <div className="bg-slate-950 rounded-xl p-3.5 border border-accent-cyan/40 bg-accent-cyan/5 shadow-sm shadow-accent-cyan/10 space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-accent-cyan flex items-center gap-1.5">
                                  <UploadCloud className="w-4 h-4 text-accent-cyan" />
                                  {event.title || '📦 Design erfolgreich in die Upload-Queue übergeben'}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40">
                                  IN QUEUE
                                </span>
                              </div>

                              <p className="text-xs text-slate-300 leading-relaxed">
                                {event.content?.message || 'Design mit 4500x5400px Master-PNG und Listing an die Queue übergeben.'}
                              </p>

                              {/* Re-Push / Enqueue Button only if design actually exists */}
                              {selectedTask && hasCompletedDesign && (
                                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                                  <span className="text-[11px] text-slate-400 font-mono">
                                    Task #{selectedTask.id} {event.content?.allocatedSlots ? `• ${event.content.allocatedSlots} Slots geplant` : ''}
                                  </span>

                                  <button
                                    onClick={() => handlePushToQueue(selectedTask.id)}
                                    disabled={pushingToQueueTaskId === selectedTask.id}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm active:scale-98 disabled:opacity-50 ${
                                      pushSuccessTaskId === selectedTask.id
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-gradient-to-r from-accent-cyan to-primary-600 hover:from-accent-cyan/90 hover:to-primary-500 text-slate-950 shadow-accent-cyan/20'
                                    }`}
                                    title="Dieses Design erneut in die Upload-Queue übertragen"
                                  >
                                    {pushingToQueueTaskId === selectedTask.id ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-950" />
                                    ) : pushSuccessTaskId === selectedTask.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <UploadCloud className="w-3.5 h-3.5" />
                                    )}
                                    <span>
                                      {pushingToQueueTaskId === selectedTask.id 
                                        ? 'Pushe in Queue...' 
                                        : pushSuccessTaskId === selectedTask.id 
                                          ? 'In Queue übertragen ✓' 
                                          : 'Erneut in Queue pushen'}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Standard Task Review Handoff (e.g. Trademark Pre-Flight Conflict)
                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-amber-500/30 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                                <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                                {event.title || 'Übergeben an Tasks'}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                                REVIEW
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {event.content?.reason || event.content?.message || 'Pausiert für manuelle Prüfung in Tasks.'}
                            </p>
                          </div>
                        );
                      })()}

                      {event.type === 'ERROR' && (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 flex items-start space-x-2">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <p className="font-semibold text-rose-200">Fehler</p>
                            <p className="font-mono text-[11px]">{String(event.content)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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

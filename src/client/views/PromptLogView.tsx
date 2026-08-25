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
  ShieldAlert
} from 'lucide-react';

import { 
  DesignTaskLog, 
  SessionEvent, 
  RetryStepType 
} from '../../types/tasks';

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
// Helper: Event Timeline Header
// ---------------------------------------------------------------------------
interface EventHeaderProps {
  event: SessionEvent;
  taskId: string;
  onRetry?: (stepType: RetryStepType) => void;
  retryStepType?: RetryStepType;
  isRetrying?: boolean;
}

const EventHeader: React.FC<EventHeaderProps> = ({
  event,
  taskId,
  onRetry,
  retryStepType,
  isRetrying
}) => {
  const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center space-x-2">
        <span className="font-mono text-[11px] font-semibold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
          {timeStr}
        </span>
        <span className="font-semibold text-slate-200">
          {event.title}
        </span>
      </div>

      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
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
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
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
  const [filterSource, setFilterSource] = useState<'ALL' | 'HERMES' | 'TEST' | 'DESIGNER'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [selectedListingLang, setSelectedListingLang] = useState<Record<string, string>>({});

  // Mini Playground State
  const [playNiche1, setPlayNiche1] = useState('Angel Numbers');
  const [playQuote, setPlayQuote] = useState('111 Manifest Your Reality');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);

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
      default: return <Terminal className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getSourceBadgeClass = (source: string) => {
    switch (source) {
      case 'HERMES': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'TEST': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'DESIGNER': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
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
              const displayQuote = task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || 'Kein Quote';
              const displayNiche = [task.payload?.niche1, task.payload?.niche2].filter(Boolean).join(' • ');

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
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(task.receivedAt)}
                    </span>
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
                    {task.status === 'COMPLETED' && (
                      <span className="text-emerald-400 font-semibold">Abgeschlossen</span>
                    )}
                    {task.status === 'REJECTED' && (
                      <span className="text-rose-400 font-semibold">Abgelehnt</span>
                    )}
                    {task.hasError && (
                      <span className="text-rose-400 font-semibold">Fehler</span>
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
                </div>
              </div>

              {/* Timeline */}
              <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {(selectedTask.events || []).map((event, idx) => {
                  const isPreFlight = event.content?.isPreFlight || (event.type === 'TM_CHECK_REQUEST' && idx <= 3);
                  const retryType: RetryStepType | undefined = 
                    event.type === 'LLM_REQUEST' ? 'LLM_REQUEST' :
                    event.type === 'IDEOGRAM_REQUEST' ? 'IDEOGRAM_REQUEST' :
                    event.type === 'ANALYSIS_REQUEST' ? 'ANALYSIS_REQUEST' :
                    event.type === 'LISTING_REQUEST' ? 'LISTING_REQUEST' :
                    event.type === 'TM_CHECK_REQUEST' ? (isPreFlight ? 'PREFLIGHT_TM_REQUEST' : 'TM_CHECK_REQUEST') :
                    event.type === 'TM_REFINE_REQUEST' ? 'TM_REFINE_REQUEST' : undefined;

                  return (
                    <div key={idx} className="relative pl-7 space-y-2">
                      {/* Timeline Bullet */}
                      <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 -translate-x-1/2 transition-colors ${
                        event.type === 'ERROR'
                          ? 'bg-rose-500 border-rose-950'
                          : event.type.startsWith('TM_')
                          ? 'bg-amber-400 border-amber-950'
                          : event.type.startsWith('LISTING_')
                          ? 'bg-emerald-400 border-emerald-950'
                          : event.type.startsWith('ANALYSIS_')
                          ? 'bg-cyan-400 border-cyan-950'
                          : event.type.startsWith('IDEOGRAM_')
                          ? 'bg-purple-400 border-purple-950'
                          : 'bg-slate-500 border-slate-900'
                      }`} />

                      {/* Header */}
                      <EventHeader
                        event={event}
                        taskId={selectedTask.id}
                        onRetry={retryType ? (st) => handleRetryStep(selectedTask.id, st, idx) : undefined}
                        retryStepType={retryType}
                        isRetrying={retryingStep === `${selectedTask.id}-${retryType}-${idx}`}
                      />

                      {/* Event Body */}
                      {event.type === 'INCOMING_PAYLOAD' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>Empfangenes Payload:</span>
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
                          <JsonDetails title="System Prompt (Klick zum Aufklappen)" data={event.content.systemPrompt} />
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase text-slate-400 block">User Message:</span>
                            <pre className="p-2 bg-slate-900 rounded-lg text-xs text-cyan-300 font-mono whitespace-pre-wrap border border-slate-800">
                              {event.content.userMessage}
                            </pre>
                          </div>
                        </div>
                      )}

                      {event.type === 'LLM_RESPONSE' && (() => {
                        let displayPrompt = event.content;
                        try {
                          let str = String(event.content).trim();
                          if (str.startsWith('```')) {
                            str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                          }
                          const parsed = JSON.parse(str);
                          if (parsed && typeof parsed.prompt === 'string') {
                            displayPrompt = parsed.prompt;
                          }
                        } catch {}

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-emerald-400">
                                Generierter Ideogram-Prompt:
                              </span>
                              <CopyButton text={displayPrompt} label="Prompt kopieren" />
                            </div>
                            <p className="font-mono text-xs text-slate-100 bg-slate-900 p-2.5 rounded-lg border border-slate-800 leading-relaxed select-all">
                              {displayPrompt}
                            </p>
                          </div>
                        );
                      })()}

                      {event.type === 'IDEOGRAM_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-purple-500/30 space-y-2">
                          <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Speed: {event.content.renderingSpeed}
                            </span>
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Ratio: {event.content.aspectRatio}
                            </span>
                            <span className="bg-slate-900 text-purple-300 px-2 py-0.5 rounded border border-slate-800">
                              Style: {event.content.style}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 font-mono bg-slate-900 p-2 rounded-lg border border-slate-800 line-clamp-2">
                            {event.content.prompt}
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
                                href={event.content.localUrl || event.content.imageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Vollbild</span>
                              </a>
                              <a
                                href={event.content.localUrl || event.content.imageUrl}
                                download={`${selectedTask.id}.png`}
                                className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                <span>PNG</span>
                              </a>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                            <img
                              src={event.content.localUrl || event.content.imageUrl}
                              alt="Design"
                              className="w-36 h-36 object-contain rounded-lg border border-slate-800 bg-slate-950"
                              loading="lazy"
                            />
                            <div className="flex-1 space-y-1 text-xs">
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Prompt:</span>
                              <p className="text-slate-300 font-mono text-[11px] bg-slate-950 p-2 rounded-lg border border-slate-800 max-h-24 overflow-y-auto custom-scrollbar">
                                {event.content.prompt}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {event.type === 'ANALYSIS_REQUEST' && (
                        <div className="bg-slate-950 rounded-xl p-3 border border-cyan-500/30 space-y-2">
                          <JsonDetails title="Vision System Prompt (Klick zum Aufklappen)" data={event.content.systemPrompt} />
                        </div>
                      )}

                      {event.type === 'ANALYSIS_RESPONSE' && (() => {
                        const analysis = typeof event.content === 'object' && event.content !== null ? event.content : null;

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-cyan-500/30 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                                <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                                Vision-Analyse Befund
                              </span>
                              <CopyButton text={JSON.stringify(event.content, null, 2)} label="JSON" />
                            </div>

                            {analysis ? (
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
                        <div className="bg-slate-950 rounded-xl p-3 border border-emerald-500/30 space-y-2">
                          <JsonDetails title="Listing System Prompt (Klick zum Aufklappen)" data={event.content.systemPrompt} />
                        </div>
                      )}

                      {event.type === 'LISTING_RESPONSE' && (() => {
                        const listing = typeof event.content === 'object' && event.content !== null ? event.content : null;
                        const currentLang = selectedListingLang[selectedTask.id] || 'en';
                        const langListing = listing ? listing[currentLang] || listing['en'] : null;

                        const languages = [
                          { code: 'en', label: 'EN' },
                          { code: 'de', label: 'DE' },
                          { code: 'fr', label: 'FR' },
                          { code: 'it', label: 'IT' },
                          { code: 'es', label: 'ES' },
                          { code: 'ja', label: 'JA' },
                        ];

                        const fullListingText = langListing 
                          ? `Brand: ${langListing.brand || ''}\nTitle: ${langListing.title || ''}\nBullet 1: ${langListing.bullet1 || ''}\nBullet 2: ${langListing.bullet2 || ''}\nDescription:\n${langListing.description || ''}`
                          : '';

                        return (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                                MBA SEO Listing
                              </span>
                              <div className="flex items-center space-x-1.5">
                                <CopyButton text={fullListingText} label="Alle kopieren" />
                                <CopyButton text={JSON.stringify(event.content, null, 2)} label="JSON" />
                              </div>
                            </div>

                            {/* Language Sub-Tabs */}
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

                            {langListing && (
                              <div className="space-y-2 text-xs">
                                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-0.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Brand</span>
                                  <p className="font-mono text-slate-200">{langListing.brand || '-'}</p>
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

                            <JsonDetails title="Vollständiges Listing-JSON aller Sprachen" data={event.content} />
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

                      {event.type === 'TASK_HANDOFF' && (
                        <div className="bg-slate-950 rounded-xl p-3.5 border border-amber-500/30 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                              <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                              {event.title || 'Übergeben an Tasks'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 font-semibold">
                              REVIEW
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {event.content?.reason || 'Pausiert für manuelle Prüfung in Tasks.'}
                          </p>
                        </div>
                      )}

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

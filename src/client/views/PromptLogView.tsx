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
  ArrowDownRight,
  Cpu,
  Layers,
  CheckCircle2,
  Zap,
  Image as ImageIcon,
  ExternalLink,
  Download,
  Sliders,
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

export type EventType = 
  | 'INCOMING_PAYLOAD'
  | 'SESSION_START'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
  | 'IDEOGRAM_REQUEST'
  | 'IDEOGRAM_RESPONSE'
  | 'ANALYSIS_REQUEST'
  | 'ANALYSIS_RESPONSE'
  | 'LISTING_REQUEST'
  | 'LISTING_RESPONSE'
  | 'TM_CHECK_RESPONSE'
  | 'TM_REFINE_REQUEST'
  | 'TM_REFINE_RESPONSE'
  | 'ERROR';

export interface SessionEvent {
  timestamp: string;
  type: EventType;
  title: string;
  content: any;
  metadata?: {
    model?: string;
    provider?: string;
    latencyMs?: number;
    tokens?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
    costUsd?: number;
  };
}

export interface DesignTaskLog {
  id: string;
  counter: number;
  source: 'HERMES' | 'TEST' | 'DESIGNER';
  suffix: 'H' | 'T' | 'D';
  status: 'RECEIVED' | 'PROCESSING' | 'PROMPT_READY' | 'GENERATING_IMAGE' | 'ANALYZING_DESIGN' | 'GENERATING_LISTING' | 'CHECKING_TRADEMARKS' | 'COMPLETED' | 'REJECTED' | 'ERROR';
  receivedAt: string;
  clientIp?: string;
  payload: Record<string, any>;
  events: SessionEvent[];
  resultPrompt?: string;
  imageUrl?: string;
  localImagePath?: string;
  analysisResult?: any;
  listingResult?: any;
  trademarkCheckResult?: any;
  trademarkRefineResult?: any;
  hasError?: boolean;
  errorDetails?: string;
}

export const PromptLogView: React.FC = () => {
  const [tasks, setTasks] = useState<DesignTaskLog[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<'ALL' | 'HERMES' | 'TEST' | 'DESIGNER'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [selectedListingLang, setSelectedListingLang] = useState<Record<string, string>>({});

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || tasks[0] || null;

  // Mini Playground State
  const [playNiche1, setPlayNiche1] = useState('Angel Numbers');
  const [playQuote, setPlayQuote] = useState('111 Manifest Your Reality');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);

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
      console.error('Failed to fetch task logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryStep = async (taskId: string, stepType: 'LLM_REQUEST' | 'IDEOGRAM_REQUEST' | 'ANALYSIS_REQUEST' | 'LISTING_REQUEST' | 'TM_REFINE_REQUEST') => {
    setRetryingStep(`${taskId}-${stepType}`);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepType })
      });
      if (res.ok) {
        await fetchTasks();
      }
    } catch (e) {
      console.error('Failed to retry task step:', e);
    } finally {
      setTimeout(() => setRetryingStep(null), 1000);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000); // 3s polling for live session updates
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
        setTestSuccessMessage(`Task ${data.taskId} erstellt & OpenRouter Session gestartet!`);
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
    if (!confirm('Möchtest du wirklich alle Prompt- und Task-Logs leeren?')) return;
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

  const copyToClipboard = (text: string, key: string) => {
    const fallbackCopy = (str: string) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = str;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      } catch (e) {}
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopiedKey(key);
          setTimeout(() => setCopiedKey(null), 2000);
        })
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
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

  const formatEventTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Terminal className="w-6 h-6 text-accent-cyan" />
            Prompt Log &amp; LLM Session Logbuch
          </h2>
          <p className="text-sm text-slate-400">
            Chronologisches Protokoll: Eingang von Hermes/Test ➔ OpenRouter Session ➔ Prompt-Erstellung.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchTasks}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Aktualisieren</span>
          </button>
          {tasks.length > 0 && (
            <button
              onClick={handleClearLogs}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Logs leeren</span>
            </button>
          )}
        </div>
      </div>

      {/* Mini Playground (Test simulation) */}
      <div className="glass-card p-5 rounded-2xl border border-accent-cyan/20 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-900/90">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-accent-cyan/10 text-accent-cyan">
              <TestTube className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Mini Playground</h3>
              <p className="text-xs text-slate-400">Simuliere einen Task (erzeugt Test-Task <code>#xxx-T</code> und triggert sofort OpenRouter)</p>
            </div>
          </div>
          {testSuccessMessage && (
            <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-fadeIn">
              <Check className="w-3.5 h-3.5" />
              <span>{testSuccessMessage}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSendTestTask} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5 space-y-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Niche 1</label>
            <input
              type="text"
              value={playNiche1}
              onChange={e => setPlayNiche1(e.target.value)}
              placeholder="z.B. Angel Numbers"
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-cyan transition-colors"
            />
          </div>
          <div className="sm:col-span-5 space-y-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Quote</label>
            <input
              type="text"
              value={playQuote}
              onChange={e => setPlayQuote(e.target.value)}
              placeholder="z.B. 111 Manifest Your Reality"
              required
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-cyan transition-colors"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submittingTest || !playQuote.trim()}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-accent-cyan text-slate-950 hover:bg-cyan-300 disabled:opacity-50 shadow-lg shadow-accent-cyan/10 transition-all"
            >
              <Send className={`w-3.5 h-3.5 ${submittingTest ? 'animate-pulse' : ''}`} />
              <span>{submittingTest ? 'Sendet...' : 'Test'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Source Filter Tabs */}
        <div className="flex items-center space-x-1.5 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
          <button
            onClick={() => setFilterSource('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterSource === 'ALL'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Alle ({tasks.length})
          </button>
          <button
            onClick={() => setFilterSource('HERMES')}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterSource === 'HERMES'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-3 h-3" />
            <span>Hermes (H) ({tasks.filter(t => t.source === 'HERMES').length})</span>
          </button>
          <button
            onClick={() => setFilterSource('TEST')}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterSource === 'TEST'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TestTube className="w-3 h-3" />
            <span>Tests (T) ({tasks.filter(t => t.source === 'TEST').length})</span>
          </button>
          <button
            onClick={() => setFilterSource('DESIGNER')}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterSource === 'DESIGNER'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Designer (D) ({tasks.filter(t => t.source === 'DESIGNER').length})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Task-ID, Nische oder Quote suchen..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-700 transition-colors"
          />
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[550px]">
        {/* Left Column: Task List */}
        <div className="lg:col-span-4 glass-card rounded-2xl p-3 border border-slate-800 space-y-2 overflow-y-auto max-h-[720px] custom-scrollbar">
          {filteredTasks.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center mx-auto text-slate-500">
                <Code2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-300">Keine Tasks gefunden</p>
                <p className="text-xs text-slate-500">Nutze den Mini Playground oben oder sende einen Request von Hermes.</p>
              </div>
            </div>
          ) : (
            filteredTasks.map(task => {
              const isSelected = selectedTask?.id === task.id;
              const displayQuote = task.payload?.quote || 'Kein Quote angegeben';
              const displayNiche = [task.payload?.niche1, task.payload?.niche2].filter(Boolean).join(' • ');

              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-slate-800/90 border-accent-cyan/40 shadow-lg shadow-accent-cyan/5'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-white tracking-wide bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                        {task.id}
                      </span>
                      <span className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${getSourceBadgeClass(task.source)}`}>
                        {getSourceIcon(task.source)}
                        <span>{task.source}</span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-[11px] text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{formatRelativeTime(task.receivedAt)}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-200 line-clamp-1">
                      "{displayQuote}"
                    </p>
                    {displayNiche && (
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                        {displayNiche}
                      </p>
                    )}
                  </div>

                  {/* Status Indicator */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/50 text-[10px]">
                    {task.status === 'PROCESSING' && (
                      <span className="text-amber-400 flex items-center gap-1 font-semibold animate-pulse">
                        <Zap className="w-3 h-3" /> OpenRouter Prompt...
                      </span>
                    )}
                    {task.status === 'GENERATING_IMAGE' && (
                      <span className="text-purple-400 flex items-center gap-1 font-semibold animate-pulse">
                        <ImageIcon className="w-3 h-3" /> Ideogram generiert...
                      </span>
                    )}
                    {task.status === 'ANALYZING_DESIGN' && (
                      <span className="text-cyan-400 flex items-center gap-1 font-semibold animate-pulse">
                        <Eye className="w-3 h-3" /> Analysiere Design...
                      </span>
                    )}
                    {task.status === 'GENERATING_LISTING' && (
                      <span className="text-emerald-400 flex items-center gap-1 font-semibold animate-pulse">
                        <FileText className="w-3 h-3" /> Erstelle MBA Listing...
                      </span>
                    )}
                    {task.status === 'CHECKING_TRADEMARKS' && (
                      <span className="text-amber-400 flex items-center gap-1 font-semibold animate-pulse">
                        <ShieldCheck className="w-3 h-3" /> Trademark Audit...
                      </span>
                    )}
                    {(task.status === 'REJECTED' || (task.analysisResult && !task.listingResult && (task.analysisResult.quote_check?.quote_matches === false || task.analysisResult.quote_check?.regenerate_recommended === true))) && (
                      <span className="text-amber-400 flex items-center gap-1 font-semibold">
                        <XCircle className="w-3 h-3 text-rose-400" /> Abgelehnt (Kein Listing)
                      </span>
                    )}
                    {task.status === 'COMPLETED' && task.listingResult && (
                      <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Design &amp; Listing fertig ✓
                      </span>
                    )}
                    {task.status === 'COMPLETED' && !task.analysisResult && !task.listingResult && (
                      <span className="text-cyan-400 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Bild fertig ✓
                      </span>
                    )}
                    {task.status === 'PROMPT_READY' && (
                      <span className="text-cyan-400 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Prompt bereit
                      </span>
                    )}
                    {task.hasError && (
                      <span className="text-rose-400 flex items-center gap-1 font-semibold">
                        <AlertCircle className="w-3 h-3" /> Fehler
                      </span>
                    )}
                    {(!task.status || task.status === 'RECEIVED') && (
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Empfangen
                      </span>
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

        {/* Right Column: Chronological Session Logbook */}
        <div className="lg:col-span-8 glass-card rounded-2xl p-5 border border-slate-800 flex flex-col justify-between space-y-4 max-h-[720px] overflow-y-auto custom-scrollbar">
          {selectedTask ? (
            <div className="space-y-6">
              {/* Task Details Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-base font-extrabold text-white bg-slate-950 px-3 py-1 rounded-lg border border-slate-700 shadow-inner">
                    {selectedTask.id}
                  </span>
                  <span className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold border ${getSourceBadgeClass(selectedTask.source)}`}>
                    {getSourceIcon(selectedTask.source)}
                    <span>Quelle: {selectedTask.source}</span>
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-xs text-slate-400">
                  {selectedTask.clientIp && (
                    <div className="flex items-center space-x-1">
                      <Globe className="w-3.5 h-3.5" />
                      <span>{selectedTask.clientIp}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(selectedTask.receivedAt).toLocaleTimeString()} ({new Date(selectedTask.receivedAt).toLocaleDateString()})</span>
                  </div>
                </div>
              </div>

              {/* Logbook Timeline */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-accent-cyan" />
                  Chronologisches Session-Logbuch
                </h4>

                <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                  {/* Iterate through task events */}
                  {(selectedTask.events || [
                    {
                      timestamp: selectedTask.receivedAt,
                      type: 'INCOMING_PAYLOAD',
                      title: `Eingang von ${selectedTask.source}`,
                      content: selectedTask.payload
                    }
                  ]).map((event, idx) => {
                    const timeStr = formatEventTime(event.timestamp);

                    return (
                      <div key={idx} className="relative pl-8 space-y-2 group">
                        {/* Bullet point */}
                        <div className={`absolute left-1.5 top-1.5 w-3.5 h-3.5 rounded-full border-2 -translate-x-1/2 transition-colors ${
                          event.type === 'ERROR'
                            ? 'bg-rose-500 border-rose-900 ring-4 ring-rose-500/20'
                            : event.type === 'TM_REFINE_RESPONSE'
                            ? 'bg-emerald-400 border-emerald-950 ring-4 ring-emerald-400/30'
                            : event.type === 'TM_REFINE_REQUEST'
                            ? 'bg-amber-500 border-amber-950'
                            : event.type === 'TM_CHECK_RESPONSE'
                            ? 'bg-amber-400 border-amber-950 ring-4 ring-amber-400/25'
                            : event.type === 'LISTING_RESPONSE'
                            ? 'bg-emerald-400 border-emerald-950 ring-4 ring-emerald-400/30'
                            : event.type === 'LISTING_REQUEST'
                            ? 'bg-emerald-500 border-emerald-950'
                            : event.type === 'ANALYSIS_RESPONSE'
                            ? 'bg-cyan-400 border-cyan-950 ring-4 ring-cyan-400/25'
                            : event.type === 'ANALYSIS_REQUEST'
                            ? 'bg-cyan-500 border-cyan-950'
                            : event.type === 'IDEOGRAM_RESPONSE'
                            ? 'bg-purple-500 border-purple-950 ring-4 ring-purple-500/20'
                            : event.type === 'IDEOGRAM_REQUEST'
                            ? 'bg-purple-600 border-purple-950'
                            : event.type === 'LLM_RESPONSE'
                            ? 'bg-emerald-500 border-emerald-950 ring-4 ring-emerald-500/20'
                            : event.type === 'LLM_REQUEST'
                            ? 'bg-cyan-500 border-cyan-950'
                            : 'bg-slate-700 border-slate-900'
                        }`} />

                        {/* Event Header */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                              {timeStr}
                            </span>
                            <span className="font-bold text-slate-200">
                              {event.title}
                            </span>
                          </div>

                          {event.metadata && (
                            <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                              {event.metadata.model && (
                                <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
                                  {event.metadata.model}
                                </span>
                              )}
                              {event.metadata.latencyMs !== undefined && (
                                <span className="text-accent-cyan font-semibold">
                                  ⚡ {event.metadata.latencyMs > 1000 ? `${(event.metadata.latencyMs / 1000).toFixed(1)}s` : `${event.metadata.latencyMs}ms`}
                                </span>
                              )}
                              {event.metadata.tokens?.total && (
                                <span className="text-purple-400">
                                  📊 {event.metadata.tokens.total} Tokens
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Event Body Content */}
                        {event.type === 'INCOMING_PAYLOAD' && (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800/80 space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                              <span>Empfangenes Original JSON:</span>
                              <button
                                onClick={() => copyToClipboard(JSON.stringify(event.content, null, 2), `incoming-${idx}`)}
                                className="flex items-center space-x-1 text-slate-400 hover:text-slate-200"
                              >
                                {copiedKey === `incoming-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedKey === `incoming-${idx}` ? 'Kopiert!' : 'JSON kopieren'}</span>
                              </button>
                            </div>
                            <pre className="font-mono text-xs text-emerald-400 overflow-x-auto max-h-48 custom-scrollbar">
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
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800/80 space-y-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                              <span>Anfrage an OpenRouter:</span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleRetryStep(selectedTask.id, 'LLM_REQUEST')}
                                  disabled={retryingStep !== null}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
                                  title="Prompt-Erstellung ab diesem Schritt neu starten (alle Folgeschritte werden aktualisiert)"
                                >
                                  <RotateCcw className={`w-3 h-3 ${retryingStep === `${selectedTask.id}-LLM_REQUEST` ? 'animate-spin' : ''}`} />
                                  <span>Ab hier neu ausführen</span>
                                </button>
                                <button
                                  onClick={() => copyToClipboard(event.content.userMessage, `req-${idx}`)}
                                  className="flex items-center space-x-1 text-slate-400 hover:text-slate-200"
                                >
                                  {copiedKey === `req-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                  <span>{copiedKey === `req-${idx}` ? 'Kopiert!' : 'Input kopieren'}</span>
                                </button>
                              </div>
                            </div>

                            {/* System Prompt preview */}
                            <details className="text-xs text-slate-400 group/details">
                              <summary className="cursor-pointer font-semibold text-slate-300 hover:text-accent-cyan flex items-center gap-1">
                                <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">system</span>
                                <span>Aktiver System-Prompt (Klick zum Ausklappen)</span>
                              </summary>
                              <pre className="mt-2 p-2.5 bg-slate-900 rounded-lg text-[11px] text-slate-300 font-mono whitespace-pre-wrap border border-slate-800">
                                {event.content.systemPrompt}
                              </pre>
                            </details>

                            {/* User message */}
                            <div>
                              <span className="text-[10px] font-semibold uppercase text-slate-400 block mb-1">User Message:</span>
                              <pre className="p-2.5 bg-slate-900 rounded-lg text-xs text-cyan-300 font-mono whitespace-pre-wrap border border-slate-800">
                                {event.content.userMessage}
                              </pre>
                            </div>
                          </div>
                        )}

                        {event.type === 'LLM_RESPONSE' && (() => {
                          let displayPrompt = event.content;
                          let isJsonFormat = false;
                          let rawJsonObj: any = null;

                          try {
                            let str = String(event.content).trim();
                            if (str.startsWith('```')) {
                              str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                            }
                            const parsed = JSON.parse(str);
                            if (parsed && typeof parsed.prompt === 'string') {
                              displayPrompt = parsed.prompt;
                              isJsonFormat = true;
                              rawJsonObj = parsed;
                            }
                          } catch (e) {}

                          return (
                            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-emerald-500/30 shadow-lg shadow-emerald-500/5 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                  Generierter Ideogram-Prompt (Ergebnis von OpenRouter)
                                </span>
                                <div className="flex items-center space-x-2">
                                  {isJsonFormat && (
                                    <button
                                      onClick={() => copyToClipboard(typeof event.content === 'string' ? event.content : JSON.stringify(event.content, null, 2), `raw-json-${idx}`)}
                                      className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                                    >
                                      {copiedKey === `raw-json-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                      <span>{copiedKey === `raw-json-${idx}` ? 'Kopiert!' : 'JSON kopieren'}</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => copyToClipboard(displayPrompt, `prompt-${idx}`)}
                                    className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                                  >
                                    {copiedKey === `prompt-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedKey === `prompt-${idx}` ? 'Kopiert! ✓' : 'Prompt kopieren'}</span>
                                  </button>
                                </div>
                              </div>

                              <p className="font-mono text-xs sm:text-sm text-slate-100 bg-slate-950/90 p-3.5 rounded-lg border border-slate-800 leading-relaxed select-all">
                                {displayPrompt}
                              </p>

                              {isJsonFormat && (
                                <details className="text-[11px] text-slate-400">
                                  <summary className="cursor-pointer font-semibold text-slate-400 hover:text-accent-cyan">
                                    Original-JSON anzeigen (Klick zum Aufklappen)
                                  </summary>
                                  <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-emerald-400 font-mono text-[11px] border border-slate-800/80 overflow-x-auto">
                                    {JSON.stringify(rawJsonObj, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })()}

                        {/* Event: Senden an Ideogram */}
                        {event.type === 'IDEOGRAM_REQUEST' && (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-purple-500/30 space-y-2">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-purple-300">
                              <span>Parameter für Ideogram:</span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleRetryStep(selectedTask.id, 'IDEOGRAM_REQUEST')}
                                  disabled={retryingStep !== null}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-all disabled:opacity-50"
                                  title="Ideogram-Bildgenerierung ab diesem Schritt neu starten"
                                >
                                  <RotateCcw className={`w-3 h-3 ${retryingStep === `${selectedTask.id}-IDEOGRAM_REQUEST` ? 'animate-spin' : ''}`} />
                                  <span>Ab hier neu ausführen</span>
                                </button>
                                <span className="font-mono text-slate-400">{event.content.model}</span>
                              </div>
                            </div>

                            {/* Parameter Chips */}
                            <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                              <span className="bg-purple-950/60 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                                Speed: {event.content.renderingSpeed}
                              </span>
                              <span className="bg-purple-950/60 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                                Ratio: {event.content.aspectRatio}
                              </span>
                              <span className="bg-purple-950/60 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                                Style: {event.content.style}
                              </span>
                              <span className="bg-purple-950/60 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                                Magic: {event.content.magicPrompt}
                              </span>
                            </div>

                            <p className="text-xs text-slate-300 font-mono bg-slate-900 p-2.5 rounded-lg border border-slate-800 line-clamp-3">
                              {event.content.prompt}
                            </p>
                          </div>
                        )}

                        {/* Event: Empfangen von Ideogram (mit Design Bild-Vorschau) */}
                        {event.type === 'IDEOGRAM_RESPONSE' && (
                          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-purple-500/40 shadow-xl shadow-purple-500/5 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                                <ImageIcon className="w-4 h-4 text-purple-400" />
                                Generiertes Design (Ideogram)
                              </span>
                              <div className="flex items-center space-x-2">
                                <a
                                  href={event.content.localUrl || event.content.imageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>Vollbild</span>
                                </a>
                                <a
                                  href={event.content.localUrl || event.content.imageUrl}
                                  download={`${selectedTask.id}.png`}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>PNG</span>
                                </a>
                              </div>
                            </div>

                            {/* Clean Design Image Thumbnail Preview */}
                            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                              <div className="relative group/img overflow-hidden rounded-xl bg-slate-900 border border-slate-800 shadow-lg">
                                <img
                                  src={event.content.localUrl || event.content.imageUrl}
                                  alt="Generiertes Design"
                                  className="w-44 h-44 sm:w-52 sm:h-52 object-contain rounded-xl transition-transform duration-300 group-hover/img:scale-105"
                                  loading="lazy"
                                />
                              </div>
                              <div className="flex-1 space-y-2 text-xs">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Verwendeter Prompt:</span>
                                  <p className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800/80 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                                    {event.content.prompt}
                                  </p>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  Gesichert auf NAS: <code className="text-purple-400">data/designs/{selectedTask.id.replace('#', '').replace('-', '_')}.png</code>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Event: Senden an OpenRouter (Vision Design-Analyse) */}
                        {event.type === 'ANALYSIS_REQUEST' && (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-cyan-500/30 space-y-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-cyan-300">
                              <span className="flex items-center gap-1.5">
                                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                                Vision-Anfrage an OpenRouter (Design &amp; Fragen):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleRetryStep(selectedTask.id, 'ANALYSIS_REQUEST')}
                                  disabled={retryingStep !== null}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
                                  title="Vision Design-Analyse mit dem aktiven System-Prompt neu ausführen"
                                >
                                  <RotateCcw className={`w-3 h-3 ${retryingStep === `${selectedTask.id}-ANALYSIS_REQUEST` ? 'animate-spin' : ''}`} />
                                  <span>Ab hier neu ausführen</span>
                                </button>
                                <span className="font-mono text-slate-400">{event.metadata?.model}</span>
                              </div>
                            </div>

                            {/* System Prompt preview */}
                            <details className="text-xs text-slate-400 group/details">
                              <summary className="cursor-pointer font-semibold text-slate-300 hover:text-accent-cyan flex items-center gap-1">
                                <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">vision system prompt</span>
                                <span>Aktiver Analyse-Systemprompt (Klick zum Ausklappen)</span>
                              </summary>
                              <pre className="mt-2 p-2.5 bg-slate-900 rounded-lg text-[11px] text-slate-300 font-mono whitespace-pre-wrap border border-slate-800">
                                {event.content.systemPrompt}
                              </pre>
                            </details>
                          </div>
                        )}

                        {/* Event: Empfangen von OpenRouter (Design-Analyse & 4 Fragen Antworten) */}
                        {event.type === 'ANALYSIS_RESPONSE' && (() => {
                          const analysis = typeof event.content === 'object' && event.content !== null ? event.content : null;

                          return (
                            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-cyan-500/40 shadow-xl shadow-cyan-500/5 space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                                  <CheckSquare className="w-4 h-4 text-cyan-400" />
                                  Ergebnis der Design-Analyse (KI-Antworten)
                                </span>
                                <button
                                  onClick={() => copyToClipboard(JSON.stringify(event.content, null, 2), `analysis-${idx}`)}
                                  className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                                >
                                  {copiedKey === `analysis-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                  <span>{copiedKey === `analysis-${idx}` ? 'Kopiert!' : 'JSON kopieren'}</span>
                                </button>
                              </div>

                              {analysis ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  {/* 1. Quote Check */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-slate-300">1. Quote-Prüfung</span>
                                      {analysis.quote_check?.quote_matches ? (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                          ✓ Quote korrekt
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                          ✕ Fehler / Abweichung
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                                      <div>Erwartet: <span className="text-slate-200">"{analysis.quote_check?.requested_quote || selectedTask.payload?.quote || '-'}"</span></div>
                                      <div>Erkannt: <span className="text-cyan-300">"{analysis.quote_check?.detected_quote || '-'}"</span></div>
                                      {analysis.quote_check?.quote_errors && (
                                        <div className="text-rose-300">Hinweis: {analysis.quote_check.quote_errors}</div>
                                      )}
                                    </div>
                                  </div>

                                  {/* 2. Target Group */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-slate-300 flex items-center gap-1">
                                        <Users className="w-3.5 h-3.5 text-purple-400" />
                                        2. Zielgruppe (Fit Types)
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                                      {Array.isArray(analysis.target_group?.selected) && analysis.target_group.selected.length > 0 ? (
                                        analysis.target_group.selected.map((tg: string, i: number) => (
                                          <span key={i} className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-purple-950/60 text-purple-300 border border-purple-800/60">
                                            {tg}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-slate-500 text-[11px]">Keine Angabe</span>
                                      )}
                                    </div>
                                    {analysis.target_group?.reason && (
                                      <p className="text-[11px] text-slate-400 leading-tight pt-1">{analysis.target_group.reason}</p>
                                    )}
                                  </div>

                                  {/* 3. Avoid Product Colors */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-slate-300 flex items-center gap-1">
                                        <Palette className="w-3.5 h-3.5 text-amber-400" />
                                        3. Product Colors to Avoid
                                      </span>
                                      {(() => {
                                        const avoidVal = (analysis.avoid_product_colors?.avoid || 'None').trim();
                                        const lower = avoidVal.toLowerCase();
                                        const isBlack = lower === 'black' || lower === 'schwarz';
                                        const isWhite = lower === 'white' || lower === 'weiß' || lower === 'weiss';
                                        const isNone = lower === 'none' || lower === 'keine';

                                        const badgeClass = isBlack
                                          ? 'bg-slate-900 text-slate-200 border-slate-700'
                                          : isWhite
                                          ? 'bg-slate-100 text-slate-900 border-white font-black'
                                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

                                        const displayLabel = isBlack ? 'Avoid: Black' : isWhite ? 'Avoid: White' : 'Avoid: None';

                                        return (
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                                            {displayLabel}
                                          </span>
                                        );
                                      })()}
                                    </div>
                                    {analysis.avoid_product_colors?.reason && (
                                      <p className="text-[11px] text-slate-400 leading-tight">{analysis.avoid_product_colors.reason}</p>
                                    )}
                                  </div>

                                  {/* 4. Background & Removal Mode */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-slate-300 flex items-center gap-1">
                                        <Scissors className="w-3.5 h-3.5 text-accent-cyan" />
                                        4. Freistellung / Hintergrund
                                      </span>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                        analysis.background_analysis?.removal_mode === 'AUTOMATIC' || !analysis.background_analysis?.is_design_element
                                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                          : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                      }`}>
                                        {analysis.background_analysis?.removal_mode === 'AUTOMATIC' || !analysis.background_analysis?.is_design_element ? '🤖 Auto-Freistellung' : '🖐️ Manuelle Freistellung'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {analysis.background_analysis?.background_color_detected && (
                                        <div>Hintergrund: <span className="text-slate-200 font-mono">{analysis.background_analysis.background_color_detected}</span></div>
                                      )}
                                      {analysis.background_analysis?.reason && (
                                        <p className="pt-0.5">{analysis.background_analysis.reason}</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <pre className="p-3 bg-slate-950 rounded-xl text-xs text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap border border-slate-800">
                                  {typeof event.content === 'string' ? event.content : JSON.stringify(event.content, null, 2)}
                                </pre>
                              )}

                              {/* Collapsible raw JSON */}
                              <details className="text-[11px] text-slate-400">
                                <summary className="cursor-pointer font-semibold text-slate-400 hover:text-accent-cyan">
                                  Vollständiges Analyse-JSON anzeigen (Klick zum Aufklappen)
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-cyan-300 font-mono text-[11px] border border-slate-800/80 overflow-x-auto">
                                  {JSON.stringify(event.content, null, 2)}
                                </pre>
                              </details>
                            </div>
                          );
                        })()}

                        {/* Event: Senden an OpenRouter (Listing Generator) */}
                        {event.type === 'LISTING_REQUEST' && (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-emerald-500/30 space-y-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-300">
                              <span className="flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                                Listing-Anfrage an OpenRouter (MBA SEO):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleRetryStep(selectedTask.id, 'LISTING_REQUEST')}
                                  disabled={retryingStep !== null}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                                  title="Listing-Erstellung mit dem aktiven System-Prompt neu ausführen"
                                >
                                  <RotateCcw className={`w-3 h-3 ${retryingStep === `${selectedTask.id}-LISTING_REQUEST` ? 'animate-spin' : ''}`} />
                                  <span>Ab hier neu ausführen</span>
                                </button>
                                <span className="font-mono text-slate-400">{event.metadata?.model}</span>
                              </div>
                            </div>

                            {/* System Prompt preview */}
                            <details className="text-xs text-slate-400 group/details">
                              <summary className="cursor-pointer font-semibold text-slate-300 hover:text-accent-cyan flex items-center gap-1">
                                <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">listing system prompt</span>
                                <span>Aktiver Listing-Systemprompt (Klick zum Ausklappen)</span>
                              </summary>
                              <pre className="mt-2 p-2.5 bg-slate-900 rounded-lg text-[11px] text-slate-300 font-mono whitespace-pre-wrap border border-slate-800">
                                {event.content.systemPrompt}
                              </pre>
                            </details>
                          </div>
                        )}

                        {/* Event: Empfangen von OpenRouter (MBA Listing) */}
                        {event.type === 'LISTING_RESPONSE' && (() => {
                          const listing = typeof event.content === 'object' && event.content !== null ? event.content : null;
                          const currentLang = selectedListingLang[selectedTask.id] || 'en';
                          const langListing = listing ? listing[currentLang] || listing['en'] : null;

                          const languages = [
                            { code: 'en', label: '🇬🇧 EN (US/UK)' },
                            { code: 'de', label: '🇩🇪 DE' },
                            { code: 'fr', label: '🇫🇷 FR' },
                            { code: 'it', label: '🇮🇹 IT' },
                            { code: 'es', label: '🇪🇸 ES' },
                            { code: 'ja', label: '🇯🇵 JA' },
                          ];

                          const handleCopyAll = () => {
                            if (!langListing) return;
                            const fullText = `Brand: ${langListing.brand || ''}\nTitle: ${langListing.title || ''}\nBullet 1: ${langListing.bullet1 || ''}\nBullet 2: ${langListing.bullet2 || ''}\nDescription:\n${langListing.description || ''}`;
                            copyToClipboard(fullText, `listing-all-${idx}`);
                          };

                          return (
                            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-emerald-500/40 shadow-xl shadow-emerald-500/5 space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                                  <FileText className="w-4 h-4 text-emerald-400" />
                                  Fertiges Merch by Amazon Listing (Multi-Marketplace)
                                </span>
                                <div className="flex items-center space-x-2">
                                  <button
                                    onClick={handleCopyAll}
                                    className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                                  >
                                    {copiedKey === `listing-all-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedKey === `listing-all-${idx}` ? 'Listing kopiert! ✓' : 'Alle Felder kopieren'}</span>
                                  </button>
                                  <button
                                    onClick={() => copyToClipboard(JSON.stringify(event.content, null, 2), `listing-raw-${idx}`)}
                                    className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                                  >
                                    {copiedKey === `listing-raw-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>{copiedKey === `listing-raw-${idx}` ? 'Kopiert!' : 'JSON'}</span>
                                  </button>
                                </div>
                              </div>

                              {/* Marketplace Sub-Tabs */}
                              <div className="flex space-x-1.5 border-b border-slate-800/80 pb-2 overflow-x-auto custom-scrollbar">
                                {languages.map(lang => (
                                  <button
                                    key={lang.code}
                                    onClick={() => setSelectedListingLang(prev => ({ ...prev, [selectedTask.id]: lang.code }))}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                                      currentLang === lang.code
                                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                                        : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                                    }`}
                                  >
                                    {lang.label}
                                  </button>
                                ))}
                              </div>

                              {langListing ? (
                                <div className="space-y-3 text-xs">
                                  {/* Brand */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold text-slate-400 uppercase tracking-wider">Brand Name</span>
                                      <div className="flex items-center space-x-2">
                                        <span className={`font-mono font-bold ${((langListing.brand || '').length > 50) ? 'text-rose-400' : 'text-slate-400'}`}>
                                          {(langListing.brand || '').length}/50
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(langListing.brand || '', `brand-${idx}-${currentLang}`)}
                                          className="text-slate-400 hover:text-emerald-400"
                                        >
                                          {copiedKey === `brand-${idx}-${currentLang}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="font-mono text-sm text-slate-100 font-semibold select-all">{langListing.brand || '-'}</p>
                                  </div>

                                  {/* Title */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold text-slate-400 uppercase tracking-wider">Design Title</span>
                                      <div className="flex items-center space-x-2">
                                        <span className={`font-mono font-bold ${((langListing.title || '').length > 60) ? 'text-rose-400' : 'text-slate-400'}`}>
                                          {(langListing.title || '').length}/60
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(langListing.title || '', `title-${idx}-${currentLang}`)}
                                          className="text-slate-400 hover:text-emerald-400"
                                        >
                                          {copiedKey === `title-${idx}-${currentLang}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="font-mono text-sm text-emerald-300 font-bold select-all">{langListing.title || '-'}</p>
                                  </div>

                                  {/* Bullet Point 1 */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold text-slate-400 uppercase tracking-wider">Feature Bullet 1</span>
                                      <div className="flex items-center space-x-2">
                                        <span className={`font-mono font-bold ${((langListing.bullet1 || '').length > 250) ? 'text-rose-400' : 'text-slate-400'}`}>
                                          {(langListing.bullet1 || '').length}/250
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(langListing.bullet1 || '', `b1-${idx}-${currentLang}`)}
                                          className="text-slate-400 hover:text-emerald-400"
                                        >
                                          {copiedKey === `b1-${idx}-${currentLang}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="font-mono text-xs text-slate-200 leading-relaxed select-all">{langListing.bullet1 || '-'}</p>
                                  </div>

                                  {/* Bullet Point 2 */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold text-slate-400 uppercase tracking-wider">Feature Bullet 2</span>
                                      <div className="flex items-center space-x-2">
                                        <span className={`font-mono font-bold ${((langListing.bullet2 || '').length > 250) ? 'text-rose-400' : 'text-slate-400'}`}>
                                          {(langListing.bullet2 || '').length}/250
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(langListing.bullet2 || '', `b2-${idx}-${currentLang}`)}
                                          className="text-slate-400 hover:text-emerald-400"
                                        >
                                          {copiedKey === `b2-${idx}-${currentLang}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="font-mono text-xs text-slate-200 leading-relaxed select-all">{langListing.bullet2 || '-'}</p>
                                  </div>

                                  {/* Description */}
                                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold text-slate-400 uppercase tracking-wider">Product Description</span>
                                      <div className="flex items-center space-x-2">
                                        <span className={`font-mono font-bold ${((langListing.description || '').length > 2000) ? 'text-rose-400' : 'text-slate-400'}`}>
                                          {(langListing.description || '').length}/2000
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(langListing.description || '', `desc-${idx}-${currentLang}`)}
                                          className="text-slate-400 hover:text-emerald-400"
                                        >
                                          {copiedKey === `desc-${idx}-${currentLang}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="font-mono text-xs text-slate-300 leading-relaxed select-all whitespace-pre-wrap">{langListing.description || '-'}</p>
                                  </div>
                                </div>
                              ) : (
                                <pre className="p-3 bg-slate-950 rounded-xl text-xs text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap border border-slate-800">
                                  {typeof event.content === 'string' ? event.content : JSON.stringify(event.content, null, 2)}
                                </pre>
                              )}

                              {/* Collapsible raw JSON */}
                              <details className="text-[11px] text-slate-400">
                                <summary className="cursor-pointer font-semibold text-slate-400 hover:text-accent-cyan">
                                  Vollständiges Listing-JSON aller Marktplätze anzeigen (Klick zum Aufklappen)
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-emerald-400 font-mono text-[11px] border border-slate-800/80 overflow-x-auto">
                                  {JSON.stringify(event.content, null, 2)}
                                </pre>
                              </details>
                            </div>
                          );
                        })()}

                        {/* Event: Empfangen von Productor / USPTO (Trademark Check Result) */}
                        {event.type === 'TM_CHECK_RESPONSE' && (() => {
                          const result = typeof event.content === 'object' && event.content !== null ? event.content : null;
                          const totalHits = result?.totalHits || 0;
                          const hasCls25 = result?.hasInfringementClass25 || false;

                          return (
                            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-amber-500/40 shadow-xl shadow-amber-500/5 space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                                  Productor / USPTO Schutzrechte-Prüfung
                                </span>
                                <div className="flex items-center space-x-2">
                                  {totalHits === 0 ? (
                                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      ✓ 0 Treffer (100% sauber)
                                    </span>
                                  ) : (
                                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                                      hasCls25 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                    }`}>
                                      {hasCls25 ? `⚠️ ${totalHits} Treffer (Klasse 25)` : `ℹ️ ${totalHits} Treffer in Nebenklassen`}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => copyToClipboard(JSON.stringify(event.content, null, 2), `tm-check-${idx}`)}
                                    className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                                  >
                                    {copiedKey === `tm-check-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>JSON</span>
                                  </button>
                                </div>
                              </div>

                              {result?.fieldSummaries && Object.keys(result.fieldSummaries).length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                  {Object.entries(result.fieldSummaries).map(([fieldName, fieldData]: [string, any]) => {
                                    const hits = Object.keys(fieldData?.hits || {});
                                    const hasHits = hits.length > 0;
                                    return (
                                      <div key={fieldName} className={`p-2.5 rounded-xl border ${hasHits ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-950 border-slate-800/80'}`}>
                                        <div className="flex items-center justify-between text-[11px] font-bold">
                                          <span className="uppercase text-slate-400">{fieldName}</span>
                                          <span className={hasHits ? 'text-amber-400' : 'text-emerald-400'}>
                                            {hasHits ? `${hits.length} Treffer` : 'Sauber ✓'}
                                          </span>
                                        </div>
                                        {hasHits && (
                                          <div className="flex flex-wrap gap-1 mt-1.5">
                                            {hits.map((h, i) => (
                                              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                                {h}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Collapsible raw JSON */}
                              <details className="text-[11px] text-slate-400">
                                <summary className="cursor-pointer font-semibold text-slate-400 hover:text-accent-cyan">
                                  Vollständiges USPTO Prüfprotokoll anzeigen (Klick zum Aufklappen)
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-amber-300 font-mono text-[11px] border border-slate-800/80 overflow-x-auto max-h-48 custom-scrollbar">
                                  {JSON.stringify(event.content, null, 2)}
                                </pre>
                              </details>
                            </div>
                          );
                        })()}

                        {/* Event: Senden an OpenRouter (Trademark Auditor & Refiner) */}
                        {event.type === 'TM_REFINE_REQUEST' && (
                          <div className="bg-slate-950 rounded-xl p-3.5 border border-amber-500/30 space-y-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-300">
                              <span className="flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                                Anfrage an OpenRouter (Trademark Auditor &amp; Refiner):
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleRetryStep(selectedTask.id, 'TM_REFINE_REQUEST')}
                                  disabled={retryingStep !== null}
                                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                                  title="Trademark-Audit und Korrektur mit dem aktiven System-Prompt neu ausführen"
                                >
                                  <RotateCcw className={`w-3 h-3 ${retryingStep === `${selectedTask.id}-TM_REFINE_REQUEST` ? 'animate-spin' : ''}`} />
                                  <span>Ab hier neu ausführen</span>
                                </button>
                                <span className="font-mono text-slate-400">{event.metadata?.model}</span>
                              </div>
                            </div>

                            {/* System Prompt preview */}
                            <details className="text-xs text-slate-400 group/details">
                              <summary className="cursor-pointer font-semibold text-slate-300 hover:text-accent-cyan flex items-center gap-1">
                                <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">auditor system prompt</span>
                                <span>Aktiver Trademark Auditor Systemprompt (Klick zum Ausklappen)</span>
                              </summary>
                              <pre className="mt-2 p-2.5 bg-slate-900 rounded-lg text-[11px] text-slate-300 font-mono whitespace-pre-wrap border border-slate-800">
                                {event.content.systemPrompt}
                              </pre>
                            </details>
                          </div>
                        )}

                        {/* Event: Empfangen von OpenRouter (Trademark-Bewertung & Korrektur) */}
                        {event.type === 'TM_REFINE_RESPONSE' && (() => {
                          const refine = typeof event.content === 'object' && event.content !== null ? event.content : null;
                          const isApproved = refine?.verdict === 'APPROVED';

                          return (
                            <div className={`bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border shadow-xl space-y-3 ${
                              isApproved ? 'border-emerald-500/40 shadow-emerald-500/5' : 'border-rose-500/40 shadow-rose-500/5'
                            }`}>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold flex items-center gap-1.5 ${isApproved ? 'text-emerald-300' : 'text-rose-300'}`}>
                                  {isApproved ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-rose-400" />}
                                  Ergebnis der Trademark-Bewertung (KI-Entscheidung)
                                </span>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                                  isApproved ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                }`}>
                                  {isApproved ? '✓ Freigabe (Listing bereinigt / Fair Use)' : '✕ Abgelehnt (Markenkonflikt)'}
                                </span>
                              </div>

                              {isApproved ? (
                                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2 text-xs">
                                  <span className="font-bold text-slate-300 block">Vorgenommene Prüfungen &amp; Anpassungen:</span>
                                  {Array.isArray(refine.actions_taken) && refine.actions_taken.length > 0 ? (
                                    <ul className="space-y-1">
                                      {refine.actions_taken.map((act: string, i: number) => (
                                        <li key={i} className="text-slate-300 flex items-start space-x-1.5">
                                          <span className="text-emerald-400 font-bold">•</span>
                                          <span>{act}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-slate-400">Keine Textänderungen erforderlich – gefundene Begriffe sind als beschreibender Fair Use freigegeben.</p>
                                  )}
                                </div>
                              ) : (
                                <div className="bg-rose-950/20 p-3 rounded-xl border border-rose-500/30 space-y-1 text-xs text-rose-300">
                                  <span className="font-bold text-rose-200 block">Begründung für die Ablehnung:</span>
                                  <p>{refine?.rejection_reason || 'Die Quote oder das Design verletzt aktive Schutzrechte in Nizza-Klasse 25.'}</p>
                                </div>
                              )}

                              {/* Collapsible raw JSON */}
                              <details className="text-[11px] text-slate-400">
                                <summary className="cursor-pointer font-semibold text-slate-400 hover:text-accent-cyan">
                                  Vollständiges Auditor-JSON anzeigen (Klick zum Aufklappen)
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg text-emerald-400 font-mono text-[11px] border border-slate-800/80 overflow-x-auto">
                                  {JSON.stringify(event.content, null, 2)}
                                </pre>
                              </details>
                            </div>
                          );
                        })()}

                        {event.type === 'ERROR' && (
                          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 text-xs text-rose-300 flex items-start space-x-2">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="font-bold text-rose-200">Fehler bei der Ausführung</p>
                              <p className="font-mono text-[11px]">{event.content}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-16 space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center text-slate-600">
                <Terminal className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-300">Kein Task ausgewählt</h4>
                <p className="text-xs text-slate-500 max-w-sm">Wähle links einen Task aus der Liste aus, um das chronologische Logbuch einzusehen.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
  Zap
} from 'lucide-react';

export type EventType = 
  | 'INCOMING_PAYLOAD'
  | 'SESSION_START'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
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
  status: 'RECEIVED' | 'PROCESSING' | 'PROMPT_READY' | 'ERROR';
  receivedAt: string;
  clientIp?: string;
  payload: Record<string, any>;
  events: SessionEvent[];
  resultPrompt?: string;
  hasError?: boolean;
  errorDetails?: string;
}

export const PromptLogView: React.FC = () => {
  const [tasks, setTasks] = useState<DesignTaskLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSource, setFilterSource] = useState<'ALL' | 'HERMES' | 'TEST' | 'DESIGNER'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<DesignTaskLog | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Mini Playground State
  const [playNiche1, setPlayNiche1] = useState('Angel Numbers');
  const [playQuote, setPlayQuote] = useState('111 Manifest Your Reality');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState<string | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tasks/log');
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        // Keep currently selected task up to date with new events
        setSelectedTask(prev => {
          if (!prev) return data.tasks[0] || null;
          return data.tasks.find((t: DesignTaskLog) => t.id === prev.id) || data.tasks[0] || null;
        });
      }
    } catch (err) {
      console.error('Failed to fetch task logs:', err);
    } finally {
      setLoading(false);
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
        setSelectedTask(null);
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
                  onClick={() => setSelectedTask(task)}
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
                        <Zap className="w-3 h-3" /> OpenRouter generiert...
                      </span>
                    )}
                    {task.status === 'PROMPT_READY' && (
                      <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Prompt bereit
                      </span>
                    )}
                    {task.hasError && (
                      <span className="text-rose-400 flex items-center gap-1 font-semibold">
                        <AlertCircle className="w-3 h-3" /> Fehler aufgetreten
                      </span>
                    )}
                    {!task.status || task.status === 'RECEIVED' && (
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Empfangen
                      </span>
                    )}

                    <span className="text-slate-500 font-mono">
                      {task.events?.length || 1} Log-Events
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
                                  ⚡ {event.metadata.latencyMs}ms
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
                              <button
                                onClick={() => copyToClipboard(event.content.userMessage, `req-${idx}`)}
                                className="flex items-center space-x-1 text-slate-400 hover:text-slate-200"
                              >
                                {copiedKey === `req-${idx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedKey === `req-${idx}` ? 'Kopiert!' : 'Input kopieren'}</span>
                              </button>
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

                        {event.type === 'LLM_RESPONSE' && (
                          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 border border-emerald-500/30 shadow-lg shadow-emerald-500/5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                Generierter Ideogram-Prompt (Ergebnis von OpenRouter)
                              </span>
                              <button
                                onClick={() => copyToClipboard(event.content, `prompt-${idx}`)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                              >
                                {copiedKey === `prompt-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>{copiedKey === `prompt-${idx}` ? 'Kopiert! ✓' : 'Prompt kopieren'}</span>
                              </button>
                            </div>

                            <p className="font-mono text-xs sm:text-sm text-slate-100 bg-slate-950/90 p-3.5 rounded-lg border border-slate-800 leading-relaxed select-all">
                              {event.content}
                            </p>
                          </div>
                        )}

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

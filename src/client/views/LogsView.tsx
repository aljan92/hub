import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  RefreshCw, 
  Trash2, 
  Copy, 
  Check, 
  Search, 
  Filter, 
  Download, 
  Pause, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Info,
  Layers,
  Sparkles
} from 'lucide-react';

export interface LogEntry {
  id: string;
  timestamp: number;
  text: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export const LogsView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = () => {
    fetch('/api/v1/sync/logs')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch(err => console.warn('[LogsView] Fetch error:', err));
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000); // Polling every 3s
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClearLogs = async () => {
    if (!confirm('Möchtest du wirklich alle Protokolleinträge löschen?')) return;
    try {
      await fetch('/api/v1/sync/logs/clear', { method: 'POST' });
      setLogs([]);
    } catch (e) {
      console.error('Clear logs error:', e);
    }
  };

  const handleCopyLogs = () => {
    const text = filteredLogs.map(l => {
      const timeStr = new Date(l.timestamp).toLocaleString('de-DE');
      return `[${timeStr}] [${l.type.toUpperCase()}] ${l.text}`;
    }).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExportLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mba-hub-logs-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filter logs by level, category & search
  const filteredLogs = logs.filter(log => {
    // Level filter
    if (filterLevel !== 'all' && log.type !== filterLevel) return false;

    // Category filter
    if (filterCategory !== 'all') {
      const textUpper = log.text.toUpperCase();
      if (filterCategory === 'sync' && !textUpper.includes('UPDATE') && !textUpper.includes('REFRESH') && !textUpper.includes('SYNC')) return false;
      if (filterCategory === 'asin' && !textUpper.includes('ASIN') && !textUpper.includes('SCANNER')) return false;
      if (filterCategory === 'session' && !textUpper.includes('SESSION') && !textUpper.includes('CHROME') && !textUpper.includes('BROWSER')) return false;
      if (filterCategory === 'sales' && !textUpper.includes('SALES') && !textUpper.includes('ROYALTIES')) return false;
      if (filterCategory === 'danger' && !textUpper.includes('GEFAHRENZONE')) return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return log.text.toLowerCase().includes(q) || new Date(log.timestamp).toLocaleString('de-DE').includes(q);
    }

    return true;
  });

  // Metrics
  const errorCount = logs.filter(l => l.type === 'error').length;
  const warnCount = logs.filter(l => l.type === 'warn').length;
  const successCount = logs.filter(l => l.type === 'success').length;
  const infoCount = logs.filter(l => l.type === 'info').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100 tracking-tight">System- &amp; Aktivitäts-Logs</h2>
              <p className="text-xs text-slate-400">
                Echtzeit-Protokoll aller Hintergrund-Scans, API-Aufrufe, Amazon-Sessions und Fehleranalysen.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 border transition-all ${
              autoScroll 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {autoScroll ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>Auto-Scroll: {autoScroll ? 'AN' : 'AUS'}</span>
          </button>

          <button
            onClick={handleCopyLogs}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Kopiert!' : 'Kopieren'}</span>
          </button>

          <button
            onClick={handleExportLogs}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          <button
            onClick={handleClearLogs}
            className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center space-x-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Leeren</span>
          </button>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-primary-500/20 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Aktualisieren</span>
          </button>
        </div>
      </div>

      {/* Metric Counters Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="glass-card p-3 rounded-xl flex items-center justify-between">
          <span className="text-xs text-slate-400 font-medium">Gesamt</span>
          <span className="font-mono text-sm font-bold text-white">{logs.length}</span>
        </div>
        <div className="glass-card p-3 rounded-xl flex items-center justify-between border-emerald-500/20 bg-emerald-500/5">
          <span className="text-xs text-emerald-400 flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Erfolg</span>
          <span className="font-mono text-sm font-bold text-emerald-300">{successCount}</span>
        </div>
        <div className="glass-card p-3 rounded-xl flex items-center justify-between border-cyan-500/20 bg-cyan-500/5">
          <span className="text-xs text-cyan-400 flex items-center"><Info className="w-3.5 h-3.5 mr-1" /> Info</span>
          <span className="font-mono text-sm font-bold text-cyan-300">{infoCount}</span>
        </div>
        <div className="glass-card p-3 rounded-xl flex items-center justify-between border-amber-500/20 bg-amber-500/5">
          <span className="text-xs text-amber-400 flex items-center"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Warnungen</span>
          <span className="font-mono text-sm font-bold text-amber-300">{warnCount}</span>
        </div>
        <div className="glass-card p-3 rounded-xl flex items-center justify-between border-rose-500/20 bg-rose-500/5">
          <span className="text-xs text-rose-400 flex items-center"><XCircle className="w-3.5 h-3.5 mr-1" /> Fehler</span>
          <span className="font-mono text-sm font-bold text-rose-300">{errorCount}</span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="glass-card p-4 rounded-2xl space-y-3 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Logs filtern (z. B. 'ASIN', '429', 'Error', 'Designs')..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Level Filter Buttons */}
          <div className="flex items-center space-x-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800 shrink-0">
            {[
              { id: 'all', label: 'Alle Levels' },
              { id: 'success', label: 'Erfolg' },
              { id: 'info', label: 'Info' },
              { id: 'warn', label: 'Warnung' },
              { id: 'error', label: 'Fehler' },
            ].map(lvl => (
              <button
                key={lvl.id}
                onClick={() => setFilterLevel(lvl.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  filterLevel === lvl.id 
                    ? 'bg-primary-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter Tags */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80 text-xs">
          <span className="text-slate-400 text-[11px] font-medium mr-1.5 flex items-center">
            <Filter className="w-3 h-3 mr-1" /> Kategorie:
          </span>
          {[
            { id: 'all', label: 'Alle' },
            { id: 'sync', label: 'Produkte & Sync' },
            { id: 'asin', label: 'ASIN Scanner' },
            { id: 'session', label: 'Browser & Session' },
            { id: 'sales', label: 'Sales & Analytics' },
            { id: 'danger', label: 'Gefahrenzone' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium border transition-all ${
                filterCategory === cat.id
                  ? 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30 font-semibold'
                  : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Log Console */}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
        {/* Terminal Header */}
        <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="ml-2 text-slate-300 font-semibold">terminal@mba-hub-core:~$ log-stream</span>
          </div>
          <div className="flex items-center space-x-2 text-[11px]">
            <span>Zeige {filteredLogs.length} von {logs.length} Einträgen</span>
          </div>
        </div>

        {/* Console Body */}
        <div 
          ref={logContainerRef}
          className="bg-slate-950/95 p-4 max-h-[580px] min-h-[400px] overflow-y-auto font-mono text-xs space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-center py-20 text-slate-500 space-y-2">
              <Terminal className="w-8 h-8 mx-auto opacity-40 text-slate-400" />
              <p>Keine Logs für die ausgewählten Filterkriterien gefunden.</p>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterLevel('all'); setFilterCategory('all'); }}
                  className="text-primary-400 hover:underline text-xs"
                >
                  Filter zurücksetzen
                </button>
              )}
            </div>
          ) : (
            filteredLogs.map((entry, index) => {
              const timeFormatted = new Date(entry.timestamp).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });
              const dateFormatted = new Date(entry.timestamp).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit'
              });

              return (
                <div
                  key={entry.id || index}
                  className={`flex items-start space-x-2.5 py-1 px-2 rounded-lg hover:bg-slate-900/60 transition-colors group ${
                    entry.type === 'error' ? 'bg-rose-500/10 text-rose-300 border-l-2 border-rose-500' :
                    entry.type === 'warn' ? 'bg-amber-500/10 text-amber-300 border-l-2 border-amber-500' :
                    entry.type === 'success' ? 'text-emerald-300 border-l-2 border-emerald-500/60' :
                    'text-slate-300 border-l-2 border-transparent'
                  }`}
                >
                  {/* Timestamp */}
                  <span className="text-slate-500 text-[11px] shrink-0 select-none">
                    [{dateFormatted} {timeFormatted}]
                  </span>

                  {/* Level Badge */}
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 uppercase select-none ${
                    entry.type === 'error' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                    entry.type === 'warn' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                    entry.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    'bg-slate-800 text-cyan-400 border border-slate-700'
                  }`}>
                    {entry.type}
                  </span>

                  {/* Log Content */}
                  <div className="flex-1 break-all leading-relaxed">
                    {entry.text}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

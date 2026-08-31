import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Info,
  Globe,
  Tag,
  Check,
  ExternalLink,
  BookOpen
} from 'lucide-react';

interface WhitelistData {
  GLOBAL: string[];
  USPTO: string[];
  EUIPO: string[];
  DPMA: string[];
  [key: string]: string[];
}

export const TrademarkView: React.FC = () => {
  const [activeOffice, setActiveOffice] = useState<'GLOBAL' | 'USPTO' | 'EUIPO' | 'DPMA'>('GLOBAL');
  const [whitelist, setWhitelist] = useState<WhitelistData>({
    GLOBAL: [],
    USPTO: [],
    EUIPO: [],
    DPMA: []
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [newTermInput, setNewTermInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Live Trademark Sandbox State
  const [testPhrase, setTestPhrase] = useState('');
  const [testOffice, setTestOffice] = useState<'ALL' | 'USPTO' | 'EUIPO' | 'DPMA'>('ALL');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const fetchWhitelist = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/trademark/whitelist');
      const data = await res.json();
      if (data.success && data.whitelist) {
        setWhitelist(data.whitelist);
      }
    } catch (err: any) {
      showToast(err.message || 'Fehler beim Laden der Whitelist', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWhitelist();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleAddTerms = async () => {
    if (!newTermInput.trim()) return;
    setSaving(true);
    try {
      const termsToAdd = newTermInput
        .split(/[,;\n]+/)
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const res = await fetch('/api/v1/trademark/whitelist/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          office: activeOffice,
          terms: termsToAdd
        })
      });
      const data = await res.json();
      if (data.success && data.whitelist) {
        setWhitelist(data.whitelist);
        setNewTermInput('');
        showToast(`${termsToAdd.length} Begriff(e) zu ${activeOffice} Whitelist hinzugefügt.`, 'success');
      } else {
        showToast(data.error || 'Fehler beim Hinzufügen', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Verbindungsfehler', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveTerm = async (term: string) => {
    try {
      const res = await fetch('/api/v1/trademark/whitelist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          office: activeOffice,
          term
        })
      });
      const data = await res.json();
      if (data.success && data.whitelist) {
        setWhitelist(data.whitelist);
        showToast(`"${term}" aus ${activeOffice} entfernt.`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Fehler beim Entfernen', 'error');
    }
  };

  const handleRunLiveTest = async () => {
    if (!testPhrase.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const offices = testOffice === 'ALL' ? ['USPTO', 'EUIPO', 'DPMA'] : [testOffice];
      const res = await fetch('/api/v1/trademark/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offices,
          fields: {
            test: testPhrase
          }
        })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      showToast(err.message || 'Test fehlgeschlagen', 'error');
    } finally {
      setTesting(false);
    }
  };

  const currentList = whitelist[activeOffice] || [];
  const filteredList = currentList.filter(item =>
    item.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold flex items-center space-x-2 transition-all transform animate-in slide-in-from-top-2 ${
            toast.type === 'success'
              ? 'bg-slate-900 text-emerald-300 border-emerald-500/40'
              : 'bg-slate-900 text-rose-300 border-rose-500/40'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <ShieldCheck className="w-6 h-6 mr-2.5 text-amber-400" />
            Trademark &amp; Whitelist Manager
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Verwalte markenrechtliche Ausnahmen pro Marktplatz (z. B. "girl", "mama") und teste Listings live.
          </p>
        </div>

        <button
          onClick={fetchWhitelist}
          disabled={loading}
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 inline-flex items-center space-x-1.5 transition-colors self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Neu laden</span>
        </button>
      </div>

      {/* Main Grid: Left = Whitelist Manager (7 cols), Right = Live Sandbox & Rules (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Whitelist Panel */}
        <div className="lg:col-span-7 glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
          {/* Office Tabs */}
          <div className="flex items-center justify-between gap-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-semibold">
            {[
              { id: 'GLOBAL', label: '🌐 Global (Alle)', count: whitelist.GLOBAL?.length || 0 },
              { id: 'USPTO', label: '🇺🇸 USPTO (US)', count: whitelist.USPTO?.length || 0 },
              { id: 'EUIPO', label: '🇪🇺 EUIPO (EU)', count: whitelist.EUIPO?.length || 0 },
              { id: 'DPMA', label: '🇩🇪 DPMA (DE)', count: whitelist.DPMA?.length || 0 }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveOffice(tab.id as any)}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
                  activeOffice === tab.id
                    ? 'bg-amber-600 text-white font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 font-mono">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Add Word Input Box */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span>Begriffe zur {activeOffice}-Whitelist hinzufügen</span>
              <span className="text-[10px] font-normal text-slate-400">Kommasepariert oder Zeilenumbruch</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTermInput}
                onChange={(e) => setNewTermInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTerms();
                  }
                }}
                placeholder="z.B. girl, girls, boy, boys, queen, mama..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleAddTerms}
                disabled={saving || !newTermInput.trim()}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Hinzufügen</span>
              </button>
            </div>
          </div>

          {/* Filter & Chip List Header */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Whitelist durchsuchen..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
            <span className="text-[11px] font-mono text-slate-400 shrink-0">
              {filteredList.length} Begriff{filteredList.length !== 1 ? 'e' : ''}
            </span>
          </div>

          {/* Chips Grid */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 min-h-[220px] max-h-[360px] overflow-y-auto custom-scrollbar">
            {filteredList.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <Tag className="w-6 h-6 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  {searchTerm ? 'Keine passenden Begriffe gefunden.' : `Keine Begriffe in der ${activeOffice} Whitelist hinterlegt.`}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filteredList.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-slate-900 hover:bg-slate-850 text-amber-300 border border-amber-500/30 group transition-all"
                  >
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTerm(word)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition-colors"
                      title={`"${word}" löschen`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Trademark Sandbox & Info Guide */}
        <div className="lg:col-span-5 space-y-5">
          {/* Live Sandbox Tester */}
          <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3.5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Live Trademark-Tester (Sandbox)</span>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={testPhrase}
                onChange={(e) => setTestPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRunLiveTest();
                  }
                }}
                placeholder="Text oder Keyword eingeben (z. B. 'Horse Girl Tee')..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />

              <div className="flex items-center justify-between gap-2">
                <select
                  value={testOffice}
                  onChange={(e) => setTestOffice(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">Alle Ämter (USPTO, EUIPO, DPMA)</option>
                  <option value="USPTO">Nur USPTO (US)</option>
                  <option value="EUIPO">Nur EUIPO (EU)</option>
                  <option value="DPMA">Nur DPMA (DE)</option>
                </select>

                <button
                  type="button"
                  onClick={handleRunLiveTest}
                  disabled={testing || !testPhrase.trim()}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{testing ? 'Prüfe...' : 'Prüfen'}</span>
                </button>
              </div>
            </div>

            {/* Test Results Output */}
            {testResult && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Ergebnis:</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      testResult.hasInfringementClass25
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {testResult.hasInfringementClass25 ? 'Klasse 25 Konflikt' : 'Klasse 25 Sicher ✓'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">{testResult.summary?.message}</p>

                {testResult.blockedProducts?.length > 0 && (
                  <div className="text-[10px] text-amber-400 font-mono">
                    Gesperrte Produkte: {testResult.blockedProducts.join(', ')}
                  </div>
                )}

                {testResult.exactPhraseHits?.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-rose-400 block">Exakte Treffer:</span>
                    {testResult.exactPhraseHits.map((h: any, idx: number) => (
                      <div key={idx} className="p-1.5 rounded bg-slate-900 text-[10px] font-mono text-slate-300 border border-slate-800">
                        {h.source}: <strong>{h.trademark}</strong> (Kl. {h.classNumber})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Whitelist Info & Best Practices */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-850 space-y-2.5 text-xs text-slate-400">
            <div className="flex items-center space-x-2 text-slate-200 font-semibold">
              <BookOpen className="w-4 h-4 text-amber-400" />
              <span>Funktionsweise der Whitelist</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed text-slate-400">
              <li>
                <strong className="text-slate-300">Automatischer Bypass:</strong> Begriffe auf der Whitelist (z. B. "girl", "queen") werden bei der Productor-Markenprüfung ignoriert und blockieren weder das Listing noch Klasse 25.
              </li>
              <li>
                <strong className="text-slate-300">Global vs. Marktplatz:</strong> Begriffe in <em>Global</em> gelten für alle Länder. Marktplatz-spezifische Listen greifen nur bei USPTO, EUIPO oder DPMA.
              </li>
              <li>
                <strong className="text-slate-300">Gilt für beide Pipelines:</strong> Die Whitelist schützt sowohl neu generierte Designs als auch den automatischen Update-Workflow.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
export default TrademarkView;

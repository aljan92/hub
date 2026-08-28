import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Sliders, 
  Save, 
  RotateCcw, 
  Check, 
  Sparkles, 
  Eye, 
  Clock, 
  Layers,
  HelpCircle,
  FileText,
  Tag,
  ShieldCheck,
  Zap,
  Search,
  RefreshCw,
  Copy,
  FolderOpen,
  ArrowRight
} from 'lucide-react';

export type PromptKey = 
  | 'promptGenerator'
  | 'designAnalyzer'
  | 'listingGenerator'
  | 'trademarkAuditor'
  | 'svgBgAuditor'
  | 'updateVisionAnalyzer'
  | 'updateListingRewriter'
  | 'updateLocalizationTranslator';

interface PromptDefinition {
  key: PromptKey;
  stepCode: string;
  category: 'DESIGN' | 'UPDATE';
  title: string;
  shortDesc: string;
  colorClass: string;
  badgeBg: string;
  borderClass: string;
  icon: React.ComponentType<any>;
  variables: { name: string; desc: string }[];
}

const PROMPT_DEFINITIONS: PromptDefinition[] = [
  // ----------------------------------------------------
  // Category 1: Design Creation Pipeline (D1–D8)
  // ----------------------------------------------------
  {
    key: 'promptGenerator',
    stepCode: 'D2',
    category: 'DESIGN',
    title: 'Ideogram Prompt Engineer',
    shortDesc: 'Generiert hochoptimierte, saubere Vektorpuffer-Prompts für Ideogram V_3 aus Hermes-Rohdaten.',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: Sparkles,
    variables: [
      { name: '{niche}', desc: 'Zielnische des Motivs' },
      { name: '{quote}', desc: 'Geforderter Text/Slogan' },
      { name: '{style}', desc: 'Grafikstil (z. B. Retro, Minimal)' },
      { name: '{feeling}', desc: 'Emotionale Stimmung' },
      { name: '{colors}', desc: 'Farbpalette' }
    ]
  },
  {
    key: 'designAnalyzer',
    stepCode: 'D4',
    category: 'DESIGN',
    title: 'Vision QA & Farbanalyse',
    shortDesc: 'Prüft das generierte Bild auf Rechtschreibung, Quote-Matching, Zielgruppen-Fit, Avoid-Colors und Farbanzahl.',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: Eye,
    variables: [
      { name: '{requested_quote}', desc: 'Ursprüngliches Quote' },
      { name: '{fitTypes}', desc: 'Men, Women, Youth' },
      { name: '{avoid}', desc: 'None, Black, White' },
      { name: '{color_count}', desc: 'Ermittelte Farbanzahl (1-12)' }
    ]
  },
  {
    key: 'listingGenerator',
    stepCode: 'D5',
    category: 'DESIGN',
    title: 'MBA SEO Listing Generator',
    shortDesc: 'Erstellt konvertierende, richtlinienkonforme SEO-Listings für alle 6 Amazon Merch Marktplätze (EN, DE, FR, IT, ES, JA).',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: FileText,
    variables: [
      { name: '{brand}', desc: 'Nischenbezogener Brand-Name' },
      { name: '{title}', desc: 'SEO-Titel (max. 60 Zeichen)' },
      { name: '{bullet1}', desc: 'Design & Kunststil (max. 250 Zeichen)' },
      { name: '{bullet2}', desc: 'Zielgruppe & Anlass (max. 250 Zeichen)' }
    ]
  },
  {
    key: 'trademarkAuditor',
    stepCode: 'D6',
    category: 'DESIGN',
    title: 'Trademark Auditor & Refiner',
    shortDesc: 'Analysiert USPTO / DPMA Treffer, trennt beschreibende Fair-Use-Begriffe und formuliert Brand/Titel bei Bedarf automatisch um.',
    colorClass: 'text-amber-300',
    badgeBg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    borderClass: 'border-amber-500/40',
    icon: ShieldCheck,
    variables: [
      { name: '{hits}', desc: 'Gefundene TM-Treffer in Klasse 25' },
      { name: '{verdict}', desc: 'APPROVED oder REJECTED' },
      { name: '{refined_listing}', desc: 'Bereinigte Listing-Felder' }
    ]
  },
  {
    key: 'svgBgAuditor',
    stepCode: 'D7',
    category: 'DESIGN',
    title: 'SVG Cutout 4-Panel Auditor',
    shortDesc: 'Inspiziert das 4-Panel Test-Gitter (Weiß, Schwarz, Rot, Slate) per Vision auf Kastenrahmen und geschlossene Buchstaben-Inseln.',
    colorClass: 'text-pink-300',
    badgeBg: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
    borderClass: 'border-pink-500/40',
    icon: Zap,
    variables: [
      { name: '{cutout_verdict}', desc: 'APPROVED oder REJECTED' },
      { name: '{detected_issues}', desc: 'Gefundene Artefakte' }
    ]
  },

  // ----------------------------------------------------
  // Category 2: Listing Update Pipeline (U1–U7)
  // ----------------------------------------------------
  {
    key: 'updateVisionAnalyzer',
    stepCode: 'U3',
    category: 'UPDATE',
    title: 'Update Vision & Quality Auditor',
    shortDesc: 'Analysiert das bestehende Merch-Design + altes Listing und entscheidet, ob ein Rewrite nötig ist (rewriteNeeded: true/false).',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: Eye,
    variables: [
      { name: '{oldBrand}', desc: 'Aktueller Brand-Name' },
      { name: '{oldTitle}', desc: 'Aktueller Titel' },
      { name: '{oldBullets}', desc: 'Aktuelle Bullets 1 & 2' },
      { name: '{rewriteNeeded}', desc: 'Entscheidung: true oder false' }
    ]
  },
  {
    key: 'updateListingRewriter',
    stepCode: 'U4',
    category: 'UPDATE',
    title: 'Update Listing Rewriter (EN)',
    shortDesc: 'Optimiert veraltete oder Keyword-stuffed englische Listings zu hochwertigen, konvertierenden MBA-Texten.',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: FileText,
    variables: [
      { name: '{brand}', desc: 'Optimierter Brand Name (max 50)' },
      { name: '{title}', desc: 'Optimierter Titel (max 60)' },
      { name: '{bullet1}', desc: 'Bullet 1 (max 256)' },
      { name: '{bullet2}', desc: 'Bullet 2 (max 256)' }
    ]
  },
  {
    key: 'updateLocalizationTranslator',
    stepCode: 'U6',
    category: 'UPDATE',
    title: 'Update Localization & SEO Translator',
    shortDesc: 'Lokalisiert das optimierte englische Listing nativ nach Deutsch, Französisch, Spanisch und Italienisch.',
    colorClass: 'text-sky-300',
    badgeBg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    borderClass: 'border-sky-500/40',
    icon: Layers,
    variables: [
      { name: '{de}', desc: 'Deutsche Lokalisierung' },
      { name: '{fr}', desc: 'Französische Lokalisierung' },
      { name: '{es}', desc: 'Spanische Lokalisierung' },
      { name: '{it}', desc: 'Italienische Lokalisierung' }
    ]
  }
];

export const SystemPromptsView: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'DESIGN' | 'UPDATE'>('ALL');
  const [activePromptKey, setActivePromptKey] = useState<PromptKey>('promptGenerator');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const [promptsState, setPromptsState] = useState<Record<PromptKey, string>>({
    promptGenerator: '',
    designAnalyzer: '',
    listingGenerator: '',
    trademarkAuditor: '',
    svgBgAuditor: '',
    updateVisionAnalyzer: '',
    updateListingRewriter: '',
    updateLocalizationTranslator: ''
  });
  
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedStatus, setSavedStatus] = useState<'SAVED' | 'SAVING' | 'IDLE'>('IDLE');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const stateRef = useRef(promptsState);
  stateRef.current = promptsState;

  // 1. Load active system prompts from server
  useEffect(() => {
    fetch('/api/v1/systemprompts')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPromptsState({
            promptGenerator: data.promptGenerator || '',
            designAnalyzer: data.designAnalyzer || '',
            listingGenerator: data.listingGenerator || '',
            trademarkAuditor: data.trademarkAuditor || '',
            svgBgAuditor: data.svgBgAuditor || '',
            updateVisionAnalyzer: data.updateVisionAnalyzer || '',
            updateListingRewriter: data.updateListingRewriter || '',
            updateLocalizationTranslator: data.updateLocalizationTranslator || ''
          });
        }
      })
      .catch(err => console.error('Failed to load system prompts:', err))
      .finally(() => setLoading(false));

    // Auto-save on component unmount
    return () => {
      const payload = stateRef.current;
      const hasAny = Object.values(payload).some(val => typeof val === 'string' && val.trim().length > 0);
      if (hasAny) {
        fetch('/api/v1/systemprompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(() => {});
      }
    };
  }, []);

  // Keyboard shortcut: Cmd+S / Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [promptsState]);

  // 2. Save function
  const handleSave = async (overrides?: Partial<Record<PromptKey, string>>) => {
    const payload = { ...promptsState, ...overrides };
    setSaving(true);
    setSavedStatus('SAVING');
    try {
      const res = await fetch('/api/v1/systemprompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
        setTimeout(() => setSavedStatus('IDLE'), 3000);
      }
    } catch (err) {
      console.error('Failed to save system prompts:', err);
    } finally {
      setSaving(false);
    }
  };

  // 3. Reset specific prompt to default
  const handleResetCurrent = async () => {
    const def = PROMPT_DEFINITIONS.find(p => p.key === activePromptKey);
    if (!def) return;
    if (!confirm(`Möchtest du den Systemprompt "${def.title}" wirklich auf die Standardvorlage zurücksetzen?`)) return;
    
    setSaving(true);
    try {
      const res = await fetch('/api/v1/systemprompts/reset', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: activePromptKey })
      });
      const data = await res.json();
      if (data.success && typeof data[activePromptKey] === 'string') {
        setPromptsState(prev => ({ ...prev, [activePromptKey]: data[activePromptKey] }));
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
        setTimeout(() => setSavedStatus('IDLE'), 3000);
      }
    } catch (err) {
      alert('Fehler beim Zurücksetzen');
    } finally {
      setSaving(false);
    }
  };

  // 4. Reset all prompts to default
  const handleResetAll = async () => {
    if (!confirm('Möchtest du wirklich ALLE 8 Systemprompts auf ihre Standardvorlagen zurücksetzen?')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/systemprompts/reset', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all' })
      });
      const data = await res.json();
      if (data.success) {
        setPromptsState({
          promptGenerator: data.promptGenerator || '',
          designAnalyzer: data.designAnalyzer || '',
          listingGenerator: data.listingGenerator || '',
          trademarkAuditor: data.trademarkAuditor || '',
          svgBgAuditor: data.svgBgAuditor || '',
          updateVisionAnalyzer: data.updateVisionAnalyzer || '',
          updateListingRewriter: data.updateListingRewriter || '',
          updateLocalizationTranslator: data.updateLocalizationTranslator || ''
        });
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
        setTimeout(() => setSavedStatus('IDLE'), 3000);
      }
    } catch (err) {
      alert('Fehler beim Zurücksetzen');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyVar = (varName: string) => {
    navigator.clipboard.writeText(varName);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  };

  // Filtered prompt list
  const filteredPrompts = useMemo(() => {
    return PROMPT_DEFINITIONS.filter(p => {
      const matchesCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
      const matchesSearch = searchQuery === '' || 
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.stepCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.shortDesc.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  const activeDef = PROMPT_DEFINITIONS.find(p => p.key === activePromptKey) || PROMPT_DEFINITIONS[0];
  const currentText = promptsState[activePromptKey] || '';
  const charCount = currentText.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-cyan-400" />
            Systemprompts &amp; Pipeline Steuerung
          </h2>
          <p className="text-sm text-slate-400">
            Zentrale Konfiguration für die Design Creation Pipeline (D1–D8) und Listing Update Pipeline (U1–U7).
          </p>
        </div>

        {/* Action Controls & Save Status */}
        <div className="flex items-center space-x-3">
          {savedStatus === 'SAVED' && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-fadeIn">
              <Check className="w-3.5 h-3.5" />
              <span>Gespeichert {lastSavedTime ? `(${lastSavedTime})` : ''}</span>
            </div>
          )}

          {savedStatus === 'SAVING' && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Speichern...</span>
            </div>
          )}

          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50"
            title="Tastenkürzel: Cmd+S / Ctrl+S"
          >
            <Save className="w-4 h-4" />
            <span>Speichern (Cmd+S)</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Sidebar Navigator + Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Navigator (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Category Filter Pills & Search */}
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-3 shadow-lg">
            {/* Category Filter */}
            <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-800">
              <button
                onClick={() => setSelectedCategory('ALL')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  selectedCategory === 'ALL' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Alle (8)
              </button>
              <button
                onClick={() => setSelectedCategory('DESIGN')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  selectedCategory === 'DESIGN' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🎨 Creation (5)
              </button>
              <button
                onClick={() => setSelectedCategory('UPDATE')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  selectedCategory === 'UPDATE' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🔄 Update (3)
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Prompts durchsuchen..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          {/* Prompt Cards List */}
          <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar pr-1">
            {filteredPrompts.map(p => {
              const Icon = p.icon;
              const isActive = activePromptKey === p.key;
              const hasCustom = promptsState[p.key]?.trim().length > 0;

              return (
                <div
                  key={p.key}
                  onClick={() => setActivePromptKey(p.key)}
                  className={`p-3 rounded-2xl cursor-pointer border transition-all ${
                    isActive
                      ? `bg-slate-900 ${p.borderClass} shadow-md ring-1 ring-cyan-500/20`
                      : 'bg-slate-950/70 border-slate-850 hover:bg-slate-900/50 hover:border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${p.badgeBg}`}>
                        {p.stepCode}
                      </span>
                      <span className={`text-xs font-bold ${isActive ? 'text-slate-100' : 'text-slate-300'}`}>
                        {p.title}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      {p.category === 'DESIGN' ? 'Creation' : 'Update'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {p.shortDesc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Global Reset Button */}
          <div className="pt-2">
            <button
              onClick={handleResetAll}
              disabled={saving}
              className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Alle Prompts auf Werkseinstellungen zurücksetzen</span>
            </button>
          </div>
        </div>

        {/* Right Column: Active Prompt Editor (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-slate-950 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-4">
            {/* Editor Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${activeDef.badgeBg}`}>
                    {activeDef.stepCode}
                  </span>
                  <h3 className="text-base font-bold text-slate-100">
                    {activeDef.title}
                  </h3>
                </div>
                <p className="text-xs text-slate-400">
                  {activeDef.shortDesc}
                </p>
              </div>

              {/* Single Prompt Reset */}
              <button
                onClick={handleResetCurrent}
                disabled={saving}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 transition-colors disabled:opacity-50"
                title="Diesen Prompt auf Standard zurücksetzen"
              >
                <RotateCcw className="w-3 h-3 text-slate-400" />
                <span>Standard wiederherstellen</span>
              </button>
            </div>

            {/* Variable Pills */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Verfügbare Variablen (Klick zum Kopieren):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeDef.variables.map(v => (
                  <button
                    key={v.name}
                    onClick={() => handleCopyVar(v.name)}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all border ${
                      copiedVar === v.name
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-900 text-slate-300 hover:text-cyan-300 border-slate-800 hover:border-slate-700'
                    }`}
                    title={v.desc}
                  >
                    <span>{v.name}</span>
                    {copiedVar === v.name ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 opacity-60" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Code / Textarea Editor */}
            <div className="relative">
              <textarea
                value={currentText}
                onChange={e => {
                  const val = e.target.value;
                  setPromptsState(prev => ({ ...prev, [activePromptKey]: val }));
                  setSavedStatus('IDLE');
                }}
                rows={18}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 leading-relaxed custom-scrollbar transition-colors"
                placeholder="System Prompt hier definieren..."
                spellCheck={false}
              />
            </div>

            {/* Editor Footer / Live Stats */}
            <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 font-mono pt-1">
              <div className="flex items-center space-x-4">
                <span>Zeichen: <strong className="text-slate-300 font-bold">{charCount}</strong></span>
                <span>Geschätzte Tokens: <strong className="text-purple-300 font-bold">~{estimatedTokens}</strong></span>
              </div>
              <div className="text-[11px] text-slate-400">
                Änderungen werden beim Wechseln oder per <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 border border-slate-700">Cmd+S</kbd> gespeichert.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

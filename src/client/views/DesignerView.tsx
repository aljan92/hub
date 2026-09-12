import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Dices, Eraser, Layers, RefreshCw, Send, Sparkles, Tag, Trash2, Type, Wand2, X } from 'lucide-react';
import type { ActiveTab } from '../components/Sidebar';

type ImageProvider = 'IDEOGRAM' | 'IDEOGRAM_V4' | 'GPT_IMAGE_2';
type SuggestionField = 'niche1' | 'niche2' | 'subniche' | 'quote' | 'style';
type FormValues = Record<SuggestionField, string>;
type SuggestionHistory = Record<SuggestionField, string[]>;
type ModelItem = { id: string; name?: string };

interface GeneratedConceptItem {
  id: string;
  niche1: string;
  niche2?: string;
  subniche?: string;
  quote: string;
  style?: string;
  started?: boolean;
  taskId?: string;
}

const HISTORY_KEY = 'mba_designer_suggestion_history_v1';
const emptyHistory = (): SuggestionHistory => ({ niche1: [], niche2: [], subniche: [], quote: [], style: [] });
const STYLE_PRESETS = [
  'Vintage distressed 1970s illustration with bold retro typography',
  'Modern minimalist vector illustration with clean geometric typography',
  'Bold stacked typography with small supporting illustrations',
  'Cute kawaii character illustration with playful rounded typography',
  'Detailed hand-drawn engraving with classic serif typography'
];

function readHistory(): SuggestionHistory {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return Object.fromEntries(Object.keys(emptyHistory()).map(field => [
      field,
      Array.isArray(parsed[field]) ? parsed[field].filter((value: unknown) => typeof value === 'string').slice(-5) : []
    ])) as SuggestionHistory;
  } catch {
    return emptyHistory();
  }
}

export const DesignerView: React.FC<{ onNavigateTab?: (tab: ActiveTab) => void }> = ({ onNavigateTab }) => {
  const [activeTab, setActiveTab] = useState<'CONCEPTS' | 'MANUAL'>('CONCEPTS');
  const [imageProvider, setImageProvider] = useState<ImageProvider>('IDEOGRAM');
  const [promptPoolEnabled, setPromptPoolEnabled] = useState(false);
  const [providerSettings, setProviderSettings] = useState<any>({});

  // Tab 1: LLM Concepts & Random State
  const [conceptPrompt, setConceptPrompt] = useState('');
  const [isGeneratingConcepts, setIsGeneratingConcepts] = useState(false);
  const [conceptError, setConceptError] = useState('');
  const [generatedConcepts, setGeneratedConcepts] = useState<GeneratedConceptItem[]>([]);
  const [startingSingleId, setStartingSingleId] = useState<string | null>(null);
  const [isBatchStarting, setIsBatchStarting] = useState(false);
  const [batchSuccessMessage, setBatchSuccessMessage] = useState('');

  // Tab 2: Manual Designer Form State
  const [values, setValues] = useState<FormValues>({ niche1: '', niche2: '', subniche: '', quote: '', style: '' });
  const [models, setModels] = useState<ModelItem[]>([]);
  const [suggestionModel, setSuggestionModel] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [loadingField, setLoadingField] = useState<SuggestionField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SuggestionField, string>>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdTaskId, setCreatedTaskId] = useState('');

  const providerSettingsLoaded = useRef(false);
  const generationInFlight = useRef(false);
  const historyRef = useRef<SuggestionHistory>(readHistory());

  useEffect(() => {
    fetch('/api/v1/settings').then(res => res.json()).then(settingsData => {
      if (settingsData.success) {
        const settings = settingsData.settings || {};
        setProviderSettings(settings);
        setPromptPoolEnabled(Boolean(settings.designerPromptPoolEnabled));
        setImageProvider(settings.designerImageProvider === 'GPT_IMAGE_2' ? 'GPT_IMAGE_2' : settings.designerImageProvider === 'IDEOGRAM_V4' ? 'IDEOGRAM_V4' : 'IDEOGRAM');
        setSuggestionModel(settings.designerSuggestionModel || '');
        providerSettingsLoaded.current = true;
      }
    }).catch(() => {});
  }, []);

  const saveDesignerSetting = (update: Record<string, unknown>) => {
    fetch('/api/v1/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update)
    }).then(res => res.json()).then(data => {
      if (data.success) setProviderSettings(data.settings || {});
    }).catch(() => {});
  };

  useEffect(() => {
    if (providerSettingsLoaded.current) saveDesignerSetting({ designerImageProvider: imageProvider });
  }, [imageProvider]);

  // Concepts generation handler
  const handleGenerateConcepts = async (options: { prompt?: string; random?: boolean; count?: number } = {}) => {
    if (isGeneratingConcepts) return;
    setIsGeneratingConcepts(true);
    setConceptError('');
    setBatchSuccessMessage('');
    try {
      const response = await fetch('/api/v1/designer/concepts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.concepts)) {
        throw new Error(data.error || 'Konzepte konnten nicht generiert werden.');
      }
      const newItems: GeneratedConceptItem[] = data.concepts.map((c: any, index: number) => ({
        id: `concept_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        niche1: c.niche1 || '',
        niche2: c.niche2 || '',
        subniche: c.subniche || '',
        quote: c.quote || '',
        style: c.style || '',
        started: false
      }));
      setGeneratedConcepts(newItems);
    } catch (err: any) {
      setConceptError(err?.message || 'Fehler bei der Konzept-Generierung.');
    } finally {
      setIsGeneratingConcepts(false);
    }
  };

  const updateConceptField = (id: string, field: keyof GeneratedConceptItem, val: string) => {
    setGeneratedConcepts(prev => prev.map(item => item.id === id ? { ...item, [field]: val } : item));
  };

  const removeConcept = (id: string) => {
    setGeneratedConcepts(prev => prev.filter(item => item.id !== id));
  };

  const startSingleConceptTask = async (item: GeneratedConceptItem) => {
    if (item.started || startingSingleId) return;
    if (!item.niche1.trim()) {
      setConceptError(`Konzept "${item.quote}": Niche 1 darf nicht leer sein.`);
      return;
    }
    setStartingSingleId(item.id);
    setConceptError('');
    try {
      const response = await fetch('/api/v1/designer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche1: item.niche1,
          niche2: item.niche2 || '',
          subniche: item.subniche || '',
          quote: item.quote,
          style: item.style || '',
          imageProvider,
          promptPoolEnabled
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.taskId) {
        throw new Error(data.error || 'Task konnte nicht angelegt werden.');
      }
      setGeneratedConcepts(prev => prev.map(c => c.id === item.id ? { ...c, started: true, taskId: data.taskId } : c));
    } catch (err: any) {
      setConceptError(err?.message || 'Fehler beim Starten des Tasks.');
    } finally {
      setStartingSingleId(null);
    }
  };

  const startAllPendingConcepts = async () => {
    const pending = generatedConcepts.filter(c => !c.started);
    if (pending.length === 0 || isBatchStarting) return;
    const invalid = pending.find(c => !c.niche1.trim());
    if (invalid) {
      setConceptError('Alle zu startenden Konzepte müssen mindestens eine Niche 1 enthalten.');
      return;
    }
    setIsBatchStarting(true);
    setConceptError('');
    try {
      const response = await fetch('/api/v1/designer/concepts/batch-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concepts: pending.map(c => ({
            niche1: c.niche1,
            niche2: c.niche2 || '',
            subniche: c.subniche || '',
            quote: c.quote,
            style: c.style || ''
          })),
          imageProvider,
          promptPoolEnabled
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.taskIds)) {
        throw new Error(data.error || 'Tasks konnten nicht gesammelt angelegt werden.');
      }
      const taskIds: string[] = data.taskIds;
      setGeneratedConcepts(prev => prev.map((c, idx) => {
        if (!c.started) {
          return { ...c, started: true, taskId: taskIds[idx] || c.taskId };
        }
        return c;
      }));
      setBatchSuccessMessage(`${taskIds.length} Task(s) erfolgreich angelegt (${taskIds.join(', ')}).`);
    } catch (err: any) {
      setConceptError(err?.message || 'Fehler beim Batch-Starten.');
    } finally {
      setIsBatchStarting(false);
    }
  };

  // Manual Tab Handlers
  const modelOptions = useMemo(() => {
    const unique = new Map<string, ModelItem>();
    models.forEach(model => { if (model?.id) unique.set(model.id, model); });
    return Array.from(unique.values());
  }, [models]);

  const openCurrentModelMenu = async () => {
    if (modelsLoading) return;
    setModelsLoading(true);
    setModelsError('');
    setModelMenuOpen(false);
    try {
      const response = await fetch('/api/v1/llm/models?refresh=true');
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.models)) throw new Error(data.error || 'Aktuelle Modellliste konnte nicht geladen werden.');
      setModels(data.models);
      setModelMenuOpen(true);
    } catch (error: any) {
      setModels([]);
      setModelsError(error?.message || 'Aktuelle Modellliste konnte nicht geladen werden.');
    } finally {
      setModelsLoading(false);
    }
  };

  const chooseSuggestionModel = (model: string) => {
    setSuggestionModel(model);
    setModelMenuOpen(false);
    saveDesignerSetting({ designerSuggestionModel: model });
  };

  const updateValue = (field: SuggestionField, value: string) => {
    setValues(current => ({ ...current, [field]: value }));
    setFieldErrors(current => ({ ...current, [field]: undefined }));
    setCreatedTaskId('');
    setFormError('');
  };

  const clearHistory = () => {
    historyRef.current = emptyHistory();
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  };

  const handleReset = () => {
    setValues(current => ({ niche1: current.niche1, niche2: '', subniche: '', quote: '', style: '' }));
    clearHistory();
    setFieldErrors({});
    setFormError('');
    setCreatedTaskId('');
  };

  const handleSuggest = async (field: SuggestionField) => {
    if (loadingField) return;
    setLoadingField(field);
    setFieldErrors(current => ({ ...current, [field]: undefined }));
    try {
      const response = await fetch('/api/v1/designer/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, values, avoid: historyRef.current[field], model: suggestionModel })
      });
      const data = await response.json();
      if (!response.ok || !data.success || typeof data.suggestion !== 'string') throw new Error(data.error || 'Vorschlag konnte nicht erzeugt werden.');
      updateValue(field, data.suggestion);
      historyRef.current = { ...historyRef.current, [field]: [...historyRef.current[field], data.suggestion].slice(-5) };
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current)); } catch {}
    } catch (error: any) {
      setFieldErrors(current => ({ ...current, [field]: error?.message || 'Vorschlag konnte nicht erzeugt werden.' }));
    } finally {
      setLoadingField(null);
    }
  };

  const handleGenerate = async () => {
    if (generationInFlight.current) return;
    if (!values.niche1.trim()) {
      setFieldErrors(current => ({ ...current, niche1: 'Bitte zuerst Niche 1 ausfüllen.' }));
      return;
    }
    generationInFlight.current = true;
    setIsGenerating(true);
    setFormError('');
    setCreatedTaskId('');
    const requestId = globalThis.crypto?.randomUUID?.() || `designer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const response = await fetch('/api/v1/designer/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, imageProvider, promptPoolEnabled, requestId })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.taskId) throw new Error(data.error || 'Task konnte nicht angelegt werden.');
      clearHistory();
      setCreatedTaskId(data.taskId);
    } catch (error: any) {
      setFormError(error?.message || 'Task konnte nicht angelegt werden.');
    } finally {
      generationInFlight.current = false;
      setIsGenerating(false);
    }
  };

  const effectiveSettings = imageProvider === 'GPT_IMAGE_2'
    ? `${String(providerSettings.gptImageQuality || 'high').toUpperCase()} · ${providerSettings.gptImageAspectRatio || '3:4'} · ${providerSettings.gptImageBackground === 'transparent' ? 'FREISTELLUNG (DEEP BLUE)' : String(providerSettings.gptImageBackground || 'opaque').toUpperCase()}`
    : imageProvider === 'IDEOGRAM_V4'
    ? `V_4 · ${providerSettings.ideogramV4AspectRatio || '10x16'} · ${providerSettings.ideogramV4Transparent !== false ? 'TRANSPARENT' : 'OPAQUE'} · Magic Prompt ${providerSettings.ideogramV4MagicPrompt !== false ? 'ON' : 'OFF'}`
    : `${providerSettings.ideogramModel || 'V_3'} · ${providerSettings.ideogramAspectRatio || '10x16'} · Magic Prompt ${providerSettings.ideogramMagicPromptOption || 'AUTO'}`;

  const providerLabels: Record<ImageProvider, string> = {
    IDEOGRAM: 'Ideogram 3.0',
    IDEOGRAM_V4: 'Ideogram 4.0',
    GPT_IMAGE_2: 'GPT Image 2'
  };

  const manualFields: Array<{ key: SuggestionField; label: string; placeholder: string; icon: React.ReactNode }> = [
    { key: 'niche1', label: 'Niche 1', placeholder: 'z. B. Gardening', icon: <Tag className="w-3.5 h-3.5 text-primary-400" /> },
    { key: 'niche2', label: 'Cross-Nische', placeholder: 'z. B. Cats', icon: <Tag className="w-3.5 h-3.5 text-accent-cyan" /> },
    { key: 'subniche', label: 'Subnische', placeholder: 'z. B. Vegetable Gardening', icon: <Tag className="w-3.5 h-3.5 text-emerald-400" /> },
    { key: 'quote', label: 'Quote', placeholder: 'z. B. Easily Distracted by Plants', icon: <Type className="w-3.5 h-3.5 text-accent-amber" /> },
    { key: 'style', label: 'Style', placeholder: 'Leer lassen, damit D2 den Stil auswählt', icon: <Wand2 className="w-3.5 h-3.5 text-fuchsia-400" /> }
  ];

  const pendingCount = generatedConcepts.filter(c => !c.started).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
          <Sparkles className="w-6 h-6 mr-2 text-primary-400" />
          Designer
        </h2>
      </div>

      {/* Global Image Provider & Prompt-Pool Bar */}
      <div className="glass-card p-5 rounded-2xl border border-primary-500/30 bg-gradient-to-r from-primary-950/30 via-slate-950/80 to-emerald-950/20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['IDEOGRAM', 'IDEOGRAM_V4', 'GPT_IMAGE_2'] as ImageProvider[]).map(provider => (
            <button
              key={provider}
              type="button"
              onClick={() => setImageProvider(provider)}
              aria-pressed={imageProvider === provider}
              className={`rounded-xl border px-4 py-3 text-left transition-all ${
                imageProvider === provider
                  ? 'border-primary-400/70 bg-primary-500/20 shadow-sm shadow-primary-500/10'
                  : 'border-slate-700 bg-slate-900/70 hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-bold text-slate-100">{providerLabels[provider]}</div>
              <div className="text-[10px] text-slate-400 mt-1">
                {provider === imageProvider
                  ? effectiveSettings
                  : provider === 'GPT_IMAGE_2'
                  ? 'via OpenRouter'
                  : provider === 'IDEOGRAM_V4'
                  ? 'Ideogram V4 API'
                  : 'Ideogram API'}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setPromptPoolEnabled(false); saveDesignerSetting({ designerPromptPoolEnabled: false }); }}
            aria-pressed={!promptPoolEnabled}
            className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
              !promptPoolEnabled
                ? 'border-sky-400/60 bg-sky-500/15 text-sky-200'
                : 'border-slate-800 text-slate-400 hover:text-slate-300'
            }`}
          >
            Standard D2
          </button>
          <button
            type="button"
            onClick={() => { setPromptPoolEnabled(true); saveDesignerSetting({ designerPromptPoolEnabled: true }); }}
            aria-pressed={promptPoolEnabled}
            className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
              promptPoolEnabled
                ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-200'
                : 'border-slate-800 text-slate-400 hover:text-slate-300'
            }`}
          >
            D2 + Prompt-Pool
          </button>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex border-b border-slate-800 space-x-1">
        <button
          type="button"
          onClick={() => setActiveTab('CONCEPTS')}
          className={`px-5 py-2.5 text-sm font-bold rounded-t-xl border-t border-x transition-all flex items-center gap-2 ${
            activeTab === 'CONCEPTS'
              ? 'bg-slate-900/90 text-primary-300 border-slate-700/80 border-b-transparent shadow-sm'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Sparkles className="w-4 h-4 text-primary-400" />
          KI-Konzepte & Zufall
          {generatedConcepts.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-primary-500/20 text-primary-300 border border-primary-500/30">
              {generatedConcepts.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('MANUAL')}
          className={`px-5 py-2.5 text-sm font-bold rounded-t-xl border-t border-x transition-all flex items-center gap-2 ${
            activeTab === 'MANUAL'
              ? 'bg-slate-900/90 text-primary-300 border-slate-700/80 border-b-transparent shadow-sm'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/40'
          }`}
        >
          <Layers className="w-4 h-4 text-slate-400" />
          Manuelle Einzelfelder
        </button>
      </div>

      {/* TAB 1: KI-Konzepte & Zufall */}
      {activeTab === 'CONCEPTS' && (
        <div className="space-y-6">
          <div className="glass-card p-5 rounded-2xl space-y-4 border border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Ideen & Wünsche in natürlicher Sprache
              </label>
              <textarea
                rows={3}
                value={conceptPrompt}
                onChange={e => setConceptPrompt(e.target.value)}
                placeholder="z. B. Ich hätte gerne zwei Designs aus der Pferde-Nische zu zwei unterschiedlichen Rassen oder 3 Handwerker-Designs mit witzigen Sprüchen..."
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-y"
              />
            </div>

            {conceptError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                {conceptError}
              </div>
            )}

            {batchSuccessMessage && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{batchSuccessMessage}</span>
                </div>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('tasks')}
                    className="text-xs font-bold text-emerald-200 flex items-center shrink-0 hover:underline"
                  >
                    Zu Tasks & Review <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="pt-1 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => handleGenerateConcepts({ prompt: conceptPrompt })}
                disabled={isGeneratingConcepts || !conceptPrompt.trim()}
                className="flex-1 min-w-[200px] py-3 px-4 rounded-xl text-sm font-bold bg-gradient-to-r from-primary-600 to-accent-cyan text-white shadow-lg shadow-primary-500/25 disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
              >
                {isGeneratingConcepts ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isGeneratingConcepts ? 'Konzepte werden generiert …' : 'Konzepte generieren'}
              </button>

              <button
                type="button"
                onClick={() => handleGenerateConcepts({ random: true, count: 1 })}
                disabled={isGeneratingConcepts}
                title="Erzeugt 1 zufälliges, verkaufsstarkes Evergreen-Konzept"
                className="py-3 px-4 rounded-xl border border-slate-700 bg-slate-900/80 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                <Dices className="w-4 h-4 text-emerald-400" />
                1 Zufallskonzept
              </button>

              <button
                type="button"
                onClick={() => handleGenerateConcepts({ random: true, count: 3 })}
                disabled={isGeneratingConcepts}
                title="Erzeugt 3 unterschiedliche, verkaufsstarke Evergreen-Konzepte"
                className="py-3 px-4 rounded-xl border border-slate-700 bg-slate-900/80 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                <Dices className="w-4 h-4 text-fuchsia-400" />
                3 Zufallskonzepte
              </button>
            </div>
          </div>

          {/* Generated Concepts Preview List */}
          {generatedConcepts.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <span>Vorgeschlagene Konzepte ({generatedConcepts.length})</span>
                  <span className="text-xs text-slate-500 font-normal">
                    (Felder vor dem Start frei editierbar)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setGeneratedConcepts([])}
                    className="text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 hover:border-rose-900/50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Alle verwerfen
                  </button>
                  {pendingCount > 0 && (
                    <button
                      type="button"
                      onClick={startAllPendingConcepts}
                      disabled={isBatchStarting || Boolean(startingSingleId)}
                      className="text-xs font-bold bg-primary-600 hover:bg-primary-500 text-white px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md shadow-primary-600/20 disabled:opacity-50"
                    >
                      {isBatchStarting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Alle {pendingCount} Tasks starten
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {generatedConcepts.map((concept, idx) => (
                  <div
                    key={concept.id}
                    className={`glass-card p-4 rounded-xl border transition-all ${
                      concept.started
                        ? 'border-emerald-500/40 bg-emerald-950/10'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-300">
                          #{idx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-primary-500/15 text-primary-300 border border-primary-500/30">
                          {concept.niche1 || 'Keine Nische'}
                        </span>
                        {concept.subniche && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            Sub: {concept.subniche}
                          </span>
                        )}
                        {concept.niche2 && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                            Cross: {concept.niche2}
                          </span>
                        )}
                        {concept.started && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Task {concept.taskId || 'aktiv'}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeConcept(concept.id)}
                        disabled={concept.started}
                        title="Konzept verwerfen"
                        className="text-slate-500 hover:text-rose-400 p-1 rounded-lg hover:bg-slate-800/80 disabled:opacity-20"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Niche 1 *</label>
                        <input
                          type="text"
                          value={concept.niche1}
                          disabled={concept.started}
                          onChange={e => updateConceptField(concept.id, 'niche1', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Subnische (optional)</label>
                        <input
                          type="text"
                          value={concept.subniche || ''}
                          disabled={concept.started}
                          placeholder="leer = keine"
                          onChange={e => updateConceptField(concept.id, 'subniche', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Cross-Nische (optional)</label>
                        <input
                          type="text"
                          value={concept.niche2 || ''}
                          disabled={concept.started}
                          placeholder="leer = keine"
                          onChange={e => updateConceptField(concept.id, 'niche2', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">Style (optional)</label>
                        <input
                          type="text"
                          value={concept.style || ''}
                          disabled={concept.started}
                          placeholder="leer = D2 Auto-Style"
                          onChange={e => updateConceptField(concept.id, 'style', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-1">Quote / Spruch *</label>
                      <input
                        type="text"
                        value={concept.quote}
                        disabled={concept.started}
                        onChange={e => updateConceptField(concept.id, 'quote', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 disabled:opacity-60"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                      <div className="text-[11px] text-slate-500">
                        {concept.started ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Task {concept.taskId} in Bearbeitung
                          </span>
                        ) : (
                          `Wird gestartet mit ${providerLabels[imageProvider]}`
                        )}
                      </div>
                      {!concept.started ? (
                        <button
                          type="button"
                          onClick={() => startSingleConceptTask(concept)}
                          disabled={Boolean(startingSingleId) || isBatchStarting || !concept.niche1.trim()}
                          className="py-1.5 px-3 rounded-lg text-xs font-bold bg-primary-600/90 hover:bg-primary-500 text-white flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          {startingSingleId === concept.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          Diesen Task starten
                        </button>
                      ) : (
                        onNavigateTab && (
                          <button
                            type="button"
                            onClick={() => onNavigateTab('tasks')}
                            className="text-xs font-bold text-emerald-300 hover:underline flex items-center"
                          >
                            Zu Tasks <ChevronRight className="w-3 h-3" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {pendingCount > 1 && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={startAllPendingConcepts}
                    disabled={isBatchStarting || Boolean(startingSingleId)}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-primary-600 to-accent-cyan text-white shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-50"
                  >
                    {isBatchStarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Alle {pendingCount} verbliebenen Tasks starten
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Manuelle Einzelfelder (Bestehendes Formular) */}
      {activeTab === 'MANUAL' && (
        <div className="glass-card p-5 rounded-2xl space-y-4 border border-slate-800">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              LLM-Modell für schnelle Vorschläge
            </label>
            <button
              type="button"
              onClick={openCurrentModelMenu}
              disabled={modelsLoading}
              aria-expanded={modelMenuOpen}
              aria-haspopup="listbox"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500 text-left flex items-center justify-between disabled:opacity-60"
            >
              <span>
                {modelsLoading
                  ? 'Aktuelle Modellliste wird geladen …'
                  : suggestionModel || `Grundmodell (${providerSettings.llmModel || 'nicht geladen'})`}
              </span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${modelMenuOpen ? 'rotate-90' : ''}`} />
            </button>
            {modelMenuOpen && (
              <div
                role="listbox"
                className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-xl"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!suggestionModel}
                  onClick={() => chooseSuggestionModel('')}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800"
                >
                  Grundmodell ({providerSettings.llmModel || 'nicht geladen'})
                </button>
                {modelOptions.map(model => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={suggestionModel === model.id}
                    key={model.id}
                    onClick={() => chooseSuggestionModel(model.id)}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <span className="block font-medium">{model.name || model.id}</span>
                    <span className="block text-[10px] text-slate-500">{model.id}</span>
                  </button>
                ))}
              </div>
            )}
            {modelsError && <p className="mt-1 text-xs text-rose-400">{modelsError}</p>}
          </div>

          {manualFields.map(field => (
            <div key={field.key}>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                {field.icon}
                {field.label}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={values[field.key]}
                  onChange={event => updateValue(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="min-w-0 flex-1 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  type="button"
                  onClick={() => handleSuggest(field.key)}
                  disabled={Boolean(loadingField) || (field.key !== 'niche1' && !values.niche1.trim())}
                  title={`${field.label} per KI vorschlagen`}
                  aria-label={`${field.label} per KI vorschlagen`}
                  className="w-11 shrink-0 rounded-xl border border-primary-500/30 bg-primary-600/15 text-primary-300 hover:bg-primary-600/30 disabled:opacity-40 flex items-center justify-center"
                >
                  {loadingField === field.key ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                </button>
              </div>
              {field.key === 'style' && (
                <select
                  value=""
                  onChange={event => { if (event.target.value) updateValue('style', event.target.value); }}
                  className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-slate-400 focus:outline-none focus:border-primary-500"
                >
                  <option value="">Optional: Style-Preset übernehmen …</option>
                  {STYLE_PRESETS.map(style => (
                    <option key={style} value={style}>{style}</option>
                  ))}
                </select>
              )}
              {fieldErrors[field.key] && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors[field.key]}</p>
              )}
            </div>
          ))}

          {formError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {formError}
            </div>
          )}

          {createdTaskId && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="w-4 h-4" />
                <span>Task <strong>{createdTaskId}</strong> wurde angelegt.</span>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('tasks')}
                  className="text-xs font-bold text-emerald-200 flex items-center hover:underline"
                >
                  Zu Tasks <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={isGenerating || Boolean(loadingField)}
              className="sm:w-36 py-3 rounded-xl border border-slate-700 text-sm font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Eraser className="w-4 h-4" />
              Leeren
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || Boolean(loadingField) || !values.niche1.trim()}
              className="flex-1 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-primary-600 to-accent-cyan text-white shadow-lg shadow-primary-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isGenerating ? 'Task wird angelegt …' : `Design mit ${providerLabels[imageProvider]}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

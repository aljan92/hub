import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Eraser, RefreshCw, Send, Sparkles, Tag, Type, Wand2 } from 'lucide-react';
import type { ActiveTab } from '../components/Sidebar';

type ImageProvider = 'IDEOGRAM' | 'GPT_IMAGE_2';
type SuggestionField = 'niche1' | 'niche2' | 'subniche' | 'quote' | 'style';
type FormValues = Record<SuggestionField, string>;
type SuggestionHistory = Record<SuggestionField, string[]>;
type ModelItem = { id: string; name?: string };

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
  const [values, setValues] = useState<FormValues>({ niche1: '', niche2: '', subniche: '', quote: '', style: '' });
  const [imageProvider, setImageProvider] = useState<ImageProvider>('IDEOGRAM');
  const [promptPoolEnabled, setPromptPoolEnabled] = useState(false);
  const [providerSettings, setProviderSettings] = useState<any>({});
  const [models, setModels] = useState<ModelItem[]>([]);
  const [suggestionModel, setSuggestionModel] = useState('');
  const [loadingField, setLoadingField] = useState<SuggestionField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SuggestionField, string>>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdTaskId, setCreatedTaskId] = useState('');
  const providerSettingsLoaded = useRef(false);
  const generationInFlight = useRef(false);
  const historyRef = useRef<SuggestionHistory>(readHistory());

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/settings').then(res => res.json()),
      fetch('/api/v1/llm/models').then(res => res.json()).catch(() => ({ success: false }))
    ]).then(([settingsData, modelData]) => {
      if (settingsData.success) {
        const settings = settingsData.settings || {};
        setProviderSettings(settings);
        setPromptPoolEnabled(Boolean(settings.designerPromptPoolEnabled));
        setImageProvider(settings.designerImageProvider === 'GPT_IMAGE_2' ? 'GPT_IMAGE_2' : 'IDEOGRAM');
        setSuggestionModel(settings.designerSuggestionModel || '');
        providerSettingsLoaded.current = true;
      }
      if (modelData.success && Array.isArray(modelData.models)) setModels(modelData.models);
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

  const modelOptions = useMemo(() => {
    const unique = new Map<string, ModelItem>();
    models.forEach(model => { if (model?.id) unique.set(model.id, model); });
    if (suggestionModel && !unique.has(suggestionModel)) unique.set(suggestionModel, { id: suggestionModel, name: suggestionModel });
    return Array.from(unique.values());
  }, [models, suggestionModel]);

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
    : `${providerSettings.ideogramModel || 'V_3'} · ${providerSettings.ideogramAspectRatio || '10x16'} · Magic Prompt ${providerSettings.ideogramMagicPromptOption || 'AUTO'}`;
  const fields: Array<{ key: SuggestionField; label: string; placeholder: string; icon: React.ReactNode }> = [
    { key: 'niche1', label: 'Niche 1', placeholder: 'z. B. Gardening', icon: <Tag className="w-3.5 h-3.5 text-primary-400" /> },
    { key: 'niche2', label: 'Cross-Nische', placeholder: 'z. B. Cats', icon: <Tag className="w-3.5 h-3.5 text-accent-cyan" /> },
    { key: 'subniche', label: 'Subnische', placeholder: 'z. B. Vegetable Gardening', icon: <Tag className="w-3.5 h-3.5 text-emerald-400" /> },
    { key: 'quote', label: 'Quote', placeholder: 'z. B. Easily Distracted by Plants', icon: <Type className="w-3.5 h-3.5 text-accent-amber" /> },
    { key: 'style', label: 'Style', placeholder: 'Leer lassen, damit D2 den Stil auswählt', icon: <Wand2 className="w-3.5 h-3.5 text-fuchsia-400" /> }
  ];

  return <div className="space-y-6 max-w-5xl mx-auto">
    <div>
      <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center"><Sparkles className="w-6 h-6 mr-2 text-primary-400" />Designer</h2>
      <p className="text-sm text-slate-400 mt-1">Ideen schnell durchwechseln und als normale D2-Design-Task starten.</p>
    </div>

    <div className="glass-card p-5 rounded-2xl border border-primary-500/30 bg-gradient-to-r from-primary-950/30 via-slate-950/80 to-emerald-950/20">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(['IDEOGRAM', 'GPT_IMAGE_2'] as ImageProvider[]).map(provider => <button key={provider} type="button" onClick={() => setImageProvider(provider)} aria-pressed={imageProvider === provider}
          className={`rounded-xl border px-4 py-3 text-left transition-all ${imageProvider === provider ? 'border-primary-400/70 bg-primary-500/20' : 'border-slate-700 bg-slate-900/70 hover:border-slate-600'}`}>
          <div className="text-sm font-bold text-slate-100">{provider === 'GPT_IMAGE_2' ? 'GPT Image 2' : 'Ideogram 3.0'}</div>
          <div className="text-[10px] text-slate-400 mt-1">{provider === imageProvider ? effectiveSettings : provider === 'GPT_IMAGE_2' ? 'via OpenRouter' : 'Ideogram API'}</div>
        </button>)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setPromptPoolEnabled(false); saveDesignerSetting({ designerPromptPoolEnabled: false }); }} aria-pressed={!promptPoolEnabled}
          className={`rounded-lg border px-3 py-2 text-xs font-bold ${!promptPoolEnabled ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-slate-800 text-slate-400'}`}>Standard D2</button>
        <button type="button" onClick={() => { setPromptPoolEnabled(true); saveDesignerSetting({ designerPromptPoolEnabled: true }); }} aria-pressed={promptPoolEnabled}
          className={`rounded-lg border px-3 py-2 text-xs font-bold ${promptPoolEnabled ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-200' : 'border-slate-800 text-slate-400'}`}>D2 + Prompt-Pool</button>
      </div>
    </div>

    <div className="glass-card p-5 rounded-2xl space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1.5">LLM-Modell für schnelle Vorschläge</label>
        <select value={suggestionModel} onChange={event => { const value = event.target.value; setSuggestionModel(value); saveDesignerSetting({ designerSuggestionModel: value }); }}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500">
          <option value="">Grundmodell als Fallback ({providerSettings.llmModel || 'nicht geladen'})</option>
          {modelOptions.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
        </select>
      </div>

      {fields.map(field => <div key={field.key}>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">{field.icon}{field.label}</label>
        <div className="flex gap-2">
          <input type="text" value={values[field.key]} onChange={event => updateValue(field.key, event.target.value)} placeholder={field.placeholder}
            className="min-w-0 flex-1 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500" />
          <button type="button" onClick={() => handleSuggest(field.key)} disabled={Boolean(loadingField) || (field.key !== 'niche1' && !values.niche1.trim())}
            title={`${field.label} per KI vorschlagen`} aria-label={`${field.label} per KI vorschlagen`}
            className="w-11 shrink-0 rounded-xl border border-primary-500/30 bg-primary-600/15 text-primary-300 hover:bg-primary-600/30 disabled:opacity-40 flex items-center justify-center">
            {loadingField === field.key ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          </button>
        </div>
        {field.key === 'style' && <select value="" onChange={event => { if (event.target.value) updateValue('style', event.target.value); }}
          className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-slate-400 focus:outline-none focus:border-primary-500">
          <option value="">Optional: Style-Preset übernehmen …</option>
          {STYLE_PRESETS.map(style => <option key={style} value={style}>{style}</option>)}
        </select>}
        {fieldErrors[field.key] && <p className="mt-1 text-xs text-rose-400">{fieldErrors[field.key]}</p>}
      </div>)}

      {formError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</div>}
      {createdTaskId && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="w-4 h-4" /><span>Task <strong>{createdTaskId}</strong> wurde angelegt.</span></div>
        {onNavigateTab && <button type="button" onClick={() => onNavigateTab('tasks')} className="text-xs font-bold text-emerald-200 flex items-center">Zu Tasks <ChevronRight className="w-3.5 h-3.5" /></button>}
      </div>}

      <div className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
        <button type="button" onClick={handleReset} disabled={isGenerating || Boolean(loadingField)}
          className="sm:w-36 py-3 rounded-xl border border-slate-700 text-sm font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"><Eraser className="w-4 h-4" />Leeren</button>
        <button type="button" onClick={handleGenerate} disabled={isGenerating || Boolean(loadingField) || !values.niche1.trim()}
          className="flex-1 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-primary-600 to-accent-cyan text-white shadow-lg shadow-primary-500/25 disabled:opacity-50 flex items-center justify-center gap-2">
          {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{isGenerating ? 'Task wird angelegt …' : `Design mit ${imageProvider === 'GPT_IMAGE_2' ? 'GPT Image 2' : 'Ideogram 3.0'}`}
        </button>
      </div>
    </div>
  </div>;
};

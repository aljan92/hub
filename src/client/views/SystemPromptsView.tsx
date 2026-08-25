import React, { useState, useEffect, useRef } from 'react';
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
  Tag
} from 'lucide-react';

export const SystemPromptsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'promptGenerator' | 'designAnalyzer' | 'listingGenerator'>('promptGenerator');
  
  const [promptGeneratorText, setPromptGeneratorText] = useState<string>('');
  const [designAnalyzerText, setDesignAnalyzerText] = useState<string>('');
  const [listingGeneratorText, setListingGeneratorText] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedStatus, setSavedStatus] = useState<'SAVED' | 'SAVING' | 'IDLE'>('IDLE');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const stateRef = useRef({ 
    promptGenerator: promptGeneratorText, 
    designAnalyzer: designAnalyzerText,
    listingGenerator: listingGeneratorText 
  });
  stateRef.current = { 
    promptGenerator: promptGeneratorText, 
    designAnalyzer: designAnalyzerText,
    listingGenerator: listingGeneratorText 
  };

  // 1. Load active system prompts from server
  useEffect(() => {
    fetch('/api/v1/systemprompts')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          if (typeof data.promptGenerator === 'string') setPromptGeneratorText(data.promptGenerator);
          if (typeof data.designAnalyzer === 'string') setDesignAnalyzerText(data.designAnalyzer);
          if (typeof data.listingGenerator === 'string') setListingGeneratorText(data.listingGenerator);
        }
      })
      .catch(err => console.error('Failed to load system prompts:', err))
      .finally(() => setLoading(false));

    // Auto-save on component unmount (when leaving menu)
    return () => {
      const payload = stateRef.current;
      if (payload.promptGenerator.trim() || payload.designAnalyzer.trim() || payload.listingGenerator.trim()) {
        fetch('/api/v1/systemprompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(() => {});
      }
    };
  }, []);

  // 2. Save function
  const handleSave = async (overrides?: { promptGenerator?: string; designAnalyzer?: string; listingGenerator?: string }) => {
    const payload = {
      promptGenerator: overrides?.promptGenerator !== undefined ? overrides.promptGenerator : promptGeneratorText,
      designAnalyzer: overrides?.designAnalyzer !== undefined ? overrides.designAnalyzer : designAnalyzerText,
      listingGenerator: overrides?.listingGenerator !== undefined ? overrides.listingGenerator : listingGeneratorText,
    };

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

  // 3. Reset to default
  const handleReset = async () => {
    const label = activeTab === 'promptGenerator' 
      ? 'den Prompt Generator Prompt' 
      : activeTab === 'designAnalyzer'
      ? 'den Design-Analyse Prompt'
      : 'den Listing Generator Prompt';
    if (!confirm(`Möchtest du ${label} wirklich auf die Standardvorlage zurücksetzen?`)) return;
    
    setSaving(true);
    try {
      const res = await fetch('/api/v1/systemprompts/reset', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: activeTab })
      });
      const data = await res.json();
      if (data.success) {
        if (activeTab === 'promptGenerator' && data.promptGenerator) {
          setPromptGeneratorText(data.promptGenerator);
        } else if (activeTab === 'designAnalyzer' && data.designAnalyzer) {
          setDesignAnalyzerText(data.designAnalyzer);
        } else if (activeTab === 'listingGenerator' && data.listingGenerator) {
          setListingGeneratorText(data.listingGenerator);
        }
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      alert('Fehler beim Zurücksetzen');
    } finally {
      setSaving(false);
    }
  };

  const currentText = activeTab === 'promptGenerator' 
    ? promptGeneratorText 
    : activeTab === 'designAnalyzer'
    ? designAnalyzerText
    : listingGeneratorText;

  const setCurrentText = (val: string) => {
    if (activeTab === 'promptGenerator') {
      setPromptGeneratorText(val);
    } else if (activeTab === 'designAnalyzer') {
      setDesignAnalyzerText(val);
    } else {
      setListingGeneratorText(val);
    }
    setSavedStatus('IDLE');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-accent-cyan" />
            Systemprompts &amp; Art Director
          </h2>
          <p className="text-sm text-slate-400">
            Verwalte die System-Prompts für Prompt-Erstellung, Design-Analyse und automatische MBA-Listing-Generierung.
          </p>
        </div>

        {/* Action Controls & Save Status */}
        <div className="flex items-center space-x-3">
          {savedStatus === 'SAVED' && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-fadeIn">
              <Check className="w-3.5 h-3.5" />
              <span>Gespeichert ✓ {lastSavedTime ? `(${lastSavedTime})` : ''}</span>
            </div>
          )}
          {savedStatus === 'SAVING' && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
              <Clock className="w-3.5 h-3.5" />
              <span>Speichert...</span>
            </div>
          )}

          <button
            onClick={handleReset}
            disabled={saving || loading}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Auf Standard</span>
          </button>

          <button
            onClick={() => handleSave()}
            disabled={saving || loading}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-accent-cyan text-slate-950 hover:bg-cyan-300 transition-all shadow-lg shadow-accent-cyan/10 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Speichert...' : 'Jetzt Speichern'}</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-800 space-x-2 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab('promptGenerator')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'promptGenerator'
              ? 'border-purple-400 text-purple-300 bg-slate-900/60 rounded-t-xl'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20 rounded-t-xl'
          }`}
        >
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>1. Prompt Generator (Ideogram)</span>
        </button>

        <button
          onClick={() => setActiveTab('designAnalyzer')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'designAnalyzer'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900/60 rounded-t-xl'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20 rounded-t-xl'
          }`}
        >
          <Eye className="w-4 h-4 text-cyan-400" />
          <span>2. Design-Analyse &amp; Questions (Vision QA)</span>
        </button>

        <button
          onClick={() => setActiveTab('listingGenerator')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'listingGenerator'
              ? 'border-emerald-400 text-emerald-300 bg-slate-900/60 rounded-t-xl'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20 rounded-t-xl'
          }`}
        >
          <FileText className="w-4 h-4 text-emerald-400" />
          <span>3. Listing Generator (MBA SEO)</span>
        </button>
      </div>

      {/* Big Prompt Editor Textarea */}
      <div className="glass-card p-5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {activeTab === 'promptGenerator' && (
              <>
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-slate-200">Prompt Generator (System-Prompt)</h3>
              </>
            )}
            {activeTab === 'designAnalyzer' && (
              <>
                <Eye className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-200">Design-Analyse &amp; Fragen (Vision System-Prompt)</h3>
              </>
            )}
            {activeTab === 'listingGenerator' && (
              <>
                <FileText className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">Listing Generator (MBA SEO Copywriting System-Prompt)</h3>
              </>
            )}
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {currentText.length} Zeichen • {currentText.split(/\s+/).filter(Boolean).length} Wörter
          </span>
        </div>

        <div className="relative">
          <textarea
            value={currentText}
            onChange={e => setCurrentText(e.target.value)}
            onBlur={() => handleSave()}
            disabled={loading}
            rows={18}
            placeholder={
              activeTab === 'promptGenerator'
                ? 'Schreibe oder füge hier deinen System-Prompt für die Ideogram-Prompt-Erstellung ein...'
                : activeTab === 'designAnalyzer'
                ? 'Schreibe oder füge hier deinen System-Prompt für die Vision-Designanalyse und Fragen ein...'
                : 'Schreibe oder füge hier deinen System-Prompt für das Merch by Amazon SEO Listing ein...'
            }
            className="w-full bg-slate-950 text-slate-100 font-mono text-xs sm:text-sm leading-relaxed p-4 rounded-xl border border-slate-800 focus:outline-none focus:border-accent-cyan/80 focus:ring-1 focus:ring-accent-cyan/50 transition-all custom-scrollbar resize-y"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <span>
            {activeTab === 'promptGenerator' 
              ? 'Wird an OpenRouter übergeben, um das Hermes/Playground JSON in einen Ideogram-Prompt umzuwandeln.'
              : activeTab === 'designAnalyzer'
              ? 'Wird zusammen mit dem generierten Ideogram-Bild an OpenRouter übergeben, um Quote, Zielgruppe, Farben & Hintergrund zu analysieren.'
              : 'Wird nach erfolgreicher Design-Analyse (APPROVED) automatisch in derselben Session ausgeführt, um das mehrsprachige MBA-Listing zu erstellen.'}
          </span>
          <span className="text-slate-400 font-semibold">Tastenkürzel: Klick außerhalb / Tab-Wechsel = Auto-Save</span>
        </div>
      </div>
    </div>
  );
};

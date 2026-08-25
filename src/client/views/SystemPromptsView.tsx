import React, { useState, useEffect, useRef } from 'react';
import { 
  Sliders, 
  Save, 
  RotateCcw, 
  Check, 
  Sparkles, 
  Info, 
  Code2, 
  FileText,
  Clock
} from 'lucide-react';

export const SystemPromptsView: React.FC = () => {
  const [promptText, setPromptText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedStatus, setSavedStatus] = useState<'SAVED' | 'SAVING' | 'IDLE'>('IDLE');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const promptRef = useRef(promptText);
  promptRef.current = promptText;

  // 1. Load active system prompt from server
  useEffect(() => {
    fetch('/api/v1/systemprompts')
      .then(res => res.json())
      .then(data => {
        if (data.success && typeof data.promptGenerator === 'string') {
          setPromptText(data.promptGenerator);
        }
      })
      .catch(err => console.error('Failed to load system prompts:', err))
      .finally(() => setLoading(false));

    // Auto-save on component unmount (when leaving menu)
    return () => {
      if (promptRef.current.trim()) {
        fetch('/api/v1/systemprompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ promptGenerator: promptRef.current }),
          keepalive: true
        }).catch(() => {});
      }
    };
  }, []);

  // 2. Save function
  const handleSave = async (textToSave?: string) => {
    const text = textToSave !== undefined ? textToSave : promptText;
    setSaving(true);
    setSavedStatus('SAVING');
    try {
      const res = await fetch('/api/v1/systemprompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptGenerator: text })
      });
      const data = await res.json();
      if (data.success) {
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
        setTimeout(() => setSavedStatus('IDLE'), 3000);
      }
    } catch (err) {
      console.error('Failed to save system prompt:', err);
    } finally {
      setSaving(false);
    }
  };

  // 3. Reset to default
  const handleReset = async () => {
    if (!confirm('Möchtest du den System-Prompt wirklich auf die Standardvorlage zurücksetzen?')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/systemprompts/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.promptGenerator) {
        setPromptText(data.promptGenerator);
        setSavedStatus('SAVED');
        setLastSavedTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      alert('Fehler beim Zurücksetzen');
    } finally {
      setSaving(false);
    }
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
            Passe den System-Prompt für die automatische Ideogram-Prompt-Erstellung an. Wird beim Verlassen automatisch gespeichert.
          </p>
        </div>

        {/* Action Controls & Save Status */}
        <div className="flex items-center space-x-3">
          {savedStatus === 'SAVED' && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-fadeIn">
              <Check className="w-3.5 h-3.5" />
              <span>Automatisch gespeichert ✓ {lastSavedTime ? `(${lastSavedTime})` : ''}</span>
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
            <span>Auf Standard zurücksetzen</span>
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

      {/* Info Callout */}
      <div className="glass-card p-4 rounded-2xl border border-accent-cyan/20 bg-slate-900/60 flex items-start space-x-3">
        <div className="p-2 rounded-xl bg-accent-cyan/10 text-accent-cyan shrink-0 mt-0.5">
          <Info className="w-4 h-4" />
        </div>
        <div className="text-xs text-slate-300 space-y-1">
          <p className="font-semibold text-slate-100">
            Automatische Input-Übergabe an OpenRouter:
          </p>
          <p className="text-slate-400">
            Bei jedem eingehenden Task (egal ob von Hermes, dem Playground oder Designer) wird dieser System-Prompt als <code className="text-accent-cyan bg-slate-950 px-1.5 py-0.5 rounded">system</code>-Rolle an OpenRouter geschickt. Als <code className="text-accent-cyan bg-slate-950 px-1.5 py-0.5 rounded">user</code>-Nachricht wird automatisch angehängt:
          </p>
          <pre className="mt-1.5 p-2 bg-slate-950 rounded-lg text-emerald-400 font-mono text-[11px] border border-slate-800">
{`Input:
{
  "niche1": "Angel Numbers",
  "quote": "111 Manifest Your Reality",
  ...
}`}
          </pre>
        </div>
      </div>

      {/* Big Prompt Editor Textarea */}
      <div className="glass-card p-5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-slate-200">Prompt Generator (System-Prompt)</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {promptText.length} Zeichen • {promptText.split(/\s+/).filter(Boolean).length} Wörter
          </span>
        </div>

        <div className="relative">
          <textarea
            value={promptText}
            onChange={e => {
              setPromptText(e.target.value);
              setSavedStatus('IDLE');
            }}
            onBlur={() => handleSave()}
            disabled={loading}
            rows={18}
            placeholder="Schreibe oder füge hier deinen System-Prompt ein..."
            className="w-full bg-slate-950 text-slate-100 font-mono text-xs sm:text-sm leading-relaxed p-4 rounded-xl border border-slate-800 focus:outline-none focus:border-accent-cyan/80 focus:ring-1 focus:ring-accent-cyan/50 transition-all custom-scrollbar resize-y"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <span>Tipp: Der Text wird beim Verlassen der Seite oder Klick außerhalb des Textfelds automatisch gespeichert.</span>
          <span className="text-slate-400 font-semibold">Tastenkürzel: Klick außerhalb = Auto-Save</span>
        </div>
      </div>
    </div>
  );
};

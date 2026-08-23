import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Key, 
  Server, 
  Sliders, 
  Save, 
  CheckCircle2,
  Database,
  Cpu,
  Image as ImageIcon,
  Sparkles,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Search
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { testing?: boolean; success?: boolean; latencyMs?: number; error?: string }>>({});

  // Settings State
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [llmProvider, setLlmProvider] = useState<'openrouter' | 'openai'>('openrouter');
  const [llmModel, setLlmModel] = useState('anthropic/claude-3.5-sonnet');
  const [ideogramApiKey, setIdeogramApiKey] = useState('');
  const [ideogramModel, setIdeogramModel] = useState('V_2_TURBO');
  const [vectorizerApiKey, setVectorizerApiKey] = useState('');
  const [vectorizerApiSecret, setVectorizerApiSecret] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState('');
  const [nasHost, setNasHost] = useState('192.168.178.141');
  const [nasUser, setNasUser] = useState('aljan92');
  const [autoSlotFillHour, setAutoSlotFillHour] = useState(4);

  // Load existing settings on mount
  useEffect(() => {
    fetch('/api/v1/settings')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          const s = data.settings;
          setOpenRouterApiKey(s.openRouterApiKey || '');
          setLlmProvider(s.llmProvider || 'openrouter');
          setLlmModel(s.llmModel || 'anthropic/claude-3.5-sonnet');
          setIdeogramApiKey(s.ideogramApiKey || '');
          setIdeogramModel(s.ideogramModel || 'V_2_TURBO');
          setVectorizerApiKey(s.vectorizerApiKey || '');
          setVectorizerApiSecret(s.vectorizerApiSecret || '');
          setSupabaseUrl(s.supabaseUrl || '');
          setSupabaseServiceRoleKey(s.supabaseServiceRoleKey || '');
          setNasHost(s.nasHost || '192.168.178.141');
          setNasUser(s.nasUser || 'aljan92');
          setAutoSlotFillHour(s.autoSlotFillHour || 4);
        }
      })
      .catch(err => console.warn('[Settings] Failed to fetch settings:', err));
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        openRouterApiKey,
        llmProvider,
        llmModel,
        ideogramApiKey,
        ideogramModel,
        vectorizerApiKey,
        vectorizerApiSecret,
        supabaseUrl,
        supabaseServiceRoleKey,
        nasHost,
        nasUser,
        autoSlotFillHour: Number(autoSlotFillHour),
      };

      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      alert('Fehler beim Speichern der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  const runTest = async (connector: string, credentials: any) => {
    setTestResults(prev => ({ ...prev, [connector]: { testing: true } }));
    try {
      const res = await fetch('/api/v1/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector, credentials }),
      });
      const data = await res.json();
      setTestResults(prev => ({
        ...prev,
        [connector]: {
          testing: false,
          success: data.success,
          latencyMs: data.latencyMs,
          error: data.error,
        }
      }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [connector]: {
          testing: false,
          success: false,
          error: err.message || 'Netzwerkfehler',
        }
      }));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <SettingsIcon className="w-6 h-6 mr-2 text-primary-400" />
            Einstellungen &amp; API-Schlüssel
          </h2>
          <p className="text-sm text-slate-400">Verwalte Konnektoren, teste deine API-Keys live und konfiguriere Automationsregeln.</p>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="px-6 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-primary-600 to-accent-cyan hover:from-primary-500 hover:to-accent-cyan/90 text-white shadow-lg shadow-primary-500/20 flex items-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
        >
          {saved ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'Erfolgreich gespeichert!' : 'Einstellungen speichern'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. LLM & Vision (OpenRouter / OpenAI) */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Cpu className="w-4 h-4 mr-2 text-accent-cyan" />
              LLM Vision &amp; Listing Generator
            </h3>
            <button
              onClick={() => runTest('openrouter', { apiKey: openRouterApiKey, model: llmModel })}
              disabled={testResults['openrouter']?.testing || !openRouterApiKey}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['openrouter']?.testing ? 'animate-spin text-accent-cyan' : ''}`} />
              <span>Verbindung testen</span>
            </button>
          </div>

          {testResults['openrouter'] && !testResults['openrouter'].testing && (
            <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between border ${
              testResults['openrouter'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <span className="flex items-center">
                {testResults['openrouter'].success ? <ShieldCheck className="w-4 h-4 mr-1.5" /> : <ShieldAlert className="w-4 h-4 mr-1.5" />}
                {testResults['openrouter'].success ? 'LLM API erreichbar & Modell aktiv ✓' : testResults['openrouter'].error}
              </span>
              {testResults['openrouter'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['openrouter'].latencyMs}ms</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">OpenRouter API Key</label>
            <input
              type="password"
              value={openRouterApiKey}
              onChange={(e) => setOpenRouterApiKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="sk-or-v1-..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Vision &amp; Listing Modell</label>
            <select
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
            >
              <option value="anthropic/claude-3.5-sonnet">Anthropic: Claude 3.5 Sonnet (Empfohlen für Vision &amp; SEO)</option>
              <option value="openai/gpt-4o">OpenAI: GPT-4o</option>
              <option value="google/gemini-2.0-flash">Google: Gemini 2.0 Flash (Ultra schnell &amp; günstig)</option>
              <option value="openai/gpt-4o-mini">OpenAI: GPT-4o-mini</option>
            </select>
          </div>
        </div>

        {/* 2. Productor Trademark API */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Search className="w-4 h-4 mr-2 text-accent-purple" />
              Productor Trademark API
            </h3>
            <button
              onClick={() => runTest('productor', {})}
              disabled={testResults['productor']?.testing}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['productor']?.testing ? 'animate-spin text-accent-purple' : ''}`} />
              <span>Verbindung testen</span>
            </button>
          </div>

          {testResults['productor'] && !testResults['productor'].testing && (
            <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between border ${
              testResults['productor'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <span className="flex items-center">
                {testResults['productor'].success ? <ShieldCheck className="w-4 h-4 mr-1.5" /> : <ShieldAlert className="w-4 h-4 mr-1.5" />}
                {testResults['productor'].success ? 'USPTO / EUIPO / DPMA Endpoints online ✓' : testResults['productor'].error}
              </span>
              {testResults['productor'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['productor'].latencyMs}ms</span>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            Die Productor-API-Konnektoren für USPTO, EUIPO und DPMA sind vorkonfiguriert und sichern deine Designs automatisch gegen Nizza-Klassen (25, 9, 21, 20 etc.) ab.
          </p>

          <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1">
            <div>✓ USPTO Batch Search (classes=25,9,18,20...)</div>
            <div>✓ EUIPO Batch Search (classes=25,9,16,21...)</div>
            <div>✓ DPMA Live Search (German Trademark)</div>
          </div>
        </div>

        {/* 3. Ideogram 3.0 & Vectorizer.ai */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Sparkles className="w-4 h-4 mr-2 text-primary-400" />
              Ideogram 3.0 &amp; Vectorizer.ai
            </h3>
            <button
              onClick={() => runTest('ideogram', { apiKey: ideogramApiKey })}
              disabled={testResults['ideogram']?.testing || !ideogramApiKey}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['ideogram']?.testing ? 'animate-spin text-primary-400' : ''}`} />
              <span>Ideogram testen</span>
            </button>
          </div>

          {testResults['ideogram'] && !testResults['ideogram'].testing && (
            <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between border ${
              testResults['ideogram'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <span className="flex items-center">
                {testResults['ideogram'].success ? <ShieldCheck className="w-4 h-4 mr-1.5" /> : <ShieldAlert className="w-4 h-4 mr-1.5" />}
                {testResults['ideogram'].success ? 'Ideogram API verbunden ✓' : testResults['ideogram'].error}
              </span>
              {testResults['ideogram'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['ideogram'].latencyMs}ms</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ideogram API Key</label>
            <input
              type="password"
              value={ideogramApiKey}
              onChange={(e) => setIdeogramApiKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="Ideogram API Token..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Vectorizer Key</label>
              <input
                type="password"
                value={vectorizerApiKey}
                onChange={(e) => setVectorizerApiKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
                placeholder="vzk_..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Vectorizer Secret</label>
              <input
                type="password"
                value={vectorizerApiSecret}
                onChange={(e) => setVectorizerApiSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
                placeholder="Secret..."
              />
            </div>
          </div>
        </div>

        {/* 4. Supabase Sync & NAS Settings */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Database className="w-4 h-4 mr-2 text-emerald-400" />
              Supabase MBA Database
            </h3>
            <button
              onClick={() => runTest('supabase', { url: supabaseUrl, key: supabaseServiceRoleKey })}
              disabled={testResults['supabase']?.testing || !supabaseUrl}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['supabase']?.testing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>DB testen</span>
            </button>
          </div>

          {testResults['supabase'] && !testResults['supabase'].testing && (
            <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between border ${
              testResults['supabase'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <span className="flex items-center">
                {testResults['supabase'].success ? <ShieldCheck className="w-4 h-4 mr-1.5" /> : <ShieldAlert className="w-4 h-4 mr-1.5" />}
                {testResults['supabase'].success ? 'Supabase verbunden (mba_designs Tabelle bereit) ✓' : testResults['supabase'].error}
              </span>
              {testResults['supabase'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['supabase'].latencyMs}ms</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Supabase URL</label>
            <input
              type="text"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="https://xyzcompany.supabase.co"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Supabase Service Role Key</label>
            <input
              type="password"
              value={supabaseServiceRoleKey}
              onChange={(e) => setSupabaseServiceRoleKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="eyJhbGciOi..."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

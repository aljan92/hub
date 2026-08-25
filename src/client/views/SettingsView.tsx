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
  ShieldAlert,
  ShieldCheck,
  Search,
  DollarSign,
  Info,
  Bot,
  Copy,
  Check,
  Eye,
  EyeOff,
  Globe,
  Terminal
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { testing?: boolean; success?: boolean; latencyMs?: number; error?: string; details?: string; message?: string }>>({});

  // Fast LocalStorage hydration to eliminate any loading delay or empty fields
  const getCachedSettings = () => {
    try {
      const c = localStorage.getItem('mba_cached_settings_data');
      return c ? JSON.parse(c) : {};
    } catch {
      return {};
    }
  };
  const initialSettings = getCachedSettings();

  // Settings State
  const [openRouterApiKey, setOpenRouterApiKey] = useState<string>(initialSettings.openRouterApiKey || '');
  const [llmProvider, setLlmProvider] = useState<'openrouter' | 'openai'>(initialSettings.llmProvider || 'openrouter');
  const [llmModel, setLlmModel] = useState<string>(initialSettings.llmModel || 'anthropic/claude-3.5-sonnet');
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; promptPrice?: string; completionPrice?: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const [ideogramApiKey, setIdeogramApiKey] = useState<string>(initialSettings.ideogramApiKey || '');
  const [ideogramModel, setIdeogramModel] = useState<string>(initialSettings.ideogramModel || 'V_3');
  const [ideogramRenderingSpeed, setIdeogramRenderingSpeed] = useState<string>(initialSettings.ideogramRenderingSpeed || 'DEFAULT');
  const [ideogramAspectRatio, setIdeogramAspectRatio] = useState<string>(initialSettings.ideogramAspectRatio || '10x16');
  const [ideogramStyle, setIdeogramStyle] = useState<string>(initialSettings.ideogramStyle || 'GENERAL');
  const [ideogramMagicPromptOption, setIdeogramMagicPromptOption] = useState<string>(initialSettings.ideogramMagicPromptOption || 'AUTO');
  const [availableIdeogramModels, setAvailableIdeogramModels] = useState<{ id: string; name: string }[]>([
    { id: 'V_3', name: 'Ideogram 3.0 (T-Shirt & Vektor Spezialist)' },
    { id: 'V_4', name: 'Ideogram 4.0 (Neueste Generation & Transparent)' },
    { id: 'V_2_TURBO', name: 'Ideogram 2.0 Turbo (Schnell & Günstig)' },
    { id: 'V_2', name: 'Ideogram 2.0 (High Quality)' },
  ]);

  const [vectorizerApiKey, setVectorizerApiKey] = useState<string>(initialSettings.vectorizerApiKey || '');
  const [vectorizerApiSecret, setVectorizerApiSecret] = useState<string>(initialSettings.vectorizerApiSecret || '');

  const [supabaseUrl, setSupabaseUrl] = useState<string>(initialSettings.supabaseUrl || '');
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState<string>(initialSettings.supabaseServiceRoleKey || '');

  const [nasHost, setNasHost] = useState<string>(initialSettings.nasHost || '192.168.178.141');
  const [nasUser, setNasUser] = useState<string>(initialSettings.nasUser || 'aljan92');
  const [autoSlotFillHour, setAutoSlotFillHour] = useState<number>(initialSettings.autoSlotFillHour || 4);

  const [mcpApiKey, setMcpApiKey] = useState<string>(initialSettings.mcpApiKey || '');
  const [showMcpKey, setShowMcpKey] = useState(false);
  const [copiedMcpKey, setCopiedMcpKey] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);

  // Load existing settings and models on mount
  useEffect(() => {
    // 1. Settings
    fetch('/api/v1/settings')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          const s = data.settings;
          setOpenRouterApiKey(s.openRouterApiKey || '');
          setLlmProvider(s.llmProvider || 'openrouter');
          setLlmModel(s.llmModel || 'anthropic/claude-3.5-sonnet');
          setIdeogramApiKey(s.ideogramApiKey || '');
          setIdeogramModel(s.ideogramModel || 'V_3');
          setIdeogramRenderingSpeed(s.ideogramRenderingSpeed || 'DEFAULT');
          setIdeogramAspectRatio(s.ideogramAspectRatio || '10x16');
          setIdeogramStyle(s.ideogramStyle || 'GENERAL');
          setIdeogramMagicPromptOption(s.ideogramMagicPromptOption || 'AUTO');
          setVectorizerApiKey(s.vectorizerApiKey || '');
          setVectorizerApiSecret(s.vectorizerApiSecret || '');
          setSupabaseUrl(s.supabaseUrl || '');
          setSupabaseServiceRoleKey(s.supabaseServiceRoleKey || '');
          setNasHost(s.nasHost || '192.168.178.141');
          setNasUser(s.nasUser || 'aljan92');
          setAutoSlotFillHour(s.autoSlotFillHour || 4);
          setMcpApiKey(s.mcpApiKey || '');
          try {
            localStorage.setItem('mba_cached_settings_data', JSON.stringify(s));
          } catch {}
        }
      })
      .catch(err => console.warn('[Settings] Failed to fetch settings:', err));

    // 2. Fetch all dynamic OpenRouter models
    fetchModels();

    // 3. Fetch all dynamic Ideogram models
    fetch('/api/v1/ideogram/models')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.models)) {
          setAvailableIdeogramModels(data.models);
        }
      })
      .catch(() => {});
  }, []);

  const generateNewMcpKey = () => {
    const chars = 'abcdef0123456789';
    let key = 'mba_';
    for (let i = 0; i < 40; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setMcpApiKey(key);
  };

  const copyToClipboard = (text: string, type: 'key' | 'endpoint') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedMcpKey(true);
      setTimeout(() => setCopiedMcpKey(false), 2000);
    } else {
      setCopiedEndpoint(true);
      setTimeout(() => setCopiedEndpoint(false), 2000);
    }
  };

  const fetchModels = () => {
    setLoadingModels(true);
    fetch('/api/v1/llm/models')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.models)) {
          setAvailableModels(data.models);
        }
      })
      .catch(err => console.warn('[Settings] Failed to fetch models:', err))
      .finally(() => setLoadingModels(false));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        openRouterApiKey,
        llmProvider,
        llmModel,
        ideogramApiKey,
        ideogramModel,
        ideogramRenderingSpeed,
        ideogramAspectRatio,
        ideogramStyle,
        ideogramMagicPromptOption,
        vectorizerApiKey,
        vectorizerApiSecret,
        supabaseUrl,
        supabaseServiceRoleKey,
        nasHost,
        nasUser,
        autoSlotFillHour: Number(autoSlotFillHour),
        mcpApiKey,
      };

      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        try {
          localStorage.setItem('mba_cached_settings_data', JSON.stringify(payload));
        } catch {}
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
          details: data.details,
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

  // Filter models based on search query
  const filteredModels = availableModels.filter(m => 
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) || 
    m.id.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <SettingsIcon className="w-6 h-6 mr-2 text-primary-400" />
            Einstellungen &amp; API-Schlüssel
          </h2>
          <p className="text-sm text-slate-400">Verwalte Konnektoren, teste deine API-Keys live und wähle aus über 400+ KI-Modellen.</p>
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
        
        {/* 1. OpenRouter / OpenAI LLM Card */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Cpu className="w-4 h-4 mr-2 text-accent-cyan" />
              OpenRouter / OpenAI LLM
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
            <div className={`p-3 rounded-xl text-xs flex flex-col space-y-1 border ${
              testResults['openrouter'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center font-semibold">
                  {testResults['openrouter'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                  {testResults['openrouter'].success ? 'OpenRouter API verbunden ✓' : testResults['openrouter'].error}
                </span>
                {testResults['openrouter'].latencyMs !== undefined && (
                  <span className="font-mono text-[10px]">{testResults['openrouter'].latencyMs}ms</span>
                )}
              </div>
              {testResults['openrouter'].details && (
                <div className="text-[11px] opacity-90 pl-5 font-mono">
                  {testResults['openrouter'].details}
                </div>
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

          {/* Model Selector & Search */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Vision &amp; Listing Modell ({availableModels.length} verfügbar)
              </label>
              <button onClick={fetchModels} className="text-[11px] text-accent-cyan hover:underline flex items-center">
                <RefreshCw className={`w-2.5 h-2.5 mr-1 ${loadingModels ? 'animate-spin' : ''}`} />
                Modelliste aktualisieren
              </button>
            </div>

            {/* Quick Model Filter */}
            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Modelle filtern (z.B. claude, gpt, flash, llama)..."
              className="w-full bg-slate-950 border border-slate-800/90 rounded-lg px-3 py-1.5 text-[11px] text-slate-300 focus:border-primary-500 focus:outline-none"
            />

            <select
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
            >
              {filteredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id}) {m.promptPrice ? `• ${m.promptPrice}` : ''}
                </option>
              ))}
            </select>
            <div className="text-[10px] text-slate-500 font-mono">
              Aktuell gewählt: <strong>{llmModel}</strong>
            </div>
          </div>
        </div>

        {/* 2. Productor Trademark API Card */}
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
                {testResults['productor'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                {testResults['productor'].success ? 'USPTO / EUIPO / DPMA Endpoints online (Echter Batch-Search OK) ✓' : testResults['productor'].error}
              </span>
              {testResults['productor'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['productor'].latencyMs}ms</span>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            Die Productor-API sichert alle Quotes und Listings automatisch gegen Nizza-Klassen (25 Bekleidung, 9 PopSockets/Cases, 21 Tassen etc.) ab.
          </p>

          <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
            <div>✓ USPTO Batch Search (classes=25,9,18,20,35,16,24,41,40,21)</div>
            <div>✓ EUIPO Batch Search (classes=25,9,16,41,21)</div>
            <div>✓ DPMA Live Search (German Trademark)</div>
          </div>
        </div>

        {/* 3. Ideogram 3.0 Card */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <ImageIcon className="w-4 h-4 mr-2 text-primary-400" />
              Ideogram 3.0 API
            </h3>
            <button
              onClick={() => runTest('ideogram', { apiKey: ideogramApiKey })}
              disabled={testResults['ideogram']?.testing || !ideogramApiKey}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['ideogram']?.testing ? 'animate-spin text-primary-400' : ''}`} />
              <span>Verbindung testen</span>
            </button>
          </div>

          {testResults['ideogram'] && !testResults['ideogram'].testing && (
            <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between border ${
              testResults['ideogram'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <span className="flex items-center">
                {testResults['ideogram'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                {testResults['ideogram'].success ? 'Ideogram API Token verifiziert (0 Credits verbraucht) ✓' : testResults['ideogram'].error}
              </span>
              {testResults['ideogram'].latencyMs !== undefined && (
                <span className="font-mono text-[10px]">{testResults['ideogram'].latencyMs}ms</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ideogram API Token</label>
            <input
              type="password"
              value={ideogramApiKey}
              onChange={(e) => setIdeogramApiKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="Ideogram API Token..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Standard Modell</label>
            <select
              value={ideogramModel}
              onChange={(e) => setIdeogramModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
            >
              {availableIdeogramModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
          </div>

          {/* 4 Ideogram Parameters Grid */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800/80">
            {/* 1. Rendering Speed */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Speed (Rendering)</label>
              <select
                value={ideogramRenderingSpeed}
                onChange={(e) => setIdeogramRenderingSpeed(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none font-mono"
              >
                <option value="DEFAULT">DEFAULT (Standard)</option>
                <option value="TURBO">TURBO (Schnell)</option>
                <option value="QUALITY">QUALITY (Beste Qualität)</option>
                <option value="FLASH">FLASH (Ultra Schnell)</option>
              </select>
            </div>

            {/* 2. Aspect Ratio */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Aspect Ratio</label>
              <select
                value={ideogramAspectRatio}
                onChange={(e) => setIdeogramAspectRatio(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none font-mono"
              >
                <option value="10x16">10x16 (T-Shirt Portrait / 10:16)</option>
                <option value="4x5">4x5 (Merch Portrait / 4:5)</option>
                <option value="9x16">9x16 (Story / Hochformat)</option>
                <option value="3x4">3x4 (Klassisch Hochformat)</option>
                <option value="2x3">2x3 (Poster Hochformat)</option>
                <option value="1x2">1x2 (Schmal Hochformat)</option>
                <option value="1x3">1x3 (Extrem Schmal)</option>
                <option value="1x1">1x1 (Quadrat)</option>
                <option value="5x4">5x4 (Merch Querformat / 5:4)</option>
                <option value="4x3">4x3 (Klassisch Querformat)</option>
                <option value="3x2">3x2 (Poster Querformat)</option>
                <option value="16x10">16x10 (Querformat / 16:10)</option>
                <option value="16x9">16x9 (Widescreen / 16:9)</option>
                <option value="2x1">2x1 (Banner Querformat)</option>
                <option value="3x1">3x1 (Panorama Banner)</option>
              </select>
            </div>

            {/* 3. Style */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Style</label>
              <select
                value={ideogramStyle}
                onChange={(e) => setIdeogramStyle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none font-mono"
              >
                <option value="GENERAL">GENERAL (Allgemein - Standard)</option>
                <option value="DESIGN">DESIGN (Grafik &amp; Vektor)</option>
                <option value="REALISTIC">REALISTIC (Realistisch)</option>
                <option value="FICTION">FICTION (Fantasy &amp; Fiction)</option>
                <option value="AUTO">AUTO (Automatisch)</option>
              </select>
            </div>

            {/* 4. Magic Prompt */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Magic Prompt</label>
              <select
                value={ideogramMagicPromptOption}
                onChange={(e) => setIdeogramMagicPromptOption(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-primary-500 focus:outline-none font-mono"
              >
                <option value="AUTO">AUTO (Automatisch)</option>
                <option value="ON">ON (Immer aktiv)</option>
                <option value="OFF">OFF (Aus - Reiner Prompt)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 4. Vectorizer.ai Card (Dedicated) */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Sparkles className="w-4 h-4 mr-2 text-accent-cyan" />
              Vectorizer.ai API
            </h3>
            <button
              onClick={() => runTest('vectorizer', { apiKey: vectorizerApiKey, apiSecret: vectorizerApiSecret })}
              disabled={testResults['vectorizer']?.testing || !vectorizerApiKey || !vectorizerApiSecret}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['vectorizer']?.testing ? 'animate-spin text-accent-cyan' : ''}`} />
              <span>Verbindung testen</span>
            </button>
          </div>

          {testResults['vectorizer'] && !testResults['vectorizer'].testing && (
            <div className={`p-3 rounded-xl text-xs flex flex-col space-y-1 border ${
              testResults['vectorizer'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center font-semibold">
                  {testResults['vectorizer'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                  {testResults['vectorizer'].success ? 'Vectorizer.ai Account verbunden ✓' : testResults['vectorizer'].error}
                </span>
                {testResults['vectorizer'].latencyMs !== undefined && (
                  <span className="font-mono text-[10px]">{testResults['vectorizer'].latencyMs}ms</span>
                )}
              </div>
              {testResults['vectorizer'].details && (
                <div className="text-[11px] opacity-90 pl-5 font-mono">
                  {testResults['vectorizer'].details}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">API Key (ID)</label>
              <input
                type="password"
                value={vectorizerApiKey}
                onChange={(e) => setVectorizerApiKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
                placeholder="vzk_..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">API Secret</label>
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

        {/* 5. Supabase MBA Database Card (With Read + Write Verification) */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Database className="w-4 h-4 mr-2 text-emerald-400" />
              Supabase MBA Database
            </h3>
            <button
              onClick={() => runTest('supabase', { url: supabaseUrl, key: supabaseServiceRoleKey })}
              disabled={testResults['supabase']?.testing || !supabaseUrl || !supabaseServiceRoleKey}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${testResults['supabase']?.testing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Lesen &amp; Schreiben testen</span>
            </button>
          </div>

          {testResults['supabase'] && !testResults['supabase'].testing && (
            <div className={`p-3 rounded-xl text-xs flex flex-col space-y-1 border ${
              testResults['supabase'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center font-semibold">
                  {testResults['supabase'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                  {testResults['supabase'].success ? 'Supabase Lese- & Schreibtest bestanden ✓' : testResults['supabase'].error}
                </span>
                {testResults['supabase'].latencyMs !== undefined && (
                  <span className="font-mono text-[10px]">{testResults['supabase'].latencyMs}ms</span>
                )}
              </div>
              {testResults['supabase'].details && (
                <div className="text-[11px] opacity-90 pl-5 font-mono">
                  {testResults['supabase'].details}
                </div>
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
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Supabase Service Role Key (für Schreibzugriff)</label>
            <input
              type="password"
              value={supabaseServiceRoleKey}
              onChange={(e) => setSupabaseServiceRoleKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="eyJhbGciOi..."
            />
          </div>
        </div>

        {/* 6. NAS & Slot-Filling Settings Card */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
            <Server className="w-4 h-4 mr-2 text-accent-amber" />
            TerraMaster TOS 6.0 &amp; Automation
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">NAS Host IP</label>
              <input
                type="text"
                value={nasHost}
                onChange={(e) => setNasHost(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-primary-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">SSH Benutzer</label>
              <input
                type="text"
                value={nasUser}
                onChange={(e) => setNasUser(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-primary-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Auto Slot-Fill Uhrzeit (Uhr)</label>
            <input
              type="number"
              min="0"
              max="23"
              value={autoSlotFillHour}
              onChange={(e) => setAutoSlotFillHour(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>

        {/* 7. Hermes Agent & Remote API (MCP) Card */}
        <div className="glass-card p-5 rounded-2xl space-y-4 md:col-span-2 border border-primary-500/30 shadow-xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-tr from-primary-600 to-accent-cyan text-white shadow-md shadow-primary-500/20">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center">
                  Hermes Agent &amp; Remote API (MCP Integration)
                </h3>
                <p className="text-xs text-slate-400">Direkte Trademark-Prüfung &amp; Task-Submission für deinen Hermes Agenten (VPS / Remote).</p>
              </div>
            </div>

            <button
              onClick={() => runTest('hermes', { apiKey: mcpApiKey })}
              disabled={testResults['hermes']?.testing}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/40 flex items-center space-x-1.5 transition-all self-start sm:self-auto disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testResults['hermes']?.testing ? 'animate-spin text-accent-cyan' : ''}`} />
              <span>MCP &amp; TM Engine testen</span>
            </button>
          </div>

          {testResults['hermes'] && !testResults['hermes'].testing && (
            <div className={`p-3 rounded-xl text-xs flex flex-col space-y-1 border ${
              testResults['hermes'].success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center font-semibold">
                  {testResults['hermes'].success ? <ShieldCheck className="w-4 h-4 mr-1.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />}
                  {testResults['hermes'].message || (testResults['hermes'].success ? 'MCP Schnittstelle einsatzbereit ✓' : 'Test fehlgeschlagen')}
                </span>
                {testResults['hermes'].latencyMs !== undefined && (
                  <span className="font-mono text-[10px]">{testResults['hermes'].latencyMs}ms</span>
                )}
              </div>
              {testResults['hermes'].details && (
                <div className="text-[11px] opacity-90 pl-5 font-mono">
                  {testResults['hermes'].details}
                </div>
              )}
            </div>
          )}

          {/* API Key Control */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center">
                <Key className="w-3.5 h-3.5 mr-1 text-accent-amber" />
                MBA HUB API Key (<code className="text-accent-cyan font-mono">x-mba-api-key</code>)
              </label>
              <button
                type="button"
                onClick={generateNewMcpKey}
                className="text-[11px] font-semibold text-primary-400 hover:text-primary-300 transition-colors"
              >
                + Neuen Key generieren
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  type={showMcpKey ? 'text' : 'password'}
                  value={mcpApiKey}
                  onChange={(e) => setMcpApiKey(e.target.value)}
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono tracking-wider"
                  placeholder="mba_..."
                />
                <button
                  type="button"
                  onClick={() => setShowMcpKey(!showMcpKey)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showMcpKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="button"
                onClick={() => copyToClipboard(mcpApiKey, 'key')}
                disabled={!mcpApiKey}
                className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors shrink-0 disabled:opacity-50"
              >
                {copiedMcpKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedMcpKey ? 'Kopiert!' : 'Key kopieren'}</span>
              </button>
            </div>
          </div>

          {/* Endpoints & Cloudflare Tunnel Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
            <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center">
                  <Terminal className="w-3.5 h-3.5 mr-1.5 text-accent-cyan" />
                  TM Check Endpunkt (POST)
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Phase 1</span>
              </div>
              <div className="font-mono text-[11px] text-slate-300 bg-slate-900/90 p-2 rounded-lg border border-slate-800 select-all flex items-center justify-between">
                <span className="truncate">/api/v1/mcp/trademark/check</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard('/api/v1/mcp/trademark/check', 'endpoint')}
                  className="text-slate-400 hover:text-white ml-2 shrink-0"
                  title="Pfad kopieren"
                >
                  {copiedEndpoint ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Health Ping Sub-Endpoint */}
              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">⚡ Health Ping (GET):</span>
                <code className="bg-slate-900 px-2 py-0.5 rounded text-accent-cyan font-mono text-[10px] select-all">/api/v1/mcp/health</code>
              </div>
              <p className="text-[11px] text-slate-400">
                Unterstützt <code className="text-slate-300">offices: ["USPTO", "EUIPO", "DPMA"]</code> und Felder wie <code className="text-slate-300">phrase</code>, <code className="text-slate-300">title</code>, <code className="text-slate-300">brand</code>, etc.
              </p>
            </div>

            <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center">
                  <Globe className="w-3.5 h-3.5 mr-1.5 text-accent-amber" />
                  Cloudflare Tunnel Setup
                </span>
                <span className="text-[10px] font-mono text-slate-400">Port 3000</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Leite deine Domain (z.B. <code className="text-slate-200">hub.deinedomain.de</code>) via <code className="text-slate-200">cloudflared</code> auf Port <code className="text-slate-200">3000</code> des NAS weiter.
              </p>
              <div className="font-mono text-[10px] text-slate-400 bg-slate-900/90 p-1.5 rounded border border-slate-800 truncate">
                Header: <span className="text-accent-cyan">x-mba-api-key: {mcpApiKey ? mcpApiKey.substring(0, 10) + '...' : 'mba_...'}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

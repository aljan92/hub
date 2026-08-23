import React, { useState } from 'react';
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
  Shield
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [saved, setSaved] = useState(false);

  // Settings State
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [llmModel, setLlmModel] = useState('anthropic/claude-3.5-sonnet');
  const [ideogramKey, setIdeogramKey] = useState('');
  const [vectorizerKey, setVectorizerKey] = useState('');
  const [vectorizerSecret, setVectorizerSecret] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [nasHost, setNasHost] = useState('192.168.178.141');
  const [nasUser, setNasUser] = useState('aljan92');
  const [slotFillHour, setSlotFillHour] = useState('4');

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
          <p className="text-sm text-slate-400">Verwalte Konnektoren, NAS-Zugangsdaten, LLM-Modelle und Slot-Filling Regeln.</p>
        </div>

        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/20 flex items-center space-x-2 transition-all active:scale-98"
        >
          {saved ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'Gespeichert!' : 'Einstellungen speichern'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LLM & Vision (OpenRouter / OpenAI) */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
            <Cpu className="w-4 h-4 mr-2 text-accent-cyan" />
            LLM Vision &amp; Listing Generator
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">OpenRouter API Key</label>
            <input
              type="password"
              value={openRouterKey}
              onChange={(e) => setOpenRouterKey(e.target.value)}
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

        {/* Image Generation & Vectorizer */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
            <Sparkles className="w-4 h-4 mr-2 text-primary-400" />
            Ideogram 3.0 &amp; Vectorizer.ai
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ideogram API Key</label>
            <input
              type="password"
              value={ideogramKey}
              onChange={(e) => setIdeogramKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="Ideogram API Token..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Vectorizer Key (API ID)</label>
              <input
                type="password"
                value={vectorizerKey}
                onChange={(e) => setVectorizerKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
                placeholder="vzk_..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Vectorizer Secret</label>
              <input
                type="password"
                value={vectorizerSecret}
                onChange={(e) => setVectorizerSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
                placeholder="Secret Token..."
              />
            </div>
          </div>
        </div>

        {/* Supabase Sync Database */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
            <Database className="w-4 h-4 mr-2 text-emerald-400" />
            Supabase MBA Database Sync
          </h3>

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
              value={supabaseKey}
              onChange={(e) => setSupabaseKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-primary-500 focus:outline-none font-mono"
              placeholder="eyJhbGciOi..."
            />
          </div>
        </div>

        {/* NAS & Slot-Filling Rules */}
        <div className="glass-card p-5 rounded-2xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
            <Server className="w-4 h-4 mr-2 text-accent-amber" />
            TerraMaster TOS 6.0 &amp; Slot-Filling
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
              value={slotFillHour}
              onChange={(e) => setSlotFillHour(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

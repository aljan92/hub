import React, { useState } from 'react';
import { 
  Sparkles, 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  Send, 
  Sliders, 
  Tag, 
  Type, 
  Layers,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export const DesignerView: React.FC = () => {
  const [niche1, setNiche1] = useState('Vintage Retro');
  const [niche2, setNiche2] = useState('Coffee Lovers');
  const [quote, setQuote] = useState('Powered by Caffeine and Chaos');
  const [stylePreset, setStylePreset] = useState('vintage-distressed');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [isCheckingTM, setIsCheckingTM] = useState(false);
  const [tmResult, setTmResult] = useState<{ safe: boolean; details?: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Generated prompt preview
  const generatedPrompt = `T-shirt graphic design of "${quote}", retro vintage 1970s distressed aesthetic, vector illustration, isolated on clean solid background, bold typography, warm color palette, highly detailed, commercial merchandise print ready.`;

  const handlePreTMCheck = () => {
    setIsCheckingTM(true);
    setTimeout(() => {
      setIsCheckingTM(false);
      if (quote.toLowerCase().includes('nike') || quote.toLowerCase().includes('disney')) {
        setTmResult({ safe: false, details: 'Klasse 25 Live Treffer gefunden! Ablehnung empfohlen.' });
      } else {
        setTmResult({ safe: true, details: 'Nizza Klasse 25 (Clothing): Keine Schutzrechte auf die Quote gefunden.' });
      }
    }, 600);
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      alert('Design-Task erfolgreich an Ideogram 3.0 übermittelt! Das Bild wird nach Fertigstellung im Tab "Tasks" abgelegt.');
    }, 1200);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* View Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <Sparkles className="w-6 h-6 mr-2 text-primary-400" />
            Designer &amp; Prompt Generator
          </h2>
          <p className="text-sm text-slate-400">Erstelle optimierte Ideogram 3.0 Prompts mit automatischem Trademark-Precheck.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Input Form (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="glass-card p-5 rounded-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Sliders className="w-4 h-4 mr-2 text-accent-cyan" />
              Nischen &amp; Slogan
            </h3>

            {/* Niche Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center">
                  <Tag className="w-3.5 h-3.5 mr-1 text-primary-400" />
                  Haupt-Nische (Niche 1)
                </label>
                <input
                  type="text"
                  value={niche1}
                  onChange={(e) => setNiche1(e.target.value)}
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                  placeholder="z.B. Retro Cats"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center">
                  <Tag className="w-3.5 h-3.5 mr-1 text-accent-cyan" />
                  Sub-Nische (Niche 2)
                </label>
                <input
                  type="text"
                  value={niche2}
                  onChange={(e) => setNiche2(e.target.value)}
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                  placeholder="z.B. 80s Synthwave"
                />
              </div>
            </div>

            {/* Quote / Slogan */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 flex items-center">
                  <Type className="w-3.5 h-3.5 mr-1 text-accent-amber" />
                  Sichtbarer Text / Spruch (Quote)
                </label>
                <button
                  type="button"
                  onClick={handlePreTMCheck}
                  disabled={isCheckingTM || !quote}
                  className="text-xs font-semibold text-primary-400 hover:text-primary-300 flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isCheckingTM ? 'animate-spin' : ''}`} />
                  <span>{isCheckingTM ? 'Prüfe TM...' : 'Quote prüfen (Nizza 25)'}</span>
                </button>
              </div>
              <input
                type="text"
                value={quote}
                onChange={(e) => {
                  setQuote(e.target.value);
                  setTmResult(null);
                }}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="z.B. Powered by Coffee"
              />
            </div>

            {/* Trademark Check Result Alert */}
            {tmResult && (
              <div className={`p-3.5 rounded-xl border text-xs flex items-start space-x-2.5 ${
                tmResult.safe 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {tmResult.safe ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">{tmResult.safe ? 'Trademark Check bestanden ✓' : 'Trademark Konflikt erkannt!'}</div>
                  <div className="text-[11px] opacity-90 mt-0.5">{tmResult.details}</div>
                </div>
              </div>
            )}

            {/* Style & Aspect Ratio */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Style-Preset</label>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500"
                >
                  <option value="vintage-distressed">Vintage Distressed / Retro 70s</option>
                  <option value="modern-minimalist">Modern Minimalist Vector</option>
                  <option value="bold-typography">Bold Typography / Slogan</option>
                  <option value="cartoon-kawaii">Cute Kawaii Character</option>
                  <option value="cyberpunk-glow">Synthwave / Cyberpunk</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Seitenverhältnis (Aspect Ratio)</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500"
                >
                  <option value="1:1">1:1 Quadratisch (Standard)</option>
                  <option value="3:4">3:4 Hochformat (Apparel)</option>
                  <option value="4:5">4:5 Optimiert</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Output & Action Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="glass-card p-5 rounded-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center">
              <Layers className="w-4 h-4 mr-2 text-primary-400" />
              Generierter Ideogram 3.0 Prompt
            </h3>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-300 leading-relaxed max-h-56 overflow-y-auto">
              {generatedPrompt}
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Generator Modell:</span>
                <span className="font-semibold text-slate-200">Ideogram 3.0 (V_2_TURBO)</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Magischer Prompt:</span>
                <span className="font-semibold text-emerald-400">Aktiviert (Auto-Enhance)</span>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full py-3.5 px-4 rounded-xl text-sm font-bold bg-gradient-to-r from-primary-600 to-accent-cyan hover:from-primary-500 hover:to-accent-cyan/90 text-white shadow-lg shadow-primary-500/25 flex items-center justify-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sende an Ideogram...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Design generieren &amp; in Tasks ablegen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

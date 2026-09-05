import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  Activity, 
  Server, 
  RefreshCw, 
  Cpu, 
  Sparkles, 
  DownloadCloud, 
  CheckCircle2, 
  AlertTriangle,
  DollarSign,
  Tag,
  Coins,
  X
} from 'lucide-react';

interface CostStatsSummary {
  totalCosts: number;
  costPerDesign: number;
  openRouterCost: number;
  imagesCost: number;
  vectorizationsCost: number;
  activeDesignsCount: number;
}

interface HeaderProps {
  tier?: number;
}

export const Header: React.FC<HeaderProps> = ({ tier }) => {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [credits, setCredits] = useState<{
    openrouter?: { 
      usage?: number; 
      limitRemaining?: number; 
      balanceRemaining?: number; 
      totalCredits?: number; 
      limit?: number; 
      hasKey?: boolean;
      isCircuitBroken?: boolean;
      circuitBreakReason?: string;
      minBalanceThreshold?: number;
      isLowBalance?: boolean;
    };
    vectorizer?: { credits?: number; details?: string; hasKey?: boolean };
  } | null>(() => {
    try {
      const cached = localStorage.getItem('mba_cached_credits');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [costStats, setCostStats] = useState<CostStatsSummary | null>(() => {
    try {
      const cached = localStorage.getItem('mba_cached_cost_stats');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [activeTier, setActiveTier] = useState<number | undefined>(() => {
    if (tier !== undefined && tier !== null) return tier;
    try {
      const cached = localStorage.getItem('mba_cached_tier');
      return cached ? Number(cached) : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (tier !== undefined && tier !== null) {
      setActiveTier(tier);
      try {
        localStorage.setItem('mba_cached_tier', String(tier));
      } catch {}
    }
  }, [tier]);

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateCountdown, setUpdateCountdown] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const fetchCreditsAndCosts = (forceFresh = false) => {
    fetch(`/api/v1/credits${forceFresh ? '?forceFresh=true' : ''}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCredits(prev => {
            const merged = {
              openrouter: { ...(prev?.openrouter || {}), ...(data.openrouter || {}) },
              vectorizer: { ...(prev?.vectorizer || {}), ...(data.vectorizer || {}) }
            };
            try {
              localStorage.setItem('mba_cached_credits', JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      })
      .catch(() => {});

    fetch('/api/v1/stats/costs')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCostStats(data);
          try {
            localStorage.setItem('mba_cached_cost_stats', JSON.stringify(data));
          } catch {}
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchCreditsAndCosts();
    const interval = setInterval(fetchCreditsAndCosts, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  // Format OpenRouter string: Verfügbares Guthaben & Verbrauch & Pausiert-Status
  const getOpenRouterText = () => {
    if (!credits?.openrouter) return 'Aktiv';
    const available = credits.openrouter.balanceRemaining !== undefined && credits.openrouter.balanceRemaining !== null
      ? `$${Number(credits.openrouter.balanceRemaining).toFixed(2)}`
      : (credits.openrouter.limitRemaining !== undefined && credits.openrouter.limitRemaining !== null
        ? `$${Number(credits.openrouter.limitRemaining).toFixed(2)}`
        : null);

    const usage = credits.openrouter.usage !== undefined 
      ? `$${Number(credits.openrouter.usage).toFixed(2)}` 
      : null;

    const isPaused = credits.openrouter.isCircuitBroken || credits.openrouter.isLowBalance;
    if (isPaused) {
      return `${available || '$0.00'} • ⏸️ PAUSIERT`;
    }

    if (available !== null && usage !== null) {
      return `${available} frei • ${usage} used`;
    }
    if (available !== null) {
      return `${available} frei`;
    }
    if (usage !== null) {
      return `${usage} used`;
    }
    return 'Aktiv';
  };

  const handleTriggerUpdate = async () => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const res = await fetch('/api/v1/system/update', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        // Start countdown and reload
        let count = 10;
        setUpdateCountdown(count);
        const timer = setInterval(() => {
          count -= 1;
          if (count <= 0) {
            clearInterval(timer);
            window.location.reload();
          } else {
            setUpdateCountdown(count);
          }
        }, 1000);
      } else {
        setIsUpdating(false);
        setUpdateError(data.error || 'Fehler beim Herunterladen des Updates.');
      }
    } catch (err: any) {
      setIsUpdating(false);
      setUpdateError('Netzwerkfehler während des Update-Prozesses.');
    }
  };

  return (
    <>
      <header className="h-16 border-b border-slate-800/80 bg-surface/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-accent-cyan flex items-center justify-center shadow-lg shadow-primary-500/20 ring-1 ring-white/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                MBA HUB
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20">
                v1.0
              </span>
            </div>
            <time
              className="text-[11px] text-slate-400 font-mono font-medium hidden sm:block tabular-nums"
              dateTime={currentTime.toISOString()}
              title="Lokale Systemzeit"
            >
              {currentTime.toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </time>
          </div>
        </div>

        {/* Center Status & Live API Credits / Costs */}
        <div className="flex items-center space-x-2 sm:space-x-3 overflow-x-auto py-1">
          {/* Total Costs Badge */}
          {costStats && (
            <div 
              className="flex items-center space-x-1.5 bg-slate-900/90 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-mono shadow-sm"
              title={`Gesamtausgaben:\n• OpenRouter: $${costStats.openRouterCost.toFixed(2)}\n• Ideogram Bilder: $${costStats.imagesCost.toFixed(2)}\n• Vectorizer.ai: $${costStats.vectorizationsCost.toFixed(2)}`}
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400 text-[11px]">Total:</span>
              <span className="font-bold text-emerald-400">${costStats.totalCosts.toFixed(2)}</span>
            </div>
          )}

          {/* Cost per Design Badge */}
          {costStats && (
            <div 
              className="flex items-center space-x-1.5 bg-slate-900/90 border border-purple-500/30 px-3 py-1.5 rounded-xl text-xs font-mono shadow-sm"
              title={`Durchschnittskosten pro Design:\nTotal Ausgaben ($${costStats.totalCosts.toFixed(2)}) / ${costStats.activeDesignsCount} aktive Designs in Warteschlange & Hochgeladen`}
            >
              <Tag className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="text-slate-400 text-[11px]">Ø/Design:</span>
              <span className="font-bold text-purple-300">${costStats.costPerDesign.toFixed(2)}</span>
            </div>
          )}

          {/* OpenRouter Credits (Rest & Used & Low Balance Warning) */}
          {credits?.openrouter?.hasKey && (() => {
            const isPaused = Boolean(credits.openrouter.isCircuitBroken || credits.openrouter.isLowBalance);
            const borderCls = isPaused 
              ? 'border-red-500/60 bg-red-950/40 text-red-300 animate-pulse hover:bg-red-900/50' 
              : 'border-accent-amber/30 bg-slate-900/90 text-accent-amber hover:bg-slate-800/90';
            const iconCls = isPaused ? 'text-red-400' : 'text-accent-amber';
            const textCls = isPaused ? 'text-red-400 font-extrabold' : 'text-accent-amber font-bold';

            return (
              <div 
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border cursor-pointer transition-all shadow-sm active:scale-95 ${borderCls}`}
                onClick={() => fetchCreditsAndCosts(true)}
                title={isPaused 
                  ? `⚠️ OpenRouter Guthaben niedrig oder aufgebraucht!\n${credits.openrouter.circuitBreakReason || 'Guthaben unter Min-Schwellenwert.'}\nUpdate-Automatik & KI-Pipelines pausiert.\nKlicken zum Aktualisieren nach Aufladung.` 
                  : 'OpenRouter Guthaben & Verbrauch (Klicken zum Aktualisieren)'}
              >
                <Cpu className={`w-3.5 h-3.5 shrink-0 ${iconCls}`} />
                <span className="text-slate-400 text-[11px]">OR:</span>
                <span className={textCls}>{getOpenRouterText()}</span>
              </div>
            );
          })()}

          {/* Vectorizer.ai Credits */}
          {credits?.vectorizer?.hasKey && (
            <div className="flex items-center space-x-1.5 bg-slate-900/90 border border-accent-cyan/30 px-3 py-1.5 rounded-xl text-xs font-mono">
              <Sparkles className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
              <span className="text-slate-400 text-[11px]">Vec:</span>
              <span className="font-bold text-accent-cyan">
                {credits.vectorizer.credits !== undefined ? `${credits.vectorizer.credits} Cr` : 'Aktiv'}
              </span>
            </div>
          )}

          {/* MBA Tier Badge */}
          {activeTier !== undefined && activeTier !== null && (
            <div className="flex items-center space-x-1.5 bg-slate-900/90 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400 text-[11px]">Tier:</span>
              <span className="font-bold text-emerald-400">{Number(activeTier).toLocaleString('de-DE')}</span>
            </div>
          )}
        </div>

        {/* Right Controls: 1-Click Update */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* 1-Click Self-Update Button */}
          <button
            onClick={() => setShowUpdateModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/30 transition-all shadow-sm active:scale-95"
            title="Neueste Version von GitHub laden & Container neu starten"
          >
            <DownloadCloud className="w-3.5 h-3.5 text-primary-400" />
            <span>Update</span>
          </button>
        </div>
      </header>

      {/* 1-Click Update Confirmation Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative">
            <button
              onClick={() => !isUpdating && setShowUpdateModal(false)}
              disabled={isUpdating}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-xl bg-primary-500/10 text-primary-400 border border-primary-500/20">
                <DownloadCloud className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">1-Click System-Update</h3>
                <p className="text-xs text-slate-400">Direkt von GitHub (main-Branch)</p>
              </div>
            </div>

            {updateError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{updateError}</span>
              </div>
            )}

            {updateCountdown !== null ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto animate-bounce" />
                <div className="text-sm font-bold text-emerald-300">Update erfolgreich eingespielt!</div>
                <div className="text-xs text-slate-300">
                  Der Container startet jetzt neu. Das Dashboard lädt in <strong className="text-emerald-400 font-mono text-sm">{updateCountdown}s</strong> neu...
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Möchtest du die neuesten Änderungen direkt von GitHub herunterladen und den MBA Hub automatisch neu starten?
                </p>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div>1. Lädt GitHub Release Tarball herunter</div>
                  <div>2. Ersetzt Standalone-Bundle &amp; Frontend</div>
                  <div>3. Startet Docker-Container automatisch neu</div>
                </div>
              </>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2">
              {updateCountdown === null && (
                <>
                  <button
                    onClick={() => setShowUpdateModal(false)}
                    disabled={isUpdating}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleTriggerUpdate}
                    disabled={isUpdating}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-primary-600 to-accent-cyan hover:from-primary-500 hover:to-accent-cyan text-white shadow-lg shadow-primary-500/25 flex items-center space-x-2 transition-all active:scale-98 disabled:opacity-50"
                  >
                    {isUpdating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Installiere Update...</span>
                      </>
                    ) : (
                      <>
                        <DownloadCloud className="w-3.5 h-3.5" />
                        <span>Jetzt aktualisieren</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

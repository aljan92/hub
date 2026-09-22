import React, { useState, useEffect } from 'react';
import { 
  Eraser, 
  RefreshCw, 
  Trash2, 
  Check, 
  ExternalLink, 
  ZoomIn, 
  X, 
  AlertTriangle, 
  ShieldCheck,
  CheckCircle2,
  ListFilter
} from 'lucide-react';

interface CleanupDesignItem {
  designId: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
}

type ActionChoice = 'keep' | 'delete' | null;

export const CleanView: React.FC = () => {
  const [items, setItems] = useState<CleanupDesignItem[]>([]);
  const [choices, setChoices] = useState<Record<string, ActionChoice>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatusMessage, setProcessStatusMessage] = useState<string | null>(null);
  const [totalReviewed, setTotalReviewed] = useState<number>(0);
  const [allReviewed, setAllReviewed] = useState(false);
  const [activeZoomItem, setActiveZoomItem] = useState<CleanupDesignItem | null>(null);
  const [lastSummary, setLastSummary] = useState<{ deleted: number; kept: number; errors: number } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Fetch reviewed stats on mount
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/v1/cleanup/stats');
      const data = await res.json();
      if (data.success && typeof data.totalReviewed === 'number') {
        setTotalReviewed(data.totalReviewed);
      }
    } catch (e) {
      console.warn('[CleanView] Konnte Stats nicht laden:', e);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Scan 10 random published designs
  const handleScan = async () => {
    setIsLoading(true);
    setLastSummary(null);
    setAllReviewed(false);
    try {
      const res = await fetch('/api/v1/cleanup/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 })
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setChoices({});
        if (typeof data.totalReviewed === 'number') {
          setTotalReviewed(data.totalReviewed);
        }
        if (data.allReviewed) {
          setAllReviewed(true);
        }
      } else {
        alert('Fehler beim Scannen: ' + (data.error || 'Unbekannter Fehler'));
      }
    } catch (err: any) {
      alert('Netzwerkfehler beim Scannen: ' + (err.message || String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  // Set action for a specific design
  const setChoice = (designId: string, choice: ActionChoice) => {
    setChoices(prev => {
      // Toggle off if clicked again
      if (prev[designId] === choice) {
        const next = { ...prev };
        delete next[designId];
        return next;
      }
      return { ...prev, [designId]: choice };
    });
  };

  // Mark all unselected items as "keep"
  const handleMarkAllKeep = () => {
    const next: Record<string, ActionChoice> = { ...choices };
    for (const item of items) {
      if (!next[item.designId]) {
        next[item.designId] = 'keep';
      }
    }
    setChoices(next);
  };

  // Process the decisions
  const handleProcess = async () => {
    const actions = Object.entries(choices)
      .filter(([_, action]) => action === 'keep' || action === 'delete')
      .map(([designId, action]) => ({ designId, action: action as 'keep' | 'delete' }));

    if (actions.length === 0) {
      alert('Bitte triff zuerst mindestens eine Entscheidung ("Behalten" oder "Löschen").');
      return;
    }

    const deleteCount = actions.filter(a => a.action === 'delete').length;
    const keepCount = actions.filter(a => a.action === 'keep').length;

    const confirmMsg = `Möchtest du die Aktionen jetzt ausführen?\n\n` +
      `🗑️ Löschen bei Amazon: ${deleteCount} Design(s)\n` +
      `💾 Behalten & ignorieren: ${keepCount} Design(s)`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setIsProcessing(true);
    setProcessStatusMessage(`Verarbeite ${actions.length} Aktionen (${deleteCount} Löschungen bei Amazon)...`);

    try {
      const res = await fetch('/api/v1/cleanup/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions })
      });
      const data = await res.json();

      if (data.success || data.totalProcessed > 0) {
        setLastSummary({
          deleted: data.deletedCount || 0,
          kept: data.keptCount || 0,
          errors: data.errors?.length || 0
        });

        // Clear active view ready for next scan
        setItems([]);
        setChoices({});
        fetchStats();

        if (data.errors && data.errors.length > 0) {
          alert(`Hinweis: ${data.deletedCount} gelöscht, ${data.keptCount} behalten, aber ${data.errors.length} Fehler aufgetreten.`);
        }
      } else {
        alert('Verarbeitung fehlgeschlagen: ' + (data.error || 'Fehler beim Löschen/Behalten'));
      }
    } catch (err: any) {
      alert('Netzwerkfehler bei der Verarbeitung: ' + (err.message || String(err)));
    } finally {
      setIsProcessing(false);
      setProcessStatusMessage(null);
    }
  };

  // Reset reviewed list
  const handleResetReviewed = async () => {
    try {
      const res = await fetch('/api/v1/cleanup/reset-reviewed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTotalReviewed(0);
        setAllReviewed(false);
        setShowResetConfirm(false);
        alert('Die Behalten-Liste wurde erfolgreich geleert.');
      }
    } catch (e: any) {
      alert('Fehler beim Zurücksetzen: ' + e.message);
    }
  };

  // Counts for current batch
  const selectedDeleteCount = Object.values(choices).filter(c => c === 'delete').length;
  const selectedKeepCount = Object.values(choices).filter(c => c === 'keep').length;
  const hasDecisions = selectedDeleteCount > 0 || selectedKeepCount > 0;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-surface/80 border border-slate-800/80 backdrop-blur-md shadow-lg shadow-black/20">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/30 shadow-inner">
            <Eraser className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              CleanUp Studio
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                10-Slot Quick Review
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Prüfe zufällige Merch-Designs und lösche Überflüssiges direkt über die Amazon API.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Stats Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span><strong className="text-white">{totalReviewed}</strong> geprüft/behalten</span>
          </div>

          {/* Reset Reviewed Button */}
          {totalReviewed > 0 && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800/50 hover:bg-rose-950/40 border border-slate-700/50 hover:border-rose-700/50 text-xs text-slate-400 hover:text-rose-300 transition-colors"
              title="Behalten-Liste leeren, um alle Designs wieder prüfen zu können"
            >
              Liste leeren
            </button>
          )}

          {/* Scan Button */}
          <button
            onClick={handleScan}
            disabled={isLoading || isProcessing}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-md ${
              isLoading
                ? 'bg-purple-600/50 text-purple-200 cursor-wait'
                : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30 hover:shadow-purple-900/50'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Lade Designs...' : '10 Designs scannen'}
          </button>

          {/* Process Button */}
          {items.length > 0 && (
            <button
              onClick={handleProcess}
              disabled={!hasDecisions || isProcessing}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-md ${
                !hasDecisions || isProcessing
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/40'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30 hover:shadow-emerald-900/50'
              }`}
            >
              <Check className="w-4 h-4" />
              {isProcessing ? 'Verarbeite...' : `Verarbeiten (${selectedDeleteCount} Löschen / ${selectedKeepCount} Behalten)`}
            </button>
          )}
        </div>
      </div>

      {/* Processing Status Banner */}
      {isProcessing && processStatusMessage && (
        <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 text-purple-200 flex items-center gap-3 animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin text-purple-400 flex-shrink-0" />
          <span className="text-sm font-medium">{processStatusMessage}</span>
        </div>
      )}

      {/* Last Process Success Summary */}
      {lastSummary && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span className="text-sm">
              Letzter Durchlauf: <strong>{lastSummary.deleted}</strong> gelöscht, <strong>{lastSummary.kept}</strong> behalten
              {lastSummary.errors > 0 ? ` (${lastSummary.errors} Fehler)` : ''}.
            </span>
          </div>
          <button
            onClick={handleScan}
            className="text-xs px-3 py-1 rounded-lg bg-emerald-800/50 hover:bg-emerald-700/50 border border-emerald-600/50 text-white transition-colors"
          >
            Nächste 10 scannen
          </button>
        </div>
      )}

      {/* Batch Quick Controls (when items present) */}
      {items.length > 0 && (
        <div className="flex items-center justify-between p-3 px-4 rounded-xl bg-surface/50 border border-slate-800/60 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <ListFilter className="w-4 h-4 text-slate-500" />
            <span>10 Designs bereit. Klicke auf ein Bild zur Vergrößerung.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAllKeep}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-emerald-950/50 border border-slate-700 hover:border-emerald-700/50 text-slate-300 hover:text-emerald-300 transition-colors"
            >
              Rest als "Behalten" markieren
            </button>
          </div>
        </div>
      )}

      {/* Empty State: Nothing scanned yet or all reviewed */}
      {items.length === 0 && !isLoading && (
        <div className="p-12 text-center rounded-2xl bg-surface/40 border border-slate-800/60 flex flex-col items-center justify-center">
          <div className="p-4 rounded-2xl bg-purple-500/10 text-purple-400 mb-4 border border-purple-500/20">
            <Eraser className="w-10 h-10" />
          </div>
          {allReviewed ? (
            <>
              <h2 className="text-xl font-bold text-white mb-2">Alle Designs wurden bereits geprüft! 🎉</h2>
              <p className="text-sm text-slate-400 max-w-md mb-6">
                In deiner Datenbank gibt es aktuell keine weiteren ungesehenen PUBLISHED-Designs.
                Du kannst die Behalten-Liste leeren, wenn du einen neuen Prüfdurchlauf starten möchtest.
              </p>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-purple-900/40 border border-slate-700 text-sm font-medium text-slate-200 transition-all"
              >
                Behalten-Liste leeren & von vorne beginnen
              </button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white mb-2">Bereit für den nächsten CleanUp-Scan</h2>
              <p className="text-sm text-slate-400 max-w-md mb-6">
                Klicke auf <strong>"10 Designs scannen"</strong>, um zufällige Designs aus deiner Datenbank zu laden.
                Du kannst jedes Design in Ruhe prüfen, vergrößern und per Knopfdruck behalten oder bei Amazon löschen.
              </p>
              <button
                onClick={handleScan}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm shadow-lg shadow-purple-950/50 transition-all flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                10 Designs scannen
              </button>
            </>
          )}
        </div>
      )}

      {/* Grid of 10 Designs */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {items.map(item => {
            const currentChoice = choices[item.designId] || null;
            return (
              <div 
                key={item.designId}
                className={`flex flex-col justify-between rounded-xl p-3.5 transition-all border ${
                  currentChoice === 'delete'
                    ? 'bg-rose-950/20 border-rose-600/70 shadow-md shadow-rose-950/30'
                    : currentChoice === 'keep'
                    ? 'bg-emerald-950/20 border-emerald-600/70 shadow-md shadow-emerald-950/30'
                    : 'bg-surface/80 border-slate-800/80 hover:border-slate-700 shadow-md shadow-black/10'
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-mono font-semibold text-slate-300">
                    #{item.designId}
                  </span>
                  <a
                    href={`https://merch.amazon.com/designs/${item.designId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                    title="Auf Amazon Merch öffnen"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Artwork Thumbnail with Zoom Button */}
                <div 
                  onClick={() => setActiveZoomItem(item)}
                  className="relative aspect-square w-full rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-center justify-center overflow-hidden cursor-pointer group mb-2.5"
                >
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    onError={(e) => {
                      // Fallback to full image if thumbnail is missing
                      if ((e.currentTarget as HTMLImageElement).src !== item.imageUrl) {
                        (e.currentTarget as HTMLImageElement).src = item.imageUrl;
                      }
                    }}
                    className="w-full h-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-105"
                  />
                  {/* Zoom Overlay Indicator */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="p-2 rounded-full bg-slate-900/80 text-white border border-slate-700/60 shadow-lg">
                      <ZoomIn className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Title */}
                <div className="mb-3 flex-1">
                  <p 
                    className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug"
                    title={item.title}
                  >
                    {item.title}
                  </p>
                </div>

                {/* Action Buttons: Keep vs Delete */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60">
                  <button
                    type="button"
                    onClick={() => setChoice(item.designId, 'keep')}
                    className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      currentChoice === 'keep'
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/50'
                        : 'bg-slate-800/80 hover:bg-emerald-950/50 text-slate-400 hover:text-emerald-300 border border-slate-700/50'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Behalten
                  </button>

                  <button
                    type="button"
                    onClick={() => setChoice(item.designId, 'delete')}
                    className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      currentChoice === 'delete'
                        ? 'bg-rose-600 text-white shadow-sm shadow-rose-950/50'
                        : 'bg-slate-800/80 hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 border border-slate-700/50'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Löschen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox / Zoom Modal */}
      {activeZoomItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn"
          onClick={() => setActiveZoomItem(null)}
        >
          <div 
            className="relative max-w-4xl w-full max-h-[90vh] bg-surface rounded-2xl border border-slate-700/80 shadow-2xl p-6 flex flex-col items-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white line-clamp-1">{activeZoomItem.title}</h3>
                <span className="text-xs font-mono text-slate-400">Design-ID: #{activeZoomItem.designId}</span>
              </div>
              <button
                onClick={() => setActiveZoomItem(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* High-Res Image Display */}
            <div className="flex-1 w-full max-h-[60vh] flex items-center justify-center p-4 bg-slate-950/90 rounded-xl border border-slate-800/80 mb-4 overflow-hidden">
              <img
                src={activeZoomItem.imageUrl}
                alt={activeZoomItem.title}
                className="max-w-full max-h-full object-contain"
              />
            </div>

            {/* Modal Actions */}
            <div className="w-full flex items-center justify-between pt-2">
              <a
                href={`https://merch.amazon.com/designs/${activeZoomItem.designId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Amazon Merch Seite
              </a>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setChoice(activeZoomItem.designId, 'keep');
                    setActiveZoomItem(null);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    choices[activeZoomItem.designId] === 'keep'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 hover:bg-emerald-950/60 text-slate-300 hover:text-emerald-300 border border-slate-700'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  Behalten
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setChoice(activeZoomItem.designId, 'delete');
                    setActiveZoomItem(null);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    choices[activeZoomItem.designId] === 'delete'
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  Löschen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Resetting Reviewed List */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Behalten-Liste leeren?</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Es sind aktuell <strong>{totalReviewed}</strong> Designs in deiner Behalten-Liste vermerkt.
              Wenn du die Liste zurücksetzt, können diese Designs bei künftigen Scans erneut zur Prüfung vorgeschlagen werden.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleResetReviewed}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-rose-950/40"
              >
                Ja, Liste leeren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

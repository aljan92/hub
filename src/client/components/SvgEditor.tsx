import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Palette, 
  Sparkles, 
  Trash2, 
  RotateCcw, 
  Undo2, 
  ZoomIn, 
  ZoomOut, 
  Check, 
  MousePointer, 
  AlertCircle,
  RefreshCw
} from 'lucide-react';

export type SvgTool = 'remove-color' | 'remove-connected' | 'none';
export type SvgBackgroundMode = 'checkerboard' | 'dark' | 'black' | 'white' | 'grey';

interface SvgEditorProps {
  taskId: string;
  initialSvgContent?: string;
  onSave?: (editedSvgContent: string) => void;
  onApprove?: (editedSvgContent: string) => void;
  isSaving?: boolean;
}

// Clean XML declaration, DOCTYPE and redundant wrapper noise from raw SVG
const cleanSvgString = (raw: string | undefined | null): string => {
  if (!raw) return '';
  return raw
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim();
};

export const SvgEditor: React.FC<SvgEditorProps> = ({
  taskId,
  initialSvgContent,
  onSave,
  onApprove,
  isSaving = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>(cleanSvgString(initialSvgContent));
  const [activeTool, setActiveTool] = useState<SvgTool>('remove-color');
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [bgMode, setBgMode] = useState<SvgBackgroundMode>('checkerboard');
  const [zoom, setZoom] = useState<number>(1.0);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // References to keep event handlers fresh without re-binding
  const selectedElementsRef = useRef<Element[]>([]);
  const activeToolRef = useRef<SvgTool>(activeTool);
  activeToolRef.current = activeTool;

  // Show Toast
  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // Fetch SVG from API
  const fetchSvg = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/designs/svg/${encodeURIComponent(taskId)}`);
      if (!res.ok) {
        throw new Error(`SVG konnte nicht geladen werden (${res.status})`);
      }
      const text = await res.text();
      const cleaned = cleanSvgString(text);
      if (!cleaned || !cleaned.includes('<svg')) {
        throw new Error('Ungültiges SVG-Format empfangen');
      }
      setSvgContent(cleaned);
      if (onSave) onSave(cleaned);
    } catch (err: any) {
      console.warn('[SvgEditor] Load error:', err);
      setLoadError(err.message || 'Fehler beim Laden des SVGs');
    } finally {
      setLoading(false);
    }
  }, [taskId, onSave]);

  // Synchronize when initialSvgContent or taskId prop changes
  useEffect(() => {
    if (initialSvgContent && initialSvgContent.includes('<svg')) {
      setSvgContent(cleanSvgString(initialSvgContent));
      setLoading(false);
      setLoadError(null);
    } else {
      fetchSvg();
    }
    clearSelection();
    setUndoStack([]);
  }, [taskId, initialSvgContent]);

  // Color normalization and tolerant matching (from MBA Manager)
  const parseColorToRGB = (colorStr: string | null): { r: number; g: number; b: number } | null => {
    if (!colorStr || colorStr === 'none' || colorStr === 'transparent') return null;
    let s = colorStr.trim().toLowerCase();

    if (s.startsWith('#')) {
      let hex = s.substring(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length === 6) {
        return {
          r: parseInt(hex.substring(0, 2), 16),
          g: parseInt(hex.substring(2, 4), 16),
          b: parseInt(hex.substring(4, 6), 16)
        };
      }
    }

    const rgbMatch = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10)
      };
    }
    return null;
  };

  const colorsMatch = (color1: string | null, color2: string | null, tolerance: number = 25): boolean => {
    if (!color1 || !color2) return false;
    if (color1 === color2) return true;

    const p1 = parseColorToRGB(color1);
    const p2 = parseColorToRGB(color2);

    if (p1 && p2) {
      return Math.abs(p1.r - p2.r) <= tolerance &&
             Math.abs(p1.g - p2.g) <= tolerance &&
             Math.abs(p1.b - p2.b) <= tolerance;
    }
    return color1.toLowerCase() === color2.toLowerCase();
  };

  const getElementFill = (el: Element): string | null => {
    if (el.hasAttribute('fill')) {
      const f = el.getAttribute('fill');
      if (f && f !== 'none' && f !== 'transparent' && f !== 'rgba(0, 0, 0, 0)') return f;
    }
    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      const match = styleAttr.match(/fill\s*:\s*([^;]+)/);
      if (match && match[1] && match[1].trim() !== 'none') return match[1].trim();
    }
    try {
      const comp = window.getComputedStyle(el).fill;
      if (comp && comp !== 'none' && comp !== 'transparent' && comp !== 'rgba(0, 0, 0, 0)') return comp;
    } catch {}
    return null;
  };

  const isElementSafeToRemove = (el: Element): boolean => {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (['svg', 'html', 'body', 'head', 'script', 'style', 'defs', 'clippath'].includes(tag)) return false;
    return true;
  };

  // Push state to undo stack
  const saveState = useCallback(() => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (svgEl) {
      const current = svgEl.outerHTML;
      setUndoStack(prev => [...prev.slice(-19), current]);
    }
  }, []);

  // Clear selections
  const clearSelection = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.querySelectorAll('.highlighted-element').forEach(el => {
      el.classList.remove('highlighted-element');
    });
    selectedElementsRef.current = [];
    setSelectedCount(0);
    setSelectedColor(null);
  }, []);

  // Update current SVG state from DOM
  const syncSvgFromDom = useCallback(() => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (svgEl) {
      const raw = svgEl.outerHTML;
      setSvgContent(raw);
      if (onSave) onSave(raw);
    }
  }, [onSave]);

  // Remove selected elements
  const removeSelectedElements = useCallback(() => {
    const elements = selectedElementsRef.current;
    if (elements.length === 0) return;

    saveState();
    let count = 0;

    elements.forEach(el => {
      if (!isElementSafeToRemove(el)) return;
      if (el.hasAttribute('fill')) {
        el.setAttribute('fill', 'none');
        count++;
      } else if ((el as HTMLElement).style?.fill) {
        (el as HTMLElement).style.fill = 'none';
        count++;
      } else {
        el.remove();
        count++;
      }
    });

    clearSelection();
    syncSvgFromDom();
    showToast('success', `${count} Element(e) entfernt.`);
  }, [saveState, clearSelection, syncSvgFromDom]);

  // Auto BG Remove (Top-Left Corner Background Remover from MBA Manager)
  const handleAutoBgRemove = useCallback(() => {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) {
      showToast('error', 'Kein SVG geladen.');
      return;
    }

    try {
      const svgBBox = svg.getBBox();
      let topLeftElement: Element | null = null;
      let minDistance = Infinity;

      svg.querySelectorAll('*').forEach(el => {
        if (!isElementSafeToRemove(el)) return;
        try {
          const bbox = (el as SVGGraphicsElement).getBBox();
          if (bbox.width > 0 || bbox.height > 0) {
            const dist = Math.sqrt(Math.pow(bbox.x - svgBBox.x, 2) + Math.pow(bbox.y - svgBBox.y, 2));
            if (dist < minDistance) {
              topLeftElement = el;
              minDistance = dist;
            }
          }
        } catch {}
      });

      if (!topLeftElement) {
        showToast('error', 'Kein Hintergrundelement in der oberen linken Ecke gefunden.');
        return;
      }

      const targetColor = getElementFill(topLeftElement);
      if (!targetColor) {
        showToast('error', 'Hintergrund an der Ecke hat keine erfassbare Farbe.');
        return;
      }

      saveState();

      let removedCount = 0;
      svg.querySelectorAll('*').forEach(el => {
        if (!isElementSafeToRemove(el)) return;
        const fill = getElementFill(el);
        if (fill && colorsMatch(fill, targetColor, 25)) {
          if (el.hasAttribute('fill')) {
            el.setAttribute('fill', 'none');
          } else {
            el.remove();
          }
          removedCount++;
        }
      });

      clearSelection();
      syncSvgFromDom();
      showToast('success', `Auto BG: Hintergrund (${removedCount} Elemente) entfernt.`);
    } catch (e: any) {
      showToast('error', `Fehler beim Auto BG Remove: ${e.message}`);
    }
  }, [saveState, clearSelection, syncSvgFromDom]);

  // Undo
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(prevStack => prevStack.slice(0, -1));
    setSvgContent(prev);
    clearSelection();
    if (onSave) onSave(prev);
    showToast('success', 'Rückgängig gemacht.');
  }, [undoStack, clearSelection, onSave]);

  // Reset to original
  const handleReset = async () => {
    if (!confirm('Möchtest du alle Bearbeitungen verwerfen und das Original-SVG wiederherstellen?')) return;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/reset-svg`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success && data.svgContent) {
        saveState();
        const cleaned = cleanSvgString(data.svgContent);
        setSvgContent(cleaned);
        clearSelection();
        if (onSave) onSave(cleaned);
        showToast('success', 'SVG auf Originalzustand zurückgesetzt.');
      } else {
        showToast('error', data.error || 'Fehler beim Zurücksetzen');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Verbindungsfehler beim Reset');
    }
  };

  // Click on SVG element handler
  const handleElementClick = useCallback((e: MouseEvent) => {
    const target = e.target as Element;
    if (!target || !containerRef.current?.contains(target)) return;
    if (!isElementSafeToRemove(target)) return;

    e.preventDefault();
    e.stopPropagation();

    const tool = activeToolRef.current;
    if (tool === 'none') return;

    // Shift + Click: Toggle single element
    if (e.shiftKey) {
      if (selectedElementsRef.current.includes(target)) {
        target.classList.remove('highlighted-element');
        selectedElementsRef.current = selectedElementsRef.current.filter(el => el !== target);
      } else {
        target.classList.add('highlighted-element');
        selectedElementsRef.current.push(target);
      }
      setSelectedCount(selectedElementsRef.current.length);
      return;
    }

    const fill = getElementFill(target);
    if (!fill) return;

    setSelectedColor(fill);

    if (tool === 'remove-color') {
      // Normal click: Select all elements of same color
      clearSelection();
      const svg = containerRef.current?.querySelector('svg');
      if (!svg) return;

      const matched: Element[] = [];
      svg.querySelectorAll('*').forEach(el => {
        if (!isElementSafeToRemove(el)) return;
        const elFill = getElementFill(el);
        if (elFill && colorsMatch(elFill, fill, 25)) {
          el.classList.add('highlighted-element');
          matched.push(el);
        }
      });
      selectedElementsRef.current = matched;
      setSelectedCount(matched.length);
    } else if (tool === 'remove-connected') {
      // Normal click: Select only this connected element (Vectorizer cutout)
      clearSelection();
      target.classList.add('highlighted-element');
      selectedElementsRef.current = [target];
      setSelectedCount(1);
    }
  }, [clearSelection]);

  // Bind DOM events to SVG elements whenever svgContent renders
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Attach click listeners to all clickable vector shapes
    const handleClick = (e: Event) => handleElementClick(e as MouseEvent);
    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [svgContent, handleElementClick]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedElementsRef.current.length > 0) {
          e.preventDefault();
          removeSelectedElements();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [removeSelectedElements, handleUndo]);

  const bgClasses: Record<SvgBackgroundMode, string> = {
    checkerboard: 'bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] bg-slate-950',
    dark: 'bg-slate-900',
    black: 'bg-black',
    white: 'bg-white',
    grey: 'bg-slate-400'
  };

  return (
    <div className="space-y-3.5">
      {/* Toast */}
      {notification && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold flex items-center space-x-2 transition-all transform animate-in slide-in-from-top-2 ${
          notification.type === 'success' 
            ? 'bg-slate-900 text-emerald-300 border-emerald-500/40' 
            : 'bg-slate-900 text-rose-300 border-rose-500/40'
        }`}>
          {notification.type === 'success' ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Editor Main Toolbar */}
      <div className="bg-slate-900/95 p-2.5 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
        {/* Left: Tools */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={() => setActiveTool('remove-color')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center space-x-1.5 transition-all ${
              activeTool === 'remove-color'
                ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
            title="Wählt alle Flächen der gleichen Farbe in der gesamten Grafik aus (inkl. toleranten Farbtönen)"
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Remove Color</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('remove-connected')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center space-x-1.5 transition-all ${
              activeTool === 'remove-connected'
                ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
            title="Wählt nur die angeklickte zusammenhängende Vektorfläche aus"
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>Remove Connected</span>
          </button>

          <button
            type="button"
            onClick={handleAutoBgRemove}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center space-x-1.5 transition-all shadow-sm"
            title="Erkennt automatisch die Hintergrundfarbe an der oberen linken Ecke und entfernt sie"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Auto BG Remove</span>
          </button>
        </div>

        {/* Center: Selected Stats & Delete Button */}
        <div className="flex items-center space-x-2">
          {selectedCount > 0 && (
            <div className="flex items-center space-x-2 bg-slate-950 px-2.5 py-1 rounded-lg border border-rose-500/30">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-xs font-mono text-rose-300">{selectedCount} gewählt</span>
              {selectedColor && (
                <div 
                  className="w-3.5 h-3.5 rounded border border-slate-700" 
                  style={{ backgroundColor: selectedColor }} 
                  title={`Farbe: ${selectedColor}`}
                />
              )}
              <button
                type="button"
                onClick={removeSelectedElements}
                className="px-2.5 py-0.5 rounded text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center space-x-1 transition-all shadow"
                title="Ausgewählte Elemente entfernen (Shortcut: Backspace / Entf)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Löschen</span>
                <span className="text-[9px] opacity-75 font-mono ml-0.5">⌫</span>
              </button>
            </div>
          )}

          {/* Undo & Reset */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition-all"
            title="Rückgängig (Cmd + Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
            title="Auf Original-SVG zurücksetzen"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Background Canvas Switcher & Zoom */}
        <div className="flex items-center space-x-2">
          {/* Background switcher */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {(['checkerboard', 'dark', 'black', 'white', 'grey'] as SvgBackgroundMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setBgMode(m)}
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] uppercase font-bold transition-all ${
                  bgMode === m ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Hintergrund: ${m}`}
              >
                {m[0]}
              </button>
            ))}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Verkleinern"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono text-[10px] text-slate-300 w-8 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(3.0, Number((z + 0.2).toFixed(1))))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Vergrößern"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            {zoom !== 1.0 && (
              <button
                type="button"
                onClick={() => setZoom(1.0)}
                className="text-[9px] font-mono text-cyan-400 hover:text-cyan-300 px-1"
                title="100% Reset"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div 
        className={`relative w-full h-[520px] rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center transition-colors p-4 ${bgClasses[bgMode]}`}
      >
        {loading ? (
          <div className="flex flex-col items-center space-y-2 text-slate-500">
            <div className="w-7 h-7 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">Lade SVG-Vektorgrafik...</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center space-y-3 text-center max-w-sm">
            <AlertCircle className="w-8 h-8 text-amber-400" />
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-200 block">Vektorgrafik nicht gefunden</span>
              <p className="text-[11px] text-slate-400">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={fetchSvg}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 shadow"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Erneut versuchen</span>
            </button>
          </div>
        ) : svgContent ? (
          <div 
            ref={containerRef}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease-out' }}
            className={`svg-editor-container ${activeTool !== 'none' ? 'tool-active' : ''} w-full h-full flex items-center justify-center`}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="flex flex-col items-center space-y-2 text-slate-500">
            <span className="text-xs">Keine Vektorgrafik verfügbar.</span>
            <button
              type="button"
              onClick={fetchSvg}
              className="px-3 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            >
              Neu laden
            </button>
          </div>
        )}

        {/* Hint footer overlay */}
        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-slate-400 bg-slate-950/85 px-2.5 py-1 rounded border border-slate-800/80 pointer-events-none shadow-sm flex items-center space-x-2">
          <span>Klick = Auswählen</span>
          <span>•</span>
          <span>Shift + Klick = Mehrfachauswahl</span>
          <span>•</span>
          <span>Backspace = Löschen</span>
          <span>•</span>
          <span>Cmd+Z = Undo</span>
        </div>
      </div>

      {/* Embedded CSS for Highlighting & Interactive Hover */}
      <style>{`
        .svg-editor-container {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .svg-editor-container svg {
          max-width: 100%;
          max-height: 480px;
          width: 100%;
          height: 100%;
          object-fit: contain;
          user-select: none;
          display: block;
          margin: auto;
        }

        /* Pulsierender roter Glow für ausgewählte Vektorelemente (aus MBA Manager) */
        .svg-editor-container .highlighted-element {
          stroke: #ff0000 !important;
          stroke-width: 3px !important;
          stroke-opacity: 1.0 !important;
          filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.9));
          animation: svgPulse 1.2s infinite ease-in-out;
        }

        /* Blauer Hover-Rahmen beim Überfahren mit aktiven Tools */
        .svg-editor-container.tool-active path:hover,
        .svg-editor-container.tool-active rect:hover,
        .svg-editor-container.tool-active circle:hover,
        .svg-editor-container.tool-active polygon:hover,
        .svg-editor-container.tool-active polyline:hover {
          stroke: #0088ff !important;
          stroke-width: 2px !important;
          stroke-opacity: 0.85 !important;
          cursor: crosshair;
        }

        @keyframes svgPulse {
          0% { stroke-opacity: 1.0; filter: drop-shadow(0 0 4px rgba(255, 0, 0, 0.8)); }
          50% { stroke-opacity: 0.4; filter: drop-shadow(0 0 1px rgba(255, 0, 0, 0.4)); }
          100% { stroke-opacity: 1.0; filter: drop-shadow(0 0 4px rgba(255, 0, 0, 0.8)); }
        }
      `}</style>
    </div>
  );
};

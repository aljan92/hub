import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Globe, 
  RotateCw, 
  ArrowLeft, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles, 
  Monitor, 
  UploadCloud, 
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export type BrowserSessionType = 'sync' | 'upload';

interface BrowserScreencastProps {
  onClose?: () => void;
}

export const BrowserScreencast: React.FC<BrowserScreencastProps> = () => {
  const [activeSession, setActiveSession] = useState<BrowserSessionType>('sync');
  const [urlInput, setUrlInput] = useState<string>('https://merch.amazon.com/dashboard');
  const [currentUrl, setCurrentUrl] = useState<string>('https://merch.amazon.com/dashboard');
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasReceivedFrame, setHasReceivedFrame] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsCheckRef = useRef<number>(Date.now());
  const activeSessionRef = useRef<BrowserSessionType>(activeSession);

  // Keep ref synchronized
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // Frame Cache per session for 0ms instant tab switching
  const cachedFramesRef = useRef<Record<BrowserSessionType, string | null>>({ sync: null, upload: null });

  // FPS Counter
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFpsCheckRef.current) / 1000;
      if (elapsed >= 1) {
        setFps(Math.round(frameCountRef.current / elapsed));
        frameCountRef.current = 0;
        lastFpsCheckRef.current = now;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Send WS Event helper
  const sendWsEvent = useCallback((type: string, payload: any = {}, explicitSession?: BrowserSessionType) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type,
        session: explicitSession || activeSessionRef.current,
        payload
      }));
    }
  }, []);

  // Initialize WebSocket connection for Screencast
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Trigger session initialization for both sessions
      sendWsEvent('BROWSER_INIT', {}, 'sync');
      sendWsEvent('BROWSER_INIT', {}, 'upload');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'BROWSER_FRAME') {
          const { session, data, metadata } = msg.payload;
          if (session) {
            cachedFramesRef.current[session as BrowserSessionType] = data;
          }
          if (session === activeSessionRef.current && canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                setHasReceivedFrame(true);
                frameCountRef.current += 1;
              };
              img.src = 'data:image/jpeg;base64,' + data;
            }
          }
        }
      } catch (err) {
        // Ignore JSON parse errors
      }
    };

    return () => {
      ws.close();
    };
  }, [sendWsEvent]);

  // Switch session tab instantly with cached frame rendering
  const handleSessionChange = (newSession: BrowserSessionType) => {
    setActiveSession(newSession);
    activeSessionRef.current = newSession;

    const cached = cachedFramesRef.current[newSession];
    if (cached && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setHasReceivedFrame(true);
        };
        img.src = 'data:image/jpeg;base64,' + cached;
      }
    } else {
      setHasReceivedFrame(false);
    }
    sendWsEvent('BROWSER_INIT', {}, newSession);
  };

  // Convert canvas event coordinates to remote 1440x900 browser coordinates with exact aspect ratio compensation
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    const cw = canvas.width;  // 1440
    const ch = canvas.height; // 900
    const rw = rect.width;
    const rh = rect.height;

    const scale = Math.min(rw / cw, rh / ch);
    const renderedW = cw * scale;
    const renderedH = ch * scale;

    const offsetX = (rw - renderedW) / 2;
    const offsetY = (rh - renderedH) / 2;

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const x = Math.max(0, Math.min(cw, (clientX - offsetX) / scale));
    const y = Math.max(0, Math.min(ch, (clientY - offsetY) / scale));

    return { x, y };
  };

  // Mouse Input Dispatchers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendWsEvent('BROWSER_MOUSE', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount: 1
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendWsEvent('BROWSER_MOUSE', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount: 1
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    sendWsEvent('BROWSER_MOUSE', {
      type: 'mouseMoved',
      x,
      y
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    sendWsEvent('BROWSER_MOUSE', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: e.deltaX,
      deltaY: e.deltaY
    });
  };

  // Keyboard Input Dispatchers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    // Prevent standard browser shortcuts from intercepting
    if (['Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }

    sendWsEvent('BROWSER_KEY', {
      type: 'keyDown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      text: e.key.length === 1 ? e.key : undefined
    });
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    sendWsEvent('BROWSER_KEY', {
      type: 'keyUp',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode
    });
  };

  // Navigation handlers
  const handleNavigate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let url = urlInput.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    setCurrentUrl(url);
    sendWsEvent('BROWSER_NAVIGATE', { url });
  };

  const handleReload = () => {
    sendWsEvent('BROWSER_RELOAD', {});
  };

  const handleBack = () => {
    sendWsEvent('BROWSER_BACK', {});
  };

  const handleForward = () => {
    sendWsEvent('BROWSER_FORWARD', {});
  };

  // Restart session
  const handleRestart = async () => {
    setIsRestarting(true);
    setToastMessage(null);
    try {
      const res = await fetch('/api/v1/browser/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: activeSession })
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage(`✓ ${activeSession === 'sync' ? 'Session 1 (Sync & Login)' : 'Session 2 (Upload Worker)'} frisch gestartet!`);
        setTimeout(() => setToastMessage(null), 3500);
      } else {
        setToastMessage(`Info: ${data.message}`);
        setTimeout(() => setToastMessage(null), 5000);
      }
    } catch (err: any) {
      setToastMessage(`Fehler beim Neustart: ${err.message}`);
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setIsRestarting(false);
    }
  };

  // Handle direct text send helper (for passwords, 2FA codes, or long strings)
  const [directText, setDirectText] = useState('');
  const handleSendDirectText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!directText) return;
    for (const char of directText) {
      sendWsEvent('BROWSER_KEY', {
        type: 'keyDown',
        key: char,
        text: char
      });
    }
    setDirectText('');
  };

  // Direct paste handler
  const handlePaste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    const text = e.clipboardData.getData('text');
    if (text) {
      for (const char of text) {
        sendWsEvent('BROWSER_KEY', {
          type: 'keyDown',
          key: char,
          text: char
        });
      }
    }
  };

  return (
    <div 
      className="flex flex-col h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl focus:outline-none"
    >
      {/* Top Header & Session Selector */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 gap-3">
        {/* Session Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-950/70 rounded-lg border border-slate-800">
          <button
            onClick={() => handleSessionChange('sync')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeSession === 'sync'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Session 1: Sync & Login</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Keep-Alive aktiv" />
          </button>

          <button
            onClick={() => handleSessionChange('upload')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeSession === 'upload'
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Session 2: Upload Worker</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">Shared</span>
          </button>
        </div>

        {/* Security & Status Badges */}
        <div className="flex items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Mac Chrome Stealth</span>
          </div>

          <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>{fps > 0 ? `${fps} FPS` : 'Live'}</span>
          </div>

          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-md text-xs font-medium transition shadow-sm disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRestarting ? 'animate-spin' : ''}`} />
            <span>{isRestarting ? 'Wird neu gestartet...' : 'Chrome neu starten'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/60 border-b border-slate-800/80">
        <div className="flex items-center gap-1">
          <button 
            onClick={handleBack} 
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition" 
            title="Zurück"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={handleForward} 
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition" 
            title="Vorwärts"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button 
            onClick={handleReload} 
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition" 
            title="Seite neu laden"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* URL Input Form */}
        <form onSubmit={handleNavigate} className="flex-1 flex items-center relative">
          <div className="absolute left-3 text-slate-500">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full pl-8 pr-16 py-1 bg-slate-950/80 border border-slate-700/80 rounded-md text-xs text-slate-200 focus:outline-none focus:border-amber-500/50 font-mono transition"
            placeholder="URL eingeben und Enter drücken..."
          />
          <button
            type="submit"
            className="absolute right-1.5 px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px] font-mono transition"
          >
            Öffnen
          </button>
        </form>

        {/* Quick Target Links & Submit Action */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => sendWsEvent('BROWSER_SUBMIT', {})}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded shadow transition active:scale-95"
            title="Klickt automatisch auf Sign In / Weiter / Absenden"
          >
            <span>⚡ Sign In / Absenden</span>
          </button>

          <button
            onClick={() => { setUrlInput('https://merch.amazon.com/dashboard'); sendWsEvent('BROWSER_NAVIGATE', { url: 'https://merch.amazon.com/dashboard' }); }}
            className="hidden sm:inline-block px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-medium transition"
          >
            Dashboard
          </button>
          <button
            onClick={() => { setUrlInput('https://merch.amazon.com/manage/products'); sendWsEvent('BROWSER_NAVIGATE', { url: 'https://merch.amazon.com/manage/products' }); }}
            className="hidden md:inline-block px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-medium transition"
          >
            Designs
          </button>
          <button
            onClick={() => { setUrlInput('https://merch.amazon.com/create'); sendWsEvent('BROWSER_NAVIGATE', { url: 'https://merch.amazon.com/create' }); }}
            className="hidden md:inline-block px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-medium transition"
          >
            Upload
          </button>
        </div>
      </div>

      {/* Toast Feedback Message */}
      {toastMessage && (
        <div className="px-4 py-2 bg-emerald-950/90 border-b border-emerald-800/80 text-emerald-300 text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Live Screencast Viewport */}
      <div 
        className="flex-1 relative flex items-center justify-center bg-black overflow-hidden select-none cursor-default"
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          width={1440}
          height={900}
          onMouseDown={(e) => {
            canvasRef.current?.focus();
          }}
          onClick={(e) => {
            const { x, y } = getCanvasCoords(e);
            sendWsEvent('BROWSER_MOUSE', {
              type: 'click',
              x,
              y,
              button: e.button === 2 ? 'right' : 'left'
            });
          }}
          onMouseMove={handleMouseMove}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          className="w-full h-full object-contain max-h-full outline-none focus:ring-1 focus:ring-amber-500/50"
        />

        {/* Loading / Connecting Overlay */}
        {!hasReceivedFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm z-10 gap-3">
            <div className="w-10 h-10 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-200">
                Verbinde mit {activeSession === 'sync' ? 'Session 1 (Sync & Login)' : 'Session 2 (Upload Worker)'}...
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Mac Chrome Stealth Profile wird initialisiert (Port 3000 WebSocket Stream)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info & Quick Input Helper Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-slate-950 border-t border-slate-800/80 text-[11px] text-slate-400 gap-2">
        {/* Quick Direct Text / Password Sender */}
        <form onSubmit={handleSendDirectText} className="flex items-center gap-1.5 flex-1 max-w-md">
          <input
            type="text"
            value={directText}
            onChange={(e) => setDirectText(e.target.value)}
            placeholder="Text / Passwort / 2FA-Code hier einfügen und Senden..."
            className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-700/80 rounded text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition"
          >
            Tippen
          </button>
        </form>

        <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
          <span>Klick in Canvas = Fokus aktiv</span>
          <span>•</span>
          <span>Profile: ./data/chrome-profile</span>
        </div>
      </div>
    </div>
  );
};

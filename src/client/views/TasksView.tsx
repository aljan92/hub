import React, { useState, useEffect } from 'react';
import { 
  CheckSquare, 
  Sparkles, 
  Bot, 
  ShieldCheck, 
  ShieldAlert,
  CheckCircle2, 
  XCircle,
  AlertCircle,
  AlertTriangle,
  Eye, 
  Edit3,
  Sliders,
  RefreshCw, 
  Zap, 
  RotateCcw, 
  Maximize2, 
  Download, 
  Trash2, 
  Search,
  Check,
  FileText
} from 'lucide-react';

import { DesignTaskLog } from '../../types/tasks';

// ---------------------------------------------------------------------------
// Helper: Detailed Word-by-Word Trademark Hits Display per Field
// ---------------------------------------------------------------------------
interface FieldTmWordChipsProps {
  label: string;
  fieldData?: any;
}

const FieldTmWordChips: React.FC<FieldTmWordChipsProps> = ({ label, fieldData }) => {
  if (!fieldData) return null;

  const totalHits = fieldData.totalHits ?? 0;
  const hasK25 = Boolean(fieldData.hasInfringementClass25 || fieldData.hasClass25);
  const rawHits = fieldData.hits || {};

  // If 0 hits, show a clean "Sauber" indicator
  if (totalHits === 0) {
    return (
      <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400 font-medium pt-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Keine Markentreffer in {label} (0 Treffer)</span>
      </div>
    );
  }

  // Normalize hits into array of { term, hits: any[] }
  let termList: { term: string; hits: any[] }[] = [];
  if (Array.isArray(rawHits)) {
    const grouped: Record<string, any[]> = {};
    rawHits.forEach((h: any) => {
      const t = h.term || h.wordmark || h.trademark || 'term';
      grouped[t] = grouped[t] || [];
      grouped[t].push(h);
    });
    termList = Object.entries(grouped).map(([term, hits]) => ({ term, hits }));
  } else if (typeof rawHits === 'object' && rawHits !== null) {
    termList = Object.entries(rawHits).map(([term, hits]) => ({
      term,
      hits: Array.isArray(hits) ? hits : [hits]
    }));
  }

  return (
    <div className={`p-3 rounded-xl border space-y-2 mt-1.5 ${
      hasK25 
        ? 'bg-rose-950/25 border-rose-500/40 text-rose-200' 
        : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
    }`}>
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <div className="flex items-center space-x-1.5">
          {hasK25 ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span>{totalHits} Markentreffer in {label} {hasK25 ? '(Klasse 25 Bekleidung!)' : '(Nebenklassen)'}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          hasK25 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
        }`}>
          {hasK25 ? 'Klasse 25 Konflikt' : 'Nebenklasse'}
        </span>
      </div>

      {/* Word-by-Word Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
        {termList.map(({ term, hits }, i) => {
          const isK25 = hits.some(h => String(h.classNumber || h.class_id || h.class) === '25');
          const classes = Array.from(new Set(hits.map(h => String(h.classNumber || h.class_id || h.class || '25')))).join(', ');
          const firstHit = hits[0] || {};
          const markName = firstHit.trademark || firstHit.wordmark || firstHit.mark || term;
          const status = firstHit.status || 'LIVE';
          const regOrSerial = firstHit.registrationNumber || firstHit.serialNumber || '';

          return (
            <div
              key={i}
              className={`p-2.5 rounded-lg border text-xs font-mono flex flex-col gap-1 transition-all ${
                isK25 
                  ? 'bg-rose-950/60 border-rose-500/50 text-rose-100 ring-1 ring-rose-500/30' 
                  : 'bg-slate-900 border-amber-500/40 text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white text-xs underline decoration-dotted underline-offset-2">
                  "{term}"
                </span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                  isK25 ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                }`}>
                  Klasse {classes}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between gap-2">
                <span className="truncate max-w-[180px]" title={markName}>Marke: {markName}</span>
                <span className="shrink-0">{status} {regOrSerial ? `• #${regOrSerial}` : ''}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<DesignTaskLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [filter, setFilter] = useState<'ALL' | 'PRE_FLIGHT' | 'DESIGN' | 'TRADEMARK'>('ALL');
  const [aiAutonomyEnabled, setAiAutonomyEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Checkpoint 1 (Pre-Flight) State
  const [editQuote, setEditQuote] = useState('');

  // Checkpoint 2 (Design Review) State
  const [selectedAudience, setSelectedAudience] = useState('Men, Women');
  const [selectedAvoidColor, setSelectedAvoidColor] = useState('Keine');
  const [selectedBgMode, setSelectedBgMode] = useState('Nein (Auto Freistellen)');
  const [editablePrompt, setEditablePrompt] = useState('');
  const [showImageZoom, setShowImageZoom] = useState(false);

  // Checkpoint 3 (Trademark Review) State
  const [editableListing, setEditableListing] = useState({
    brand: '',
    title: '',
    bullet1: '',
    bullet2: '',
    description: ''
  });
  const [liveTmResult, setLiveTmResult] = useState<any>(null);
  const [isCheckingTm, setIsCheckingTm] = useState(false);

  // Helper to extract listing fields safely from all sources
  const extractListingFields = (task?: DesignTaskLog) => {
    if (!task) return { brand: '', title: '', bullet1: '', bullet2: '', description: '' };

    let lr: any = task.listingResult;
    if (typeof lr === 'string') {
      try {
        let clean = lr.trim();
        if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        lr = JSON.parse(clean);
      } catch {}
    }

    const en = (lr && typeof lr === 'object') ? (lr.en || lr) : {};
    const refined = task.trademarkRefineResult?.refined_listing || {};

    let brand = refined.brand || en.brand || en.brandName || '';
    let title = refined.title || en.title || en.designTitle || '';
    let bullet1 = refined.bullet1 || en.bullet1 || en.bullet_1 || en.featureBullet1 || en.feature_bullet1 || '';
    let bullet2 = refined.bullet2 || en.bullet2 || en.bullet_2 || en.featureBullet2 || en.feature_bullet2 || '';
    let description = refined.description || en.description || en.product_description || en.productDescription || en.desc || '';

    // Fallback scan across task events
    if ((!description || !title) && Array.isArray(task.events)) {
      for (let i = task.events.length - 1; i >= 0; i--) {
        const ev = task.events[i];
        if (ev.type === 'TM_REFINE_RESPONSE' && ev.content?.refined_listing) {
          brand = brand || ev.content.refined_listing.brand || '';
          title = title || ev.content.refined_listing.title || '';
          bullet1 = bullet1 || ev.content.refined_listing.bullet1 || '';
          bullet2 = bullet2 || ev.content.refined_listing.bullet2 || '';
          description = description || ev.content.refined_listing.description || '';
        }
        if (ev.type === 'LISTING_RESPONSE' && ev.content) {
          const listObj = ev.content.en || ev.content;
          if (typeof listObj === 'object' && listObj !== null) {
            brand = brand || listObj.brand || '';
            title = title || listObj.title || '';
            bullet1 = bullet1 || listObj.bullet1 || '';
            bullet2 = bullet2 || listObj.bullet2 || '';
            description = description || listObj.description || listObj.product_description || '';
          }
        }
      }
    }

    return { brand, title, bullet1, bullet2, description };
  };

  // Fetch Tasks
  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tasks');
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        if (data.tasks.length > 0) {
          if (!selectedTaskId || !data.tasks.find((t: DesignTaskLog) => t.id === selectedTaskId)) {
            setSelectedTaskId(data.tasks[0].id);
          }
        } else {
          setSelectedTaskId('');
        }
      }
    } catch (err) {
      console.warn('[Tasks] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/v1/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        setAiAutonomyEnabled(Boolean(data.settings.aiAutonomyEnabled));
      }
    } catch (e) {}
  };

  const toggleAiAutonomy = async () => {
    const newVal = !aiAutonomyEnabled;
    setAiAutonomyEnabled(newVal);
    try {
      await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAutonomyEnabled: newVal })
      });
      showNotification('success', newVal ? 'KI-Autonomie aktiviert' : 'Human-in-the-Loop aktiviert');
    } catch (err) {
      showNotification('error', 'Fehler beim Speichern der Einstellung');
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    fetchTasks();
    fetchSettings();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  const activeTask = tasks.find(t => t.id === selectedTaskId) || tasks[0];

  // Sync active task form fields when selection changes
  useEffect(() => {
    if (activeTask) {
      // Pre-Flight Quote
      setEditQuote(activeTask.payload?.quote || activeTask.payload?.quote_or_phrase || activeTask.payload?.text || '');

      // Design Review fields
      const pred = activeTask.analysisResult;
      const targetGroup = Array.isArray(pred?.target_group?.selected) 
        ? pred.target_group.selected.join(', ') 
        : (pred?.target_group?.selected || 'Men, Women');
      setSelectedAudience(activeTask.customAnswers?.audience || targetGroup);
      setSelectedAvoidColor(activeTask.customAnswers?.avoidColor || pred?.avoid_product_colors?.avoid || 'Keine');
      setSelectedBgMode(activeTask.customAnswers?.reuseBackground || (pred?.background_analysis?.removal_mode === 'MANUAL' ? 'Ja (Hintergrund behalten)' : 'Nein (Auto Freistellen)'));
      setEditablePrompt(activeTask.resultPrompt || activeTask.payload?.quote || '');

      // TM Review Listing fields
      const fields = extractListingFields(activeTask);
      setEditableListing(fields);
      setLiveTmResult(activeTask.trademarkCheckResult || null);
    }
  }, [selectedTaskId, activeTask?.status]);

  // Actions for Checkpoint 1: Pre-Flight
  const handlePreFlightAction = async (action: 'OVERRIDE' | 'RESTART' | 'DISCARD') => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/override-preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, newQuote: editQuote })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        fetchTasks();
      } else {
        showNotification('error', data.error || 'Aktion fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Actions for Checkpoint 2: Design Review
  const handleDesignReview = async (action: 'APPROVE' | 'REGENERATE_IMAGE', useDefaultAiAnswers: boolean = false) => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const answers = useDefaultAiAnswers ? undefined : {
        audience: selectedAudience,
        avoidColor: selectedAvoidColor,
        reuseBackground: selectedBgMode
      };

      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/submit-design-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          answers,
          updatedPrompt: editablePrompt
        })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        fetchTasks();
      } else {
        showNotification('error', data.error || 'Übermittlung fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Actions for Checkpoint 3: Trademark Review
  const handleTmRecheck = async () => {
    if (!activeTask) return;
    setIsCheckingTm(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/submit-tm-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RECHECK',
          refinedListing: editableListing
        })
      });
      const data = await res.json();
      if (data.success) {
        setLiveTmResult(data);
        if (data.hasInfringementClass25) {
          showNotification('error', `${data.totalHits} Treffer in Klasse 25 vorhanden`);
        } else {
          showNotification('success', '0 Treffer in Klasse 25 (Sauber)');
        }
      } else {
        showNotification('error', data.error || 'Prüfung fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      setIsCheckingTm(false);
    }
  };

  const handleTmDecision = async (action: 'APPROVE' | 'REJECT') => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/submit-tm-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          refinedListing: editableListing
        })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        fetchTasks();
      } else {
        showNotification('error', data.error || 'Speichern fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter Tasks
  const filteredTasks = tasks.filter(t => {
    if (filter === 'PRE_FLIGHT') return t.status === 'AWAITING_PRE_FLIGHT_REVIEW';
    if (filter === 'DESIGN') return t.status === 'AWAITING_DESIGN_REVIEW';
    if (filter === 'TRADEMARK') return t.status === 'AWAITING_TM_REVIEW';
    return true;
  });

  const preFlightCount = tasks.filter(t => t.status === 'AWAITING_PRE_FLIGHT_REVIEW').length;
  const designCount = tasks.filter(t => t.status === 'AWAITING_DESIGN_REVIEW').length;
  const tmCount = tasks.filter(t => t.status === 'AWAITING_TM_REVIEW').length;

  // Extract field summaries for Checkpoint 3
  const fieldSummaries = liveTmResult?.fieldSummaries || liveTmResult?.fieldResults || activeTask?.trademarkCheckResult?.fieldSummaries || activeTask?.trademarkCheckResult?.fieldResults || {};

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold flex items-center space-x-2 transition-all transform animate-in slide-in-from-top-2 ${
          notification.type === 'success' 
            ? 'bg-slate-900 text-emerald-300 border-emerald-500/40' 
            : 'bg-slate-900 text-rose-300 border-rose-500/40'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Top Bar Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <CheckSquare className="w-6 h-6 mr-2.5 text-primary-400" />
            Tasks &amp; Review
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Zentraler Prüf- und Freigabe-Workspace für Designs, Trademarks und Listings.
          </p>
        </div>

        {/* AI Autonomy Switch */}
        <div className="flex items-center space-x-3 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2 shadow-sm">
          <div className="w-7 h-7 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-400 border border-primary-500/20">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-semibold text-slate-200">Autonomie</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${aiAutonomyEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                {aiAutonomyEnabled ? 'Aktiv' : 'Aus'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400">Automatische Freigabe bei sauberem Befund</span>
          </div>
          <button
            onClick={toggleAiAutonomy}
            className={`w-10 h-5 rounded-full transition-colors relative ml-2 ${
              aiAutonomyEnabled ? 'bg-primary-500' : 'bg-slate-700'
            }`}
          >
            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform transform absolute top-0.5 ${
              aiAutonomyEnabled ? 'translate-x-5' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="glass-panel rounded-2xl p-16 text-center space-y-4 border border-slate-800">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Keine offenen Aufgaben</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Alle Aufgaben wurden geprüft oder laufen im Hintergrund. Neue Designs von Hermes oder dem Designer erscheinen hier automatisch.
          </p>
          <button
            onClick={fetchTasks}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 inline-flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Aktualisieren</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Task List (4 cols) */}
          <div className="lg:col-span-4 space-y-2.5">
            {/* Filter Tabs */}
            <div className="flex items-center justify-between gap-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] font-semibold">
              <button
                onClick={() => setFilter('ALL')}
                className={`flex-1 py-1 rounded-lg transition-all ${filter === 'ALL' ? 'bg-primary-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Alle ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('DESIGN')}
                className={`flex-1 py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'DESIGN' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>Design</span>
                {designCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-cyan-400 text-slate-950 font-bold">{designCount}</span>}
              </button>
              <button
                onClick={() => setFilter('TRADEMARK')}
                className={`flex-1 py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'TRADEMARK' ? 'bg-purple-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>TM</span>
                {tmCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-purple-400 text-slate-950 font-bold">{tmCount}</span>}
              </button>
              <button
                onClick={() => setFilter('PRE_FLIGHT')}
                className={`flex-1 py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'PRE_FLIGHT' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>Quote</span>
                {preFlightCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-400 text-slate-950 font-bold">{preFlightCount}</span>}
              </button>
            </div>

            {/* List of Tasks */}
            <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto pr-1 custom-scrollbar">
              {filteredTasks.map((t) => {
                const isSelected = selectedTaskId === t.id;
                const isPreFlight = t.status === 'AWAITING_PRE_FLIGHT_REVIEW';
                const isDesign = t.status === 'AWAITING_DESIGN_REVIEW';
                const isTm = t.status === 'AWAITING_TM_REVIEW';
                const displayQuote = t.payload?.quote || t.payload?.quote_or_phrase || t.payload?.text || t.id;

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    className={`p-3 rounded-xl cursor-pointer transition-all border ${
                      isSelected 
                        ? 'bg-slate-900 border-primary-500/70 ring-1 ring-primary-500/30 shadow-md' 
                        : 'bg-slate-900/50 hover:bg-slate-900/80 border-slate-800/80'
                    }`}
                  >
                    <div className="flex space-x-3 items-center">
                      {/* Image Thumbnail */}
                      {t.imageUrl ? (
                        <img
                          src={t.imageUrl}
                          alt={displayQuote}
                          className="w-12 h-12 rounded-lg object-cover border border-slate-800 shrink-0 bg-slate-950"
                        />
                      ) : (
                        <div className={`w-12 h-12 rounded-lg border shrink-0 flex items-center justify-center ${
                          isPreFlight ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}>
                          {isPreFlight ? <AlertTriangle className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </div>
                      )}

                      <div className="space-y-1 overflow-hidden flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] font-bold text-slate-100">{t.id}</span>
                          {isPreFlight && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                              Quote TM
                            </span>
                          )}
                          {isDesign && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">
                              Design
                            </span>
                          )}
                          {isTm && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                              Listing TM
                            </span>
                          )}
                        </div>

                        <h4 className="font-semibold text-xs text-slate-200 truncate">
                          "{displayQuote}"
                        </h4>

                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>{t.source}</span>
                          <span>{t.receivedAt ? new Date(t.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Review Workspace (8 cols) */}
          {activeTask && (
            <div className="lg:col-span-8 space-y-4">
              <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-5">
                {/* Task Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-sm font-bold text-primary-400">{activeTask.id}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {activeTask.source}
                      </span>
                      <span className="text-xs text-slate-400">
                        {activeTask.receivedAt ? new Date(activeTask.receivedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      "{activeTask.payload?.quote || activeTask.payload?.quote_or_phrase || activeTask.payload?.text || '-'}"
                    </h3>
                  </div>

                  {/* Top Status Badge */}
                  <div>
                    {activeTask.status === 'AWAITING_PRE_FLIGHT_REVIEW' && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span>Pre-Flight Quote Konflikt</span>
                      </span>
                    )}
                    {activeTask.status === 'AWAITING_DESIGN_REVIEW' && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center space-x-1.5">
                        <Eye className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Design-Prüfung</span>
                      </span>
                    )}
                    {activeTask.status === 'AWAITING_TM_REVIEW' && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center space-x-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
                        <span>Trademark-Prüfung</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* CHECKPOINT 1: PRE-FLIGHT QUOTE KONFLIKT                                   */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_PRE_FLIGHT_REVIEW' && (
                  <div className="space-y-4">
                    <div className="bg-amber-950/20 p-3.5 rounded-xl border border-amber-500/30 space-y-2">
                      <div className="flex items-center space-x-2 text-amber-300 font-semibold text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span>Quote verletzt Markenrecht in Klasse 25 (Bekleidung)</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Die Quote <strong>"{activeTask.payload?.quote}"</strong> hat einen Markentreffer in Klasse 25. Die automatische Generierung wurde pausiert.
                      </p>
                      
                      <FieldTmWordChips label="Quote" fieldData={activeTask.trademarkCheckResult?.fieldSummaries?.quote || activeTask.trademarkCheckResult?.fieldResults?.quote} />
                    </div>

                    {/* Edit Quote Input */}
                    <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">Quote bearbeiten:</label>
                      <input
                        type="text"
                        value={editQuote}
                        onChange={(e) => setEditQuote(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-primary-500"
                        placeholder="Neue Quote eingeben..."
                      />
                    </div>

                    {/* Pre-Flight Action Buttons */}
                    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                      <button
                        onClick={() => handlePreFlightAction('DISCARD')}
                        disabled={isSubmitting}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Verwerfen</span>
                      </button>
                      <button
                        onClick={() => handlePreFlightAction('OVERRIDE')}
                        disabled={isSubmitting}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 border border-amber-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Fortfahren</span>
                      </button>
                      <button
                        onClick={() => handlePreFlightAction('RESTART')}
                        disabled={isSubmitting || !editQuote.trim()}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary-600 hover:bg-primary-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50 shadow-sm"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Neu starten</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* CHECKPOINT 2: DESIGN- & FRAGEN-PRÜFUNG                                    */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_DESIGN_REVIEW' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                      {/* Left: Image Preview & Prompt (5 cols) */}
                      <div className="md:col-span-5 space-y-2.5">
                        <div className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[10/16] max-h-[340px] flex items-center justify-center">
                          {activeTask.imageUrl ? (
                            <>
                              <img
                                src={activeTask.imageUrl}
                                alt={activeTask.payload?.quote}
                                className="w-full h-full object-contain cursor-pointer"
                                onClick={() => setShowImageZoom(true)}
                              />
                              <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setShowImageZoom(true)}
                                  className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 text-slate-300 border border-slate-700 shadow"
                                  title="Vergrößern"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <a
                                  href={activeTask.imageUrl}
                                  download={`design-${activeTask.id}.png`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 text-slate-300 border border-slate-700 shadow"
                                  title="Download"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-slate-500">Kein Bild vorhanden</div>
                          )}
                        </div>

                        {/* Editable Prompt */}
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Prompt:</span>
                          <textarea
                            value={editablePrompt}
                            onChange={(e) => setEditablePrompt(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      {/* Right: Questions Matrix (7 cols) */}
                      <div className="md:col-span-7 space-y-3">
                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center">
                          <Sliders className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                          Vision-KI Analyse
                        </h4>

                        {/* Question 1: Quote */}
                        <div className="bg-slate-900/90 p-3 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">1. Quote-Prüfung</span>
                            {activeTask.analysisResult?.quote_check?.quote_matches ? (
                              <span className="text-[10px] font-semibold text-emerald-400 flex items-center bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Exakt
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-amber-400 flex items-center bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                <AlertTriangle className="w-3 h-3 mr-1" /> Abweichung
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800/80">
                            <div>Soll: <span className="text-slate-200">"{activeTask.payload?.quote}"</span></div>
                            <div>Erkannt: <span className="text-cyan-300">"{activeTask.analysisResult?.quote_check?.detected_quote_text || '-'}"</span></div>
                          </div>
                        </div>

                        {/* Question 2: Target Group */}
                        <div className="bg-slate-900/90 p-3 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">2. Zielgruppe</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {Array.isArray(activeTask.analysisResult?.target_group?.selected) ? activeTask.analysisResult.target_group.selected.join(', ') : (activeTask.analysisResult?.target_group?.selected || 'Men, Women')}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {['Men, Women', 'Men', 'Women', 'Youth', 'Alle'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedAudience(val)}
                                className={`px-2.5 py-1 text-xs rounded-lg border transition-all ${
                                  selectedAudience === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 font-semibold'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                }`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Question 3: Avoid Color */}
                        <div className="bg-slate-900/90 p-3 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">3. Zu vermeidende Produktfarbe</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {activeTask.analysisResult?.avoid_product_colors?.avoid || 'Keine'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {['Schwarz', 'Weiß', 'Keine'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedAvoidColor(val)}
                                className={`px-3 py-1 text-xs rounded-lg border transition-all ${
                                  selectedAvoidColor === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 font-semibold'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                }`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Question 4: Background */}
                        <div className="bg-slate-900/90 p-3 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">4. Hintergrund</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {activeTask.analysisResult?.background_analysis?.removal_mode === 'MANUAL' ? 'Behalten' : 'Auto Freistellen'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {['Nein (Auto Freistellen)', 'Ja (Hintergrund behalten)'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedBgMode(val)}
                                className={`px-3 py-1 text-xs rounded-lg border transition-all ${
                                  selectedBgMode === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 font-semibold'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                }`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => handleDesignReview('REGENERATE_IMAGE')}
                        disabled={isSubmitting}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                        <span>Neu generieren</span>
                      </button>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleDesignReview('APPROVE', false)}
                          disabled={isSubmitting}
                          className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Speichern &amp; Weiter</span>
                        </button>

                        <button
                          onClick={() => handleDesignReview('APPROVE', true)}
                          disabled={isSubmitting}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50 shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Listing generieren</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* CHECKPOINT 3: MANUELLE TRADEMARK- & LISTING-PRÜFUNG                       */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_TM_REVIEW' && (
                  <div className="space-y-5">
                    {/* Intro Banner */}
                    <div className="bg-purple-950/20 border border-purple-500/30 p-3.5 rounded-xl flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
                          <ShieldAlert className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-100">Manuelle Trademark-Prüfung</h4>
                          <p className="text-[11px] text-slate-400">
                            Passe die Felder an, um Markentreffer in Klasse 25 (Bekleidung) zu eliminieren.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleTmRecheck}
                        disabled={isCheckingTm || isSubmitting}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white flex items-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm"
                      >
                        <Search className={`w-3.5 h-3.5 ${isCheckingTm ? 'animate-spin' : ''}`} />
                        <span>{isCheckingTm ? 'Prüfe...' : 'USPTO prüfen'}</span>
                      </button>
                    </div>

                    {/* Listing Fields Editor */}
                    <div className="space-y-4">
                      {/* Brand */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-300 uppercase tracking-wider">Brand Name</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.brand.length > 50 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.brand.length}/50
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editableListing.brand}
                          onChange={(e) => setEditableListing({ ...editableListing, brand: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                          placeholder="Brand Name eingeben..."
                        />
                        <FieldTmWordChips label="Brand" fieldData={fieldSummaries.brand} />
                      </div>

                      {/* Title */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-300 uppercase tracking-wider">Design Title</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.title.length > 60 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.title.length}/60
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editableListing.title}
                          onChange={(e) => setEditableListing({ ...editableListing, title: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 font-semibold focus:outline-none focus:border-purple-500"
                          placeholder="Design Title eingeben..."
                        />
                        <FieldTmWordChips label="Title" fieldData={fieldSummaries.title} />
                      </div>

                      {/* Bullet 1 */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-300 uppercase tracking-wider">Feature Bullet 1</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.bullet1.length > 250 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.bullet1.length}/250
                          </span>
                        </div>
                        <textarea
                          value={editableListing.bullet1}
                          onChange={(e) => setEditableListing({ ...editableListing, bullet1: e.target.value })}
                          rows={6}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 leading-relaxed min-h-[140px]"
                          placeholder="Feature Bullet 1 eingeben..."
                        />
                        <FieldTmWordChips label="Bullet 1" fieldData={fieldSummaries.bullet1} />
                      </div>

                      {/* Bullet 2 */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-300 uppercase tracking-wider">Feature Bullet 2</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.bullet2.length > 250 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.bullet2.length}/250
                          </span>
                        </div>
                        <textarea
                          value={editableListing.bullet2}
                          onChange={(e) => setEditableListing({ ...editableListing, bullet2: e.target.value })}
                          rows={6}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 leading-relaxed min-h-[140px]"
                          placeholder="Feature Bullet 2 eingeben..."
                        />
                        <FieldTmWordChips label="Bullet 2" fieldData={fieldSummaries.bullet2} />
                      </div>

                      {/* Product Description */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-300 uppercase tracking-wider">Product Description</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.description.length > 2000 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.description.length}/2000
                          </span>
                        </div>
                        <textarea
                          value={editableListing.description}
                          onChange={(e) => setEditableListing({ ...editableListing, description: e.target.value })}
                          rows={10}
                          placeholder="Produktbeschreibung eingeben..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 leading-relaxed min-h-[200px]"
                        />
                        <FieldTmWordChips label="Description" fieldData={fieldSummaries.description} />
                      </div>
                    </div>

                    {/* Overall Summary Bar */}
                    {liveTmResult && (
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <ShieldCheck className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-semibold text-slate-200">Gesamtergebnis:</span>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                          liveTmResult.hasInfringementClass25 
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' 
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {liveTmResult.hasInfringementClass25 
                            ? `${liveTmResult.totalHits || 0} Treffer in Klasse 25 (Blockiert)` 
                            : '0 Treffer in Klasse 25 (Sauber für Bekleidung)'}
                        </span>
                      </div>
                    )}

                    {/* Checkpoint 3 Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => handleTmDecision('REJECT')}
                        disabled={isSubmitting}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span>Ablehnen</span>
                      </button>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={handleTmRecheck}
                          disabled={isCheckingTm || isSubmitting}
                          className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Search className={`w-3.5 h-3.5 ${isCheckingTm ? 'animate-spin' : 'text-purple-400'}`} />
                          <span>USPTO prüfen</span>
                        </button>

                        <button
                          onClick={() => handleTmDecision('APPROVE')}
                          disabled={isSubmitting}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50 shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Freigeben</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image Zoom Modal */}
      {showImageZoom && activeTask?.imageUrl && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setShowImageZoom(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img
              src={activeTask.imageUrl}
              alt="Zoomed Design"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl border border-slate-700 shadow-2xl"
            />
            <p className="text-xs text-slate-400 mt-2 font-mono">{activeTask.id} • Klick zum Schließen</p>
          </div>
        </div>
      )}
    </div>
  );
};

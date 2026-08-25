import React, { useState, useEffect } from 'react';
import { 
  CheckSquare, 
  Sparkles, 
  Bot, 
  User, 
  ShieldCheck, 
  ShieldAlert,
  ArrowRight, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  AlertTriangle,
  Layers, 
  Eye, 
  Edit3,
  Sliders,
  Scissors,
  RefreshCw,
  Zap,
  RotateCcw,
  Maximize2,
  Download,
  Trash2,
  Search,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

interface DesignTaskLog {
  id: string;
  counter: number;
  source: 'HERMES' | 'TEST' | 'DESIGNER';
  suffix: 'H' | 'T' | 'D';
  status: 'RECEIVED' | 'PROCESSING' | 'PROMPT_READY' | 'GENERATING_IMAGE' | 'ANALYZING_DESIGN' | 'AWAITING_PRE_FLIGHT_REVIEW' | 'AWAITING_DESIGN_REVIEW' | 'GENERATING_LISTING' | 'CHECKING_TRADEMARKS' | 'AWAITING_TM_REVIEW' | 'COMPLETED' | 'REJECTED' | 'ERROR';
  checkpoint?: 'PRE_FLIGHT' | 'DESIGN_REVIEW' | 'TM_REVIEW';
  receivedAt: string;
  clientIp?: string;
  payload: Record<string, any>;
  events: any[];
  resultPrompt?: string;
  imageUrl?: string;
  localImagePath?: string;
  analysisResult?: any;
  customAnswers?: {
    audience?: string;
    avoidColor?: string;
    reuseBackground?: string;
    notes?: string;
  };
  listingResult?: any;
  trademarkCheckResult?: any;
  trademarkRefineResult?: any;
  hasError?: boolean;
  errorDetails?: string;
}

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

  // Fetch Settings & Tasks
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
        setAiAutonomyEnabled(!!data.settings.aiAutonomyEnabled);
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
      showNotification('success', newVal ? '⚡ 100% KI-Autonomie aktiviert (Design-Prüfung läuft automatisch).' : '🛡️ Human-in-the-Loop aktiviert (Design-Prüfung hält in Tasks an).');
    } catch (err) {
      showNotification('error', 'Fehler beim Speichern der Einstellung.');
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4500);
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
      const enListing = activeTask.listingResult?.en || activeTask.listingResult || {};
      setEditableListing({
        brand: enListing.brand || '',
        title: enListing.title || '',
        bullet1: enListing.bullet1 || '',
        bullet2: enListing.bullet2 || '',
        description: enListing.description || ''
      });
      setLiveTmResult(activeTask.trademarkCheckResult || null);
    }
  }, [selectedTaskId, activeTask?.status]);

  // Actions for Checkpoint 1: Pre-Flight
  const handlePreFlightAction = async (action: 'OVERRIDE' | 'RESTART' | 'DISCARD') => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${activeTask.id}/override-preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, newQuote: editQuote })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('success', data.message);
        fetchTasks();
      } else {
        showNotification('error', data.error || 'Fehler bei der Aktion');
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

      const res = await fetch(`/api/v1/tasks/${activeTask.id}/submit-design-review`, {
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
        showNotification('error', data.error || 'Fehler beim Übermitteln');
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
      const res = await fetch(`/api/v1/tasks/${activeTask.id}/submit-tm-review`, {
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
          showNotification('error', `⚠️ Noch ${data.totalHits} Treffer in Klasse 25 vorhanden.`);
        } else {
          showNotification('success', `✓ 0 Treffer in Klasse 25! Bekleidung ist sauber.`);
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
      const res = await fetch(`/api/v1/tasks/${activeTask.id}/submit-tm-review`, {
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
        showNotification('error', data.error || 'Fehler beim Speichern');
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

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl border shadow-2xl text-xs font-bold flex items-center space-x-2 transition-all transform animate-in slide-in-from-top-2 ${
          notification.type === 'success' 
            ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40' 
            : 'bg-rose-950/90 text-rose-300 border-rose-500/40'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Top Bar Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <CheckSquare className="w-6 h-6 mr-2.5 text-primary-400" />
            Tasks &amp; Human-in-the-Loop
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Zentraler Prüf- und Freigabe-Workspace für generierte Designs, Trademarks und Produkt-Fragen.
          </p>
        </div>

        {/* AI Autonomy Mode Switch */}
        <div className="flex items-center space-x-3 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2.5 shadow-md">
          <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-400 border border-primary-500/20">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-slate-200">100% KI-Autonomie</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${aiAutonomyEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                {aiAutonomyEnabled ? 'AKTIV' : 'AUS'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400">Design-Prüfung bei KI-Approval automatisch überspringen</span>
          </div>
          <button
            onClick={toggleAiAutonomy}
            className={`w-11 h-6 rounded-full transition-colors relative ml-2 ${
              aiAutonomyEnabled ? 'bg-primary-500' : 'bg-slate-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform transform absolute top-1 ${
              aiAutonomyEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="glass-panel rounded-2xl p-16 text-center space-y-4 border border-slate-800">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-100">Keine offenen Prüfungen</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Alle Aufgaben wurden geprüft oder laufen vollautomatisch im Hintergrund. Neue Designs von Hermes oder dem Designer erscheinen hier, sobald deine Prüfung erforderlich ist.
          </p>
          <button
            onClick={fetchTasks}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 inline-flex items-center space-x-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Aktualisieren</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Task List (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            {/* Filter Tabs */}
            <div className="flex items-center justify-between gap-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] font-semibold">
              <button
                onClick={() => setFilter('ALL')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${filter === 'ALL' ? 'bg-primary-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Alle ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('DESIGN')}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'DESIGN' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>Design</span>
                {designCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-cyan-400 text-slate-950 font-bold">{designCount}</span>}
              </button>
              <button
                onClick={() => setFilter('TRADEMARK')}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'TRADEMARK' ? 'bg-purple-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>TM</span>
                {tmCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-purple-400 text-slate-950 font-bold">{tmCount}</span>}
              </button>
              <button
                onClick={() => setFilter('PRE_FLIGHT')}
                className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'PRE_FLIGHT' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>Quote</span>
                {preFlightCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-400 text-slate-950 font-bold">{preFlightCount}</span>}
              </button>
            </div>

            {/* List of Tasks */}
            <div className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto pr-1">
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
                    className={`p-3 rounded-2xl cursor-pointer transition-all border ${
                      isSelected 
                        ? 'bg-slate-900 border-primary-500/70 ring-1 ring-primary-500/40 shadow-lg shadow-primary-500/5' 
                        : 'bg-slate-900/50 hover:bg-slate-900/80 border-slate-800/80'
                    }`}
                  >
                    <div className="flex space-x-3 items-center">
                      {/* Image Thumbnail or Status Icon */}
                      {t.imageUrl ? (
                        <img
                          src={t.imageUrl}
                          alt={displayQuote}
                          className="w-14 h-14 rounded-xl object-cover border border-slate-800 shrink-0 bg-slate-950"
                        />
                      ) : (
                        <div className={`w-14 h-14 rounded-xl border shrink-0 flex items-center justify-center ${
                          isPreFlight ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}>
                          {isPreFlight ? <AlertTriangle className="w-6 h-6" /> : <Eye className="w-6 h-6" />}
                        </div>
                      )}

                      <div className="space-y-1 overflow-hidden flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] font-bold text-slate-100">{t.id}</span>
                          {/* Checkpoint Status Badge */}
                          {isPreFlight && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/30">
                              Quote TM
                            </span>
                          )}
                          {isDesign && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-cyan-500/20 text-cyan-300 rounded-full border border-cyan-500/30">
                              Design
                            </span>
                          )}
                          {isTm && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">
                              Listing TM
                            </span>
                          )}
                        </div>

                        <h4 className="font-bold text-xs text-slate-200 truncate">
                          &quot;{displayQuote}&quot;
                        </h4>

                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>{t.source}</span>
                          <span>{new Date(t.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
              <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
                {/* Task Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-sm font-bold text-primary-400">{activeTask.id}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        {activeTask.source}
                      </span>
                      <span className="text-xs text-slate-400">
                        Eingegangen: {new Date(activeTask.receivedAt).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-100">
                      Quote: &quot;{activeTask.payload?.quote || activeTask.payload?.quote_or_phrase || activeTask.payload?.text || '-'}&quot;
                    </h3>
                  </div>

                  {/* Top Status Badge */}
                  <div>
                    {activeTask.status === 'AWAITING_PRE_FLIGHT_REVIEW' && (
                      <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center space-x-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span>Checkpoint 1: Pre-Flight Quote Konflikt</span>
                      </span>
                    )}
                    {activeTask.status === 'AWAITING_DESIGN_REVIEW' && (
                      <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center space-x-1.5">
                        <Eye className="w-4 h-4 text-cyan-400" />
                        <span>Checkpoint 2: Design- &amp; Fragen-Prüfung</span>
                      </span>
                    )}
                    {activeTask.status === 'AWAITING_TM_REVIEW' && (
                      <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center space-x-1.5">
                        <ShieldAlert className="w-4 h-4 text-purple-400" />
                        <span>Checkpoint 3: Manuelle TM-Optimierung</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* CHECKPOINT 1: PRE-FLIGHT QUOTE KONFLIKT WORKSPACE                         */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_PRE_FLIGHT_REVIEW' && (
                  <div className="space-y-5">
                    <div className="bg-amber-950/20 p-4 rounded-xl border border-amber-500/40 space-y-2">
                      <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span>Token-Schutz ausgelöst: Quote verletzt aktives Markenrecht in Klasse 25</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Die Quote <strong>&quot;{activeTask.payload?.quote}&quot;</strong> hat einen aktiven USPTO-Markentreffer in Nizza-Klasse 25 (Bekleidung). Um LLM-Tokens und Kosten zu sparen, wurde die automatische Generierung pausiert.
                      </p>
                      {activeTask.trademarkCheckResult?.fieldSummaries?.quote && (
                        <div className="pt-2">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Gefundene Markeneinträge:</span>
                          <div className="space-y-1">
                            {activeTask.trademarkCheckResult.fieldSummaries.quote.hits?.map((hit: any, i: number) => (
                              <div key={i} className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] flex items-center justify-between">
                                <span className="font-bold text-amber-300 font-mono">{hit.wordmark || hit.mark}</span>
                                <span className="text-slate-400">Klasse: {hit.classes?.join(', ')} • Status: {hit.status || 'LIVE'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Form to Edit Quote */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                      <label className="text-xs font-bold text-slate-200 block">Quote bearbeiten &amp; neu starten:</label>
                      <input
                        type="text"
                        value={editQuote}
                        onChange={(e) => setEditQuote(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-primary-500"
                        placeholder="Neue Quote eingeben..."
                      />
                    </div>

                    {/* Pre-Flight Action Buttons */}
                    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                      <button
                        onClick={() => handlePreFlightAction('DISCARD')}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Task verwerfen (Schließen)</span>
                      </button>
                      <button
                        onClick={() => handlePreFlightAction('OVERRIDE')}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Trotzdem fortfahren (Override)</span>
                      </button>
                      <button
                        onClick={() => handlePreFlightAction('RESTART')}
                        disabled={isSubmitting || !editQuote.trim()}
                        className="px-5 py-2.5 rounded-xl text-xs font-bold bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Quote anpassen &amp; neu starten</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* CHECKPOINT 2: DESIGN- & FRAGEN-PRÜFUNG WORKSPACE                          */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_DESIGN_REVIEW' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                      {/* Left: Image Preview & Prompt (5 cols) */}
                      <div className="md:col-span-5 space-y-3">
                        <div className="relative group rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[10/16] max-h-[380px] flex items-center justify-center">
                          {activeTask.imageUrl ? (
                            <>
                              <img
                                src={activeTask.imageUrl}
                                alt={activeTask.payload?.quote}
                                className="w-full h-full object-contain cursor-pointer"
                                onClick={() => setShowImageZoom(true)}
                              />
                              <div className="absolute top-2 right-2 flex space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setShowImageZoom(true)}
                                  className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-slate-300 border border-slate-700 shadow"
                                  title="Vergrößern"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <a
                                  href={activeTask.imageUrl}
                                  download={`design-${activeTask.id}.png`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-slate-300 border border-slate-700 shadow"
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

                        {/* Editable Ideogram Prompt */}
                        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/90 space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Verwendeter Ideogram Prompt:</span>
                          <textarea
                            value={editablePrompt}
                            onChange={(e) => setEditablePrompt(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      {/* Right: 4-Questions Matrix (7 cols) */}
                      <div className="md:col-span-7 space-y-3.5">
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center">
                          <Sliders className="w-4 h-4 mr-1.5 text-cyan-400" />
                          Vision-AI Antworten &amp; Anpassung
                        </h4>

                        {/* Question 1: Quote-Prüfung */}
                        <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">1. Quote-Prüfung</span>
                            {activeTask.analysisResult?.quote_check?.quote_matches ? (
                              <span className="text-[10px] font-bold text-emerald-400 flex items-center bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Quote stimmt 1:1
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-amber-400 flex items-center bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                <AlertTriangle className="w-3 h-3 mr-1" /> Abweichung festgestellt
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800/80">
                            <div>Soll: <strong>&quot;{activeTask.payload?.quote}&quot;</strong></div>
                            <div>Erkannt: <strong className="text-cyan-300">&quot;{activeTask.analysisResult?.quote_check?.detected_quote_text || '-'}&quot;</strong></div>
                          </div>
                        </div>

                        {/* Question 2: Zielgruppe */}
                        <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">2. Welche Zielgruppe betrifft das Design?</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {Array.isArray(activeTask.analysisResult?.target_group?.selected) ? activeTask.analysisResult.target_group.selected.join(', ') : (activeTask.analysisResult?.target_group?.selected || 'Men, Women')}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {['Men, Women', 'Men', 'Women', 'Youth', 'Alle'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedAudience(val)}
                                className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-all ${
                                  selectedAudience === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm font-bold'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                }`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Question 3: Zu vermeidende Farbe */}
                        <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">3. Welche Produktfarbe sollte vermieden werden?</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {activeTask.analysisResult?.avoid_product_colors?.avoid || 'Keine'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {['Schwarz', 'Weiß', 'Keine'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedAvoidColor(val)}
                                className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${
                                  selectedAvoidColor === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm font-bold'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                }`}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Question 4: Hintergrund */}
                        <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-200">4. Hintergrund-Freistellung</span>
                            <span className="text-[10px] text-cyan-400 font-mono">
                              KI: {activeTask.analysisResult?.background_analysis?.removal_mode === 'MANUAL' ? 'Hintergrund behalten' : 'Auto Freistellen'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {['Nein (Auto Freistellen)', 'Ja (Hintergrund behalten)'].map((val) => (
                              <button
                                key={val}
                                onClick={() => setSelectedBgMode(val)}
                                className={`px-3 py-1 text-xs rounded-lg border font-medium transition-all ${
                                  selectedBgMode === val 
                                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm font-bold'
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

                    {/* Checkpoint 2 Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                      {/* Regenerate Button */}
                      <button
                        onClick={() => handleDesignReview('REGENERATE_IMAGE')}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-rose-950/40 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        title="Springt zurück zu Ideogram und erzeugt ein neues Bild"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                        <span>Quote falsch / Bild neu generieren</span>
                      </button>

                      <div className="flex items-center space-x-2.5">
                        {/* Custom Answers Save & Proceed */}
                        <button
                          onClick={() => handleDesignReview('APPROVE', false)}
                          disabled={isSubmitting}
                          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Geänderte Werte speichern &amp; weiter</span>
                        </button>

                        {/* 1-Click AI Answers Approve */}
                        <button
                          onClick={() => handleDesignReview('APPROVE', true)}
                          disabled={isSubmitting}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20 flex items-center space-x-1.5 transition-all active:scale-98 disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5 text-yellow-300" />
                          <span>KI-Antworten übernehmen &amp; Listing erstellen</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* CHECKPOINT 3: MANUELLE TRADEMARK-OPTIMIERUNG WORKSPACE                     */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_TM_REVIEW' && (
                  <div className="space-y-5">
                    <div className="bg-purple-950/20 p-4 rounded-xl border border-purple-500/40 space-y-2">
                      <div className="flex items-center space-x-2 text-purple-300 font-bold text-xs">
                        <ShieldAlert className="w-4 h-4 text-purple-400" />
                        <span>Trademark-Audit: Nach 4 USPTO-Prüfungen verbleiben Treffer in Klasse 25</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Das automatische Refinement konnte die Treffer nicht vollständig ohne Sinnverlust auflösen. Du kannst das Listing unten manuell korrigieren und sofort per Klick auf <strong>&quot;Listing erneut prüfen&quot;</strong> live gegen die USPTO-Datenbank testen.
                      </p>
                    </div>

                    {/* Listing Fields Editor */}
                    <div className="space-y-3">
                      {/* Brand */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-400 uppercase">Brand Name</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.brand.length > 50 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.brand.length}/50
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editableListing.brand}
                          onChange={(e) => setEditableListing({ ...editableListing, brand: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {/* Title */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-400 uppercase">Design Title</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.title.length > 60 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.title.length}/60
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editableListing.title}
                          onChange={(e) => setEditableListing({ ...editableListing, title: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-purple-300 font-bold focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {/* Bullet 1 */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-400 uppercase">Feature Bullet 1</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.bullet1.length > 250 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.bullet1.length}/250
                          </span>
                        </div>
                        <textarea
                          value={editableListing.bullet1}
                          onChange={(e) => setEditableListing({ ...editableListing, bullet1: e.target.value })}
                          rows={2}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      {/* Bullet 2 */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-400 uppercase">Feature Bullet 2</span>
                          <span className={`font-mono text-[10px] font-bold ${editableListing.bullet2.length > 250 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {editableListing.bullet2.length}/250
                          </span>
                        </div>
                        <textarea
                          value={editableListing.bullet2}
                          onChange={(e) => setEditableListing({ ...editableListing, bullet2: e.target.value })}
                          rows={2}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {/* Live USPTO Results Box */}
                    {liveTmResult && (
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-300 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-purple-400" />
                            Live USPTO Prüfergebnis:
                          </span>
                          <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                            liveTmResult.hasInfringementClass25 
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' 
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {liveTmResult.hasInfringementClass25 
                              ? `⚠️ ${liveTmResult.totalHits || 0} Treffer in Klasse 25` 
                              : '✓ 0 Treffer in Klasse 25 (Sauber!)'}
                          </span>
                        </div>

                        {liveTmResult.fieldSummaries && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                            {Object.entries(liveTmResult.fieldSummaries).map(([fName, fData]: [string, any]) => (
                              <div key={fName} className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                                <span className="text-slate-400 uppercase font-bold">{fName}:</span>
                                <span className={fData.hasClass25 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                                  {fData.totalHits || 0} Treffer {fData.hasClass25 && '(Klasse 25)'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Checkpoint 3 Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => handleTmDecision('REJECT')}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-rose-950/40 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span>Task ablehnen &amp; schließen</span>
                      </button>

                      <div className="flex items-center space-x-2.5">
                        <button
                          onClick={handleTmRecheck}
                          disabled={isCheckingTm || isSubmitting}
                          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Search className={`w-3.5 h-3.5 ${isCheckingTm ? 'animate-spin' : 'text-purple-400'}`} />
                          <span>Listing erneut prüfen (Live USPTO)</span>
                        </button>

                        <button
                          onClick={() => handleTmDecision('APPROVE')}
                          disabled={isSubmitting}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20 flex items-center space-x-1.5 transition-all active:scale-98 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Freigeben &amp; In Upload-Queue verschieben</span>
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

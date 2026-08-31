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
  FileText,
  Palette,
  Layers
} from 'lucide-react';

import { DesignTaskLog } from '../../types/tasks';
import { SvgEditor } from '../components/SvgEditor';
import { TaskStatusBadge } from '../components/TaskStatusBadge';

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
  const rawHits = fieldData.hits || fieldData.detectedTrademarks || [];

  // If 0 hits, show a clean "Sauber" indicator
  if (totalHits === 0) {
    return (
      <div className="flex items-center space-x-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 mt-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>0 Treffer in {label} (Sauber für Bekleidung)</span>
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
          const isK25 = hits.some(h => {
            const clsArr = (h.classes && h.classes.length > 0)
              ? h.classes
              : String(h.classNumber || '').split(/[,;\s]+/).map((c: string) => c.trim().replace(/^0+/, ''));
            return clsArr.includes('25');
          });
          const classes = Array.from(new Set(hits.flatMap(h => {
            if (h.classes && h.classes.length > 0) return h.classes;
            return String(h.classNumber || '').split(/[,;\s]+/).map((c: string) => c.trim().replace(/^0+/, ''));
          }))).filter(Boolean).join(', ') || 'N/A';
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
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                  isK25 ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40' : 'bg-slate-800 text-slate-400'
                }`}>
                  {isK25 ? 'Klasse 25' : `Klasse ${classes}`}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
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
  const [filter, setFilter] = useState<'ALL' | 'PRE_FLIGHT' | 'DESIGN' | 'TRADEMARK' | 'SVG'>('ALL');
  const [aiAutonomyDesignEnabled, setAiAutonomyDesignEnabled] = useState(false);
  const [aiAutonomyUpdateEnabled, setAiAutonomyUpdateEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Checkpoint 1 (Pre-Flight) State
  const [editQuote, setEditQuote] = useState('');

  // Checkpoint 2 (Design Review) State
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(['Men', 'Women', 'Youth']);
  const [selectedAvoidColor, setSelectedAvoidColor] = useState('None');
  const [selectedBgMode, setSelectedBgMode] = useState('Automatisch');
  const [selectedMaxColors, setSelectedMaxColors] = useState<number>(2);
  const [editablePrompt, setEditablePrompt] = useState('');
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [viewModeGrid, setViewModeGrid] = useState(true);
  const [editNiche1, setEditNiche1] = useState('');
  const [editNiche2, setEditNiche2] = useState('');
  const [editSubniche, setEditSubniche] = useState('');
  const [editKeywords, setEditKeywords] = useState('');

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

  // Checkpoint 4 (SVG Review) State
  const [editedSvgData, setEditedSvgData] = useState<string>('');
  const [revectorizeMaxColors, setRevectorizeMaxColors] = useState<number>(2);

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

  // Helper to extract old Amazon listing safely for UPDATE tasks
  const extractOldAmazonListing = (task?: DesignTaskLog) => {
    if (!task || !task.payload) return { brand: '-', title: '-', bullet1: '-', bullet2: '-', description: '-' };
    const p = task.payload;
    const ml = p.masterListing || (p.textData ? (p.textData.en || p.textData.de || Object.values(p.textData)[0]) : {}) || {};

    const brand = ml.brandName || ml.brand || p.brand || '-';
    const title = ml.title || p.title || '-';
    
    let b1 = '';
    let b2 = '';
    if (Array.isArray(ml.bullets) && ml.bullets.length > 0) {
      b1 = ml.bullets[0] || '';
      b2 = ml.bullets[1] || '';
    } else if (Array.isArray(p.bullets) && p.bullets.length > 0) {
      b1 = p.bullets[0] || '';
      b2 = p.bullets[1] || '';
    } else {
      b1 = p.bullet1 || ml.bullet1 || '';
      b2 = p.bullet2 || ml.bullet2 || '';
    }

    const description = ml.description || p.description || '-';

    return {
      brand: brand || '-',
      title: title || '-',
      bullet1: b1 || '-',
      bullet2: b2 || '-',
      description: description || '-'
    };
  };

  // Helper to format AI Fit Types for display
  const getAiFitTypesDisplay = (task?: DesignTaskLog) => {
    if (!task) return 'Men, Women, Youth';
    const tg = task.analysisResult?.target_group?.selected;
    if (Array.isArray(tg) && tg.length > 0) return tg.join(', ');
    if (typeof tg === 'string' && tg.trim()) return tg;
    const ft = task.analysisResult?.fitTypes;
    if (Array.isArray(ft) && ft.length > 0) return ft.join(', ');
    if (typeof ft === 'string' && ft.trim() && ft !== 'Standard') return ft;
    return 'Men, Women, Youth';
  };

  // Helper to format AI Avoid Color for display
  const getAiAvoidColorDisplay = (task?: DesignTaskLog) => {
    if (!task) return 'None';
    const av = task.analysisResult?.avoid_product_colors?.avoid || task.analysisResult?.avoidColor;
    if (av && av.toLowerCase() !== 'none') {
      return av.charAt(0).toUpperCase() + av.slice(1).toLowerCase();
    }
    return 'None';
  };

  // Fetch Tasks
  const fetchTasks = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = await fetch('/api/v1/tasks');
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        setSelectedTaskId(prevId => {
          if (data.tasks.length === 0) return '';
          // If previous selection still exists in the task list, retain it!
          if (prevId && data.tasks.some((t: DesignTaskLog) => t.id === prevId)) {
            return prevId;
          }
          // Otherwise default to first task
          return data.tasks[0].id;
        });
      }
    } catch (err) {
      console.warn('[Tasks] Fetch error:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/v1/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        setAiAutonomyDesignEnabled(Boolean(data.settings.aiAutonomyDesignEnabled ?? data.settings.aiAutonomyEnabled));
        setAiAutonomyUpdateEnabled(Boolean(data.settings.aiAutonomyUpdateEnabled ?? data.settings.aiAutonomyEnabled));
      }
    } catch (e) {}
  };

  const toggleAiAutonomyDesign = async () => {
    const newVal = !aiAutonomyDesignEnabled;
    setAiAutonomyDesignEnabled(newVal);
    try {
      await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAutonomyDesignEnabled: newVal })
      });
      showNotification('success', newVal ? 'Design-Autonomie aktiviert' : 'Design Human-in-the-Loop aktiviert');
    } catch (err) {
      showNotification('error', 'Fehler beim Speichern der Einstellung');
    }
  };

  const toggleAiAutonomyUpdate = async () => {
    const newVal = !aiAutonomyUpdateEnabled;
    setAiAutonomyUpdateEnabled(newVal);
    try {
      await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAutonomyUpdateEnabled: newVal })
      });
      showNotification('success', newVal ? 'Update-Autonomie aktiviert' : 'Update Human-in-the-Loop aktiviert');
    } catch (err) {
      showNotification('error', 'Fehler beim Speichern der Einstellung');
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    fetchTasks(false);
    fetchSettings();
    const interval = setInterval(() => fetchTasks(true), 8000);
    return () => clearInterval(interval);
  }, []);

  const activeTask = tasks.find(t => t.id === selectedTaskId) || (tasks.length > 0 ? tasks[0] : null);

  // Sync active task form fields when selection changes
  useEffect(() => {
    if (activeTask) {
      // Pre-Flight Quote
      setEditQuote(activeTask.payload?.quote || activeTask.payload?.quote_or_phrase || activeTask.payload?.text || '');

      // Design Review fields
      const pred = activeTask.analysisResult;
      
      // 2. Audience multi-selection (Men, Women, Youth) - Case Insensitive Normalization
      let rawAudList: string[] = [];
      if (activeTask.customAnswers?.audience && activeTask.customAnswers.audience !== 'Standard') {
        rawAudList = Array.isArray(activeTask.customAnswers.audience)
          ? activeTask.customAnswers.audience
          : String(activeTask.customAnswers.audience).split(',');
      } else if (pred?.target_group?.selected) {
        rawAudList = Array.isArray(pred.target_group.selected)
          ? pred.target_group.selected
          : String(pred.target_group.selected).split(',');
      } else if (pred?.fitTypes && pred.fitTypes !== 'Standard') {
        rawAudList = Array.isArray(pred.fitTypes)
          ? pred.fitTypes
          : String(pred.fitTypes).split(',');
      }

      const normalizeAudienceName = (raw: string) => {
        const low = raw.trim().toLowerCase();
        if (low === 'men' || low === 'männer' || low === 'herren') return 'Men';
        if (low === 'women' || low === 'frauen' || low === 'damen') return 'Women';
        if (low === 'youth' || low === 'kinder' || low === 'kids' || low === 'jugend') return 'Youth';
        return null;
      };

      const audiences = rawAudList.map(s => normalizeAudienceName(s)).filter((s): s is string => Boolean(s));
      setSelectedAudiences(audiences.length > 0 ? Array.from(new Set(audiences)) : ['Men', 'Women', 'Youth']);

      // 3. Avoid Color (Black, White, None)
      const rawAvoid = (activeTask.customAnswers?.avoidColor || pred?.avoidColor || pred?.avoid_product_colors?.avoid || 'None').trim();
      let normAvoid = 'None';
      if (rawAvoid.toLowerCase().includes('black') || rawAvoid.toLowerCase().includes('schwarz')) {
        normAvoid = 'Black';
      } else if (rawAvoid.toLowerCase().includes('white') || rawAvoid.toLowerCase().includes('weiß')) {
        normAvoid = 'White';
      } else {
        normAvoid = 'None';
      }
      setSelectedAvoidColor(normAvoid);

      // 4. Background removal mode (Automatisch / Manuell)
      const isManual = activeTask.customAnswers?.reuseBackground === 'Manuell' || activeTask.customAnswers?.reuseBackground === 'MANUAL' || activeTask.customAnswers?.reuseBackground === 'Ja (Hintergrund behalten)' || pred?.background_analysis?.removal_mode === 'MANUAL' || pred?.background_analysis?.is_design_element === true;
      setSelectedBgMode(isManual ? 'Manuell' : 'Automatisch');

      setSelectedMaxColors(activeTask.customAnswers?.maxColors ?? pred?.color_analysis?.color_count ?? 2);
      setEditablePrompt(activeTask.resultPrompt || activeTask.payload?.quote || '');

      // Niche Hierarchy & Keywords: Prioritize AI Vision QA findings so user sees AI prediction!
      const aiN1 = activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '';
      const aiN2 = activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || '';
      const aiSub = activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || '';

      const n1 = activeTask.niche1 || activeTask.customAnswers?.niche1 || aiN1 || activeTask.payload?.niche1 || '';
      const n2 = activeTask.niche2 || activeTask.customAnswers?.niche2 || aiN2 || activeTask.payload?.niche2 || '';
      const sub = activeTask.subniche || activeTask.customAnswers?.subniche || aiSub || activeTask.payload?.subniche || '';
      const kw = activeTask.keywords || activeTask.customAnswers?.keywords || activeTask.payload?.keywords || activeTask.payload?.hermesKeywords || [];

      setEditNiche1(n1);
      setEditNiche2(n2 && n2.toLowerCase() !== 'none' ? n2 : '');
      setEditSubniche(sub && sub.toLowerCase() !== 'none' ? sub : '');
      setEditKeywords(Array.isArray(kw) ? kw.join(', ') : String(kw || ''));

      // TM Review Listing fields
      const fields = extractListingFields(activeTask);
      setEditableListing(fields);
      setLiveTmResult(activeTask.trademarkCheckResult || null);

      // SVG Review fields
      setEditedSvgData(activeTask.svgContent || '');
      setRevectorizeMaxColors(activeTask.customAnswers?.maxColors ?? activeTask.analysisResult?.color_analysis?.color_count ?? 2);
    }
  }, [selectedTaskId, activeTask?.status]);

  const toggleAudience = (aud: string) => {
    setSelectedAudiences(prev => {
      if (prev.includes(aud)) {
        const next = prev.filter(a => a !== aud);
        return next.length > 0 ? next : [aud];
      } else {
        return [...prev, aud];
      }
    });
  };

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
  const handleDesignReview = async (action: 'APPROVE' | 'REGENERATE_IMAGE' | 'DISCARD' | 'REJECT') => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const answers = {
        niche1: editNiche1,
        niche2: editNiche2,
        subniche: editSubniche,
        keywords: editKeywords,
        audience: selectedAudiences.join(', '),
        avoidColor: selectedAvoidColor,
        reuseBackground: selectedBgMode,
        maxColors: selectedMaxColors
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

  // Actions for Checkpoint 4: SVG Vector & Background Review
  const handleSvgDecision = async (action: 'APPROVE' | 'REGENERATE_VECTOR' | 'REJECT', maxColorsOverride?: number) => {
    if (!activeTask) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/submit-svg-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          editedSvgContent: editedSvgData || activeTask.svgContent,
          maxColors: maxColorsOverride || revectorizeMaxColors || activeTask.customAnswers?.maxColors || 2
        })
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

  // Filter Tasks
  const filteredTasks = tasks.filter(t => {
    if (filter === 'PRE_FLIGHT') return t.status === 'AWAITING_PRE_FLIGHT_REVIEW';
    if (filter === 'DESIGN') return t.status === 'AWAITING_DESIGN_REVIEW' || t.status === 'UPDATE_ANALYZED';
    if (filter === 'TRADEMARK') return t.status === 'AWAITING_TM_REVIEW';
    if (filter === 'SVG') return t.status === 'AWAITING_SVG_REVIEW';
    return true;
  });

  const preFlightCount = tasks.filter(t => t.status === 'AWAITING_PRE_FLIGHT_REVIEW').length;
  const designCount = tasks.filter(t => t.status === 'AWAITING_DESIGN_REVIEW' || t.status === 'UPDATE_ANALYZED').length;
  const tmCount = tasks.filter(t => t.status === 'AWAITING_TM_REVIEW').length;
  const svgCount = tasks.filter(t => t.status === 'AWAITING_SVG_REVIEW').length;

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

        {/* AI Autonomy Switches for Design & Update Pipelines */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Design Pipeline Autonomy */}
          <div className="flex items-center space-x-2.5 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 shadow-sm">
            <div className="w-6 h-6 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-400 border border-primary-500/20">
              <Sparkles className="w-3 h-3" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center space-x-1">
                <span className="text-[11px] font-semibold text-slate-200">Design Autonomie</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${aiAutonomyDesignEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                  {aiAutonomyDesignEnabled ? 'Aktiv' : 'Aus'}
                </span>
              </div>
              <span className="text-[9px] text-slate-500">Neue Designs (C1–C4)</span>
            </div>
            <button
              onClick={toggleAiAutonomyDesign}
              className={`w-8 h-4.5 rounded-full transition-colors relative ml-1.5 ${
                aiAutonomyDesignEnabled ? 'bg-primary-500' : 'bg-slate-700'
              }`}
            >
              <div className={`w-3 h-3 rounded-full bg-white transition-transform transform absolute top-0.5 ${
                aiAutonomyDesignEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* Update Pipeline Autonomy */}
          <div className="flex items-center space-x-2.5 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 shadow-sm">
            <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400 border border-teal-500/20">
              <Bot className="w-3 h-3" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center space-x-1">
                <span className="text-[11px] font-semibold text-slate-200">Update Autonomie</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${aiAutonomyUpdateEnabled ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' : 'bg-slate-800 text-slate-400'}`}>
                  {aiAutonomyUpdateEnabled ? 'Aktiv' : 'Aus'}
                </span>
              </div>
              <span className="text-[9px] text-slate-500">Amazon Updates (U1–U7)</span>
            </div>
            <button
              onClick={toggleAiAutonomyUpdate}
              className={`w-8 h-4.5 rounded-full transition-colors relative ml-1.5 ${
                aiAutonomyUpdateEnabled ? 'bg-teal-500' : 'bg-slate-700'
              }`}
            >
              <div className={`w-3 h-3 rounded-full bg-white transition-transform transform absolute top-0.5 ${
                aiAutonomyUpdateEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
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
                onClick={() => setFilter('SVG')}
                className={`flex-1 py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${filter === 'SVG' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>SVG</span>
                {svgCount > 0 && <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-400 text-slate-950 font-bold">{svgCount}</span>}
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
                const isSvg = t.status === 'AWAITING_SVG_REVIEW';
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
                          <TaskStatusBadge task={t} size="sm" />
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
                    <TaskStatusBadge task={activeTask} size="md" />
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
                {(activeTask.status === 'AWAITING_DESIGN_REVIEW' || activeTask.status === 'UPDATE_ANALYZED') && (
                  <div className="space-y-5">
                    {activeTask.source === 'UPDATE' ? (
                      /* UPDATE WORKFLOW: VISION AUDIT, FIT-TYPES & AVOID-COLOR */
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                        {/* Left: 2x2 Grid / Master Artwork Preview & Original Amazon Listing (5 cols) */}
                        <div className="md:col-span-5 space-y-3">
                          {/* Image Preview Card with Grid Toggle */}
                          <div className="bg-slate-950 p-2.5 rounded-xl border border-teal-500/40 space-y-2 shadow-sm">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                              <span className="flex items-center gap-1.5 text-teal-400">
                                <Sparkles className="w-3.5 h-3.5" />
                                {viewModeGrid ? '2x2 Grid (4 Textilfarben)' : 'Master-Artwork'}
                              </span>
                              <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                                <button
                                  type="button"
                                  onClick={() => setViewModeGrid(true)}
                                  className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                    viewModeGrid ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  2x2 Grid
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setViewModeGrid(false)}
                                  className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                    !viewModeGrid ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  Master PNG
                                </button>
                              </div>
                            </div>

                            <div className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-900 aspect-square max-h-[300px] flex items-center justify-center p-1.5">
                              {activeTask.localImagePath || activeTask.imageUrl || activeTask.id ? (
                                <>
                                  <img
                                    src={viewModeGrid 
                                      ? `/api/v1/designs/grid2x2/${encodeURIComponent(activeTask.id)}` 
                                      : (activeTask.localImagePath || activeTask.imageUrl || `/api/v1/designs/image/${encodeURIComponent(activeTask.id)}`)}
                                    alt={activeTask.payload?.title || 'Design Preview'}
                                    className="w-full h-full object-contain cursor-pointer rounded"
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
                                      href={viewModeGrid 
                                        ? `/api/v1/designs/grid2x2/${encodeURIComponent(activeTask.id)}` 
                                        : (activeTask.localImagePath || activeTask.imageUrl || `/api/v1/designs/image/${encodeURIComponent(activeTask.id)}`)}
                                      download={`${activeTask.id}-${viewModeGrid ? 'grid2x2.jpg' : 'master.png'}`}
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
                                <div className="text-xs text-slate-500">Master-Grafik wird geladen...</div>
                              )}
                            </div>
                          </div>

                          {/* Amazon Rejection Alert Banner if detected on Amazon */}
                          {Boolean(activeTask.payload?.hasRejection) && (
                            <div className="bg-rose-950/40 p-3.5 rounded-xl border border-rose-500/60 ring-1 ring-rose-500/30 text-xs shadow-lg space-y-1.5 animate-pulse">
                              <div className="flex items-center gap-2 text-rose-300 font-bold text-xs uppercase tracking-wider">
                                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                                <span>⚠️ Amazon Rejection / Policy-Warnung</span>
                              </div>
                              <p className="text-rose-200/90 text-[11px] leading-relaxed">
                                {activeTask.payload?.rejectionReason || 'Für dieses Design wurden auf Amazon abgelehnte Produkte oder Richtlinienhinweise festgestellt. Bitte vor dem Upload gründlich manuell prüfen!'}
                              </p>
                            </div>
                          )}

                          {/* Original Amazon Listing Card: Brand, Title, Bullets, Description */}
                          {(() => {
                            const oldListing = extractOldAmazonListing(activeTask);
                            return (
                              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5 text-xs shadow-sm">
                                <div className="flex items-center justify-between border-b border-slate-850 pb-1.5">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-teal-400" />
                                    Bestehendes Amazon-Listing
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500">
                                    {activeTask.payload?.designId ? `#${activeTask.payload.designId}` : ''}
                                  </span>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <span className="text-[10px] font-medium text-slate-400 block mb-0.5">Brand / Marke:</span>
                                    <div className="font-mono text-slate-200 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800 break-words text-xs">
                                      {oldListing.brand}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[10px] font-medium text-slate-400 block mb-0.5">Title / Produkttitel:</span>
                                    <div className="font-mono text-slate-100 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800 break-words leading-relaxed font-semibold text-xs">
                                      {oldListing.title}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[10px] font-medium text-slate-400 block mb-0.5">Bullet 1:</span>
                                    <div className="font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800 break-words leading-relaxed text-[11px]">
                                      {oldListing.bullet1}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[10px] font-medium text-slate-400 block mb-0.5">Bullet 2:</span>
                                    <div className="font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800 break-words leading-relaxed text-[11px]">
                                      {oldListing.bullet2}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[10px] font-medium text-slate-400 block mb-0.5">Description / Beschreibung:</span>
                                    <div className="font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800 break-words leading-relaxed text-[11px] max-h-24 overflow-y-auto">
                                      {oldListing.description}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right: Update Questions Matrix (7 cols) */}
                        <div className="md:col-span-7 space-y-3.5">
                          <h4 className="text-xs font-semibold text-teal-300 uppercase tracking-wider flex items-center">
                            <Sliders className="w-3.5 h-3.5 mr-1.5 text-teal-400" />
                            Update-Audit &amp; Fragen
                          </h4>

                          {/* 1. Design Check */}
                          {(() => {
                            const qVerdict = activeTask.analysisResult?.design_quality?.quality_verdict;
                            const isDefective = qVerdict === 'DEFECTIVE';
                            const verdictLabel = isDefective ? 'MANGELHAFT (DEFECTIVE)' : 'APPROVED';

                            return (
                              <div className={`p-3.5 rounded-xl border space-y-2 transition-all ${
                                isDefective ? 'bg-rose-950/20 border-rose-500/40' : 'bg-slate-900/90 border-slate-800'
                              }`}>
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                                    {isDefective ? (
                                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                                    ) : (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                    )}
                                    <span>1. Design Check</span>
                                  </div>
                                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded border font-mono ${
                                    isDefective
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  }`}>
                                    KI: {verdictLabel}
                                  </span>
                                </div>

                                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 space-y-1.5 text-[11px]">
                                  {isDefective && activeTask.analysisResult?.design_quality?.quality_issues ? (
                                    <p className="text-rose-200 leading-relaxed font-mono">
                                      {activeTask.analysisResult.design_quality.quality_issues}
                                    </p>
                                  ) : (
                                    <p className="text-slate-300 leading-relaxed">
                                      {activeTask.analysisResult?.design_quality?.quality_issues || 'Keine Schnittfehler, Kanten-Halos oder Bildartefakte auf den 4 Textilfarben erkannt. Motiv ist druckreif.'}
                                    </p>
                                  )}
                                  {activeTask.analysisResult?.quote_check?.detected_quote && (
                                    <div className="text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-850 flex items-center gap-1.5">
                                      <span className="text-teal-400 font-semibold">Erkannter Text:</span>
                                      <span className="text-slate-200 font-medium">"{activeTask.analysisResult.quote_check.detected_quote}"</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* 2. Listing-Rewrite Befund */}
                          {(() => {
                            const rewriteRecommended = activeTask.analysisResult?.listing_audit?.rewrite_recommended ?? activeTask.analysisResult?.rewriteNeeded ?? true;
                            return (
                              <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-slate-200">2. Listing-Rewrite Befund</span>
                                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded border font-mono ${
                                    rewriteRecommended 
                                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' 
                                      : 'bg-slate-500/20 text-slate-300 border-slate-500/40'
                                  }`}>
                                    KI: {rewriteRecommended ? 'JA (Optimieren)' : 'NEIN (Beibehalten)'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                                  {activeTask.analysisResult?.listing_audit?.current_weaknesses || activeTask.analysisResult?.reasoning || 'Bestehendes Listing wird nach aktuellem MBA Master-SEO analysiert.'}
                                </p>
                              </div>
                            );
                          })()}

                          {/* 3. Zielgruppe (Fit Types) */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">3. Zielgruppe (Fit Types)</span>
                              <span className="text-[10px] text-teal-400 font-mono font-semibold bg-teal-500/10 px-2.5 py-0.5 rounded border border-teal-500/20">
                                KI: {getAiFitTypesDisplay(activeTask)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {['Men', 'Women', 'Youth'].map((val) => {
                                const isSelected = selectedAudiences.includes(val);
                                return (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => toggleAudience(val)}
                                    className={`px-4 py-1.5 text-xs rounded-lg border transition-all flex items-center space-x-1.5 ${
                                      isSelected 
                                        ? 'bg-teal-600 text-white border-teal-500 font-semibold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                    }`}
                                  >
                                    {isSelected && <Check className="w-3.5 h-3.5 mr-0.5" />}
                                    <span>{val}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {activeTask.analysisResult?.target_group?.reason && (
                              <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                                💡 <strong className="text-teal-300">Befund:</strong> {activeTask.analysisResult.target_group.reason}
                              </p>
                            )}
                          </div>

                          {/* 4. Zu vermeidende Produktfarbe */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">4. Zu vermeidende Produktfarbe</span>
                              <span className="text-[10px] text-teal-400 font-mono font-semibold bg-teal-500/10 px-2.5 py-0.5 rounded border border-teal-500/20">
                                KI: {getAiAvoidColorDisplay(activeTask)}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {['Black', 'White', 'None'].map((val) => {
                                const isSelected = selectedAvoidColor === val;
                                return (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => setSelectedAvoidColor(val)}
                                    className={`px-4 py-1.5 text-xs rounded-lg border transition-all flex items-center space-x-1.5 ${
                                      isSelected 
                                        ? 'bg-teal-600 text-white border-teal-500 font-semibold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                    }`}
                                  >
                                    {isSelected && <Check className="w-3.5 h-3.5 mr-0.5" />}
                                    <span>{val}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {activeTask.analysisResult?.avoid_product_colors?.reason && (
                              <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                                💡 <strong className="text-teal-300">Befund:</strong> {activeTask.analysisResult.avoid_product_colors.reason}
                              </p>
                            )}
                          </div>

                          {/* 5. Nischen-Hierarchie & SEO-Keywords */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-teal-500/30 space-y-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-800 text-xs">
                              <span className="font-semibold text-teal-300 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5 text-teal-400" />
                                5. Nischen-Hierarchie &amp; SEO-Keywords
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const aiN1 = activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '';
                                    const aiN2 = activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || '';
                                    const aiSub = activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || '';
                                    const aiKw = activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords || [];
                                    if (aiN1) setEditNiche1(aiN1);
                                    if (aiN2 && aiN2.toLowerCase() !== 'none') setEditNiche2(aiN2); else if (!aiN2 || aiN2.toLowerCase() === 'none') setEditNiche2('');
                                    if (aiSub && aiSub.toLowerCase() !== 'none') setEditSubniche(aiSub); else if (!aiSub || aiSub.toLowerCase() === 'none') setEditSubniche('');
                                    if (Array.isArray(aiKw) && aiKw.length > 0) setEditKeywords(aiKw.join(', '));
                                    else if (typeof aiKw === 'string' && aiKw) setEditKeywords(aiKw);
                                  }}
                                  className="px-2.5 py-1 rounded text-[10px] font-semibold bg-teal-500/10 text-teal-300 hover:bg-teal-500/20 border border-teal-500/30 transition-colors flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Von LLM übernehmen
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const hN1 = activeTask.payload?.niche1 || activeTask.payload?.niche || '';
                                    const hN2 = activeTask.payload?.niche2 || '';
                                    const hSub = activeTask.payload?.subniche || '';
                                    const hKw = activeTask.payload?.keywords || activeTask.payload?.hermesKeywords || [];
                                    if (hN1) setEditNiche1(hN1);
                                    if (hN2 && hN2.toLowerCase() !== 'none') setEditNiche2(hN2); else if (!hN2 || hN2.toLowerCase() === 'none') setEditNiche2('');
                                    if (hSub && hSub.toLowerCase() !== 'none') setEditSubniche(hSub); else if (!hSub || hSub.toLowerCase() === 'none') setEditSubniche('');
                                    if (hKw.length > 0) setEditKeywords(Array.isArray(hKw) ? hKw.join(', ') : String(hKw));
                                  }}
                                  className="px-2.5 py-1 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Von Hermes übernehmen
                                </button>
                              </div>
                            </div>

                            {/* Comparison Cards: Hermes (if present) vs LLM Recognition */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                              {/* Hermes / Original Nischen */}
                              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                                <span className="text-[10px] text-purple-400 font-bold flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> Hermes-Nischen:
                                </span>
                                <div className="text-slate-300 space-y-0.5">
                                  <div>N1: <span className="text-slate-200">{activeTask.payload?.niche1 || activeTask.payload?.niche || '-'}</span></div>
                                  <div>Cross: <span className="text-slate-300">{activeTask.payload?.niche2 || 'none'}</span></div>
                                  <div>Subnische: <span className="text-slate-300">{activeTask.payload?.subniche || 'none'}</span></div>
                                  <div>Keywords: <span className="text-slate-400 text-[10px] truncate block" title={Array.isArray(activeTask.payload?.keywords || activeTask.payload?.hermesKeywords) ? (activeTask.payload?.keywords || activeTask.payload?.hermesKeywords).join(', ') : (activeTask.payload?.keywords || 'none')}>{Array.isArray(activeTask.payload?.keywords || activeTask.payload?.hermesKeywords) ? (activeTask.payload?.keywords || activeTask.payload?.hermesKeywords).join(', ') : (activeTask.payload?.keywords || 'none')}</span></div>
                                </div>
                              </div>

                              {/* KI / LLM Recognition */}
                              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                                <span className="text-[10px] text-teal-400 font-bold flex items-center gap-1">
                                  <Bot className="w-3 h-3" /> LLM-Erkennung:
                                </span>
                                <div className="text-slate-300 space-y-0.5">
                                  <div>N1: <strong className="text-slate-100">{activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '-'}</strong></div>
                                  <div>Cross: <span className="text-slate-300">{activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || 'none'}</span></div>
                                  <div>Subnische: <strong className="text-teal-300">{activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || 'none'}</strong></div>
                                  <div>Keywords: <span className="text-teal-300/80 text-[10px] truncate block" title={Array.isArray(activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords) ? (activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords).join(', ') : 'none'}>{Array.isArray(activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords) ? (activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords).join(', ') : 'none'}</span></div>
                                </div>
                              </div>
                            </div>

                            {/* 3 Niche Input Fields */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <div>
                                <label className="text-[10px] font-medium text-slate-400 block mb-1">Nische 1 (Hauptthema)</label>
                                <input
                                  type="text"
                                  value={editNiche1}
                                  onChange={(e) => setEditNiche1(e.target.value)}
                                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-teal-500 focus:outline-none"
                                  placeholder="z.B. Horse"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-slate-400 block mb-1">Nische 2 (Cross-Nische)</label>
                                <input
                                  type="text"
                                  value={editNiche2}
                                  onChange={(e) => setEditNiche2(e.target.value)}
                                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-teal-500 focus:outline-none"
                                  placeholder="z.B. Coffee"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-teal-400 block mb-1">Subnische (Titel-Ende)</label>
                                <input
                                  type="text"
                                  value={editSubniche}
                                  onChange={(e) => setEditSubniche(e.target.value)}
                                  className="w-full bg-slate-950 border border-teal-500/40 rounded px-2.5 py-1.5 text-xs text-teal-300 font-bold font-mono focus:border-teal-500 focus:outline-none"
                                  placeholder="z.B. Shetland Pony"
                                />
                              </div>
                            </div>

                            {/* Keywords Input Field */}
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 block mb-1">Such-Keywords (SEO)</label>
                              <input
                                type="text"
                                value={editKeywords}
                                onChange={(e) => setEditKeywords(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:border-teal-500 focus:outline-none"
                                placeholder="z.B. equestrian, pony rider, stable, funny horse quote..."
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* DESIGN CREATION WORKFLOW: IDEOGRAM PREVIEW, QUOTE CHECK, FIT-TYPES, AVOID-COLOR, BG & MAX-COLORS */
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                        {/* Left: Image Preview & Prompt (5 cols) */}
                        <div className="md:col-span-5 space-y-3">
                          {/* Image Preview Card */}
                          <div className="bg-slate-950 p-2.5 rounded-xl border border-cyan-500/40 space-y-2 shadow-sm">
                            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                              <span className="flex items-center gap-1.5 text-cyan-400">
                                <Sparkles className="w-3.5 h-3.5" />
                                Ideogram Artwork Preview
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">
                                {activeTask.id}
                              </span>
                            </div>

                            <div className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-900 aspect-square max-h-[300px] flex items-center justify-center p-1.5">
                              {activeTask.imageUrl ? (
                                <>
                                  <img
                                    src={activeTask.imageUrl}
                                    alt={activeTask.payload?.quote}
                                    className="w-full h-full object-contain cursor-pointer rounded"
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
                          </div>

                          {/* Editable Prompt Card */}
                          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 shadow-sm">
                            <div className="flex items-center justify-between border-b border-slate-850 pb-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                                Prompt (Ideogram 3.0)
                              </span>
                            </div>
                            <textarea
                              value={editablePrompt}
                              onChange={(e) => setEditablePrompt(e.target.value)}
                              rows={3}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 leading-relaxed"
                              placeholder="Ideogram Prompt..."
                            />
                          </div>
                        </div>

                        {/* Right: Questions Matrix (7 cols) */}
                        <div className="md:col-span-7 space-y-3.5">
                          <h4 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center">
                            <Sliders className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                            Vision-KI Analyse &amp; Fragen
                          </h4>

                          {/* 1. Quote-Prüfung */}
                          {(() => {
                            const isExact = Boolean(activeTask.analysisResult?.quote_check?.quote_matches);
                            return (
                              <div className={`p-3.5 rounded-xl border space-y-2 transition-all ${
                                !isExact && activeTask.analysisResult?.quote_check 
                                  ? 'bg-amber-950/20 border-amber-500/40' 
                                  : 'bg-slate-900/90 border-slate-800'
                              }`}>
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                                    {isExact ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                    ) : (
                                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                                    )}
                                    <span>1. Quote-Prüfung</span>
                                  </div>
                                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded border font-mono ${
                                    isExact
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  }`}>
                                    KI: {isExact ? 'EXAKT' : 'ABWEICHUNG'}
                                  </span>
                                </div>

                                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 space-y-1 text-[11px] font-mono">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400 w-14 shrink-0">Soll:</span>
                                    <span className="text-slate-100 font-semibold">"{activeTask.payload?.quote || '-'}"</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-cyan-400 w-14 shrink-0 font-semibold">Erkannt:</span>
                                    <span className="text-cyan-200">"{activeTask.analysisResult?.quote_check?.detected_quote || activeTask.analysisResult?.quote_check?.detected_quote_text || '-'}"</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 2. Zielgruppe (Fit Types) */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">2. Zielgruppe (Fit Types)</span>
                              <span className="text-[10px] text-cyan-400 font-mono font-semibold bg-cyan-500/10 px-2.5 py-0.5 rounded border border-cyan-500/20">
                                KI: {getAiFitTypesDisplay(activeTask)}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {['Men', 'Women', 'Youth'].map((val) => {
                                const isSelected = selectedAudiences.includes(val);
                                return (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => toggleAudience(val)}
                                    className={`px-4 py-1.5 text-xs rounded-lg border transition-all flex items-center space-x-1.5 ${
                                      isSelected 
                                        ? 'bg-cyan-600 text-white border-cyan-500 font-semibold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                    }`}
                                  >
                                    {isSelected && <Check className="w-3.5 h-3.5 mr-0.5" />}
                                    <span>{val}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {activeTask.analysisResult?.target_group?.reason && (
                              <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                                💡 <strong className="text-cyan-300">Befund:</strong> {activeTask.analysisResult.target_group.reason}
                              </p>
                            )}
                          </div>

                          {/* 3. Zu vermeidende Produktfarbe */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">3. Zu vermeidende Produktfarbe</span>
                              <span className="text-[10px] text-cyan-400 font-mono font-semibold bg-cyan-500/10 px-2.5 py-0.5 rounded border border-cyan-500/20">
                                KI: {getAiAvoidColorDisplay(activeTask)}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {['Black', 'White', 'None'].map((val) => {
                                const isSelected = selectedAvoidColor === val;
                                return (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => setSelectedAvoidColor(val)}
                                    className={`px-4 py-1.5 text-xs rounded-lg border transition-all flex items-center space-x-1.5 ${
                                      isSelected 
                                        ? 'bg-cyan-600 text-white border-cyan-500 font-semibold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                    }`}
                                  >
                                    {isSelected && <Check className="w-3.5 h-3.5 mr-0.5" />}
                                    <span>{val}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {activeTask.analysisResult?.avoid_product_colors?.reason && (
                              <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                                💡 <strong className="text-cyan-300">Befund:</strong> {activeTask.analysisResult.avoid_product_colors.reason}
                              </p>
                            )}
                          </div>

                          {/* 4. Hintergrund entfernen */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">4. Hintergrund entfernen</span>
                              <span className="text-[10px] text-cyan-400 font-mono font-semibold bg-cyan-500/10 px-2.5 py-0.5 rounded border border-cyan-500/20">
                                KI: {activeTask.analysisResult?.background_analysis?.removal_mode === 'MANUAL' || activeTask.analysisResult?.background_analysis?.is_design_element === true ? 'Manuell' : 'Automatisch'}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {['Automatisch', 'Manuell'].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setSelectedBgMode(val)}
                                  className={`px-4 py-1.5 text-xs rounded-lg border transition-all flex items-center space-x-1.5 ${
                                    selectedBgMode === val || 
                                    (val === 'Automatisch' && (selectedBgMode === 'Nein (Auto Freistellen)' || selectedBgMode === 'AUTOMATIC')) ||
                                    (val === 'Manuell' && (selectedBgMode === 'Ja (Hintergrund behalten)' || selectedBgMode === 'MANUAL'))
                                      ? 'bg-cyan-600 text-white border-cyan-500 font-semibold shadow-sm'
                                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                  }`}
                                >
                                  {(selectedBgMode === val || 
                                    (val === 'Automatisch' && (selectedBgMode === 'Nein (Auto Freistellen)' || selectedBgMode === 'AUTOMATIC')) ||
                                    (val === 'Manuell' && (selectedBgMode === 'Ja (Hintergrund behalten)' || selectedBgMode === 'MANUAL'))) && (
                                    <Check className="w-3.5 h-3.5 mr-0.5" />
                                  )}
                                  <span>{val}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 5. Maximale Anzahl an Farben (Vektorisierung) */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-200">5. Maximale Anzahl an Farben (Vektorisierung)</span>
                              <span className="text-[10px] text-cyan-400 font-mono font-semibold bg-cyan-500/10 px-2.5 py-0.5 rounded border border-cyan-500/20">
                                KI: {activeTask.analysisResult?.color_analysis?.color_count ? `${activeTask.analysisResult.color_analysis.color_count} Farben` : '2 Farben'}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 items-center">
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() => setSelectedMaxColors(num)}
                                  className={`w-8 h-7 text-xs rounded-lg font-mono border transition-all ${
                                    selectedMaxColors === num
                                      ? 'bg-cyan-600 text-white border-cyan-500 font-bold shadow-sm'
                                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                                  }`}
                                >
                                  {num}
                                </button>
                              ))}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Wird als <code className="text-slate-400 font-mono">processing.max_colors</code> an Vectorizer.ai übergeben (max. 12).
                            </div>
                          </div>

                          {/* 6. Nischen-Hierarchie & SEO-Keywords */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-cyan-500/30 space-y-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-800 text-xs">
                              <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5 text-cyan-400" />
                                6. Nischen-Hierarchie &amp; SEO-Keywords
                              </span>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const aiN1 = activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '';
                                    const aiN2 = activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || '';
                                    const aiSub = activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || '';
                                    const aiKw = activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords || [];
                                    if (aiN1) setEditNiche1(aiN1);
                                    if (aiN2 && aiN2.toLowerCase() !== 'none') setEditNiche2(aiN2); else if (!aiN2 || aiN2.toLowerCase() === 'none') setEditNiche2('');
                                    if (aiSub && aiSub.toLowerCase() !== 'none') setEditSubniche(aiSub); else if (!aiSub || aiSub.toLowerCase() === 'none') setEditSubniche('');
                                    if (Array.isArray(aiKw) && aiKw.length > 0) setEditKeywords(aiKw.join(', '));
                                    else if (typeof aiKw === 'string' && aiKw) setEditKeywords(aiKw);
                                  }}
                                  className="px-2.5 py-1 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" />
                                  Von LLM übernehmen
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const hN1 = activeTask.payload?.niche1 || activeTask.payload?.niche || '';
                                    const hN2 = activeTask.payload?.niche2 || '';
                                    const hSub = activeTask.payload?.subniche || '';
                                    const hKw = activeTask.payload?.keywords || activeTask.payload?.hermesKeywords || [];
                                    if (hN1) setEditNiche1(hN1);
                                    if (hN2 && hN2.toLowerCase() !== 'none') setEditNiche2(hN2); else if (!hN2 || hN2.toLowerCase() === 'none') setEditNiche2('');
                                    if (hSub && hSub.toLowerCase() !== 'none') setEditSubniche(hSub); else if (!hSub || hSub.toLowerCase() === 'none') setEditSubniche('');
                                    if (hKw.length > 0) setEditKeywords(Array.isArray(hKw) ? hKw.join(', ') : String(hKw));
                                  }}
                                  className="px-2.5 py-1 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Von Hermes übernehmen
                                </button>
                              </div>
                            </div>

                            {/* Comparison Cards: Hermes vs LLM Recognition */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                              {/* Hermes Payload */}
                              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                                <span className="text-[10px] text-purple-400 font-bold flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> Hermes-Payload:
                                </span>
                                <div className="text-slate-300 space-y-0.5">
                                  <div>N1: <span className="text-slate-200">{activeTask.payload?.niche1 || activeTask.payload?.niche || '-'}</span></div>
                                  <div>Cross: <span className="text-slate-300">{activeTask.payload?.niche2 || 'none'}</span></div>
                                  <div>Subnische: <span className="text-slate-300">{activeTask.payload?.subniche || 'none'}</span></div>
                                  <div>Keywords: <span className="text-slate-400 text-[10px] truncate block" title={Array.isArray(activeTask.payload?.keywords || activeTask.payload?.hermesKeywords) ? (activeTask.payload?.keywords || activeTask.payload?.hermesKeywords).join(', ') : (activeTask.payload?.keywords || 'none')}>{Array.isArray(activeTask.payload?.keywords || activeTask.payload?.hermesKeywords) ? (activeTask.payload?.keywords || activeTask.payload?.hermesKeywords).join(', ') : (activeTask.payload?.keywords || 'none')}</span></div>
                                </div>
                              </div>

                              {/* KI / LLM Recognition */}
                              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                                <span className="text-[10px] text-cyan-400 font-bold flex items-center gap-1">
                                  <Bot className="w-3 h-3" /> LLM-Erkennung:
                                </span>
                                <div className="text-slate-300 space-y-0.5">
                                  <div>N1: <strong className="text-slate-100">{activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '-'}</strong></div>
                                  <div>Cross: <span className="text-slate-300">{activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || 'none'}</span></div>
                                  <div>Subnische: <strong className="text-cyan-300">{activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || 'none'}</strong></div>
                                  <div>Keywords: <span className="text-cyan-300/80 text-[10px] truncate block" title={Array.isArray(activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords) ? (activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords).join(', ') : 'none'}>{Array.isArray(activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords) ? (activeTask.analysisResult?.niche_analysis?.keywords || activeTask.analysisResult?.keywords || activeTask.keywords).join(', ') : 'none'}</span></div>
                                </div>
                              </div>
                            </div>

                            {/* 3 Niche Input Fields */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <div>
                                <label className="text-[10px] font-medium text-slate-400 block mb-1">Nische 1 (Hauptthema)</label>
                                <input
                                  type="text"
                                  value={editNiche1}
                                  onChange={(e) => setEditNiche1(e.target.value)}
                                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
                                  placeholder="z.B. Horse"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-slate-400 block mb-1">Nische 2 (Cross-Nische)</label>
                                <input
                                  type="text"
                                  value={editNiche2}
                                  onChange={(e) => setEditNiche2(e.target.value)}
                                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
                                  placeholder="z.B. Coffee"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-cyan-400 block mb-1">Subnische (Titel-Ende)</label>
                                <input
                                  type="text"
                                  value={editSubniche}
                                  onChange={(e) => setEditSubniche(e.target.value)}
                                  className="w-full bg-slate-950 border border-cyan-500/40 rounded px-2.5 py-1.5 text-xs text-cyan-300 font-bold font-mono focus:border-cyan-500 focus:outline-none"
                                  placeholder="z.B. Shetland Pony"
                                />
                              </div>
                            </div>

                            {/* Keywords Input Field */}
                            <div>
                              <label className="text-[10px] font-medium text-slate-400 block mb-1">Such-Keywords (SEO)</label>
                              <input
                                type="text"
                                value={editKeywords}
                                onChange={(e) => setEditKeywords(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:border-cyan-500 focus:outline-none"
                                placeholder="z.B. equestrian, pony rider, stable, funny horse quote..."
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Checkpoint 2 Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleDesignReview('DISCARD')}
                          disabled={isSubmitting}
                          className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Task abbrechen</span>
                        </button>
                        {activeTask.source !== 'UPDATE' && (
                          <button
                            onClick={() => handleDesignReview('REGENERATE_IMAGE')}
                            disabled={isSubmitting}
                            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Bild neu generieren</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleDesignReview('APPROVE')}
                          disabled={isSubmitting}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-2 transition-all disabled:opacity-50 shadow-md shadow-emerald-950/40"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>{activeTask.source === 'UPDATE' ? 'Bestätigen & Weiter (U4–U7)' : 'Listing generieren'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* CHECKPOINT 3: MANUELLE TRADEMARK- & LISTING-PRÜFUNG                       */}
                {/* ========================================================================= */}
                {/* ========================================================================= */}
                {/* CHECKPOINT 3: MANUELLE TRADEMARK- & LISTING-PRÜFUNG (WORKFLOW V2)         */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_TM_REVIEW' && (() => {
                  const auditV2 = liveTmResult?.auditV2 || (activeTask as any).tmAuditV2;
                  const hitsList = auditV2?.finalTrademarkHits || auditV2?.initialTrademarkHits || [];
                  const forbiddenTerms: string[] = auditV2?.forbiddenTermsForTask || [];
                  const refereeDecision = auditV2?.refereeResult?.decision || auditV2?.finalDecision;
                  const verifierVerdict = auditV2?.verifierResult?.verdict;

                  return (
                    <div className="space-y-5">
                      {/* Intro & V2 Status Banner */}
                      <div className="bg-purple-950/25 border border-purple-500/30 p-4 rounded-xl space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center justify-center shrink-0">
                              <ShieldAlert className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h4 className="text-xs font-bold text-slate-100">Trademark Workflow V2 Review</h4>
                                {refereeDecision && (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    refereeDecision === 'APPROVE' || refereeDecision === 'APPROVE_WITH_BLOCKED_PRODUCTS'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : refereeDecision === 'REWRITE'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  }`}>
                                    Referee: {refereeDecision}
                                  </span>
                                )}
                                {verifierVerdict && (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    verifierVerdict === 'SAFE'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  }`}>
                                    Verifier: {verifierVerdict}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400">
                                {activeTask.errorDetails || 'Passe das Listing an, um Markentreffer in Klasse 25 (Bekleidung) zu eliminieren.'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={handleTmRecheck}
                            disabled={isCheckingTm || isSubmitting}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm shrink-0"
                          >
                            <Search className={`w-3.5 h-3.5 ${isCheckingTm ? 'animate-spin' : ''}`} />
                            <span>{isCheckingTm ? 'Prüfe USPTO...' : 'Neu prüfen (USPTO)'}</span>
                          </button>
                        </div>

                        {/* Forbidden Terms Chips */}
                        {forbiddenTerms.length > 0 && (
                          <div className="pt-2.5 border-t border-purple-500/20 space-y-1">
                            <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Verbotene / Blockierte Begriffe in diesem Task:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {forbiddenTerms.map((term, i) => (
                                <span key={i} className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-500/40 text-[11px] font-mono font-medium">
                                  ✕ {term}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* V2 Normalized Hits Table (if available) */}
                      {hitsList.length > 0 && (
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                            <span className="flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-amber-400" />
                              Erkannte Schutzrechte ({hitsList.length} Treffer):
                            </span>
                            <span className="text-[10px] text-slate-400">Quelle: USPTO Live Batch API</span>
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                            {hitsList.map((h: any, i: number) => {
                              const isK25 = (h.classes || []).includes(25);
                              return (
                                <div key={i} className={`p-2 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 ${
                                  isK25 ? 'bg-rose-950/20 border-rose-500/30 text-rose-200' : 'bg-slate-900 border-slate-800 text-slate-300'
                                }`}>
                                  <div className="space-y-0.5 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <strong className="text-slate-100 font-bold">{h.registeredMark || h.searchedTerm}</strong>
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                                        h.matchType === 'FULL_EXACT' ? 'bg-rose-600 text-white' :
                                        h.matchType === 'EXACT_NGRAM' ? 'bg-rose-500/30 text-rose-300' :
                                        h.matchType === 'SINGLE_WORD_EXACT' ? 'bg-amber-500/30 text-amber-300' :
                                        'bg-slate-800 text-slate-400'
                                      }`}>
                                        {h.matchType || 'MATCH'}
                                      </span>
                                      {h.field && (
                                        <span className="text-[10px] text-purple-400 uppercase font-sans font-bold">
                                          in {h.field}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                      <span>Gesucht: "{h.searchedTerm}"</span>
                                      <span>•</span>
                                      <span>Typ: {h.markFeature || 'Word'}</span>
                                      {h.serialNumber && <span>• SN: {h.serialNumber}</span>}
                                    </div>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                    isK25 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  }`}>
                                    Klasse {Array.isArray(h.classes) ? h.classes.join(', ') : (h.classNumber || '25')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Listing Fields Editor */}
                      <div className="space-y-4">
                        {/* Brand */}
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-300 uppercase tracking-wider">Brand Name (40–50 Zeichen)</span>
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
                            <span className="font-semibold text-slate-300 uppercase tracking-wider">Design Title (50–60 Zeichen, locked Subniche Suffix)</span>
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
                            <span className="font-semibold text-slate-300 uppercase tracking-wider">Feature Bullet 1 (230–256 Zeichen)</span>
                            <span className={`font-mono text-[10px] font-bold ${editableListing.bullet1.length > 256 ? 'text-rose-400' : 'text-slate-400'}`}>
                              {editableListing.bullet1.length}/256
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
                            <span className="font-semibold text-slate-300 uppercase tracking-wider">Feature Bullet 2 (230–256 Zeichen)</span>
                            <span className={`font-mono text-[10px] font-bold ${editableListing.bullet2.length > 256 ? 'text-rose-400' : 'text-slate-400'}`}>
                              {editableListing.bullet2.length}/256
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
                            <span className="font-semibold text-slate-300 uppercase tracking-wider">Product Description (300–600 Zeichen)</span>
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
                            <span>Freigeben &amp; Weiter</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ========================================================================= */}
                {/* CHECKPOINT 4: SVG HINTERGRUND & VEKTOR-PRÜFUNG                            */}
                {/* ========================================================================= */}
                {activeTask.status === 'AWAITING_SVG_REVIEW' && (
                  <div className="space-y-4">
                    {/* Top Info Banner & Vectorizer Controls */}
                    <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2 text-emerald-300 font-semibold text-xs">
                          <Palette className="w-4 h-4 text-emerald-400" />
                          <span>Interaktiver SVG Vektor-Editor &amp; Hintergrundentfernung</span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Entferne Hintergrundflächen mit <strong>Auto BG Remove</strong> oder wähle mit <strong>Remove Color</strong> / <strong>Remove Connected</strong> gezielt Flächen aus (Löschen mit <kbd className="px-1 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Backspace</kbd>).
                        </p>
                      </div>

                      {/* Farbanzahl Stepper / Buttons for quick re-vectorization */}
                      <div className="flex items-center space-x-2 shrink-0 bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800">
                        <span className="text-[11px] text-slate-300 font-semibold flex items-center gap-1">
                          <Sliders className="w-3 h-3 text-cyan-400" />
                          Farben:
                        </span>
                        <div className="flex items-center space-x-1">
                          {[1, 2, 3, 4, 6, 8, 12].map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => {
                                setRevectorizeMaxColors(n);
                                handleSvgDecision('REGENERATE_VECTOR', n);
                              }}
                              disabled={isSubmitting}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                                revectorizeMaxColors === n
                                  ? 'bg-cyan-600 text-white border-cyan-500 font-bold shadow'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                              }`}
                              title={`Mit ${n} Farben neu vektorisieren`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* AI Cutout Audit Warning (if flagged) */}
                    {activeTask.svgAuditResult && activeTask.svgAuditResult.cutout_verdict === 'REJECTED' && (
                      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 text-amber-300 font-semibold">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>KI Cutout-Audit: Manuelle Nacharbeit empfohlen</span>
                          </div>
                          {activeTask.fourPanelImageUrl && (
                            <a
                              href={activeTask.fourPanelImageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-semibold text-cyan-300 hover:underline flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>4-Panel Kontrollbild ansehen</span>
                            </a>
                          )}
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {activeTask.svgAuditResult.explanation}
                        </p>
                        {Array.isArray(activeTask.svgAuditResult.detected_issues) && activeTask.svgAuditResult.detected_issues.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {activeTask.svgAuditResult.detected_issues.map((issue: string, idx: number) => (
                              <span key={idx} className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 text-[10px] font-mono">
                                ⚠️ {issue}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SvgEditor Component */}
                    <SvgEditor
                      taskId={activeTask.id}
                      initialSvgContent={activeTask.svgContent}
                      onSave={(updatedSvg) => setEditedSvgData(updatedSvg)}
                      isSaving={isSubmitting}
                    />

                    {/* Checkpoint 4 Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => handleSvgDecision('REJECT')}
                        disabled={isSubmitting}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span>Verwerfen</span>
                      </button>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleSvgDecision('REGENERATE_VECTOR')}
                          disabled={isSubmitting}
                          className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 flex items-center space-x-1.5 transition-all disabled:opacity-50"
                          title="Vektorisierung mit aktuellen Farbeinstellungen neu starten"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                          <span>Neu vektorisieren ({revectorizeMaxColors} Farben)</span>
                        </button>

                        <button
                          onClick={() => handleSvgDecision('APPROVE')}
                          disabled={isSubmitting}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-1.5 transition-all disabled:opacity-50 shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Design &amp; Vektor freigeben</span>
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
      {showImageZoom && activeTask && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setShowImageZoom(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img
              src={viewModeGrid && activeTask.source === 'UPDATE'
                ? `/api/v1/designs/grid2x2/${encodeURIComponent(activeTask.id)}`
                : (activeTask.localImagePath || activeTask.imageUrl || `/api/v1/designs/image/${encodeURIComponent(activeTask.id)}`)}
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

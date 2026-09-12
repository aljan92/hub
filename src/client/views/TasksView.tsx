import React, { useState, useEffect, useCallback, useRef } from 'react';
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

import { DesignTaskLog, TaskSummary, isTaskAwaitingUserAction } from '../../types/tasks';
import { SvgEditor } from '../components/SvgEditor';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { useReviewSession } from '../hooks/useReviewSession';
import { createReviewDraft } from '../utils/reviewDraft';
import { useTaskWebSocket } from '../hooks/useTaskWebSocket';

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
// Helper: Background Color Picker & Preview Component
// ---------------------------------------------------------------------------
interface BackgroundColorSectionProps {
  label: string;
  stepNumber: string;
  color: string;
  onChange: (hex: string) => void;
  aiRecommendation?: { hex?: string; name?: string; reason?: string };
  reason?: string;
  accentColor: 'teal' | 'cyan';
}

const PRESET_COLORS = [
  { hex: '#000000', label: 'Schwarz' },
  { hex: '#2B2B2B', label: 'Dark Heather' },
  { hex: '#1A2332', label: 'Navy' },
  { hex: '#FFFFFF', label: 'Weiß' },
  { hex: '#F5F5F5', label: 'Off-White' }
];

const BackgroundColorSection: React.FC<BackgroundColorSectionProps> = ({
  label,
  stepNumber,
  color,
  onChange,
  aiRecommendation,
  reason,
  accentColor
}) => {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const isTeal = accentColor === 'teal';
  const validHex = /^#?[0-9A-Fa-f]{6}$/.test(color.trim());
  const displayColor = validHex ? (color.startsWith('#') ? color : `#${color}`) : '#1A1A1A';

  return (
    <div className="bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-200">{stepNumber} {label}</span>
        {aiRecommendation?.hex && (
          <span className={`text-[10px] ${isTeal ? 'text-teal-400 bg-teal-500/10 border-teal-500/20' : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'} font-mono font-semibold px-2.5 py-0.5 rounded border flex items-center gap-1.5`}>
            <span className="w-2 h-2 rounded-full border border-white/20 inline-block shrink-0" style={{ backgroundColor: aiRecommendation.hex }} />
            KI: {aiRecommendation.hex}{aiRecommendation.name ? ` (${aiRecommendation.name})` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Optische Farbvorschau & interaktiver Color Picker */}
        <div className="relative group">
          <button
            type="button"
            onClick={() => colorInputRef.current?.click()}
            className="w-8 h-8 rounded-lg border border-slate-700 shadow-sm flex items-center justify-center relative overflow-hidden transition-all group-hover:border-slate-500 group-hover:scale-105"
            style={{ backgroundColor: displayColor }}
            title="Klicken, um Color-Picker zu öffnen"
          >
            <Palette className="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] opacity-60 group-hover:opacity-100 transition-opacity" />
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={displayColor}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="sr-only"
            aria-label="Farbe auswählen"
          />
        </div>

        {/* Hex Textfeld */}
        <div className="w-24">
          <input
            type="text"
            value={color}
            onChange={(e) => {
              const val = e.target.value.trim();
              onChange(val.startsWith('#') ? val.toUpperCase() : (val ? `#${val.toUpperCase()}` : ''));
            }}
            placeholder="#1E293B"
            maxLength={7}
            className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 uppercase transition-all focus:outline-none ${
              isTeal ? 'focus:border-teal-500 focus:ring-1 focus:ring-teal-500' : 'focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
            }`}
          />
        </div>

        {/* Quick Presets & Reset auf KI */}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {aiRecommendation?.hex && (
            <button
              type="button"
              onClick={() => onChange(aiRecommendation.hex!.toUpperCase())}
              className={`px-2 py-1 text-[11px] rounded-lg border transition-all flex items-center space-x-1 ${
                color.toUpperCase() === aiRecommendation.hex.toUpperCase()
                  ? (isTeal ? 'bg-teal-600 text-white border-teal-500 font-semibold shadow-sm' : 'bg-cyan-600 text-white border-cyan-500 font-semibold shadow-sm')
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
              }`}
              title="Auf KI-Empfehlung zurücksetzen"
            >
              <span className="w-2 h-2 rounded-full border border-white/20 inline-block" style={{ backgroundColor: aiRecommendation.hex }} />
              <span>KI-Reset</span>
            </button>
          )}

          {PRESET_COLORS.map((p) => {
            const isSelected = color.toUpperCase() === p.hex.toUpperCase();
            return (
              <button
                key={p.hex}
                type="button"
                onClick={() => onChange(p.hex)}
                className={`px-2 py-1 text-[11px] rounded-lg border transition-all flex items-center space-x-1 ${
                  isSelected 
                    ? (isTeal ? 'bg-teal-600 text-white border-teal-500 font-semibold shadow-sm' : 'bg-cyan-600 text-white border-cyan-500 font-semibold shadow-sm')
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                }`}
                title={p.label}
              >
                <span className="w-2 h-2 rounded-full border border-white/20 inline-block" style={{ backgroundColor: p.hex }} />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {reason && (
        <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800/80">
          💡 <strong className={isTeal ? 'text-teal-300' : 'text-cyan-300'}>Befund:</strong> {reason}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeTaskDetail, setActiveTaskDetail] = useState<DesignTaskLog | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<{taskId: string; message: string} | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [filter, setFilter] = useState<'ALL' | 'PRE_FLIGHT' | 'DESIGN' | 'TRADEMARK' | 'SVG'>('ALL');
  const [aiAutonomyDesignEnabled, setAiAutonomyDesignEnabled] = useState(false);
  const [aiAutonomyUpdateEnabled, setAiAutonomyUpdateEnabled] = useState(false);
  const [submittingTaskIds, setSubmittingTaskIds] = useState<Set<string>>(() => new Set());
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [showImageZoom, setShowImageZoom] = useState(false);
  const [viewModeGrid, setViewModeGrid] = useState(true);
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

  const selectedTaskIdRef = useRef<string>('');
  const activeTaskDetailRef = useRef<DesignTaskLog | null>(null);
  const detailAbortControllerRef = useRef<AbortController | null>(null);
  const detailRequestSequenceRef = useRef(0);
  const detailInFlightRef = useRef<string | null>(null);
  const detailFollowupRef = useRef(false);
  const listRequestSequenceRef = useRef(0);
  const latestSummaryUpdatedAtRef = useRef<Record<string, string>>({});
  const suppressedTaskIdsRef = useRef<Map<string, number>>(new Map());
  selectedTaskIdRef.current = selectedTaskId;
  activeTaskDetailRef.current = activeTaskDetail;

  const fetchActiveTaskDetail = useCallback(async (taskId: string): Promise<void> => {
    if (!taskId) {
      setActiveTaskDetail(null);
      return;
    }
    if (detailInFlightRef.current === taskId) {
      detailFollowupRef.current = true;
      return;
    }
    detailAbortControllerRef.current?.abort();
    detailInFlightRef.current = taskId;
    detailFollowupRef.current = false;
    const controller = new AbortController();
    detailAbortControllerRef.current = controller;
    const requestSequence = ++detailRequestSequenceRef.current;
    const isInitialLoad = activeTaskDetailRef.current?.id !== taskId;
    if (isInitialLoad) setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok || !data.success || data.task?.id !== taskId || typeof data.task.reviewVersion !== 'string') throw new Error(data.error || 'Review-Details konnten nicht eindeutig geladen werden.');
      if (data.success && data.task?.id === taskId &&
          selectedTaskIdRef.current === taskId &&
          detailRequestSequenceRef.current === requestSequence) {
        const latestSummaryUpdatedAt = latestSummaryUpdatedAtRef.current[taskId];
        const responseUpdatedAt = data.task.updatedAt;
        if (latestSummaryUpdatedAt && responseUpdatedAt && responseUpdatedAt < latestSummaryUpdatedAt) {
          throw new Error('Review-Details sind noch nicht aktuell. Bitte erneut laden.');
        }
        setActiveTaskDetail(data.task);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[TasksView] Error loading task detail:', err);
        if (detailRequestSequenceRef.current === requestSequence && selectedTaskIdRef.current === taskId) {
          setDetailError({ taskId, message: err.message });
        }
      }
    } finally {
      if (detailRequestSequenceRef.current === requestSequence) {
        detailAbortControllerRef.current = null;
        detailInFlightRef.current = null;
        setLoadingDetail(false);
        if (detailFollowupRef.current && selectedTaskIdRef.current === taskId) {
          detailFollowupRef.current = false;
          void fetchActiveTaskDetail(taskId);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (selectedTaskId) {
      fetchActiveTaskDetail(selectedTaskId);
    } else {
      detailAbortControllerRef.current?.abort();
      detailInFlightRef.current = null;
      ++detailRequestSequenceRef.current;
      setActiveTaskDetail(null);
    }
  }, [selectedTaskId, fetchActiveTaskDetail]);

  useEffect(() => () => detailAbortControllerRef.current?.abort(), []);

  // Fetch Tasks
  const fetchTasks = async (isBackground = false) => {
    const requestSequence = ++listRequestSequenceRef.current;
    if (!isBackground) setLoading(true);
    try {
      const res = await fetch('/api/v1/tasks');
      const data = await res.json();
      if (requestSequence === listRequestSequenceRef.current && data.success && Array.isArray(data.tasks)) {
        const visibleTasks = data.tasks.filter((task: TaskSummary) => {
          const suppressedAt = suppressedTaskIdsRef.current.get(task.id);
          if (!suppressedAt) return true;
          const updatedAt = task.updatedAt ? Date.parse(task.updatedAt) : 0;
          if (updatedAt > suppressedAt) {
            suppressedTaskIdsRef.current.delete(task.id);
            return true;
          }
          return false;
        });
        setTasks(visibleTasks);
        setSelectedTaskId(prevId => {
          if (visibleTasks.length === 0) return '';
          // If previous selection still exists in the task list, retain it!
          if (prevId && visibleTasks.some((t: TaskSummary) => t.id === prevId)) {
            return prevId;
          }
          // Otherwise default to first task
          return visibleTasks[0].id;
        });
      }
    } catch (err) {
      console.warn('[Tasks] Fetch error:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const { isConnected } = useTaskWebSocket({
    onTaskUpdated: (updatedSummary) => {
      if (updatedSummary.updatedAt) {
        latestSummaryUpdatedAtRef.current[updatedSummary.id] = updatedSummary.updatedAt;
      }
      setTasks(prev => {
        const isAwaiting = isTaskAwaitingUserAction(updatedSummary.status);
        const suppressedAt = suppressedTaskIdsRef.current.get(updatedSummary.id);
        const updatedAt = updatedSummary.updatedAt ? Date.parse(updatedSummary.updatedAt) : 0;
        if (isAwaiting && suppressedAt && updatedAt <= suppressedAt) return prev;
        if (isAwaiting && suppressedAt) suppressedTaskIdsRef.current.delete(updatedSummary.id);
        const exists = prev.some(t => t.id === updatedSummary.id);
        if (isAwaiting) {
          if (exists) {
            return prev.map(t => t.id === updatedSummary.id ? updatedSummary : t);
          } else {
            return [updatedSummary, ...prev];
          }
        } else {
          return prev.filter(t => t.id !== updatedSummary.id);
        }
      });

      if (selectedTaskIdRef.current === updatedSummary.id) {
        // Log-only events carry the same persisted review token: no detail fetch.
        if (updatedSummary.reviewVersion && updatedSummary.reviewVersion === activeTaskDetailRef.current?.reviewVersion) return;
        fetchActiveTaskDetail(updatedSummary.id);
      }
    },
    onTaskCreated: (newSummary) => {
      if (isTaskAwaitingUserAction(newSummary.status) && !suppressedTaskIdsRef.current.has(newSummary.id)) {
        setTasks(prev => prev.some(task => task.id === newSummary.id)
          ? prev.map(task => task.id === newSummary.id ? newSummary : task)
          : [newSummary, ...prev]);
      }
    },
    onReconnect: () => {
      fetchTasks(true);
    }
  });

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
  }, []);

  // Light fallback polling ONLY if WebSocket is disconnected
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => fetchTasks(true), 25000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const activeTask = activeTaskDetail?.id === selectedTaskId ? activeTaskDetail : null;
  const review = useReviewSession(activeTask, createReviewDraft);
  const reviewContext = { taskId: review.taskId, version: review.version };
  const editQuote = review.draft?.editQuote ?? '';
  const setEditQuote = review.setter('editQuote');
  const selectedAudiences = review.draft?.selectedAudiences ?? [];
  const setSelectedAudiences = review.setter('selectedAudiences');
  const selectedAvoidColor = review.draft?.selectedAvoidColor ?? '';
  const setSelectedAvoidColor = review.setter('selectedAvoidColor');
  const editBackgroundColor = review.draft?.editBackgroundColor ?? '#1A1A1A';
  const setEditBackgroundColor = review.setter('editBackgroundColor');
  const editBackgroundColorReason = review.draft?.editBackgroundColorReason ?? '';
  const selectedBgMode = review.draft?.selectedBgMode ?? '';
  const setSelectedBgMode = review.setter('selectedBgMode');
  const selectedMaxColors = review.draft?.selectedMaxColors ?? 2;
  const setSelectedMaxColors = review.setter('selectedMaxColors');
  const editablePrompt = review.draft?.editablePrompt ?? '';
  const setEditablePrompt = review.setter('editablePrompt');
  const editNiche1 = review.draft?.editNiche1 ?? '';
  const setEditNiche1 = review.setter('editNiche1');
  const editNiche2 = review.draft?.editNiche2 ?? '';
  const setEditNiche2 = review.setter('editNiche2');
  const editSubniche = review.draft?.editSubniche ?? '';
  const setEditSubniche = review.setter('editSubniche');
  const editKeywords = review.draft?.editKeywords ?? '';
  const setEditKeywords = review.setter('editKeywords');
  const editableListing = review.draft?.editableListing ?? {brand: '', title: '', bullet1: '', bullet2: '', description: ''};
  const setEditableListing = review.setter('editableListing');
  const liveTmResult = review.draft?.liveTmResult ?? null;
  const setLiveTmResult = review.setter('liveTmResult', false);
  const isCheckingTm = review.draft?.isCheckingTm ?? false;
  const setIsCheckingTm = review.setter('isCheckingTm', false);
  const editedSvgData = review.draft?.editedSvgData ?? '';
  const setEditedSvgData = review.setter('editedSvgData');
  const revectorizeMaxColors = review.draft?.revectorizeMaxColors ?? 2;
  const setRevectorizeMaxColors = review.setter('revectorizeMaxColors');
  const isSubmitting = isCheckingTm || Boolean(selectedTaskId && submittingTaskIds.has(selectedTaskId));

  useEffect(() => {
    if (selectedTaskId && !tasks.some(task => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0]?.id || '');
      setActiveTaskDetail(null);
    }
  }, [tasks, selectedTaskId]);

  const matchesCurrentFilter = useCallback((task: TaskSummary) => {
    if (filter === 'PRE_FLIGHT') return task.status === 'AWAITING_PRE_FLIGHT_REVIEW';
    if (filter === 'DESIGN') return task.status === 'AWAITING_DESIGN_REVIEW' || task.status === 'UPDATE_ANALYZED';
    if (filter === 'TRADEMARK') return task.status === 'AWAITING_TM_REVIEW';
    if (filter === 'SVG') return task.status === 'AWAITING_SVG_REVIEW';
    return true;
  }, [filter]);

  const beginTaskAction = useCallback((taskId: string) => {
    suppressedTaskIdsRef.current.set(taskId, Date.now());
    setSubmittingTaskIds(prev => new Set(prev).add(taskId));
    detailAbortControllerRef.current?.abort();
    detailInFlightRef.current = null;
    detailFollowupRef.current = false;
    ++detailRequestSequenceRef.current;
    setTasks(prev => {
      const remaining = prev.filter(task => task.id !== taskId);
      const next = remaining.find(matchesCurrentFilter) || remaining[0];
      setSelectedTaskId(next?.id || '');
      return remaining;
    });
    setActiveTaskDetail(null);
  }, [matchesCurrentFilter]);

  const finishTaskAction = useCallback((taskId: string, success: boolean) => {
    setSubmittingTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    if (!success) suppressedTaskIdsRef.current.delete(taskId);
    void fetchTasks(true);
  }, []);

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
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    const taskId = activeTask.id;
    beginTaskAction(taskId);
    let success = false;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/override-preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewContext, action, newQuote: editQuote })
      });
      const data = await res.json();
      if (data.success) {
        success = true;
        showNotification('success', data.message);
      } else {
        showNotification('error', data.error || 'Aktion fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      finishTaskAction(taskId, success);
    }
  };

  const handleSkipUpdate = async () => {
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    const taskId = activeTask.id;
    beginTaskAction(taskId);
    let success = false;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/skip-update`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        success = true;
        showNotification('success', data.message);
      } else {
        showNotification('error', data.error || 'Skip Update konnte nicht gesetzt werden');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      finishTaskAction(taskId, success);
    }
  };

  // Actions for Checkpoint 2: Design Review
  const handleDesignReview = async (action: 'APPROVE' | 'REGENERATE_IMAGE' | 'DISCARD' | 'REJECT') => {
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    const taskId = activeTask.id;
    beginTaskAction(taskId);
    let success = false;
    try {
      const answers = {
        niche1: editNiche1,
        niche2: editNiche2,
        subniche: editSubniche,
        keywords: editKeywords,
        audience: selectedAudiences.join(', '),
        avoidColor: selectedAvoidColor,
        customBackgroundColor: editBackgroundColor,
        preferredBackgroundColor: editBackgroundColor,
        preferredBackgroundColorReason: editBackgroundColorReason,
        reuseBackground: selectedBgMode,
        maxColors: selectedMaxColors
      };

      const endpoint = action === 'DISCARD'
        ? `/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`
        : `/api/v1/tasks/${encodeURIComponent(taskId)}/submit-design-review`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'DISCARD' ? { reason: 'Im Design-Review manuell abgebrochen.' } : {
          reviewContext,
          action,
          answers,
          updatedPrompt: editablePrompt
        })
      });
      const data = await res.json();
      if (data.success) {
        success = true;
        showNotification('success', data.message);
      } else {
        showNotification('error', data.error || 'Übermittlung fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      finishTaskAction(taskId, success);
    }
  };

  // Actions for Checkpoint 3: Trademark Review
  const handleTmRecheck = async () => {
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    setIsCheckingTm(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(activeTask.id)}/submit-tm-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewContext,
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
        if (selectedTaskIdRef.current === activeTask.id) void fetchActiveTaskDetail(activeTask.id);
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      setIsCheckingTm(false);
    }
  };

  const handleTmDecision = async (action: 'APPROVE' | 'REJECT') => {
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    const taskId = activeTask.id;
    beginTaskAction(taskId);
    let success = false;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/submit-tm-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewContext,
          action,
          refinedListing: editableListing
        })
      });
      const data = await res.json();
      if (data.success) {
        success = true;
        showNotification('success', data.message);
      } else {
        showNotification('error', data.error || 'Speichern fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      finishTaskAction(taskId, success);
    }
  };

  // Actions for Checkpoint 4: SVG Vector & Background Review
  const handleSvgDecision = async (action: 'APPROVE' | 'REGENERATE_VECTOR' | 'REJECT', maxColorsOverride?: number) => {
    if (!activeTask || !review.ready || isCheckingTm || detailError?.taskId === activeTask.id) return;
    const taskId = activeTask.id;
    beginTaskAction(taskId);
    let success = false;
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/submit-svg-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewContext,
          action,
          editedSvgContent: editedSvgData || activeTask.svgContent,
          maxColors: maxColorsOverride || revectorizeMaxColors || activeTask.customAnswers?.maxColors || 2
        })
      });
      const data = await res.json();
      if (data.success) {
        success = true;
        showNotification('success', data.message);
      } else {
        showNotification('error', data.error || 'Aktion fehlgeschlagen');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Verbindungsfehler');
    } finally {
      finishTaskAction(taskId, success);
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
            onClick={() => { void fetchTasks(); if (selectedTaskId) void fetchActiveTaskDetail(selectedTaskId); }}
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
                const displayQuote = t.quote || (t as any).payload?.quote || (t as any).payload?.quote_or_phrase || (t as any).payload?.text || t.id;

                return (
                  <div
                    key={t.id}
                    data-review-select={t.id}
                    onClick={() => { if (!review.dirty || t.id === selectedTaskId || window.confirm('Ungespeicherte Eingaben verwerfen und Task wechseln?')) setSelectedTaskId(t.id); }}
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
                          loading="lazy"
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
          {detailError?.taskId === selectedTaskId ? (
            <div className="lg:col-span-8 glass-panel p-8">
              <p>{detailError.message}</p>
              <button onClick={() => void fetchActiveTaskDetail(selectedTaskId)} className="mt-4 text-primary-400">Erneut laden</button>
            </div>
          ) : review.conflict ? (
            <div className="lg:col-span-8 glass-panel p-8">
              <p>Dieser Review wurde zwischenzeitlich geändert. Deine Eingaben wurden nicht übertragen.</p>
              <button onClick={review.reload} className="mt-4 text-primary-400">Aktuellen Review laden und alte Eingaben verwerfen</button>
            </div>
          ) : loadingDetail || (activeTask && !review.ready) ? (
            <div className="lg:col-span-8 glass-panel p-12 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-3 min-h-[400px]">
              <RefreshCw className="w-7 h-7 text-primary-400 animate-spin" />
              <p className="text-xs font-semibold text-slate-300">Lade Review-Details...</p>
            </div>
          ) : activeTask ? (
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
                  <div className="flex items-center gap-2">
                    {activeTask.source === 'UPDATE' && ['UPDATE_ANALYZED', 'AWAITING_DESIGN_REVIEW', 'AWAITING_TM_REVIEW'].includes(activeTask.status) && (
                      <button
                        type="button"
                        onClick={handleSkipUpdate}
                        disabled={isSubmitting}
                        title="Setzt skip_update=true in Supabase und schließt nur diesen Update-Task."
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-rose-300 border border-rose-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Skip Update</span>
                      </button>
                    )}
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

                          {/* 5. Bevorzugte Hintergrundfarbe */}
                          <BackgroundColorSection
                            label="Bevorzugte Hintergrundfarbe"
                            stepNumber="5."
                            color={editBackgroundColor}
                            onChange={setEditBackgroundColor}
                            aiRecommendation={activeTask.analysisResult?.background_color_recommendation}
                            reason={editBackgroundColorReason || activeTask.analysisResult?.background_color_recommendation?.reason}
                            accentColor="teal"
                          />

                          {/* 6. Nischen-Hierarchie & SEO-Keywords */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-teal-500/30 space-y-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-800 text-xs">
                              <span className="font-semibold text-teal-300 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5 text-teal-400" />
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

                          {/* 6. Bevorzugte Hintergrundfarbe */}
                          <BackgroundColorSection
                            label="Bevorzugte Hintergrundfarbe"
                            stepNumber="6."
                            color={editBackgroundColor}
                            onChange={setEditBackgroundColor}
                            aiRecommendation={activeTask.analysisResult?.background_color_recommendation}
                            reason={editBackgroundColorReason || activeTask.analysisResult?.background_color_recommendation?.reason}
                            accentColor="cyan"
                          />

                          {/* 7. Nischen-Hierarchie & SEO-Keywords */}
                          <div className="bg-slate-900/90 p-3.5 rounded-xl border border-cyan-500/30 space-y-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-800 text-xs">
                              <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5 text-cyan-400" />
                                7. Nischen-Hierarchie &amp; SEO-Keywords
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
                      key={`${activeTask.id}:${review.version}`}
                      reviewContext={reviewContext}
                      onMutationSettled={() => {
                        if (selectedTaskIdRef.current === activeTask.id) void fetchActiveTaskDetail(activeTask.id);
                      }}
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
          ) : null}
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

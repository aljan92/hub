import React from 'react';
import { 
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  FileText,
  Globe,
  Palette,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
  Sliders
} from 'lucide-react';
import { DesignTaskLog, TaskSummary, EventCategory } from '../../types/tasks';

export interface TaskStatusInfo {
  label: string;
  badgeClass: string;
  dotBg: string;
  category: EventCategory;
  icon: React.ReactNode;
  isAnimated: boolean;
}

export const getTaskStatusInfo = (task: DesignTaskLog | TaskSummary): TaskStatusInfo => {
  const isUpdate = task.source === 'UPDATE' || task.suffix === 'U' || task.id.endsWith('-U');

  // 1. Error state
  if (task.hasError || task.status === 'ERROR') {
    const raw = (task.errorDetails || '').replace(/^OpenRouter HTTP \d+:\s*/, '');
    const cleanErr = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
    return {
      label: cleanErr ? `Fehler: ${cleanErr}` : 'Fehler aufgetreten',
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30 font-semibold',
      dotBg: 'bg-rose-500',
      category: 'ERROR',
      icon: <AlertCircle className="w-3 h-3 text-rose-400" />,
      isAnimated: false
    };
  }

  // 1.5 Amazon Rejection Detected (Special priority for update tasks)
  if (task.payload?.hasRejection && task.status !== 'COMPLETED' && task.status !== 'UPDATE_QUEUED') {
    return {
      label: '⚠️ Amazon Rejection',
      badgeClass: 'bg-rose-500/20 text-rose-200 border-rose-500/50 font-bold shadow-sm animate-pulse',
      dotBg: 'bg-rose-500',
      category: 'ERROR',
      icon: <AlertTriangle className="w-3 h-3 text-rose-400" />,
      isAnimated: true
    };
  }

  // 2. Rejected state
  if (task.status === 'REJECTED') {
    return {
      label: 'Abgelehnt / Verworfen',
      badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      dotBg: 'bg-rose-500',
      category: 'ERROR',
      icon: <XCircle className="w-3 h-3 text-rose-400" />,
      isAnimated: false
    };
  }

  // 3. Completed / Queued state
  if (task.status === 'COMPLETED' || task.status === 'UPDATE_QUEUED') {
    return {
      label: isUpdate ? 'In Queue (Update) ✓' : 'In Queue übergeben ✓',
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-semibold',
      dotBg: 'bg-emerald-400',
      category: 'SYSTEM',
      icon: <Check className="w-3 h-3 text-emerald-400" />,
      isAnimated: false
    };
  }

  // 4. Human-in-the-Loop Checkpoints (Awaiting User Action)
  if (task.status === 'AWAITING_PRE_FLIGHT_REVIEW' || task.checkpoint === 'PRE_FLIGHT') {
    return {
      label: 'Wartet: Quote TM',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold shadow-sm',
      dotBg: 'bg-amber-400',
      category: 'TRADEMARK',
      icon: <AlertTriangle className="w-3 h-3 text-amber-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'AWAITING_DESIGN_REVIEW' || task.checkpoint === 'DESIGN_REVIEW' || task.status === 'UPDATE_ANALYZED') {
    return {
      label: isUpdate ? 'Wartet: Update-Review' : 'Wartet: Design-Review',
      badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold shadow-sm',
      dotBg: 'bg-cyan-400',
      category: 'OPENROUTER',
      icon: <Sliders className="w-3 h-3 text-cyan-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'AWAITING_TM_REVIEW' || task.checkpoint === 'TM_REVIEW') {
    return {
      label: 'Wartet: TM-Review',
      badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-semibold shadow-sm',
      dotBg: 'bg-purple-400',
      category: 'TRADEMARK',
      icon: <ShieldAlert className="w-3 h-3 text-purple-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'AWAITING_SVG_REVIEW' || task.checkpoint === 'SVG_REVIEW') {
    return {
      label: 'Wartet: SVG-Prüfung',
      badgeClass: 'bg-pink-500/20 text-pink-300 border-pink-500/40 font-semibold shadow-sm',
      dotBg: 'bg-pink-400',
      category: 'VECTORIZE',
      icon: <Palette className="w-3 h-3 text-pink-400" />,
      isAnimated: false
    };
  }

  // 5. Active Pipeline Processing Steps
  if (task.status === 'UPDATE_DOWNLOADING_ARTWORK') {
    return {
      label: 'Artwork Download...',
      badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30 animate-pulse',
      dotBg: 'bg-teal-400',
      category: 'SYSTEM',
      icon: <RefreshCw className="w-3 h-3 text-teal-400 animate-spin" />,
      isAnimated: true
    };
  }

  if (task.status === 'UPDATE_ARTWORK_READY') {
    return {
      label: 'Artwork geladen',
      badgeClass: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
      dotBg: 'bg-teal-400',
      category: 'SYSTEM',
      icon: <CheckCircle2 className="w-3 h-3 text-teal-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'GENERATING_IMAGE') {
    return {
      label: 'Ideogram Bild...',
      badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30 animate-pulse',
      dotBg: 'bg-purple-400',
      category: 'IDEOGRAM',
      icon: <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'ANALYZING_DESIGN') {
    return {
      label: isUpdate ? 'Vision & Audit...' : 'Vision-Analyse...',
      badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 animate-pulse',
      dotBg: 'bg-cyan-400',
      category: 'OPENROUTER',
      icon: <Eye className="w-3 h-3 text-cyan-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'GENERATING_LISTING' || task.status === 'UPDATE_REWRITING') {
    return {
      label: isUpdate ? 'Listing Rewrite...' : 'Listing-Erstellung...',
      badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: <FileText className="w-3 h-3 text-sky-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'UPDATE_REWRITTEN') {
    return {
      label: 'Listing optimiert',
      badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: <CheckCircle2 className="w-3 h-3 text-sky-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'CHECKING_TRADEMARKS') {
    return {
      label: 'Trademark-Prüfung...',
      badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse',
      dotBg: 'bg-amber-400',
      category: 'TRADEMARK',
      icon: <ShieldCheck className="w-3 h-3 text-amber-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'UPDATE_TM_CHECKED') {
    return {
      label: 'TM geprüft',
      badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
      dotBg: 'bg-amber-400',
      category: 'TRADEMARK',
      icon: <CheckCircle2 className="w-3 h-3 text-amber-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'TRANSLATING_LISTING') {
    return {
      label: 'Übersetzung (DE/FR/ES)...',
      badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: <Globe className="w-3 h-3 text-sky-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'UPDATE_TRANSLATED') {
    return {
      label: 'Übersetzungen bereit',
      badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: <CheckCircle2 className="w-3 h-3 text-sky-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'VECTORIZING_DESIGN') {
    return {
      label: 'Vektorisierung...',
      badgeClass: 'bg-pink-500/15 text-pink-300 border-pink-500/30 animate-pulse',
      dotBg: 'bg-pink-400',
      category: 'VECTORIZE',
      icon: <Palette className="w-3 h-3 text-pink-400 animate-pulse" />,
      isAnimated: true
    };
  }

  if (task.status === 'PROCESSING') {
    return {
      label: isUpdate ? 'Artwork Download...' : 'OpenRouter Prompt...',
      badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: isUpdate ? <RefreshCw className="w-3 h-3 text-teal-400 animate-spin" /> : <Bot className="w-3 h-3 text-sky-400" />,
      isAnimated: true
    };
  }

  if (task.status === 'UPDATE_EXTRACTED') {
    return {
      label: 'Rohdaten erfasst',
      badgeClass: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
      dotBg: 'bg-teal-400',
      category: 'SYSTEM',
      icon: <Database className="w-3 h-3 text-teal-400" />,
      isAnimated: false
    };
  }

  if (task.status === 'PROMPT_READY') {
    return {
      label: 'Prompt bereit',
      badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
      dotBg: 'bg-sky-400',
      category: 'OPENROUTER',
      icon: <CheckCircle2 className="w-3 h-3 text-sky-400" />,
      isAnimated: false
    };
  }

  // Fallback / Initial State
  return {
    label: isUpdate ? 'Update initiiert' : 'Task empfangen',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    dotBg: 'bg-slate-400',
    category: 'SYSTEM',
    icon: <Clock className="w-3 h-3 text-slate-400" />,
    isAnimated: false
  };
};

export interface TaskStatusBadgeProps {
  task: DesignTaskLog;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

export const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({
  task,
  size = 'sm',
  showIcon = true,
  className = ''
}) => {
  const info = getTaskStatusInfo(task);

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm'
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-mono tracking-tight transition-all ${sizeClasses} ${info.badgeClass} ${className}`}
      title={task.errorDetails ? `Fehler: ${task.errorDetails}` : `Task Status: ${task.status}${task.checkpoint ? ` (Checkpoint: ${task.checkpoint})` : ''}`}
    >
      {showIcon && info.icon}
      <span>{info.label}</span>
    </span>
  );
};

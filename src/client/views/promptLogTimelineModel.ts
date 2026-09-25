import type { DesignTaskLog, RetryStepType, SessionEvent } from '../../types/tasks';

export interface TimelineGroup {
  key: string;
  step: string | null;
  label: string;
  events: Array<{ event: SessionEvent; index: number }>;
  retry?: { type: RetryStepType; index: number };
  outcome: 'running' | 'done' | 'attention' | 'error';
}

const labels: Record<string, string> = {
  D1: 'Vorabprüfung Marke', D2: 'Design-Prompt', D3: 'Bild erstellen', D4: 'Design analysieren',
  D5: 'Listing erstellen', D6: 'Markenprüfung Listing', D7: 'Druckdateien vorbereiten', D8: 'Finalisierung',
  U1: 'Design-Daten laden', U2: 'Artwork laden', U3: 'Artwork analysieren', U4: 'Listing überarbeiten',
  U5: 'Markenprüfung', U6: 'Übersetzung', U7: 'Finalisierung'
};

function stepOf(event: SessionEvent, task: DesignTaskLog, index: number): string | null {
  const explicit = event.title?.match(/\b([DU][1-8])\b/i)?.[1]?.toUpperCase();
  if (explicit) return explicit;
  const type = String(event.type);
  if (task.source === 'UPDATE') {
    if (type.startsWith('FINALIZATION_')) return 'U7';
    if (type.startsWith('TRANSLATION_')) return 'U6';
    if (type.startsWith('TM_')) return 'U5';
    if (type.startsWith('LISTING_')) return 'U4';
    if (type.startsWith('ANALYSIS_')) return 'U3';
    // U1/U2 do not have a stable distinct event type in older update logs.
    return null;
  }
  if (type.startsWith('FINALIZATION_')) return 'D8';
  if (type.startsWith('TM_')) return event.content?.isPreFlight || (type === 'TM_CHECK_REQUEST' && index <= 3) ? 'D1' : 'D6';
  if (type.startsWith('LLM_')) return 'D2';
  if (type.startsWith('IDEOGRAM_')) return 'D3';
  if (type.startsWith('ANALYSIS_')) return 'D4';
  if (type.startsWith('LISTING_')) return 'D5';
  if (/^(VECTORIZE|SVG|RESIZE)_/.test(type)) return 'D7';
  return null;
}

function retryOf(event: SessionEvent, index: number, step: string | null): TimelineGroup['retry'] {
  const type = String(event.type);
  const mapped: Record<string, RetryStepType> = {
    LLM_REQUEST: 'LLM_REQUEST', IDEOGRAM_REQUEST: 'IDEOGRAM_REQUEST', ANALYSIS_REQUEST: 'ANALYSIS_REQUEST',
    LISTING_REQUEST: 'LISTING_REQUEST', TM_CHECK_REQUEST: step === 'D1' ? 'PREFLIGHT_TM_REQUEST' : 'TM_CHECK_REQUEST',
    TM_REFINE_REQUEST: 'TM_REFINE_REQUEST', VECTORIZE_REQUEST: 'VECTORIZE_REQUEST',
    SVG_AUDIT_REQUEST: 'SVG_AUDIT_REQUEST', SVG_EDIT_REQUEST: 'SVG_REVIEW',
    TRANSLATION_REQUEST: 'TRANSLATION_REQUEST', RESIZE_REQUEST: 'RESIZE_REQUEST'
  };
  return mapped[type] ? { type: mapped[type], index } : undefined;
}

function outcomeOf(events: TimelineGroup['events']): TimelineGroup['outcome'] {
  if (events.some(({ event }) => event.type === 'ERROR' || /_FAILED$/.test(event.type))) return 'error';
  if (events.some(({ event }) => event.type === 'TASK_HANDOFF' || /REVIEW|ESCALATED/.test(event.title || ''))) return 'attention';
  if (events.some(({ event }) => /_RESPONSE$|_COMPLETED$/.test(event.type) || String(event.type) === 'FINALIZATION_EVENT')) return 'done';
  return 'running';
}

export function buildTimelineGroups(task: DesignTaskLog): { visible: TimelineGroup[]; history: TimelineGroup[] } {
  const groups: TimelineGroup[] = [];
  (task.events || []).forEach((event, index) => {
    const type = String(event.type);
    let step = stepOf(event, task, index);
    if (task.source !== 'UPDATE' && type.startsWith('TM_') && /_RESPONSE$/.test(type) && !event.title?.match(/\bD[16]\b/i)) {
      const preceding = groups[groups.length - 1];
      if (preceding?.step === 'D1' || preceding?.step === 'D6') step = preceding.step;
    }
    const previous = groups[groups.length - 1];
    if (type === 'TASK_HANDOFF' && previous && (previous.step === 'D8' || previous.step === 'U7') && /QUEUE|IN_QUEUE|ENQUEUE/i.test(JSON.stringify(event.content || {}))) step = previous.step;
    const key = step || (type === 'INCOMING_PAYLOAD' || type === 'SESSION_START' ? 'START' : type === 'TASK_HANDOFF' ? 'HANDOFF' : type.startsWith('RECOVERY_') ? 'RECOVERY' : type === 'ERROR' ? 'ERROR' : `${type}:${index}`);
    const startsNewAttempt = /_REQUEST$/.test(type) && previous?.key === key && previous.events.some(item => /_RESPONSE$/.test(item.event.type) && item.event.type.replace('_RESPONSE', '') === type.replace('_REQUEST', ''));
    if (previous?.key === key && !startsNewAttempt) {
      previous.events.push({ event, index });
      previous.retry ||= retryOf(event, index, step);
      previous.outcome = outcomeOf(previous.events);
    } else {
      groups.push({ key, step, label: labels[step || ''] || (key === 'START' ? 'Task gestartet' : key === 'HANDOFF' ? 'Übergabe' : key === 'RECOVERY' ? 'Wiederherstellung' : key === 'ERROR' ? 'Fehler' : event.title || type), events: [{ event, index }], retry: retryOf(event, index, step), outcome: outcomeOf([{ event, index }]) });
    }
  });
  const latest = new Map<string, number>();
  groups.forEach((group, index) => { if (group.step) latest.set(group.step, index); });
  return {
    visible: groups.filter((group, index) => !group.step || latest.get(group.step) === index),
    history: groups.filter((group, index) => group.step && latest.get(group.step) !== index)
  };
}

import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, RefreshCw, RotateCcw, UploadCloud } from 'lucide-react';
import type { DesignTaskLog, RetryStepType, SessionEvent } from '../../types/tasks';
import { canRepeatFinalization } from '../../types/finalizationRetry';
import { buildTimelineGroups, type TimelineGroup } from './promptLogTimelineModel';

interface Props {
  task: DesignTaskLog;
  retryingStep: string | null;
  onRetry: (taskId: string, step: RetryStepType, index: number) => void;
  onRepeatFinalization: (taskId: string) => void;
  finalizingTaskId: string | null;
  finalizationMessage: { taskId: string; text: string; success: boolean } | null;
  onPushToQueue: (taskId: string) => void;
  pushingToQueueTaskId: string | null;
  pushSuccessTaskId: string | null;
}

const accents: Record<string, string> = {
  D1: 'border-amber-500/50 text-amber-300', D2: 'border-sky-500/50 text-sky-300',
  D3: 'border-violet-500/50 text-violet-300', D4: 'border-cyan-500/50 text-cyan-300',
  D5: 'border-emerald-500/50 text-emerald-300', D6: 'border-orange-500/50 text-orange-300',
  D7: 'border-fuchsia-500/50 text-fuchsia-300', D8: 'border-teal-500/50 text-teal-300',
  U1: 'border-amber-500/50 text-amber-300', U2: 'border-violet-500/50 text-violet-300',
  U3: 'border-cyan-500/50 text-cyan-300', U4: 'border-emerald-500/50 text-emerald-300',
  U5: 'border-orange-500/50 text-orange-300', U6: 'border-sky-500/50 text-sky-300',
  U7: 'border-teal-500/50 text-teal-300'
};

const status: Record<TimelineGroup['outcome'], { label: string; style: string }> = {
  running: { label: 'In Arbeit', style: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  done: { label: 'Ergebnis vorhanden', style: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  attention: { label: 'Prüfung nötig', style: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  error: { label: 'Fehler', style: 'bg-rose-500/10 text-rose-300 border-rose-500/30' }
};

const safeText = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';

function chooseListing(group: TimelineGroup): any | null {
  const response = [...group.events].reverse().find(({ event }) => event.type === 'LISTING_RESPONSE');
  return response?.event.content && typeof response.event.content === 'object' ? response.event.content : null;
}

function Listing({ data }: { data: any }) {
  const languages = ['en', 'de', 'fr', 'it', 'es', 'ja'].filter(lang => data?.[lang] && typeof data[lang] === 'object');
  const [language, setLanguage] = useState(languages[0] || 'en');
  const listing = languages.length ? data[language] : data;
  if (!listing || typeof listing !== 'object') return null;
  const fields = [
    ['Brand', listing.brand || listing.brandName], ['Titel', listing.title],
    ['Bullet 1', listing.bullet1 || listing.bullet_1], ['Bullet 2', listing.bullet2 || listing.bullet_2],
    ['Description', listing.description]
  ];
  return <div className="space-y-2">
    {languages.length > 1 && <div className="flex flex-wrap gap-1" aria-label="Listing-Sprache">
      {languages.map(lang => <button key={lang} type="button" onClick={() => setLanguage(lang)} className={`rounded border px-2 py-1 text-xs font-semibold ${language === lang ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-slate-700 text-slate-400'}`}>{lang.toUpperCase()}</button>)}
    </div>}
    <div className="grid gap-2">{fields.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-200">{safeText(value) || '—'}</p>
    </div>)}</div>
  </div>;
}

function RawEvent({ task: taskId, index, version }: { task: string; index: number; version: string }) {
  const [raw, setRaw] = useState<SessionEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    if (raw || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/prompt-log/events/${index}?version=${encodeURIComponent(version)}`);
      if (res.status === 409) throw new Error('Task geändert. Bitte Ansicht aktualisieren.');
      if (!res.ok) throw new Error('Rohdaten konnten nicht geladen werden.');
      setRaw((await res.json()).event);
    } catch (err: any) { setError(err.message || 'Fehler beim Laden'); }
    finally { setLoading(false); }
  };
  return <details className="mt-2 rounded border border-slate-800 px-2 py-1" onToggle={e => { if (e.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer text-cyan-300">Vollständige Ereignisdaten laden</summary>
    {loading && <p>Lade…</p>}{error && <p role="alert" className="text-amber-300">{error}</p>}
    {raw && <><button type="button" className="mt-2 inline-flex items-center gap-1 text-cyan-300" onClick={() => navigator.clipboard.writeText(JSON.stringify(raw.content, null, 2))}><Copy className="h-3 w-3" />Kopieren</button>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-[11px] text-slate-300">{JSON.stringify(raw.content, null, 2)}</pre></>}
  </details>;
}

function summaryOf(group: TimelineGroup): string {
  const last = group.events[group.events.length - 1].event;
  if (group.outcome === 'running') return `${group.label} läuft oder wartet auf ein Ergebnis.`;
  if (group.outcome === 'error') return safeText(last.content?.message || last.content?.error || last.content) || last.title;
  if ((group.step === 'D1' || group.step === 'D6' || group.step === 'U5') && !last.content?.finalDecision && !last.content?.auditV2?.finalDecision) {
    return 'Prüfergebnis vorhanden; Entscheidung und Scan-Integrität in den Details prüfen.';
  }
  const summary = safeText(last.content?.message || last.content?.reason || last.content?.explanation) || last.title;
  return summary.length > 280 ? `${summary.slice(0, 277)}…` : summary;
}

function factsOf(group: TimelineGroup): Array<[string, string]> {
  const response = [...group.events].reverse().find(({ event }) => /_RESPONSE$/.test(String(event.type)))?.event;
  const content = response?.content || {};
  const facts: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => { const text = safeText(value); if (text) facts.push([label, text]); };
  if (group.step === 'D2') add('Modell', response?.metadata?.model || group.events[0].event.metadata?.model);
  if (group.step === 'D3') add('Bildanbieter', response?.metadata?.provider || content.provider);
  if (group.step === 'D4') add('QA-Urteil', content.overall_verdict);
  if (group.step === 'U3') add('Rewrite', content.listing_audit?.rewrite_recommended === true ? 'Empfohlen' : content.listing_audit?.rewrite_recommended === false ? 'Nicht nötig' : undefined);
  if (group.step === 'D6' || group.step === 'U5' || group.step === 'D1') {
    add('Entscheidung', content.finalDecision || content.auditV2?.finalDecision);
    add('Treffer', content.totalHits);
    if (Array.isArray(content.blockedProducts)) add('Gesperrte Produkte', content.blockedProducts.length);
  }
  if (group.step === 'D7') add('SVG-Urteil', content.verdict);
  if (response?.metadata?.latencyMs != null) add('Dauer', `${(response.metadata.latencyMs / 1000).toFixed(1)} s`);
  return facts.slice(0, 4);
}

function Card({ group, props, historical = false }: { group: TimelineGroup; props: Props; historical?: boolean }) {
  const { task } = props;
  const listing = chooseListing(group);
  const last = group.events[group.events.length - 1].event;
  const image = [...group.events].reverse().map(({ event }) => event.content?.imageUrl || event.content?.svgUrl || event.content?.fourPanelImageUrl).find(Boolean);
  const tmResult = [...group.events].reverse().find(({ event }) => event.type === 'TM_CHECK_RESPONSE' || String(event.type).startsWith('TM_VERIFIER_') || String(event.type).startsWith('TM_SCAN_'))?.event.content;
  const facts = factsOf(group);
  const isFinalization = group.step === 'D8' || group.step === 'U7';
  const isQueueHandoff = group.events.some(({ event }) => event.type === 'TASK_HANDOFF' && /QUEUE|IN_QUEUE|ENQUEUE/i.test(JSON.stringify(event.content || {})));
  const retry = group.retry;
  return <article className={`rounded-xl border bg-slate-950/75 p-4 shadow-sm ${historical ? 'border-slate-800' : accents[group.step || '']?.split(' ')[0] || 'border-slate-700'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {group.step && <span className={`rounded border bg-slate-900 px-2 py-0.5 text-xs font-bold ${accents[group.step] || 'border-slate-600 text-slate-300'}`}>{group.step}</span>}
        <h4 className="text-sm font-semibold text-slate-100">{group.label}</h4>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${status[group.outcome].style}`}>{status[group.outcome].label}</span>
      </div>
      <span className="text-[11px] text-slate-500">{new Date(last.timestamp).toLocaleTimeString('de-DE')}</span>
    </div>
    <p className="mt-2 break-words text-xs leading-relaxed text-slate-300">{summaryOf(group)}</p>
    {facts.length > 0 && <dl className="mt-3 flex flex-wrap gap-2">{facts.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5"><dt className="text-[10px] text-slate-500">{label}</dt><dd className="text-xs font-medium text-slate-200">{value}</dd></div>)}</dl>}
    {tmResult && <p className="mt-2 text-xs text-amber-200">{tmResult.scanIntegrity || tmResult.integrity ? `Scan: ${safeText(tmResult.scanIntegrity || tmResult.integrity) || 'Details ansehen'}` : 'Prüfstatus nur anhand der Details beurteilbar'}</p>}
    {listing && <div className="mt-3"><Listing data={listing} /></div>}
    {image && !listing && <a href={image} target="_blank" rel="noreferrer" className="mt-3 inline-block"><img src={image} alt={`${group.label} Vorschau`} loading="lazy" className="max-h-52 max-w-full rounded-lg border border-slate-700 object-contain" /></a>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {retry && !historical && <button type="button" onClick={() => props.onRetry(task.id, retry.type, retry.index)} disabled={props.retryingStep === `${task.id}-${retry.type}-${retry.index}`} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-cyan-300 disabled:opacity-50"><RotateCcw className="h-3 w-3" />Neu ausführen</button>}
      {isFinalization && !historical && <button type="button" onClick={() => props.onRepeatFinalization(task.id)} disabled={Boolean(props.finalizingTaskId) || !canRepeatFinalization(task)} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-cyan-300 disabled:opacity-40"><RefreshCw className="h-3 w-3" />Finalisierung erneut ausführen</button>}
      {isQueueHandoff && !historical && (task.status === 'COMPLETED' || task.mbaPngUrl || task.localMbaPngPath) && <button type="button" onClick={() => props.onPushToQueue(task.id)} disabled={props.pushingToQueueTaskId === task.id} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-cyan-300 disabled:opacity-50"><UploadCloud className="h-3 w-3" />{props.pushSuccessTaskId === task.id ? 'In Queue übertragen' : 'Erneut in Queue pushen'}</button>}
      {task.svgUrl && group.step === 'D7' && <a href={task.svgUrl} download className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"><Download className="h-3 w-3" />SVG</a>}
      {task.mbaPngUrl && group.step === 'D7' && <a href={task.mbaPngUrl} download className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"><Download className="h-3 w-3" />Print-PNG</a>}
    </div>
    {isFinalization && props.finalizationMessage?.taskId === task.id && <p role="status" className={`mt-2 text-xs ${props.finalizationMessage.success ? 'text-emerald-300' : 'text-amber-300'}`}>{props.finalizationMessage.text}</p>}
    <details className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-400">
      <summary className="cursor-pointer text-slate-300">Meldungen und technische Details ({group.events.length})</summary>
      <div className="mt-2 space-y-2">{group.events.map(({ event, index }) => <div key={index} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-200">{event.title || event.type}</span><span className="font-mono text-[10px] text-slate-500">{event.type}</span></div>
        {event.metadata?.model && <p>Modell: {event.metadata.model}</p>}
        {event.metadata?.latencyMs != null && <p>Dauer: {event.metadata.latencyMs} ms</p>}
        {event.metadata?.costUsd != null && <p>Kosten: ${event.metadata.costUsd}</p>}
        {/(_REQUEST|_RESPONSE)$/.test(event.type) && task.updatedAt ? <RawEvent task={task.id} index={index} version={task.updatedAt} /> : <details className="mt-1"><summary className="cursor-pointer text-cyan-300">Gespeicherte Daten</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(event.content, null, 2)}</pre></details>}
      </div>)}</div>
    </details>
  </article>;
}

export default function PromptLogTimeline(props: Props) {
  const { visible, history } = useMemo(() => buildTimelineGroups(props.task), [props.task]);
  return <div className="space-y-3" aria-label="Task-Verlauf">
    {visible.map(group => <Card key={`${group.key}-${group.events[0].index}`} group={group} props={props} />)}
    {history.length > 0 && <details className="rounded-xl border border-slate-800 p-3 text-xs text-slate-400"><summary className="cursor-pointer font-semibold text-slate-300">Frühere Versuche ({history.length})</summary><div className="mt-3 space-y-3">{history.map(group => <Card key={`${group.key}-${group.events[0].index}`} group={group} props={props} historical />)}</div></details>}
  </div>;
}

import assert from 'node:assert/strict';
import { buildTimelineGroups } from '../src/client/views/promptLogTimelineModel';
import type { DesignTaskLog, SessionEvent } from '../src/types/tasks';

const at = '2026-09-25T12:00:00.000Z';
const event = (type: SessionEvent['type'], title: string, content: unknown = {}): SessionEvent => ({ timestamp: at, type, title, content });
const task = (source: DesignTaskLog['source'], events: SessionEvent[]): DesignTaskLog => ({
  id: '1-D', counter: 1, source, suffix: source === 'UPDATE' ? 'U' : 'D', status: 'COMPLETED',
  receivedAt: at, updatedAt: at, payload: {}, events
});

const designer = buildTimelineGroups(task('DESIGNER', [
  event('TM_CHECK_REQUEST', 'Vorabprüfung', { isPreFlight: true }),
  event('TM_CHECK_RESPONSE', 'Prüfergebnis'),
  event('LLM_REQUEST', 'Prompt anfordern'), event('LLM_RESPONSE', 'Prompt erhalten'),
  event('LLM_REQUEST', 'Prompt erneut anfordern'), event('LLM_RESPONSE', 'Prompt erneut erhalten'),
  event('LISTING_REQUEST', 'Listing anfordern'), event('LISTING_RESPONSE', 'Listing erhalten', { en: { brand: 'B', title: 'T', bullet1: 'A', bullet2: 'B', description: 'Full description' } }),
  event('FINALIZATION_EVENT' as SessionEvent['type'], 'Druckdatei'),
  event('FINALIZATION_EVENT' as SessionEvent['type'], 'Queue'),
  event('TASK_HANDOFF', 'In Queue', { phase: 'QUEUE' })
]));
assert.equal(designer.visible.find(group => group.step === 'D1')?.events.length, 2);
assert.equal(designer.visible.find(group => group.step === 'D2')?.events.length, 2);
assert.equal(designer.history.find(group => group.step === 'D2')?.events.length, 2);
assert.equal(designer.visible.find(group => group.step === 'D5')?.events.length, 2);
assert.equal(designer.visible.find(group => group.step === 'D8')?.events.length, 3);
assert.equal(designer.visible.length + designer.history.length, 5);

const update = buildTimelineGroups(task('UPDATE', [
  event('ANALYSIS_REQUEST', 'Vision & Listing Analyse'), event('ANALYSIS_RESPONSE', 'Vision-Befund'),
  event('LISTING_REQUEST', 'Rewrite'), event('LISTING_RESPONSE', 'Listing', { en: { title: 'New' } }),
  event('TRANSLATION_SKIPPED', 'Keine Übersetzung')
]));
assert.deepEqual(update.visible.map(group => group.step), ['U3', 'U4', 'U6']);

import assert from 'node:assert/strict';
import { getPromptLogRawEvent, projectPromptLogTask } from '../src/server/services/promptLogProjection';
import type { DesignTaskLog } from '../src/types/tasks';

const task: DesignTaskLog = {
  id: '#123-D', counter: 123, source: 'DESIGNER', suffix: 'D', status: 'GENERATING_LISTING',
  receivedAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:01:00.000Z',
  payload: { title: 'Example', brand: 'Brand', hidden: 'x'.repeat(100_000) },
  svgContent: '<svg>' + 'a'.repeat(1_000_000) + '</svg>',
  events: [{ timestamp: '2026-09-25T10:01:00.000Z', type: 'LISTING_REQUEST', title: 'Listing',
    content: { niche1: 'Animals', prompt: 'small private prompt', rawRequest: { messages: ['secret'.repeat(100_000)] }, nested: { rawResponse: 'private' } } }]
};

const projected = projectPromptLogTask(task);
assert.equal(projected.id, task.id);
assert.equal(projected.payload.title, 'Example');
assert.equal(projected.events[0].content.niche1, 'Animals');
assert.ok(JSON.stringify(projected).length < 5_000);
assert.ok(!JSON.stringify(projected).includes('secret'));
assert.ok(!JSON.stringify(projected).includes('private'));
assert.ok(!JSON.stringify(projected).includes('small private prompt'));
assert.ok(!JSON.stringify(projected).includes('<svg>'));
assert.equal(getPromptLogRawEvent(task, 0, task.updatedAt!), task.events[0]);
assert.equal(getPromptLogRawEvent(task, 0, 'stale'), 'STALE');
assert.equal(getPromptLogRawEvent(task, 1, task.updatedAt!), null);
assert.equal(getPromptLogRawEvent(task, -1, task.updatedAt!), null);
assert.equal(task.svgContent?.length, 1_000_011);
console.log('Prompt Log M2 projection and version guard passed');

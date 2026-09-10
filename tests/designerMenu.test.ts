import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DesignerService } from '../src/server/services/designerService';
import { LLMService } from '../src/server/services/llmService';
import { TaskLogService } from '../src/server/services/taskLogService';

test('designer values preserve the exact D2 field contract and require niche1', () => {
  assert.deepEqual(DesignerService.normalizeValues({
    niche1: '  Gardening  ', niche2: ' Cats ', subniche: ' Vegetable   Gardening ',
    quote: ' Grow Through It ', style: ''
  }), {
    niche1: 'Gardening', niche2: 'Cats', subniche: 'Vegetable Gardening',
    quote: 'Grow Through It', style: ''
  });
  assert.throws(() => DesignerService.normalizeValues({ niche1: '   ' }), /Niche 1/);
});

test('suggestion requests are field-bound, current-value based and limited to five exclusions', () => {
  const request = DesignerService.normalizeSuggestionRequest({
    field: 'quote',
    values: { niche1: 'Gardening', niche2: 'Cats', subniche: 'Vegetables', quote: 'old', style: 'Retro' },
    avoid: ['1', '2', '3', '4', '5', '6']
  });
  assert.equal(request.field, 'quote');
  assert.equal(request.values.niche2, 'Cats');
  assert.deepEqual(request.avoid, ['2', '3', '4', '5', '6']);
  assert.throws(() => DesignerService.normalizeSuggestionRequest({ field: 'quote', values: {} }), /Niche 1/);
  assert.throws(() => DesignerService.normalizeSuggestionRequest({ field: 'unknown', values: {} }), /Unbekanntes/);
});

test('suggestion response accepts strict JSON and rejects duplicates or malformed output', () => {
  assert.equal(LLMService.parseDesignerSuggestion('{"suggestion":"Garden Gremlins"}'), 'Garden Gremlins');
  assert.throws(() => LLMService.parseDesignerSuggestion('{"suggestion":"Garden Gremlins"}', ['garden-gremlins']), /wiederholt/);
  assert.throws(() => LLMService.parseDesignerSuggestion('plain text'), /Antwortformat/);
  assert.equal(LLMService.parseDesignerSuggestion('{"suggestion":"Retro Space Exploration"}', [], 'niche1'), 'Retro Space Exploration');
  assert.throws(() => LLMService.parseDesignerSuggestion('{"suggestion":"Retro space exploration and astronomy"}', [], 'niche1'), /höchstens drei/);
  assert.throws(() => LLMService.parseDesignerSuggestion('{"suggestion":"Cats and Coffee"}', [], 'niche2'), /ohne Verknüpfung/);
  assert.throws(() => LLMService.parseDesignerSuggestion('{"suggestion":"Vintage science fiction pulp magazine art"}', [], 'niche2'), /höchstens drei/);
  const messages = LLMService.buildDesignerSuggestionMessages({ field: 'niche2', niche1: 'Gardening', avoid: ['Cats'] });
  assert.match(messages.system, /deliberately unrelated/);
  assert.match(messages.system, /one to three words/);
  assert.match(messages.user, /Gardening/);
  assert.match(messages.user, /Cats/);
});

test('unavailable selected suggestion model falls back to the configured base model', async () => {
  const original = (LLMService as any).executeFetch;
  const requestedModels: string[] = [];
  (LLMService as any).executeFetch = async (_url: string, options: any) => {
    const model = JSON.parse(options.body).model;
    requestedModels.push(model);
    if (requestedModels.length === 1) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: { message: 'model unavailable' } }) };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"suggestion":"Fallback idea"}' } }] }) };
  };
  try {
    const result = await LLMService.generateDesignerSuggestion({ field: 'niche1', model: 'vendor/unavailable' });
    assert.equal(requestedModels[0], 'vendor/unavailable');
    assert.equal(requestedModels.length, 2);
    assert.equal(result.suggestion, 'Fallback idea');
    assert.equal(result.model, requestedModels[1]);
  } finally {
    (LLMService as any).executeFetch = original;
  }
});

test('invalid long niche is retried and never reaches the form', async () => {
  const original = (LLMService as any).executeFetch;
  let requests = 0;
  (LLMService as any).executeFetch = async () => {
    requests++;
    const content = requests === 1
      ? '{"suggestion":"Retro space exploration and astronomy"}'
      : '{"suggestion":"Astronomy"}';
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  try {
    const result = await LLMService.generateDesignerSuggestion({ field: 'niche1' });
    assert.equal(result.suggestion, 'Astronomy');
    assert.equal(requests, 2);
  } finally {
    (LLMService as any).executeFetch = original;
  }
});

test('designer task creation is idempotent and sends no precomputed prompt around D2', () => {
  const original = TaskLogService.createTaskLog;
  const calls: any[] = [];
  (TaskLogService as any).createTaskLog = (params: any) => {
    calls.push(params);
    return { id: '#999-D', source: params.source, payload: params.payload };
  };
  try {
    const body = {
      requestId: 'designer_request_123', niche1: 'Gardening', niche2: 'Cats', subniche: 'Vegetables',
      quote: 'Grow Through It', style: 'Retro engraving', imageProvider: 'GPT_IMAGE_2', promptPoolEnabled: true,
      prompt: 'must not bypass D2'
    };
    const first = DesignerService.createTask(body, 'local');
    const second = DesignerService.createTask(body, 'local');
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, 'DESIGNER');
    assert.deepEqual(calls[0].payload, {
      niche1: 'Gardening', niche2: 'Cats', subniche: 'Vegetables', quote: 'Grow Through It', style: 'Retro engraving',
      imageProvider: 'GPT_IMAGE_2', promptPoolEnabled: true
    });
    assert.equal('prompt' in calls[0].payload, false);
  } finally {
    (TaskLogService as any).createTaskLog = original;
  }
});

test('designer UI contains reset/history/model controls and no legacy prompt preview call', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/client/views/DesignerView.tsx'), 'utf8');
  assert.match(source, /designerSuggestionModel/);
  assert.match(source, /\/api\/v1\/llm\/models\?refresh=true/);
  assert.match(source, /mba_designer_suggestion_history_v1/);
  assert.match(source, /niche1: current\.niche1, niche2: '', subniche: '', quote: '', style: ''/);
  assert.match(source, /\/api\/v1\/designer\/suggest/);
  assert.match(source, /model: suggestionModel/);
  assert.doesNotMatch(source, /\/api\/v1\/designer\/prompt/);
  assert.doesNotMatch(source, /generatedPrompt/);
});

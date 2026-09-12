import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DesignerConceptService, type DesignerConcept } from '../src/server/services/designerConceptService';
import { DesignerService } from '../src/server/services/designerService';
import { LLMService } from '../src/server/services/llmService';
import { TaskLogService } from '../src/server/services/taskLogService';

test('extractConceptCount extracts explicit numbers and German words, defaults appropriately and clamps', () => {
  // Explicit digit
  assert.equal(DesignerConceptService.extractConceptCount('5 Designs für Handwerker'), 5);
  assert.equal(DesignerConceptService.extractConceptCount('10 t-shirts für Elektriker'), 10);
  assert.equal(DesignerConceptService.extractConceptCount('12 motive'), 10); // clamped to 10

  // German number words
  assert.equal(DesignerConceptService.extractConceptCount('Ich hätte gerne zwei Designs aus der Pferde-Nische'), 2);
  assert.equal(DesignerConceptService.extractConceptCount('drei konzepte für dachdecker'), 3);
  assert.equal(DesignerConceptService.extractConceptCount('vier ideen'), 4);
  assert.equal(DesignerConceptService.extractConceptCount('ein design für angler'), 1);

  // Vague plurals
  assert.equal(DesignerConceptService.extractConceptCount('designs für gärtner'), 3);
  assert.equal(DesignerConceptService.extractConceptCount('ein paar konzepte'), 3);
  assert.equal(DesignerConceptService.extractConceptCount('mehrere ideen'), 3);

  // Singular
  assert.equal(DesignerConceptService.extractConceptCount('design für hunde'), 1);

  // Empty / Random
  assert.equal(DesignerConceptService.extractConceptCount('', undefined, true), 1);
  assert.equal(DesignerConceptService.extractConceptCount('', undefined, false), 3);

  // Explicit count override
  assert.equal(DesignerConceptService.extractConceptCount('zwei designs', 4), 4);
  assert.equal(DesignerConceptService.extractConceptCount('zwei designs', 25), 10);
});

test('concept history records, rotates at 100 items, and formats avoidance list', () => {
  const historyFile = path.resolve(process.cwd(), 'data/designer_concept_history.json');
  const backup = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf-8') : null;

  try {
    DesignerConceptService.clearHistory();
    assert.deepEqual(DesignerConceptService.loadHistory(), []);

    const sampleConcepts: DesignerConcept[] = [
      { niche1: 'Gardening', subniche: 'Herbs', quote: 'Herb Your Enthusiasm' },
      { niche1: 'Carpentry', quote: 'Measure Twice Cut Once' }
    ];

    DesignerConceptService.recordConcepts(sampleConcepts);
    const loaded = DesignerConceptService.loadHistory();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].niche1, 'Gardening');
    assert.equal(loaded[0].subniche, 'Herbs');
    assert.equal(loaded[0].quote, 'Herb Your Enthusiasm');

    const avoid = DesignerConceptService.getAvoidanceList();
    assert.equal(avoid.length, 2);
    assert.match(avoid[0], /Gardening \(Herbs\): "Herb Your Enthusiasm"/);
    assert.match(avoid[1], /Carpentry: "Measure Twice Cut Once"/);

    // Test rotation at 100
    const many: DesignerConcept[] = Array.from({ length: 110 }, (_, i) => ({
      niche1: `Niche ${i}`,
      quote: `Quote ${i}`
    }));
    DesignerConceptService.recordConcepts(many);
    const rotated = DesignerConceptService.loadHistory();
    assert.equal(rotated.length, 100);
    assert.equal(rotated[rotated.length - 1].quote, 'Quote 109');
  } finally {
    if (backup !== null) {
      fs.writeFileSync(historyFile, backup, 'utf-8');
    } else {
      DesignerConceptService.clearHistory();
    }
  }
});

test('LLMService.generateDesignerConcepts validates required fields and respects optional fields', async () => {
  const originalFetch = (LLMService as any).executeFetch;
  let capturedBody: any = null;

  (LLMService as any).executeFetch = async (_url: string, init: any) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                concepts: [
                  {
                    niche1: 'Horse Riding',
                    subniche: 'Friesian Horse',
                    niche2: '',
                    quote: 'Born to Ride Horses',
                    style: 'Vintage retro engraving'
                  },
                  {
                    niche1: 'Electrician',
                    niche2: 'Coffee',
                    quote: 'Powered by Voltage and Espresso'
                  }
                ]
              })
            }
          }
        ]
      })
    };
  };

  try {
    const concepts = await LLMService.generateDesignerConcepts({
      userPrompt: 'Zwei Designs für Pferde und Elektriker',
      count: 2,
      model: 'openai/gpt-5.6-sol',
      avoidanceList: ['Gardening: "Grow Through It"']
    });

    assert.equal(concepts.length, 2);
    assert.equal(concepts[0].niche1, 'Horse Riding');
    assert.equal(concepts[0].subniche, 'Friesian Horse');
    assert.equal(concepts[0].niche2, undefined);
    assert.equal(concepts[0].quote, 'Born to Ride Horses');
    assert.equal(concepts[0].style, 'Vintage retro engraving');

    assert.equal(concepts[1].niche1, 'Electrician');
    assert.equal(concepts[1].niche2, 'Coffee');
    assert.equal(concepts[1].subniche, undefined);
    assert.equal(concepts[1].quote, 'Powered by Voltage and Espresso');
    assert.equal(concepts[1].style, undefined);

    // Verify system prompt contains the explicit required categories
    assert.match(capturedBody.messages[0].content, /evergreen/);
    assert.match(capturedBody.messages[0].content, /Berufe/);
    assert.match(capturedBody.messages[0].content, /Haustiere mit beliebten Rassen/);
    assert.match(capturedBody.messages[0].content, /Hobbys & Sport/);
    assert.match(capturedBody.messages[0].content, /Familie\/Lifestyle/);

    // Verify avoidance list is included in system prompt
    assert.match(capturedBody.messages[0].content, /Gardening: "Grow Through It"/);
  } finally {
    (LLMService as any).executeFetch = originalFetch;
  }
});

test('DesignerService.batchCreateTasks creates multiple tasks with proper D-suffix and sequential IDs', () => {
  const concepts = [
    { niche1: 'Gardening', quote: 'Plant Lady' },
    { niche1: 'Dogs', subniche: 'Golden Retriever', quote: 'Golden State of Mind' }
  ];

  const results = DesignerService.batchCreateTasks({
    concepts,
    imageProvider: 'IDEOGRAM_V4',
    promptPoolEnabled: false
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].duplicate, false);
  assert.equal(results[1].duplicate, false);
  assert.match(results[0].task.id, /^#\d+-D$/);
  assert.match(results[1].task.id, /^#\d+-D$/);
  assert.equal(results[0].task.payload.niche1, 'Gardening');
  assert.equal(results[1].task.payload.subniche, 'Golden Retriever');
  assert.equal(results[0].task.imageGeneration.provider, 'IDEOGRAM_V4');
});

test('DesignerConceptService.generateConcepts delegates to LLMService and persists history', async () => {
  const originalFetch = (LLMService as any).executeFetch;
  (LLMService as any).executeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              concepts: [
                { niche1: 'Camping', quote: 'Camp More Worry Less' }
              ]
            })
          }
        }
      ]
    })
  });

  try {
    const res = await DesignerConceptService.generateConcepts({ random: true, count: 1 });
    assert.equal(res.count, 1);
    assert.equal(res.concepts[0].niche1, 'Camping');
    assert.equal(res.concepts[0].quote, 'Camp More Worry Less');

    const history = DesignerConceptService.loadHistory();
    const found = history.find(h => h.quote === 'Camp More Worry Less');
    assert.ok(found, 'Generated concept was recorded in persistent history');
  } finally {
    (LLMService as any).executeFetch = originalFetch;
  }
});

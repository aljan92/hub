import assert from 'node:assert/strict';
import { PromptPoolService } from '../src/server/services/promptPoolService';

const validation = PromptPoolService.validatePool();
assert.deepEqual(validation, { valid: true, count: 30 });
assert.equal(new Set(PromptPoolService.getEntries().map(entry => entry.id)).size, 30);

const deterministicRandom = () => 0.25;
const references = PromptPoolService.selectReferences({
  niche1: 'Hiking',
  niche2: 'Coffee',
  quote: 'Trail Brew',
  style: 'outdoors adventure',
  audience: 'masculine'
}, [], deterministicRandom);

assert.equal(references.length, 3);
assert.deepEqual(references.map(reference => reference.role), ['MATCH', 'ADJACENT', 'WILDCARD']);
assert.equal(new Set(references.map(reference => reference.id)).size, 3);

const textOnly = PromptPoolService.selectReferences({ style: 'text only', quote: 'No Thanks' }, [], deterministicRandom);
const textOnlyMatch = PromptPoolService.getEntries().find(entry => entry.id === textOnly[0]?.id);
assert.ok(textOnlyMatch?.tags.some(tag => /text|typography/.test(tag)), 'Text-only mode should prefer a typography reference');

const firstMatch = references[0].id;
const diversified = PromptPoolService.selectReferences({
  niche1: 'Hiking', style: 'outdoors adventure', audience: 'masculine'
}, [firstMatch], deterministicRandom);
assert.notEqual(diversified[0].id, firstMatch, 'A recently used match should be deprioritized');

assert.equal(PromptPoolService.buildReferenceSection([]), '', 'Standard mode must add no pool text');
const section = PromptPoolService.buildReferenceSection(references);
assert.match(section, /CREATIVE REFERENCES/);
assert.match(section, /Ignore every background instruction/);
assert.match(section, /\[MATCH\]/);

console.log('PASS prompt pool: validation, matching, diversity, roles and standard-mode isolation');

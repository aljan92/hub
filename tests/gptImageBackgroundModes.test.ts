import assert from 'node:assert/strict';
import { getEffectiveGptImageSettings } from '../src/server/services/settingsService';
import { OpenRouterImageService } from '../src/server/services/openRouterImageService';

console.log('[gptImageBackgroundModes.test.ts] 🧪 Starte Tests für GPT Image Hintergrundmodi...');

// Test 1: getEffectiveGptImageSettings for 2.5 with deep_blue
console.log('--- Test 1: getEffectiveGptImageSettings für 2.5 mit deep_blue ---');
const settings25DeepBlue = getEffectiveGptImageSettings({
  gptImageModel: 'openai/gpt-image-2.5-sunburst',
  gptImage25Background: 'deep_blue'
});
assert.equal(settings25DeepBlue.model, 'openai/gpt-image-2.5-sunburst');
assert.equal(settings25DeepBlue.background, 'deep_blue');
console.log('✅ Test 1 bestanden.');

// Test 2: getEffectiveGptImageSettings for 2.5 with transparent
console.log('--- Test 2: getEffectiveGptImageSettings für 2.5 mit transparent ---');
const settings25Transparent = getEffectiveGptImageSettings({
  gptImageModel: 'openai/gpt-image-2.5-sunburst',
  gptImage25Background: 'transparent'
});
assert.equal(settings25Transparent.background, 'transparent');
console.log('✅ Test 2 bestanden.');

// Test 3: OpenRouter buildRequestBody for 2.5 with deep_blue sends opaque transport
console.log('--- Test 3: OpenRouter buildRequestBody für 2.5 mit deep_blue ---');
const body25DeepBlue = OpenRouterImageService.buildRequestBody({
  model: OpenRouterImageService.MODEL_V25,
  prompt: 'A whimsical t-shirt design...',
  quality: 'high',
  aspectRatio: '3:4',
  background: 'deep_blue'
});
assert.equal(body25DeepBlue.model, 'openai/gpt-image-2.5-sunburst');
assert.equal(body25DeepBlue.background, 'opaque', 'deep_blue muss als opaque an OpenRouter transportiert werden');
console.log('✅ Test 3 bestanden.');

// Test 4: OpenRouter buildRequestBody for 2.5 with transparent sends transparent transport
console.log('--- Test 4: OpenRouter buildRequestBody für 2.5 mit transparent ---');
const body25Transparent = OpenRouterImageService.buildRequestBody({
  model: OpenRouterImageService.MODEL_V25,
  prompt: 'A whimsical t-shirt design...',
  quality: 'high',
  aspectRatio: '3:4',
  background: 'transparent'
});
assert.equal(body25Transparent.background, 'transparent', 'transparent muss als transparent an OpenRouter gesendet werden bei 2.5');
console.log('✅ Test 4 bestanden.');

// Test 5: OpenRouter buildRequestBody for 2.0 with deep_blue sends opaque transport
console.log('--- Test 5: OpenRouter buildRequestBody für 2.0 mit deep_blue ---');
const body2DeepBlue = OpenRouterImageService.buildRequestBody({
  model: OpenRouterImageService.MODEL_V2,
  prompt: 'A whimsical t-shirt design...',
  quality: 'high',
  aspectRatio: '3:4',
  background: 'deep_blue'
});
assert.equal(body2DeepBlue.background, 'opaque', 'deep_blue bei 2.0 muss als opaque an OpenRouter transportiert werden');
console.log('✅ Test 5 bestanden.');

// Test 6: OpenRouter buildRequestBody for 2.0 with transparent also maps to opaque (OpenRouter limitation)
console.log('--- Test 6: OpenRouter buildRequestBody für 2.0 mit transparent ---');
const body2Transparent = OpenRouterImageService.buildRequestBody({
  model: OpenRouterImageService.MODEL_V2,
  prompt: 'A whimsical t-shirt design...',
  quality: 'high',
  aspectRatio: '3:4',
  background: 'transparent'
});
assert.equal(body2Transparent.background, 'opaque', 'transparent bei 2.0 muss zu opaque gemappt werden');
console.log('✅ Test 6 bestanden.');

console.log('\n🎉 Alle GPT Image Hintergrundmodi Tests erfolgreich bestanden!');

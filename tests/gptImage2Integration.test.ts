import assert from 'node:assert/strict';
import { OpenRouterImageService } from '../src/server/services/openRouterImageService';

const transparent = OpenRouterImageService.buildRequestBody({
  prompt: 'print-ready test design',
  quality: 'high',
  aspectRatio: '3:4',
  background: 'transparent'
});

assert.deepEqual(transparent, {
  model: 'openai/gpt-image-2',
  prompt: 'print-ready test design',
  quality: 'high',
  aspect_ratio: '3:4',
  background: 'transparent',
  n: 1,
  stream: false,
  output_format: 'png'
});

const opaque = OpenRouterImageService.buildRequestBody({
  prompt: 'opaque test design',
  quality: 'medium',
  aspectRatio: '1:1',
  background: 'opaque'
});
assert.equal(opaque.output_format, undefined, 'Opaque requests should use the provider output default');

console.log('PASS GPT Image 2 request contract');

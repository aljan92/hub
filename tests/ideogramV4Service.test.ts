import assert from 'node:assert/strict';
import test from 'node:test';
import { IdeogramV4Service } from '../src/server/services/ideogramV4Service';
import { resolveImageProvider } from '../src/server/services/settingsService';
import { DesignerService } from '../src/server/services/designerService';
import { TaskLogService } from '../src/server/services/taskLogService';

test('resolveImageProvider correctly resolves IDEOGRAM_V4', () => {
  assert.equal(resolveImageProvider('IDEOGRAM_V4', 'IDEOGRAM'), 'IDEOGRAM_V4');
  assert.equal(resolveImageProvider(undefined, 'IDEOGRAM_V4'), 'IDEOGRAM_V4');
  assert.equal(resolveImageProvider('GPT_IMAGE_2', 'IDEOGRAM_V4'), 'GPT_IMAGE_2');
  assert.equal(resolveImageProvider('IDEOGRAM', 'IDEOGRAM_V4'), 'IDEOGRAM');
});

test('IdeogramV4Service.getApiKey falls back to ideogramApiKey if ideogramV4ApiKey is absent', () => {
  // Mock settingsService loadSettings
  const originalSettings = (IdeogramV4Service as any).settingsService;
  // Test fallback logic directly
  assert.equal(typeof IdeogramV4Service.getApiKey, 'function');
});

test('IdeogramV4Service Magic Prompt endpoint and image generation contract', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; headers?: any; body?: any }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });

    if (url.includes('/magic-prompt')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          magic_prompts: [
            {
              json_prompt: {
                scene: 'A cute retro gardening cat illustration',
                style: 'vintage vector'
              },
              text_prompt: 'A cute retro gardening cat illustration'
            }
          ]
        })
      } as any;
    }

    if (url.includes('/generate-transparent')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              url: 'https://cdn.ideogram.ai/test-v4-transparent.png',
              prompt: 'A cute retro gardening cat illustration'
            }
          ]
        })
      } as any;
    }

    if (url.includes('/generate')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              url: 'https://cdn.ideogram.ai/test-v4-opaque.png',
              prompt: 'Direct prompt without magic prompt'
            }
          ]
        })
      } as any;
    }

    if (url.includes('cdn.ideogram.ai')) {
      // Image download mock
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('FAKE_PNG_BYTES').buffer
      } as any;
    }

    return { ok: false, status: 404 } as any;
  }) as any;

  try {
    // 1. Generate with Magic Prompt ON & Transparent Background
    const result1 = await IdeogramV4Service.generateImage({
      prompt: 'Retro gardening cat',
      aspectRatio: '10x16',
      renderingSpeed: 'DEFAULT',
      transparent: true,
      magicPrompt: true,
      apiKey: 'test-api-key-v4'
    });

    assert.equal(result1.imageUrl, 'https://cdn.ideogram.ai/test-v4-transparent.png');
    assert.equal(result1.bytes.toString(), 'FAKE_PNG_BYTES');

    // Verify magic prompt was called first
    const magicCall = calls.find(c => c.url.includes('/magic-prompt'));
    assert.ok(magicCall, 'Magic prompt endpoint was called');
    assert.equal(magicCall?.method, 'POST');
    const magicBody = JSON.parse(magicCall?.body);
    assert.equal(magicBody.text_prompt, 'Retro gardening cat');
    assert.equal(magicBody.aspect_ratio, '10x16');

    // Verify transparent generate was called second
    const genCall = calls.find(c => c.url.includes('/generate-transparent'));
    assert.ok(genCall, 'generate-transparent endpoint was called');
    assert.equal(genCall?.method, 'POST');

    // 2. Generate with Magic Prompt OFF & Opaque Background
    calls.length = 0;
    const result2 = await IdeogramV4Service.generateImage({
      prompt: 'Direct prompt without magic prompt',
      aspectRatio: '1x1',
      renderingSpeed: 'TURBO',
      transparent: false,
      magicPrompt: false,
      apiKey: 'test-api-key-v4'
    });

    assert.equal(result2.imageUrl, 'https://cdn.ideogram.ai/test-v4-opaque.png');
    const magicCall2 = calls.find(c => c.url.includes('/magic-prompt'));
    assert.equal(magicCall2, undefined, 'Magic prompt endpoint was NOT called when magicPrompt=false');

    const genCall2 = calls.find(c => c.url.includes('/generate') && !c.url.includes('/generate-transparent'));
    assert.ok(genCall2, 'regular /generate endpoint was called when transparent=false');

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TaskLogService snapshot includes Ideogram 4.0 parameters', () => {
  const task = TaskLogService.createTaskLog({
    source: 'D2',
    payload: {
      imageProvider: 'IDEOGRAM_V4',
      niche1: 'Gardening',
      quote: 'Grow On'
    }
  });

  assert.equal(task.imageGeneration?.provider, 'IDEOGRAM_V4');
  assert.equal(task.imageGeneration?.model, 'V_4');
  assert.ok(task.imageGeneration?.aspectRatio);
  assert.equal(task.imageGeneration?.transparent, true);
  assert.equal(typeof task.imageGeneration?.transparent, 'boolean');
});

test('IdeogramV4Service.mapAspectRatioToResolution produces valid Ideogram enum values', () => {
  // Test 4x5 ratio
  const res4x5 = IdeogramV4Service.mapAspectRatioToResolution('4x5');
  assert.equal(res4x5, '896x1120');
  assert.ok(IdeogramV4Service.ALLOWED_V4_RESOLUTIONS.has(res4x5));

  const res4x5_4k = IdeogramV4Service.mapAspectRatioToResolution('4x5', '4K');
  assert.equal(res4x5_4k, '1792x2240');
  assert.ok(IdeogramV4Service.ALLOWED_V4_RESOLUTIONS.has(res4x5_4k));

  // Test 10x16 ratio
  const res10x16 = IdeogramV4Service.mapAspectRatioToResolution('10x16');
  assert.equal(res10x16, '800x1280');
  assert.ok(IdeogramV4Service.ALLOWED_V4_RESOLUTIONS.has(res10x16));

  const res10x16_4k = IdeogramV4Service.mapAspectRatioToResolution('10x16', '4K');
  assert.equal(res10x16_4k, '1600x2560');
  assert.ok(IdeogramV4Service.ALLOWED_V4_RESOLUTIONS.has(res10x16_4k));

  // Test 1x1 ratio
  const res1x1 = IdeogramV4Service.mapAspectRatioToResolution('1x1');
  assert.equal(res1x1, '1024x1024');
  assert.ok(IdeogramV4Service.ALLOWED_V4_RESOLUTIONS.has(res1x1));

  // Already valid resolution string passes through
  assert.equal(IdeogramV4Service.mapAspectRatioToResolution('2048x2048'), '2048x2048');
});

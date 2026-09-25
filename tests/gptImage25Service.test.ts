import { OpenRouterImageService } from '../src/server/services/openRouterImageService';
import { getEffectiveGptImageSettings, AppSettings } from '../src/server/services/settingsService';
import { LLMService } from '../src/server/services/llmService';

async function run() {
  let passed = 0;
  let total = 0;
  const assert = (condition: unknown, name: string, detail?: unknown) => {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ ${name}`);
    } else {
      console.error(`❌ ${name}`, detail ?? '');
    }
  };

  // 1. Test buildRequestBody for GPT Image 2.5 Sunburst
  const body25Transparent = OpenRouterImageService.buildRequestBody({
    model: OpenRouterImageService.MODEL_V25,
    prompt: 'A vintage cute cat graphic',
    quality: 'xhigh',
    aspectRatio: '3:4',
    background: 'transparent'
  });

  assert(body25Transparent.model === 'openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 model is openai/gpt-image-2.5-sunburst');
  assert(body25Transparent.background === 'transparent', 'GPT Image 2.5 preserves native transparent background');
  assert(body25Transparent.quality === 'xhigh', 'GPT Image 2.5 supports xhigh quality');
  assert(body25Transparent.aspect_ratio === '3:4', 'GPT Image 2.5 sets 3:4 aspect ratio');

  const body25Max = OpenRouterImageService.buildRequestBody({
    model: OpenRouterImageService.MODEL_V25,
    prompt: 'A majestic eagle',
    quality: 'max',
    aspectRatio: '1:1',
    background: 'opaque'
  });
  assert(body25Max.quality === 'max', 'GPT Image 2.5 supports max quality');
  assert(body25Max.background === 'opaque', 'GPT Image 2.5 sets opaque background');

  // 2. Test buildRequestBody for GPT Image 2.0
  const body20Transparent = OpenRouterImageService.buildRequestBody({
    model: OpenRouterImageService.MODEL_V2,
    prompt: 'A vintage cute cat graphic',
    quality: 'high',
    aspectRatio: '3:4',
    background: 'transparent'
  });

  assert(body20Transparent.model === 'openai/gpt-image-2', 'GPT Image 2.0 model is openai/gpt-image-2');
  assert(body20Transparent.background === 'opaque', 'GPT Image 2.0 routes transparent via opaque transport for Chroma-Key');
  assert(body20Transparent.quality === 'high', 'GPT Image 2.0 sets high quality');

  // 3. Test getEffectiveGptImageSettings
  const mockSettings25: Partial<AppSettings> = {
    gptImageModel: 'openai/gpt-image-2.5-sunburst',
    gptImageQuality: 'high',
    gptImageAspectRatio: '3:4',
    gptImageBackground: 'transparent',
    gptImage25Quality: 'xhigh',
    gptImage25AspectRatio: '2:3',
    gptImage25Background: 'transparent'
  };
  const effective25 = getEffectiveGptImageSettings(mockSettings25);
  assert(effective25.model === 'openai/gpt-image-2.5-sunburst', 'getEffectiveGptImageSettings selects 2.5');
  assert(effective25.quality === 'xhigh', 'getEffectiveGptImageSettings uses 2.5 quality');
  assert(effective25.aspectRatio === '2:3', 'getEffectiveGptImageSettings uses 2.5 aspect ratio');
  assert(effective25.background === 'transparent', 'getEffectiveGptImageSettings uses 2.5 background');

  const mockSettings20: Partial<AppSettings> = {
    gptImageModel: 'openai/gpt-image-2',
    gptImageQuality: 'medium',
    gptImageAspectRatio: '1:1',
    gptImageBackground: 'opaque',
    gptImage25Quality: 'xhigh',
    gptImage25AspectRatio: '2:3',
    gptImage25Background: 'transparent'
  };
  const effective20 = getEffectiveGptImageSettings(mockSettings20);
  assert(effective20.model === 'openai/gpt-image-2.5-sunburst', 'new tasks ignore legacy 2.0 setting');
  assert(effective20.quality === 'xhigh', 'new tasks use 2.5 quality');
  assert(effective20.aspectRatio === '2:3', 'new tasks use 2.5 aspect ratio');
  assert(effective20.background === 'transparent', 'new tasks use 2.5 background');

  // 4. Test prompt generation directives
  let capturedPrompt = '';
  const originalFetch = (LLMService as any).executeFetch;
  (LLMService as any).executeFetch = async (_url: string, opts: any) => {
    const parsed = JSON.parse(opts.body);
    capturedPrompt = parsed.messages?.[0]?.content || '';
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'test prompt' } }] })
    };
  };

  try {
    // 4.1 GPT Image 2.5 with transparent -> Native transparent directive
    await LLMService.generateIdeogramPrompt(
      'Nurses', '', 'Best Nurse Ever', 'Vintage', 'GPT_IMAGE_2', 'transparent', 'openai/gpt-image-2.5-sunburst'
    );
    assert(capturedPrompt.includes('OpenAI GPT Image 2.5 Sunburst'), 'Prompt directive identifies GPT Image 2.5 Sunburst');
    assert(capturedPrompt.includes('genuinely transparent background'), 'Prompt directive for 2.5 requests genuinely transparent background');
    assert(!capturedPrompt.includes('chroma-key'), 'Prompt directive for 2.5 does NOT request chroma-key');

    // 4.2 GPT Image 2.0 with transparent -> Deep Blue Chroma-Key directive
    await LLMService.generateIdeogramPrompt(
      'Nurses', '', 'Best Nurse Ever', 'Vintage', 'GPT_IMAGE_2', 'transparent', 'openai/gpt-image-2'
    );
    assert(capturedPrompt.includes('OpenAI GPT Image 2'), 'Prompt directive identifies GPT Image 2');
    assert(capturedPrompt.includes('deep blue chroma-key background'), 'Prompt directive for 2.0 requests deep blue chroma-key');
    assert(capturedPrompt.includes('Do not request transparency'), 'Prompt directive for 2.0 forbids requesting transparency directly');
  } finally {
    (LLMService as any).executeFetch = originalFetch;
  }

  console.log(`\nGPT Image 2.5 Tests: ${passed}/${total} passed`);
  if (passed !== total) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

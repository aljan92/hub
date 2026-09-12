import assert from 'node:assert/strict';
import { 
  DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT, 
  DEFAULT_UPDATE_VISION_SYSTEM_PROMPT,
  SystemPromptService 
} from '../src/server/services/systemPromptService';
import { createReviewDraft } from '../src/client/utils/reviewDraft';
import { UpdatePipelineService } from '../src/server/services/updatePipelineService';
import { DesignTaskLog } from '../src/types/tasks';

console.log('====================================================');
console.log('🚀 RUNNING AUDIT NICHE & BACKGROUND COLOR TESTS (Alex Todo #10)');
console.log('====================================================');

// Test 1: DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT cross-niche independence & background color
console.log('Test 1: DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT contains independence & background guidelines...');
assert.ok(DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT.includes('STRICT INDEPENDENCE RESTRICTION'));
assert.ok(DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT.includes('FORBIDDEN CLOSE ATTRIBUTES, PROPS & SYNONYMS'));
assert.ok(DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT.includes('If niche1 is "Christmas", niche2 MUST NOT be "Santa Claus"'));
assert.ok(DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT.includes('NEUTRAL PRODUCT BACKGROUND COLOR RECOMMENDATION'));
assert.ok(DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT.includes('background_color_recommendation'));
console.log('✅ [PASS] Test 1: Design analyzer prompt validated.');

// Test 2: DEFAULT_UPDATE_VISION_SYSTEM_PROMPT cross-niche independence & background color
console.log('Test 2: DEFAULT_UPDATE_VISION_SYSTEM_PROMPT contains independence & background guidelines...');
assert.ok(DEFAULT_UPDATE_VISION_SYSTEM_PROMPT.includes('STRICT INDEPENDENCE RESTRICTION'));
assert.ok(DEFAULT_UPDATE_VISION_SYSTEM_PROMPT.includes('8. NEUTRAL PRODUCT BACKGROUND COLOR RECOMMENDATION'));
assert.ok(DEFAULT_UPDATE_VISION_SYSTEM_PROMPT.includes('background_color_recommendation'));
assert.ok(DEFAULT_UPDATE_VISION_SYSTEM_PROMPT.includes('"hex": "#1E293B"'));
console.log('✅ [PASS] Test 2: Update vision prompt validated.');

// Test 3: SystemPromptService returns updated prompts
console.log('Test 3: SystemPromptService returns prompts with background_color_recommendation...');
const designPrompt = SystemPromptService.getDesignAnalyzerPrompt();
const updatePrompt = SystemPromptService.getUpdateVisionPrompt();
assert.ok(designPrompt.includes('background_color_recommendation'));
assert.ok(updatePrompt.includes('background_color_recommendation'));
console.log('✅ [PASS] Test 3: SystemPromptService cache & getters validated.');

// Test 4: createReviewDraft initializes from AI recommendation
console.log('Test 4: createReviewDraft initializes editBackgroundColor from AI recommendation...');
const taskAiRec: DesignTaskLog = {
  id: '100-D',
  counter: 100,
  source: 'MANUAL',
  suffix: 'D',
  status: 'AWAITING_DESIGN_REVIEW',
  receivedAt: new Date().toISOString(),
  payload: {},
  events: [],
  hasError: false,
  eventsCount: 0,
  analysisResult: {
    avoid_product_colors: { avoid: 'None' },
    background_color_recommendation: {
      hex: '#1E293B',
      name: 'Dark Slate',
      reason: 'Perfekter Kontrast zu hellen Elementen.'
    }
  }
};
const draftAi = createReviewDraft(taskAiRec);
assert.equal(draftAi.editBackgroundColor, '#1E293B');
assert.equal(draftAi.editBackgroundColorReason, 'Perfekter Kontrast zu hellen Elementen.');
console.log('✅ [PASS] Test 4: AI background recommendation draft initialization passed.');

// Test 5: User override in customAnswers takes precedence
console.log('Test 5: User customAnswers takes precedence over AI recommendation...');
const taskUserOverride: DesignTaskLog = {
  id: '101-D',
  counter: 101,
  source: 'MANUAL',
  suffix: 'D',
  status: 'AWAITING_DESIGN_REVIEW',
  receivedAt: new Date().toISOString(),
  payload: {},
  events: [],
  hasError: false,
  eventsCount: 0,
  customAnswers: {
    customBackgroundColor: '#2B2B2B',
    preferredBackgroundColorReason: 'Manuell gewählt'
  },
  analysisResult: {
    background_color_recommendation: {
      hex: '#FFFFFF',
      reason: 'KI-Vorschlag'
    }
  }
};
const draftUser = createReviewDraft(taskUserOverride);
assert.equal(draftUser.editBackgroundColor, '#2B2B2B');
assert.equal(draftUser.editBackgroundColorReason, 'Manuell gewählt');
console.log('✅ [PASS] Test 5: User override takes precedence.');

// Test 6: Fallback contrast logic when avoidColor is White or Black
console.log('Test 6: Contrast-aware fallbacks when avoidColor is White/Black...');
const taskWhiteAvoid: DesignTaskLog = {
  id: '102-D',
  counter: 102,
  source: 'MANUAL',
  suffix: 'D',
  status: 'AWAITING_DESIGN_REVIEW',
  receivedAt: new Date().toISOString(),
  payload: {},
  events: [],
  hasError: false,
  eventsCount: 0,
  analysisResult: {
    avoid_product_colors: { avoid: 'White' }
  }
};
assert.equal(createReviewDraft(taskWhiteAvoid).editBackgroundColor, '#000000');

const taskBlackAvoid: DesignTaskLog = {
  id: '103-D',
  counter: 103,
  source: 'MANUAL',
  suffix: 'D',
  status: 'AWAITING_DESIGN_REVIEW',
  receivedAt: new Date().toISOString(),
  payload: {},
  events: [],
  hasError: false,
  eventsCount: 0,
  analysisResult: {
    avoid_product_colors: { avoid: 'Black' }
  }
};
assert.equal(createReviewDraft(taskBlackAvoid).editBackgroundColor, '#FFFFFF');
console.log('✅ [PASS] Test 6: Contrast-safe fallbacks verified.');

// Test 7: UpdatePipelineService.finalizationParams resolves customBackgroundColor
console.log('Test 7: UpdatePipelineService.finalizationParams resolution...');
const taskUpdate: DesignTaskLog = {
  id: '200-U',
  counter: 200,
  source: 'UPDATE',
  suffix: 'U',
  status: 'FINALIZING',
  receivedAt: new Date().toISOString(),
  payload: {
    designId: 'amzn.test.design.123',
    brand: 'Test Brand',
    title: 'Test Shirt',
    bullet1: 'Bullet 1',
    bullet2: 'Bullet 2'
  },
  events: [],
  hasError: false,
  eventsCount: 0,
  preferredBackgroundColor: '#1A2332',
  analysisResult: {
    background_color_recommendation: {
      hex: '#1A2332',
      name: 'Navy'
    }
  }
};
const params = UpdatePipelineService.finalizationParams(taskUpdate);
assert.equal(params.customBackgroundColor, '#1A2332');
assert.equal(params.designId, 'amzn.test.design.123');
console.log('✅ [PASS] Test 7: UpdatePipelineService.finalizationParams customBackgroundColor resolved.');

console.log('====================================================');
console.log('🎉 ALL 7 AUDIT & BACKGROUND COLOR TESTS PASSED!');
console.log('====================================================');

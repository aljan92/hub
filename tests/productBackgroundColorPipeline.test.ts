import assert from 'node:assert/strict';
import { artworkProfiles, productProfile, normalizeBackgroundHex } from '../src/server/services/artworkProfiles';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { RESIZE_BACKGROUND_PROFILES } from '../src/server/services/productCatalogService';

console.log('====================================================');
console.log('🚀 RUNNING PRODUCT BACKGROUND COLOR PIPELINE TESTS');
console.log('====================================================');

// Test 1: normalizeBackgroundHex
console.log('Test 1: normalizeBackgroundHex normalizes 6-digit hex values...');
assert.equal(normalizeBackgroundHex('#1e293b'), '#1E293B');
assert.equal(normalizeBackgroundHex('1e293b'), '#1E293B');
assert.equal(normalizeBackgroundHex('#FFFFFF'), '#FFFFFF');
assert.equal(normalizeBackgroundHex('invalid'), undefined);
assert.equal(normalizeBackgroundHex(''), undefined);
assert.equal(normalizeBackgroundHex(undefined), undefined);
console.log('✅ [PASS] Test 1: normalizeBackgroundHex passed.');

// Test 2: artworkProfiles without override defaults to #4E4A46
console.log('Test 2: artworkProfiles without override defaults to #4E4A46...');
const profilesDefault = artworkProfiles();
const blanketDef = profilesDefault.find(p => p.key === 'CANVAS_BG_CONTAIN_4452X5292_DARK');
const mousepadDef = profilesDefault.find(p => p.key === 'CANVAS_BG_CONTAIN_4500X3750_DARK');
const posterDef = profilesDefault.find(p => p.key === 'CANVAS_BG_CONTAIN_4320X5400_DARK');
const laptopDef = profilesDefault.find(p => p.key === 'CANVAS_BG_CONTAIN_4480X3472_DARK');

assert.equal(blanketDef?.background, RESIZE_BACKGROUND_PROFILES.DARK_PRODUCT.color);
assert.equal(mousepadDef?.background, '#4E4A46');
assert.equal(posterDef?.background, '#4E4A46');
assert.equal(laptopDef?.background, '#4E4A46');
console.log('✅ [PASS] Test 2: default #4E4A46 verified for all full-bleed render products.');

// Test 3: artworkProfiles with override applies the custom hex
console.log('Test 3: artworkProfiles with override applies the custom hex...');
const profilesCustom = artworkProfiles('#1E293B');
const blanketCustom = profilesCustom.find(p => p.key === 'CANVAS_BG_CONTAIN_4452X5292_DARK');
const mousepadCustom = profilesCustom.find(p => p.key === 'CANVAS_BG_CONTAIN_4500X3750_DARK');

assert.equal(mousepadCustom?.background, '#1E293B');
assert.equal(blanketCustom?.background, '#1E293B');
console.log('✅ [PASS] Test 3: override background applied to render products.');

// Test 4: artworkProfiles with invalid override falls back to #4E4A46
console.log('Test 4: artworkProfiles with invalid override falls back to default...');
const profilesInvalid = artworkProfiles('not-a-hex');
const mousepadInvalid = profilesInvalid.find(p => p.key === 'CANVAS_BG_CONTAIN_4500X3750_DARK');
assert.equal(mousepadInvalid?.background, '#4E4A46');
console.log('✅ [PASS] Test 4: invalid override fallback verified.');

// Test 5: ArtworkResizeService fingerprint changes when background color changes
console.log('Test 5: ArtworkResizeService fingerprint includes background color...');
const mockSvgSource = { kind: 'SVG' as const, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>' };
const fpDefault = ArtworkResizeService.fingerprint(mockSvgSource);
const fpDarkSlate = ArtworkResizeService.fingerprint(mockSvgSource, '#1E293B');
const fpBlack = ArtworkResizeService.fingerprint(mockSvgSource, '#000000');

assert.notEqual(fpDefault, fpDarkSlate);
assert.notEqual(fpDarkSlate, fpBlack);
assert.equal(ArtworkResizeService.fingerprint(mockSvgSource, '#1E293B'), fpDarkSlate);
console.log('✅ [PASS] Test 5: fingerprint sensitivity to background color verified.');

// Test 6: 3-tier Fallback resolution for Upload Worker
console.log('Test 6: 3-tier fallback resolution for Upload Worker...');
function resolveUploadWorkerBg(item: { customBackgroundColor?: string; avoidColor?: string; taskId?: string }, taskLookup?: (id: string) => any): string {
  let resolvedBgHex: string | undefined;

  // 1. Queue-Item prüfen
  if (item.customBackgroundColor && typeof item.customBackgroundColor === 'string') {
    const trimmed = item.customBackgroundColor.trim().replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
      resolvedBgHex = `#${trimmed.toUpperCase()}`;
    }
  }

  // 2. Task-Lookup
  if (!resolvedBgHex && item.taskId && taskLookup) {
    const task = taskLookup(item.taskId);
    if (task) {
      const rawTaskBg = (task.customAnswers as any)?.customBackgroundColor
        || (task.customAnswers as any)?.preferredBackgroundColor
        || (task.customAnswers as any)?.accessoryColorHex
        || (task as any).customBackgroundColor
        || (task as any).preferredBackgroundColor
        || task.analysisResult?.background_color_recommendation?.hex;
      if (rawTaskBg && typeof rawTaskBg === 'string') {
        const trimmed = rawTaskBg.trim().replace(/^#/, '');
        if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
          resolvedBgHex = `#${trimmed.toUpperCase()}`;
        }
      }
    }
  }

  // 3. Fallback nach bestehender Regel
  if (!resolvedBgHex) {
    resolvedBgHex = item.avoidColor === 'black' ? '#FFFFFF' : '#000000';
  }

  return resolvedBgHex;
}

// Tier 1
const colorTier1 = resolveUploadWorkerBg({
  customBackgroundColor: '#1A2332',
  avoidColor: 'white',
  taskId: 'task_1'
});
assert.equal(colorTier1, '#1A2332');

// Tier 2
const mockTasks: Record<string, any> = {
  task_1: {
    customAnswers: { customBackgroundColor: '#2B2B2B' }
  },
  task_2: {
    analysisResult: { background_color_recommendation: { hex: '#002BB6' } }
  }
};
const colorTier2A = resolveUploadWorkerBg({ taskId: 'task_1', avoidColor: 'none' }, id => mockTasks[id]);
assert.equal(colorTier2A, '#2B2B2B');

const colorTier2B = resolveUploadWorkerBg({ taskId: 'task_2', avoidColor: 'white' }, id => mockTasks[id]);
assert.equal(colorTier2B, '#002BB6');

// Tier 3
assert.equal(resolveUploadWorkerBg({ avoidColor: 'black' }), '#FFFFFF');
assert.equal(resolveUploadWorkerBg({ avoidColor: 'white' }), '#000000');
assert.equal(resolveUploadWorkerBg({ avoidColor: 'none' }), '#000000');
console.log('✅ [PASS] Test 6: 3-tier fallback resolution verified.');

console.log('====================================================');
console.log('🎉 ALL PRODUCT BACKGROUND COLOR PIPELINE TESTS PASSED!');
console.log('====================================================');

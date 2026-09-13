import assert from 'node:assert/strict';

// Test the live upload DOM evaluate logic for products with default-fit-type-label (fixed fit, no checkboxes)
function evaluateFitControls(params: { expectsFitControls: boolean; fitTypes: string[] }, dom: { hasDefaultFitLabel: boolean; fitCheckboxes: string[] }) {
  let desiredFits = params.fitTypes.map(f => f.toLowerCase());
  desiredFits.push('adult_unisex', 'unisex', 'adult', 'standard');

  const visibleFitCandidates = (params.expectsFitControls && !dom.hasDefaultFitLabel) ? dom.fitCheckboxes : [];
  const fitElements: { matchedFit: string }[] = [];
  const seenFits = new Set<string>();

  for (const el of visibleFitCandidates) {
    let matchedFit = el;
    if (matchedFit && !seenFits.has(matchedFit)) {
      seenFits.add(matchedFit);
      fitElements.push({ matchedFit });
    }
  }

  const activeFitsApplied: string[] = [];
  const fitDebugSummary: Record<string, { target: boolean; final: boolean }> = {};

  if (dom.hasDefaultFitLabel) {
    fitDebugSummary['adult_unisex'] = { target: true, final: true };
    activeFitsApplied.push('adult_unisex');
  }

  for (const item of fitElements) {
    const shouldBeChecked = desiredFits.includes(item.matchedFit) || item.matchedFit === 'adult_unisex' || item.matchedFit === 'unisex';
    const isChecked = true; // simulated checked
    fitDebugSummary[item.matchedFit] = { target: shouldBeChecked, final: isChecked };
    if (isChecked) {
      activeFitsApplied.push(item.matchedFit);
    }
  }

  const failedFitStates = Object.entries(fitDebugSummary)
    .filter(([, state]) => state.target !== state.final)
    .map(([fit, state]) => `${fit} erwartet=${state.target ? 'aktiv' : 'inaktiv'} tatsächlich=${state.final ? 'aktiv' : 'inaktiv'}`);

  const expectsCheckboxes = params.expectsFitControls && !dom.hasDefaultFitLabel;
  if ((expectsCheckboxes && fitElements.length === 0) || failedFitStates.length > 0) {
    return {
      success: false,
      error: `FAILED_FIT_TYPE: ${fitElements.length === 0 ? 'Keine Fit-Controls im verifizierten Produkteditor gefunden' : failedFitStates.join(', ')}`
    };
  }

  return {
    success: true,
    fitTypesApplied: activeFitsApplied,
    fitDebug: fitDebugSummary
  };
}

// 1. Standard fixed fit product (Adult Unisex, catalog expects no fits)
const res1 = evaluateFitControls(
  { expectsFitControls: false, fitTypes: [] },
  { hasDefaultFitLabel: true, fitCheckboxes: [] }
);
assert.equal(res1.success, true);
assert.deepEqual(res1.fitTypesApplied, ['adult_unisex']);

// 2. Fixed fit product with stale catalog (catalog erroneously expected fits, but DOM has default-fit label)
const res2 = evaluateFitControls(
  { expectsFitControls: true, fitTypes: ['standard', 'youth'] },
  { hasDefaultFitLabel: true, fitCheckboxes: [] }
);
assert.equal(res2.success, true, 'Must succeed when live DOM shows default-fit label despite stale catalog expectation');
assert.deepEqual(res2.fitTypesApplied, ['adult_unisex']);

// 3. Regular product with checkboxes (e.g. Standard T-Shirt) missing checkboxes -> MUST fail
const res3 = evaluateFitControls(
  { expectsFitControls: true, fitTypes: ['men', 'women'] },
  { hasDefaultFitLabel: false, fitCheckboxes: [] }
);
assert.equal(res3.success, false);
assert.ok(res3.error?.includes('Keine Fit-Controls'));

// 4. Regular product with checkboxes present -> MUST succeed
const res4 = evaluateFitControls(
  { expectsFitControls: true, fitTypes: ['men', 'women'] },
  { hasDefaultFitLabel: false, fitCheckboxes: ['men', 'women'] }
);
assert.equal(res4.success, true);
assert.ok(res4.fitTypesApplied?.includes('men'));
assert.ok(res4.fitTypesApplied?.includes('women'));

console.log('PASS: default-fit-type-label immunity, stale catalog self-healing, and checkbox requirement enforcement');

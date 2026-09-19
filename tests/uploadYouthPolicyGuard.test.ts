import assert from 'node:assert/strict';

type FitState = { fit: string; checked: boolean };

function applyLiveFitPolicy(states: FitState[], desiredFits: string[], youthEnabled: boolean): FitState[] {
  const desired = new Set(desiredFits.map(fit => fit.toLowerCase()));
  return states.map(state => ({
    ...state,
    checked: state.fit === 'youth'
      ? youthEnabled && desired.has('youth')
      : desired.has(state.fit) || state.fit === 'adult_unisex'
  }));
}

const staleCatalogScenario = applyLiveFitPolicy([
  { fit: 'men', checked: true },
  { fit: 'youth', checked: true }
], ['men'], false);

assert.deepEqual(staleCatalogScenario, [
  { fit: 'men', checked: true },
  { fit: 'youth', checked: false }
], 'Youth must be actively unchecked even when Amazon preselected it and the effective requested list omits it');

const youthRequestedButGloballyBlocked = applyLiveFitPolicy([
  { fit: 'men', checked: false },
  { fit: 'youth', checked: true }
], ['men', 'youth'], false);
assert.equal(youthRequestedButGloballyBlocked.find(state => state.fit === 'youth')?.checked, false);

const allowedScenario = applyLiveFitPolicy([{ fit: 'youth', checked: false }], ['youth'], true);
assert.equal(allowedScenario[0].checked, true);

console.log('PASS: live Youth guard overrides stale catalog, Amazon defaults and requested audit fits');

import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/server/services/settingsService';
import { UpdateBackfillService } from '../src/server/services/updateBackfillService';

const originalSettings = { ...loadSettings() };

try {
  saveSettings({
    queueUpdateAutoBackfillEnabled: true,
    updateAutoBackfillTokenFailureCount: 0,
    updateAutoBackfillTokenFailureThreshold: 3,
    updateAutoBackfillTokenPausedAt: undefined,
    updateAutoBackfillTokenPauseReason: undefined,
    updateAutoBackfillTokenLastFailedTaskId: undefined,
    updateAutoBackfillTokenLastFailedStep: undefined
  });

  assert.deepEqual(UpdateBackfillService.registerTokenburnFailure('#101-U', 'U4', 'listing failed'), {
    paused: false,
    failureCount: 1,
    threshold: 3
  });
  assert.equal(UpdateBackfillService.getTokenburnProtection().paused, false);

  UpdateBackfillService.registerTokenburnFailure('#102-U', 'U5', 'tm failed');
  const thirdFailure = UpdateBackfillService.registerTokenburnFailure('#103-U', 'U6', 'translation failed');
  assert.equal(thirdFailure.paused, true);

  const paused = UpdateBackfillService.getTokenburnProtection();
  assert.equal(paused.failureCount, 3);
  assert.equal(paused.paused, true);
  assert.equal(paused.lastFailedTaskId, '#103-U');
  assert.equal(paused.lastFailedStep, 'U6');
  assert.equal(loadSettings().queueUpdateAutoBackfillEnabled, false, 'Third token failure must stop automatic backfill');

  UpdateBackfillService.resetTokenburnProtection();
  const reset = UpdateBackfillService.getTokenburnProtection();
  assert.equal(reset.failureCount, 0);
  assert.equal(reset.paused, false);
  assert.equal(loadSettings().queueUpdateAutoBackfillEnabled, true);
  console.log('PASS update tokenburn protection: persistent threshold pause and explicit reset');
} finally {
  saveSettings(originalSettings);
}

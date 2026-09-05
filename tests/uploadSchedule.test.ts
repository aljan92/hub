import assert from 'node:assert/strict';
import { isUploadScheduleMinute } from '../src/server/services/uploadScheduleService';

// September is UTC+2 in Europe/Berlin. These UTC instants prove that the
// scheduler does not inherit the host/container timezone.
const berlinTime = (hour: number, minute: number, second = 0) =>
  new Date(Date.UTC(2026, 8, 5, hour - 2, minute, second));

assert.equal(isUploadScheduleMinute('18:40', berlinTime(18, 40, 0)), true);
assert.equal(isUploadScheduleMinute('18:40', berlinTime(18, 40, 59)), true, 'The full configured minute is the trigger window');
assert.equal(isUploadScheduleMinute('18:40', berlinTime(18, 39, 59)), false);
assert.equal(isUploadScheduleMinute('18:40', berlinTime(18, 41, 0)), false, 'A past schedule must not trigger later');
assert.equal(isUploadScheduleMinute('off', berlinTime(18, 40)), false);
assert.equal(isUploadScheduleMinute('25:00', berlinTime(18, 40)), false);

console.log('PASS upload schedule: exact local minute only, no catch-up trigger');

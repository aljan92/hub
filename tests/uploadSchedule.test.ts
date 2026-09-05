import assert from 'node:assert/strict';
import { isUploadScheduleMinute } from '../src/server/services/uploadScheduleService';

const localTime = (hour: number, minute: number, second = 0) => new Date(2026, 8, 5, hour, minute, second);

assert.equal(isUploadScheduleMinute('16:20', localTime(16, 20, 0)), true);
assert.equal(isUploadScheduleMinute('16:20', localTime(16, 20, 59)), true, 'The full configured minute is the trigger window');
assert.equal(isUploadScheduleMinute('16:20', localTime(16, 19, 59)), false);
assert.equal(isUploadScheduleMinute('16:20', localTime(16, 21, 0)), false, 'A past schedule must not trigger later');
assert.equal(isUploadScheduleMinute('off', localTime(16, 20)), false);
assert.equal(isUploadScheduleMinute('25:00', localTime(16, 20)), false);

console.log('PASS upload schedule: exact local minute only, no catch-up trigger');

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { isUpdateScheduledToday } from '../src/client/utils/queueTodayPlan';

assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 18, totalBaseSlots: 18 }, 'live'), true);
assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 0, totalBaseSlots: 18 }, 'live'), false);
assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 0, totalBaseSlots: 0 }, 'live'), true);
assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 18, totalBaseSlots: 18 }, 'hybrid'), true);
assert.equal(isUpdateScheduledToday({ status: 'UPLOADING', allocatedSlots: 18 }, 'hybrid'), true);
assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 18, isPaused: true }, 'live'), false);
assert.equal(isUpdateScheduledToday({ status: 'WAITING', allocatedSlots: 18 }, 'draft'), false);
assert.equal(isUpdateScheduledToday({ status: 'UPLOADING', allocatedSlots: 18 }, 'draft'), false);

const root = process.cwd();
const queueView = fs.readFileSync(path.join(root, 'src/client/views/QueueView.tsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');
assert.match(queueView, /activeUpdateDesigns = queueState\.items\.filter\(i => isUpdateItem\(i\) && isUpdateScheduledToday\(i\)\)/);
assert.match(server, /QueueService\.reorderItemsByIds\(itemIds\)/);

console.log('PASS queue today projection: live/hybrid selection, draft exclusion, pause and stable-ID reorder endpoint');

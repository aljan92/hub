import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QueueService, QueueItem } from '../src/server/services/queueService';
import { loadSettings, saveSettings } from '../src/server/services/settingsService';

console.log('====================================================');
console.log('🚀 RUNNING QUEUE SLOT BALANCING RELIABILITY TESTS (Alex Todo #7)');
console.log('====================================================\n');

// Backup current settings and queue
const originalSettings = loadSettings();
const originalQueueState = QueueService.getState();
const testItemIds: string[] = [];

try {
  // Set Live Mode with maxDrop = 17 (as seen in screenshot)
  saveSettings({
    ...originalSettings,
    queueUploadMode: 'live',
    queueMaxDropPerDesign: 17
  });

  // -------------------------------------------------------------------------
  // TEST 1: Screenshot Scenario - 28 free slots, 3 waiting new designs
  // When available slots (28) are less than minRequired (e.g. 97),
  // NO item must be forced into scheduledToday. No red overflow!
  // -------------------------------------------------------------------------
  console.log('Test 1: Insufficient slots scenario (28 free slots, 3 new designs)...');
  
  // Clear any existing queue items for isolated test
  const existingIds = QueueService.getState().items.map(i => i.id);
  for (const id of existingIds) {
    QueueService.removeItem(id);
  }

  const item1 = QueueService.enqueueDesign({
    taskId: 'test_task_109_d',
    designTitle: 'Endless Hoofbeats',
    niche: 'Horse',
    brand: 'Test Brand',
    title: 'Endless Hoofbeats Vintage Equine',
    bullet1: 'Bullet 1',
    bullet2: 'Bullet 2',
    description: 'Description',
    imagePath: '/tmp/test1.png',
    pngPath: '/tmp/test1.png',
    fitTypes: ['men', 'women'],
    source: 'DESIGNER'
  });
  testItemIds.push(item1.id);

  const item2 = QueueService.enqueueDesign({
    taskId: 'test_task_098_h',
    designTitle: 'Thyme to Garden',
    niche: 'Garden',
    brand: 'Test Brand',
    title: 'Thyme to Garden Herb Grower',
    bullet1: 'Bullet 1',
    bullet2: 'Bullet 2',
    description: 'Description',
    imagePath: '/tmp/test2.png',
    pngPath: '/tmp/test2.png',
    fitTypes: ['men', 'women'],
    source: 'HERMES'
  });
  testItemIds.push(item2.id);

  const item3 = QueueService.enqueueDesign({
    taskId: 'test_task_104_d',
    designTitle: 'Throw Clay Swim',
    niche: 'Swimming',
    brand: 'Test Brand',
    title: 'Throw Clay Swim Laps Pottery',
    bullet1: 'Bullet 1',
    bullet2: 'Bullet 2',
    description: 'Description',
    imagePath: '/tmp/test3.png',
    pngPath: '/tmp/test3.png',
    fitTypes: ['men', 'women'],
    source: 'DESIGNER'
  });
  testItemIds.push(item3.id);

  // Rebalance with 28 free slots (exactly matching user's screenshot)
  const state1 = QueueService.rebalanceQueue(28);

  assert.equal(state1.scheduledLiveSlotsToday, 0, 'Must not schedule any slots today when minimum required slots (97) > available slots (28)');
  assert.equal(state1.scheduledItemsCount, 0, 'Must have 0 scheduled items today');
  assert.equal(state1.overflowNewItemsCount, 3, 'All 3 new designs must be accounted as overflow/waiting for slots');

  const updatedItem1 = state1.items.find(i => i.id === item1.id)!;
  const updatedItem2 = state1.items.find(i => i.id === item2.id)!;
  const updatedItem3 = state1.items.find(i => i.id === item3.id)!;

  assert.equal(updatedItem1.allocatedSlots, 0, 'Item 1 allocatedSlots must be 0 (Yellow: Wartet auf freie Slots)');
  assert.equal(updatedItem2.allocatedSlots, 0, 'Item 2 allocatedSlots must be 0 (Yellow: Wartet auf freie Slots)');
  assert.equal(updatedItem3.allocatedSlots, 0, 'Item 3 allocatedSlots must be 0 (Yellow: Wartet auf freie Slots)');

  console.log('✅ [PASS] Test 1: Screenshot scenario correctly leaves all 3 designs in waiting (0 slots allocated, 0 scheduled live slots)');

  // -------------------------------------------------------------------------
  // TEST 2: Knapsack Fill for Updates when New Designs do not fit
  // 28 free slots, 1 new design (min 97 slots) + 1 update design (needs 15 slots)
  // The new design cannot fit, but the update design CAN fit into the 28 slots!
  // -------------------------------------------------------------------------
  console.log('Test 2: Knapsack fills update item into remaining slots when new items do not fit...');
  
  // Create an update item
  const updateItem: QueueItem = {
    id: `update_${Date.now()}`,
    taskId: 'task_001_U',
    brand: 'Update Brand',
    title: 'Update Design',
    bullet1: 'Bullet 1',
    bullet2: 'Bullet 2',
    description: 'Description',
    listings: {},
    fitTypes: ['men', 'women'],
    avoidColor: 'none',
    imagePath: '',
    pngPath: '',
    addedAt: new Date().toISOString(),
    status: 'WAITING',
    isLocked: false,
    allocatedSlots: 0,
    totalBaseSlots: 15,
    publishedProductsCount: 100,
    activeProductsMap: {},
    droppedSlotsMap: {},
    sortOrder: 0,
    source: 'UPDATE',
    type: 'update'
  };

  (QueueService as any).items.push(updateItem);
  testItemIds.push(updateItem.id);

  const state2 = QueueService.rebalanceQueue(28);

  const updatedNewItem = state2.items.find(i => i.id === item1.id)!;
  const updatedUpdateItem = state2.items.find(i => i.id === updateItem.id)!;

  assert.equal(updatedNewItem.allocatedSlots, 0, 'New item must remain at 0 allocated slots');
  assert.ok((updatedUpdateItem.allocatedSlots ?? 0) > 0, 'Update item must be allocated slots by Knapsack');
  assert.ok(state2.scheduledLiveSlotsToday! <= 28, `Scheduled live slots (${state2.scheduledLiveSlotsToday}) must not exceed 28`);

  console.log(`✅ [PASS] Test 2: Knapsack correctly allocated ${updatedUpdateItem.allocatedSlots} slots to update design while new design waits`);

  // -------------------------------------------------------------------------
  // TEST 3: Alex Todo #7 Scenario - 200 free slots, 2 new designs with maxDrop 17
  // Both designs request ~114 slots. Total = 228 > 200.
  // Balancing drops slots evenly from both to reach 200 slots total.
  // -------------------------------------------------------------------------
  console.log('Test 3: 200 free slots, 2 new designs drop slots evenly to fit limit...');
  
  // Remove update item and third item
  // For catalog with 120 base slots, dropping 20 slots per design allows 2x 100 = 200 slots
  saveSettings({
    ...originalSettings,
    queueUploadMode: 'live',
    queueMaxDropPerDesign: 20
  });

  QueueService.removeItem(updateItem.id);
  QueueService.removeItem(item3.id);

  const state3 = QueueService.rebalanceQueue(200);

  const balanced1 = state3.items.find(i => i.id === item1.id)!;
  const balanced2 = state3.items.find(i => i.id === item2.id)!;

  assert.ok(balanced1.allocatedSlots! > 0, 'Design 1 must be scheduled');
  assert.ok(balanced2.allocatedSlots! > 0, 'Design 2 must be scheduled');
  assert.equal(state3.scheduledItemsCount, 2, 'Both designs must be scheduled today');
  assert.ok(state3.scheduledLiveSlotsToday! <= 200, `Total live slots (${state3.scheduledLiveSlotsToday}) must be <= 200`);
  assert.equal(balanced1.allocatedSlots, balanced2.allocatedSlots, 'Slots must be dropped evenly between the two unlocked designs');

  console.log(`✅ [PASS] Test 3: 2x new designs balanced evenly to ${balanced1.allocatedSlots} + ${balanced2.allocatedSlots} = ${state3.scheduledLiveSlotsToday} (<= 200)`);

  // -------------------------------------------------------------------------
  // TEST 4: QueueView Source Code Consistency
  // Verify that QueueView computes tab-specific counters
  // -------------------------------------------------------------------------
  console.log('Test 4: QueueView tab-consistent counter validation...');
  const queueViewSource = fs.readFileSync(path.join(process.cwd(), 'src/client/views/QueueView.tsx'), 'utf8');
  assert.match(queueViewSource, /scheduledCountInTab/, 'QueueView must calculate scheduledCountInTab');
  assert.match(queueViewSource, /waitingForSlotsCountInTab/, 'QueueView must calculate waitingForSlotsCountInTab');
  assert.match(queueViewSource, /\{scheduledCountInTab\} von \{waitingOrUploadingDesigns\.length\} Designs heute einplanbar/, 'Card 2 must use scheduledCountInTab');

  console.log('✅ [PASS] Test 4: QueueView tab-consistent counter projection verified');

} finally {
  // Cleanup test items
  for (const id of testItemIds) {
    try { QueueService.removeItem(id); } catch {}
  }
  // Restore original settings
  saveSettings(originalSettings);
  // Restore original queue items
  (QueueService as any).items = originalQueueState.items;
  QueueService.saveQueue();
  QueueService.rebalanceQueue();
}

console.log('\n====================================================');
console.log('🎉 ALL QUEUE SLOT BALANCING RELIABILITY TESTS PASSED!');
console.log('====================================================');

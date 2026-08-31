import { QueueService, QueueItem } from '../src/server/services/queueService';

function createMockItem(id: string, totalBaseSlots: number): QueueItem {
  return {
    id,
    taskId: `task_${id}`,
    brand: 'Test Brand',
    title: `Design ${id}`,
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
    totalBaseSlots,
    activeProductsMap: {},
    droppedSlotsMap: {},
    sortOrder: 0,
    source: 'UPDATE',
    type: 'update'
  };
}

async function runKnapsackTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING BEST-FIT KNAPSACK OPTIMIZER UNIT TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`, detail || '');
    }
  }

  // ----------------------------------------------------
  // TEST 1: Exact Match (94 Slots Capacity)
  // ----------------------------------------------------
  {
    const candidates = [
      createMockItem('U1', 43),
      createMockItem('U2', 60),
      createMockItem('U3', 35),
      createMockItem('U4', 16),
      createMockItem('U5', 12)
    ];

    const result = QueueService.solveBestFitUpdateKnapsack(candidates, 94);
    assert(result.usedSlots === 94, 'Test 1: Exact match achieved (usedSlots = 94)');
    assert(result.selectedIds.has('U1'), 'Test 1: U1 (43) selected');
    assert(result.selectedIds.has('U3'), 'Test 1: U3 (35) selected');
    assert(result.selectedIds.has('U4'), 'Test 1: U4 (16) selected');
    assert(!result.selectedIds.has('U2'), 'Test 1: U2 (60) not selected');
  }

  // ----------------------------------------------------
  // TEST 2: 0-Slot Items are Always Included for Free
  // ----------------------------------------------------
  {
    const candidates = [
      createMockItem('U_ZERO_1', 0),
      createMockItem('U_ZERO_2', 0),
      createMockItem('U_POS_1', 25),
      createMockItem('U_POS_2', 30)
    ];

    const result = QueueService.solveBestFitUpdateKnapsack(candidates, 28);
    assert(result.selectedIds.has('U_ZERO_1'), 'Test 2: 0-slot item 1 always selected');
    assert(result.selectedIds.has('U_ZERO_2'), 'Test 2: 0-slot item 2 always selected');
    assert(result.selectedIds.has('U_POS_1'), 'Test 2: U_POS_1 (25) selected within 28 capacity');
    assert(!result.selectedIds.has('U_POS_2'), 'Test 2: U_POS_2 (30) omitted (exceeds capacity)');
    assert(result.usedSlots === 25, 'Test 2: Total used slots is 25');
  }

  // ----------------------------------------------------
  // TEST 3: Best-Fit Beats Greedy FIFO
  // ----------------------------------------------------
  {
    // Greedy FIFO would pick U1 (45), leaving 5 slots free (45 used).
    // Knapsack picks U2 (25) + U3 (25) = 50 used (100% capacity).
    const candidates = [
      createMockItem('U1', 45),
      createMockItem('U2', 25),
      createMockItem('U3', 25)
    ];

    const result = QueueService.solveBestFitUpdateKnapsack(candidates, 50);
    assert(result.usedSlots === 50, 'Test 3: Knapsack finds 50/50 exact combination');
    assert(result.selectedIds.has('U2') && result.selectedIds.has('U3'), 'Test 3: U2 and U3 selected over greedy U1');
    assert(!result.selectedIds.has('U1'), 'Test 3: Greedy U1 omitted for optimal sum');
  }

  // ----------------------------------------------------
  // TEST 4: Scalability with 50 Pool Items
  // ----------------------------------------------------
  {
    const pool50: QueueItem[] = [];
    const sizes = [43, 35, 16, 12, 8, 3, 0, 55, 60, 22, 19, 14, 7, 0, 41, 33];
    for (let i = 0; i < 50; i++) {
      pool50.push(createMockItem(`POOL_${i}`, sizes[i % sizes.length]));
    }

    const tStart = performance.now();
    const result = QueueService.solveBestFitUpdateKnapsack(pool50, 200);
    const durationMs = performance.now() - tStart;

    assert(result.usedSlots === 200, `Test 4: Reached 200/200 slots across 50 pool items`);
    assert(durationMs < 50, `Test 4: Super fast execution (${durationMs.toFixed(2)} ms)`);
    assert(result.selectedIds.size > 0, 'Test 4: Successfully selected optimal candidate set');
  }

  // ----------------------------------------------------
  // Summary
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runKnapsackTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

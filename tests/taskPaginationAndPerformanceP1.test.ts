import assert from 'assert';
import { TaskLogService, DesignTaskLog, SessionEvent } from '../src/server/services/taskLogService';
import { toTaskSummary, TaskSummary } from '../src/types/tasks';

async function runTaskPaginationAndPerformanceP1Tests() {
  console.log('====================================================');
  console.log('⚡ RUNNING TASK UI & API PERFORMANCE P1 TESTS');
  console.log('====================================================\n');

  // Save current in-memory logs to restore after tests
  const originalLogs = TaskLogService.getTaskLogs();

  try {
    // Generate 55 mock tasks with heavy events, SVG content, and raw listing data
    const mockTasks: DesignTaskLog[] = [];
    for (let i = 55; i >= 1; i--) {
      const padded = String(i).padStart(3, '0');
      const events: SessionEvent[] = [];
      // Add 20 events per task with heavy payload to simulate realistic task sizes
      for (let e = 0; e < 20; e++) {
        events.push({
          timestamp: new Date(1700000000000 + i * 10000 + e * 100).toISOString(),
          type: 'LLM_RESPONSE',
          title: `Step ${e} Completed`,
          content: {
            rawLlmOutput: 'A'.repeat(500),
            tokenCount: 450,
            model: 'anthropic/claude-3.5-sonnet'
          }
        });
      }

      mockTasks.push({
        id: `#${padded}-U`,
        counter: i,
        source: 'UPDATE',
        suffix: 'U',
        status: i % 4 === 0 ? 'AWAITING_DESIGN_REVIEW' : 'COMPLETED',
        receivedAt: new Date(1700000000000 + i * 10000).toISOString(),
        payload: {
          designId: `design_mock_${padded}`,
          quote: `Motivational Quote #${padded}`,
          niche1: 'Gym & Fitness',
          niche2: 'Bodybuilding'
        },
        events,
        svgContent: '<svg width="4500" height="5400">' + '<path d="M0 0h100v100H0z"/>'.repeat(200) + '</svg>',
        listingResult: {
          en: { brand: 'BrandX', title: `Title ${padded}`, bullet1: 'B1', bullet2: 'B2', description: 'Desc' }
        },
        trademarkCheckResult: { hits: [{ term: 'SampleTM', class: 25 }] }
      });
    }

    // Set mock tasks in TaskLogService in-memory
    (TaskLogService as any).inMemoryLogs = mockTasks;

    // --------------------------------------------------------------------------
    // TEST A: Initial Pagination (limit = 20)
    // --------------------------------------------------------------------------
    console.log('Test A: Initial Pagination (limit = 20)...');
    const page1 = TaskLogService.getTaskSummariesPage({ limit: 20 });

    assert.strictEqual(page1.success, true);
    assert.strictEqual(page1.tasks.length, 20, 'Page 1 must contain exactly 20 tasks');
    assert.strictEqual(page1.hasMore, true, 'hasMore must be true when 55 tasks exist');
    assert.strictEqual(typeof page1.nextCursor, 'string', 'nextCursor must be a valid task ID string');
    assert.strictEqual(page1.nextCursor, page1.tasks[19].id, 'nextCursor must match the 20th task ID');
    assert.strictEqual(page1.totalCount, 55, 'totalCount must report all 55 tasks');
    console.log(`✅ Test A Passed: Returned exactly 20 tasks, hasMore=true, nextCursor=${page1.nextCursor}.\n`);

    // --------------------------------------------------------------------------
    // TEST B: Next Cursor Pagination (Page 2 = next 20)
    // --------------------------------------------------------------------------
    console.log('Test B: Next Cursor Pagination (Page 2)...');
    const page2 = TaskLogService.getTaskSummariesPage({ limit: 20, cursor: page1.nextCursor! });

    assert.strictEqual(page2.success, true);
    assert.strictEqual(page2.tasks.length, 20, 'Page 2 must contain next 20 tasks');
    assert.strictEqual(page2.hasMore, true, 'hasMore must be true (40/55 loaded)');

    // Ensure zero overlap between Page 1 and Page 2
    const page1Ids = new Set(page1.tasks.map(t => t.id));
    for (const task of page2.tasks) {
      assert.strictEqual(page1Ids.has(task.id), false, `Task ${task.id} appears in both Page 1 and Page 2!`);
    }

    // Page 3: Remaining 15
    const page3 = TaskLogService.getTaskSummariesPage({ limit: 20, cursor: page2.nextCursor! });
    assert.strictEqual(page3.tasks.length, 15, 'Page 3 must contain remaining 15 tasks');
    assert.strictEqual(page3.hasMore, false, 'hasMore must be false on last page');
    assert.strictEqual(page3.nextCursor, null, 'nextCursor must be null on last page');
    console.log('✅ Test B Passed: Sequential cursor navigation retrieved 20 + 20 + 15 = 55 tasks with 0 duplicates.\n');

    // --------------------------------------------------------------------------
    // TEST C: Cursor Stability when New Tasks are Added
    // --------------------------------------------------------------------------
    console.log('Test C: Cursor Stability when New Tasks Arrive at the Top...');
    // User has loaded Page 1 (#055-U to #036-U). nextCursor is #036-U.
    // Now 2 brand new tasks arrive and are prepended at the top:
    const newTask1: DesignTaskLog = {
      id: '#056-U',
      counter: 56,
      source: 'UPDATE',
      suffix: 'U',
      status: 'RECEIVED',
      receivedAt: new Date(1700000000000 + 56 * 10000).toISOString(),
      payload: { quote: 'Brand New 56' },
      events: []
    };
    const newTask2: DesignTaskLog = {
      id: '#057-U',
      counter: 57,
      source: 'UPDATE',
      suffix: 'U',
      status: 'RECEIVED',
      receivedAt: new Date(1700000000000 + 57 * 10000).toISOString(),
      payload: { quote: 'Brand New 57' },
      events: []
    };

    (TaskLogService as any).inMemoryLogs = [newTask2, newTask1, ...mockTasks];

    // User scrolls down and fetches Page 2 using the previous nextCursor (#036-U)
    const page2AfterNew = TaskLogService.getTaskSummariesPage({ limit: 20, cursor: page1.nextCursor! });

    assert.strictEqual(page2AfterNew.tasks.length, 20);
    // Verify that the first item of page 2 is exactly what was expected (#035-U)
    assert.strictEqual(page2AfterNew.tasks[0].id, '#035-U', 'First item of Page 2 must be #035-U despite new tasks');
    // Verify none of the items in page2AfterNew overlap with page 1
    for (const task of page2AfterNew.tasks) {
      assert.strictEqual(page1Ids.has(task.id), false, `Task ${task.id} in page 2 duplicated with page 1!`);
    }
    console.log('✅ Test C Passed: Cursor pagination is 100% stable when new tasks arrive at the top.\n');

    // --------------------------------------------------------------------------
    // TEST D: Summary Excludes Heavy Fields
    // --------------------------------------------------------------------------
    console.log('Test D: TaskSummary Excludes Heavy Fields...');
    const singleTask = mockTasks[0];
    const summary: any = toTaskSummary(singleTask);

    assert.strictEqual(summary.id, singleTask.id);
    assert.strictEqual(summary.quote, 'Motivational Quote #055');
    assert.strictEqual(summary.niche1, 'Gym & Fitness');
    assert.strictEqual(summary.eventsCount, 20, 'eventsCount must be 20');

    // Verify heavy fields are ABSENT from TaskSummary
    assert.strictEqual(summary.events, undefined, 'events must NOT be in TaskSummary');
    assert.strictEqual(summary.svgContent, undefined, 'svgContent must NOT be in TaskSummary');
    assert.strictEqual(summary.listingResult, undefined, 'listingResult must NOT be in TaskSummary');
    assert.strictEqual(summary.trademarkCheckResult, undefined, 'trademarkCheckResult must NOT be in TaskSummary');
    assert.strictEqual(summary.analysisResult, undefined, 'analysisResult must NOT be in TaskSummary');
    console.log('✅ Test D Passed: Heavy fields (events, svgContent, listings, trademark) are strictly excluded from TaskSummary.\n');

    // --------------------------------------------------------------------------
    // TEST E: Detail API Preserves Full DesignTaskLog
    // --------------------------------------------------------------------------
    console.log('Test E: Full Task Detail API Integrity...');
    const fullTask = TaskLogService.getTaskLogById('#055-U');
    assert.notStrictEqual(fullTask, undefined);
    assert.strictEqual(fullTask!.events.length, 20, 'Full task must retain all 20 events');
    assert.strictEqual(typeof fullTask!.svgContent, 'string', 'Full task must retain svgContent');
    assert.notStrictEqual(fullTask!.listingResult, undefined, 'Full task must retain listingResult');
    console.log('✅ Test E Passed: Full Task Detail endpoint retains 100% of deep data.\n');

    // --------------------------------------------------------------------------
    // TEST F: WebSocket Payload Size Comparison
    // --------------------------------------------------------------------------
    console.log('Test F: WebSocket Broadcast Payload Verification...');
    let broadcastedPayload: any = null;
    TaskLogService.setBroadcaster((type, payload) => {
      if (type === 'TASK_UPDATED') {
        broadcastedPayload = payload;
      }
    });

    TaskLogService.updateTaskStatus('#055-U', { hasError: false });

    assert.notStrictEqual(broadcastedPayload, null);
    assert.strictEqual(broadcastedPayload.id, '#055-U');
    assert.strictEqual(broadcastedPayload.events, undefined, 'WebSocket payload must NOT include events');
    assert.strictEqual(broadcastedPayload.svgContent, undefined, 'WebSocket payload must NOT include svgContent');
    const wsPayloadBytes = Buffer.byteLength(JSON.stringify(broadcastedPayload));
    assert.strictEqual(wsPayloadBytes < 1000, true, `WebSocket payload must be tiny (was ${wsPayloadBytes} bytes)`);
    console.log(`✅ Test F Passed: WebSocket broadcasts lightweight TaskSummary (${wsPayloadBytes} bytes).\n`);

    // --------------------------------------------------------------------------
    // TEST G: Performance & Payload Size Benchmark
    // --------------------------------------------------------------------------
    console.log('Test G: Performance & Payload Size Benchmark (Before vs. After)...');
    // Simulate "Before": full 55 tasks with all events, SVG, listings serialized
    const startBefore = process.hrtime.bigint();
    const beforeJson = JSON.stringify({ success: true, tasks: (TaskLogService as any).inMemoryLogs });
    const endBefore = process.hrtime.bigint();
    const durationBeforeMs = Number(endBefore - startBefore) / 1_000_000;
    const beforeBytes = Buffer.byteLength(beforeJson);

    // Simulate "After": 20 task summaries serialized
    const startAfter = process.hrtime.bigint();
    const afterSummaries = TaskLogService.getTaskSummariesPage({ limit: 20 });
    const afterJson = JSON.stringify(afterSummaries);
    const endAfter = process.hrtime.bigint();
    const durationAfterMs = Number(endAfter - startAfter) / 1_000_000;
    const afterBytes = Buffer.byteLength(afterJson);

    const sizeReductionPercent = (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1);
    const speedupFactor = (durationBeforeMs / durationAfterMs).toFixed(1);

    console.log(`   📊 Before (Full History API):`);
    console.log(`      Payload size: ${(beforeBytes / 1024).toFixed(1)} KB`);
    console.log(`      Serialization: ${durationBeforeMs.toFixed(2)} ms`);
    console.log(`   ⚡ After (P1 20-Summary Pagination):`);
    console.log(`      Payload size: ${(afterBytes / 1024).toFixed(1)} KB`);
    console.log(`      Serialization: ${durationAfterMs.toFixed(2)} ms`);
    console.log(`   🎯 Payload reduction: ${sizeReductionPercent}%`);
    console.log(`   🚀 Speedup factor: ${speedupFactor}x\n`);

    assert.strictEqual(afterBytes < beforeBytes * 0.1, true, 'P1 payload must be >90% smaller than full history');
    console.log('✅ Test G Passed: Enormous performance and network payload improvements verified.\n');

    console.log('====================================================');
    console.log('🎉 ALL TASK PERFORMANCE P1 TESTS PASSED! 🎉');
    console.log('====================================================\n');

  } finally {
    // Restore original in-memory logs
    (TaskLogService as any).inMemoryLogs = originalLogs;
  }
}

runTaskPaginationAndPerformanceP1Tests().catch(err => {
  console.error('❌ PERFORMANCE P1 TEST FAILED:', err);
  process.exit(1);
});

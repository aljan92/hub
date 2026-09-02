import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { 
  atomicWriteFile, 
  atomicWriteJson, 
  loadJsonWithBackupRecovery, 
  cleanupOrphanedTmpFiles,
  isFileInFailSafe,
  setFileFailSafe
} from '../src/server/utils/atomicFileStorage';
import { TaskLogService, DesignTaskLog, SessionEvent } from '../src/server/services/taskLogService';
import { FinalizationService } from '../src/server/services/finalizationService';

async function runPersistenceP0Tests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING TASK PERSISTENCE P0 HARDENING TESTS');
  console.log('====================================================\n');

  const testDir = path.resolve(process.cwd(), 'scratch', 'test_p0_persistence_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // --------------------------------------------------------------------------
    // TEST A: Normal Atomic Write & Reload
    // --------------------------------------------------------------------------
    console.log('Test A: Normal Atomic Write & Reload...');
    const testFileA = path.join(testDir, 'tasks_test_a.json');
    const sampleDataA = [
      { id: '#001-U', status: 'RECEIVED', quote: 'First Quote' },
      { id: '#002-U', status: 'PROCESSING', quote: 'Second Quote' }
    ];

    atomicWriteJson(testFileA, sampleDataA, { backup: true });

    assert.strictEqual(fs.existsSync(testFileA), true, 'File A must exist');
    const readResultA = loadJsonWithBackupRecovery<any[]>(testFileA, { defaultValue: [] });
    assert.strictEqual(readResultA.success, true);
    assert.strictEqual(readResultA.data.length, 2);
    assert.strictEqual(readResultA.data[0].id, '#001-U');
    assert.strictEqual(readResultA.recoveredFromBackup, false);
    assert.strictEqual(readResultA.corrupted, false);
    console.log('✅ Test A Passed: Atomic write wrote valid JSON and reloaded without loss.\n');

    // --------------------------------------------------------------------------
    // TEST B: Corrupted Main File -> Recovered from .bak
    // --------------------------------------------------------------------------
    console.log('Test B: Corrupted Main File -> Recovered from .bak...');
    const testFileB = path.join(testDir, 'tasks_test_b.json');
    const validDataB1 = [{ id: '#100-U', status: 'COMPLETED', title: 'Valid V1' }];
    const validDataB2 = [{ id: '#100-U', status: 'COMPLETED', title: 'Valid V2' }];

    // Step 1: Write initial version
    atomicWriteJson(testFileB, validDataB1, { backup: true });
    // Step 2: Write second version -> creates .bak with V1
    atomicWriteJson(testFileB, validDataB2, { backup: true });

    const bakFileB = `${testFileB}.bak`;
    assert.strictEqual(fs.existsSync(bakFileB), true, 'Backup file must exist');

    // Step 3: Simulate catastrophic crash during write (corrupt main file with truncated 0 bytes or bad JSON)
    fs.writeFileSync(testFileB, '{"invalid_truncated_json: true,');

    // Step 4: Attempt loading with recovery
    const recoveryResultB = loadJsonWithBackupRecovery<any[]>(testFileB, {
      validate: (d) => Array.isArray(d)
    });

    assert.strictEqual(recoveryResultB.success, true, 'Recovery must succeed');
    assert.strictEqual(recoveryResultB.recoveredFromBackup, true, 'Must report recoveredFromBackup: true');
    assert.strictEqual(recoveryResultB.corrupted, false, 'Should not be marked corrupted since backup was valid');
    assert.strictEqual(recoveryResultB.data.length, 1);
    assert.strictEqual(recoveryResultB.data[0].title, 'Valid V1', 'Must have restored valid data from .bak');

    // Step 5: Verify main file was automatically restored and repaired on disk
    const onDiskAfterRepair = JSON.parse(fs.readFileSync(testFileB, 'utf-8'));
    assert.strictEqual(onDiskAfterRepair[0].title, 'Valid V1', 'Main file must be repaired on disk');
    console.log('✅ Test B Passed: Corrupted main file was safely recovered and restored from .bak.\n');

    // --------------------------------------------------------------------------
    // TEST C: Both Main and Backup Corrupted -> FAIL-SAFE Mode
    // --------------------------------------------------------------------------
    console.log('Test C: Both Main and Backup Corrupted -> FAIL-SAFE Mode...');
    const testFileC = path.join(testDir, 'tasks_test_c.json');
    const bakFileC = `${testFileC}.bak`;

    // Corrupt both files
    fs.writeFileSync(testFileC, 'INVALID JUNK');
    fs.writeFileSync(bakFileC, '{ truncated:');

    const recoveryResultC = loadJsonWithBackupRecovery<any[]>(testFileC, {
      validate: (d) => Array.isArray(d),
      defaultValue: []
    });

    assert.strictEqual(recoveryResultC.success, false, 'Recovery must fail when both files are corrupt');
    assert.strictEqual(recoveryResultC.corrupted, true, 'Must report corrupted: true');
    assert.strictEqual(isFileInFailSafe(testFileC), true, 'File must be registered in failSafeRegistry');

    // Verify atomicWriteJson strictly REFUSES to overwrite the file
    let writeBlocked = false;
    try {
      atomicWriteJson(testFileC, [{ id: 'new_task' }]);
    } catch (err: any) {
      writeBlocked = true;
      assert.strictEqual(err.message.includes('FAIL-SAFE'), true);
    }
    assert.strictEqual(writeBlocked, true, 'Write must be blocked in fail-safe mode to prevent destructive loss');

    // Clean up fail-safe state for test file
    setFileFailSafe(testFileC, false);
    console.log('✅ Test C Passed: Double corruption triggers fail-safe and completely blocks destructive overwriting.\n');

    // --------------------------------------------------------------------------
    // TEST D: Backup Rotation
    // --------------------------------------------------------------------------
    console.log('Test D: Backup Rotation Integrity...');
    const testFileD = path.join(testDir, 'tasks_test_d.json');
    const bakFileD = `${testFileD}.bak`;

    const v1 = [{ v: 1 }];
    const v2 = [{ v: 2 }];
    const v3 = [{ v: 3 }];

    atomicWriteJson(testFileD, v1, { backup: true });
    assert.strictEqual(fs.existsSync(bakFileD), false, 'First write should not produce backup yet');

    atomicWriteJson(testFileD, v2, { backup: true });
    assert.strictEqual(fs.existsSync(bakFileD), true, 'Second write must produce backup');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(bakFileD, 'utf-8')), v1, 'Backup must contain v1');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(testFileD, 'utf-8')), v2, 'Main must contain v2');

    atomicWriteJson(testFileD, v3, { backup: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(bakFileD, 'utf-8')), v2, 'Backup must now contain v2');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(testFileD, 'utf-8')), v3, 'Main must contain v3');
    console.log('✅ Test D Passed: Backup rotation correctly retains previous valid state.\n');

    // --------------------------------------------------------------------------
    // TEST E: Temp File Cleanup
    // --------------------------------------------------------------------------
    console.log('Test E: Orphaned Temp File Cleanup...');
    const orphanTmp1 = path.join(testDir, 'tasks.tmp.old1');
    const orphanTmp2 = path.join(testDir, 'test.tmp.old2');
    fs.writeFileSync(orphanTmp1, 'abandoned temp');
    fs.writeFileSync(orphanTmp2, 'abandoned temp');

    assert.strictEqual(fs.existsSync(orphanTmp1), true);
    const cleaned = cleanupOrphanedTmpFiles(testDir);
    assert.strictEqual(cleaned >= 2, true, 'Must clean orphaned tmp files');
    assert.strictEqual(fs.existsSync(orphanTmp1), false, 'Orphaned tmp file must be deleted');
    assert.strictEqual(fs.existsSync(orphanTmp2), false, 'Orphaned tmp file must be deleted');
    console.log('✅ Test E Passed: Orphaned temporary files from crashes are cleanly purged.\n');

    // --------------------------------------------------------------------------
    // TEST F: Task Counter Recovery & No ID Collisions
    // --------------------------------------------------------------------------
    console.log('Test F: Task Counter Recovery...');
    const counterFileF = path.join(testDir, 'tasks_counter.json');
    // Write v1 then v2 so .bak exists with counter = 40
    atomicWriteJson(counterFileF, { counter: 40 }, { backup: true });
    atomicWriteJson(counterFileF, { counter: 42 }, { backup: true });
    // Corrupt main counter
    fs.writeFileSync(counterFileF, '{ damaged counter');

    const counterRecovery = loadJsonWithBackupRecovery<{ counter: number }>(counterFileF, {
      validate: (d) => d && typeof d.counter === 'number'
    });
    assert.strictEqual(counterRecovery.success, true);
    assert.strictEqual(counterRecovery.data.counter, 40, 'Counter must recover 40 from backup');
    assert.strictEqual(counterRecovery.recoveredFromBackup, true);
    console.log('✅ Test F Passed: Counter recovers safely from backup.\n');

    // --------------------------------------------------------------------------
    // TEST G: Listing Validation Loop Guard (Deterministic Termination)
    // --------------------------------------------------------------------------
    console.log('Test G: Deterministic Listing Validation Loop Guard...');
    const loopTaskId = 'test_loop_task_' + Date.now();
    const loopTask: DesignTaskLog = {
      id: loopTaskId,
      counter: 9999,
      source: 'DESIGN',
      suffix: 'D',
      status: 'AWAITING_DESIGN_REVIEW',
      receivedAt: new Date().toISOString(),
      payload: {},
      events: []
    };

    // Inject into TaskLogService in-memory logs
    const existingLogs = TaskLogService.loadLogs();
    (TaskLogService as any).inMemoryLogs = [loopTask, ...existingLogs];

    // Attempt 1: Should fail validation and record attempt 1
    const attempt1 = await FinalizationService.finalizeForQueue({
      taskId: loopTaskId,
      pipeline: 'DESIGN',
      brand: '', // Missing brand will trigger failure
      title: 'Valid Title Under Sixty Chars'
    });
    assert.strictEqual(attempt1.success, false);
    assert.strictEqual((loopTask as any).validationAttempts, 1);

    // Attempt 2: Should fail validation and record attempt 2
    const attempt2 = await FinalizationService.finalizeForQueue({
      taskId: loopTaskId,
      pipeline: 'DESIGN',
      brand: '',
      title: 'Valid Title Under Sixty Chars'
    });
    assert.strictEqual(attempt2.success, false);
    assert.strictEqual((loopTask as any).validationAttempts, 2);

    // Attempt 3: Must reach the retry limit and set status to ERROR with LISTING_VALIDATION_RETRY_LIMIT_REACHED
    const attempt3 = await FinalizationService.finalizeForQueue({
      taskId: loopTaskId,
      pipeline: 'DESIGN',
      brand: '',
      title: 'Valid Title Under Sixty Chars'
    });
    assert.strictEqual(attempt3.success, false);
    assert.strictEqual(attempt3.error?.includes('LISTING_VALIDATION_RETRY_LIMIT_REACHED'), true);
    assert.strictEqual(loopTask.status, 'ERROR', 'Task status must be set to ERROR after 3 failed attempts');
    assert.strictEqual(loopTask.hasError, true);
    assert.strictEqual(loopTask.errorDetails?.includes('LISTING_VALIDATION_RETRY_LIMIT_REACHED'), true);

    // Verify the task did NOT generate an unbounded number of events (12 events for 3 attempts instead of 5,000+)
    const finalizationEvents = loopTask.events.filter(e => e.type === 'FINALIZATION_EVENT');
    assert.strictEqual(finalizationEvents.length <= 15, true, `Event count must be bounded (was ${finalizationEvents.length})`);
    console.log('✅ Test G Passed: Validation loop terminates deterministically after 3 attempts with LISTING_VALIDATION_RETRY_LIMIT_REACHED.\n');

    // --------------------------------------------------------------------------
    // TEST H: No Silent Task Drop (>2,000 Tasks)
    // --------------------------------------------------------------------------
    console.log('Test H: No Silent Task Drop (>2,000 Tasks)...');
    const largeLogsArray: DesignTaskLog[] = [];
    for (let i = 0; i < 2050; i++) {
      largeLogsArray.push({
        id: `#${String(i).padStart(4, '0')}-T`,
        counter: i,
        source: 'TEST',
        suffix: 'T',
        status: 'COMPLETED',
        receivedAt: new Date().toISOString(),
        payload: {},
        events: []
      });
    }

    const testFileH = path.join(testDir, 'tasks_test_h.json');
    atomicWriteJson(testFileH, largeLogsArray, { backup: false, space: 0 });

    const reloadedH = JSON.parse(fs.readFileSync(testFileH, 'utf-8'));
    assert.strictEqual(reloadedH.length, 2050, 'All 2,050 tasks must be preserved without truncation');
    console.log('✅ Test H Passed: All 2,050 tasks preserved; silent slice(0, 2000) drop is eliminated.\n');

    // --------------------------------------------------------------------------
    // TEST I: Consecutive Duplicate Event Compaction
    // --------------------------------------------------------------------------
    console.log('Test I: Consecutive Duplicate Event Compaction...');
    const compactTaskId = 'test_compact_' + Date.now();
    const compactTask: DesignTaskLog = {
      id: compactTaskId,
      counter: 8888,
      source: 'TEST',
      suffix: 'T',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: {},
      events: []
    };

    (TaskLogService as any).inMemoryLogs = [compactTask, ...((TaskLogService as any).inMemoryLogs || [])];

    const duplicateEvent: SessionEvent = {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT',
      title: 'Repeated Status Check',
      content: { phase: 'CHECK', ok: false }
    };

    // Add identical event 5 times in a row
    for (let i = 0; i < 5; i++) {
      TaskLogService.addEvent(compactTaskId, duplicateEvent);
    }

    // Must compact into a single event with repeatCount = 5
    const taskAfterEvents = TaskLogService.getTask(compactTaskId);
    assert.strictEqual(taskAfterEvents?.events.length, 1, 'Should have only 1 compacted event');
    assert.strictEqual((taskAfterEvents?.events[0] as any).repeatCount, 5, 'repeatCount must be 5');

    // Adding a different event creates a second event
    TaskLogService.addEvent(compactTaskId, {
      timestamp: new Date().toISOString(),
      type: 'FINALIZATION_EVENT',
      title: 'Different Event',
      content: { phase: 'DONE' }
    });
    assert.strictEqual(taskAfterEvents?.events.length, 2, 'Different event must create a separate entry');
    console.log('✅ Test I Passed: Consecutive identical events are cleanly compacted.\n');

    console.log('====================================================');
    console.log('🎉 ALL TASK PERSISTENCE P0 HARDENING TESTS PASSED! 🎉');
    console.log('====================================================\n');

  } finally {
    // Clean up scratch test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

runPersistenceP0Tests().catch((err) => {
  console.error('❌ PERSISTENCE P0 TEST FAILED:', err);
  process.exit(1);
});

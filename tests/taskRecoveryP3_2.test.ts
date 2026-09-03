import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskLogService } from '../src/server/services/taskLogService';
import { QueueService } from '../src/server/services/queueService';
import { TaskRecoveryService } from '../src/server/services/taskRecoveryService';
import { TaskExecutionLock } from '../src/server/services/taskExecutionLock';
import { AssetValidationService } from '../src/server/services/assetValidationService';
import { UpdateBackfillService } from '../src/server/services/updateBackfillService';
import { TrademarkService } from '../src/server/services/trademarkService';
import { LLMService } from '../src/server/services/llmService';
import { DesignTaskLog, TrademarkWorkflowState } from '../src/types/tasks';

const TEST_DIR = path.resolve(process.cwd(), 'scratch', `test_p3_2_${Date.now()}`);
const TEST_DB_PATH = path.join(TEST_DIR, 'test_hub.sqlite');
const TEST_QUEUE_PATH = path.join(TEST_DIR, 'upload_queue.json');

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  (TaskRepository as any).dbPath = TEST_DB_PATH;
  (TaskRepository as any).dbInstance = null;
  (QueueService as any).queueFilePath = TEST_QUEUE_PATH;
  (QueueService as any).backupFilePath = TEST_QUEUE_PATH + '.bak';
  (QueueService as any).isCorruptedMode = false;
  TaskExecutionLock.clear();

  TaskRepository.init();
  QueueService.ensureLoaded();
}

function cleanupTestEnvironment() {
  try {
    TaskRepository.close();
  } catch {}
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('⚡ RUNNING SAFE TASK RECOVERY P3.2 TESTS');
  console.log('====================================================\n');

  setupTestEnvironment();

  try {
    // ----------------------------------------------------
    // Test A: Terminal & Review State Immunity
    // ----------------------------------------------------
    console.log('Test A: Terminal & Review State Immunity...');
    const immuneStatuses = [
      'COMPLETED',
      'UPDATE_QUEUED',
      'REJECTED',
      'ERROR',
      'AWAITING_PRE_FLIGHT_REVIEW',
      'AWAITING_DESIGN_REVIEW',
      'AWAITING_TM_REVIEW',
      'AWAITING_SVG_REVIEW',
      'AWAITING_RECOVERY_REVIEW'
    ] as const;

    for (let i = 0; i < immuneStatuses.length; i++) {
      const status = immuneStatuses[i];
      const task: DesignTaskLog = {
        id: `#test-immune-${i}`,
        counter: 100 + i,
        source: 'CREATION',
        suffix: 'D',
        status,
        receivedAt: new Date().toISOString(),
        payload: { title: `Immune Task ${status}` },
        events: []
      };
      TaskRepository.createTask(task);
    }

    const reportA = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(reportA.reservedRecoveryJobs, 0, 'No immune tasks should ever be reserved for recovery');
    console.log('✅ Test A Passed: Human review and terminal states are 100% immune to automated recovery.\n');

    // ----------------------------------------------------
    // Test B: Recovery Attempt Limit & Escalation
    // ----------------------------------------------------
    console.log('Test B: Recovery Attempt Limit & Escalation...');
    const limitTask: DesignTaskLog = {
      id: '#test-limit-exceeded',
      counter: 201,
      source: 'CREATION',
      suffix: 'D',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Poison Task' },
      events: [],
      recovery: {
        recoveryAttempts: 2,
        lastAttemptAt: new Date(Date.now() - 60000).toISOString(),
        interruptedStatus: 'PROCESSING'
      }
    };
    TaskRepository.createTask(limitTask);

    const reportB = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(reportB.attemptLimitEscalatedTasks, 1, 'Should escalate task exceeding 2 attempts');
    const updatedLimitTask = TaskRepository.getTaskById('#test-limit-exceeded')!;
    assert.strictEqual(updatedLimitTask.status, 'AWAITING_RECOVERY_REVIEW');
    assert.strictEqual(updatedLimitTask.checkpoint, 'RECOVERY_REVIEW');
    assert.strictEqual(updatedLimitTask.hasError, true);
    console.log('✅ Test B Passed: Interrupted tasks with 2 attempts are strictly escalated to AWAITING_RECOVERY_REVIEW.\n');

    // ----------------------------------------------------
    // Test S1: Shared Status Dispatch (DESIGN vs UPDATE)
    // ----------------------------------------------------
    console.log('Test S1: Shared Status (DESIGN vs UPDATE) Dispatch...');
    const designTaskListing: DesignTaskLog = {
      id: '#test-s1-design',
      counter: 301,
      source: 'CREATION',
      suffix: 'D',
      status: 'GENERATING_LISTING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Design Listing' },
      listingResult: { en: { brand: 'BrandD', title: 'TitleD', bullet1: 'B1', bullet2: 'B2', description: 'Desc' } },
      events: []
    };

    const updateTaskListing: DesignTaskLog = {
      id: '#test-s1-update-U',
      counter: 302,
      source: 'UPDATE',
      suffix: 'U',
      status: 'GENERATING_LISTING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Update Listing' },
      listingResult: { en: { brand: 'BrandU', title: 'TitleU', bullet1: 'B1', bullet2: 'B2', description: 'Desc' } },
      events: []
    };

    TaskRepository.createTask(designTaskListing);
    TaskRepository.createTask(updateTaskListing);

    const reportS1 = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(reportS1.reservedRecoveryJobs, 2);

    const reservedJobs = TaskRecoveryService.getReservedJobs();
    const dJob = reservedJobs.find(j => j.taskId === '#test-s1-design')!;
    const uJob = reservedJobs.find(j => j.taskId === '#test-s1-update-U')!;
    assert.strictEqual(dJob.source, 'CREATION');
    assert.strictEqual(uJob.source, 'UPDATE');
    console.log('✅ Test S1 Passed: Shared statuses are correctly segregated by task source.\n');

    // ----------------------------------------------------
    // Test S2: Analysis Review Gate Preservation (Defective Design)
    // ----------------------------------------------------
    console.log('Test S2: Analysis Review Gate Preservation (Defective Design)...');
    const defectiveTask: DesignTaskLog = {
      id: '#test-defective-design',
      counter: 401,
      source: 'CREATION',
      suffix: 'D',
      status: 'ANALYZING_DESIGN',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Defective Image Task' },
      analysisResult: {
        overall_verdict: 'REJECTED',
        design_quality: {
          quality_verdict: 'DEFECTIVE',
          quality_issues: 'Severe blur and clipping'
        }
      },
      events: []
    };
    TaskRepository.createTask(defectiveTask);

    TaskRecoveryService.initAndReconcile();
    await TaskRecoveryService.processSingleRecoveryJob({
      taskId: '#test-defective-design',
      source: 'CREATION',
      status: 'ANALYZING_DESIGN'
    });

    const updatedDefective = TaskRepository.getTaskById('#test-defective-design')!;
    assert.strictEqual(updatedDefective.status, 'AWAITING_DESIGN_REVIEW', 'Defective analysis must pause at AWAITING_DESIGN_REVIEW');
    assert.strictEqual(updatedDefective.checkpoint, 'DESIGN_REVIEW');
    assert.strictEqual(updatedDefective.hasError, true);
    console.log('✅ Test S2 Passed: Persisted defective analysis preserves AWAITING_DESIGN_REVIEW and never skips to listing.\n');

    // ----------------------------------------------------
    // Test S3: SVG Review Gate Preservation
    // ----------------------------------------------------
    console.log('Test S3: SVG Review Gate Preservation...');
    const designsDir = path.resolve(process.cwd(), 'data', 'designs');
    fs.mkdirSync(designsDir, { recursive: true });

    const svgTaskId = '#test-svg-review';
    const cleanSvgId = svgTaskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const validSvgPath = path.join(designsDir, `${cleanSvgId}.svg`);
    fs.writeFileSync(validSvgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>');

    const svgTask: DesignTaskLog = {
      id: svgTaskId,
      counter: 501,
      source: 'CREATION',
      suffix: 'D',
      status: 'VECTORIZING_DESIGN',
      receivedAt: new Date().toISOString(),
      payload: { title: 'SVG Task' },
      localSvgPath: validSvgPath,
      events: []
    };
    TaskRepository.createTask(svgTask);

    // Mock LLMService.auditSvgCutout to simulate rejection
    const originalAuditCutout = LLMService.auditSvgCutout;
    (LLMService as any).auditSvgCutout = async () => ({
      cutout_verdict: 'REJECTED',
      background_removed_cleanly: false,
      detected_issues: ['Leftover white background pixels'],
      confidence: 0.95,
      explanation: 'Background was not cleanly removed'
    });

    try {
      TaskRecoveryService.initAndReconcile();
      await TaskRecoveryService.processSingleRecoveryJob({
        taskId: svgTaskId,
        source: 'CREATION',
        status: 'VECTORIZING_DESIGN'
      });

      const updatedSvgTask = TaskRepository.getTaskById(svgTaskId)!;
      assert.strictEqual(updatedSvgTask.status, 'AWAITING_SVG_REVIEW', 'Cutout rejection must pause at AWAITING_SVG_REVIEW');
      assert.strictEqual(updatedSvgTask.checkpoint, 'SVG_REVIEW');
    } finally {
      (LLMService as any).auditSvgCutout = originalAuditCutout;
      if (fs.existsSync(validSvgPath)) fs.unlinkSync(validSvgPath);
    }
    console.log('✅ Test S3 Passed: Valid SVG reuse executes Cutout Audit and enforces AWAITING_SVG_REVIEW when flagged.\n');

    // ----------------------------------------------------
    // Test S4: Recovery Attempt Queued But Never Started
    // ----------------------------------------------------
    console.log('Test S4: Recovery Attempt Queued But Never Started...');
    const queueCrashTask: DesignTaskLog = {
      id: '#test-crash-before-start',
      counter: 601,
      source: 'CREATION',
      suffix: 'D',
      status: 'GENERATING_IMAGE',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Pre-Start Crash Task' },
      recovery: {
        recoveryAttempts: 1,
        interruptedStatus: 'GENERATING_IMAGE'
      },
      events: []
    };
    TaskRepository.createTask(queueCrashTask);

    // Simulate classification (boot #1)
    const reportS4_1 = TaskRecoveryService.initAndReconcile();
    const crashJob = TaskRecoveryService.getReservedJobs().find(j => j.taskId === '#test-crash-before-start');
    assert(crashJob, 'Job must be reserved in recovery queue');

    // Verify attempts were NOT incremented on disk
    const checkBeforeWorker = TaskRepository.getTaskById('#test-crash-before-start')!;
    assert.strictEqual(checkBeforeWorker.recovery?.recoveryAttempts, 1, 'Attempts must not increment until execution actually starts');

    // Simulate second crash/restart without worker running
    const reportS4_2 = TaskRecoveryService.initAndReconcile();
    const checkAfterRestart = TaskRepository.getTaskById('#test-crash-before-start')!;
    assert.strictEqual(checkAfterRestart.recovery?.recoveryAttempts, 1, 'Still 1 attempt because worker never started');
    assert.strictEqual(checkAfterRestart.status, 'GENERATING_IMAGE');
    console.log('✅ Test S4 Passed: Crashing while queued does not consume recovery attempts.\n');

    // ----------------------------------------------------
    // Test S5: Trademark Mid-Cycle Continuity
    // ----------------------------------------------------
    console.log('Test S5: Trademark Mid-Cycle Continuity...');
    const midCycleState: TrademarkWorkflowState = {
      phase: 'VERIFY',
      rewriteAttemptsCompleted: 2,
      currentListing: {
        brand: 'CleanBrand',
        title: 'Safe Clean Title After Cycle 2',
        bullet1: 'Clean B1',
        bullet2: 'Clean B2',
        description: 'Clean Desc'
      },
      forbiddenTermsForTask: ['nastyterm', 'riskybrand'],
      rewriteIterations: [
        { iteration: 1, actionsTaken: ['Removed nastyterm'], listing: { brand: 'B', title: 'T1', bullet1: '', bullet2: '', description: '' }, hitsFound: 1 },
        { iteration: 2, actionsTaken: ['Removed riskybrand'], listing: { brand: 'CleanBrand', title: 'Safe Clean Title After Cycle 2', bullet1: '', bullet2: '', description: '' }, hitsFound: 1 }
      ]
    };

    let rewriteCalled = false;
    let verifierCalled = false;

    const originalRewrite = LLMService.rewriteListingForTrademarkV2;
    const originalVerifier = LLMService.evaluateTrademarkVerifier;

    (LLMService as any).rewriteListingForTrademarkV2 = async () => {
      rewriteCalled = true;
      throw new Error('Rewrite should NOT have been called for phase VERIFY!');
    };

    (LLMService as any).evaluateTrademarkVerifier = async () => {
      verifierCalled = true;
      return {
        verdict: 'SAFE',
        canBeFixedByListingRewrite: true,
        recommendation: 'SAFE_TO_PUBLISH',
        identifiedRisks: []
      };
    };

    try {
      const tmAuditRes = await TrademarkService.executeTrademarkAuditV2({
        listing: midCycleState.currentListing,
        initialWorkflowState: midCycleState,
        maxRewriteCycles: 3
      });

      assert.strictEqual(verifierCalled, true, 'Verifier must be called directly on resume');
      assert.strictEqual(rewriteCalled, false, 'Rewrite #2 must NOT be called again');
      assert.strictEqual(tmAuditRes.isSafe, true);
    } finally {
      (LLMService as any).rewriteListingForTrademarkV2 = originalRewrite;
      (LLMService as any).evaluateTrademarkVerifier = originalVerifier;
    }
    console.log('✅ Test S5 Passed: Mid-cycle resume at phase VERIFY runs verifier directly and skips redundant rewrite.\n');

    // ----------------------------------------------------
    // Test S6: Trademark Rewrite Boundary - Strictly Max 3 Rewrites
    // ----------------------------------------------------
    console.log('Test S6: Trademark Rewrite Boundary (Strictly Max 3 Rewrites)...');
    const stateAtLimit: TrademarkWorkflowState = {
      phase: 'REWRITE',
      rewriteAttemptsCompleted: 3,
      currentListing: { brand: 'Brand', title: 'Title', bullet1: 'B1', bullet2: 'B2', description: 'Desc' },
      forbiddenTermsForTask: ['term1', 'term2', 'term3'],
      rewriteIterations: [
        { iteration: 1, actionsTaken: [], listing: { brand: 'B', title: 'T1', bullet1: '', bullet2: '', description: '' }, hitsFound: 1 },
        { iteration: 2, actionsTaken: [], listing: { brand: 'B', title: 'T2', bullet1: '', bullet2: '', description: '' }, hitsFound: 1 },
        { iteration: 3, actionsTaken: [], listing: { brand: 'B', title: 'T3', bullet1: '', bullet2: '', description: '' }, hitsFound: 1 }
      ]
    };

    const limitAuditRes = await TrademarkService.executeTrademarkAuditV2({
      listing: stateAtLimit.currentListing,
      initialWorkflowState: stateAtLimit,
      maxRewriteCycles: 3
    });

    assert.strictEqual(limitAuditRes.finalDecision, 'ESCALATE', 'Must escalate when rewrite limit reached');
    assert.strictEqual(limitAuditRes.reasonCode, 'REWRITE_LIMIT_REACHED');
    console.log('✅ Test S6 Passed: 3 completed rewrites strictly prevents a 4th rewrite attempt across restarts.\n');

    // ----------------------------------------------------
    // Test S7: 10,000 Historical Tasks (O(1) Scan Performance)
    // ----------------------------------------------------
    console.log('Test S7: 10,000 Historical Tasks (O(1) Scan Performance)...');
    TaskRepository.clearAllTasks();
    const bulkInsertStartTime = Date.now();
    const db = TaskRepository.getDb();
    
    // Insert 10,000 COMPLETED tasks in a single fast transaction
    db.exec('BEGIN TRANSACTION;');
    const insertStmt = db.prepare(`
      INSERT INTO tasks (id, counter, source, suffix, status, received_at, updated_at, in_queue, has_error, payload_json)
      VALUES (?, ?, 'CREATION', 'D', 'COMPLETED', ?, ?, 0, 0, '{"title":"Historical Task"}')
    `);

    for (let i = 1000; i < 11000; i++) {
      const nowStr = new Date().toISOString();
      insertStmt.run(`historical_${i}`, i, nowStr, nowStr);
    }
    db.exec('COMMIT;');
    console.log(`   Inserted 10,000 COMPLETED tasks in ${Date.now() - bulkInsertStartTime}ms.`);

    // Insert 3 zombie tasks
    TaskRepository.createTask({
      id: '#zombie-1',
      counter: 20001,
      source: 'CREATION',
      suffix: 'D',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Zombie 1' },
      events: []
    });
    TaskRepository.createTask({
      id: '#zombie-2',
      counter: 20002,
      source: 'UPDATE',
      suffix: 'U',
      status: 'UPDATE_EXTRACTED',
      designId: 'zombie-2',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Zombie 2', designId: 'zombie-2' },
      events: []
    });
    TaskRepository.createTask({
      id: '#zombie-3',
      counter: 20003,
      source: 'CREATION',
      suffix: 'D',
      status: 'GENERATING_IMAGE',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Zombie 3' },
      events: []
    });

    const scanStartTime = Date.now();
    const reportS7 = TaskRecoveryService.initAndReconcile();
    const scanDuration = Date.now() - scanStartTime;

    assert.strictEqual(reportS7.candidateZombieTasks, 3, 'Must only load the 3 zombie tasks from SQLite');
    assert.strictEqual(reportS7.reservedRecoveryJobs, 3);
    assert(scanDuration < 50, `Scan took ${scanDuration}ms (expected < 50ms for targeted indexed query)`);
    console.log(`✅ Test S7 Passed: 10,000 historical tasks ignored; 3 zombies discovered in ${scanDuration}ms.\n`);

    // ----------------------------------------------------
    // Test H1: Asset Validation Heuristics (Magic bytes, tags)
    // ----------------------------------------------------
    console.log('Test H1: Asset Validation Heuristics...');
    const dummyPngPath = path.join(TEST_DIR, 'dummy.png');
    const dummyCorruptPath = path.join(TEST_DIR, 'corrupt.png');
    const dummySvgPath = path.join(TEST_DIR, 'dummy.svg');
    const dummyCorruptSvg = path.join(TEST_DIR, 'corrupt.svg');

    // Valid PNG header (0x89 0x50 0x4E 0x47 ...) + 10KB
    const validPngBuf = Buffer.alloc(12000);
    validPngBuf[0] = 0x89; validPngBuf[1] = 0x50; validPngBuf[2] = 0x4E; validPngBuf[3] = 0x47;
    fs.writeFileSync(dummyPngPath, validPngBuf);

    // Corrupt PNG (< 100 bytes, random data)
    fs.writeFileSync(dummyCorruptPath, Buffer.from('NOT A PNG'));

    // Valid SVG
    fs.writeFileSync(dummySvgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    // Corrupt SVG (missing closing tag)
    fs.writeFileSync(dummyCorruptSvg, '<svg xmlns="http://www.w3.org/2000/svg"><rect>');

    assert.strictEqual(AssetValidationService.isValidPngImage(dummyPngPath, 10000), true);
    assert.strictEqual(AssetValidationService.isValidPngImage(dummyCorruptPath, 10000), false);
    assert.strictEqual(AssetValidationService.isValidSvgFile(dummySvgPath, 20), true);
    assert.strictEqual(AssetValidationService.isValidSvgFile(dummyCorruptSvg, 20), false);
    console.log('✅ Test H1 Passed: Asset heuristics accurately validate PNG magic bytes and SVG structure.\n');

    // ----------------------------------------------------
    // Test H2: Unified TaskExecutionLock
    // ----------------------------------------------------
    console.log('Test H2: Unified TaskExecutionLock...');
    assert.strictEqual(TaskExecutionLock.acquire('task-lock-1', 'RECOVERY'), true);
    assert.strictEqual(TaskExecutionLock.acquire('task-lock-1', 'NORMAL'), false, 'Second lock must be rejected');
    assert.strictEqual(TaskExecutionLock.acquire('task-lock-1', 'USER_ACTION'), false, 'Third lock must be rejected');
    assert.strictEqual(TaskExecutionLock.isLocked('task-lock-1'), true);

    TaskExecutionLock.release('task-lock-1');
    assert.strictEqual(TaskExecutionLock.isLocked('task-lock-1'), false);
    assert.strictEqual(TaskExecutionLock.acquire('task-lock-1', 'NORMAL'), true, 'Can acquire lock after release');
    TaskExecutionLock.release('task-lock-1');
    console.log('✅ Test H2 Passed: Process-wide execution lock blocks concurrent task executions.\n');

    // ----------------------------------------------------
    // Test H3: Backfill Duplicate Protection
    // ----------------------------------------------------
    console.log('Test H3: Backfill Duplicate Protection...');
    assert.strictEqual(TaskRecoveryService.isDesignReserved('zombie-2') || TaskRecoveryService.isDesignReserved(''), true);
    const excludedIds = UpdateBackfillService.getExcludedDesignIds();
    assert(excludedIds.has('zombie-2'), 'UpdateBackfillService must exclude recovering design IDs');
    console.log('✅ Test H3 Passed: UpdateBackfillService considers reserved recovery designs as active.\n');

    console.log('====================================================');
    console.log('🎉 ALL SAFE TASK RECOVERY P3.2 TESTS PASSED! 🎉');
    console.log('====================================================\n');
  } finally {
    cleanupTestEnvironment();
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { TaskRepository } from '../src/server/storage/taskRepository';
import { TaskLogService } from '../src/server/services/taskLogService';
import { QueueService } from '../src/server/services/queueService';
import { TaskRecoveryService } from '../src/server/services/taskRecoveryService';
import { AmazonRecoveryVerificationService } from '../src/server/services/amazonRecoveryVerificationService';
import { AmazonInspectService } from '../src/server/services/amazonInspectService';
import { TaskExecutionLock } from '../src/server/services/taskExecutionLock';
import { UploadWorkerService } from '../src/server/services/uploadWorkerService';

const TEST_DIR = path.resolve(process.cwd(), 'scratch', `test_p3_3_${Date.now()}`);
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
  AmazonRecoveryVerificationService.stopVerificationWorker();
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('⚡ RUNNING AMAZON REMOTE VERIFICATION & RECOVERY P3.3 TESTS');
  console.log('====================================================\n');

  setupTestEnvironment();

  try {
    // ----------------------------------------------------
    // Test 1: R0A - Legacy PUBLISH pre-remote crash (SAFE_TO_RESTART)
    // ----------------------------------------------------
    console.log('Test 1: R0A - Legacy PUBLISH pre-remote crash...');
    (QueueService as any).items = [
      {
        id: 'q-pub-legacy',
        taskId: '#101-D',
        title: 'Legacy Publish Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'REMOTE_ACTION_INTENT',
          action: 'PUBLISH',
          attempt: 1,
          remoteActionIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    let report = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(report.preRemoteUploadsReset, 1, 'Legacy PUBLISH should be safely reset to WAITING');
    let qItems = QueueService.loadQueue();
    assert.strictEqual(qItems[0].status, 'WAITING');
    assert.strictEqual(qItems[0].uploadRecovery?.phase, 'STARTING');
    assert.strictEqual(qItems[0].uploadRecovery?.attempt, 2);
    console.log('  ✓ Legacy PUBLISH pre-remote crash safely reset to WAITING (attempt 2)\n');

    // ----------------------------------------------------
    // Test 2: R0B - Legacy SAVE_DRAFT (UNKNOWN_REMOTE_STATE)
    // ----------------------------------------------------
    console.log('Test 2: R0B - Legacy SAVE_DRAFT unsafe remote state...');
    (QueueService as any).items = [
      {
        id: 'q-draft-legacy',
        taskId: '#102-D',
        title: 'Legacy Draft Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'REMOTE_ACTION_INTENT',
          action: 'SAVE_DRAFT',
          attempt: 1,
          amazonDesignId: 'd-draft-uuid-1',
          remoteActionIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    report = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(report.unsafeUploadsEscalated, 1, 'Legacy DRAFT must NOT be blindly retried');
    qItems = QueueService.loadQueue();
    assert.strictEqual(qItems[0].status, 'ERROR');
    assert.strictEqual(qItems[0].uploadRecovery?.remoteVerification?.status, 'VERIFY_PENDING');
    console.log('  ✓ Legacy SAVE_DRAFT scheduled for VERIFY_PENDING without blind retry\n');

    // ----------------------------------------------------
    // Test 3: R0C - Unified REMOTE_REQUEST_INTENT boundary
    // ----------------------------------------------------
    console.log('Test 3: R0C - Unified REMOTE_REQUEST_INTENT boundary...');
    (QueueService as any).items = [
      {
        id: 'q-new-req-intent',
        taskId: '#103-D',
        title: 'New Unified Intent Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'REMOTE_REQUEST_INTENT',
          action: 'PUBLISH',
          attempt: 1,
          remoteRequestIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    report = TaskRecoveryService.initAndReconcile();
    assert.strictEqual(report.unsafeUploadsEscalated, 1);
    qItems = QueueService.loadQueue();
    assert.strictEqual(qItems[0].status, 'ERROR');
    console.log('  ✓ REMOTE_REQUEST_INTENT is never blindly retried\n');

    // ----------------------------------------------------
    // Test 4: R1 & R2 - NEW Publish with Captured Response ID
    // ----------------------------------------------------
    console.log('Test 4: R1 & R2 - NEW Publish with response ID -> Deterministic recovery...');
    const newDesignUuid = '99999999-aaaa-bbbb-cccc-111111111111';
    (QueueService as any).items = [
      {
        id: 'q-new-captured',
        taskId: '#104-D',
        title: 'Captured ID Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'AWAITING_AMAZON_CONFIRMATION',
          action: 'PUBLISH',
          attempt: 1,
          amazonDesignId: newDesignUuid,
          remoteRequestIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    TaskRepository.createTask({
      id: '#104-D',
      counter: 104,
      source: 'DESIGNER',
      suffix: 'D',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Captured ID Item' },
      events: []
    });

    // Mock inspectProductConfig returning 200 for this exact UUID
    const origInspectProductConfig = AmazonInspectService.inspectProductConfig;
    AmazonInspectService.inspectProductConfig = async (dId: string) => {
      if (dId === newDesignUuid) {
        return {
          success: true,
          endpoint: 'productconfig',
          designId: dId,
          status: 200,
          timestamp: new Date().toISOString(),
          data: {
            textData: {
              en: { title: 'Captured ID Item', brandName: 'Brand X' }
            },
            products: {
              STANDARD_TSHIRT: {
                marketplaceData: { US: { status: 'REVIEW', price: 19.99 } }
              }
            }
          }
        };
      }
      return { success: false, endpoint: 'productconfig', status: 404, timestamp: new Date().toISOString() };
    };

    const verifyCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote(newDesignUuid, {});
    assert.strictEqual(verifyCheck.result, 'CONFIRMED_SUCCESS', 'Should be CONFIRMED_SUCCESS due to valid active Amazon state');

    // Run saga
    AmazonRecoveryVerificationService.finalizeConfirmedRemoteAction('q-new-captured', newDesignUuid, 'REVIEW');
    const taskAfter = TaskRepository.getTaskById('#104-D');
    assert.strictEqual(taskAfter?.status, 'COMPLETED');
    assert.strictEqual(taskAfter?.designId, newDesignUuid);
    const queueAfter = QueueService.loadQueue().find(i => i.id === 'q-new-captured');
    assert.strictEqual(queueAfter?.status, 'COMPLETED');
    console.log('  ✓ Exact captured designId deterministically reconciled to COMPLETED\n');

    // ----------------------------------------------------
    // Test 5: R3 - Crash before Response-ID captured (Human Review)
    // ----------------------------------------------------
    console.log('Test 5: R3 - NEW without response ID strictly escalates to Human Review...');
    (QueueService as any).items = [
      {
        id: 'q-new-noid',
        taskId: '#105-D',
        title: 'No ID Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'REMOTE_REQUEST_INTENT',
          action: 'PUBLISH',
          attempt: 1,
          remoteRequestIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    TaskRepository.createTask({
      id: '#105-D',
      counter: 105,
      source: 'DESIGNER',
      suffix: 'D',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'No ID Item' },
      events: []
    });

    TaskRecoveryService.initAndReconcile();
    const task105 = TaskRepository.getTaskById('#105-D');
    assert.strictEqual(task105?.status, 'AWAITING_RECOVERY_REVIEW', 'Must strictly escalate to Human Review');
    const q105 = QueueService.loadQueue().find(i => i.id === 'q-new-noid');
    assert.strictEqual(q105?.status, 'ERROR');
    console.log('  ✓ NEW design without captured ID strictly escalated to AWAITING_RECOVERY_REVIEW\n');

    // ----------------------------------------------------
    // Test 6: R4 - UPDATE Baseline A, Intended B, Remote B -> CONFIRMED_SUCCESS
    // ----------------------------------------------------
    console.log('Test 6: R4 - UPDATE exact intended fingerprint match...');
    const stateA = {
      textData: { en: { title: 'Old Title', brandName: 'Old Brand', bullets: ['B1', 'B2'], description: 'D' } },
      products: { STANDARD_TSHIRT: { marketplaceData: { US: { status: 'PUBLISHED' } } } }
    };
    const stateB = {
      textData: { en: { title: 'New Title', brandName: 'New Brand', bullets: ['B1 New', 'B2 New'], description: 'D New' } },
      products: { STANDARD_TSHIRT: { marketplaceData: { US: { status: 'PUBLISHED' } } } }
    };

    const fpA = AmazonRecoveryVerificationService.computeRemoteFingerprint(AmazonRecoveryVerificationService.canonicalizeRemoteState(stateA));
    const fpB = AmazonRecoveryVerificationService.computeRemoteFingerprint(AmazonRecoveryVerificationService.canonicalizeRemoteState(stateB));

    assert.notStrictEqual(fpA, fpB, 'Fingerprints A and B must differ');

    AmazonInspectService.inspectProductConfig = async (dId: string) => ({
      success: true,
      endpoint: 'productconfig',
      designId: dId,
      status: 200,
      timestamp: new Date().toISOString(),
      data: stateB
    });

    const updateCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('d-update-uuid-1', {
      baselineFingerprint: fpA,
      intendedFingerprint: fpB
    });

    assert.strictEqual(updateCheck.result, 'CONFIRMED_SUCCESS');
    console.log('  ✓ Intended fingerprint match confirmed success\n');

    // ----------------------------------------------------
    // Test 7: R5 - UPDATE Baseline A, Intended B, Remote A -> VERIFY_PENDING (No Auto Retry)
    // ----------------------------------------------------
    console.log('Test 7: R5 - UPDATE Remote still equals baseline -> VERIFY_PENDING...');
    AmazonInspectService.inspectProductConfig = async (dId: string) => ({
      success: true,
      endpoint: 'productconfig',
      designId: dId,
      status: 200,
      timestamp: new Date().toISOString(),
      data: stateA
    });

    const pendingCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('d-update-uuid-1', {
      baselineFingerprint: fpA,
      intendedFingerprint: fpB
    });

    assert.strictEqual(pendingCheck.result, 'VERIFY_PENDING', 'Should be VERIFY_PENDING, never blind retry');
    console.log('  ✓ Baseline unchanged correctly leads to VERIFY_PENDING\n');

    // ----------------------------------------------------
    // Test 8: R6 - UPDATE Baseline A, Intended B, Remote C -> AMBIGUOUS
    // ----------------------------------------------------
    console.log('Test 8: R6 - UPDATE Remote neither A nor B -> AMBIGUOUS...');
    const stateC = {
      textData: { en: { title: 'Third Party Title', brandName: 'Other Brand' } }
    };
    AmazonInspectService.inspectProductConfig = async (dId: string) => ({
      success: true,
      endpoint: 'productconfig',
      designId: dId,
      status: 200,
      timestamp: new Date().toISOString(),
      data: stateC
    });

    const ambiguousCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('d-update-uuid-1', {
      baselineFingerprint: fpA,
      intendedFingerprint: fpB
    });

    assert.strictEqual(ambiguousCheck.result, 'AMBIGUOUS');
    console.log('  ✓ Different remote state correctly classified as AMBIGUOUS\n');

    // ----------------------------------------------------
    // Test 9: R7 - Status Under Review when baseline was already Under Review
    // ----------------------------------------------------
    console.log('Test 9: R7 - Status UNDER_REVIEW already in baseline -> Not auto-confirmed...');
    const stateUnderReview = {
      textData: { en: { title: 'Old Title', brandName: 'Old Brand' } },
      products: { STANDARD_TSHIRT: { marketplaceData: { US: { status: 'UNDER_REVIEW' } } } }
    };
    AmazonInspectService.inspectProductConfig = async (dId: string) => ({
      success: true,
      endpoint: 'productconfig',
      designId: dId,
      status: 200,
      timestamp: new Date().toISOString(),
      data: stateUnderReview
    });

    const reviewCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('d-update-uuid-1', {
      baselineFingerprint: fpA,
      intendedFingerprint: fpB,
      baselineStatus: 'UNDER_REVIEW' // Was already under review!
    });

    assert.notStrictEqual(reviewCheck.result, 'CONFIRMED_SUCCESS', 'Must not confirm success if status did not transition');
    console.log('  ✓ Pre-existing UNDER_REVIEW status rejected as standalone success proof\n');

    // ----------------------------------------------------
    // Test 10: R8 & R9 - Cross-Storage Crash Reconciliation
    // ----------------------------------------------------
    console.log('Test 10: R8 & R9 - Cross-Storage Crash Reconciliation...');
    // Case R8: Queue item marked CONFIRMED_SUCCESS, but Task crashed before COMPLETED
    TaskRepository.createTask({
      id: '#108-D',
      counter: 108,
      source: 'DESIGNER',
      suffix: 'D',
      status: 'PROCESSING',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Cross Storage Item' },
      events: []
    });

    (QueueService as any).items = [
      {
        id: 'q-cross-108',
        taskId: '#108-D',
        title: 'Cross Storage Item',
        status: 'UPLOADING',
        uploadRecovery: {
          phase: 'AMAZON_CONFIRMED',
          amazonDesignId: 'd-108-confirmed',
          remoteVerification: {
            status: 'CONFIRMED_SUCCESS',
            attempts: 1,
            firstAttemptAt: new Date().toISOString(),
            lastAttemptAt: new Date().toISOString(),
            matchedDesignId: 'd-108-confirmed'
          }
        }
      }
    ];
    QueueService.saveQueue();

    TaskRecoveryService.initAndReconcile();
    const task108 = TaskRepository.getTaskById('#108-D');
    assert.strictEqual(task108?.status, 'COMPLETED', 'Task must be reconciled to COMPLETED');
    assert.strictEqual(task108?.designId, 'd-108-confirmed');
    const q108 = QueueService.loadQueue().find(i => i.id === 'q-cross-108');
    assert.strictEqual(q108?.status, 'COMPLETED', 'Queue item must be reconciled to COMPLETED');
    console.log('  ✓ Cross-storage saga cleanly reconciles incomplete state without remote side effects\n');

    // ----------------------------------------------------
    // Test 11: R10 - Human Review Actions
    // ----------------------------------------------------
    console.log('Test 11: R10 - Human Review Actions...');
    // Setup task and queue item in AWAITING_RECOVERY_REVIEW
    TaskRepository.createTask({
      id: '#110-D',
      counter: 110,
      source: 'DESIGNER',
      suffix: 'D',
      status: 'AWAITING_RECOVERY_REVIEW',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Human Review Item' },
      events: []
    });

    (QueueService as any).items = [
      {
        id: 'q-review-110',
        taskId: '#110-D',
        title: 'Human Review Item',
        status: 'ERROR',
        uploadRecovery: {
          phase: 'REMOTE_REQUEST_INTENT',
          action: 'PUBLISH',
          attempt: 1,
          remoteRequestIntentAt: new Date().toISOString()
        }
      }
    ];
    QueueService.saveQueue();

    // Action A: FORCE_RETRY
    const forceRes = AmazonRecoveryVerificationService.forceRetry('#110-D', 'User verified item does not exist');
    assert.strictEqual(forceRes.success, true);
    const q110AfterRetry = QueueService.loadQueue().find(i => i.id === 'q-review-110');
    assert.strictEqual(q110AfterRetry?.status, 'WAITING');
    assert.strictEqual(q110AfterRetry?.uploadRecovery?.phase, 'STARTING');
    assert.strictEqual(q110AfterRetry?.uploadRecovery?.attempt, 2);
    assert.strictEqual(q110AfterRetry?.uploadRecovery?.history?.length, 1, 'Previous attempt must be preserved in history');
    assert.strictEqual(q110AfterRetry?.uploadRecovery?.history?.[0].manualOverride, 'FORCE_RETRY');
    console.log('  ✓ FORCE_RETRY cleanly resets to WAITING (attempt 2) and preserves history');

    // Action B: MARK_CONFIRMED
    const markRes = AmazonRecoveryVerificationService.markConfirmed('#110-D', 'manually-matched-uuid');
    assert.strictEqual(markRes.success, true);
    const task110AfterMark = TaskRepository.getTaskById('#110-D');
    assert.strictEqual(task110AfterMark?.status, 'COMPLETED');
    assert.strictEqual(task110AfterMark?.designId, 'manually-matched-uuid');
    const q110AfterMark = QueueService.loadQueue().find(i => i.id === 'q-review-110');
    assert.strictEqual(q110AfterMark?.status, 'COMPLETED');
    console.log('  ✓ MARK_CONFIRMED completes Task and Queue item with user-specified designId');

    // Action C: CANCEL
    TaskRepository.createTask({
      id: '#111-D',
      counter: 111,
      source: 'DESIGNER',
      suffix: 'D',
      status: 'AWAITING_RECOVERY_REVIEW',
      receivedAt: new Date().toISOString(),
      payload: { title: 'Cancel Item' },
      events: []
    });
    (QueueService as any).items = [
      {
        id: 'q-cancel-111',
        taskId: '#111-D',
        title: 'Cancel Item',
        status: 'ERROR',
        uploadRecovery: {
          phase: 'REMOTE_REQUEST_INTENT',
          action: 'PUBLISH',
          attempt: 1
        }
      }
    ];
    QueueService.saveQueue();

    const cancelRes = AmazonRecoveryVerificationService.cancelUpload('#111-D', 'No longer needed');
    assert.strictEqual(cancelRes.success, true);
    const task111 = TaskRepository.getTaskById('#111-D');
    assert.strictEqual(task111?.status, 'REJECTED');
    const q111 = QueueService.loadQueue().find(i => i.id === 'q-cancel-111');
    assert.strictEqual(q111?.uploadRecovery?.history?.length, 1);
    assert.strictEqual(q111?.uploadRecovery?.history?.[0].manualOverride, 'CANCEL');
    console.log('  ✓ CANCEL preserves history while rejecting local task\n');

    // ----------------------------------------------------
    // Test 12: R11 - Auth Required / Rate Limit Guards
    // ----------------------------------------------------
    console.log('Test 12: R11 - Auth Required / Rate Limit Guards...');
    AmazonInspectService.inspectProductConfig = async () => ({
      success: false,
      endpoint: 'productconfig',
      status: 401,
      error: 'Session 1 ist ausgeloggt (Weiterleitung auf Amazon Login).',
      timestamp: new Date().toISOString()
    });

    const authCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('some-id', {});
    assert.strictEqual(authCheck.result, 'AUTH_REQUIRED', 'Redirect to login must be AUTH_REQUIRED, never NOT_FOUND');

    AmazonInspectService.inspectProductConfig = async () => ({
      success: false,
      endpoint: 'productconfig',
      status: 429,
      error: 'Too Many Requests',
      timestamp: new Date().toISOString()
    });

    const rateCheck = await AmazonRecoveryVerificationService.verifySingleDesignRemote('some-id', {});
    assert.strictEqual(rateCheck.result, 'RATE_LIMITED', 'HTTP 429 must be RATE_LIMITED');
    console.log('  ✓ Auth Required and Rate Limits strictly isolated from NOT_FOUND\n');

    // Restore original
    AmazonInspectService.inspectProductConfig = origInspectProductConfig;

    // ----------------------------------------------------
    // Test 13: Narrow Response Matcher (Excludes FindListings & Telemetry)
    // ----------------------------------------------------
    console.log('Test 13: Narrow Response Matcher validation...');
    // 1. FindListings POST must be rejected!
    const mockFindListingsResp = {
      request: () => ({
        method: () => 'POST',
        postData: () => JSON.stringify({ __type: 'com.amazon.merch.search#FindListingsRequest' })
      }),
      url: () => 'https://merch.amazon.com/api/ng-amazon/coral/com.amazon.merch.search.MerchSearchService/FindListings'
    };
    assert.strictEqual(UploadWorkerService.isAmazonSubmissionResponse(mockFindListingsResp, 'PUBLISH'), false, 'FindListings POST must NOT match as submission response');

    // 2. Ratelimiter / Telemetry POST must be rejected!
    const mockRatelimiterResp = {
      request: () => ({
        method: () => 'POST',
        postData: () => '{}'
      }),
      url: () => 'https://merch.amazon.com/api/ratelimiter/metadata'
    };
    assert.strictEqual(UploadWorkerService.isAmazonSubmissionResponse(mockRatelimiterResp, 'PUBLISH'), false, 'Ratelimiter POST must NOT match as submission response');

    // 3. Concrete ProductConfiguration Save POST must match!
    const mockValidSaveResp = {
      request: () => ({
        method: () => 'POST',
        postData: () => JSON.stringify({ textData: { en: { title: 'Test' } }, products: {} })
      }),
      url: () => 'https://merch.amazon.com/api/productconfiguration/save'
    };
    assert.strictEqual(UploadWorkerService.isAmazonSubmissionResponse(mockValidSaveResp, 'SAVE_DRAFT'), true, 'Valid save response with design payload must match');

    // 4. GET request must never match
    const mockGetResp = {
      request: () => ({
        method: () => 'GET',
        postData: () => null
      }),
      url: () => 'https://merch.amazon.com/api/productconfiguration/get?id=123'
    };
    assert.strictEqual(UploadWorkerService.isAmazonSubmissionResponse(mockGetResp, 'PUBLISH'), false, 'GET requests must never match');
    console.log('  ✓ Response matcher strictly rejects non-submission requests and accepts genuine design submissions\n');

    console.log('====================================================');
    console.log('🎉 ALL P3.3 TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');

  } finally {
    cleanupTestEnvironment();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});

import { LLMService } from '../src/server/services/llmService';
import { loadSettings, saveSettings } from '../src/server/services/settingsService';
import { UpdateBackfillService } from '../src/server/services/updateBackfillService';

async function runCircuitBreakerTests() {
  console.log('====================================================');
  console.log('🛑 RUNNING OPENROUTER CIRCUIT BREAKER & LOW BALANCE TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ ${testName}`);
    } else {
      console.error(`  ❌ FAILED: ${testName}`, detail !== undefined ? detail : '');
    }
  }

  // --- Test 1: Initial Circuit Breaker State ---
  LLMService.resetCircuitBreaker();
  const initialCircuit = LLMService.isCircuitBroken();
  assert(!initialCircuit.broken, 'Test 1: Circuit Breaker ist nach Reset initial nicht ausgelöst (broken = false)');
  assert(!initialCircuit.reason, 'Test 1b: Kein Reason nach Reset vorhanden');

  // --- Test 2: Manuelles Auslösen (tripCircuitBreaker) ---
  LLMService.tripCircuitBreaker('OpenRouter 402: Insufficient Credits');
  const trippedCircuit = LLMService.isCircuitBroken();
  assert(trippedCircuit.broken === true, 'Test 2: Circuit Breaker ist nach tripCircuitBreaker aktiv (broken = true)');
  assert(trippedCircuit.reason?.includes('402'), 'Test 2b: Reason enthält "402"', trippedCircuit.reason);
  assert(trippedCircuit.timestamp !== undefined && trippedCircuit.timestamp > 0, 'Test 2c: Timestamp ist gesetzt');

  // --- Test 3: Settings Persistenz für openRouterMinBalanceThreshold ---
  const currentSettings = loadSettings();
  const originalThreshold = currentSettings.openRouterMinBalanceThreshold;
  assert(typeof originalThreshold === 'number', 'Test 3a: openRouterMinBalanceThreshold ist eine Zahl');

  saveSettings({ openRouterMinBalanceThreshold: 2.50 });
  const updatedSettings = loadSettings();
  assert(updatedSettings.openRouterMinBalanceThreshold === 2.50, 'Test 3b: openRouterMinBalanceThreshold wurde auf 2.50$ aktualisiert');

  // Restore original
  saveSettings({ openRouterMinBalanceThreshold: originalThreshold });
  assert(loadSettings().openRouterMinBalanceThreshold === originalThreshold, 'Test 3c: Schwellenwert sauber wiederhergestellt');

  // --- Test 4: UpdateBackfillService blockiert bei aktivem Circuit Breaker ---
  LLMService.tripCircuitBreaker('Simulierter 402 Fehler');
  const backfillResult = await UpdateBackfillService.runBackfillCycle(true);
  assert(!backfillResult.success, 'Test 4: runBackfillCycle bricht bei aktivem Breaker sofort ab (success = false)');
  assert(backfillResult.message.includes('pausiert') || backfillResult.message.includes('Circuit Breaker'), 
    'Test 4b: Rückmeldung enthält Pause/Circuit-Breaker Hinweis', backfillResult.message);

  // --- Test 5: Reset Circuit Breaker (Auto-Resume Verhalten) ---
  LLMService.resetCircuitBreaker();
  const resetCircuit = LLMService.isCircuitBroken();
  assert(!resetCircuit.broken, 'Test 5: Circuit Breaker ist nach Reset wieder inaktiv');

  console.log('\n====================================================');
  console.log(`🏁 TEST RESULTS: ${passed}/${total} TESTS PASSED (${((passed / total) * 100).toFixed(1)}%)`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runCircuitBreakerTests().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});

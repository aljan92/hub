import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CleanupService } from '../src/server/services/cleanupService';

console.log('[cleanupService.test.ts] 🧪 Starte Tests für CleanupService...');

const REVIEWED_FILE_PATH = path.resolve(process.cwd(), 'data', 'cleanup_reviewed.json');

// Backup original reviewed file if it exists
let backupContent: string | null = null;
if (fs.existsSync(REVIEWED_FILE_PATH)) {
  backupContent = fs.readFileSync(REVIEWED_FILE_PATH, 'utf-8');
}

try {
  // Test 1: Reset list & initial count
  console.log('--- Test 1: Behalten-Liste leeren & initialer Zustand ---');
  CleanupService.clearReviewedList();
  assert.equal(CleanupService.getReviewedCount(), 0, 'Liste muss nach Reset 0 Einträge haben');
  console.log('✅ Test 1 bestanden.');

  // Test 2: Add reviewed IDs and deduplication
  console.log('--- Test 2: IDs hinzufügen & Deduplizierung ---');
  CleanupService.addReviewedIds(['12345', '67890', '12345', '#99999-U']);
  const reviewed = CleanupService.getReviewedIds();
  assert.equal(reviewed.size, 3, 'Deduplizierte IDs müssen genau 3 sein (12345, 67890, 99999)');
  assert.equal(reviewed.has('12345'), true);
  assert.equal(reviewed.has('67890'), true);
  assert.equal(reviewed.has('99999'), true, 'Normalisierung von # und -U muss greifen');
  console.log('✅ Test 2 bestanden.');

  // Test 3: Clear list
  console.log('--- Test 3: Behalten-Liste leeren ---');
  const clearRes = CleanupService.clearReviewedList();
  assert.equal(clearRes.clearedCount, 3, '3 Einträge müssen geleert worden sein');
  assert.equal(CleanupService.getReviewedCount(), 0, 'Zähler muss wieder 0 sein');
  console.log('✅ Test 3 bestanden.');

  // Test 4: Candidate filtering logic simulation
  console.log('--- Test 4: Kandidaten-Filterung & Graceful Empty State ---');
  const mockDatabaseRows = [
    { design_id: '101', title_us: 'Design 1' },
    { design_id: '102', title_us: 'Design 2' },
    { design_id: '103', title_us: 'Design 3' }
  ];

  CleanupService.addReviewedIds(['101', '102']);
  const activeReviewed = CleanupService.getReviewedIds();

  const remaining = mockDatabaseRows.filter(r => !activeReviewed.has(r.design_id));
  assert.equal(remaining.length, 1, 'Nur noch 1 Kandidat (103) darf übrig sein');
  assert.equal(remaining[0].design_id, '103');

  // If all are reviewed
  CleanupService.addReviewedIds(['103']);
  const allReviewedSet = CleanupService.getReviewedIds();
  const remainingZero = mockDatabaseRows.filter(r => !allReviewedSet.has(r.design_id));
  assert.equal(remainingZero.length, 0, '0 Kandidaten übrig wenn alle geprüft sind');
  console.log('✅ Test 4 bestanden.');

  // Test 5: Process batch empty check
  console.log('--- Test 5: Process batch mit leeren Eingaben ---');
  const emptyRes = await CleanupService.processBatch([]);
  assert.equal(emptyRes.success, true);
  assert.equal(emptyRes.totalProcessed, 0);
  console.log('✅ Test 5 bestanden.');

  console.log('\n🎉 Alle CleanupService Tests erfolgreich bestanden!');
} finally {
  // Restore original reviewed file if it existed
  if (backupContent !== null) {
    fs.writeFileSync(REVIEWED_FILE_PATH, backupContent);
  } else if (fs.existsSync(REVIEWED_FILE_PATH)) {
    fs.unlinkSync(REVIEWED_FILE_PATH);
  }
}

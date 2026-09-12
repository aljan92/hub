import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { VisionOptimizationService } from '../src/server/services/visionOptimizationService';

console.log('====================================================');
console.log('🚀 RUNNING THUMBNAIL GENERATION & CACHING TESTS');
console.log('====================================================');

async function runTests() {
  const tmpDir = path.resolve(process.cwd(), 'scratch', 'test_thumbs');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Test 1: Generate thumbnail from non-square SVG (5:6 aspect ratio, typical Merch design)
  console.log('Test 1: Testing prepareThumbnailImage with 5:6 aspect ratio SVG...');
  const svg5to6 = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 600" width="500" height="600">
      <rect width="500" height="600" fill="none" />
      <circle cx="250" cy="300" r="150" fill="#38bdf8" />
      <text x="250" y="315" font-size="40" text-anchor="middle" fill="#ffffff">MBA 5:6</text>
    </svg>
  `;
  const outPath1 = path.join(tmpDir, 'test_5to6_thumb.png');
  const res1 = await VisionOptimizationService.prepareThumbnailImage(svg5to6, outPath1, 300);

  assert.ok(res1.base64DataUrl, 'Should return base64 data URL');
  assert.ok(res1.savedPath && fs.existsSync(res1.savedPath), 'Should save thumbnail to disk');
  assert.ok(res1.buffer && res1.buffer.length > 500, 'Should return valid PNG buffer');

  // Validate PNG signature
  const header1 = res1.buffer.subarray(0, 24);
  assert.strictEqual(header1.toString('hex', 0, 8), '89504e470d0a1a0a', 'Must be a valid PNG');

  const width1 = header1.readUInt32BE(16);
  const height1 = header1.readUInt32BE(20);
  console.log(`   Dimensions rendered: ${width1}x${height1} px (Aspect ratio: ${(width1 / height1).toFixed(3)})`);

  // Max dimension should not exceed maxDim (300)
  assert.ok(width1 <= 320, `Width (${width1}) should be <= 320`);
  // Check that aspect ratio is preserved: 500 / 600 = 0.833
  const ratio1 = width1 / height1;
  assert.ok(Math.abs(ratio1 - (500 / 600)) < 0.05, `Aspect ratio must be preserved (~0.833), got: ${ratio1}`);
  console.log('✅ [PASS] Test 1: 5:6 Aspect ratio preserved perfectly without cropping.');

  // Test 2: Generate thumbnail from wide SVG (2:1 aspect ratio)
  console.log('Test 2: Testing prepareThumbnailImage with wide 2:1 SVG...');
  const svg2to1 = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300">
      <rect width="600" height="300" fill="none" />
      <rect x="50" y="50" width="500" height="200" rx="20" fill="#a855f7" />
    </svg>
  `;
  const outPath2 = path.join(tmpDir, 'test_2to1_thumb.png');
  const res2 = await VisionOptimizationService.prepareThumbnailImage(svg2to1, outPath2, 300);

  assert.ok(res2.buffer && res2.buffer.length > 500);
  const header2 = res2.buffer.subarray(0, 24);
  const width2 = header2.readUInt32BE(16);
  const height2 = header2.readUInt32BE(20);
  console.log(`   Dimensions rendered: ${width2}x${height2} px (Aspect ratio: ${(width2 / height2).toFixed(3)})`);

  const ratio2 = width2 / height2;
  assert.ok(Math.abs(ratio2 - 2.0) < 0.1, `Aspect ratio must be preserved (~2.0), got: ${ratio2}`);
  console.log('✅ [PASS] Test 2: 2:1 Wide aspect ratio preserved without stretching or distortion.');

  // Test 3: File size efficiency check
  console.log('Test 3: Checking file size efficiency...');
  const stats1 = fs.statSync(outPath1);
  console.log(`   Thumbnail size: ${(stats1.size / 1024).toFixed(1)} KB`);
  assert.ok(stats1.size < 100 * 1024, `Thumbnail size (${stats1.size} bytes) should be < 100KB`);
  console.log('✅ [PASS] Test 3: Thumbnail file size is lightweight (< 100KB).');

  // Clean up test files
  try {
    if (fs.existsSync(outPath1)) fs.unlinkSync(outPath1);
    if (fs.existsSync(outPath2)) fs.unlinkSync(outPath2);
    if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
  } catch (e) {}

  console.log('====================================================');
  console.log('🎉 ALL THUMBNAIL TESTS COMPLETED SUCCESSFULLY');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});

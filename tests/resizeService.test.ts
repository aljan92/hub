import fs from 'fs';
import path from 'path';
import { SvgRenderService } from '../src/server/services/svgRenderService';
import { ArtworkResizeService, inject300Dpi } from '../src/server/services/artworkResizeService';

async function runResizeTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING ARTWORK RESIZE SERVICE UNIT & INTEGRATION TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    total++;
    if (condition) {
      console.log(`✅ TEST ${total} PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`❌ TEST ${total} FAILED: ${testName}`);
      if (detail) console.error('   Detail:', detail);
    }
  }

  // Test 1: Verify brush_tip.png resolution
  const brushPath = ArtworkResizeService.getBrushTipPath();
  assert(fs.existsSync(brushPath), 'ArtworkResizeService.getBrushTipPath() resolves existing file', { brushPath });

  // Test 2: Verify 300 DPI chunk injection
  const dummyPng = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, // signature
    0, 0, 0, 13, 73, 72, 68, 82,     // IHDR header
    0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0, 0x90, 0x77, 0x53, 0xde, // IHDR data + crc
    0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82 // IEND
  ]);
  const dpiInjected = inject300Dpi(dummyPng);
  const hasPhys = dpiInjected.includes(Buffer.from('pHYs', 'ascii'));
  assert(hasPhys, 'inject300Dpi() successfully injects pHYs chunk into PNG', { lenBefore: dummyPng.length, lenAfter: dpiInjected.length });

  // Test 3: Generate Master MBA PNG from SVG
  const testSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect x="250" y="250" width="500" height="500" rx="40" fill="#E11D48"/>
    <circle cx="500" cy="500" r="180" fill="#FFFFFF"/>
    <text x="500" y="520" font-family="Arial" font-size="48" font-weight="bold" text-anchor="middle" fill="#1E293B">MBA TEST</text>
  </svg>`;

  console.log('\n⏳ Rendere 4500x5400 Master-PNG über SvgRenderService...');
  const designsDir = path.resolve(process.cwd(), 'data', 'designs');
  if (!fs.existsSync(designsDir)) {
    fs.mkdirSync(designsDir, { recursive: true });
  }

  const testMbaPath = path.join(designsDir, 'test_resize_mba.png');
  const mbaBuffer = await SvgRenderService.renderSvgToMbaPng(testSvg, 4500, 5400);
  fs.writeFileSync(testMbaPath, mbaBuffer);
  assert(fs.existsSync(testMbaPath) && fs.statSync(testMbaPath).size > 1000, 'Master MBA PNG (4500x5400) generated successfully', { size: fs.statSync(testMbaPath).size });

  // Test 4: Run ArtworkResizeService.generateResizedArtworks
  console.log('\n⏳ Führe ArtworkResizeService.generateResizedArtworks() aus...');
  const result = await ArtworkResizeService.generateResizedArtworks('test_resize', testMbaPath);

  // Test 5: Verify all 5 output paths exist
  assert(fs.existsSync(result.trimmedPath), '1. Trimmed Master PNG exists on disk', { path: result.trimmedPath });
  assert(fs.existsSync(result.mugStandardPath), '2. Two-Sided Mug Standard PNG exists on disk', { path: result.mugStandardPath });
  assert(fs.existsSync(result.mugBrushPath), '3. Two-Sided Mug Brush PNG exists on disk', { path: result.mugBrushPath });
  assert(fs.existsSync(result.drinkwareStandardPath), '4. Two-Sided Drinkware Standard PNG exists on disk', { path: result.drinkwareStandardPath });
  assert(fs.existsSync(result.drinkwareBrushPath), '5. Two-Sided Drinkware Brush PNG exists on disk', { path: result.drinkwareBrushPath });

  // Test 6: Verify file sizes and non-empty
  const trimmedSize = fs.statSync(result.trimmedPath).size;
  const mugStdSize = fs.statSync(result.mugStandardPath).size;
  const mugBrushSize = fs.statSync(result.mugBrushPath).size;
  const drinkwareSize = fs.statSync(result.drinkwareStandardPath).size;
  const drinkwareBrushSize = fs.statSync(result.drinkwareBrushPath).size;

  assert(trimmedSize > 500, 'Trimmed PNG is valid size', { size: trimmedSize });
  assert(mugStdSize > 1000, 'Mug Standard PNG is valid size', { size: mugStdSize });
  assert(mugBrushSize > 1000, 'Mug Brush PNG is valid size', { size: mugBrushSize });
  assert(drinkwareSize > 1000, 'Drinkware Standard PNG is valid size', { size: drinkwareSize });
  assert(drinkwareBrushSize > 1000, 'Drinkware Brush PNG is valid size', { size: drinkwareBrushSize });

  // Test 7: Verify 300 DPI chunk is present in all 5 outputs
  const trimmedBuf = fs.readFileSync(result.trimmedPath);
  const mugStdBuf = fs.readFileSync(result.mugStandardPath);
  const mugBrushBuf = fs.readFileSync(result.mugBrushPath);
  const drinkwareBuf = fs.readFileSync(result.drinkwareStandardPath);
  const drinkwareBrushBuf = fs.readFileSync(result.drinkwareBrushPath);

  assert(trimmedBuf.includes(Buffer.from('pHYs', 'ascii')), 'Trimmed PNG contains 300 DPI pHYs chunk');
  assert(mugStdBuf.includes(Buffer.from('pHYs', 'ascii')), 'Mug Standard PNG contains 300 DPI pHYs chunk');
  assert(mugBrushBuf.includes(Buffer.from('pHYs', 'ascii')), 'Mug Brush PNG contains 300 DPI pHYs chunk');
  assert(drinkwareBuf.includes(Buffer.from('pHYs', 'ascii')), 'Drinkware Standard PNG contains 300 DPI pHYs chunk');
  assert(drinkwareBrushBuf.includes(Buffer.from('pHYs', 'ascii')), 'Drinkware Brush PNG contains 300 DPI pHYs chunk');

  // Test 8: Verify Brush variants are distinct from Standard variants (Brush adds contour)
  assert(mugBrushSize !== mugStdSize, 'Mug Brush variant is distinct from Standard variant (different file size due to contour)', {
    stdSize: mugStdSize,
    brushSize: mugBrushSize
  });
  assert(drinkwareBrushSize !== drinkwareSize, 'Drinkware Brush variant is distinct from Standard variant (different file size due to contour)', {
    stdSize: drinkwareSize,
    brushSize: drinkwareBrushSize
  });

  // Cleanup test files
  try {
    if (fs.existsSync(testMbaPath)) fs.unlinkSync(testMbaPath);
    if (fs.existsSync(result.trimmedPath)) fs.unlinkSync(result.trimmedPath);
    if (fs.existsSync(result.mugStandardPath)) fs.unlinkSync(result.mugStandardPath);
    if (fs.existsSync(result.mugBrushPath)) fs.unlinkSync(result.mugBrushPath);
    if (fs.existsSync(result.drinkwareStandardPath)) fs.unlinkSync(result.drinkwareStandardPath);
    if (fs.existsSync(result.drinkwareBrushPath)) fs.unlinkSync(result.drinkwareBrushPath);
  } catch (e) {}

  console.log('\n====================================================');
  console.log(`🏁 TEST RESULTS: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
  process.exit(0);
}

runResizeTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { mergeScannedFits } from '../src/server/services/productCatalogService';

const previous = [{ id: 'men', displayName: 'Men' }];
assert.deepEqual(mergeScannedFits(previous, [], 'SUCCESS'), []);
assert.deepEqual(mergeScannedFits(previous, [], 'FAILED'), previous);
assert.deepEqual(mergeScannedFits(previous, []), previous);
const scanner = fs.readFileSync(new URL('../src/server/services/productScannerService.ts', import.meta.url), 'utf8');
const block = scanner.slice(scanner.indexOf('// B. Fit Types'), scanner.indexOf('// C. Swatches'));
assert.ok(block.includes('fitDiscoveryStatus'));
const source = ts.transpile(block, { target: ts.ScriptTarget.ES2022 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const scan = async (html: string) => {
    await page.setContent(html);
    return page.evaluate(source => {
      const activeEditor = document.body;
      const amazonKey = 'NEW_PRODUCT';
      const catalog: Record<string, any> = { NEW_PRODUCT: {} };
      eval(source);
      return catalog[amazonKey];
    }, source);
  };
  const label = await scan('<fit-type><div>Fit type:</div><span class="default-fit-type-label">Adult Unisex</span></fit-type>');
  assert.deepEqual(label, { fits: [], fitDiscoveryStatus: 'SUCCESS' });
  assert.deepEqual(mergeScannedFits(previous, label.fits, label.fitDiscoveryStatus), []);
  assert.deepEqual((await scan('<fit-type><flowcheckbox class="women-checkbox"><input type="checkbox">Women</flowcheckbox></fit-type>')).fits, ['women']);
  assert.deepEqual((await scan('<label><input type="checkbox">Men outside fit section</label>')).fits, []);
  assert.equal((await scan('<fit-type><flowcheckbox>Mystery</flowcheckbox></fit-type>')).fitDiscoveryStatus, 'FAILED');
  console.log('PASS: fixed label, actual checkboxes, unrelated controls, unknown controls, successful-empty merge and failed-scan preservation');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { buildListingExpectations, verifyListingReadback } from '../src/server/services/listingReadback';

assert.throws(() => buildListingExpectations({ en: { title: 'x'.repeat(61) } }, false), /kein stilles Kürzen/);
assert.equal(buildListingExpectations({ en: { title: 'English' }, jp: { title: '日本語' } }, true).find(e => e.locale === 'ja' && e.field === 'title')?.value, '日本語');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const expectations = [{ locale: 'en', field: 'title', value: 'Expected' }];
  const check = () => page.evaluate(verifyListingReadback, { expectations, timeoutMs: 500 });
  await page.setContent('<input id="designCreator-productEditor-title" value="Expected">');
  assert.equal((await check()).success, true);
  await page.locator('input').fill('Wrong');
  assert.match((await check()).errors.join(), /Text weicht/);
  await page.setContent('<div id="de"><input id="designCreator-productEditor-title" value="Expected"></div>');
  assert.match((await check()).errors.join(), /Feld fehlt/, 'English must not use a foreign locale');
  await page.setContent('<div id="en"><input id="designCreator-productEditor-title" value="Expected"><input id="designCreator-productEditor-title" value="Expected"></div>');
  assert.match((await check()).errors.join(), /nicht eindeutig/);
  await page.setContent('<input id="designCreator-productEditor-title" value="old">');
  await page.evaluate(() => { setTimeout(() => { (document.querySelector('input') as HTMLInputElement).value = 'Expected'; }, 200); });
  assert.equal((await check()).success, true, 'Wait for delayed framework updates');
  expectations[0].value = '';
  assert.equal((await check()).success, false, 'Old text in an expected-empty field must fail');
  await page.setContent('');
  assert.equal((await check()).success, true, 'Absent optional empty field is allowed');
  console.log('PASS: exact values, mismatch, missing and duplicate fields, locale scoping, delayed updates, empty fields, length limits, Japanese alias');
} finally { await browser.close(); }

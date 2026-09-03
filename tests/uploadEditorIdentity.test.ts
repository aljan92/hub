import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';

// Run the actual browser-side resolver from the worker, not a copied algorithm.
const worker = fs.readFileSync(new URL('../src/server/services/uploadWorkerService.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('worker.ts', worker, ts.ScriptTarget.Latest, true);
let resolverSource = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'findMatchingEditors' && node.initializer) {
    resolverSource = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(resolverSource, 'Production editor resolver must exist');
const source = ts.transpile(`(${resolverSource})`, { target: ts.ScriptTarget.ES2022 });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // Mirrors the supplied DOM: several cards share one outer editor per row,
  // with a nested .product-editor and a product-specific asset-container token.
  await page.setContent(`<style>product-editor { display:block } .product-editor { height:100px }</style>
    <div class="form-row">
      <div class="product-card" id="FUTURE_A-card"></div>
      <div class="product-card" id="FUTURE_B-card"></div>
      <product-editor id="row-editor"><div class="product-editor-container">
        <div class="product-editor"><div class="asset-container FUTURE_A-container">Artwork</div></div>
      </div></product-editor>
    </div><product-editor id="empty"></product-editor>`);
  const resolve = (key: string) => page.evaluate(({ source, key }) => {
    const amazonKey = key;
    // Direct eval retains the same lexical catalog key as the production closure.
    const resolver = eval(source) as () => HTMLElement[];
    return resolver().map(editor => editor.id);
  }, { source, key });
  assert.deepEqual(await resolve('FUTURE_A'), ['row-editor'], 'Nested wrappers are one editor');
  assert.deepEqual(await resolve('FUTURE_B'), [], 'An editor for another card in the same row must not match');
  assert.deepEqual(await resolve('FUTURE'), [], 'Product identity must match an exact class token');
  await page.locator('.asset-container').evaluate(el => { el.className = 'asset-container FUTURE_B-container'; });
  assert.deepEqual(await resolve('FUTURE_B'), ['row-editor'], 'A newly discovered catalog key works without code changes');
  await page.locator('#row-editor').evaluate(el => { el.insertAdjacentHTML('afterend', el.outerHTML.replace('row-editor', 'duplicate')); });
  assert.equal((await resolve('FUTURE_B')).length, 2, 'Genuinely ambiguous editors remain rejected by the caller');
  await page.locator('#duplicate').evaluate(el => { (el as HTMLElement).style.display = 'none'; });
  assert.deepEqual(await resolve('FUTURE_B'), ['row-editor'], 'Hidden editor is ignored');
  console.log('PASS: nested wrappers, shared row, exact identity, dynamic new products, ambiguity and hidden editors');
} finally {
  await browser.close();
}

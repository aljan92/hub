import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { isUploadColorBlocked } from '../src/server/services/uploadColorPolicy';

for (const colorMode of ['none', 'customPicker']) assert.equal(isUploadColorBlocked({ colorMode, colorDiscoveryStatus: 'FAILED' }), false);
for (const colorMode of ['failed', 'unknown', 'predefined']) assert.equal(isUploadColorBlocked({ colorMode, colorDiscoveryStatus: 'FAILED' }), true);
assert.equal(isUploadColorBlocked({ colorMode: 'predefined', colorDiscoveryStatus: 'SUCCESS' }), false);
const worker = fs.readFileSync(new URL('../src/server/services/uploadWorkerService.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('worker.ts', worker, ts.ScriptTarget.Latest, true);
let source = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'editResult' && node.initializer && ts.isAwaitExpression(node.initializer)) {
    const call = node.initializer.expression as ts.CallExpression;
    source = ts.transpile(`(${call.arguments[0].getText(ast)})`, { target: ts.ScriptTarget.ES2022 });
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(source);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const run = (colorMode: string) => page.evaluate(({ source, colorMode }) => eval(source)({
    productId: 'TEST_DYNAMIC', amazonKey: 'TEST_DYNAMIC', cardId: 'TEST_DYNAMIC-card',
    colorMode, fitTypes: [], expectsFitControls: false, catalogColors: [], avoidColor: 'none', customBgColor: '#123456'
  }), { source, colorMode });
  const setup = async (accept: boolean) => {
    await page.setContent('<div id="TEST_DYNAMIC-card"></div><div data-mba-upload-editor-for="TEST_DYNAMIC" style="height:100px"><button id="color-btn">Color</button></div>');
    await page.evaluate(accept => {
      let saved = 'FFFFFF';
      const button = document.querySelector('button')!;
      button.onclick = () => {
        if (document.getElementById('picker')) { document.getElementById('picker')!.remove(); button.removeAttribute('aria-describedby'); return; }
        const picker = document.createElement('div'); picker.id = 'picker';
        picker.innerHTML = '<color-editable-input label="hex"><input></color-editable-input>';
        const input = picker.querySelector('input')!; input.value = saved;
        input.onchange = () => { if (accept) saved = input.value; };
        document.body.append(picker); button.setAttribute('aria-describedby', 'picker');
      };
    }, accept);
  };
  await setup(true);
  assert.equal((await run('none')).success, true);
  assert.equal((await run('customPicker')).success, true);
  await setup(false);
  await assert.rejects(() => run('customPicker'), /nicht bestätigt/);
  await setup(true);
  await page.locator('button').evaluate(el => el.remove());
  await assert.rejects(() => run('customPicker'), /fehlen im Produkteditor/);
  console.log('PASS: color-mode policy, none, accepted/rejected picker state, missing picker');
} finally { await browser.close(); }

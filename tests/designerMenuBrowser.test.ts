import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { findChromiumExecutable } from '../src/server/services/browserSessionService';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DesignerView} from './src/client/views/DesignerView'; createRoot(document.getElementById('root')).render(<DesignerView onNavigateTab={tab => window.navigatedTo=tab}/>);`,
    resolveDir: process.cwd(), loader: 'tsx'
  },
  bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
});
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true });

try {
  const page = await browser.newPage();
  const suggestions = ['Gardening', 'Botany'];
  const suggestionBodies: any[] = [];
  const settingBodies: any[] = [];
  const modelListRequests: string[] = [];
  let generatedBody: any = null;
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/settings' && route.request().method() === 'GET') {
      await route.fulfill({ json: { success: true, settings: { llmModel: 'base/model', designerSuggestionModel: '', designerImageProvider: 'IDEOGRAM' } } });
      return;
    }
    if (url.pathname === '/api/v1/settings' && route.request().method() === 'POST') {
      settingBodies.push(route.request().postDataJSON());
      await route.fulfill({ json: { success: true, settings: { llmModel: 'base/model', ...route.request().postDataJSON() } } });
      return;
    }
    if (url.pathname === '/api/v1/llm/models') {
      modelListRequests.push(url.search);
      await route.fulfill({ json: { success: true, models: [{ id: 'fast/model', name: 'Fast Model' }] } });
      return;
    }
    if (url.pathname === '/api/v1/designer/suggest') {
      const body = route.request().postDataJSON();
      suggestionBodies.push(body);
      await route.fulfill({ json: { success: true, suggestion: suggestions.shift() || 'Fresh idea', model: body.model || 'base/model' } });
      return;
    }
    if (url.pathname === '/api/v1/designer/generate') {
      generatedBody = route.request().postDataJSON();
      await route.fulfill({ json: { success: true, taskId: '#123-D', task: { id: '#123-D' } } });
      return;
    }
    await route.fulfill({ status: 404, json: { success: false } });
  });

  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
  await page.getByText('LLM-Modell für schnelle Vorschläge').waitFor();
  assert.deepEqual(modelListRequests, [], 'model catalog is not populated from startup suggestions');
  await page.getByRole('button', { name: /Grundmodell \(base\/model\)/ }).click();
  await page.getByRole('option', { name: /Fast Model/ }).click();
  assert.deepEqual(modelListRequests, ['?refresh=true']);
  await page.getByRole('button', { name: 'Niche 1 per KI vorschlagen' }).click();
  await page.waitForFunction(() => (document.querySelector('input[placeholder="z. B. Gardening"]') as HTMLInputElement)?.value === 'Gardening');
  assert.equal(await page.locator('input[placeholder="z. B. Gardening"]').inputValue(), 'Gardening');
  assert.equal(suggestionBodies[0].model, 'fast/model', 'visible model selection is request-bound even before persistence settles');
  assert.deepEqual(suggestionBodies[0].avoid, []);

  await page.getByRole('button', { name: 'Niche 1 per KI vorschlagen' }).click();
  await page.waitForFunction(() => (document.querySelector('input[placeholder="z. B. Gardening"]') as HTMLInputElement)?.value === 'Botany');
  assert.deepEqual(suggestionBodies[1].avoid, ['Gardening']);

  await page.locator('input[placeholder="z. B. Cats"]').fill('Cats');
  await page.locator('input[placeholder="z. B. Vegetable Gardening"]').fill('Herbs');
  await page.locator('input[placeholder="z. B. Easily Distracted by Plants"]').fill('Plant Mode');
  await page.locator('input[placeholder="Leer lassen, damit D2 den Stil auswählt"]').fill('Retro');
  await page.getByRole('button', { name: 'Leeren' }).click();
  assert.equal(await page.locator('input[placeholder="z. B. Gardening"]').inputValue(), 'Botany');
  for (const placeholder of ['z. B. Cats', 'z. B. Vegetable Gardening', 'z. B. Easily Distracted by Plants', 'Leer lassen, damit D2 den Stil auswählt']) {
    assert.equal(await page.locator(`input[placeholder="${placeholder}"]`).inputValue(), '');
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('mba_designer_suggestion_history_v1')), null);

  await page.locator('input[placeholder="z. B. Cats"]').fill('Fishing');
  await page.locator('input[placeholder="z. B. Vegetable Gardening"]').fill('Indoor Plants');
  await page.locator('input[placeholder="z. B. Easily Distracted by Plants"]').fill('Just One More Plant');
  await page.locator('input[placeholder="Leer lassen, damit D2 den Stil auswählt"]').fill('Engraving');
  await page.getByRole('button', { name: /Design mit/ }).click();
  await page.getByText('Task #123-D wurde angelegt.').waitFor();
  assert.equal(generatedBody.niche1, 'Botany');
  assert.equal(generatedBody.niche2, 'Fishing');
  assert.equal(generatedBody.subniche, 'Indoor Plants');
  assert.equal(generatedBody.quote, 'Just One More Plant');
  assert.equal(generatedBody.style, 'Engraving');
  assert.equal('prompt' in generatedBody, false);
  assert.match(generatedBody.requestId, /.+/);
  assert.equal(await page.locator('input[placeholder="z. B. Cats"]').inputValue(), 'Fishing', 'Design keeps form values');
  assert.equal(await page.evaluate(() => localStorage.getItem('mba_designer_suggestion_history_v1')), null);
  assert.ok(settingBodies.some(body => body.designerSuggestionModel === 'fast/model'));
  console.log('PASS designer menu: direct suggestions, local history, reset, model binding and D2 task payload');
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

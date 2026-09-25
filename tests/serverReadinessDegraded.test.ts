import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function waitForHealth(baseUrl: string, child: ReturnType<typeof spawn>, output: () => string): Promise<Response> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${child.exitCode}\n${output()}`);
    try {
      return await fetch(`${baseUrl}/api/health`);
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Server did not start within 10 seconds');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-hub-readiness-'));
const dataDir = path.join(root, 'data');
const distDir = path.join(root, 'dist');
fs.mkdirSync(dataDir);
fs.mkdirSync(path.join(distDir, 'client'), { recursive: true });
fs.copyFileSync(path.resolve('dist/server.cjs'), path.join(distDir, 'server.cjs'));
fs.copyFileSync(path.resolve('dist/client/index.html'), path.join(distDir, 'client/index.html'));
fs.copyFileSync(path.resolve('browsers.json'), path.join(root, 'browsers.json'));
fs.copyFileSync(path.resolve('browsers.json'), path.join(distDir, 'browsers.json'));
fs.copyFileSync(path.resolve('package.json'), path.join(root, 'package.json'));
fs.writeFileSync(path.join(dataDir, 'mba_hub.sqlite'), 'invalid sqlite database');

const port = 40000 + Math.floor(Math.random() * 20000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(distDir, 'server.cjs')], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout?.on('data', chunk => { output = (output + String(chunk)).slice(-4000); });
child.stderr?.on('data', chunk => { output = (output + String(chunk)).slice(-4000); });

try {
  const healthResponse = await waitForHealth(baseUrl, child, () => output);
  const health = await healthResponse.json() as any;
  assert.equal(healthResponse.status, 200);
  assert.equal(health.ready, false);
  assert.equal(health.status, 'degraded');
  assert.equal(health.readinessFailureCode, 'TASK_STORAGE_FAILED');

  const ready = await fetch(`${baseUrl}/api/ready`);
  assert.equal(ready.status, 503);
  const tasks = await fetch(`${baseUrl}/api/v1/tasks/log?limit=20`);
  assert.equal(tasks.status, 503);
  const mutation = await fetch(`${baseUrl}/api/v1/tasks/enqueue`, { method: 'POST' });
  assert.equal(mutation.status, 503);
  const dashboard = await fetch(baseUrl);
  assert.equal(dashboard.status, 200);
  console.log('Degraded readiness keeps dashboard reachable and blocks task APIs.');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  fs.rmSync(root, { recursive: true, force: true });
}

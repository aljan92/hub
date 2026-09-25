import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mba-updater-test-'));
const dockerPath = join(root, 'docker');
const token = 'test-updater-token-with-at-least-32-characters';
const port = 40000 + Math.floor(Math.random() * 15000);
const readyServer = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/busy' ? { busy: false } : { ready: true }));
});
await new Promise(resolve => readyServer.listen(0, '127.0.0.1', resolve));
const readyPort = readyServer.address().port;

writeFileSync(dockerPath, `#!/bin/sh
case "$1" in
  commit) sleep 0.1; exit 0 ;;
  pull|tag) exit 0 ;;
  inspect)
    if [ -f "$SAME_IMAGE" ]; then echo sha256:new; else echo sha256:old; fi
    exit 0 ;;
  image)
    case "$*" in *rollback-local*) echo sha256:old ;; *) echo sha256:new ;; esac
    exit 0 ;;
  compose)
    if [ -f "$FAIL_ONCE" ]; then rm "$FAIL_ONCE"; exit 1; fi
    exit 0 ;;
esac
exit 1
`);
chmodSync(dockerPath, 0o755);
const child = spawn(process.execPath, [resolve('updater/server.mjs')], {
  env: {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    UPDATER_TOKEN: token,
    PORT: String(port),
    APP_READY_URL: `http://127.0.0.1:${readyPort}/ready`,
    APP_BUSY_URL: `http://127.0.0.1:${readyPort}/busy`,
    SAME_IMAGE: join(root, 'same-image'),
    FAIL_ONCE: join(root, 'fail-once')
  },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${port}`;
const headers = { 'x-updater-token': token };

async function request(path, method = 'GET', authorized = true) {
  return fetch(base + path, { method, headers: authorized ? headers : {} });
}
async function statusUntil(terminal) {
  for (let n = 0; n < 100; n++) {
    try {
      const response = await request('/status');
      if (response.ok) {
        const state = await response.json();
        if (terminal.includes(state.phase)) return state;
      }
    } catch { /* Process may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Updater did not reach a terminal state');
}

try {
  await statusUntil(['idle']);
  assert.equal((await request('/status', 'GET', false)).status, 401);
  assert.equal((await request('/apply', 'POST')).status, 202);
  assert.equal((await request('/apply', 'POST')).status, 409);
  assert.equal((await statusUntil(['complete'])).phase, 'complete');

  writeFileSync(join(root, 'fail-once'), '1');
  assert.equal((await request('/apply', 'POST')).status, 202);
  const rollback = await statusUntil(['rolled_back', 'rollback_failed']);
  assert.equal(rollback.phase, 'rolled_back');
  writeFileSync(join(root, 'same-image'), '1');
  assert.equal((await request('/apply', 'POST')).status, 202);
  assert.equal((await statusUntil(['unchanged'])).phase, 'unchanged');
  console.log('Updater authorization, serialization, successful apply, rollback and no-op verified.');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  await new Promise(resolve => readyServer.close(resolve));
  rmSync(root, { recursive: true, force: true });
}

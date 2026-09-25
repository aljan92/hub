import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

const token = process.env.UPDATER_TOKEN;
if (!token || token.length < 32) throw new Error('UPDATER_TOKEN must contain at least 32 characters');

const image = process.env.APP_IMAGE || 'ghcr.io/aljan92/hub';
const composeFile = process.env.COMPOSE_FILE || '/Volume1/docker/mba-hub/docker-compose.yml';
const appUrl = process.env.APP_READY_URL || 'http://mba-hub:3000/api/ready';
const appContainer = process.env.APP_CONTAINER || 'mba_hub_app';
const listenPort = Number(process.env.PORT || 3001);
const imageTag = `${image}:main`;
const rollbackTag = `${image}:rollback-local`;
const activePhases = new Set(['queued', 'backing_up', 'pulling', 'recreating', 'verifying', 'rolling_back']);
let state = { phase: 'idle', startedAt: null, finishedAt: null, image: null, error: null };

function authorized(req) {
  const supplied = req.headers['x-updater-token'];
  if (typeof supplied !== 'string') return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function run(command, args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = chunk => { output = (output + String(chunk)).slice(-4000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} exited ${code}: ${output.trim()}`));
    });
  });
}

function docker(...args) { return run('docker', args, 900_000); }
function compose(...args) { return docker('compose', '--env-file', `${composeFile.replace(/\/[^/]+$/, '')}/.env`, '-f', composeFile, ...args); }

async function waitForReady() {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).ready === true) return;
    } catch { /* Container may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('New app did not become ready within 300 seconds');
}

async function applyUpdate() {
  let rollbackPrepared = false;
  try {
    state.phase = 'backing_up';
    // The currently running container may have been modified by the legacy update button.
    // Commit its writable layer once before Compose replaces it.
    await docker('commit', appContainer, rollbackTag);
    rollbackPrepared = true;

    state.phase = 'pulling';
    await docker('pull', imageTag);
    const newImageId = await docker('image', 'inspect', '--format', '{{.Id}}', imageTag);
    const oldImageId = await docker('image', 'inspect', '--format', '{{.Id}}', rollbackTag);
    state.image = newImageId;
    if (newImageId === oldImageId) {
      state.phase = 'unchanged';
      state.finishedAt = new Date().toISOString();
      return;
    }

    state.phase = 'recreating';
    await compose('up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'mba-hub');
    state.phase = 'verifying';
    await waitForReady();
    state.phase = 'complete';
    state.finishedAt = new Date().toISOString();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    state.phase = 'failed';
    state.error = reason.slice(0, 500);
    if (rollbackPrepared) {
      try {
        state.phase = 'rolling_back';
        await docker('tag', rollbackTag, imageTag);
        await compose('up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'mba-hub');
        await waitForReady();
        state.phase = 'rolled_back';
      } catch (rollbackError) {
        state.phase = 'rollback_failed';
        state.error = `${state.error}; rollback: ${String(rollbackError)}`.slice(0, 500);
      }
    }
    state.finishedAt = new Date().toISOString();
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!authorized(req)) {
    res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200).end(JSON.stringify(state));
    return;
  }
  if (req.method === 'POST' && req.url === '/apply') {
    if (activePhases.has(state.phase)) {
      res.writeHead(409).end(JSON.stringify({ error: 'update_in_progress', state }));
      return;
    }
    state = { phase: 'queued', startedAt: new Date().toISOString(), finishedAt: null, image: null, error: null };
    res.writeHead(202).end(JSON.stringify({ accepted: true, state }));
    setImmediate(() => { void applyUpdate(); });
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
});

server.listen(listenPort, '0.0.0.0', () => console.log(`[Updater] listening on ${listenPort}`));

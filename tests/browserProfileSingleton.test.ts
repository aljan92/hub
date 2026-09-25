import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearStaleProfileSingleton } from '../src/server/services/browserSessionService';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-browser-lock-'));
try {
  fs.symlinkSync('old-container-129', path.join(dir, 'SingletonLock'));
  fs.symlinkSync('old-cookie', path.join(dir, 'SingletonCookie'));
  fs.symlinkSync('/tmp/old-container-socket', path.join(dir, 'SingletonSocket'));
  assert.equal(clearStaleProfileSingleton(dir, 'new-container'), true);
  assert.equal(fs.readdirSync(dir).length, 0);

  fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(dir, 'SingletonLock'));
  assert.equal(clearStaleProfileSingleton(dir), false, 'live owner must keep its profile lock');
  assert.equal(fs.readdirSync(dir).length, 1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

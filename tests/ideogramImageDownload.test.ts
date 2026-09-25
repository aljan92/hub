import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IdeogramService, ExpiredIdeogramImageError } from '../src/server/services/ideogramService';

test('Ideogram download writes an accepted PNG atomically and preserves prior image on errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-ideogram-download-'));
  const target = path.join(dir, 'image.png');
  const originalFetch = globalThis.fetch;
  const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  try {
    globalThis.fetch = (async () => ({ ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) })) as any;
    await IdeogramService.downloadImage('https://cdn.ideogram.ai/image.png', target);
    assert.deepEqual(fs.readFileSync(target), png);
    globalThis.fetch = (async () => ({ ok: false, status: 403 })) as any;
    await assert.rejects(IdeogramService.downloadImage('https://cdn.ideogram.ai/expired.png', target), ExpiredIdeogramImageError);
    assert.deepEqual(fs.readFileSync(target), png);
    await assert.rejects(IdeogramService.downloadImage('http://localhost/image.png', target), /ungültige Bild-URL/);
    assert.deepEqual(fs.readdirSync(dir), ['image.png']);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

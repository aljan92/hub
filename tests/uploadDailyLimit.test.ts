import assert from 'node:assert/strict';
import { UploadWorkerService } from '../src/server/services/uploadWorkerService';

// No browser, real queue or Amazon actions. Exercise the handler used by the DOM check.
const worker = UploadWorkerService as any;
const originalLog = worker.log;
const logs: string[] = [];
try {
  worker.log = (message: string) => logs.push(message);
  worker.handleDailyUploadLimit(false, 'draft'); // New design in Draft
  worker.handleDailyUploadLimit(false, 'draft'); // New design in Hybrid resolves to Draft
  assert.equal(logs.length, 2);
  assert(logs.every(message => message.includes('Entwurf')));
  assert.throws(() => worker.handleDailyUploadLimit(false, 'publish'), /Tägliches Amazon Upload-Limit/);
  assert.throws(() => worker.handleDailyUploadLimit(true, 'publish'), /Tägliches Amazon Upload-Limit/);
  assert.throws(() => worker.handleDailyUploadLimit(true, 'draft'), /Tägliches Amazon Upload-Limit/);
  assert.equal(logs.length, 2, 'No exemption for updates or live publishing');
  console.log('PASS daily-limit notice: new drafts/hybrid drafts continue, publish and updates remain blocked');
} finally { worker.log = originalLog; }

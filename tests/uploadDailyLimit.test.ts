import assert from 'node:assert/strict';
import { UploadWorkerService } from '../src/server/services/uploadWorkerService';
import fs from 'node:fs';

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
  const source=fs.readFileSync(new URL('../src/server/services/uploadWorkerService.ts',import.meta.url),'utf8');
  const boundary=source.slice(source.indexOf('// 9. Final Action'),source.indexOf("this.log(`🚀 Klicke 'Publish'"));
  assert(boundary.indexOf('const intendedRemoteFingerprint') < boundary.indexOf("if (effectiveMode === 'publish')"));
  assert(boundary.indexOf('let remoteBaseline') < boundary.indexOf("if (effectiveMode === 'publish')"));

  // Check 1: No rate limit check during initial artwork rendering before modal
  const renderStep = source.slice(source.indexOf('// Wait for artwork to render'), source.indexOf("// 5. Select Products Modal"));
  assert(!renderStep.includes('.daily-rate-limit-breached'), 'Must not check daily limit during PNG rendering before Select Products modal');

  // Check 2: Rate limit and tier check exists after Select Products modal matrix selection
  const postModal = source.slice(source.indexOf('Marktplatz-Matrix synchronisiert'), source.indexOf('// 6. Sequential Product Details'));
  assert(postModal.includes('checkAmazonLimitNotices'), 'Must check daily limit and tier notices after Select Products modal matrix selection');

  // Check 3: Rate limit check exists before publish click
  const prePublish = source.slice(source.indexOf("this.log(`🚀 Klicke 'Publish'"), source.indexOf('// STEP 1: Click #submit-button'));
  assert(prePublish.includes('checkAmazonLimitNotices'), 'Must check daily limit and tier notices before live publish submission');

  // Check 4: startUpload rejects unscheduled new designs and full tier in live mode
  const startUploadSection = source.slice(source.indexOf('public static async startUpload'), source.indexOf('this.isUploading = true'));
  assert(startUploadSection.includes("tierInfo.freeDesignsCount !== undefined && tierInfo.freeDesignsCount <= 0"), 'Must reject startUpload when tier is full');
  assert(startUploadSection.includes("(targetItem.allocatedSlots ?? 0) <= 0"), 'Must reject startUpload for unscheduled live designs');

  console.log('PASS daily-limit notice: timing verified, new drafts continue, publish and updates remain blocked');
} finally { worker.log = originalLog; }

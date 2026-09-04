import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { crc32, validateArtworkPng } from '../src/server/services/artworkPngValidation';
import { inject300Dpi } from '../src/server/services/artworkResizeService';
import { ArtworkResizeService } from '../src/server/services/artworkResizeService';
import { ArtworkRenderSession } from '../src/server/services/artworkRenderSession';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function chunk(type: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
const rows = Buffer.alloc(18); rows[9] = 4;
const make = (data = deflateSync(rows), h = header) => Buffer.concat([signature, chunk('IHDR', h), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
await validateArtworkPng(make(), 2, 2);
await validateArtworkPng(inject300Dpi(inject300Dpi(make())), 2, 2);
assert.equal(inject300Dpi(inject300Dpi(make())).length, make().length + 21, 'pHYs must be replaced');
const corrupt = make(); corrupt[corrupt.length - 1] ^= 1;
await assert.rejects(validateArtworkPng(corrupt, 2, 2), /CRC/);
await assert.rejects(validateArtworkPng(make(), 3, 2), /maße/i);
await assert.rejects(validateArtworkPng(make().subarray(0, -1), 2, 2), /abgeschnitten|Länge/);
await assert.rejects(validateArtworkPng(Buffer.concat([make(), Buffer.from([0])]), 2, 2), /Dateiende/);
await assert.rejects(validateArtworkPng(make(deflateSync(Buffer.alloc(17))), 2, 2), /abgeschnitten/);
await assert.rejects(validateArtworkPng(make(deflateSync(Buffer.alloc(19))), 2, 2), /Zu viele/);
const badFilter = Buffer.from(rows); badFilter[9] = 5;
await assert.rejects(validateArtworkPng(make(deflateSync(badFilter)), 2, 2), /Filter/);
await assert.rejects(validateArtworkPng(make(Buffer.from('not zlib')), 2, 2));
await assert.rejects(validateArtworkPng(make(deflateSync(rows).subarray(0, -2)), 2, 2));
await assert.rejects(validateArtworkPng(make(Buffer.concat([deflateSync(rows), Buffer.from([0])])), 2, 2), /Überzählige/);
const unsupported = Buffer.from(header); unsupported[12] = 1;
await assert.rejects(validateArtworkPng(make(undefined, unsupported), 2, 2), /Ausgabeformat/);
const compressed = deflateSync(rows);
await validateArtworkPng(Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', compressed.subarray(0, 3)), chunk('IDAT', compressed.subarray(3)), chunk('IEND', Buffer.alloc(0))]), 2, 2);
await assert.rejects(validateArtworkPng(Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', compressed.subarray(0, 3)), chunk('tEXt', Buffer.from('note\0text')), chunk('IDAT', compressed.subarray(3)), chunk('IEND', Buffer.alloc(0))]), 2, 2), /Reihenfolge/);
console.log('PASS PNG stream integrity: dimensions, CRC, filters, exact decompressed length, zlib, chunk order, density replacement');

const cwd = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(),'png-invalid-output-'));
const originalRun = ArtworkRenderSession.run;
try {
  process.chdir(temp); fs.mkdirSync(path.join(temp,'data','designs'),{recursive:true});
  const input = path.join(temp,'input.png'), output = path.join(temp,'data','designs','fixture_test.png');
  fs.writeFileSync(input,make()); fs.writeFileSync(output,'existing artwork');
  let evaluations = 0;
  ArtworkRenderSession.run = async (work: any) => work({
    setViewportSize: async () => {},
    evaluate: async () => ++evaluations === 1 ? {bounds:{x:0,y:0,width:2,height:2}} : corrupt.toString('base64')
  });
  await assert.rejects(ArtworkResizeService.generateProductVariant('fixture',input,'TEST',{
    mode:'CANVAS_BACKGROUND_CONTAIN',source:'VISIBLE_ARTWORK',canvas:{width:2,height:2},paddingShortSidePct:0,backgroundProfile:'DARK_PRODUCT'
  }), /TEST \(2×2, PNG\) \[PNG_INTEGRITY_VALIDATION\].*CRC/);
  assert.equal(fs.readFileSync(output,'utf8'),'existing artwork');
  assert.deepEqual(fs.readdirSync(path.dirname(output)),['fixture_test.png']);
} finally {ArtworkRenderSession.run = originalRun;process.chdir(cwd);fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS corrupt renderer output: precise stage error, existing file retained, no temporary output committed');

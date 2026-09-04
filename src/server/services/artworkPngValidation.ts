import { createInflate } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
export function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}

/** Integrity check for our browser encoders' non-interlaced 8-bit RGB/RGBA
 * output, not a general-purpose PNG decoder. Inflate scanlines incrementally;
 * never allocate the full uncompressed bitmap. PNG: https://www.w3.org/TR/png/ */
export async function validateArtworkPng(png: Buffer, width: number, height: number): Promise<void> {
  const fail = (message: string): never => { throw new Error(`PNG-Integritätsprüfung: ${message}`); };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 100_000_000) fail('Pixelbudget/Maße ungültig');
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('Signatur ungültig');
  let offset = 8, channels = 0, ended = false, dataClosed = false, seenData = false;
  const idats: Buffer[] = [];
  for (; offset < png.length;) {
    if (offset + 12 > png.length) fail('Chunk abgeschnitten');
    const length = png.readUInt32BE(offset), end = offset + 12 + length;
    if (end > png.length || length > 0x7fffffff) fail('Chunk-Länge ungültig');
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) fail('Chunk-Typ ungültig');
    if (crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) fail(`CRC ungültig (${type})`);
    const data = png.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== 'IHDR') fail('IHDR fehlt');
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) fail('IHDR ungültig');
      if (data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height) fail('Ausgabemaße stimmen nicht');
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) fail('Nicht unterstütztes Ausgabeformat');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      if (dataClosed) fail('IDAT-Reihenfolge ungültig');
      seenData = true; idats.push(data);
    } else {
      if (seenData) dataClosed = true;
      if (type === 'IEND') {
        if (length !== 0 || !seenData || end !== png.length) fail('IEND/Dateiende ungültig');
        ended = true;
      } else if (type[0] === type[0].toUpperCase()) {
        // Neither screenshot nor canvas encoder needs a palette for RGB/RGBA.
        fail(`Unerwarteter kritischer Chunk (${type})`);
      }
    }
    offset = end;
  }
  if (!ended || !channels) fail('Unvollständige Datei');
  const stride = width * channels + 1, expected = stride * height;
  let count = 0;
  const inflate = createInflate();
  await pipeline(Readable.from(idats), inflate, new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        if (count + chunk.length > expected) fail('Zu viele Bilddaten');
        for (let i = (stride - count % stride) % stride; i < chunk.length; i += stride) {
          if (chunk[i] > 4) fail('Scanline-Filter ungültig');
        }
        count += chunk.length; callback();
      } catch (error) { callback(error as Error); }
    }
  }));
  if (count !== expected) fail('Bilddaten abgeschnitten');
  if (inflate.bytesWritten !== idats.reduce((sum, data) => sum + data.length, 0)) fail('Überzählige komprimierte Daten');
}

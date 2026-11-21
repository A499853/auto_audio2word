'use strict';
// Small code-drawn icons; production has no image library dependency.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, buffer) {
  const label = Buffer.from(type), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(buffer.length); checksum.writeUInt32BE(crc32(Buffer.concat([label, buffer])));
  return Buffer.concat([header, label, buffer, checksum]);
}
const target = path.resolve(__dirname, '../extension/icons');
fs.mkdirSync(target, {recursive: true});
for (const size of [16, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const X = x / size, Y = y / size;
    const line = X > .24 && X < .76 && ((Y > .25 && Y < .34) || (Y > .44 && Y < .53) || (Y > .63 && Y < .72));
    const index = y * (size * 4 + 1) + 1 + x * 4;
    pixels[index] = line ? 255 : 34; pixels[index + 1] = line ? 255 : 92; pixels[index + 2] = line ? 255 : 231; pixels[index + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(path.join(target, `icon${size}.png`), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Generated extension icons.');

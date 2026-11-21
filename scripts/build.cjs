'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
require('./check.cjs');
const root = path.resolve(__dirname, '..');
const manifest = require('../extension/manifest.json');
const release = path.join(root, 'release');
const folder = path.join(release, 'baidu-live-assistant');
const archive = path.join(release, `baidu-live-assistant-v${manifest.version}.zip`);
fs.mkdirSync(folder, {recursive: true});
fs.cpSync(path.join(root, 'extension'), folder, {recursive: true});
fs.copyFileSync(path.join(root, 'README.md'), path.join(folder, '使用说明.md'));
fs.cpSync(path.join(root, 'docs'), path.join(folder, 'docs'), {recursive: true});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const local = [], central = [];
let offset = 0;
const stamp = new Date();
const dosTime = (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1);
const dosDate = ((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate();
for (const full of walk(folder)) {
  // Put manifest.json at ZIP root. Extract-to-folder tools already add a
  // versioned outer directory; another wrapper makes users select the wrong
  // level in Chrome/Edge and receive "manifest missing".
  const name = Buffer.from(path.relative(folder, full).replace(/\\/g, '/'), 'utf8');
  const data = fs.readFileSync(full);
  const compressed = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12); header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(dosTime, 12); entry.writeUInt16LE(dosDate, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + compressed.length;
}
const centralData = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(archive, Buffer.concat([...local, centralData, end]));
console.log(`Unpacked: ${folder}\nZIP: ${archive}\nSize: ${fs.statSync(archive).size} bytes`);

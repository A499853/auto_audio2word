'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest must be version 3');
const files = [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap(item => item.js), ...manifest.web_accessible_resources.flatMap(item => item.resources), ...Object.values(manifest.icons), 'popup.js', 'popup.css'];
for (const file of new Set(files)) {
  const full = path.join(directory, file);
  if (!fs.existsSync(full)) throw new Error(`Missing extension file: ${file}`);
  if (file.endsWith('.js')) new vm.Script(fs.readFileSync(full, 'utf8'), {filename: file});
}
if (manifest.host_permissions.some(value => value !== 'https://cecom.baidu.com/*')) throw new Error('Unexpected host permission');
console.log('Manifest, JavaScript syntax, referenced assets and host scope: OK');

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let playwright;
try {
  playwright = require('playwright');
} catch (original) {
  // The desktop developer runtime can supply test dependencies without npm.
  // Release files never import this helper or depend on this location.
  const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
  if (!fs.existsSync(bundled)) throw original;
  playwright = require(bundled);
}

async function launchBrowser(options = {}) {
  let executablePath = process.env.TEST_BROWSER_PATH;
  if (!executablePath && !fs.existsSync(playwright.chromium.executablePath()) && process.platform === 'win32') {
    const installed = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    executablePath = installed.find(file => fs.existsSync(file));
  }
  return playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...options });
}

module.exports = { chromium: playwright.chromium, launchBrowser };

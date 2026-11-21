'use strict';
// Isolated browser profiles and an intercepted local fixture; no live account is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('../tests/browser.cjs');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const resultsDirectory = path.join(root, 'test-results');
fs.mkdirSync(resultsDirectory, {recursive: true});
const browsers = [
  {name: 'Edge', executablePath: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')},
  {name: 'Chrome', executablePath: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe')}
];
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/live-console.html'), 'utf8');

(async () => {
  const reports = [];
  for (const browser of browsers) {
    if (process.env.TEST_BROWSER_NAME && process.env.TEST_BROWSER_NAME !== browser.name) continue;
    if (!fs.existsSync(browser.executablePath)) {reports.push({browser: browser.name, result: 'not installed'}); continue;}
    const temporaryRoot = path.resolve(os.tmpdir());
    const profile = fs.mkdtempSync(path.join(temporaryRoot, `baidu-live-extension-${browser.name.toLowerCase()}-`));
    let context;
    let extensionSession;
    const errors = [];
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: browser.executablePath, headless: true, viewport: {width: 1440, height: 1080},
        ignoreDefaultArgs: ['--disable-extensions'],
        args: browser.name === 'Chrome' ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
      });
      let worker = context.serviceWorkers()[0];
      let extensionId = worker ? new URL(worker.url()).host : null;
      // Branded Chrome removed --load-extension. Its developer CDP endpoint
      // can load the same unpacked directory into this disposable profile.
      // Keep its session attached until context.close(), and avoid the legacy
      // --disable-extensions-except allowlist with this loading mechanism.
      if (!worker && browser.name === 'Chrome') {
        extensionSession = await context.browser().newBrowserCDPSession();
        const loaded = await extensionSession.send('Extensions.loadUnpacked', {path: extension}).catch(error => {
          console.log(`Chrome developer loading: ${error.message}`);
        });
        extensionId = loaded?.id || null;
      }
      if (!worker) worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 12000}).catch(() => null);
      if (!extensionId && worker) extensionId = new URL(worker.url()).host;
      if (!extensionId) {
        reports.push({browser: browser.name, result: 'extension command-line loading unavailable in installed distribution; manual unpacked loading required'});
        continue;
      }
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://cecom.baidu.com/**', route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: fixture}));
      await page.goto('https://cecom.baidu.com/liveB/fixture?count=72');
      if (process.env.DEBUG_EXTENSION) console.log(JSON.stringify({browser: browser.name, extensionId, workers: context.serviceWorkers().map(item=>item.url()), html: await page.title()}));
      const panel = page.locator('#baidu-live-assistant-root');
      await panel.locator('#scan').waitFor({timeout: 15000});
      await panel.locator('#scan').click();
      await page.waitForFunction(() => document.querySelector('#baidu-live-assistant-root')?.shadowRoot.querySelector('#product-count').textContent === '72');
      // Wait until plan generation/persistence has completed.
      await page.waitForFunction(() => !document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#start').disabled);
      assert.equal(await panel.locator('#plan').inputValue(), '1-72');
      await panel.locator('#plan').fill('1,3');
      await panel.locator('#interval').fill('1');
      await panel.locator('#start').click();
      await page.waitForFunction(() => fixture.state.active === 3);
      await panel.locator('#stop').click();
      const count = await page.evaluate(() => fixture.state.clicks.length);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => fixture.state.clicks.length), count);
      assert.equal(await page.evaluate(() => fixture.state.dangerousClicks), 0);
      await page.screenshot({path: path.join(resultsDirectory, `${browser.name.toLowerCase()}-extension.png`)});
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator('#toggle').count(), 1);
      assert.equal(await popup.locator('#open').count(), 1);
      assert.deepEqual(errors, []);
      reports.push({browser: browser.name, result: 'PASS', extensionId, scanned: 72, sequence: [1, 3], stopped: true, errors});
    } catch (error) {
      reports.push({browser: browser.name, result: 'FAIL', error: error.message, errors});
      process.exitCode = 1;
    } finally {
      await context?.close();
      const resolvedProfile = path.resolve(profile);
      if (path.dirname(resolvedProfile) !== temporaryRoot || !path.basename(resolvedProfile).startsWith('baidu-live-extension-')) throw new Error('Unexpected test profile path');
      fs.rmSync(resolvedProfile, {recursive: true, force: true, maxRetries: 3});
    }
  }
  fs.writeFileSync(path.join(resultsDirectory, 'extension-load-report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});

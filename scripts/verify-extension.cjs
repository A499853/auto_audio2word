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
const scenarios = [
  {name: 'standard-table-72', file: 'live-console.html', count: 72, query: '?count=72'},
  {name: 'baidu-virtual-cards-14', file: 'baidu-console.html', count: 14, query: ''}
].map(scenario => ({...scenario, html: fs.readFileSync(path.join(root, 'tests/fixtures', scenario.file), 'utf8')}));

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
    const scenarioReports = [];
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
      if (!worker) throw new Error('Extension service worker was not available for isolated scenario setup');
      for (const scenario of scenarios) {
        // A prior case saves its plan and panel position. Clear only this
        // disposable extension profile, before opening the next fixture page.
        await worker.evaluate(() => chrome.storage.local.clear());
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(`${scenario.name}: ${error.message}`));
        try {
          await page.route('https://cecom.baidu.com/**', route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: scenario.html}));
          await page.goto(`https://cecom.baidu.com/liveB/fixture-${scenario.name}${scenario.query}`);
          if (process.env.DEBUG_EXTENSION) console.log(JSON.stringify({browser: browser.name, scenario: scenario.name, extensionId, workers: context.serviceWorkers().map(item=>item.url()), html: await page.title()}));
          const panel = page.locator('#baidu-live-assistant-root');
          await panel.locator('#scan').waitFor({timeout: 15000});
          await panel.locator('#scan').click();
          await page.waitForFunction(expected => document.querySelector('#baidu-live-assistant-root')?.shadowRoot.querySelector('#product-count').textContent === String(expected), scenario.count);
          // Wait until plan generation/persistence has completed.
          await page.waitForFunction(() => !document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#start').disabled);
          assert.equal(await panel.locator('#plan').inputValue(), `1-${scenario.count}`);
          const before = await panel.boundingBox();
          const header = await panel.locator('.header').boundingBox();
          assert.ok(before && header, 'Panel and drag handle must have visible bounds');
          await page.mouse.move(header.x + 90, header.y + 24);
          await page.mouse.down();
          await page.mouse.move(header.x - 230, header.y + 70, {steps: 10});
          await page.mouse.up();
          const moved = await panel.boundingBox();
          assert.ok(moved && before.x - moved.x > 250, 'Header drag must move the panel left');
          await panel.locator('#plan').fill('1,3');
          await panel.locator('#interval').fill('1');
          await panel.locator('#start').click();
          await page.waitForFunction(() => (window.baiduFixture || window.fixture).state.active === 3);
          await panel.locator('#stop').click();
          const count = await page.evaluate(() => (window.baiduFixture || window.fixture).state.clicks.length);
          await page.waitForTimeout(1200);
          const actual = await page.evaluate(() => {
            const state = (window.baiduFixture || window.fixture).state;
            return {clicks: state.clicks.map(item => typeof item === 'number' ? item : item.number), dangerous: state.dangerousClicks};
          });
          assert.equal(actual.clicks.length, count, 'Stopped runner must not dispatch further clicks');
          assert.deepEqual(actual.clicks, [1, 3]);
          assert.equal(actual.dangerous, 0);
          await page.screenshot({path: path.join(resultsDirectory, `${browser.name.toLowerCase()}-${scenario.name}-extension.png`)});
          scenarioReports.push({name: scenario.name, result: 'PASS', scanned: scenario.count, generatedPlan: `1-${scenario.count}`, sequence: actual.clicks, stopped: true, dragged: true});
        } finally { await page.close(); }
      }
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator('#toggle').count(), 1);
      assert.equal(await popup.locator('#open').count(), 1);
      assert.deepEqual(errors, []);
      await popup.close();
      reports.push({browser: browser.name, result: 'PASS', extensionId, scenarios: scenarioReports, popup: 'PASS', errors});
    } catch (error) {
      reports.push({browser: browser.name, result: 'FAIL', scenarios: scenarioReports, error: error.message, errors});
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

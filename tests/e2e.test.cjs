'use strict';

const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchBrowser } = require('./browser.cjs');

const root = path.resolve(__dirname, '..');
const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures', 'live-console.html')).href;
let browser;

before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function createPage(query = '') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(fixtureUrl + query);
  await page.addScriptTag({ path: path.join(root, 'extension', 'lib', 'core.js') });
  await page.addScriptTag({ path: path.join(root, 'extension', 'lib', 'adapter.js') });
  return page;
}

test('72 件商品完整识别；指定序号切换并确认蓝色取消讲解状态', { timeout: 30000 }, async () => {
  const page = await createPage('?count=72');
  try {
    const result = await page.evaluate(async () => {
      const adapter = BaiduLiveAdapter.createAdapter(document);
      const scan = await adapter.scan();
      const confirmations = [];
      for (const number of [1, 3, 4, 5]) {
        confirmations.push(await adapter.explain(scan.products.find(product => product.number === number)));
      }
      return { count: scan.products.length, complete: scan.complete, numbers: scan.products.map(p => p.number), confirmations, active: fixture.state.active, clicks: fixture.state.clicks.map(c => c.number), dangerous: fixture.state.dangerousClicks };
    });
    assert.equal(result.count, 72);
    assert.equal(result.complete, true);
    assert.deepEqual(result.numbers, Array.from({ length: 72 }, (_, i) => i + 1));
    assert.deepEqual(result.clicks, [1, 3, 4, 5]);
    assert.ok(result.confirmations.every(value => value.confirmed === true));
    assert.equal(result.active, 5);
    assert.equal(result.dangerous, 0);
    assert.equal(await page.locator('tr[data-number="5"] .explain').textContent(), '取消讲解');
  } finally { await page.close(); }
});

test('150 件分页商品跨页采集及重新定位，没有 100 件上限', { timeout: 45000 }, async () => {
  const page = await createPage('?count=150&mode=paged&pageSize=20');
  try {
    const result = await page.evaluate(async () => {
      const adapter = BaiduLiveAdapter.createAdapter(document);
      const scan = await adapter.scan();
      const first = await adapter.explain(scan.products.find(p => p.number === 1));
      const last = await adapter.explain(scan.products.find(p => p.number === 150));
      return { count: scan.products.length, total: scan.total, complete: scan.complete, first, last, clicks: fixture.state.clicks.map(c => c.number), dangerous: fixture.state.dangerousClicks };
    });
    assert.equal(result.count, 150);
    assert.equal(result.total, 150);
    assert.equal(result.complete, true);
    assert.equal(result.first.confirmed, true);
    assert.equal(result.last.confirmed, true);
    assert.deepEqual(result.clicks, [1, 150]);
    assert.equal(result.dangerous, 0);
  } finally { await page.close(); }
});

test('150 件虚拟滚动商品完整采集，并能定位到首件与末件', { timeout: 45000 }, async () => {
  const page = await createPage('?count=150&mode=virtual');
  try {
    const result = await page.evaluate(async () => {
      const adapter = BaiduLiveAdapter.createAdapter(document, { selectors: { scrollContainer: '.virtual-list' } });
      const scan = await adapter.scan();
      await adapter.explain(scan.products.find(p => p.number === 1));
      await adapter.explain(scan.products.find(p => p.number === 150));
      return { count: scan.products.length, complete: scan.complete, clicks: fixture.state.clicks.map(c => c.number), active: fixture.state.active, dangerous: fixture.state.dangerousClicks };
    });
    assert.equal(result.count, 150);
    assert.equal(result.complete, true);
    assert.deepEqual(result.clicks, [1, 150]);
    assert.equal(result.active, 150);
    assert.equal(result.dangerous, 0);
  } finally { await page.close(); }
});

test('真实 DOM 调度：循环、暂停、继续和停止均控制实际商品按钮', { timeout: 20000 }, async () => {
  const page = await createPage('?count=6');
  try {
    await page.evaluate(async () => {
      window.testRunner = BaiduLiveCore.createRunner({ adapter: BaiduLiveAdapter.createAdapter(document), settings: { plan: '1,3', intervalSeconds: 1, loop: true } });
      await testRunner.scan();
      await testRunner.start();
    });
    await page.waitForFunction(() => fixture.state.clicks.length >= 3);
    const sequence = await page.evaluate(() => fixture.state.clicks.slice(0, 3).map(click => click.number));
    assert.deepEqual(sequence, [1, 3, 1]);
    await page.evaluate(() => testRunner.pause());
    const pausedCount = await page.evaluate(() => fixture.state.clicks.length);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => fixture.state.clicks.length), pausedCount);
    assert.equal(await page.evaluate(() => testRunner.getState().status), 'paused');
    await page.evaluate(() => testRunner.resume());
    await page.waitForFunction(count => fixture.state.clicks.length > count, pausedCount);
    await page.evaluate(() => testRunner.stop());
    const stoppedCount = await page.evaluate(() => fixture.state.clicks.length);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => fixture.state.clicks.length), stoppedCount);
    assert.equal(await page.evaluate(() => testRunner.getState().status), 'stopped');
    assert.equal(await page.evaluate(() => fixture.state.dangerousClicks), 0);
  } finally { await page.close(); }
});

test('浮动面板扫描、生成计划、执行、暂停及配置保存', { timeout: 30000 }, async () => {
  const page = await createPage('?count=12');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const css = fs.readFileSync(path.join(root, 'extension', 'panel.css'), 'utf8');
    await page.evaluate(cssText => {
      window.chrome = {
        runtime: { getURL: () => 'data:text/css;charset=utf-8,' + encodeURIComponent(cssText), onMessage: { addListener(fn) { window.extensionMessageListener = fn; } } },
        storage: { local: { async get(keys) { return window.testStorage || {}; }, async set(value) { window.testStorage = { ...window.testStorage, ...value }; } } },
      };
    }, css);
    await page.addScriptTag({ path: path.join(root, 'extension', 'content.js') });
    const panel = page.locator('#baidu-live-assistant-root');
    await panel.locator('#scan').waitFor();
    await page.waitForFunction(() => !document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#scan').disabled);
    assert.equal(await panel.locator('#interval').inputValue(), '8');
    await panel.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#product-count').textContent === '12');
    assert.equal(await panel.locator('#plan').inputValue(), '1-12');
    await panel.locator('#plan').fill('1,3-4');
    await panel.locator('#interval').fill('1');
    await panel.locator('#start').click();
    await page.waitForFunction(() => fixture.state.active === 1);
    await panel.locator('#pause').click();
    await page.waitForFunction(() => document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#state-badge').textContent === '已暂停');
    const count = await page.evaluate(() => fixture.state.clicks.length);
    await page.waitForTimeout(1250);
    assert.equal(await page.evaluate(() => fixture.state.clicks.length), count);
    await panel.locator('#pause').click();
    await page.waitForFunction(() => fixture.state.active === 3);
    await panel.locator('#stop').click();
    assert.equal(await panel.locator('#state-badge').textContent(), '已停止');
    assert.equal(await page.evaluate(() => testStorage.baiduLiveSettings.plan), '1,3-4');
    assert.equal(await page.evaluate(() => fixture.state.dangerousClicks), 0);
    await panel.locator('[data-action="collapse"]').click();
    assert.equal(await panel.locator('#launcher').isVisible(), true);
    await panel.locator('#launcher').click();
    await panel.locator('.panel').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

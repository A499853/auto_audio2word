const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
const { launchBrowser } = require('./browser.cjs');

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

async function fixture(markup = '') {
  const page = await browser.newPage();
  await page.setContent(`<div>直播商品（2）</div><table><tbody>
    <tr data-product-id="a"><td>1</td><td class="product-title">蓝色运动鞋</td><td><button class="explain">讲解商品</button><button class="danger">删除</button></td></tr>
    <tr data-product-id="b"><td>2</td><td class="product-title">白色运动鞋</td><td><button class="explain">讲解商品</button><button class="danger">下架</button></td></tr>
    ${markup}</tbody></table>`);
  await page.addScriptTag({ path: path.join(__dirname, '../extension/lib/adapter.js') });
  await page.evaluate(() => {
    window.clicks = [];
    window.clickTimes = [];
    window.confirmDelay = 20;
    window.activeNumber = null;
    document.addEventListener('click', event => {
      clicks.push(event.target.textContent);
      clickTimes.push(Date.now());
      if (event.target.matches('.explain') && !window.noConfirm) setTimeout(() => {
        for (const button of document.querySelectorAll('.explain')) button.textContent = '讲解商品';
        event.target.textContent = '取消讲解';
        window.activeNumber = Number(event.target.closest('tr').firstElementChild.textContent);
      }, window.confirmDelay);
    });
    window.adapter = BaiduLiveAdapter.createAdapter(document, { confirmTimeoutMs: 220 });
  });
  return page;
}

test('scan preserves product identity and explain confirms exact control', async () => {
  const page = await fixture();
  try {
    const scan = await page.evaluate(() => adapter.scan());
    assert.equal(scan.complete, true);
    assert.deepEqual(scan.products.map(p => p.number), [1, 2]);
    assert.equal(scan.products[0].id, 'data-product-id:a');
    assert.equal(scan.products[0].title, '蓝色运动鞋');
    const explained = await page.evaluate(async product => adapter.explain(product), scan.products[1]);
    assert.equal(explained.confirmed, true);
    assert.equal(explained.number, 2);
    assert.deepEqual(await page.evaluate(() => clicks), ['讲解商品']);
    const again = await page.evaluate(async product => adapter.explain(product), scan.products[1]);
    assert.equal(again.alreadyActive, true);
    assert.equal((await page.evaluate(() => clicks)).length, 1);
  } finally { await page.close(); }
});

test('aborted operations never click', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const controller = new AbortController();
      controller.abort();
      try { await adapter.explain({ number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' }, { signal: controller.signal }); }
      catch (error) { return { name: error.name, clicks }; }
    });
    assert.equal(result.name, 'AbortError');
    assert.deepEqual(result.clicks, []);
  } finally { await page.close(); }
});

test('reordered/replaced products cannot reuse a planned index', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      document.querySelector('[data-product-id="a"]').setAttribute('data-product-id', 'replacement');
      try { await adapter.explain({ number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' }); }
      catch (error) { return { message: error.message, clicks }; }
    });
    assert.match(result.message, /身份已改变/);
    assert.deepEqual(result.clicks, []);
  } finally { await page.close(); }
});

test('duplicate product numbers fail closed', async () => {
  const page = await fixture('<tr data-product-id="c"><td>1</td><td class="product-title">重复商品</td><td><button class="explain">讲解商品</button></td></tr>');
  try {
    const result = await page.evaluate(async () => {
      try { await adapter.scan(); }
      catch (error) { return error.message; }
    });
    assert.match(result, /对应多个商品|重复行/);
    assert.deepEqual(await page.evaluate(() => clicks), []);
  } finally { await page.close(); }
});

test('inventory count is never inferred as an absent product number', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      for (const row of document.querySelectorAll('tr')) {
        row.firstElementChild.remove();
        const inventory = document.createElement('td');
        inventory.textContent = '99';
        row.append(inventory);
      }
      return adapter.inspect();
    });
    assert.equal(result.rows, 0);
    assert.equal(result.buttons, 2);
  } finally { await page.close(); }
});

test('duplicate fixed-column DOM rows report a selector diagnostic', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const row = document.querySelector('tr');
      row.parentElement.append(row.cloneNode(true));
      try { await adapter.scan(); }
      catch (error) { return error.message; }
    });
    assert.match(result, /固定列/);
    assert.deepEqual(await page.evaluate(() => clicks), []);
  } finally { await page.close(); }
});

test('an unconfirmed click reports failure without repeating the click', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      window.noConfirm = true;
      try { await adapter.explain({ number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' }); }
      catch (error) { return { message: error.message, clicks }; }
    });
    assert.match(result.message, /未变成“取消讲解”/);
    assert.deepEqual(result.clicks, ['讲解商品']);
  } finally { await page.close(); }
});

test('abort after dispatch then resume waits for the original click instead of clicking twice', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      confirmDelay = 140;
      const product = { number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' };
      const controller = new AbortController();
      const first = adapter.explain(product, { signal: controller.signal });
      while (!clicks.length) await new Promise(resolve => setTimeout(resolve, 1));
      controller.abort();
      let aborted;
      try { await first; } catch (error) { aborted = error.name; }
      const resumed = await adapter.explain(product);
      return { aborted, resumed, clicks, activeNumber };
    });
    assert.equal(result.aborted, 'AbortError');
    assert.equal(result.resumed.confirmed, true);
    assert.equal(result.activeNumber, 1);
    assert.deepEqual(result.clicks, ['讲解商品']);
  } finally { await page.close(); }
});

test('changing product after an aborted click waits until the prior response is confirmed', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      confirmDelay = 120;
      const controller = new AbortController();
      const first = adapter.explain({ number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' }, { signal: controller.signal });
      while (!clicks.length) await new Promise(resolve => setTimeout(resolve, 1));
      controller.abort();
      try { await first; } catch (_) { /* Dispatched click is still pending. */ }
      await adapter.explain({ number: 2, id: 'data-product-id:b', title: '白色运动鞋' });
      await new Promise(resolve => setTimeout(resolve, 150));
      return { clicks, clickTimes, activeNumber };
    });
    assert.deepEqual(result.clicks, ['讲解商品', '讲解商品']);
    assert.ok(result.clickTimes[1] - result.clickTimes[0] >= 100);
    assert.equal(result.activeNumber, 2);
  } finally { await page.close(); }
});

test('an expired unconfirmed request blocks later clicks until a fresh scan', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      window.noConfirm = true;
      try { await adapter.explain({ number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' }); } catch (_) {}
      let blocked;
      try { await adapter.explain({ number: 2, id: 'data-product-id:b', title: '白色运动鞋' }); }
      catch (error) { blocked = error.message; }
      const beforeScan = clicks.length;
      await adapter.scan();
      window.noConfirm = false;
      const retried = await adapter.explain({ number: 2, id: 'data-product-id:b', title: '白色运动鞋' });
      return { blocked, beforeScan, retried, clicks };
    });
    assert.match(result.blocked, /已阻止后续点击/);
    assert.equal(result.beforeScan, 1);
    assert.equal(result.retried.confirmed, true);
    assert.deepEqual(result.clicks, ['讲解商品', '讲解商品']);
  } finally { await page.close(); }
});

test('recreating the adapter after stop retains protection for an already dispatched click', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      confirmDelay = 140;
      const product = { number: 1, id: 'data-product-id:a', title: '蓝色运动鞋' };
      const controller = new AbortController();
      const first = adapter.explain(product, { signal: controller.signal });
      while (!clicks.length) await new Promise(resolve => setTimeout(resolve, 1));
      controller.abort();
      try { await first; } catch (_) {}
      const replacement = BaiduLiveAdapter.createAdapter(document, { confirmTimeoutMs: 220 });
      const confirmed = await replacement.explain(product);
      return { confirmed, clicks, activeNumber };
    });
    assert.equal(result.confirmed.confirmed, true);
    assert.equal(result.activeNumber, 1);
    assert.deepEqual(result.clicks, ['讲解商品']);
  } finally { await page.close(); }
});

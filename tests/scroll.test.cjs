'use strict';
const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {launchBrowser} = require('./browser.cjs');
let browser;
before(async () => {browser = await launchBrowser();});
after(async () => {await browser?.close();});

async function fixture(query = '') {
  const page = await browser.newPage({viewport:{width:1440,height:980}});
  await page.goto(pathToFileURL(path.join(__dirname,'fixtures/baidu-console.html')).href + '?layout=nested' + query);
  await page.addScriptTag({path:path.join(__dirname,'../extension/lib/adapter.js')});
  await page.evaluate(() => {
    window.adapter = BaiduLiveAdapter.createAdapter(document);
    window.scrollState = () => ({page:window.scrollY, workbench:document.querySelector('#workbench').scrollTop});
    window.targetVisible = number => {
      const list = document.querySelector('.style_product-card-container__EbuVK');
      const row = document.querySelector(`[data-key="id-test-${number}"]`);
      if (!row) return false;
      const bounds = list.getBoundingClientRect();
      const target = row.getBoundingClientRect();
      const top = bounds.top + list.clientTop;
      return target.top >= top - 1 && target.bottom <= top + list.clientHeight + 1;
    };
  });
  return page;
}

test('跟随只滚动内层商品列表：扫描、跨虚拟行、末件回首件均不移动页面或工作台', {timeout:30000}, async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const initial = scrollState();
      const history = [];
      const scan = await adapter.scan();
      history.push({step:'scan',outer:scrollState()});
      for (const number of [1, 6, 14, 1]) {
        const confirmed = await adapter.explain(scan.products.find(item => item.number === number));
        const list = document.querySelector('.style_product-card-container__EbuVK');
        history.push({step:number,outer:scrollState(),visible:targetVisible(number),confirmed:confirmed.confirmed,
          scrollTop:list.scrollTop,expectedTop:Math.min((number - 1) * 120,list.scrollHeight - list.clientHeight)});
      }
      return {initial,history,total:scan.total,complete:scan.complete,clicks:baiduFixture.state.clicks};
    });
    assert.ok(result.initial.page > 0 && result.initial.workbench > 0);
    assert.equal(result.total,14);
    assert.equal(result.complete,true);
    for (const step of result.history) {
      assert.deepEqual(step.outer,result.initial,`Outer scroll changed during ${step.step}`);
      if (step.step !== 'scan') {
        assert.equal(step.visible,true,`Product ${step.step} must be visible inside its own list`);
        assert.equal(step.confirmed,true);
        assert.ok(Math.abs(step.scrollTop - step.expectedTop) <= 1,`Product ${step.step} must be as high in the list as its scroll range permits`);
      }
    }
    assert.deepEqual(result.clicks,[1,6,14,1]);
  } finally {await page.close();}
});

test('已完整可见的3号也要置顶，末件受列表最大滚动位置限制，外层始终不动', async () => {
  const page = await fixture('&mode=all');
  try {
    const result = await page.evaluate(async () => {
      const scan = await adapter.scan();
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.scrollTo({top:120,behavior:'instant'});
      list.dispatchEvent(new Event('scroll'));
      const initial = scrollState();
      const thirdVisibleBefore = targetVisible(3);
      await adapter.explain(scan.products.find(item => item.number === 3));
      const third = document.querySelector('[data-key="id-test-3"]').getBoundingClientRect();
      const listTop = list.getBoundingClientRect().top + list.clientTop;
      const thirdStep = {scrollTop:list.scrollTop,topGap:third.top-listTop,outer:scrollState()};
      await adapter.explain(scan.products.find(item => item.number === 14));
      return {initial,thirdVisibleBefore,thirdStep,lastTop:list.scrollTop,maxTop:list.scrollHeight-list.clientHeight,
        lastVisible:targetVisible(14),after:scrollState(),clicks:baiduFixture.state.clicks};
    });
    assert.equal(result.thirdVisibleBefore,true, 'Regression must begin with a fully visible product below the list top');
    assert.ok(Math.abs(result.thirdStep.topGap) <= 1, 'A visible product must still move to the list top');
    assert.equal(result.thirdStep.scrollTop,240);
    assert.equal(result.lastTop,result.maxTop);
    assert.equal(result.lastVisible,true);
    assert.deepEqual(result.thirdStep.outer,result.initial);
    assert.deepEqual(result.after,result.initial);
    assert.deepEqual(result.clicks,[3,14]);
  } finally {await page.close();}
});

test('已在讲解的离屏商品仍在列表内跟随，不重复点击取消讲解', async () => {
  const page = await fixture('&mode=all');
  try {
    const result = await page.evaluate(async () => {
      const initial = scrollState();
      const scan = await adapter.scan();
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.scrollTo({top:list.scrollHeight,behavior:'instant'});
      list.dispatchEvent(new Event('scroll'));
      const visibleBefore = targetVisible(4);
      const confirmed = await adapter.explain(scan.products.find(item => item.number === 4));
      return {initial,after:scrollState(),visibleBefore,visible:targetVisible(4),scrollTop:list.scrollTop,confirmed,clicks:baiduFixture.state.clicks};
    });
    assert.equal(result.visibleBefore,false);
    assert.equal(result.visible,true);
    assert.equal(result.scrollTop,360);
    assert.deepEqual(result.after,result.initial);
    assert.equal(result.confirmed.alreadyActive,true);
    assert.deepEqual(result.clicks,[]);
  } finally {await page.close();}
});

test('没有内层滚动时不退回滚动外层工作台或整个文档', async () => {
  const page = await fixture('&mode=all');
  try {
    const result = await page.evaluate(async () => {
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.style.height = 'auto';
      list.style.overflow = 'visible';
      const initial = scrollState();
      const scan = await adapter.scan();
      const scanned = scrollState();
      const confirmed = await adapter.explain(scan.products.find(item => item.number === 14));
      return {initial,scanned,after:scrollState(),confirmed,clicks:baiduFixture.state.clicks};
    });
    assert.deepEqual(result.scanned,result.initial);
    assert.deepEqual(result.after,result.initial);
    assert.equal(result.confirmed.confirmed,true);
    assert.deepEqual(result.clicks,[14]);
  } finally {await page.close();}
});

test('普通表格没有独立滚动容器时，扫描和讲解保持文档位置', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(path.join(__dirname,'fixtures/live-console.html')).href);
    await page.addScriptTag({path:path.join(__dirname,'../extension/lib/adapter.js')});
    const result = await page.evaluate(async () => {
      window.scrollTo(0,300);
      const initial = window.scrollY;
      const adapter = BaiduLiveAdapter.createAdapter(document);
      const scan = await adapter.scan();
      const scanned = window.scrollY;
      const confirmed = await adapter.explain(scan.products.at(-1));
      return {initial,scanned,after:window.scrollY,confirmed};
    });
    assert.equal(result.scanned,result.initial);
    assert.equal(result.after,result.initial);
    assert.equal(result.confirmed.confirmed,true);
  } finally {await page.close();}
});

test('关闭跟随时已渲染商品照常讲解，列表和外层位置均不改变', async () => {
  const page = await fixture('&mode=all');
  try {
    const result = await page.evaluate(async () => {
      const adapter = BaiduLiveAdapter.createAdapter(document, {shouldFollow:() => false});
      const scan = await adapter.scan();
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.scrollTo({top:240,behavior:'instant'});
      list.dispatchEvent(new Event('scroll'));
      const before = {outer:scrollState(),list:list.scrollTop};
      const confirmed = await adapter.explain(scan.products.find(item => item.number === 14));
      return {before,after:{outer:scrollState(),list:list.scrollTop},confirmed,visible:targetVisible(14),clicks:baiduFixture.state.clicks};
    });
    assert.deepEqual(result.after,result.before);
    assert.equal(result.confirmed.confirmed,true);
    assert.equal(result.visible,false);
    assert.deepEqual(result.clicks,[14]);
  } finally {await page.close();}
});

test('关闭跟随仍能定位虚拟首末商品并恢复浏览位置，同一适配器重新开启后继续跟随', {timeout:30000}, async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      let following = false;
      const adapter = BaiduLiveAdapter.createAdapter(document, {shouldFollow:() => following});
      const scan = await adapter.scan();
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.scrollTo({top:480,behavior:'instant'});
      list.dispatchEvent(new Event('scroll'));
      const before = {outer:scrollState(),list:list.scrollTop};
      const offSteps = [];
      for (const number of [1,14]) {
        const confirmed = await adapter.explain(scan.products.find(item => item.number === number));
        offSteps.push({outer:scrollState(),list:list.scrollTop,confirmed:confirmed.confirmed});
      }
      following = true;
      const again = await adapter.explain(scan.products.find(item => item.number === 14));
      return {before,offSteps,after:scrollState(),visible:targetVisible(14),again,clicks:baiduFixture.state.clicks};
    });
    for (const step of result.offSteps) {
      assert.deepEqual(step.outer,result.before.outer);
      assert.equal(step.list,result.before.list);
      assert.equal(step.confirmed,true);
    }
    assert.deepEqual(result.after,result.before.outer);
    assert.equal(result.visible,true);
    assert.equal(result.again.alreadyActive,true);
    assert.deepEqual(result.clicks,[1,14], 'Re-enabling follow must not cancel the active product');
  } finally {await page.close();}
});

test('关闭跟随后点击期间停止，后台只确认原点击并恢复列表，不需要再调用下一件', {timeout:10000}, async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const adapter = BaiduLiveAdapter.createAdapter(document, {shouldFollow:() => false});
      const scan = await adapter.scan();
      const list = document.querySelector('.style_product-card-container__EbuVK');
      list.scrollTo({top:480,behavior:'instant'});
      list.dispatchEvent(new Event('scroll'));
      const before = {outer:scrollState(),list:list.scrollTop};
      const originalTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback,ms,...args) => originalTimeout(callback,ms === 25 ? 400 : ms,...args);
      const controller = new AbortController();
      const pending = adapter.explain(scan.products.find(item => item.number === 14), {signal:controller.signal});
      while (!baiduFixture.state.clicks.length) await new Promise(resolve => originalTimeout(resolve,5));
      controller.abort();
      let errorName;
      try {await pending;} catch (error) {errorName = error.name;}
      await new Promise(resolve => originalTimeout(resolve,700));
      return {before,after:{outer:scrollState(),list:list.scrollTop},errorName,active:baiduFixture.state.active,clicks:baiduFixture.state.clicks};
    });
    assert.equal(result.errorName,'AbortError');
    assert.equal(result.active,14);
    assert.deepEqual(result.after,result.before);
    assert.deepEqual(result.clicks,[14]);
  } finally {await page.close();}
});

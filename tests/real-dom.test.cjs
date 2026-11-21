'use strict';
const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {launchBrowser} = require('./browser.cjs');
const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures/baidu-console.html')).href;
let browser;
before(async () => {browser = await launchBrowser();});
after(async () => {await browser?.close();});
async function fixture(query = '') {
  const page = await browser.newPage({viewport:{width:1440,height:980}});
  await page.goto(fixtureUrl + query);
  await page.addScriptTag({path:path.join(__dirname,'../extension/lib/core.js')});
  await page.addScriptTag({path:path.join(__dirname,'../extension/lib/adapter.js')});
  await page.evaluate(() => {window.adapter = BaiduLiveAdapter.createAdapter(document);});
  return page;
}

test('百度真实卡片结构：读取 input.value 序号、data-key 身份和纯商品标题', {timeout:30000}, async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const renderedBefore = document.querySelectorAll('[data-key]').length;
      const scan = await adapter.scan();
      return {renderedBefore, scan};
    });
    assert.ok(result.renderedBefore < 14, 'fixture must really virtualize rows');
    assert.equal(result.scan.complete,true);
    assert.equal(result.scan.total,14);
    assert.deepEqual(result.scan.products.map(p=>p.number),Array.from({length:14},(_,i)=>i+1));
    for (const product of result.scan.products) {
      assert.equal(product.id,`data-key:id-test-${product.number}`);
      assert.equal(product.title,`测试商品 ${product.number} 舒适地垫`);
    }
  } finally {await page.close();}
});

test('百度真实 div 按钮：14 件跨滚动完整执行后循环至首件，不点击其他操作', {timeout:45000}, async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const runner = BaiduLiveCore.createRunner({adapter,settings:{plan:'1-14',intervalSeconds:86400,loop:true}});
      await runner.scan();
      await runner.start();
      for (let i=0;i<14;i++) await runner.next();
      const state = runner.getState();
      runner.stop();
      return {state,clicks:baiduFixture.state.clicks,active:baiduFixture.state.active,dangerous:baiduFixture.state.dangerousClicks};
    });
    assert.deepEqual(result.clicks,[...Array.from({length:14},(_,i)=>i+1),1]);
    assert.equal(result.state.successes,15);
    assert.equal(result.state.failures,0);
    assert.equal(result.state.cycle,2);
    assert.equal(result.active,1);
    assert.equal(result.dangerous,0);
  } finally {await page.close();}
});

test('序号编辑框读取当前 value，不能使用过期 value 属性', async () => {
  const page = await fixture('?mode=all');
  try {
    const result = await page.evaluate(async () => {
      const replacements = Object.fromEntries(Array.from({length:14},(_,i)=>[i+1,String(i+101)]));
      baiduFixture.setIndexes(replacements);
      const first=document.querySelector('.style_index-input__FEDkB');
      const attribute=first.getAttribute('value');
      const value=first.value;
      const scan=await adapter.scan();
      return {attribute,value,scan};
    });
    assert.equal(result.attribute,'1');
    assert.equal(result.value,'101');
    assert.deepEqual(result.scan.products.map(p=>p.number),Array.from({length:14},(_,i)=>i+101));
  } finally {await page.close();}
});

test('空白或隐藏的真实序号不得回退为库存、标题数字或过期属性', async () => {
  const page = await fixture('?mode=all');
  try {
    const result=await page.evaluate(()=>{
      baiduFixture.setIndexes(Object.fromEntries(Array.from({length:14},(_,i)=>[i+1,''])));
      const blank=adapter.inspect();
      baiduFixture.setIndexes({});
      baiduFixture.state.hiddenIndexes=true;baiduFixture.render();
      const hidden=adapter.inspect();
      return {blank,hidden,clicks:baiduFixture.state.clicks};
    });
    assert.equal(result.blank.rows,0);
    assert.equal(result.hidden.rows,0);
    assert.deepEqual(result.clicks,[]);
  } finally {await page.close();}
});

'use strict';
const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {launchBrowser} = require('./browser.cjs');
const root = path.resolve(__dirname, '..');
let browser;
before(async () => {browser = await launchBrowser();});
after(async () => {await browser?.close();});

async function createPanel(count, savedSettings) {
  const page = await browser.newPage({viewport:{width:1440,height:980}});
  await page.goto(pathToFileURL(path.join(__dirname,'fixtures/live-console.html')).href + `?count=${count}`);
  for (const file of ['lib/core.js','lib/adapter.js']) await page.addScriptTag({path:path.join(root,'extension',file)});
  await page.evaluate(({css, savedSettings}) => {
    window.testStorage = savedSettings ? {baiduLiveSettings:savedSettings} : {};
    window.chrome = {
      runtime: {getURL:() => 'data:text/css;charset=utf-8,' + encodeURIComponent(css), onMessage:{addListener(){}}},
      storage: {local:{async get(){return testStorage;}, async set(value){Object.assign(testStorage,value);}}}
    };
  }, {css:fs.readFileSync(path.join(root,'extension/panel.css'),'utf8'),savedSettings});
  await page.addScriptTag({path:path.join(root,'extension/content.js')});
  await page.waitForFunction(() => !document.querySelector('#baidu-live-assistant-root')?.shadowRoot.querySelector('#scan').disabled);
  return {page,panel:page.locator('#baidu-live-assistant-root')};
}

test('面板默认生成1-200且默认循环，超出200项给出提示而不点击商品', async () => {
  const {page,panel} = await createPanel(200);
  try {
    assert.equal(await panel.locator('#range-start').inputValue(),'1');
    assert.equal(await panel.locator('#range-end').inputValue(),'200');
    assert.equal(await panel.locator('#loop').isChecked(),true);
    await panel.locator('details.generator-details > summary').click();
    await panel.locator('[data-action="generate"]').click();
    assert.equal(await panel.locator('#plan').inputValue(),'1-200');
    await panel.locator('#range-end').fill('201');
    await panel.locator('[data-action="generate"]').click();
    assert.match(await panel.locator('#notice').textContent(),/最多 200 项/);
    assert.equal(await panel.locator('#plan').inputValue(),'1-200');
    assert.equal(await page.evaluate(() => fixture.state.clicks.length),0);
  } finally {await page.close();}
});

test('201件商品完整扫描后只自动生成前200项计划并保存', async () => {
  const {page,panel} = await createPanel(201);
  try {
    await panel.locator('#scan').click();
    await page.waitForFunction(() => {
      const shadow = document.querySelector('#baidu-live-assistant-root').shadowRoot;
      return shadow.querySelector('#product-count').textContent === '201' && !shadow.querySelector('#scan').disabled;
    });
    assert.equal(await panel.locator('#plan').inputValue(),'1-200');
    assert.equal(await panel.locator('#range-end').inputValue(),'200');
    assert.match(await panel.locator('#notice').textContent(),/前 200 件/);
    assert.equal(await panel.locator('#catalog-quality').textContent(),'采集完成');
    assert.equal(await page.evaluate(() => testStorage.baiduLiveSettings.plan),'1-200');
    assert.equal(await page.evaluate(() => fixture.state.clicks.length),0);
  } finally {await page.close();}
});

test('升级时只清空超长旧计划，保留已保存的间隔、循环偏好及自定义选择器', async () => {
  const saved = {plan:'1-201',intervalSeconds:12,loop:false,selectors:{row:'tr[data-product-id]',number:'.product-number',explain:'.explain'}};
  const {page,panel} = await createPanel(14,saved);
  try {
    assert.equal(await panel.locator('#plan').inputValue(),'');
    assert.equal(await panel.locator('#interval').inputValue(),'12');
    assert.equal(await panel.locator('#loop').isChecked(),false);
    const restored = await page.evaluate(() => testStorage.baiduLiveSettings);
    assert.equal(restored.plan,'');
    assert.equal(restored.intervalSeconds,12);
    assert.equal(restored.loop,false);
    for (const [key,value] of Object.entries(saved.selectors)) assert.equal(restored.selectors[key],value);
    assert.match(await panel.locator('#notice').textContent(),/保留其他设置/);
    assert.equal(await page.evaluate(() => fixture.state.clicks.length),0);
  } finally {await page.close();}
});

test('旧配置默认开启列表跟随，关闭后立即保存并在重新打开面板时恢复', async () => {
  const oldSettings = {plan:'1-3',intervalSeconds:8,loop:true};
  const {page,panel} = await createPanel(14,oldSettings);
  let saved;
  try {
    assert.equal(await panel.locator('#follow-current').isChecked(),true);
    await panel.locator('#follow-current').uncheck();
    await page.waitForFunction(() => testStorage.baiduLiveSettings.followCurrent === false);
    saved = await page.evaluate(() => testStorage.baiduLiveSettings);
    assert.equal(saved.plan,oldSettings.plan);
    assert.equal(saved.intervalSeconds,oldSettings.intervalSeconds);
    assert.equal(saved.loop,oldSettings.loop);
    assert.equal(await page.evaluate(() => fixture.state.clicks.length),0);
  } finally {await page.close();}
  const restored = await createPanel(14,saved);
  try {
    assert.equal(await restored.panel.locator('#follow-current').isChecked(),false);
  } finally {await restored.page.close();}
});

test('讲解运行中可随时开关列表跟随且立即保存，计划仍可推进', async () => {
  const {page,panel} = await createPanel(14,{plan:'1,2',intervalSeconds:86400,loop:true});
  try {
    await panel.locator('#scan').click();
    await page.waitForFunction(() => !document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#scan').disabled);
    await panel.locator('#start').click();
    await page.waitForFunction(() => fixture.state.active === 1);
    assert.equal(await panel.locator('#follow-current').isEnabled(),true);
    await panel.locator('#follow-current').uncheck();
    await page.waitForFunction(() => testStorage.baiduLiveSettings.followCurrent === false);
    assert.equal(await panel.locator('#state-badge').textContent(),'正在讲解');
    await panel.locator('#next').click();
    await page.waitForFunction(() => fixture.state.active === 2);
    assert.equal(await panel.locator('#follow-current').isChecked(),false);
    await panel.locator('#follow-current').check();
    await page.waitForFunction(() => testStorage.baiduLiveSettings.followCurrent === true);
    await panel.locator('#stop').click();
    assert.equal(await panel.locator('#state-badge').textContent(),'已停止');
    assert.deepEqual(await page.evaluate(() => fixture.state.clicks.map(item => item.number)),[1,2]);
  } finally {await page.close();}
});

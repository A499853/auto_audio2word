'use strict';

const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {launchBrowser} = require('./browser.cjs');
const root = path.resolve(__dirname, '..');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function mount(page) {
  const css = fs.readFileSync(path.join(root, 'extension/panel.css'), 'utf8');
  await page.evaluate(cssText => {
    window.chrome = {
      runtime: {getURL: () => `data:text/css;charset=utf-8,${encodeURIComponent(cssText)}`, onMessage: {addListener() {}}},
      storage: {local: {
        async get() {return JSON.parse(localStorage.getItem('drag-test-settings') || '{}');},
        async set(value) {localStorage.setItem('drag-test-settings', JSON.stringify({...JSON.parse(localStorage.getItem('drag-test-settings') || '{}'), ...value}));}
      }}
    };
  }, css);
  for (const file of ['lib/core.js','lib/adapter.js','content.js']) await page.addScriptTag({path:path.join(root,'extension',file)});
  await page.waitForFunction(() => {
    const root = document.querySelector('#baidu-live-assistant-root');
    return root?.shadowRoot.querySelector('#scan').disabled === false && getComputedStyle(root).position === 'fixed';
  });
}
async function createPage() {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(pathToFileURL(path.join(__dirname,'fixtures/live-console.html')).href + '?count=6');
  await page.evaluate(() => localStorage.removeItem('drag-test-settings'));
  await mount(page);
  return page;
}
const panelOf = page => page.locator('#baidu-live-assistant-root');
async function dragHandle(page, handle, dx, dy) {
  const box = await handle.boundingBox();
  const x = box.x + Math.min(100, box.width/2), y = box.y + box.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  await page.mouse.move(x+dx,y+dy,{steps:8}); await page.mouse.up();
}
const closeEnough = (a,b) => assert.ok(Math.abs(a-b) <= 2, `${a} should equal ${b}`);

test('标题栏可以拖动，刷新后恢复位置，输入区不会触发拖动', async () => {
  const page=await createPage();
  try {
    const panel=panelOf(page);
    const initial=await panel.boundingBox();
    await dragHandle(page,panel.locator('.header'),-420,50);
    const moved=await panel.boundingBox();
    closeEnough(moved.x,initial.x-420); closeEnough(moved.y,initial.y+50);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('drag-test-settings')).baiduLiveAppearance.position);
    closeEnough(saved.left,moved.x);closeEnough(saved.top,moved.y);
    await dragHandle(page,panel.locator('#plan'),-100,20);
    const afterInput=await panel.boundingBox();closeEnough(afterInput.x,moved.x);closeEnough(afterInput.y,moved.y);
    await page.reload();await mount(page);
    const restored=await panelOf(page).boundingBox();closeEnough(restored.x,moved.x);closeEnough(restored.y,moved.y);
  }finally{await page.close();}
});

test('折叠条拖动不会误展开，单击仍展开，吸附按钮恢复默认位置', async () => {
  const page=await createPage();
  try{
    const panel=panelOf(page);
    await panel.locator('[data-action="collapse"]').click();
    const start=await panel.boundingBox();
    await dragHandle(page,panel.locator('#launcher'),-600,150);
    assert.equal(await panel.locator('#launcher').isVisible(),true);
    assert.equal(await panel.locator('.panel').isVisible(),false);
    const moved=await panel.boundingBox();closeEnough(moved.x,start.x-600);closeEnough(moved.y,start.y+150);
    await panel.locator('#launcher').click();
    assert.equal(await panel.locator('.panel').isVisible(),true);
    await panel.locator('[data-action="dock"]').click();
    assert.equal(await panel.getAttribute('data-floating'),null);
    closeEnough((await panel.boundingBox()).x,22);
  }finally{await page.close();}
});

test('拖动与窗口缩小均限制面板在视口内，折叠后展开不越界', async () => {
  const page=await createPage();
  try{
    const panel=panelOf(page);
    await dragHandle(page,panel.locator('.header'),-3000,-3000);
    let box=await panel.boundingBox();closeEnough(box.x,8);closeEnough(box.y,8);
    await panel.locator('[data-action="collapse"]').click();
    await dragHandle(page,panel.locator('#launcher'),3000,3000);
    box=await panel.boundingBox();assert.ok(box.x+box.width<=1433);assert.ok(box.y+box.height<=993);
    await panel.locator('#launcher').click();
    box=await panel.boundingBox();assert.ok(box.x+box.width<=1433);assert.ok(box.y+box.height<=993);
    await page.setViewportSize({width:700,height:700});
    await page.waitForFunction(()=>{
      const rect=document.querySelector('#baidu-live-assistant-root').getBoundingClientRect();
      return rect.right<=window.innerWidth-7 && rect.bottom<=window.innerHeight-7;
    });
    box=await panel.boundingBox();assert.ok(box.x>=8&&box.y>=8);assert.ok(box.x+box.width<=693);assert.ok(box.y+box.height<=693);
  }finally{await page.close();}
});

test('讲解运行中可拖动，停止按钮仍立即阻止后续切换', async () => {
  const page=await createPage();
  try{
    const panel=panelOf(page);
    await panel.locator('#plan').fill('1-3');await panel.locator('#interval').fill('1');
    await panel.locator('#start').click();await page.waitForFunction(()=>fixture.state.active===1);
    await dragHandle(page,panel.locator('.header'),-400,20);
    await panel.locator('#stop').click();
    assert.equal(await panel.locator('#state-badge').textContent(),'已停止');
    const count=await page.evaluate(()=>fixture.state.clicks.length);
    await page.waitForTimeout(1250);
    assert.equal(await page.evaluate(()=>fixture.state.clicks.length),count);
  }finally{await page.close();}
});

test('紧凑主视图不超过500px，常用控制直接可见，序号生成按需展开', async () => {
  const page=await createPage();
  try {
    await page.setViewportSize({width:1440,height:900});
    const panel=panelOf(page);
    async function checkCompact() {
      const bounds=await panel.locator('.panel').boundingBox();
      assert.ok(bounds.height<=500,`Compact panel height ${bounds.height} exceeds 500px`);
      assert.ok(bounds.width<=340,`Compact panel width ${bounds.width} exceeds 340px`);
      for (const selector of ['#plan','#interval','#loop','#follow-current','#start','#pause','#stop']) {
        assert.equal(await panel.locator(selector).isVisible(),true,`${selector} must be directly visible`);
        const control=await panel.locator(selector).boundingBox();
        assert.ok(control.y>=bounds.y && control.y+control.height<=bounds.y+bounds.height,`${selector} must fit inside the panel`);
      }
    }
    await checkCompact();
    assert.equal(await panel.locator('#range-end').isVisible(),false);
    await panel.locator('details.generator-details > summary').click();
    assert.equal(await panel.locator('#range-end').isVisible(),true);
    await panel.locator('#range-end').fill('6');
    await panel.locator('[data-action="generate"]').click();
    assert.equal(await panel.locator('#plan').inputValue(),'1-6');
    await panel.locator('details.generator-details > summary').click();
    await panel.locator('#scan').click();
    await page.waitForFunction(()=>!document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#scan').disabled);
    await checkCompact();
  } finally {await page.close();}
});

test('折叠浮条显示确认商品序号，折叠中随讲解更新，暂停停止保留最近序号', {timeout:15000}, async () => {
  const page=await createPage();
  try {
    const panel=panelOf(page);
    await panel.locator('#plan').fill('1,2');
    await panel.locator('#interval').fill('2');
    await panel.locator('#start').click();
    await page.waitForFunction(()=>/1\s*号/.test(document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#mini-status').textContent));
    await panel.locator('[data-action="collapse"]').click();
    assert.equal(await panel.locator('#launcher').isVisible(),true);
    assert.match(await panel.locator('#mini-status').textContent(),/正在讲解.*1\s*号/);
    await page.waitForFunction(()=>/2\s*号/.test(document.querySelector('#baidu-live-assistant-root').shadowRoot.querySelector('#mini-status').textContent));
    assert.equal(await panel.locator('.panel').isVisible(),false);
    assert.match(await panel.locator('#mini-status').textContent(),/正在讲解.*2\s*号/);
    await panel.locator('#launcher').click();
    await panel.locator('#pause').click();
    await panel.locator('[data-action="collapse"]').click();
    assert.match(await panel.locator('#mini-status').textContent(),/已暂停.*2\s*号/);
    await panel.locator('#launcher').click();
    await panel.locator('#stop').click();
    await panel.locator('[data-action="collapse"]').click();
    assert.match(await panel.locator('#mini-status').textContent(),/已停止.*2\s*号/);
    assert.deepEqual(await page.evaluate(()=>fixture.state.clicks.map(item=>item.number)),[1,2]);
  } finally {await page.close();}
});

'use strict';
// Read a locally saved console HTML without running its scripts or fetching
// any resource. Only the product section is attached to the test document.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {launchBrowser} = require('../tests/browser.cjs');
const root = path.resolve(__dirname, '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/check-saved-page.cjs <saved-console.html>');

(async () => {
  const raw = fs.readFileSync(path.resolve(source), 'utf8');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const evidence = await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const firstProduct = parsed.querySelector('[data-key][class*="product-card-container"]');
      const productPanel = firstProduct?.closest('[class*="right-part__"]');
      if (!productPanel) throw new Error('未找到保存页面中的商品区域');
      productPanel.querySelectorAll('script,link,iframe,object,embed,video,audio,source,img,style').forEach(node => node.remove());
      for (const node of productPanel.querySelectorAll('*')) {
        for (const attribute of [...node.attributes]) {
          if (/^on/i.test(attribute.name) || ['src','href','srcset'].includes(attribute.name)) node.removeAttribute(attribute.name);
        }
      }
      document.body.replaceChildren(document.importNode(productPanel, true));
      return {renderedCards: document.querySelectorAll('[data-key][class*="product-card-container"]').length, indexValues: [...document.querySelectorAll('input[class*="index-input"]')].map(input => input.value)};
    }, raw);
    const previous = execFileSync('git', ['show', 'HEAD:extension/lib/adapter.js'], {cwd: root, encoding: 'utf8'});
    await page.addScriptTag({content: previous});
    const before = await page.evaluate(() => {
      const adapter = BaiduLiveAdapter.createAdapter(document);
      const info = adapter.inspect();
      return {buttons: info.buttons, recognized: info.rows};
    });
    await page.addScriptTag({path: path.join(root, 'extension/lib/adapter.js')});
    const after = await page.evaluate(() => {
      const adapter = BaiduLiveAdapter.createAdapter(document);
      const info = adapter.inspect();
      return {buttons: info.buttons, recognized: info.rows, numbers: info.products.map(item => item.number), boundToDataKey: info.products.every(item => item.id.startsWith('data-key:'))};
    });
    console.log(JSON.stringify({evidence, before, after}, null, 2));
    if (after.recognized !== evidence.renderedCards || after.recognized === 0 || !after.boundToDataKey) process.exitCode = 1;
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});

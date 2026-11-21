/* global BaiduLiveCore, BaiduLiveAdapter */
(() => {
  'use strict';
  if (globalThis.__baiduLiveAssistant) return;
  globalThis.__baiduLiveAssistant = true;

  const core = globalThis.BaiduLiveCore;
  if (!core || !globalThis.BaiduLiveAdapter) {
    console.error('[百度直播助手] 扩展文件未完整加载，请刷新页面。');
    return;
  }

  const host = document.createElement('div');
  host.id = 'baidu-live-assistant-root';
  host.setAttribute('data-baidu-live-assistant', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('panel.css');
  shadow.append(stylesheet);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <button class="launcher" id="launcher" type="button" aria-label="展开商品讲解助手" hidden><span class="launcher-icon">讲</span><span>商品讲解助手</span><span id="mini-status" class="mini-status">未运行</span></button>
    <section class="panel" aria-label="百度直播商品讲解助手">
      <header class="header"><div class="brand-icon" aria-hidden="true">讲</div><div class="brand"><strong>商品讲解助手</strong><span>百度直播 · 按计划自动弹窗</span></div><button class="icon-button" type="button" data-action="collapse" title="折叠面板" aria-label="折叠面板">−</button></header>
      <nav class="tabs" role="tablist" aria-label="助手功能"><button id="tab-plan" type="button" role="tab" aria-selected="true" aria-controls="view-plan" data-tab="plan">商品弹窗</button><button id="tab-logs" type="button" role="tab" aria-selected="false" aria-controls="view-logs" data-tab="logs" tabindex="-1">运行记录 <span id="log-count" class="tab-count">0</span></button><button id="tab-settings" type="button" role="tab" aria-selected="false" aria-controls="view-settings" data-tab="settings" tabindex="-1">设置</button></nav>
      <div class="panel-body">
        <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
        <div id="view-plan" class="tab-view" role="tabpanel" aria-labelledby="tab-plan">
          <div class="section-top"><span class="section-title">商品列表</span><button class="text-button" type="button" data-action="scan" id="scan">扫描商品</button></div>
          <div class="catalog-summary"><span>已识别 <strong id="product-count">0</strong> 件商品</span><span id="catalog-quality" class="muted">请先扫描</span></div>
          <label class="field-label" for="plan">商品弹窗计划</label>
          <textarea id="plan" rows="2" spellcheck="false" placeholder="例如：1-72，或 1,3,5-8" aria-describedby="plan-help"></textarea>
          <p class="field-help" id="plan-help">按填写顺序讲解；支持逗号、空格和序号范围。</p>
          <div class="generator"><span>序号生成</span><input id="range-start" type="number" min="1" max="1000000" value="1" aria-label="起始商品序号"><span>至</span><input id="range-end" type="number" min="1" max="1000000" value="72" aria-label="结束商品序号"><button class="secondary small" type="button" data-action="generate">生成</button></div>
          <div class="timing"><label for="interval">弹窗间隔 <span class="number-input"><input id="interval" type="number" min="1" max="86400" step="1" value="8" aria-label="商品弹窗间隔秒数"><span>秒</span></span></label><label class="checkbox"><input id="loop" type="checkbox" checked>循环讲解</label></div>
          <div class="run-controls"><button class="primary" type="button" id="start" data-action="start">开启自动弹窗</button><button class="secondary" type="button" id="pause" data-action="pause" disabled>暂停</button><button class="secondary" type="button" id="stop" data-action="stop" disabled>停止</button></div>
          <div class="status-card"><div class="status-top"><span id="state-badge" class="status-badge" data-state="idle">未运行</span><span id="countdown" class="countdown">等待开始</span></div><strong id="current-product" class="current-product">准备好计划，开始自动讲解</strong><div id="run-message" class="status-message">首次使用请登录百度直播并进入直播商品列表。</div><div class="status-bottom"><span id="progress">成功 0 · 失败 0</span><button type="button" class="text-button" data-action="next" id="next" disabled>立即下一件 →</button></div></div>
          <details class="products-details"><summary>查看已识别商品 <span id="list-total">0</span></summary><input type="search" id="product-search" placeholder="搜索序号或商品名称" aria-label="搜索已识别商品"><div class="product-list" id="product-list"><p class="empty">扫描后将在这里显示商品。</p></div><div class="list-pagination"><button type="button" class="text-button" data-action="previous-products" id="previous-products" disabled>上一页</button><span id="product-page">0 / 0</span><button type="button" class="text-button" data-action="next-products" id="next-products" disabled>下一页</button></div></details>
        </div>
        <div id="view-logs" class="tab-view" role="tabpanel" aria-labelledby="tab-logs" hidden><div class="section-top"><span class="section-title">运行记录</span><div><button type="button" class="text-button" data-action="export-logs">导出</button><button type="button" class="text-button" data-action="clear-logs">清空</button></div></div><p class="field-help">保留本页最近 300 条记录，刷新页面后清空。</p><ol id="logs" class="logs"><li class="empty">开始扫描或运行后，操作结果会显示在这里。</li></ol></div>
        <div id="view-settings" class="tab-view" role="tabpanel" aria-labelledby="tab-settings" hidden><div class="section-top"><span class="section-title">计划与配置</span></div><p class="settings-copy">计划、间隔与识别设置保存在当前浏览器。刷新页面后需手动开启自动弹窗。</p><div class="settings-actions"><button class="secondary" type="button" data-action="save">保存配置</button><button class="secondary" type="button" data-action="export-settings">导出配置</button><button class="secondary" type="button" data-action="import-settings">导入配置</button><input id="import-file" type="file" accept="application/json,.json" hidden></div><details class="advanced"><summary>高级商品识别设置</summary><p class="field-help">默认自动识别。只有页面结构发生变化时才需填写 CSS 选择器；留空使用自动检测。请停止任务后修改。</p><label class="field-label" for="selector-row">商品行</label><input id="selector-row" type="text" placeholder="例如：.ant-table-tbody > tr" spellcheck="false"><label class="field-label" for="selector-number">行内商品序号</label><input id="selector-number" type="text" placeholder="相对于商品行的选择器" spellcheck="false"><label class="field-label" for="selector-title">行内商品名称</label><input id="selector-title" type="text" placeholder="相对于商品行的选择器" spellcheck="false"><label class="field-label" for="selector-explain">行内讲解按钮</label><input id="selector-explain" type="text" placeholder="仍会校验“讲解商品 / 取消讲解”文字" spellcheck="false"><label class="field-label" for="selector-nextPage">下一页按钮</label><input id="selector-nextPage" type="text" placeholder="例如：.ant-pagination-next" spellcheck="false"><label class="field-label" for="selector-scrollContainer">商品滚动容器</label><input id="selector-scrollContainer" type="text" placeholder="例如：.ant-table-body" spellcheck="false"></details><div class="diagnostics"><strong>页面诊断</strong><p class="field-help">识别不到商品时，导出当前识别结果与配置以便排查。诊断不包含账号密码或 Cookie。</p><button class="secondary" type="button" data-action="diagnostics">导出诊断信息</button></div></div>
      </div>
      <footer class="footer"><button class="text-button" type="button" data-action="save" title="保存计划和设置">保存</button><span class="footer-hint">页面保持打开即可运行</span><button class="icon-button" type="button" data-action="dock" title="切换左右位置" aria-label="切换面板左右位置">⇆</button></footer>
    </section>`;
  shadow.append(wrapper);
  (document.documentElement || document.body).append(host);
  const $ = id => shadow.getElementById(id);
  let settings = { ...core.DEFAULT_SETTINGS, selectors: { ...core.DEFAULT_SETTINGS.selectors } };
  let adapter;
  let runner;
  let state = { status: 'idle', products: [], total: 0, complete: false, warnings: [], successes: 0, failures: 0, index: 0, cycle: 1 };
  let appearance = { dock: 'right', collapsed: false };
  let logs = [];
  let productPage = 0;
  let productSignature = '';
  let busy = false;
  let noticeTimer;
  const activeStatuses = new Set(['running', 'paused', 'scanning']);
  const names = { idle: '未运行', scanning: '扫描中', running: '正在讲解', paused: '已暂停', stopped: '已停止', error: '需要处理', completed: '本轮完成' };
  const selectorKeys = ['row', 'number', 'title', 'explain', 'nextPage', 'scrollContainer'];

  function showNotice(message, error = false) {
    clearTimeout(noticeTimer);
    $('notice').textContent = String(message);
    $('notice').className = error ? 'notice notice-error' : 'notice';
    $('notice').hidden = false;
    if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000);
  }

  function logEntry(entry) {
    logs.push({ time: Date.now(), level: 'info', ...entry });
    logs = logs.slice(-300);
    $('log-count').textContent = String(logs.length);
    renderLogs();
  }

  function renderLogs() {
    const list = $('logs');
    list.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '开始扫描或运行后，操作结果会显示在这里。';
      list.append(empty);
      return;
    }
    for (const entry of [...logs].reverse()) {
      const li = document.createElement('li');
      li.className = `log log-${['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info'}`;
      const time = document.createElement('time');
      time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
      const text = document.createElement('span');
      text.textContent = entry.message;
      li.append(time, text);
      list.append(li);
    }
  }

  function renderProducts() {
    const search = $('product-search').value.trim().toLowerCase();
    const products = (state.products || []).filter(p => !search || `${p.number} ${p.title}`.toLowerCase().includes(search));
    const pages = Math.ceil(products.length / 50);
    productPage = Math.max(0, Math.min(productPage, pages - 1));
    $('list-total').textContent = String((state.products || []).length);
    $('product-list').replaceChildren();
    for (const product of products.slice(productPage * 50, (productPage + 1) * 50)) {
      const row = document.createElement('div');
      row.className = 'product-row';
      const number = document.createElement('span');
      number.className = 'product-number';
      number.textContent = String(product.number);
      const title = document.createElement('span');
      title.className = 'product-title';
      title.textContent = product.title || `商品 ${product.number}`;
      title.title = title.textContent;
      row.append(number, title);
      if (state.current ? product.number === state.current.number : product.active) {
        const badge = document.createElement('span');
        badge.className = 'active-product';
        badge.textContent = '讲解中';
        row.append(badge);
      }
      $('product-list').append(row);
    }
    if (!products.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = search ? '没有匹配的商品。' : '扫描后将在这里显示商品。';
      $('product-list').append(empty);
    }
    $('product-page').textContent = pages ? `${productPage + 1} / ${pages}` : '0 / 0';
    $('previous-products').disabled = productPage === 0;
    $('next-products').disabled = productPage >= pages - 1;
  }

  function renderTimer() {
    if (state.status === 'running' && state.nextAt) {
      const seconds = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
      $('countdown').textContent = seconds > 0 ? `${seconds} 秒后切换` : '正在切换…';
    } else {
      $('countdown').textContent = ({ running: '正在定位商品…', scanning: '正在读取列表…', paused: '计时已暂停', completed: '计划执行完成', stopped: '计时已停止', error: '请查看运行记录' })[state.status] || '等待开始';
    }
  }

  function render(nextState) {
    state = { ...state, ...nextState };
    const active = activeStatuses.has(state.status);
    $('state-badge').textContent = names[state.status] || state.status;
    $('state-badge').dataset.state = state.status;
    $('mini-status').textContent = names[state.status] || state.status;
    $('launcher').dataset.running = String(state.status === 'running');
    $('product-count').textContent = String((state.products || []).length);
    $('catalog-quality').textContent = state.status === 'scanning' ? '正在采集…' : state.products?.length ? (state.complete ? '采集完成' : '部分商品已识别') : '请先扫描';
    $('start').disabled = active || busy;
    $('scan').disabled = active || busy;
    $('pause').disabled = !['running', 'paused'].includes(state.status) || busy;
    $('pause').textContent = state.status === 'paused' ? '继续' : '暂停';
    $('stop').disabled = !active;
    $('next').disabled = !['running', 'paused'].includes(state.status) || busy;
    for (const id of ['plan', 'interval', 'loop', 'range-start', 'range-end', ...selectorKeys.map(k => `selector-${k}`)]) $(id).disabled = active;
    for (const button of shadow.querySelectorAll('[data-action="generate"], [data-action="import-settings"]')) button.disabled = active || busy;
    $('current-product').textContent = state.current ? `${state.status === 'running' ? '正在讲解' : '最近确认'} ${state.current.number} 号 · ${state.current.title || '商品'}` : (state.status === 'scanning' ? '正在识别直播商品列表' : '准备好计划，开始自动讲解');
    $('run-message').textContent = state.message || (state.products?.length ? '仅在确认“取消讲解”后记录为成功。' : '首次使用请登录百度直播并进入直播商品列表。');
    $('progress').textContent = `成功 ${state.successes || 0} · 失败 ${state.failures || 0}${state.plan?.length ? ` · 第 ${state.cycle || 1} 轮` : ''}`;
    const signature = JSON.stringify([(state.products || []).map(p => [p.number, p.title, p.active]), state.current?.number]);
    if (signature !== productSignature) { productSignature = signature; renderProducts(); }
    renderTimer();
  }

  function createRunner() {
    adapter = BaiduLiveAdapter.createAdapter(document, { selectors: settings.selectors });
    runner = core.createRunner({ adapter, settings, onChange: render, onLog: logEntry });
    render(runner.getState());
  }

  function fillSettings() {
    $('plan').value = settings.plan || '';
    $('interval').value = settings.intervalSeconds;
    $('loop').checked = settings.loop;
    for (const key of selectorKeys) $(`selector-${key}`).value = settings.selectors?.[key] || '';
  }

  function readSettings() {
    const selectors = Object.fromEntries(selectorKeys.map(key => [key, $(`selector-${key}`).value.trim()]));
    return core.validateSettings({ plan: $('plan').value.trim(), intervalSeconds: Number($('interval').value), loop: $('loop').checked, selectors });
  }

  async function applySettings({ persist = true } = {}) {
    if (activeStatuses.has(state.status)) throw new Error('请先停止任务，再修改或保存配置。');
    const next = readSettings();
    const selectorsChanged = JSON.stringify(next.selectors) !== JSON.stringify(settings.selectors);
    settings = next;
    if (selectorsChanged || !runner) createRunner();
    else runner.setSettings(settings);
    if (persist) await chrome.storage.local.set({ baiduLiveSettings: settings });
    return settings;
  }

  function setAppearance() {
    host.setAttribute('data-dock', appearance.dock === 'left' ? 'left' : 'right');
    $('launcher').hidden = !appearance.collapsed;
    shadow.querySelector('.panel').hidden = appearance.collapsed;
    chrome.storage.local.set({ baiduLiveAppearance: appearance }).catch(() => {});
  }

  function download(name, value, type = 'application/json') {
    const data = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: `${type};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    shadow.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function selectTab(tab) {
    for (const button of shadow.querySelectorAll('[data-tab]')) {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const view of shadow.querySelectorAll('.tab-view')) view.hidden = view.id !== `view-${tab}`;
  }

  async function execute(action) {
    if (!runner) throw new Error('扩展仍在初始化，请稍后重试。');
    switch (action) {
      case 'scan': {
        await applySettings();
        const result = await runner.scan();
        if (!result) break;
        const products = result.products || runner.getState().products || [];
        if (products.length) {
          const numbers = products.map(p => p.number).filter(Number.isInteger).sort((a, b) => a - b);
          if (numbers.length) {
            $('range-start').value = numbers[0];
            $('range-end').value = numbers[numbers.length - 1];
            if (!$('plan').value.trim()) {
              const contiguous = numbers.every((n, i) => n === numbers[0] + i);
              $('plan').value = contiguous && numbers.length > 1 ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers.join(',');
              await applySettings();
            }
          }
          showNotice(`已识别 ${products.length} 件商品${result?.complete ? '，列表采集完成。' : '；请查看采集提示。'}`);
        }
        if (result?.warnings?.length) showNotice(result.warnings.join('；'), true);
        break;
      }
      case 'generate': {
        if (activeStatuses.has(state.status)) throw new Error('请先停止任务，再修改计划。');
        const start = Number($('range-start').value);
        const end = Number($('range-end').value);
        const plan = `${start}-${end}`;
        const numbers = core.parsePlan(plan);
        $('plan').value = plan;
        showNotice(`已生成 ${numbers.length} 个序号，点击“开启自动弹窗”开始执行。`);
        break;
      }
      case 'start': await applySettings(); await runner.start(); break;
      case 'pause': state.status === 'paused' ? await runner.resume() : await runner.pause(); break;
      case 'stop': await runner.stop(); break;
      case 'next': await runner.next(); break;
      case 'save': await applySettings(); showNotice('配置已保存，下次打开页面后可直接使用。'); break;
      case 'collapse': appearance.collapsed = true; setAppearance(); break;
      case 'expand': appearance.collapsed = false; setAppearance(); break;
      case 'dock': appearance.dock = appearance.dock === 'right' ? 'left' : 'right'; setAppearance(); break;
      case 'previous-products': productPage--; renderProducts(); break;
      case 'next-products': productPage++; renderProducts(); break;
      case 'clear-logs': logs = []; $('log-count').textContent = '0'; renderLogs(); break;
      case 'export-logs': download('百度直播助手-运行记录.json', { exportedAt: new Date().toISOString(), logs }); break;
      case 'export-settings': download('百度直播助手-配置.json', { schemaVersion: 1, settings: readSettings() }); showNotice('配置已导出。'); break;
      case 'import-settings': $('import-file').click(); break;
      case 'diagnostics': {
        const inspection = await adapter.inspect();
        const safeInspection = { ...inspection };
        if (safeInspection.url) {
          try { const url = new URL(safeInspection.url); safeInspection.url = `${url.origin}${url.pathname}`; }
          catch { delete safeInspection.url; }
        }
        download('百度直播助手-页面诊断.json', { schemaVersion: 1, generatedAt: new Date().toISOString(), page: `${location.origin}${location.pathname}`, settings: readSettings(), inspection: safeInspection, state: { status: state.status, total: state.total, complete: state.complete, warnings: state.warnings, products: (state.products || []).map(({ number, id, title }) => ({ number, id, title })) }, logs });
        showNotice('诊断信息已导出。');
        break;
      }
      default: break;
    }
  }

  shadow.addEventListener('click', async event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { selectTab(tab.dataset.tab); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const concurrent = ['stop', 'collapse', 'expand', 'dock', 'clear-logs', 'export-logs', 'previous-products', 'next-products'].includes(action);
    if (busy && !concurrent) return;
    if (!concurrent) busy = true;
    render(state);
    try { await execute(action); }
    catch (error) {
      const message = error?.message || String(error);
      showNotice(message, true);
      logEntry({ level: 'error', message });
    } finally {
      if (!concurrent) busy = false;
      if (runner) render(runner.getState());
    }
  });
  $('launcher').dataset.action = 'expand';
  $('product-search').addEventListener('input', () => { productPage = 0; renderProducts(); });
  shadow.querySelector('.tabs').addEventListener('keydown', event => {
    const tabs = [...shadow.querySelectorAll('[data-tab]')];
    const index = tabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    selectTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (activeStatuses.has(state.status)) throw new Error('请先停止任务，再导入配置。');
      if (file.size > 1024 * 1024) throw new Error('配置文件过大，请选择小于 1 MB 的 JSON 文件。');
      const parsed = JSON.parse(await file.text());
      if (activeStatuses.has(state.status)) throw new Error('任务已开始，请停止任务后重新导入配置。');
      const imported = core.validateSettings(parsed.settings || parsed);
      settings = imported;
      fillSettings();
      createRunner();
      await chrome.storage.local.set({ baiduLiveSettings: settings });
      showNotice('配置已导入并保存，请核对计划后再开始。');
      logEntry({ message: '已导入配置，任务保持停止。' });
    } catch (error) { showNotice(`导入失败：${error.message}`, true); }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'BAIDU_LIVE_PING') sendResponse({ ready: true, status: state.status });
    if (message?.type === 'BAIDU_LIVE_TOGGLE') {
      appearance.collapsed = !appearance.collapsed;
      setAppearance();
      sendResponse({ ready: true, collapsed: appearance.collapsed });
    }
  });

  async function initialize() {
    busy = true;
    render(state);
    try {
      const saved = await chrome.storage.local.get(['baiduLiveSettings', 'baiduLiveAppearance']);
      if (saved.baiduLiveSettings) {
        try { settings = core.validateSettings(saved.baiduLiveSettings); }
        catch { showNotice('之前的配置已失效，已恢复默认值。请重新设置计划。', true); }
      }
      if (saved.baiduLiveAppearance) {
        appearance = { dock: saved.baiduLiveAppearance.dock === 'left' ? 'left' : 'right', collapsed: Boolean(saved.baiduLiveAppearance.collapsed) };
      }
    } catch (error) { showNotice(`读取配置失败：${error.message}`, true); }
    fillSettings();
    createRunner();
    setAppearance();
    busy = false;
    render(state);
    if (/\/login(?:[/?#]|$)/i.test(location.pathname)) showNotice('请先登录百度直播，再进入直播中控台的“直播商品”列表。');
    setInterval(renderTimer, 500);
  }
  void initialize();
  window.addEventListener('pagehide', () => { try { runner?.stop(); } catch {} });
})();

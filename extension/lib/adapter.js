/* DOM-only adapter. No private API, credentials, media capture, or remote code. */
(function (root) {
  'use strict';

  const TEXT = { explain: '讲解商品', active: '取消讲解' };
  const BAIDU_CARD = '[data-key][class*="product-card-container"]';
  const BAIDU_INDEX = 'input[class*="index-input"],[class*="card-idx"] input';
  const PRODUCT_LISTS = '.ant-table-body,.ant-table-content,.el-table__body-wrapper,.el-scrollbar__wrap,.bui-table-body,[class*="virtual-list"],[role="grid"],[role="list"],[data-product-list]';
  const ROWS = `tr,[role="row"],.ant-table-row,.el-table__row,.bui-table-row,[data-product-number],[data-product-id],[data-goods-id],[data-row-key],${BAIDU_CARD},[class*="goods-item"],[class*="product-item"],[class*="commodity-item"],[class*="goods-row"],[class*="product-row"]`;
  const PAGERS = '.ant-pagination,.el-pagination,.bui-pagination,[role="navigation"][aria-label*="页"],[class*="pagination"]';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const compact = value => normalize(value).replace(/\s/g, '');
  const documentOperations = new WeakMap();

  function createAdapter(doc, options = {}) {
    const win = doc.defaultView || root;
    const selectors = options.selectors || {};
    const confirmTimeout = Number(options.confirmTimeoutMs) || 5000;
    const scanLimit = Math.max(1, Math.min(Number(options.scanLimit) || 10000, 50000));
    const maxSteps = Math.max(20, Math.min(scanLimit * 2, 20000));
    let cache = [];
    // Aborting a wait cannot retract a click already sent to the website.
    // Keep that request across pause/resume so no later task clicks twice or
    // races a delayed response from the previous product.
    if (!documentOperations.has(doc)) documentOperations.set(doc, { pendingClick: null });
    const operations = documentOperations.get(doc);
    const shouldFollow = () => options.shouldFollow ? options.shouldFollow() !== false : true;

    function check(signal) {
      if (signal && signal.aborted) {
        const error = new Error('操作已停止');
        error.name = 'AbortError';
        throw error;
      }
    }

    function sleep(ms, signal) {
      check(signal);
      return new Promise((resolve, reject) => {
        const timer = win.setTimeout(done, ms);
        function done() {
          if (signal) signal.removeEventListener('abort', aborted);
          resolve();
        }
        function aborted() {
          win.clearTimeout(timer);
          signal.removeEventListener('abort', aborted);
          const error = new Error('操作已停止');
          error.name = 'AbortError';
          reject(error);
        }
        if (signal) signal.addEventListener('abort', aborted, { once: true });
      });
    }

    function query(scope, selector) {
      if (!selector) return [];
      try { return [...scope.querySelectorAll(selector)]; }
      catch (_) { throw new Error('选择器格式错误：' + selector); }
    }

    function visible(element) {
      if (!element || !element.isConnected || element.closest('[hidden],[aria-hidden="true"],[data-baidu-live-helper],[data-baidu-live-assistant]')) return false;
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    }

    function actionText(element) {
      return compact(element.textContent || element.getAttribute('aria-label'));
    }

    function controls(scope = doc) {
      const selected = selectors.explain ? query(scope, selectors.explain) : query(scope, 'button,a,[role="button"],span,div');
      const result = [];
      for (const element of selected) {
        const text = actionText(element);
        if ((text !== TEXT.explain && text !== TEXT.active) || !visible(element)) continue;
        // Span labels inside buttons must produce one click on their actual control.
        const button = element.closest('button,a,[role="button"]');
        const target = button && actionText(button) === text ? button : element;
        if (!result.includes(target)) result.push(target);
      }
      return result.filter(element => !result.some(other => other !== element && element.contains(other)));
    }

    function rowFor(button) {
      if (selectors.row) return button.closest(selectors.row);
      const known = button.closest(ROWS);
      if (known && controls(known).length === 1) return known;
      // CSS modules often hide useful class names. Walk to the smallest complete
      // product card, stopping before a parent that contains several products.
      let best = null;
      for (let node = button.parentElement, depth = 0; node && node !== doc.body && depth < 9; node = node.parentElement, depth++) {
        if (controls(node).length !== 1) break;
        if (readNumber(node) && readTitle(node)) { best = node; break; }
      }
      return best;
    }

    function positive(value) {
      const text = normalize(value);
      if (!/^\d{1,7}$/.test(text)) return null;
      const number = Number(text);
      return number > 0 && Number.isSafeInteger(number) ? number : null;
    }

    function readNumber(row) {
      // The liveB console renders its reorderable index as an input. Its
      // current value is absent from textContent and can differ from the HTML
      // value attribute after editing. Never write to this reorder control.
      const numberValue = element => element?.matches('input') ? element.value : element?.textContent;
      if (selectors.number) {
        const element = row.querySelector(selectors.number);
        return element ? positive(numberValue(element)) : null;
      }
      for (const attr of ['data-product-number', 'data-goods-number', 'data-number', 'data-order']) {
        const number = positive(row.getAttribute(attr));
        if (number) return number;
      }
      const indexInputs = query(row, BAIDU_INDEX);
      if (indexInputs.length) {
        const values = indexInputs.filter(visible).map(element => positive(element.value));
        // A blank/invalid index is not a cue to use sales, price or another
        // product's number. Let scan report it as an unrecognized row.
        return values.length && values.every(value => value && value === values[0]) ? values[0] : null;
      }
      const candidates = query(row, '[data-product-number],[class*="sort"],[class*="number"],[class*="index"]');
      for (const element of candidates) {
        const number = positive(element.getAttribute('data-product-number') || numberValue(element));
        if (number) return number;
      }
      // Never search all numeric cells: a sales/inventory count must not
      // silently become the product index when the index column is missing.
      const firstCell = query(row, 'td,[role="cell"]').find(element => !element.matches('[class*="selection"],[class*="checkbox"]'));
      if (firstCell) {
        const direct = positive(firstCell.textContent);
        if (direct) return direct;
        const firstText = doc.createTreeWalker(firstCell, 4);
        let cellText;
        while ((cellText = firstText.nextNode())) {
          if (!normalize(cellText.textContent)) continue;
          return positive(cellText.textContent);
        }
        return null;
      }
      // Only the first text node/leaf is considered; inventory/sales numbers
      // later in a row must never become the product number.
      const walker = doc.createTreeWalker(row, 4);
      let text;
      while ((text = walker.nextNode())) {
        if (!normalize(text.textContent)) continue;
        return positive(text.textContent);
      }
      return null;
    }

    function readId(row) {
      if (row.matches(BAIDU_CARD) && normalize(row.getAttribute('data-key'))) return 'data-key:' + normalize(row.getAttribute('data-key'));
      for (const attr of ['data-product-id', 'data-goods-id', 'data-item-id', 'data-row-key']) {
        const value = normalize(row.getAttribute(attr));
        if (value) return attr + ':' + value;
      }
      const nested = row.querySelector('[data-product-id],[data-goods-id],[data-item-id]');
      if (nested) {
        for (const attr of ['data-product-id', 'data-goods-id', 'data-item-id']) {
          if (nested.getAttribute(attr)) return attr + ':' + nested.getAttribute(attr);
        }
      }
      for (const link of query(row, 'a[href]')) {
        try {
          const url = new URL(link.href, doc.location.href);
          for (const key of ['goodsId', 'productId', 'itemId', 'goods_id', 'product_id']) {
            if (url.searchParams.get(key)) return key + ':' + url.searchParams.get(key);
          }
        } catch (_) { /* A malformed unrelated product link is ignored. */ }
      }
      return '';
    }

    function readTitle(row) {
      if (selectors.title) return normalize(row.querySelector(selectors.title)?.textContent);
      // card-title also contains an ID badge; the nested product-title is the
      // stable product name and must take precedence over generic title nodes.
      const productTitle = query(row, '[class*="product-title"],[class*="productTitle"],[data-product-title]').find(visible);
      if (productTitle) {
        const title = normalize(productTitle.getAttribute('data-product-title') || productTitle.textContent);
        if (title) return title;
      }
      const candidates = query(row, '[data-product-title],[class*="goods-name"],[class*="product-name"],[class*="goodsName"],[class*="productName"],[class*="title"],[class*="Title"],a[title],img[alt]');
      for (const element of candidates) {
        const value = normalize(element.getAttribute('data-product-title') || element.getAttribute('title') || (element.tagName === 'IMG' ? element.getAttribute('alt') : element.textContent));
        if (value && value.length > 1 && !/^(讲解商品|取消讲解|商品图片|商品|图片|预览|删除)$/.test(value) && !/^https?:/i.test(value)) return value;
      }
      const leaves = query(row, 'a,span,p,div,td,[role="cell"]').filter(element => element.children.length === 0);
      for (const element of leaves) {
        const value = normalize(element.textContent);
        if (value.length > 2 && /[\p{L}]/u.test(value) && !/^(讲解商品|取消讲解|讲解中|预览|删除|下架|AI\s*|库存|销量|点击|成交|讲开售|售出)/i.test(value)) return value;
      }
      return '';
    }

    function liveRows() {
      const seen = new Set();
      const result = [];
      for (const button of controls()) {
        const row = rowFor(button);
        if (!row || seen.has(row)) continue;
        seen.add(row);
        const number = readNumber(row);
        const id = readId(row);
        const title = readTitle(row);
        if (!number || (!id && !title)) continue;
        result.push({ row, button, number, id, title, active: actionText(button) === TEXT.active });
      }
      return result;
    }

    function signature(rows) {
      return rows.map(item => [item.number, item.id, item.title].join(':')).join('|');
    }

    function identity(item) { return item.id || 'title:' + item.title; }
    function serialize(item) { return { number: item.number, id: item.id, title: item.title, active: item.active }; }

    function totalHint() {
      const text = doc.body?.innerText || doc.body?.textContent || '';
      const match = text.match(/直播商品\s*[（(]\s*(\d+)\s*[）)]/);
      return match ? Number(match[1]) : null;
    }

    function scrollBox(rows) {
      if (selectors.scrollContainer) {
        const container = query(doc, selectors.scrollContainer)[0];
        if (!container) throw new Error('未找到指定的商品滚动容器');
        if (container === doc.body || container === doc.documentElement || container === doc.scrollingElement || !container.contains(rows[0]?.row)) {
          throw new Error('商品滚动容器必须是包含商品的列表内部元素，不能选择整个页面');
        }
        return container;
      }
      const scrollable = node => node && node.clientHeight > 0 && /(auto|scroll)/.test(win.getComputedStyle(node).overflowY);
      // Baidu reuses product-card-container for each card and its list.
      // Stop at that list boundary even when it has no scrollbar; the next
      // scrolling ancestor may be the whole workbench, with video and chat.
      if (rows[0]?.row.matches(BAIDU_CARD)) {
        const list = rows[0].row.parentElement?.closest('[class*="product-card-container"]');
        return scrollable(list) ? list : null;
      }
      for (let node = rows[0]?.row.parentElement; node && node !== doc.body; node = node.parentElement) {
        if (node.matches(PRODUCT_LISTS) && scrollable(node)) return node;
      }
      // Static rows can be read and clicked without scrolling. An unknown
      // virtual list needs an explicit selector, never a page-wide fallback.
      return null;
    }

    function scrollList(container, top) {
      if (!container) return false;
      const before = container.scrollTop;
      container.scrollTo({ top, behavior: 'instant' });
      if (container.scrollTop === before) return false;
      container.dispatchEvent(new win.Event('scroll'));
      return true;
    }

    async function followRow(row, signal) {
      const container = scrollBox([row]);
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const top = bounds.top + container.clientTop;
      const card = row.row.getBoundingClientRect();
      // Always move the product to the top of its own list, even when it is
      // already fully visible. The browser clamps the last products at the
      // maximum scroll position without moving any outer ancestor.
      const delta = card.top - top;
      check(signal);
      if (delta && scrollList(container, container.scrollTop + delta)) {
        // Virtual lists can replace nodes in their scroll handler. Wait for
        // that render, then explain() will resolve the product identity again.
        await sleep(180, signal);
      }
    }

    function disabled(element) {
      return element.disabled || element.getAttribute('aria-disabled') === 'true' || /(?:^|[\s_-])disabled(?:$|[\s_-])/.test(element.className || '') || !!element.closest('.ant-pagination-disabled,.is-disabled');
    }

    function nextPage() {
      if (selectors.nextPage) return query(doc, selectors.nextPage).find(element => visible(element) && !disabled(element)) || null;
      for (const pager of query(doc, PAGERS).filter(visible)) {
        for (const element of query(pager, '.ant-pagination-next,.btn-next,[aria-label],[title],button,a')) {
          const label = compact(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent).toLowerCase();
          const isNext = element.matches('.ant-pagination-next,.btn-next') || /^(下一页|下页|next|nextpage|›|»|>)$/.test(label);
          if (isNext && visible(element) && !disabled(element)) return element;
        }
      }
      return null;
    }

    async function changePage(element, signal) {
      check(signal);
      const before = signature(liveRows());
      const target = element.matches('li') ? element.querySelector('button,a') || element : element;
      check(signal);
      target.click();
      const deadline = Date.now() + Math.max(2000, confirmTimeout);
      do {
        await sleep(120, signal);
        const rows = liveRows();
        if (rows.length && signature(rows) !== before) { await sleep(150, signal); return true; }
      } while (Date.now() < deadline);
      return false;
    }

    async function firstPage(signal) {
      for (const pager of query(doc, PAGERS).filter(visible)) {
        const active = pager.querySelector('.ant-pagination-item-active,.el-pager .is-active,.el-pager .active,[aria-current="page"]');
        if (active && compact(active.textContent) === '1') continue;
        const first = query(pager, '.ant-pagination-item,.el-pager li,button,a,[role="button"]').find(element => compact(element.textContent) === '1' && visible(element) && !disabled(element));
        if (first) {
          if (!(await changePage(first, signal))) throw new Error('无法切换到商品列表第一页');
          continue;
        }
        // Compact pagers may only show previous/next instead of numbered links.
        for (let page = 0; page < maxSteps; page++) {
          const previous = query(doc, PAGERS).flatMap(scope => query(scope, '.ant-pagination-prev,.btn-prev,[aria-label],[title],button,a')).find(element => {
            const label = compact(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent).toLowerCase();
            return visible(element) && !disabled(element) && (element.matches('.ant-pagination-prev,.btn-prev') || /^(上一页|上页|previous|previouspage|‹|«|<)$/.test(label));
          });
          if (!previous) break;
          if (!(await changePage(previous, signal))) throw new Error('无法返回商品列表第一页');
          if (page === maxSteps - 1) throw new Error('返回第一页超过步数上限');
        }
      }
    }

    async function traverse({ signal, onRow, onProgress, stopWhen } = {}) {
      await firstPage(signal);
      let rows = liveRows();
      if (!rows.length) {
        if (controls().length) throw new Error('发现讲解按钮，但无法识别商品序号；请在设置中指定商品行和序号选择器');
        throw new Error('未找到直播商品列表，请先登录百度直播并打开“直播商品”页');
      }
      let container = scrollBox(rows);
      scrollList(container, 0);
      await sleep(180, signal);
      let stationary = 0;
      let pageCount = 1;
      let lastSignature = '';
      const pageSignatures = new Set();
      for (let step = 0; step < maxSteps; step++) {
        check(signal);
        rows = liveRows();
        if (!rows.length) { await sleep(180, signal); rows = liveRows(); }
        const visibleNumbers = new Set();
        for (const row of rows) {
          if (visibleNumbers.has(row.number)) throw new Error('商品序号 ' + row.number + ' 出现重复行（可能为固定列）；请指定商品行选择器排除重复行');
          visibleNumbers.add(row.number);
          onRow?.(row);
          if (stopWhen?.(row)) return { found: row, complete: false, pageCount };
        }
        onProgress?.({ page: pageCount, step, visible: rows.length });
        const advertisedTotal = totalHint();
        if (advertisedTotal > 0 && rows.length === advertisedTotal) return { complete: true, pageCount };
        const currentSignature = signature(rows);
        const before = container?.scrollTop || 0;
        // Ordinary paginated HTML tables already expose their full current
        // page in the DOM. Scrolling every row there adds needless delays;
        // virtualized tables and lists still require the complete scroll path.
        const staticTablePage = rows.length > 0 && rows.every(item => item.row.tagName === 'TR' && !item.row.closest('[class*="virtual"],[class*="Virtual"]')) && query(doc, PAGERS).some(visible);
        const atBottom = !container || staticTablePage || before + container.clientHeight >= container.scrollHeight - 4;
        if (!atBottom) {
          scrollList(container, Math.min(before + Math.max(180, container.clientHeight * 0.72), container.scrollHeight));
          await sleep(180, signal);
          if (container.scrollTop !== before || currentSignature !== lastSignature) { stationary = 0; lastSignature = currentSignature; continue; }
        }
        stationary = staticTablePage ? 3 : stationary + 1;
        // Wait for lazy loading once at each end instead of assuming rendered
        // rows are the entire list. The server's count is checked by scan().
        if (stationary < 3) { await sleep(250, signal); continue; }
        const next = nextPage();
        if (!next) return { complete: true, pageCount };
        const pageSignature = signature(liveRows());
        if (pageSignatures.has(pageSignature)) return { complete: false, pageCount, reason: '分页重复，已停止扫描' };
        pageSignatures.add(pageSignature);
        if (!(await changePage(next, signal))) return { complete: false, pageCount, reason: '下一页未加载成功' };
        pageCount++;
        rows = liveRows();
        container = scrollBox(rows);
        scrollList(container, 0);
        stationary = 0;
        lastSignature = '';
        await sleep(180, signal);
      }
      return { complete: false, pageCount, reason: '已达到扫描步数上限' };
    }

    async function scan({ signal, onProgress } = {}) {
      check(signal);
      await settlePendingClick(signal, true);
      const products = new Map();
      const warnings = new Set();
      let limited = false;
      const result = await traverse({ signal, onProgress: progress => onProgress?.({ ...progress, count: products.size }), onRow(row) {
        const existing = products.get(row.number);
        if (existing && identity(existing) !== identity(row)) throw new Error('商品序号 ' + row.number + ' 对应多个商品，无法安全生成计划；请检查序号选择器或列表分页编号');
        if (!existing && products.size >= scanLimit) { limited = true; return; }
        products.set(row.number, serialize(row));
      }, stopWhen: () => limited });
      const total = totalHint();
      if (limited) warnings.add('商品超过扫描上限 ' + scanLimit + '，请扩大设置后重新扫描');
      if (result.reason) warnings.add(result.reason);
      if (total !== null && total !== products.size) warnings.add('网页显示 ' + total + ' 个直播商品，本次识别 ' + products.size + ' 个；列表可能尚未全部加载或存在未识别行');
      const complete = result.complete && !limited && (total === null || total === products.size);
      cache = [...products.values()].sort((a, b) => a.number - b.number);
      return { products: cache, total: total === null ? cache.length : total, complete, warnings: [...warnings] };
    }

    function sameProduct(row, product) {
      if (row.number !== product.number) return false;
      if (product.id) return row.id === product.id;
      return !!product.title && row.title === product.title;
    }

    function matchingRow(product) {
      const byNumber = liveRows().filter(row => row.number === product.number);
      const exact = byNumber.filter(row => sameProduct(row, product));
      if (exact.length > 1) throw new Error('商品 ' + product.number + ' 出现重复行（可能为固定列），已停止点击；请指定商品行选择器排除重复行');
      return exact[0] || null;
    }

    async function settlePendingClick(signal, resetExpired = false) {
      const pending = operations.pendingClick;
      if (!pending) return null;
      do {
        check(signal);
        // A background observer can finish the same dispatched request after
        // pause/stop. Share its result before restoring a virtual list view.
        if (pending.result) return pending.result;
        if (operations.pendingClick !== pending) return null;
        const current = matchingRow(pending.product);
        if (current && current.active) {
          pending.result = { ...serialize(current), alreadyActive: false, confirmed: true };
          if (operations.pendingClick === pending) operations.pendingClick = null;
          pending.restoreView?.();
          return pending.result;
        }
        if (Date.now() >= pending.deadline) break;
        await sleep(Math.min(100, Math.max(1, pending.deadline - Date.now())), signal);
      } while (true);
      pending.restoreView?.();
      if (resetExpired) {
        if (operations.pendingClick === pending) operations.pendingClick = null;
        return null;
      }
      throw new Error('商品 ' + pending.product.number + ' 点击后未变成“取消讲解”；已阻止后续点击，请重新抓取商品并检查直播状态、网络或网站确认弹窗');
    }

    async function explain(product, { signal } = {}) {
      check(signal);
      if (!product || !positive(product.number) || (!product.id && !product.title)) throw new Error('商品信息不完整，请重新抓取商品列表');
      // Finish confirming the previous click before locating another product.
      // A pause may have aborted its waiter after the request was dispatched.
      await settlePendingClick(signal);
      const container = scrollBox(liveRows());
      const originalTop = container?.scrollTop;
      let viewFinished = false;
      const restoreView = () => {
        if (viewFinished) return;
        viewFinished = true;
        if (!shouldFollow() && container?.isConnected) scrollList(container, originalTop);
      };
      try {
        let row = matchingRow(product);
        if (!row) {
          const result = await traverse({ signal, stopWhen: item => sameProduct(item, product) });
          row = result.found || null;
        }
        check(signal);
        // Re-query after locating and scrolling; virtual rows may be reused.
        row = matchingRow(product);
        if (!row) throw new Error('找不到商品 ' + product.number + ' 或其身份已改变；请重新抓取商品列表');
        if (shouldFollow()) await followRow(row, signal);
        check(signal);
        row = matchingRow(product);
        if (!row) throw new Error('商品状态发生变化，请重新抓取后重试');
        if (row.active) return { ...serialize(row), alreadyActive: true, confirmed: true };
        if (disabled(row.button)) throw new Error('商品 ' + product.number + ' 的讲解按钮不可用');
        if (actionText(row.button) !== TEXT.explain) throw new Error('商品状态发生变化，请重新抓取后重试');
        check(signal);
        const sent = { product: serialize(row), deadline: Date.now() + confirmTimeout, restoreView };
        operations.pendingClick = sent;
        try { row.button.click(); }
        catch (error) { if (operations.pendingClick === sent) operations.pendingClick = null; throw error; }
        return await settlePendingClick(signal);
      } finally {
        const pending = operations.pendingClick;
        if (pending?.restoreView !== restoreView) restoreView();
        else if (signal?.aborted && !pending.observing) {
          // The website already received this click. Continue read-only
          // confirmation so stopping does not leave the list at a temporary
          // lookup position; never dispatch another product from this observer.
          pending.observing = true;
          void settlePendingClick().catch(() => pending.restoreView?.());
        }
      }
    }

    function inspect() {
      const rows = liveRows();
      const foundControls = controls();
      const unresolved = foundControls.filter(button => !rows.some(row => row.button === button));
      return {
        url: doc.location ? doc.location.origin + doc.location.pathname : '',
        buttons: foundControls.length,
        rows: rows.length,
        total: totalHint(),
        products: rows.map(serialize),
        cached: cache.length,
        unresolved: unresolved.slice(0, 5).map(button => {
          const ancestors = [];
          for (let node = button, depth = 0; node && node !== doc.body && depth < 9; node = node.parentElement, depth++) {
            ancestors.push({tag: node.tagName, classes: String(node.className || ''), hasProductKey: node.hasAttribute('data-key'), indexInputs: query(node, BAIDU_INDEX).map(input => ({classes: input.className, value: input.value})).slice(0, 5)});
          }
          return {text: actionText(button), ancestors};
        }),
        suggestedSelectors: { row: BAIDU_CARD, number: 'input[class*="index-input"]', title: '[class*="product-title"]', explain: '[class*="normal-btn"]' },
        selectors: { ...selectors },
        note: rows.length ? '已识别商品行；点击仍需等待网页状态确认' : '登录并进入直播商品列表后重新诊断，或填写自定义选择器'
      };
    }

    return { scan, explain, inspect };
  }

  root.BaiduLiveAdapter = Object.freeze({ createAdapter });
})(globalThis);

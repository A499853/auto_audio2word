(function (root) {
  'use strict';

  const MAX_PLAN_ITEMS = 200;
  const SELECTOR_KEYS = ['row', 'number', 'title', 'explain', 'nextPage', 'scrollContainer'];
  const DEFAULT_SETTINGS = Object.freeze({
    plan: '', intervalSeconds: 8, loop: true, followCurrent: true,
    selectors: Object.freeze(Object.fromEntries(SELECTOR_KEYS.map(key => [key, ''])))
  });

  function parsePlan(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入商品序号计划，例如 1-200 或 1,3,5-8。');
    const normalized = text.trim().replace(/[，、；;]/g, ',').replace(/[～~—–至]/g, '-');
    const tokens = normalized.split(/[\s,]+/).filter(Boolean);
    const result = [];
    for (const token of tokens) {
      const match = /^(\d+)(?:-(\d+))?$/.exec(token);
      if (!match) throw new Error(`无法识别计划“${token}”，请使用正整数或范围（如 1-200）。`);
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1 || start > 1000000 || end > 1000000) {
        throw new Error('商品序号须为 1 至 1000000 的整数。');
      }
      if (end < start) throw new Error(`范围“${token}”的结束序号小于开始序号。`);
      if (result.length + end - start + 1 > MAX_PLAN_ITEMS) throw new Error(`单个计划最多 ${MAX_PLAN_ITEMS} 项，请缩短计划。`);
      for (let number = start; number <= end; number++) result.push(number);
    }
    return result;
  }

  function validateSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象。');
    const plan = value.plan === undefined ? DEFAULT_SETTINGS.plan : value.plan;
    if (typeof plan !== 'string' || plan.length > 100000) throw new Error('商品计划须为文本且不超过 100000 个字符。');
    if (plan.trim()) parsePlan(plan);
    const intervalSeconds = value.intervalSeconds === undefined ? 8 : Number(value.intervalSeconds);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400) throw new Error('弹窗间隔须为 1 至 86400 秒。');
    if (value.loop !== undefined && typeof value.loop !== 'boolean') throw new Error('循环设置须为 true 或 false。');
    if (value.followCurrent !== undefined && typeof value.followCurrent !== 'boolean') throw new Error('跟随设置须为 true 或 false。');
    if (value.selectors !== undefined && (!value.selectors || typeof value.selectors !== 'object' || Array.isArray(value.selectors))) throw new Error('选择器设置须为对象。');
    const selectors = {};
    for (const key of SELECTOR_KEYS) {
      const selector = value.selectors?.[key] ?? '';
      if (typeof selector !== 'string' || selector.length > 1000) throw new Error(`选择器 ${key} 须为不超过 1000 字符的文本。`);
      selectors[key] = selector.trim();
    }
    return {plan: plan.trim(), intervalSeconds, loop: value.loop ?? true, followCurrent: value.followCurrent ?? true, selectors};
  }

  function createRunner({adapter, settings = DEFAULT_SETTINGS, onChange = () => {}, onLog = () => {}, clock = {}}) {
    let config = validateSettings(settings);
    const now = clock.now || Date.now;
    const later = clock.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancel = clock.clearTimeout || (id => clearTimeout(id));
    let state = {status: 'idle', products: [], total: 0, complete: false, warnings: [], plan: [], index: 0, cycle: 1, current: null, nextAt: null, message: '请先抓取直播商品。', successes: 0, failures: 0};
    let timer = null;
    let controller = null;
    let epoch = 0;
    let pending = Promise.resolve();
    let consecutiveFailures = 0;
    let remainingMs = null;

    const copy = () => ({...state, products: state.products.map(item => ({...item})), plan: [...state.plan], warnings: [...state.warnings], current: state.current ? {...state.current} : null});
    function emit(patch) { state = {...state, ...patch}; onChange(copy()); }
    function log(level, message, number) { onLog({time: now(), level, message, ...(number === undefined ? {} : {number})}); }
    function invalidate() {
      epoch++;
      if (timer !== null) cancel(timer);
      timer = null;
      controller?.abort();
      controller = null;
    }
    const isAbort = error => error?.name === 'AbortError';
    function exclusive(work) {
      const run = pending.catch(() => {}).then(work);
      pending = run.catch(() => {});
      return run;
    }
    function schedule(delay) {
      if (state.status !== 'running') return;
      const ticket = epoch;
      emit({nextAt: now() + delay});
      timer = later(() => {
        timer = null;
        if (ticket === epoch && state.status === 'running') exclusive(() => step(ticket, false));
      }, delay);
    }
    async function step(ticket, stayPaused) {
      if (ticket !== epoch || !['running', 'paused'].includes(state.status)) return;
      if (state.index >= state.plan.length) {
        if (!config.loop) {
          emit({status: 'completed', nextAt: null, message: '本轮计划已完成。'});
          log('info', '计划执行完成。');
          return;
        }
        emit({index: 0, cycle: state.cycle + 1});
      }
      const number = state.plan[state.index];
      const product = state.products.find(item => item.number === number);
      const operation = new AbortController();
      controller = operation;
      emit({nextAt: null, message: `正在定位并讲解 ${number} 号商品…`});
      try {
        if (!product) throw new Error(`商品 ${number} 未在抓取列表中，请重新抓取。`);
        const result = await adapter.explain(product, {signal: operation.signal});
        if (ticket !== epoch || operation.signal.aborted) return;
        if (!result || result.confirmed !== true) throw new Error('页面未确认“取消讲解”状态，不能视为成功。');
        consecutiveFailures = 0;
        const current = {...product, ...result, active: true};
        emit({current, index: state.index + 1, successes: state.successes + 1, message: `${number} 号商品${result.alreadyActive ? '已在讲解中' : '讲解已确认'}`});
        log('info', `${number} 号商品${result.alreadyActive ? '已在讲解，保持当前状态' : '已切换为“取消讲解”'}。`, number);
      } catch (error) {
        if (ticket !== epoch || operation.signal.aborted || isAbort(error)) return;
        consecutiveFailures++;
        emit({index: state.index + 1, failures: state.failures + 1, message: `${number} 号：${error.message}`});
        log('error', `${number} 号讲解失败：${error.message}`, number);
        if (consecutiveFailures >= 3) {
          emit({status: 'paused', nextAt: null, message: '连续 3 次讲解未确认，已暂停。请检查页面后继续或重新抓取。'});
          remainingMs = config.intervalSeconds * 1000;
          log('warn', state.message);
          return;
        }
      } finally {
        if (controller === operation) controller = null;
      }
      if (ticket !== epoch) return;
      if (state.index >= state.plan.length && !config.loop) {
        emit({status: 'completed', nextAt: null, message: `计划已完成：确认 ${state.successes} 次，失败 ${state.failures} 次。`});
        log('info', state.message);
      } else if (stayPaused) {
        emit({status: 'paused', nextAt: null});
        remainingMs = config.intervalSeconds * 1000;
      } else schedule(config.intervalSeconds * 1000);
    }

    async function scan() {
      if (['running', 'paused', 'scanning'].includes(state.status)) throw new Error('请先停止当前任务，再重新抓取商品。');
      invalidate();
      const ticket = epoch;
      const operation = new AbortController();
      controller = operation;
      emit({status: 'scanning', nextAt: null, message: '正在抓取直播商品，请保持商品列表打开…'});
      log('info', '开始抓取商品列表。');
      return exclusive(async () => {
        if (ticket !== epoch) return null;
        try {
          const result = await adapter.scan({signal: operation.signal, onProgress: progress => {
            if (ticket === epoch) emit({message: typeof progress === 'string' ? progress : `正在抓取：已识别 ${progress?.count ?? progress?.products?.length ?? 0} 件商品…`});
          }});
          if (ticket !== epoch || operation.signal.aborted) return null;
          if (!result || !Array.isArray(result.products) || !result.products.length) throw new Error('未发现可讲解商品。请登录直播中控台并打开“直播商品”列表。');
          const numbers = new Set();
          for (const product of result.products) {
            if (!Number.isSafeInteger(product.number) || product.number < 1 || numbers.has(product.number)) throw new Error('商品序号缺失或重复，请在设置中指定正确的序号选择器后重新抓取。');
            numbers.add(product.number);
          }
          emit({status: 'idle', products: result.products, total: result.total || result.products.length, complete: result.complete === true, warnings: result.warnings || [], plan: [], index: 0, current: null, message: `已识别 ${result.products.length} 件商品${result.complete ? '' : '（列表可能不完整）'}。请设置计划后开始。`});
          log('info', state.message);
          for (const warning of state.warnings) log('warn', warning);
          return result;
        } catch (error) {
          if (ticket !== epoch || operation.signal.aborted || isAbort(error)) return null;
          emit({status: 'error', products: [], complete: false, total: 0, message: error.message});
          log('error', error.message);
          throw error;
        } finally { if (controller === operation) controller = null; }
      });
    }

    async function start() {
      if (['running', 'paused', 'scanning'].includes(state.status)) throw new Error('已有任务运行，请先暂停、继续或停止。');
      if (!state.products.length) {
        await scan();
        // A stop during a scan must never start a new task when that scan returns.
        if (state.status === 'stopped') return;
      }
      if (!state.products.length) return;
      const plan = parsePlan(config.plan || state.products.slice(0, MAX_PLAN_ITEMS).map(item => item.number).join(','));
      const found = new Set(state.products.map(item => item.number));
      const missing = [...new Set(plan.filter(number => !found.has(number)))];
      if (missing.length) throw new Error(`计划中的商品序号未找到：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}。请重新抓取或修改计划。`);
      invalidate();
      consecutiveFailures = 0;
      remainingMs = null;
      const ticket = epoch;
      emit({status: 'running', plan, index: 0, cycle: 1, current: null, successes: 0, failures: 0, nextAt: null, message: '计划已启动。'});
      log('info', `开始执行 ${plan.length} 项计划，间隔 ${config.intervalSeconds} 秒，${config.loop ? '循环执行' : '执行一轮'}。`);
      return exclusive(() => step(ticket, false));
    }

    function pause() {
      if (state.status !== 'running') return;
      remainingMs = state.nextAt === null ? 0 : Math.max(0, state.nextAt - now());
      invalidate();
      emit({status: 'paused', nextAt: null, message: '已暂停，继续后从当前进度执行。'});
      log('info', '计划已暂停。');
    }
    function resume() {
      if (state.status !== 'paused') return;
      invalidate();
      emit({status: 'running', message: '计划已继续。'});
      log('info', '计划已继续。');
      schedule(remainingMs ?? config.intervalSeconds * 1000);
      remainingMs = null;
    }
    function stop() {
      invalidate();
      remainingMs = null;
      emit({status: 'stopped', nextAt: null, message: '计划已停止。已弹出的商品保持页面当前状态。'});
      log('info', '计划已停止。');
    }
    async function next() {
      if (!['running', 'paused'].includes(state.status)) throw new Error('请先开启计划，再执行下一件。');
      const stayPaused = state.status === 'paused';
      const requestedEpoch = epoch;
      if (timer !== null) cancel(timer);
      timer = null;
      emit({nextAt: null});
      // A click that has reached the website cannot be undone by aborting its
      // confirmation. Let that step settle before advancing to the next item.
      return exclusive(async () => {
        if (requestedEpoch !== epoch || !['running', 'paused'].includes(state.status)) return;
        if (!stayPaused && state.status === 'paused') return;
        invalidate();
        return step(epoch, stayPaused);
      });
    }
    function setSettings(value) {
      if (['running', 'paused', 'scanning'].includes(state.status)) throw new Error('请先停止任务，再修改计划或设置。');
      config = validateSettings(value);
    }
    return {scan, start, pause, resume, stop, next, setSettings, getState: copy};
  }

  const api = {DEFAULT_SETTINGS, MAX_PLAN_ITEMS, parsePlan, validateSettings, createRunner};
  root.BaiduLiveCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

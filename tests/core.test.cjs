'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parsePlan, validateSettings, createRunner} = require('../extension/lib/core.js');

function harness(options = {}) {
  let time = 0, serial = 0;
  const timers = new Map();
  const clicks = [], logs = [];
  const products = Array.from({length: options.count || 150}, (_, i) => ({number: i + 1, id: `goods-${i + 1}`, title: `商品${i + 1}`}));
  const clock = {now: () => time, setTimeout: (fn, delay) => {timers.set(++serial, {fn, at: time + delay}); return serial;}, clearTimeout: id => timers.delete(id)};
  const adapter = {
    scan: options.scan || (async () => ({products, total: products.length, complete: true, warnings: []})),
    explain: options.explain || (async product => {clicks.push(product.number); return {...product, confirmed: true};})
  };
  const runner = createRunner({adapter, settings: {plan: options.plan ?? '1-3', intervalSeconds: 8, loop: options.loop ?? true}, clock, onLog: entry => logs.push(entry)});
  async function tick(ms) {
    time += ms;
    for (const [id, task] of [...timers]) if (task.at <= time) {timers.delete(id); task.fn();}
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  return {runner, clicks, logs, tick, timers, products};
}

test('plans keep order and repeats while allowing exactly 200 items', () => {
  assert.deepEqual(parsePlan('3，1,5-7；3'), [3,1,5,6,7,3]);
  assert.deepEqual(parsePlan('1-200'), Array.from({length:200}, (_, i) => i + 1));
  assert.deepEqual(parsePlan('201,500'), [201,500], 'The limit counts planned items, not product identity numbers');
  assert.throws(() => parsePlan('1-201'), /200/);
  assert.throws(() => parsePlan('1-100,101-200,1'), /200/);
  assert.throws(() => validateSettings({plan:'1-201'}), /200/);
  for (const invalid of ['', '0', '-1', '5-2', '1.2', 'abc', '1-10001', '1e6', '1000001']) assert.throws(() => parsePlan(invalid));
});
test('settings reject invalid intervals and malformed imported objects', () => {
  assert.equal(validateSettings({}).intervalSeconds, 8);
  assert.equal(validateSettings({intervalSeconds: 1}).intervalSeconds, 1);
  assert.equal(validateSettings({}).followCurrent, true);
  assert.equal(validateSettings({followCurrent:false}).followCurrent, false);
  for (const invalid of [{intervalSeconds: 0}, {intervalSeconds: ''}, {intervalSeconds: 'x'}, {intervalSeconds: Infinity}, {loop:'false'}, {followCurrent:'false'}, {selectors: []}, {selectors: {row: 42}}, null, []]) assert.throws(() => validateSettings(invalid));
});
test('8 second sequencing, pause/resume remaining countdown, loop and stop', async () => {
  const h = harness(); await h.runner.start();
  assert.deepEqual(h.clicks, [1]);
  await h.tick(3000); h.runner.pause(); await h.tick(60000);
  assert.deepEqual(h.clicks, [1]);
  h.runner.resume(); await h.tick(4999); assert.deepEqual(h.clicks, [1]);
  await h.tick(1); assert.deepEqual(h.clicks, [1,2]);
  await h.tick(8000); await h.tick(8000); assert.deepEqual(h.clicks, [1,2,3,1]);
  assert.equal(h.runner.getState().cycle, 2);
  h.runner.stop(); await h.tick(60000); assert.deepEqual(h.clicks, [1,2,3,1]);
  await h.runner.start(); assert.deepEqual(h.clicks, [1,2,3,1,1]); h.runner.stop();
});
test('one-shot completes, next while paused performs only one step', async () => {
  const h = harness({loop:false}); await h.runner.start(); h.runner.pause();
  await h.runner.next(); assert.deepEqual(h.clicks, [1,2]); assert.equal(h.runner.getState().status,'paused');
  await h.tick(80000); assert.deepEqual(h.clicks,[1,2]);
  await h.runner.next(); assert.equal(h.runner.getState().status,'completed');
});
test('missing product prevents clicks and plan defaults to actual scanned numbers', async () => {
  const h = harness({plan:'151'}); await assert.rejects(h.runner.start(), /151/); assert.equal(h.clicks.length,0);
  const all = harness({plan:''}); await all.runner.start(); assert.equal(all.runner.getState().plan.length,150); all.runner.stop();
});

test('200-item loop confirms every item in order before returning to the first', async () => {
  const h = harness({count:200,plan:'1-200'});
  await h.runner.start();
  for (let index = 0; index < 200; index++) await h.tick(8000);
  assert.deepEqual(h.clicks, [...Array.from({length:200}, (_, i) => i + 1), 1]);
  const state = h.runner.getState();
  assert.equal(state.successes,201);
  assert.equal(state.failures,0);
  assert.equal(state.cycle,2);
  assert.equal(state.current.number,1);
  h.runner.stop();
  await h.tick(8000);
  assert.equal(h.clicks.length,201);
});

test('automatic plan takes at most 200 items without truncating the scanned catalog', async () => {
  for (const count of [200,201]) {
    const h = harness({count,plan:'',loop:false});
    await h.runner.start();
    for (let index = 1; index < 200; index++) await h.runner.next();
    const state = h.runner.getState();
    assert.equal(state.products.length,count);
    assert.equal(state.complete,true);
    assert.deepEqual(state.plan,Array.from({length:200}, (_, i) => i + 1));
    assert.deepEqual(h.clicks,state.plan);
    assert.equal(state.status,'completed');
    assert.equal(state.current.number,200);
    assert.equal(h.timers.size,0);
  }
});

test('explicit 1-200 plan refuses to start when product 200 is absent', async () => {
  const h = harness({count:199,plan:'1-200'});
  await assert.rejects(h.runner.start(), /200/);
  assert.deepEqual(h.clicks,[]);
  assert.equal(h.timers.size,0);
});
test('confirmation is required, three consecutive failures pause automatically', async () => {
  const h = harness({explain:async () => ({confirmed:false})});
  await h.runner.start(); await h.tick(8000); await h.tick(8000);
  assert.equal(h.runner.getState().status,'paused'); assert.equal(h.runner.getState().failures,3); assert.equal(h.runner.getState().successes,0);
  await h.tick(80000); assert.equal(h.runner.getState().failures,3);
});
test('stop during scanning prevents a delayed start and aborts scan signal', async () => {
  let finish, signal;
  const h = harness({scan: opts => {signal = opts.signal; return new Promise(resolve => {finish = resolve;});}});
  const starting = h.runner.start(); await Promise.resolve(); await Promise.resolve();
  h.runner.stop(); assert.equal(signal.aborted,true);
  finish({products:h.products,complete:true,total:150,warnings:[]}); await starting;
  assert.equal(h.runner.getState().status,'stopped'); assert.deepEqual(h.clicks,[]);
});
test('stop during click confirmation discards stale outcome and schedules nothing', async () => {
  let finish, signal;
  const h = harness({explain:(product,opts) => {signal=opts.signal;return new Promise(resolve => {finish=resolve;});}});
  await h.runner.scan(); const starting = h.runner.start();
  await Promise.resolve(); await Promise.resolve(); h.runner.stop();
  assert.equal(signal.aborted,true); finish({confirmed:true}); await starting; await h.tick(80000);
  assert.equal(h.runner.getState().successes,0); assert.equal(h.runner.getState().status,'stopped'); assert.equal(h.timers.size,0);
});
test('duplicate numbering blocks start rather than binding the wrong product', async () => {
  const h = harness({scan:async()=>({products:[{number:1,id:'a'},{number:1,id:'b'}],complete:false})});
  await assert.rejects(h.runner.start(),/重复/); assert.deepEqual(h.clicks,[]);
});
test('settings cannot change while running or paused', async () => {
  const h = harness();await h.runner.start();assert.throws(()=>h.runner.setSettings({plan:'4'}),/停止/);
  h.runner.pause();assert.throws(()=>h.runner.setSettings({plan:'4'}),/停止/);h.runner.stop();h.runner.setSettings({plan:'4'});
});
test('next during a pending confirmation advances after settlement without double click', async () => {
  let finish, firstSignal;
  const clicks = [];
  const h = harness({explain:(product, opts) => {
    clicks.push(product.number);
    if (clicks.length === 1) {
      firstSignal = opts.signal;
      return new Promise(resolve => {finish = () => resolve({...product,confirmed:true});});
    }
    return Promise.resolve({...product,confirmed:true});
  }});
  await h.runner.scan();
  const starting = h.runner.start(); await Promise.resolve(); await Promise.resolve();
  const next = h.runner.next(); await Promise.resolve();
  assert.equal(firstSignal.aborted,false);
  assert.deepEqual(clicks,[1]);
  finish(); await starting; await next;
  assert.deepEqual(clicks,[1,2]);
  h.runner.stop();
});
test('a queued next cannot revive a task after stop', async () => {
  let finish;
  const clicks=[];
  const h=harness({explain:product=>{clicks.push(product.number);return new Promise(resolve=>{finish=()=>resolve({...product,confirmed:true});});}});
  await h.runner.scan();const starting=h.runner.start();await Promise.resolve();await Promise.resolve();
  const next=h.runner.next();h.runner.stop();finish();await starting;await next;
  assert.deepEqual(clicks,[1]);assert.equal(h.runner.getState().status,'stopped');
});

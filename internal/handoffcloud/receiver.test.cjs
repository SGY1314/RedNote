const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'receiver.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return {promise, resolve}; }
function reply(envelope, extra = {}) { return {ok:true, status:200, json:async () => ({envelope, ...extra})}; }
function envelope(state = 'scanned') {
  return {id:'development-session', state, expires_at:new Date(Date.now() + 120000).toISOString(), snapshot:{title:'Private frozen title', body:'Draft content', topics:['test'], media:[{kind:'image', preview_url:'http://127.0.0.1:8083/v1/media/session/asset?key=readonly'}]}};
}

function browser(fetch) {
  const elements = new Map();
  const events = new Map();
  const timers = new Map();
  const storage = new Map();
  let nextTimer = 1;
  const element = () => ({hidden:false, disabled:false, textContent:'', children:[], events:new Map(), replaceChildren(...children) {this.children = children;}, setAttribute() {}, addEventListener(name, callback) {this.events.set(name, callback);}});
  for (const id of ['claim','editor','cancel','notice','draft','media','title','body','topics','expiry']) elements.set(id, element());
  elements.get('draft').hidden = true;
  const context = {
    document:{getElementById:(id) => elements.get(id), createElement:element},
    addEventListener:(name, callback) => events.set(name, callback),
    setTimeout:(callback, delay) => {const id = nextTimer++; timers.set(id, {callback, delay}); return id;},
    clearTimeout:(id) => timers.delete(id),
    sessionStorage:{getItem:(key) => storage.get(key), setItem:(key,value) => storage.set(key,value), removeItem:(key) => storage.delete(key)},
    location:{origin:'http://127.0.0.1:8083', search:'?ticket=one-time-ticket'},
    history:{replaceState() {}},
    fetch, AbortController, URL, URLSearchParams, Date, Set,
  };
  vm.runInNewContext(source, context, {filename:'receiver.js'});
  return {elements, events, timers, storage,
    click:(id) => elements.get(id).events.get('click')(),
    poll() {const entry = [...timers.entries()].find(([,timer]) => timer.delay === 2000); assert.ok(entry, 'poll timer missing'); timers.delete(entry[0]); return entry[1].callback();},
  };
}

test('late poll response cannot restore a cancelled draft', async () => {
  const pending = deferred(); let pollSignal;
  const ui = browser(async (url, options) => {
    if (url.endsWith('/open')) return reply(envelope(), {receiver_token:'scoped-receiver-token'});
    if (url.endsWith('/session')) {pollSignal = options.signal; return pending.promise;}
    if (url.endsWith('/cancel')) return reply(envelope('cancelled'));
    throw new Error('Unexpected request: ' + url);
  });
  await flush();
  assert.equal(ui.elements.get('draft').hidden, false);
  const polling = ui.poll(); await flush();
  await ui.click('cancel');
  assert.equal(pollSignal.aborted, true);
  assert.equal(ui.elements.get('draft').hidden, true);
  assert.equal(ui.storage.size, 0);
  pending.resolve(reply(envelope())); await polling; await flush();
  assert.equal(ui.elements.get('draft').hidden, true);
  assert.equal(ui.elements.get('title').textContent, '');
  assert.equal(ui.elements.get('media').children.length, 0);
  assert.equal(ui.storage.size, 0);
  assert.match(ui.elements.get('notice').textContent, /撤销/);
  assert.equal([...ui.timers.values()].some((timer) => timer.delay === 2000), false);
});

test('pagehide aborts a pending action and ignores its later response', async () => {
  const pending = deferred(); let actionSignal;
  const ui = browser(async (url, options) => {
    if (url.endsWith('/open')) return reply(envelope(), {receiver_token:'scoped-receiver-token'});
    if (url.endsWith('/claim')) {actionSignal = options.signal; return pending.promise;}
    throw new Error('Unexpected request: ' + url);
  });
  await flush();
  const action = ui.click('claim'); await flush();
  ui.events.get('pagehide')();
  assert.equal(actionSignal.aborted, true);
  pending.resolve(reply(envelope('claimed'))); await action; await flush();
  assert.equal(ui.elements.get('notice').textContent, '资源已送达此设备');
  assert.equal([...ui.timers.values()].some((timer) => timer.delay === 2000), false);
});

test('a delayed poll cannot overwrite a completed claim', async () => {
  const pending = deferred();
  const ui = browser(async (url) => {
    if (url.endsWith('/open')) return reply(envelope(), {receiver_token:'scoped-receiver-token'});
    if (url.endsWith('/session')) return pending.promise;
    if (url.endsWith('/claim')) return reply(envelope('claimed'));
    throw new Error('Unexpected request: ' + url);
  });
  await flush();
  const polling = ui.poll(); await flush();
  await ui.click('claim');
  pending.resolve(reply(envelope())); await polling;
  assert.equal(ui.elements.get('notice').textContent, '资源已接收');
  assert.equal(ui.elements.get('editor').disabled, false);
  assert.equal(ui.elements.get('claim').disabled, true);
});

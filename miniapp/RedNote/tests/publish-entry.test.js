const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublishEntry } = require('../features/publish/publish-entry');

function setup(overrides = {}, dependencies = {}) {
  const pending = new Map(), calls = [];
  let next = 0;
  const state = { enabled: true, status: 'scanned', snapshot: { fingerprint: 'original-note', media: [{ kind: 'image' }] },
    mediaReady: false, edits: { title: '原始标题', body: '正文', topics: [] }, ...overrides };
  const entry = createPublishEntry({ view: () => state,
    schedule: (callback, delay) => { const id = ++next; pending.set(id, { callback, delay }); return id; },
    cancel: id => pending.delete(id),
    claim: async () => { calls.push('claim'); state.status = 'claimed'; },
    prepare: async () => { calls.push(structuredClone(state.edits)); state.officialAvailable = true; },
    ...dependencies,
  });
  return { state, entry, pending, calls, async flush() {
    const [id, task] = [...pending][0] || [];
    if (task) { pending.delete(id); await task.callback(); }
  } };
}

test('scanning prepares the verified native button without a visible claim step or an automatic editor call', async () => {
  const page = setup();
  page.entry.observe(); page.entry.observe();
  assert.equal(page.pending.size, 1);
  await page.flush();
  assert.deepEqual(page.calls, ['claim']);
  assert.equal(page.pending.size, 0);
  page.state.mediaReady = true;
  page.entry.observe();
  assert.equal([...page.pending.values()][0].delay, 450);
  await page.flush();
  assert.deepEqual(page.calls, ['claim', page.state.edits]);
  assert.equal(page.state.officialAvailable, true);
  assert.equal(page.pending.size, 0);
});

test('editing debounces preparation and freezes the most recent text instead of requesting per keystroke', async () => {
  const page = setup({ status: 'claimed', mediaReady: true });
  for (const title of ['我', '我的', '我的探店记录']) {
    page.state.edits = { ...page.state.edits, title };
    page.entry.observe();
    assert.equal(page.pending.size, 1);
  }
  assert.equal(page.calls.length, 0);
  await page.flush();
  assert.equal(page.calls[0].title, '我的探店记录');
});

test('expired, invalid, unavailable, incomplete-media and mixed media states cannot prepare a publishing entry', () => {
  for (const change of [{ enabled: false }, { isError: true }, { snapshot: null }, { busy: true }, { editorBusy: true },
    { editorError: '组件拒绝' }, { status: 'expired' }, { status: 'claimed', mediaReady: false },
    { officialTitle: '已在等待原生组件渲染的标题' }, { snapshot: { fingerprint: 'mixed', media: [{ kind: 'video' }, {kind: 'image'}] } }]) {
    const page = setup(change);
    page.entry.observe();
    assert.equal(page.pending.size, 0, JSON.stringify(change));
  }
});

test('hiding, unloading or expiry cancels queued work and late claim completion cannot mount an entry while hidden', async () => {
  for (const action of ['pause', 'dispose']) {
    const page = setup(); page.entry.observe(); page.entry[action]();
    assert.equal(page.pending.size, 0);
  }
  const expired = setup(); expired.entry.observe(); expired.state.isError = true; expired.entry.observe();
  assert.equal(expired.pending.size, 0);
  let finish;
  const page = setup({ mediaReady: true }, { claim: () => new Promise(resolve => { finish = resolve; }) });
  page.entry.observe(); const inFlight = page.flush();
  page.entry.pause(); page.state.status = 'claimed'; finish(); await inFlight;
  assert.equal(page.pending.size, 0);
  page.entry.resume();
  assert.equal(page.pending.size, 1);
  page.entry.dispose();
});

test('a preparation failure stays actionable without an automatic retry loop', async () => {
  const page = setup({ status: 'claimed', mediaReady: true }, { prepare: async () => { page.state.editorError = '请在手机打开'; } });
  page.entry.observe(); await page.flush(); page.entry.observe();
  assert.equal(page.pending.size, 0);
  page.state.editorError = '';
  page.entry.observe();
  assert.equal(page.pending.size, 1);
  page.entry.dispose();
});

test('single video follows claim then loaded-media preparation without opening automatically', async () => {
 const page=setup({snapshot:{fingerprint:'video',media:[{kind:'video'}]}});
 page.entry.observe();await page.flush();assert.equal(page.state.status,'claimed');assert.equal(page.pending.size,0);
 page.state.mediaReady=true;page.entry.observe();await page.flush();assert.equal(page.state.officialAvailable,true);
});

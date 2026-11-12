const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextHandoff, handoffFields } = require('../features/publish/text-handoff');
const { draftFields } = require('../features/publish/draft-editor');
const { createDemoDraft } = require('./fixtures/demo-drafts');

function setup() {
  const snapshot = createDemoDraft().snapshot;
  const data = { snapshot, status: 'claimed', isError: false, busy: false, officialAvailable: true,
    ...draftFields(snapshot), ...handoffFields() };
  const calls = [], patches = [], jobs = new Map();
  let next = 0;
  const platform = { setClipboardData: options => calls.push(options) };
  const handoff = createTextHandoff({ platform, view: () => data,
    onChange: patch => { patches.push(patch); Object.assign(data, patch); },
    schedule: callback => { const id = ++next; jobs.set(id, callback); return id; }, cancel: id => jobs.delete(id) });
  return { data, calls, patches, jobs, platform, handoff };
}

test('entering a valid draft automatically copies title, body and topics once without opening anything', () => {
  const state = setup();
  state.handoff.observe();
  assert.equal(state.data.publishCopyBusy, true);
  assert.equal(state.data.copyState, '');
  assert.equal(state.calls[0].data, `${state.data.draftTitle}\n\n${state.data.draftBody}\n\n#日常灵感 #慢生活`);
  state.handoff.observe(); state.data.status = 'scanned'; state.handoff.observe();
  assert.equal(state.calls.length, 1);
  state.calls[0].success();
  assert.equal(state.data.publishCopyBusy, false);
  assert.equal(state.data.copyState, 'copied');
  state.data.status = 'claimed'; state.handoff.observe();
  assert.equal(state.calls.length, 1);
  assert.equal(state.data.publishAssistOpen, undefined);
  assert.equal(state.jobs.size, 0);
});

test('manual retry copies the complete current draft, and does not depend on media being ready', async () => {
  const state = setup();
  state.data.officialAvailable = false;
  state.data.draftTitle = '修改后的标题';
  state.data.draftBody = '第一段\n\n第二段';
  state.data.draftTopics = ['生活', '配色'];
  const result = state.handoff.copy();
  assert.equal(state.calls[0].data, '修改后的标题\n\n第一段\n\n第二段\n\n#生活 #配色');
  state.calls[0].success();
  assert.equal(await result, true);
  assert.equal(state.data.copyState, 'copied');
  state.handoff.observe(); assert.equal(state.calls.length, 1);
});

test('edits debounce clipboard updates and polling does not repeatedly overwrite the clipboard', () => {
  const state = setup(); state.handoff.observe(); state.calls[0].success();
  state.data.draftBody = '正在修改'; state.handoff.observe();
  assert.equal(state.data.copyState, ''); assert.equal(state.jobs.size, 1);
  state.data.draftBody = '修改完成的正文'; state.data.draftTopics = ['设计']; state.handoff.observe();
  assert.equal(state.jobs.size, 1); assert.equal(state.calls.length, 1);
  const [id, callback] = [...state.jobs][0]; state.jobs.delete(id); callback();
  assert.equal(state.calls.length, 2); assert.match(state.calls[1].data, /修改完成的正文\n\n#设计$/);
  state.calls[1].success(); state.handoff.observe(); state.handoff.observe();
  assert.equal(state.calls.length, 2); assert.equal(state.data.copyState, 'copied');
  assert.equal(state.jobs.size, 0);
});

test('clipboard failure, unsupported API and timeout never produce a copied marker', async () => {
  for (const failure of ['failure', 'missing', 'timeout']) {
    const state = setup();
    if (failure === 'missing') delete state.platform.setClipboardData;
    const result = state.handoff.copy();
    if (failure === 'failure') state.calls[0].fail();
    if (failure === 'timeout') [...state.jobs.values()][0]();
    assert.equal(await result, false);
    assert.equal(state.data.publishCopyBusy, false);
    assert.equal(state.data.copyState, '');
    assert.match(state.data.copyError, /复制/);
    assert.equal(state.data.officialAvailable, true);
    if (state.calls.length) state.calls[0].success();
    assert.equal(state.data.copyState, '');
    assert.equal(state.jobs.size, 0);
    state.handoff.observe(); assert.equal(state.jobs.size, 0);
  }
});

test('edits and expiry suppress stale clipboard acknowledgements', async () => {
  for (const change of [data => { data.draftBody = '改过的正文'; }, data => { data.status = 'expired'; data.officialAvailable = false; }]) {
    const state = setup(), result = state.handoff.copy();
    change(state.data);
    state.handoff.observe();
    state.calls[0].success();
    assert.equal(await result, false);
    assert.equal(state.data.copyState, '');
    state.handoff.dispose(); assert.equal(state.jobs.size, 0);
  }
});

test('a superseded copy cannot overwrite the currently selected clipboard acknowledgement', async () => {
  const state = setup(), first = state.handoff.copy();
  state.data.draftTitle = '更新的标题'; const second = state.handoff.copy();
  state.calls[1].success();
  state.calls[0].success();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(state.data.copyState, 'copied');
  assert.match(state.calls[1].data, /^更新的标题\n\n/);
});

test('backgrounding ignores late copies and returning refreshes the complete current copy', async () => {
  const state = setup(), result = state.handoff.copy();
  state.handoff.hide();
  state.data.officialAvailable = false;
  state.handoff.observe();
  state.calls[0].success();
  assert.equal(await result, false);
  state.handoff.show();
  assert.equal(state.calls.length, 2); assert.equal(state.data.publishCopyBusy, true);
  state.calls[1].success(); assert.equal(state.data.copyState, 'copied');
});

test('hidden, disposed, expired, loading, invalid and busy pages do not copy', async () => {
  for (const change of [s => { s.data.expiresAt = new Date(Date.now() - 1).toISOString(); }, s => { s.data.isError = true; },
    s => { s.data.status = 'loading'; },
    s => { s.data.busy = true; }, s => s.handoff.hide(), s => s.handoff.dispose()]) {
    const state = setup(); change(state);
    state.handoff.observe(); assert.equal(await state.handoff.copy(), false);
    assert.equal(state.calls.length, 0);
  }
  const state = setup(), result = state.handoff.copy(), count = state.patches.length;
  state.handoff.dispose(); state.calls[0].success();
  assert.equal(await result, false);
  assert.equal(state.patches.length, count);
  assert.equal(state.jobs.size, 0);
});

test('returning after expiry cannot overwrite the clipboard with expired content', () => {
  const state = setup(); state.handoff.observe(); state.calls[0].success();
  state.handoff.hide(); state.data.expiresAt = new Date(Date.now() - 1).toISOString();
  state.handoff.show(); assert.equal(state.calls.length, 1); assert.equal(state.data.copyState, '');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeEditorView } = require('../features/publish/native-editor-view');
const payload = title => ({ officialAvailable: true, officialTitle: title, officialContent: '正文第一行\n第二行',
  officialTags: '测试,图文', officialMediaInfo: JSON.stringify({ image_resources: [{ url: 'https://cloud.example.com/own-image.png' }] }) });
function setup() {
  const callbacks = [], frames = [];
  const page = { data: { officialAvailable: false, officialMounted: false }, setData(patch, done) {
    Object.assign(this.data, patch); frames.push(structuredClone(this.data)); if (done) callbacks.push(done);
  } };
  return { page, frames, view: createNativeEditorView(page), flush() { while (callbacks.length) callbacks.shift()(); } };
}

test('native title/body/tags/media finish rendering before a dynamic publisher is mounted', () => {
  const { page, frames, view, flush } = setup();
  view.apply(payload('网站标题'));
  assert.equal(page.data.officialAvailable, false); assert.equal(page.data.officialMounted, false);
  assert.equal(page.data.officialTitle, '网站标题'); assert.equal(page.data.officialContent, payload().officialContent);
  flush();
  assert.equal(page.data.officialMounted, true); assert.equal(page.data.officialAvailable, true);
  assert.ok(frames.filter(frame => frame.officialMounted).every(frame => frame.officialTitle && frame.officialContent && frame.officialMediaInfo));
});

test('page hiding revokes the interactive grant while retaining frozen native parameters until return', () => {
  const { page, view, flush } = setup(); const expected = payload('完整图文');
  view.apply(expected); flush(); view.hide();
  view.apply({ officialAvailable: false, officialTitle: '', officialContent: '', officialTags: '', officialMediaInfo: '' });
  assert.equal(page.data.officialAvailable, false); assert.equal(page.data.officialMounted, true);
  for (const field of ['officialTitle', 'officialContent', 'officialTags', 'officialMediaInfo']) assert.equal(page.data[field], expected[field]);
  view.show();
  assert.equal(page.data.officialMounted, false); assert.equal(page.data.officialAvailable, false);
  assert.equal(page.data.officialTitle, ''); assert.equal(page.data.officialContent, '');
  assert.equal(page.data.published, undefined);
});

test('late render callbacks cannot mount a hidden, expired, superseded or disposed publishing entry', () => {
  for (const invalidate of [state => state.view.hide(), state => state.view.apply({ officialAvailable: false }), state => state.view.dispose()]) {
    const state = setup(); state.view.apply(payload('迟到的文字')); invalidate(state); state.flush();
    assert.equal(state.page.data.officialAvailable, false); assert.equal(state.page.data.officialMounted, false);
  }
  const state = setup(); state.view.apply(payload('旧稿件')); state.view.apply(payload('新稿件')); state.flush();
  assert.equal(state.page.data.officialTitle, '新稿件'); assert.equal(state.page.data.officialMounted, true);
  assert.ok(state.frames.filter(frame => frame.officialMounted).every(frame => frame.officialTitle === '新稿件'));
});

test('native validation errors clear visible parameters immediately and hidden pages cannot accept a new grant', () => {
  const state = setup(); state.view.apply(payload('网站稿件')); state.flush();
  state.view.apply({ officialAvailable: false, officialTitle: '', officialContent: '', officialMediaInfo: '', editorError: '组件拒绝参数' });
  assert.equal(state.page.data.officialMounted, false); assert.equal(state.page.data.officialTitle, '');
  assert.equal(state.page.data.editorError, '组件拒绝参数');
  state.view.hide(); state.view.apply(payload('隐藏期间不接受')); state.flush();
  assert.equal(state.page.data.officialMounted, false); assert.equal(state.page.data.officialTitle, '');
});

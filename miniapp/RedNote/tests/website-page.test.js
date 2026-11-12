const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const { createPublishEntry } = require('../features/publish/publish-entry');

for (const kind of ['image','video']) test(`shop Page ${kind} prepares verified content without auto-opening and retains native props`, async () => {
  const filename = path.join(__dirname, '../pages/publish/index.js');
  const source = fs.readFileSync(filename, 'utf8');
  const draft = createDemoDraft(kind, Date.now()); draft.state = 'scanned';
  draft.snapshot.media.forEach((item, i) => { item.preview_url = `https://cloud.example.com/image-${i}.png?key=readonly`; });
  let definition, simulatedEditorCalls = 0, receivedScene;
  const clipboard = [];
  const scheduled = new Map();
  let nextJob = 0;
  async function flushEntry() {
    const [id, callback] = [...scheduled][0];
    scheduled.delete(id);
    await callback();
  }
  const gateway = {
    kind: 'development-cloud', mediaOrigin: 'https://cloud.example.com',
    load: async scene => { receivedScene = scene; return { envelope: structuredClone(draft), status: draft.state }; },
    refresh: async () => ({ envelope: structuredClone(draft), status: draft.state }),
    claim: async () => { draft.state = 'claimed'; return draft.state; },
    openEditor: async () => { simulatedEditorCalls++; return 'editor_opened'; },
    dispose() {},
  };
  const platform = {
    getStorageSync: () => null,
    getAccountInfoSync: () => ({ miniProgram: { appId: 'a'.repeat(24), envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'ios', version: '9.15.0', SDKVersion: '3.133.1' }),
    canIUse: () => false,
    setClipboardData(options) { clipboard.push(options.data); options.success(); },
    login() { throw new Error('No login'); },
    request() { throw new Error('Only the injected receiver transport may request data'); },
  };
  vm.runInNewContext(source, {
    Page: value => { definition = value; }, xhs: platform, setInterval: () => 1, clearInterval() {},
    require: value => {
      if (value === '../../config/runtime') return { developmentEditorCheck: true };
      if (value === '../../services/gateway') return { createGateway: () => gateway };
      if (value === '../../features/publish/publish-entry') return { createPublishEntry: options => createPublishEntry({ ...options,
        schedule: callback => { const id = ++nextJob; scheduled.set(id, callback); return id; },
        cancel: id => scheduled.delete(id),
      }) };
      return require(path.resolve(path.dirname(filename), value));
    },
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, done) { Object.assign(this.data, patch); if (done) done(); } };
  page.onLoad({ scene: 'q'.repeat(32) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.editorCheckEnabled, true); assert.equal(page.data.officialAvailable, false);
  assert.equal(receivedScene, 'q'.repeat(32));
  assert.equal(page.data.snapshot.title, draft.snapshot.title);
  assert.equal(page.data.snapshot.body, draft.snapshot.body);
  assert.equal(page.data.statusTitle, '参考笔记');
  assert.equal(scheduled.size, 1);
  await flushEntry();
  assert.equal(draft.state, 'claimed');
  assert.equal(page.data.officialAvailable, false);
  assert.equal(scheduled.size, 0);
  for (let i = 0; i < page.data.media.length; i++) {
    const item = page.data.media[i];
    page.onMediaLoaded({ currentTarget: { dataset: { index: i, asset: item.asset_id, url: item.preview_url } } });
  }
  assert.equal(page.data.allImagesReady, true);
  assert.equal(scheduled.size, 1);
  await flushEntry();
  assert.equal(page.data.officialAvailable, true);
  assert.equal(page.data.officialMounted, true);
  assert.equal(page.data.officialTitle, draft.snapshot.title);
  assert.equal(page.data.officialContent, draft.snapshot.body);
  assert.equal(simulatedEditorCalls, 0);
  assert.equal(clipboard.length, 1);
  assert.equal(clipboard[0], `${draft.snapshot.title}\n\n${draft.snapshot.body}\n\n${draft.snapshot.topics.map(topic => `#${topic}`).join(' ')}`);
  page.onDraftInput({ currentTarget: { dataset: { field: 'draftTitle' } }, detail: { value: '手机上修改后的标题' } });
  page.onDraftInput({ currentTarget: { dataset: { field: 'draftBody' } }, detail: { value: '手机上修改后的正文' } });
  page.editTopics(); assert.equal(page.data.editingTopics, true);
  page.onDraftInput({ currentTarget: { dataset: { field: 'draftTopicsText' } }, detail: { value: '#新话题 #视觉治愈' } });
  page.finishTopics(); assert.equal(page.data.editingTopics, false);
  assert.equal(page.data.officialAvailable, false);
  await page.controller.refresh();
  assert.equal(page.data.draftTitle, '手机上修改后的标题');
  assert.equal(page.data.snapshot.title, draft.snapshot.title);
  page.copyDraft();
  assert.match(clipboard[1], /手机上修改后的标题\n\n手机上修改后的正文/);
  assert.match(clipboard[1], /#新话题 #视觉治愈$/);
  assert.equal(page.data.copyState, 'copied');
  assert.equal(scheduled.size, 1);
  await flushEntry();
  assert.equal(page.data.officialAvailable, true);
  assert.equal(page.data.officialTitle, '手机上修改后的标题');
  assert.equal(page.data.officialContent, '手机上修改后的正文');
  assert.equal(page.data.officialTags, '新话题,视觉治愈');
  page.onHide(); assert.equal(page.data.officialAvailable, false); assert.equal(page.data.officialMounted, true);
  assert.equal(page.data.officialTitle, '手机上修改后的标题'); assert.equal(page.data.officialContent, '手机上修改后的正文');
  assert.ok(page.data.officialMediaInfo);
  page.onShow(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.officialAvailable, false);
  assert.equal(page.data.officialMounted, false); assert.equal(page.data.officialMediaInfo, '');
  const item = page.data.media[0];
  page.onMediaError({ currentTarget: { dataset: { index: 0, asset: item.asset_id, url: item.preview_url } } });
  assert.equal(page.data.allImagesReady, false); assert.equal(page.data.officialAvailable, false);
  page.onUnload();
  assert.equal(scheduled.size, 0);
});

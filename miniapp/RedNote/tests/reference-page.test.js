const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getReference } = require('../features/references/catalog');
const { createPublishEntry } = require('../features/publish/publish-entry');

function setup(connected = true) {
  const filename = path.join(__dirname, '../pages/publish/index.js');
  const requests = [], clipboard = [], jobs = new Map();
  let definition, next = 0;
  const platform = {
    getAccountInfoSync: () => ({ miniProgram: { appId: 'a'.repeat(24), envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'ios', version: '9.15.0', SDKVersion: '3.133.1' }),
    canIUse: () => true,
    request(options) { requests.push(options); options.success({ statusCode: 200, header: { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' } }); return { abort() {} }; },
    setClipboardData(options) { clipboard.push(options.data); options.success(); },
    login() { throw new Error('Examples must not log in'); },
    getStorageSync() { throw new Error('Examples must not read private receivers'); },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, xhs: platform, setInterval: () => 1, clearInterval() {},
    require: value => {
      if (value === '../../config/runtime') return { apiBaseUrl: connected ? 'https://notes.example.com' : '', developmentEditorCheck: connected };
      if (value === '../../services/gateway') return { createGateway() { throw new Error('References must not touch private cloud receiving'); } };
      if (value === '../../features/publish/publish-entry') return { createPublishEntry: options => createPublishEntry({ ...options,
        schedule: callback => { const id = ++next; jobs.set(id, callback); return id; }, cancel: id => jobs.delete(id),
      }) };
      return require(path.resolve(path.dirname(filename), value));
    },
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, done) { Object.assign(this.data, patch); if (done) done(); } };
  return { page, requests, clipboard, jobs, async flush() { const [id, callback] = [...jobs][0]; jobs.delete(id); await callback(); } };
}

test('each home reference opens the same creation page with packaged materials, editable copy and a verified manual native button', async () => {
  for (const id of ['cafe', 'sichuan', 'bakery']) {
    const state = setup(), reference = getReference(id);
    state.page.onLoad({ referenceId: id });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.page.data.referenceMode, true);
    assert.equal(state.page.data.draftTitle, reference.title);
    assert.equal(state.page.data.media[0].display_url, `/assets/reference/${reference.file}`);
    assert.equal(state.requests.length, 0);
    assert.equal(state.clipboard.length, 1);
    assert.equal(state.clipboard[0], `${reference.title}\n\n${reference.body}\n\n${reference.topics.map(topic => `#${topic}`).join(' ')}`);
    const image = state.page.data.media[0];
    state.page.onMediaLoaded({ currentTarget: { dataset: { index: 0, asset: image.asset_id, url: image.preview_url } } });
    state.page.openGallery({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(state.page.data.galleryOpen, true);
    state.page.closeGallery();
    state.page.onDraftInput({ currentTarget: { dataset: { field: 'draftTitle' } }, detail: { value: '我自己的探店记录' } });
    state.page.copyDraft();
    assert.match(state.clipboard[1], /^我自己的探店记录/);
    assert.equal(state.jobs.size, 1);
    await state.flush();
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].method, 'HEAD');
    assert.equal(state.page.data.officialAvailable, true);
    assert.equal(state.page.data.officialMounted, true);
    assert.equal(state.page.data.officialTitle, '我自己的探店记录');
    assert.equal(state.page.data.officialContent, reference.body);
    assert.equal(state.page.data.snapshot.title, reference.title);
    assert.deepEqual(JSON.parse(state.page.data.officialMediaInfo).image_resources,
      [{ url: `https://notes.example.com/reference-notes/${reference.file}` }]);
    assert.equal(state.page.data.published, undefined);
    assert.equal(state.page.data.publishAssistOpen, undefined);
    assert.equal(state.page.preparePublish, undefined);
    state.page.onHide();
    assert.equal(state.page.data.officialTitle, '我自己的探店记录');
    assert.equal(state.page.data.officialContent, reference.body);
    state.page.onShow();
    assert.equal(state.page.data.publishAssistOpen, undefined);
    assert.match(state.clipboard.at(-1), /^我自己的探店记录\n\n/);
    state.page.onUnload();
    assert.equal(state.jobs.size, 0);
  }
});

test('unconfigured app can browse and copy an example without a server, receiver storage or implicit publishing grant', async () => {
  const state = setup(false);
  state.page.onLoad({ referenceId: 'cafe' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.page.data.isError, false);
  assert.equal(state.page.data.media[0].placeholder, false);
  state.page.copyDraft();
  assert.equal(state.clipboard.length, 2);
  assert.equal(state.page.data.editorCheckEnabled, false);
  assert.equal(state.requests.length, 0);
  assert.equal(state.jobs.size, 0);
  state.page.onUnload();
});

test('unknown example routes stop before requesting either public images or private cloud content', () => {
  const state = setup();
  state.page.onLoad({ referenceId: '../another-note' });
  assert.equal(state.page.data.isError, true);
  assert.equal(state.page.data.snapshot, null);
  assert.equal(state.requests.length, 0);
  state.page.onUnload();
});

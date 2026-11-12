const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(gateway = 'development-cloud', navigation = 'success') {
  const filename = path.join(__dirname, '../pages/index/index.js');
  const navigations = [], pending = [], forbiddenCalls = [];
  const forbidden = name => () => { forbiddenCalls.push(name); throw new Error(`Unexpected ${name}`); };
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; },
    xhs: {
      navigateTo(options) {
        navigations.push(options.url);
        if (navigation === 'pending') pending.push(options);
        else { if (options[navigation]) options[navigation](); options.complete(); }
      },
      login: forbidden('login'), request: forbidden('request'),
      getStorageSync: forbidden('getStorageSync'), setStorageSync: forbidden('setStorageSync'),
      removeStorageSync: forbidden('removeStorageSync'), getClipboardData: forbidden('getClipboardData'),
    },
    require: value => value === '../../config/runtime'
      ? { gateway } : require(path.resolve(path.dirname(filename), value)),
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, navigations, forbiddenCalls, pending };
}

test('opening the home page without scan parameters has no platform or network activity', () => {
  const state = setup();
  state.page.onLoad();
  assert.deepEqual(state.navigations, []);
  assert.deepEqual(state.forbiddenCalls, []);
  const template = fs.readFileSync(path.join(__dirname, '../pages/index/index.xhsml'), 'utf8');
  assert.doesNotMatch(template, /<input|<textarea|取件码|粘贴|复制/);
});

test('a launch scene automatically reaches the preview without exposing the credential in page data', () => {
  const state = setup();
  state.page.onLoad({ scene: 'qr-session_01' });
  assert.deepEqual(state.navigations, ['/pages/publish/index?scene=qr-session_01']);
  assert.equal(JSON.stringify(state.page.data).includes('qr-session_01'), false);
  assert.deepEqual(state.forbiddenCalls, []);
});

test('malformed launch parameters cannot navigate or request a draft', () => {
  for (const scene of ['../someone-else', 'ticket?token=secret', '%E0%A4%A', 'a'.repeat(129), { value: 'ticket' }]) {
    const state = setup();
    state.page.onLoad({ scene });
    assert.deepEqual(state.navigations, []);
    assert.ok(state.page.data.launchError);
    assert.deepEqual(state.forbiddenCalls, []);
  }
});

test('unconfigured service rejects a launch before using any platform capability', () => {
  const state = setup('unconfigured');
  state.page.onLoad({ scene: 'qr-session_01' });
  assert.deepEqual(state.navigations, []);
  assert.ok(state.page.data.launchError);
  assert.deepEqual(state.forbiddenCalls, []);
});

test('a pending launch suppresses duplicate navigation and failed navigation stays recoverable by rescanning', () => {
  const state = setup('development-cloud', 'pending');
  state.page.onLoad({ scene: 'first-session' });
  state.page.onLoad({ scene: 'first-session' });
  assert.equal(state.navigations.length, 1);
  state.pending[0].fail(); state.pending[0].complete();
  assert.ok(state.page.data.launchError);
  state.page.onLoad({ scene: 'second-session' });
  assert.equal(state.navigations.length, 2);
  assert.equal(state.navigations[1], '/pages/publish/index?scene=second-session');
  assert.deepEqual(state.forbiddenCalls, []);
});

test('encoded launch credentials are normalized without adding a manual input path', () => {
  const state = setup();
  state.page.onLoad({ scene: 'scan%2Dsession_02' });
  assert.deepEqual(state.navigations, ['/pages/publish/index?scene=scan-session_02']);
  assert.deepEqual(state.forbiddenCalls, []);
});

test('all three reference cards work on first open without scan parameters, credentials or network access', () => {
  for (const id of ['cafe', 'sichuan', 'bakery']) {
    const state = setup('unconfigured');
    state.page.onLoad(); state.page.onShow();
    assert.equal(state.page.data.referenceNotes.filter(note => note.isExample).length, 3);
    state.page.openNote({ currentTarget: { dataset: { id } } });
    assert.deepEqual(state.navigations, [`/pages/publish/index?referenceId=${id}`]);
    assert.deepEqual(state.forbiddenCalls, []);
  }
});

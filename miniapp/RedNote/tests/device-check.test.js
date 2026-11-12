const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const { versionAtLeast, inspectDevice, editorCheckPayload } = require('../features/device-check/policy');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const APP = 'a'.repeat(24);
function platform(overrides = {}) {
  return {
    getAccountInfoSync: () => ({ miniProgram: { appId: APP, envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'ios', version: '8.53', SDKVersion: '3.105.1' }),
    canIUse: () => true,
    login: () => { throw new Error('No login allowed'); },
    request: () => { throw new Error('No network allowed'); },
    ...overrides,
  };
}
function draft() {
  const value = createDemoDraft('image', NOW);
  value.state = 'created';
  value.snapshot.media.forEach((media, index) => { media.preview_url = `https://cdn.example.com/own-image-${index}.jpg`; });
  return value;
}

test('environment checks use local APIs only and never expose a complete AppID', () => {
  const report = inspectDevice(platform());
  assert.equal(report.canCheckEditor, true);
  assert.equal(JSON.stringify(report).includes(APP), false);
  for (const [value, expected] of [['8.9', false], ['8.53', true], ['8.53.0', true], ['8.53-beta', false], ['bad', false]]) assert.equal(versionAtLeast(value, '8.53'), expected);
});

test('tourist, release, simulator, low/unknown versions and missing APIs fail closed', () => {
  const cases = [
    { getAccountInfoSync: () => ({ miniProgram: { appId: 'touristAppId', envVersion: 'develop' } }) },
    { getAccountInfoSync: () => ({ miniProgram: { appId: APP, envVersion: 'release' } }) },
    { getAccountInfoSync: () => ({ miniProgram: { appId: APP } }) },
    { getSystemInfoSync: () => ({ platform: 'devtools', version: '9.9', SDKVersion: '4.0' }) },
    { getSystemInfoSync: () => ({ platform: 'android', version: '8.52', SDKVersion: '3.105.1' }) },
    { getSystemInfoSync: () => ({ platform: 'android', version: '9.0', SDKVersion: '3.104.9' }) },
    { getSystemInfoSync: undefined },
  ];
  for (const override of cases) assert.equal(inspectDevice(platform(override)).canCheckEditor, false);
});

test('component probing is diagnostic and never overrules a supported physical development runtime', () => {
  for (const canIUse of [() => false, undefined, () => { throw new Error('Unknown component probe'); }]) {
    const report = inspectDevice(platform({ canIUse }));
    assert.equal(report.canCheckEditor, true);
    const component = report.checks.find(check => check.key === 'component');
    assert.equal(component.ready, false); assert.equal(component.required, false);
    assert.equal(editorCheckPayload(draft(), report, NOW).title, draft().snapshot.title);
  }
});

test('blocked environments explain the failing condition without requiring an unrelated check page', () => {
  const report = inspectDevice(platform({ getSystemInfoSync: () => ({ platform: 'devtools', version: '9.15', SDKVersion: '3.133.1' }) }));
  assert.throws(() => editorCheckPayload(draft(), report, NOW), /真机环境.*手机.*电脑模拟器/);
  const old = inspectDevice(platform({ getSystemInfoSync: () => ({ platform: 'ios', version: '8.52', SDKVersion: '3.104.9' }) }));
  assert.throws(() => editorCheckPayload(draft(), old, NOW), /小红书客户端：8.52.*基础库：3.104.9/);
  assert.equal(JSON.stringify(report).includes(APP), false);
});

test('editor payload requires a live own imported snapshot and public HTTPS media', () => {
  const report = inspectDevice(platform());
  assert.equal(JSON.parse(editorCheckPayload(draft(), report, NOW).mediaInfo).image_resources.length, 2);
  assert.throws(() => editorCheckPayload(createDemoDraft('image', NOW), report, NOW));
  assert.throws(() => editorCheckPayload({ ...draft(), state: 'cancelled' }, report, NOW));
  assert.throws(() => editorCheckPayload(draft(), report, NOW + 3600000));
  assert.throws(() => editorCheckPayload(draft(), { canCheckEditor: false }, NOW));
});


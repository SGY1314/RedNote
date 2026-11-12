const test = require('node:test');
const assert = require('node:assert/strict');
const { createDynamicEditorCheck } = require('../features/publish/editor-check');
const { mediaKey, mediaReady, websitePatch } = require('../features/publish/website-view');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-21T00:00:00Z');
function envelope() {
  const value = createDemoDraft('image', NOW);
  value.state = 'claimed';
  value.snapshot.media.forEach((item, i) => { item.preview_url = `https://cloud.example.com/v1/media/task/image-${i}?key=readonly`; });
  return value;
}
function setup(options = {}) {
  let time = NOW, current = envelope(), shown = structuredClone(current.snapshot), edits, ready = true, state = 'claimed', data = {}, reads = 0, modals = 0;
  const platform = {
    getAccountInfoSync: () => ({ miniProgram: { appId: 'a'.repeat(24), envVersion: 'develop' } }),
    getSystemInfoSync: () => ({ platform: 'ios', version: '9.15.0', SDKVersion: '3.133.1' }),
    canIUse: () => true,
    showModal({ success }) { modals++; success({ confirm: true }); },
    login() { throw new Error('No platform login'); },
    ...options.platform,
  };
  const controller = createDynamicEditorCheck({ enabled: options.enabled !== false, platform, now: () => time,
    readSession: async () => { reads++; return options.readSession ? options.readSession() : { envelope: structuredClone(current) }; },
    view: () => ({ snapshot: shown, status: state, mediaReady: ready, edits }),
    onChange: patch => { data = { ...data, ...patch }; } });
  return { controller, get data() { return data; }, get reads() { return reads; }, get modals() { return modals; },
    setCurrent(value) { current = value; }, setShown(value) { shown = value; }, setReady(value) { ready = value; },
    setEdits(value) { edits = value; },
    setState(value) { state = value; }, setTime(value) { time = value; } };
}

test('authenticated claimed website payload is frozen after an explicit prepare tap without automatically opening an editor', async () => {
  const page = setup();
  assert.equal(page.data.officialAvailable, undefined);
  await page.controller.prepare();
  assert.equal(page.reads, 1); assert.equal(page.modals, 0);
  assert.equal(page.data.officialAvailable, true);
  assert.equal(page.data.officialTitle, envelope().snapshot.title);
  assert.equal(page.data.officialContent, envelope().snapshot.body);
  assert.deepEqual(JSON.parse(page.data.officialMediaInfo).image_resources.map(item => item.url), envelope().snapshot.media.map(item => item.preview_url));
  assert.equal(page.data.published, undefined);
  page.setTime(NOW + 60001); page.controller.tick();
  assert.equal(page.data.officialAvailable, false); assert.equal(page.data.officialMediaInfo, '');
});

test('offline/default mode, unread media, unclaimed/expired/revoked sessions and unsuitable runtime never enable editor', async () => {
  const disabled = setup({ enabled: false }); await disabled.controller.prepare();
  assert.equal(disabled.reads, 0); assert.equal(disabled.data.officialAvailable, false);
  const missingMedia = setup(); missingMedia.setReady(false); await missingMedia.controller.prepare();
  assert.equal(missingMedia.modals, 0); assert.equal(missingMedia.data.officialAvailable, false);
  for (const state of ['scanned', 'cancelled', 'expired']) {
    const page = setup(); const value = envelope(); value.state = state; page.setCurrent(value);
    await page.controller.prepare(); assert.equal(page.data.officialAvailable, false); assert.equal(page.modals, 0);
  }
  for (const change of [value => { value.expires_at = new Date(NOW - 1).toISOString(); }, value => { value.snapshot.media[0].preview_url = 'http://127.0.0.1/image.png'; }]) {
    const page = setup(); const value = envelope(); change(value); page.setCurrent(value); page.setShown(value.snapshot);
    await page.controller.prepare(); assert.equal(page.data.officialAvailable, false);
  }
  const simulator = setup({ platform: { getSystemInfoSync: () => ({ platform: 'devtools', version: '9.15', SDKVersion: '3.133.1' }) } });
  await simulator.controller.prepare(); assert.equal(simulator.data.officialAvailable, false);
  assert.match(simulator.data.editorError, /真机环境.*手机/);
  assert.equal(simulator.data.editorChecks.find(check => check.key === 'device').ready, false);
});

test('a negative component probe still permits an explicit native attempt after authenticated draft and media checks', async () => {
  const page = setup({ platform: { canIUse: () => false } });
  await page.controller.prepare();
  assert.equal(page.data.officialAvailable, true);
  assert.equal(page.data.officialTitle, envelope().snapshot.title);
  assert.equal(page.data.editorChecks.find(check => check.key === 'component').ready, false);
  assert.equal(page.data.editorError, '');
  page.controller.invalidate('组件返回错误');
  assert.equal(page.data.officialAvailable, false); assert.equal(page.data.officialMediaInfo, '');
  assert.equal(page.data.published, undefined);
});

test('a switched task, cancelled request or receiver failure cannot grant the official component', async () => {
  let finish;
  const page = setup({ readSession: () => new Promise(resolve => { finish = resolve; }) });
  const pending = page.controller.prepare();
  const different = envelope(); different.snapshot.title = '另一份网站稿件'; different.snapshot.publication_id = 'another-task';
  finish({ envelope: different }); await pending;
  assert.equal(page.data.officialAvailable, false);
  const revoked = setup({ readSession: async () => { throw new Error('receiver revoked'); } });
  await revoked.controller.prepare(); assert.equal(revoked.data.officialAvailable, false);
});

test('hide, media failure, changed snapshot, expiry and unload remove or suppress the manual grant', async () => {
  for (const action of [page => page.controller.hide(), page => page.controller.invalidate('media failed'), page => { page.setReady(false); page.controller.observe(); }, page => { page.setShown({ ...envelope().snapshot, title: 'changed' }); page.controller.observe(); }, page => { page.setState('cancelled'); page.controller.observe(); }]) {
    const page = setup(); await page.controller.prepare(); action(page); assert.equal(page.data.officialAvailable, false);
  }
  let finish;
  const page = setup({ readSession: () => new Promise(resolve => { finish = resolve; }) });
  const pending = page.controller.prepare();
  page.controller.hide(); finish({ envelope: envelope() }); await pending; assert.equal(page.data.officialAvailable, false);
  const disposed = setup({ readSession: () => new Promise(resolve => { finish = resolve; }) });
  const late = disposed.controller.prepare(); disposed.controller.dispose(); const before = { ...disposed.data };
  finish({ envelope: envelope() }); await late; assert.deepEqual(disposed.data, before);
});

test('media completion belongs to the exact ordered task media, never a placeholder or an older URL', () => {
  const snapshot = envelope().snapshot;
  const media = snapshot.media.map(item => ({ ...item, placeholder: false }));
  const loaded = new Set([mediaKey(media[0])]);
  assert.equal(mediaReady(snapshot, media, loaded), false);
  loaded.add(mediaKey(media[1])); assert.equal(mediaReady(snapshot, media, loaded), true);
  media[1].placeholder = true; assert.equal(mediaReady(snapshot, media, loaded), false);
  media[1].placeholder = false; media[1].preview_url += '-old'; assert.equal(mediaReady(snapshot, media, loaded), false);
  assert.equal(websitePatch({ status: 'claimed' }).statusTitle, '已接收');
});

test('authorized website media can be combined with explicit phone copy edits, without modifying the server snapshot', async () => {
  const page = setup();
  page.setEdits({ title: '手机修改后的标题', body: '我自己修改的正文', topics: ['我的话题'] });
  await page.controller.prepare();
  assert.equal(page.data.officialAvailable, true);
  assert.equal(page.data.officialTitle, '手机修改后的标题');
  assert.equal(page.data.officialContent, '我自己修改的正文');
  assert.equal(page.data.officialTags, '我的话题');
  assert.deepEqual(JSON.parse(page.data.officialMediaInfo).image_resources.map(item => item.url), envelope().snapshot.media.map(item => item.preview_url));
  page.setEdits({ title: '再次修改', body: '另一段正文', topics: [] });
  page.controller.observe();
  assert.equal(page.data.officialAvailable, false);
});

test('edits changed while authorization is in flight require a fresh explicit prepare tap', async () => {
  let finish;
  const page = setup({ readSession: () => new Promise(resolve => { finish = resolve; }) });
  page.setEdits({ title: '第一次编辑', body: '第一次正文', topics: [] });
  const pending = page.controller.prepare();
  page.setEdits({ title: '第二次编辑', body: '第二次正文', topics: [] });
  finish({ envelope: envelope() });
  await pending;
  assert.equal(page.data.officialAvailable, false);
  assert.match(page.data.editorError, /文案已修改/);
});

test('loaded single video grants frozen video_resources, but mixed media and load failures do not', async () => {
 const page=setup();const value=createDemoDraft('video',NOW);value.state='claimed';
 value.snapshot.media[0].preview_url='https://cloud.example.com/v1/media/task/own-video?key=readonly';
 page.setCurrent(value);page.setShown(value.snapshot);page.setReady(false);
 await page.controller.prepare();assert.equal(page.data.officialAvailable,false);
 const media=value.snapshot.media.map(item=>({...item}));const loaded=new Set([mediaKey(media[0])]);
 assert.equal(mediaReady(value.snapshot,media,loaded),true);
 media[0].placeholder=true;assert.equal(mediaReady(value.snapshot,media,loaded),false);
 page.setReady(true);await page.controller.prepare();assert.equal(page.data.officialAvailable,true);
 assert.deepEqual(JSON.parse(page.data.officialMediaInfo),{video_resources:{video_url:value.snapshot.media[0].preview_url}});
 assert.equal(page.data.published,undefined);
});

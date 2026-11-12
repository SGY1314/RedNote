const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublishController } = require('../features/publish/controller');
const { createMockGateway } = require('./fixtures/mock-gateway');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('controller exposes loading, preview, claim, simulated editor and cancellation', async () => {
  let data = {};
  const controller = createPublishController({ gateway: createMockGateway({ now: () => NOW }), now: () => NOW, onChange: patch => { data = { ...data, ...patch }; } });
  const loading = controller.load();
  assert.equal(data.status, 'loading');
  await loading;
  assert.equal(data.status, 'scanned');
  assert.equal(data.mediaCount, 2);
  assert.equal(data.media[0].placeholder, true);
  await controller.act('claim');
  assert.equal(data.status, 'claimed');
  await controller.act('openEditor');
  assert.equal(data.status, 'editor_opened');
  assert.match(data.statusDescription, /不代表.*已发布/);
  await controller.act('cancel');
  assert.equal(data.status, 'cancelled');
});

test('late asynchronous loading after page unload never calls setData', async () => {
  const pending = deferred();
  const changes = [];
  const gateway = { load: () => pending.promise, scan: async () => 'scanned' };
  const controller = createPublishController({ gateway, now: () => NOW, onChange: patch => changes.push(patch) });
  const loading = controller.load();
  controller.dispose();
  const count = changes.length;
  pending.resolve({ envelope: createDemoDraft('image', NOW), status: 'created' });
  await loading;
  assert.equal(changes.length, count);
});

test('a stale request cannot overwrite a later page load', async () => {
  const first = deferred();
  let data = {};
  let count = 0;
  const gateway = { load: () => ++count === 1 ? first.promise : Promise.resolve({ envelope: createDemoDraft('video', NOW), status: 'scanned' }) };
  const controller = createPublishController({ gateway, now: () => NOW, onChange: patch => { data = { ...data, ...patch }; } });
  const pending = controller.load({ scene: 'demo-image' });
  await controller.load({ scene: 'demo-video' });
  first.resolve({ envelope: createDemoDraft('image', NOW), status: 'scanned' });
  await pending;
  assert.equal(data.snapshot.media[0].kind, 'video');
});

test('duplicate clicks, invalid state transitions and expiration do not reach the gateway', async () => {
  const claiming = deferred();
  let calls = 0;
  let now = NOW;
  let data = {};
  const gateway = { load: async () => ({ envelope: createDemoDraft('image', NOW), status: 'scanned' }), claim: () => { calls++; return claiming.promise; } };
  const controller = createPublishController({ gateway, now: () => now, onChange: patch => { data = { ...data, ...patch }; } });
  await controller.act('claim');
  assert.equal(calls, 0);
  await controller.load();
  const pending = controller.act('claim');
  await controller.act('claim');
  assert.equal(calls, 1);
  now += 3600000;
  claiming.resolve('claimed');
  await pending;
  assert.equal(data.status, 'expired');
  await controller.act('claim');
  assert.equal(calls, 1);
});

test('invalid scans and revoked scenes hide content and expose clear failures', async () => {
  let data = {};
  const controller = createPublishController({ gateway: createMockGateway({ now: () => NOW }), now: () => NOW, onChange: patch => { data = { ...data, ...patch }; } });
  await controller.load({ scene: '../bad' });
  assert.equal(data.status, 'invalid');
  assert.equal(data.snapshot, null);
  await controller.load({ scene: 'demo-revoked' });
  assert.equal(data.status, 'revoked');
  assert.equal(data.canClaim, false);
});

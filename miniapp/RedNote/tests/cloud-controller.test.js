const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublishController } = require('../features/publish/controller');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-21T00:00:00Z');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(state = 'scanned') {
  const envelope = createDemoDraft('image', NOW);
  envelope.state = state;
  envelope.snapshot.media.forEach((media, index) => { media.preview_url = `http://127.0.0.1:8083/media/${index}`; });
  return { envelope, status: state };
}
function setup(gateway) {
  let data = {};
  const controller = createPublishController({ gateway, now: () => NOW, onChange: patch => { data = { ...data, ...patch }; } });
  return { controller, get data() { return data; } };
}

test('live refresh renders copied media and removes revoked or expired draft content', async () => {
  let state = 'scanned';
  const gateway = { mediaOrigin: 'http://127.0.0.1:8083', load: async () => fixture(), refresh: async () => fixture(state) };
  const page = setup(gateway); await page.controller.load({ scene: 'ticket' });
  assert.equal(page.data.media[0].placeholder, false);
  state = 'claimed'; await page.controller.refresh(); assert.equal(page.data.status, 'claimed');
  state = 'cancelled'; await page.controller.refresh();
  assert.equal(page.data.snapshot, null);
  assert.equal(page.data.media.length, 0);
  assert.equal(page.data.canClaim, false);
  await page.controller.load({ scene: 'ticket' });
  gateway.refresh = async () => { const result = fixture('expired'); result.envelope.expires_at = new Date(NOW - 1).toISOString(); return result; };
  await page.controller.refresh(); assert.equal(page.data.status, 'expired'); assert.equal(page.data.snapshot, null);
});

test('a stale refresh cannot overwrite a completed claim, and parallel polls are suppressed', async () => {
  const pending = deferred(); let refreshCalls = 0;
  const page = setup({ load: async () => fixture(), refresh: () => { refreshCalls++; return pending.promise; }, claim: async () => 'claimed' });
  await page.controller.load({ scene: 'ticket' });
  const refreshing = page.controller.refresh();
  await page.controller.refresh(); assert.equal(refreshCalls, 1);
  await page.controller.act('claim'); assert.equal(page.data.status, 'claimed');
  pending.resolve(fixture('scanned')); await refreshing;
  assert.equal(page.data.status, 'claimed');
});

test('hiding and disposal ignore late refreshes and stop subsequent calls', async () => {
  const pending = deferred(); let calls = 0, disposed = 0;
  const page = setup({ load: async () => fixture(), refresh: () => { calls++; return pending.promise; }, dispose: () => { disposed++; } });
  await page.controller.load({ scene: 'ticket' });
  const refreshing = page.controller.refresh(); page.controller.pause();
  pending.resolve(fixture('cancelled')); await refreshing;
  assert.equal(page.data.status, 'scanned');
  await page.controller.refresh(); assert.equal(calls, 1);
  page.controller.resume(); page.controller.dispose();
  await page.controller.refresh(); assert.equal(calls, 1); assert.equal(disposed, 1);
});

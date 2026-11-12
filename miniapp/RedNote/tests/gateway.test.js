const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const { createMockGateway } = require('./fixtures/mock-gateway');
const { buildOfficialMediaInfo } = require('../services/official-gateway');
const NOW = Date.parse('2026-10-20T00:00:00Z');

test('offline progression stops at simulated editor_opened and never logs in or requests a server', async () => {
  const gateway = createMockGateway({ now: () => NOW });
  assert.equal((await gateway.load('')).status, 'created');
  assert.equal(await gateway.scan(), 'scanned');
  assert.equal(await gateway.claim(), 'claimed');
  assert.equal(await gateway.openEditor(), 'editor_opened');
  assert.equal(await gateway.cancel(), 'cancelled');
  assert.equal(typeof gateway.publish, 'undefined');
  await assert.rejects(gateway.claim(), error => error.code === 'cancelled');
});

test('mock rejects unknown, expired, revoked and service error scenes', async () => {
  for (const [ticket, code] of [['real-ticket', 'invalid'], ['demo-expired', 'expired'], ['demo-revoked', 'revoked'], ['demo-error', 'error']]) {
    await assert.rejects(createMockGateway({ now: () => NOW }).load(ticket), error => error.code === code);
  }
});

test('import preserves cancellation and expiry, and does not mutate the exported snapshot', async () => {
  for (const state of ['created', 'scanned', 'claimed', 'editor_opened', 'cancelled']) {
    const importedDraft = { ...createDemoDraft('image', NOW), state };
    const before = JSON.stringify(importedDraft);
    const gateway = createMockGateway({ importedDraft, now: () => NOW });
    assert.equal((await gateway.load('existing-ticket', 'import')).status, state);
    assert.equal(JSON.stringify(importedDraft), before);
    if (state === 'cancelled') await assert.rejects(gateway.openEditor(), error => error.code === 'cancelled');
  }
  const importedDraft = { ...createDemoDraft('image', NOW), state: 'expired' };
  await assert.rejects(createMockGateway({ importedDraft, now: () => NOW }).load('', 'import'), error => error.code === 'expired');
});

test('expiry is enforced again between preview, claim and opening editor', async () => {
  let now = NOW;
  const gateway = createMockGateway({ now: () => now });
  await gateway.load('demo-image');
  await gateway.scan();
  now += 3600000;
  await assert.rejects(gateway.claim(), error => error.code === 'expired');
});

test('official payload matches documented image/video fields, rejecting demo placeholder URLs', () => {
  for (const kind of ['image', 'video']) {
    const snapshot = createDemoDraft(kind, NOW).snapshot;
    assert.throws(() => buildOfficialMediaInfo(snapshot), /HTTPS/);
    snapshot.media.forEach((item, index) => { item.preview_url = `https://cdn.example.com/${kind}-${index}`; });
    const payload = JSON.parse(buildOfficialMediaInfo(snapshot));
    if (kind === 'image') assert.equal(payload.image_resources.length, 2);
    else assert.deepEqual(payload.video_resources, { video_url: 'https://cdn.example.com/video-0' });
  }
});

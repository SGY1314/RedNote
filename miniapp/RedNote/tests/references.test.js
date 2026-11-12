const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getReference, referenceCards } = require('../features/references/catalog');
const { referenceSource } = require('../features/references/source');
const { createReferenceGateway } = require('../services/reference-gateway');
const { snapshotView } = require('../features/publish/presentation');
const { buildOfficialMediaInfo } = require('../services/official-gateway');
const manifest = require('../assets/reference/manifest.json');
const NOW = Date.parse('2026-10-23T00:00:00Z');

test('every built-in card has complete copy and an owned packaged JPEG matching its public material fingerprint', async () => {
  assert.equal(referenceCards().length, 3);
  for (const card of referenceCards()) {
    const reference = getReference(card.id);
    const data = fs.readFileSync(path.join(__dirname, '../assets/reference', reference.file));
    assert.equal(data[0], 0xff); assert.equal(data[1], 0xd8);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), manifest[reference.file].sha256);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../../../web/public/reference-notes', reference.file))).digest('hex'), manifest[reference.file].sha256);
    const gateway = createReferenceGateway({ reference, apiBaseUrl: 'https://notes.example.com', platform: {}, now: () => NOW });
    const { envelope } = await gateway.load();
    const view = snapshotView(envelope, gateway.mediaOrigin, gateway.localMedia);
    assert.equal(view.media[0].placeholder, false);
    assert.equal(view.media[0].display_url, `/assets/reference/${reference.file}`);
    assert.match(JSON.parse(buildOfficialMediaInfo(envelope.snapshot)).image_resources[0].url, /^https:\/\/notes\.example\.com\/reference-notes\//);
    envelope.snapshot.title = '不能更改模板';
    assert.equal((await gateway.refresh()).envelope.snapshot.title, reference.title);
    gateway.dispose();
  }
});

test('unknown reference ids reject, while real or malformed QR parameters always retain the cloud authorization path', () => {
  for (const id of ['../cafe', '__proto__', 'cafe?scene=other', {}, '']) assert.throws(() => referenceSource({ referenceId: id }));
  assert.equal(referenceSource({ referenceId: 'cafe', scene: 'real-qr' }), null);
  assert.equal(referenceSource({ referenceId: 'cafe', scene: '../invalid-qr' }), null);
  assert.equal(referenceSource({ referenceId: 'cafe', ticket: 'existing-qr' }), null);
  assert.equal(referenceSource({}), null);
  assert.equal(referenceSource({ referenceId: 'cafe' }).id, 'cafe');
});

test('public examples require a real HTTPS image with inline headers before granting a native publishing payload', async () => {
  let count = 0;
  const gateway = createReferenceGateway({ reference: getReference('cafe'), apiBaseUrl: 'https://notes.example.com', now: () => NOW,
    platform: { request(options) {
      count++;
      assert.equal(options.method, 'HEAD');
      assert.equal(options.header, undefined);
      assert.equal(options.data, undefined);
      options.success({ statusCode: 200, header: { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' } });
      return { abort() {} };
    } },
  });
  await gateway.load();
  assert.equal(count, 0);
  await gateway.verifyEditorMedia(); await gateway.verifyEditorMedia();
  assert.equal(count, 1);
  await assert.rejects(gateway.load('private-ticket'), /不接收扫码凭证/);
  gateway.dispose();
});

test('offline examples still preview and copy locally, but HTML placeholders or missing image headers cannot be published', async () => {
  const offline = createReferenceGateway({ reference: getReference('cafe'), apiBaseUrl: '', platform: {}, now: () => NOW });
  const { envelope } = await offline.load();
  assert.equal(snapshotView(envelope, offline.mediaOrigin, offline.localMedia).media[0].placeholder, false);
  assert.equal(offline.canPublish, false);
  await assert.rejects(offline.verifyEditorMedia());
  for (const response of [{ statusCode: 404, header: {} }, { statusCode: 200, header: { 'Content-Type': 'text/html', 'Content-Disposition': 'inline' } },
    { statusCode: 200, header: { 'Content-Type': 'image/jpeg' } }]) {
    const gateway = createReferenceGateway({ reference: getReference('cafe'), apiBaseUrl: 'https://notes.example.com', now: () => NOW,
      platform: { request(options) { options.success(response); return { abort() {} }; } } });
    await assert.rejects(gateway.verifyEditorMedia(), /示例图片/);
    gateway.dispose();
  }
  offline.dispose();
});

test('closing a reference page aborts an in-flight media check and prevents later requests', async () => {
  let aborted = false, request;
  const gateway = createReferenceGateway({ reference: getReference('cafe'), apiBaseUrl: 'https://notes.example.com', now: () => NOW,
    platform: { request(options) { request = options; return { abort() { aborted = true; } }; } } });
  const checking = gateway.verifyEditorMedia();
  gateway.dispose();
  await assert.rejects(checking, /已关闭/);
  request.success({ statusCode: 200, header: { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' } });
  assert.equal(aborted, true);
  await assert.rejects(gateway.verifyEditorMedia(), /已关闭/);
});

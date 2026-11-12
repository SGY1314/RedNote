const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const { validateEnvelope, validateSnapshot, parseDevelopmentDraft, parseScene, isHttpsUrl } = require('../utils/contract');
const NOW = Date.parse('2026-10-20T00:00:00Z');
function draft() { return createDemoDraft('image', NOW); }

test('development images/video and exported schema roundtrip without mutation', () => {
  for (const kind of ['image', 'video']) {
    const source = createDemoDraft(kind, NOW);
    const parsed = parseDevelopmentDraft(JSON.stringify(source), { now: NOW });
    assert.deepEqual(parsed, source);
    assert.notEqual(parsed, source);
  }
});

test('Unicode title limit counts code points; body length is enforced', () => {
  const value = draft();
  value.snapshot.title = '光'.repeat(20);
  value.snapshot.body = '🙂'.repeat(1000);
  assert.doesNotThrow(() => validateEnvelope(value, { now: NOW }));
  value.snapshot.title += '光';
  assert.throws(() => validateEnvelope(value, { now: NOW }), /标题/);
  value.snapshot.title = '标题';
  value.snapshot.body += 'a';
  assert.throws(() => validateEnvelope(value, { now: NOW }), /正文/);
});

test('one to eighteen images, exactly one video, no mixed media', () => {
  const snapshot = draft().snapshot;
  const image = snapshot.media[0];
  for (const count of [0, 19]) {
    snapshot.media = Array(count).fill(image);
    assert.throws(() => validateSnapshot(snapshot), /1–18/);
  }
  snapshot.media = Array(18).fill(image);
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  const video = createDemoDraft('video', NOW).snapshot.media[0];
  snapshot.media = [image, video];
  assert.throws(() => validateSnapshot(snapshot), /不可混用/);
  snapshot.media = [video, video];
  assert.throws(() => validateSnapshot(snapshot), /视频只能/);
});

test('development localhost addresses are placeholders and cannot pass official validation', () => {
  const snapshot = draft().snapshot;
  snapshot.media[0].preview_url = 'http://127.0.0.1:8080/api/v1/assets/1';
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.throws(() => validateSnapshot(snapshot, { official: true }), /HTTPS/);
  snapshot.media[0].preview_url = 'https://cdn.example.com/image.jpg';
  snapshot.media[1].preview_url = 'https://cdn.example.com/image2.jpg';
  assert.doesNotThrow(() => validateSnapshot(snapshot, { official: true }));
});

test('HTTPS URL validation rejects credential, script, local and malformed origins', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@cdn.example.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://a..com/a', 'https://cdn.example.com\\@evil/a', 'https://cdn.example.com:99999/a', 'http://cdn.example.com/a']) assert.equal(isHttpsUrl(url), false, url);
  assert.equal(isHttpsUrl('https://cdn.example.com/a.jpg?signature=abc'), true);
});

test('expiry, wrong schema, corrupt JSON and oversized UTF-8 imports fail clearly', () => {
  const value = draft();
  assert.throws(() => validateEnvelope(value, { now: NOW + 3600000 }), error => error.code === 'expired');
  assert.doesNotThrow(() => validateEnvelope(value, { now: NOW + 3600000, allowExpired: true }));
  assert.throws(() => parseDevelopmentDraft('{invalid'), /JSON/);
  assert.throws(() => parseDevelopmentDraft('光'.repeat(100000)), /256 KB/);
  value.schema_version = 2;
  assert.throws(() => validateEnvelope(value, { now: NOW }), /版本 1/);
});

test('metadata/hash/type/URL/session contract is checked before preview', () => {
  const mutations = [
    value => { value.snapshot.media[0].sha256 = 'bad'; },
    value => { value.snapshot.media[0].mime = 'video/mp4'; },
    value => { value.snapshot.media[0].width = -1; },
    value => { value.snapshot.media[0].preview_url = '/api/v1/assets/1'; },
    value => { value.session = { state: 'verified_published' }; },
    value => { value.snapshot.topics = ['has,comma']; },
  ];
  mutations.forEach(mutate => { const value = draft(); mutate(value); assert.throws(() => validateEnvelope(value, { now: NOW })); });
});

test('scene parsing accepts no scene, decodes once and rejects path/query injection', () => {
  assert.equal(parseScene(), '');
  assert.equal(parseScene({ scene: 'demo%2Dimage' }), 'demo-image');
  assert.equal(parseScene({ ticket: 'ticket_123' }), 'ticket_123');
  for (const scene of ['%', '../other', 'ticket?x=1', 'a'.repeat(129), '%252F']) assert.throws(() => parseScene({ scene }));
});

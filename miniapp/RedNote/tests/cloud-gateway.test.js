const test = require('node:test');
const assert = require('node:assert/strict');
const { createDevelopmentCloudGateway } = require('../services/development-cloud-gateway');
const { cloudOrigin } = require('../services/cloud-policy');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-21T00:00:00Z');
const BASE = 'http://127.0.0.1:8083';
const TOKEN = 'a'.repeat(43);
function draft(state = 'scanned') {
  const value = createDemoDraft('image', NOW);
  value.state = state;
  value.snapshot.media.forEach((media, index) => { media.preview_url = `${BASE}/v1/development/media/${index}?capability=temporary`; });
  return value;
}
function simulator(handler) {
  const calls = [];
  return { calls, getSystemInfoSync: () => ({ platform: 'devtools' }), request(options) { calls.push(options); handler(options, calls.length); return { abort() {} }; } };
}
function gateway(platform, options = {}) { return createDevelopmentCloudGateway({ apiBaseUrl: BASE, platform, now: () => NOW, ...options }); }
function withStorage(api) {
  const values = new Map();
  return Object.assign(api, { values, getStorageSync: key => structuredClone(values.get(key)),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key) });
}

test('network gateway opens once, uses ephemeral Bearer authorization, and resumes with session read', async () => {
  const platform = simulator(options => {
    const path = options.url.replace(`${BASE}/v1/development`, '');
    const state = { '/open': 'scanned', '/session': 'scanned', '/claim': 'claimed', '/editor': 'editor_opened', '/cancel': 'cancelled' }[path];
    options.success({ statusCode: 200, data: { envelope: draft(state), ...(path === '/open' ? { receiver_token: TOKEN } : {}) } });
  });
  const service = gateway(platform);
  const loaded = await service.load('valid-ticket');
  assert.equal(loaded.status, 'scanned');
  assert.deepEqual(platform.calls[0].data, { ticket: 'valid-ticket' });
  assert.equal(platform.calls[0].header.Authorization, undefined);
  assert.equal(await service.claim(), 'claimed');
  assert.equal(await service.openEditor(), 'editor_opened');
  await service.load('valid-ticket');
  assert.equal(platform.calls[3].method, 'GET');
  assert.match(platform.calls[3].url, /\/session$/);
  assert.equal(await service.cancel(), 'cancelled');
  for (const options of platform.calls.slice(1)) {
    assert.equal(options.header.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.header.Cookie, undefined);
    assert.deepEqual(options.data, options.method === 'POST' ? {} : undefined);
  }
  assert.equal(JSON.stringify(loaded).includes(TOKEN), false);
  service.dispose();
  await assert.rejects(service.refresh(), /先扫描/);
});

test('unsafe origins, physical-device HTTP and unknown runtime fail before any network activity', async () => {
  for (const value of ['http://192.168.1.3:8083', 'http://127.0.0.1:0', 'http://localhost:99999', 'https://example.com/path', 'https://example.com@evil.com', 'https://example.com?x=1']) assert.throws(() => cloudOrigin(value));
  assert.equal(cloudOrigin('https://cloud.example.com/'), 'https://cloud.example.com');
  for (const runtime of ['ios', 'android', 'unknown']) {
    let calls = 0;
    const platform = { getSystemInfoSync: () => ({ platform: runtime }), request() { calls++; } };
    await assert.rejects(gateway(platform).load('valid-ticket'), /HTTPS/);
    assert.equal(calls, 0);
  }
});

test('cloud responses enforce token shape, exact media origin, snapshot identity and expiry state', async () => {
  for (const invalid of [{ envelope: draft(), receiver_token: 'short' }, { envelope: { ...draft(), mode: 'official' }, receiver_token: TOKEN }]) {
    const service = gateway(simulator(options => options.success({ statusCode: 200, data: invalid })));
    await assert.rejects(service.load('valid-ticket'), { code: 'invalid' });
  }
  const foreign = draft(); foreign.snapshot.media[0].preview_url = 'https://unrelated.example.com/media.jpg';
  await assert.rejects(gateway(simulator(options => options.success({ statusCode: 200, data: { envelope: foreign, receiver_token: TOKEN } }))).load('valid-ticket'), /不匹配/);
  const platform = simulator((options, count) => {
    const envelope = draft(count > 1 ? 'expired' : 'scanned');
    if (count > 1) envelope.expires_at = new Date(NOW - 1).toISOString();
    options.success({ statusCode: 200, data: { envelope, receiver_token: TOKEN } });
  });
  const service = gateway(platform); await service.load('valid-ticket');
  assert.equal((await service.refresh()).status, 'expired');
});

test('revocation, oversized multibyte responses, timeout and disposal do not leak credentials', async () => {
  const revoked = gateway(simulator(options => options.success({ statusCode: 410, data: { error: { code: 'revoked', message: '已撤销' } } })));
  await assert.rejects(revoked.load('valid-ticket'), { code: 'revoked' });
  const huge = gateway(simulator(options => options.success({ statusCode: 200, data: { envelope: draft(), receiver_token: TOKEN, extra: '中'.repeat(100000) } })));
  await assert.rejects(huge.load('valid-ticket'), /过大/);
  const silent = gateway(simulator(() => {}), { timeoutMs: 5 });
  await assert.rejects(silent.load('valid-ticket'), /超时/);
  let aborted = 0;
  const pending = gateway({ getSystemInfoSync: () => ({ platform: 'devtools' }), request() { return { abort() { aborted++; } }; } });
  const loading = pending.load('valid-ticket');
  pending.dispose();
  await assert.rejects(loading, { code: 'cancelled' });
  assert.equal(aborted, 1);
});

test('closing and reopening a page resumes the same receiver using authenticated GET, never redeeming the ticket twice', async () => {
  let opens = 0, state = 'scanned';
  const platform = withStorage(simulator(options => {
    if (options.url.endsWith('/open')) {
      opens++; options.success({ statusCode: 200, data: { envelope: draft(state), receiver_token: TOKEN } });
    } else {
      assert.equal(options.header.Authorization, `Bearer ${TOKEN}`);
      if (options.url.endsWith('/claim')) state = 'claimed';
      if (options.url.endsWith('/cancel')) state = 'cancelled';
      options.success({ statusCode: 200, data: { envelope: draft(state) } });
    }
  }));
  const first = gateway(platform); await first.load('valid-ticket'); await first.claim(); first.dispose();
  const reopened = gateway(platform); const restored = await reopened.load('valid-ticket');
  assert.equal(restored.status, 'claimed'); assert.equal(opens, 1);
  assert.equal(platform.calls.at(-1).method, 'GET'); assert.match(platform.calls.at(-1).url, /\/session$/);
  assert.equal(JSON.stringify(restored).includes(TOKEN), false);
  await reopened.cancel();
  assert.equal([...platform.values.values()][0].sessions.length, 0); reopened.dispose();
});

test('transient network failures retain the receiver, while revoked credentials and changed snapshots remove it', async () => {
  let response = 'ok';
  const platform = withStorage(simulator(options => {
    if (options.url.endsWith('/open')) return options.success({ statusCode: 200, data: { envelope: draft(), receiver_token: TOKEN } });
    if (response === 'network') return options.fail({ errMsg: 'unavailable' });
    if (response === 'unauthorized') return options.success({ statusCode: 401, data: { error: { code: 'unauthorized' } } });
    const envelope = draft(); if (response === 'changed') envelope.snapshot.fingerprint = 'changed';
    options.success({ statusCode: 200, data: { envelope } });
  }));
  const first = gateway(platform); await first.load('valid-ticket'); first.dispose();
  response = 'network'; const interrupted = gateway(platform);
  await assert.rejects(interrupted.load('valid-ticket'), /无法连接/); interrupted.dispose();
  assert.equal(platform.values.size, 1);
  response = 'ok'; const restored = gateway(platform); await restored.load('valid-ticket');
  response = 'changed'; await assert.rejects(restored.refresh(), /发生变化/);
  assert.equal([...platform.values.values()][0].sessions.length, 0); restored.dispose();
  response = 'ok'; const another = gateway(platform); await another.load('another-ticket'); another.dispose();
  response = 'unauthorized'; const invalid = gateway(platform);
  await assert.rejects(invalid.load('another-ticket'), /接收凭证已失效/);
  assert.equal([...platform.values.values()][0].sessions.length, 0); invalid.dispose();
});

test('a different device still cannot reuse a consumed ticket, and receives actionable Chinese guidance', async () => {
  const foreign = gateway(simulator(options => options.success({ statusCode: 409, data: { error: { code: 'invalid', message: 'This ticket was already received' } } })));
  await assert.rejects(foreign.load('valid-ticket'), error => error.code === 'invalid' && /二维码已被使用.*工作台.*重新创建/.test(error.message) && !error.message.includes('This ticket'));
  foreign.dispose();
});

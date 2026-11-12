const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDemoDraft } = require('./fixtures/demo-drafts');

function evaluate(relative, overrides) {
  const filename = path.join(__dirname, '..', relative);
  const sandbox = {
    module: { exports: {} },
    require: value => Object.hasOwn(overrides, value)
      ? overrides[value] : require(path.resolve(path.dirname(filename), value)),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox);
  return sandbox.module.exports;
}

test('runtime permits only configured cloud transport and has no implicit publishing unlock', () => {
  for (const local of [{}, { gateway: 'mock' }, { gateway: 'official', officialPublishEnabled: true },
    { gateway: 'development-cloud', apiBaseUrl: 'https://cloud.example.com', developmentEditorCheck: true, officialPublishEnabled: true }]) {
    const config = evaluate('config/runtime.js', { './runtime.local': local });
    assert.equal(config.gateway, local.gateway === 'development-cloud' ? 'development-cloud' : 'unconfigured');
    assert.equal(config.developmentEditorCheck, local.gateway === 'development-cloud');
    assert.equal(config.officialPublishEnabled, undefined);
    assert.equal(config.productionAppId, undefined);
    assert.equal(config.importStorageKey, undefined);
  }
});

test('unconfigured production gateway rejects offline and imported sources without touching platform APIs', () => {
  const { createGateway } = evaluate('services/gateway.js', { '../config/runtime': { gateway: 'unconfigured' } });
  const calls = [];
  const platform = new Proxy({}, { get: (_, key) => { calls.push(key); throw new Error('No platform activity allowed'); } });
  for (const mode of ['offline', 'import', undefined]) {
    assert.throws(() => createGateway(platform, mode), error => error.code === 'unavailable');
  }
  assert.deepEqual(calls, []);
});

test('offline query parameters cannot replace configured cloud transport with a mock or imported draft', async () => {
  const origin = 'https://cloud.example.com';
  const envelope = createDemoDraft('image');
  envelope.state = 'scanned';
  envelope.snapshot.media.forEach((media, index) => { media.preview_url = `${origin}/v1/media/${index}`; });
  const calls = [];
  const platform = {
    getSystemInfoSync: () => ({ platform: 'ios' }),
    request(options) {
      calls.push(options);
      options.success({ statusCode: 200, data: { envelope, receiver_token: 'a'.repeat(43) } });
      return { abort() {} };
    },
    login() { throw new Error('No login'); },
  };
  const { createGateway } = evaluate('services/gateway.js', { '../config/runtime': { gateway: 'development-cloud', apiBaseUrl: origin } });
  const gateway = createGateway(platform, { mode: 'offline' });
  assert.equal(gateway.kind, 'development-cloud');
  const loaded = await gateway.load('real-ticket', 'offline');
  assert.equal(loaded.status, 'scanned');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/v1/development/open`);
  assert.deepEqual(calls[0].data, { ticket: 'real-ticket' });
  gateway.dispose();
});

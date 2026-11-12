const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiverSessionStore } = require('../services/receiver-session-store');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-21T00:00:00Z');
const ORIGIN = 'https://cloud.example.com';
const TOKEN = 'r'.repeat(32);
function storage() {
  const values = new Map();
  return { values, getStorageSync: key => structuredClone(values.get(key)),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key) };
}
function draft() { return { ...createDemoDraft('image', NOW), state: 'claimed' }; }

test('receiver credentials survive a new store instance, belong to one origin/ticket, and never store note contents', () => {
  const platform = storage();
  createReceiverSessionStore({ platform, origin: ORIGIN, now: () => NOW }).save('ticket-a', TOKEN, draft());
  const reopened = createReceiverSessionStore({ platform, origin: ORIGIN, now: () => NOW });
  assert.deepEqual(reopened.get('ticket-a'), { token: TOKEN, fingerprint: draft().snapshot.fingerprint });
  assert.equal(reopened.get('ticket-b'), null);
  assert.equal(createReceiverSessionStore({ platform, origin: 'https://other.example.com', now: () => NOW }).get('ticket-a'), null);
  const saved = JSON.stringify([...platform.values.values()]);
  assert.equal(saved.includes(draft().snapshot.body), false);
  assert.equal(saved.includes('preview_url'), false);
});

test('credentials expire within ten minutes, cannot extend their lifetime, and are removed for terminal sessions', () => {
  const platform = storage(); let time = NOW;
  const store = createReceiverSessionStore({ platform, origin: ORIGIN, now: () => time });
  store.save('ticket', TOKEN, draft());
  time += 60000; store.save('ticket', TOKEN, draft());
  time = NOW + 10 * 60000; assert.equal(store.get('ticket'), null);
  assert.equal([...platform.values.values()][0].sessions.length, 0);
  time = NOW;
  for (const state of ['expired', 'cancelled']) { store.save('ticket', TOKEN, { ...draft(), state }); assert.equal(store.get('ticket'), null); }
  store.save('ticket', TOKEN, draft());
  store.remove('ticket', 'x'.repeat(32)); assert.ok(store.get('ticket'));
  store.remove('ticket', TOKEN); assert.equal(store.get('ticket'), null);
});

test('the receiver cache is bounded and corrupt records or storage failures cannot restore credentials', () => {
  const platform = storage();
  const store = createReceiverSessionStore({ platform, origin: ORIGIN, now: () => NOW });
  for (let i = 0; i < 5; i++) store.save(`ticket-${i}`, TOKEN, draft());
  assert.equal(store.get('ticket-0'), null); assert.ok(store.get('ticket-4'));
  const key = [...platform.values.keys()][0];
  for (const record of [{ token: 'short' }, { expiresAt: NOW - 1 }, { expiresAt: Infinity }, { fingerprint: '' }]) {
    const valid = platform.values.get(key).sessions.at(-1);
    platform.values.set(key, { version: 1, sessions: [{ ...valid, ...record }] });
    assert.equal(store.get('ticket-4'), null);
    store.save('ticket-4', TOKEN, draft());
  }
  const denied = { getStorageSync() { throw new Error('denied'); }, setStorageSync() { throw new Error('denied'); }, removeStorageSync() { throw new Error('denied'); } };
  assert.equal(createReceiverSessionStore({ platform: denied, origin: ORIGIN, now: () => NOW }).get('ticket'), null);
});

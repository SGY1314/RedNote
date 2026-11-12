const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecentDrafts } = require('../features/publish/recent-drafts');
const { createDemoDraft } = require('./fixtures/demo-drafts');
const NOW = Date.parse('2026-10-23T00:00:00Z');

test('recent cards expose preview data without receiving credentials and resolve only through an in-memory id', () => {
  const store = createRecentDrafts(() => NOW), draft = createDemoDraft('image', NOW);
  store.remember({ ticket: 'private-scene', snapshot: draft.snapshot, expiresAt: draft.expires_at });
  const cards = store.list();
  assert.equal(cards[0].title, draft.snapshot.title);
  assert.equal(JSON.stringify(cards).includes('private-scene'), false);
  assert.equal(store.ticketFor(cards[0].id), 'private-scene');
  cards[0].topics.push('不能修改缓存');
  assert.deepEqual(store.list()[0].topics, draft.snapshot.topics);
  assert.deepEqual(createRecentDrafts(() => NOW).list(), []);
});

test('expired or revoked recent drafts cannot be reopened and new entries are bounded', () => {
  let now = NOW;
  const store = createRecentDrafts(() => now), draft = createDemoDraft('image', NOW);
  for (let i = 0; i < 6; i++) store.remember({ ticket: `ticket-${i}`, snapshot: draft.snapshot, expiresAt: draft.expires_at });
  assert.equal(store.list().length, 4);
  const id = store.list()[0].id;
  store.forget('ticket-5');
  assert.equal(store.ticketFor(id), '');
  now = Date.parse(draft.expires_at);
  assert.deepEqual(store.list(), []);
});

test('refreshing the same receiver updates its card without duplicating it or changing its local identity', () => {
  const store = createRecentDrafts(() => NOW), draft = createDemoDraft('video', NOW);
  const entry = { ticket: 'video-scene', snapshot: draft.snapshot, expiresAt: draft.expires_at };
  store.remember(entry);
  const id = store.list()[0].id;
  draft.snapshot.title = '新的标题';
  store.remember(entry);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].id, id);
  assert.equal(store.list()[0].title, '新的标题');
  assert.equal(store.list()[0].coverUrl, '');
});

test('local edits survive returning home but cannot be applied to a different website snapshot', () => {
  const store = createRecentDrafts(() => NOW), draft = createDemoDraft('image', NOW);
  const entry = { ticket: 'same-receiver', snapshot: draft.snapshot, expiresAt: draft.expires_at };
  const edits = { title: '手机新标题', body: '手机新正文', topics: ['手机话题'] };
  store.remember({ ...entry, edits });
  store.remember(entry);
  assert.deepEqual(store.editsFor(entry.ticket, draft.snapshot), edits);
  assert.equal(store.list()[0].title, edits.title);
  assert.equal(store.editsFor('another-receiver', draft.snapshot), null);
  assert.equal(store.editsFor(entry.ticket, { ...draft.snapshot, title: '网站重新生成的内容' }), null);
});

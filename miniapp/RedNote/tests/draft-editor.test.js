const test = require('node:test');
const assert = require('node:assert/strict');
const { draftFields, changeDraft, editedSnapshot, pageEdits, copyText } = require('../features/publish/draft-editor');
const { createDemoDraft } = require('./fixtures/demo-drafts');

test('phone edits change only copy, preserve ordered authorized media, and leave the website snapshot intact', () => {
  const snapshot = createDemoDraft().snapshot, original = structuredClone(snapshot);
  const data = { ...draftFields(snapshot), ...changeDraft('draftTitle', '我的新标题🌿') };
  Object.assign(data, changeDraft('draftBody', '我修改后的正文\n保留换行'));
  Object.assign(data, changeDraft('draftTopicsText', '#生活 #日常，生活, #灵感'));
  const result = editedSnapshot(snapshot, pageEdits(data));
  assert.equal(result.title, '我的新标题🌿');
  assert.equal(result.body, '我修改后的正文\n保留换行');
  assert.deepEqual(result.topics, ['生活', '日常', '灵感']);
  assert.deepEqual(result.media, original.media);
  assert.equal(result.fingerprint, original.fingerprint);
  assert.deepEqual(snapshot, original);
  assert.equal(data.titleCount, 6);
});

test('invalid or oversized local edits cannot reach the native editor payload', () => {
  const snapshot = createDemoDraft().snapshot;
  for (const patch of [{ title: '' }, { title: '字'.repeat(21) }, { body: '字'.repeat(1001) }]) {
    assert.throws(() => editedSnapshot(snapshot, { title: snapshot.title, body: snapshot.body, topics: snapshot.topics, ...patch }));
  }
  assert.deepEqual(changeDraft('officialTitle', '不能修改授权字段'), {});
});

test('clipboard content is derived from current user text, preserves paragraphs and includes topics', () => {
  const data = draftFields(createDemoDraft().snapshot);
  Object.assign(data, changeDraft('draftBody', '第一段\n\n第二段'));
  assert.equal(copyText(data), `${data.draftTitle}\n\n第一段\n\n第二段\n\n#日常灵感 #慢生活`);
  assert.equal(changeDraft('draftBody', '新文案').copyState, '');
  assert.equal(copyText(draftFields(null)), '');
  assert.equal(copyText(data, 'title'), data.draftTitle);
  assert.equal(copyText(data, 'body'), '第一段\n\n第二段\n\n#日常灵感 #慢生活');
  assert.equal(copyText(data, 'invalid'), '');
});

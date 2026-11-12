const { validateSnapshot } = require('../../utils/contract');

const count = value => Array.from(value || '').length;
function parseTopics(value) {
  return [...new Set(String(value || '').split(/[\s,#，]+/).filter(Boolean))];
}

function draftFields(snapshot, edits) {
  const source = snapshot && edits ? { ...snapshot, ...edits } : snapshot;
  return {
    draftTitle: source ? source.title : '',
    draftBody: source ? source.body : '',
    draftTopicsText: source ? source.topics.map(topic => `#${topic}`).join(' ') : '',
    draftTopics: source ? source.topics.slice() : [],
    titleCount: source ? count(source.title) : 0,
    bodyCount: source ? count(source.body) : 0,
    copyState: '', copyError: '',
  };
}

function changeDraft(field, value) {
  if (!['draftTitle', 'draftBody', 'draftTopicsText'].includes(field)) return {};
  const text = typeof value === 'string' ? value : '';
  return {
    [field]: text, copyState: '', copyError: '',
    ...(field === 'draftTitle' ? { titleCount: count(text) } : {}),
    ...(field === 'draftBody' ? { bodyCount: count(text) } : {}),
    ...(field === 'draftTopicsText' ? { draftTopics: parseTopics(text) } : {}),
  };
}

function editedSnapshot(snapshot, edits) {
  if (!edits) return snapshot;
  return validateSnapshot({ ...snapshot, title: edits.title, body: edits.body, topics: edits.topics.slice() });
}

function pageEdits(data) {
  return { title: data.draftTitle, body: data.draftBody, topics: data.draftTopics.slice() };
}

function copyText(data, part = 'all') {
  if (!['all', 'title', 'body'].includes(part)) return '';
  if (part === 'title') return data.draftTitle.trim();
  return [part === 'all' ? data.draftTitle.trim() : '', data.draftBody.trim(), data.draftTopics.map(topic => `#${topic}`).join(' ')]
    .filter(Boolean).join('\n\n');
}

module.exports = { draftFields, changeDraft, editedSnapshot, pageEdits, copyText };

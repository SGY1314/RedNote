const { publishableMedia } = require('./website-view');
const { validateEnvelope } = require('../../utils/contract');
const { inspectDevice, editorCheckPayload } = require('../device-check/policy');
const { editedSnapshot } = require('./draft-editor');

const cleared = () => ({
  officialAvailable: false, officialTitle: '', officialContent: '', officialTags: '',
  officialMediaInfo: '', editorBusy: false,
});
const stamp = snapshot => JSON.stringify(snapshot || null);

// Validate the receiver and freeze complete parameters before mounting the native button.
function createDynamicEditorCheck({ enabled, platform, readSession, view, onChange, now = Date.now }) {
  let generation = 0, disposed = false, pending = false, grantedUntil = 0, grantedSnapshot = '', grantedDraft = '';
  const emit = patch => { if (!disposed) onChange(patch); };
  function reset(message = '') {
    generation++; pending = false; grantedUntil = 0; grantedSnapshot = ''; grantedDraft = '';
    emit({ ...cleared(), editorError: message });
  }
  function check(envelope, expected, expectedDraft) {
    validateEnvelope(envelope, { now: now() });
    if (envelope.state !== 'claimed') throw new Error('请先接收稿件；已结束的传送不能打开编辑器。');
    const current = view();
    if (current.status !== 'claimed' || !current.mediaReady || stamp(current.snapshot) !== expected || stamp(envelope.snapshot) !== expected) {
      throw new Error('稿件或素材状态已变化，请重新载入并核对全部素材。');
    }
    if (!publishableMedia(envelope.snapshot.media)) throw new Error('请选择图片或单个视频，不能混用。');
    const draft = editedSnapshot(envelope.snapshot, current.edits);
    if (stamp(draft) !== expectedDraft) throw new Error('文案已修改，请重新确认后继续。');
    const report = inspectDevice(platform);
    emit({ editorChecks: report.checks });
    return editorCheckPayload({ ...envelope, snapshot: draft }, report, now());
  }
  return {
    async prepare() {
      if (disposed || pending) return;
      reset();
      if (!enabled) { emit({ editorError: '编辑器入口暂未开启。' }); return; }
      pending = true;
      const request = generation, current = view(), expected = stamp(current.snapshot);
      emit({ editorBusy: true });
      try {
        const expectedDraft = stamp(editedSnapshot(current.snapshot, current.edits));
        const latest = (await readSession()).envelope;
        if (disposed || request !== generation) return;
        // Preparing parameters does not open the editor; the user must tap the native component.
        const payload = check(latest, expected, expectedDraft);
        grantedSnapshot = expected;
        grantedDraft = expectedDraft;
        grantedUntil = Math.min(now() + 60000, Date.parse(latest.expires_at));
        emit({ officialAvailable: true, officialTitle: payload.title, officialContent: payload.content,
          officialTags: payload.tags, officialMediaInfo: payload.mediaInfo, editorError: '' });
      } catch (error) {
        if (!disposed && request === generation) reset(error && error.message || '暂时无法打开编辑器，请重试。');
      } finally {
        if (!disposed && request === generation) { pending = false; emit({ editorBusy: false }); }
      }
    },
    observe() {
      if (!pending && !grantedUntil) return;
      const current = view();
      try {
        if (current.status !== 'claimed' || !current.mediaReady || grantedUntil &&
          (stamp(current.snapshot) !== grantedSnapshot || stamp(editedSnapshot(current.snapshot, current.edits)) !== grantedDraft)) reset();
      } catch (_) { reset(); }
    },
    tick() { if (grantedUntil && now() >= grantedUntil) reset(); },
    invalidate(message) { reset(message); },
    hide() { reset(); },
    dispose() { disposed = true; generation++; pending = false; grantedUntil = 0; grantedSnapshot = ''; },
  };
}

module.exports = { createDynamicEditorCheck };

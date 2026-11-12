const { parseScene } = require('../../utils/contract');
const { statusView, snapshotView } = require('./presentation');

function createPublishController({ gateway, onChange, now = Date.now }) {
  let disposed = false;
  let generation = 0;
  let envelope;
  let options = {};
  let busy = false;
  let status = 'loading';
  let pollRevision = 0, refreshing = false, paused = false;
  function emit(patch) { if (!disposed) onChange(patch); }
  function setStatus(next, message) {
    status = next;
    const terminal = ['expired', 'revoked', 'cancelled'].includes(next);
    emit({ ...statusView(next, message), busy: false, ...(terminal ? { snapshot: null, media: [], mediaCount: 0 } : {}) });
  }
  function showError(error) {
    const known = ['expired', 'revoked', 'invalid', 'cancelled', 'unavailable'];
    setStatus(known.includes(error && error.code) ? error.code : 'error', error && error.message);
  }
  function expired() {
    if (envelope && Date.parse(envelope.expires_at) <= now()) {
      setStatus('expired');
      return true;
    }
    return false;
  }
  return {
    async load(nextOptions = options) {
      options = nextOptions;
      const request = ++generation;
      pollRevision++;
      envelope = null;
      busy = true;
      status = 'loading';
      emit({ ...statusView('loading'), busy: true, snapshot: null, media: [], mediaCount: 0, currentMedia: 1 });
      try {
        const ticket = parseScene(options);
        const result = await gateway.load(ticket, options.source);
        if (disposed || request !== generation) return;
        envelope = result.envelope;
        emit(snapshotView(envelope, gateway.mediaOrigin, gateway.localMedia));
        if (expired()) return;
        const next = result.status === 'created' ? await gateway.scan() : result.status;
        if (!disposed && request === generation && !expired()) setStatus(next);
      } catch (error) {
        if (!disposed && request === generation) showError(error);
      } finally {
        if (request === generation) busy = false;
      }
    },
    async act(action) {
      const allowed = action === 'claim' && status === 'scanned' || action === 'openEditor' && status === 'claimed' || action === 'cancel' && ['created', 'scanned', 'claimed', 'editor_opened'].includes(status);
      if (disposed || busy || !allowed || expired()) return;
      busy = true;
      pollRevision++;
      const request = generation;
      emit({ busy: true });
      try {
        const result = await gateway[action]();
        if (!disposed && request === generation && !expired()) setStatus(result);
      } catch (error) {
        if (!disposed && request === generation) showError(error);
      } finally {
        if (request === generation) busy = false;
      }
    },
    async refresh() {
      if (disposed || paused || busy || refreshing || !gateway.refresh || !['scanned', 'claimed', 'editor_opened'].includes(status) || expired()) return;
      refreshing = true;
      const request = generation, revision = pollRevision;
      try {
        const result = await gateway.refresh();
        if (disposed || paused || request !== generation || revision !== pollRevision) return;
        envelope = result.envelope;
        if (!expired()) { emit(snapshotView(envelope, gateway.mediaOrigin, gateway.localMedia)); setStatus(result.status); }
      } catch (error) {
        if (!disposed && !paused && request === generation && revision === pollRevision) showError(error);
      } finally { refreshing = false; }
    },
    checkExpiry() { if (!disposed && !['cancelled', 'revoked'].includes(status)) expired(); },
    pause() { paused = true; pollRevision++; },
    resume() { paused = false; },
    dispose() { disposed = true; generation++; if (gateway.dispose) gateway.dispose(); },
  };
}

module.exports = { createPublishController };

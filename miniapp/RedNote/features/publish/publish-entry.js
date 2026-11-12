const { publishableMedia } = require('./website-view');
function createPublishEntry({ view, claim, prepare, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null, scheduledKey = '', visible = true, disposed = false, running = false;
  function clear() {
    if (timer !== null) cancel(timer);
    timer = null; scheduledKey = '';
  }
  function nextAction() {
    const state = view();
    if (disposed || !visible || !state.enabled || !state.snapshot || state.isError ||
      state.busy || state.editorBusy || state.editorError || state.officialAvailable || state.officialTitle ||
      !publishableMedia(state.snapshot.media)) return null;
    const action = state.status === 'scanned' ? 'claim' : state.status === 'claimed' && state.mediaReady ? 'prepare' : '';
    return action ? { action, key: JSON.stringify([action, state.snapshot.fingerprint, state.edits]) } : null;
  }
  function observe() {
    if (running) return;
    const next = nextAction();
    if (!next) { clear(); return; }
    if (timer !== null && scheduledKey === next.key) return;
    clear(); scheduledKey = next.key;
    timer = schedule(async () => {
      timer = null; scheduledKey = '';
      const current = nextAction();
      if (!current || current.key !== next.key) { observe(); return; }
      running = true;
      try { await (next.action === 'claim' ? claim() : prepare()); }
      finally { running = false; if (!disposed && visible) observe(); }
    }, next.action === 'claim' ? 0 : 450);
  }
  return {
    observe,
    pause() { visible = false; clear(); },
    resume() { if (!disposed) { visible = true; observe(); } },
    dispose() { disposed = true; clear(); },
  };
}

module.exports = { createPublishEntry };

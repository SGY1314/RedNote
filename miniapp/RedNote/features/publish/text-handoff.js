const { copyText } = require('./draft-editor');

const handoffFields = () => ({ publishCopyBusy: false, copyState: '', copyError: '' });
const stamp = data => JSON.stringify([data.snapshot && data.snapshot.fingerprint, data.snapshot && data.snapshot.publication_id,
  data.draftTitle, data.draftBody, data.draftTopics]);

function createTextHandoff({ platform, view, onChange, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  let generation = 0, disposed = false, visible = true, pending = null, current = stamp(view());
  let automatic = '', copiedOnEntry = false, automaticTimer = null;
  const emit = patch => { if (!disposed) onChange(patch); };
  const usable = data => !!data.snapshot && !data.isError && ['scanned', 'claimed', 'editor_opened'].includes(data.status)
    && (!data.expiresAt || Number.isFinite(Date.parse(data.expiresAt)) && Date.parse(data.expiresAt) > now());
  function clearAutomatic() { if (automaticTimer !== null) cancel(automaticTimer); automaticTimer = null; }
  function interrupt() { generation++; clearAutomatic(); if (pending) { pending(); pending = null; } }
  function synchronize() {
    const data = view(), next = stamp(data);
    if (next !== current || !usable(data)) {
      current = next; interrupt(); emit(handoffFields());
      if (!usable(data)) { automatic = ''; copiedOnEntry = false; }
    }
    return data;
  }
  function observe() {
    if (disposed || !visible) return;
    const data = synchronize();
    if (!usable(data) || data.busy || automatic === current || automaticTimer !== null) return;
    if (!copiedOnEntry) { copiedOnEntry = true; void copy(); return; }
    const expected = current;
    automaticTimer = schedule(() => {
      automaticTimer = null;
      if (!disposed && visible && stamp(view()) === expected && usable(view()) && !view().busy) void copy();
    }, 400);
  }
  function copy() {
    if (disposed || !visible) return Promise.resolve(false);
    const data = synchronize();
    if (!usable(data) || data.busy) return Promise.resolve(false);
    const text = copyText(data);
    if (!text) return Promise.resolve(false);
    interrupt();
    automatic = current;
    const request = generation, expected = stamp(data);
    emit({ publishCopyBusy: true, copyState: '', copyError: '' });
    return new Promise(resolve => {
      let settled = false, timer;
      const abandon = () => { settled = true; cancel(timer); resolve(false); };
      const finish = (success, message = '') => {
        if (settled) return;
        settled = true; cancel(timer);
        if (pending === abandon) pending = null;
        const active = !disposed && visible && request === generation && usable(view()) && stamp(view()) === expected;
        if (active) emit({ publishCopyBusy: false, copyState: success ? 'copied' : '', copyError: message });
        else if (!disposed && visible) observe();
        resolve(active && success);
      };
      pending = abandon;
      timer = schedule(() => finish(false, '复制未完成，请重新点击复制。'), 10000);
      if (typeof platform.setClipboardData !== 'function') { finish(false, '当前环境无法复制，请长按选择页面中的文案。'); return; }
      try { platform.setClipboardData({ data: text, success: () => finish(true),
        fail: () => finish(false, '复制未完成，请点击“一键复制文案”重试。') }); }
      catch (_) { finish(false, '当前环境无法复制，请长按选择页面中的文案。'); }
    });
  }
  return {
    copy, observe,
    hide() { visible = false; interrupt(); },
    show() { if (!disposed && !visible) { visible = true; automatic = ''; copiedOnEntry = false; current = stamp(view()); emit(handoffFields()); observe(); } },
    dispose() { disposed = true; interrupt(); },
  };
}

module.exports = { createTextHandoff, handoffFields };

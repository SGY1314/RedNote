// Short-lived receiver capabilities only. No note contents or account credentials.
const STORAGE_KEY = 'rednote.development.receivers.v1';
const MAX_SESSIONS = 4;
const MAX_AGE = 10 * 60 * 1000;
const safeToken = value => typeof value === 'string' && /^[a-z0-9_-]{32,256}$/i.test(value);
const safeTicket = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const active = state => ['scanned', 'claimed', 'editor_opened'].includes(state);

function createReceiverSessionStore({ platform, origin, now = Date.now }) {
  let memory = [];
  function persist(items) {
    memory = items;
    try {
      // The documented native API provides setStorageSync; an empty bucket
      // clears credentials without relying on an undocumented remove variant.
      platform.setStorageSync(STORAGE_KEY, { version: 1, sessions: items });
    } catch (_) { /* The current page can still use its in-memory capability. */ }
  }
  function records() {
    let value;
    try { value = platform.getStorageSync(STORAGE_KEY); }
    catch (_) { value = { version: 1, sessions: memory }; }
    const shaped = value && value.version === 1 && Array.isArray(value.sessions) && value.sessions.length <= MAX_SESSIONS;
    const entries = shaped ? value.sessions : [];
    const valid = entries.filter(item => item && typeof item.origin === 'string' && item.origin.length <= 512 && safeTicket(item.ticket)
      && safeToken(item.token) && typeof item.fingerprint === 'string' && item.fingerprint.length > 0 && item.fingerprint.length <= 256
      && Number.isFinite(item.expiresAt) && item.expiresAt > now() && item.expiresAt <= now() + MAX_AGE);
    memory = valid;
    if (valid.length !== entries.length || value && !shaped) persist(valid);
    return valid;
  }
  return {
    get(ticket) {
      const item = records().find(entry => entry.origin === origin && entry.ticket === ticket);
      return item ? { token: item.token, fingerprint: item.fingerprint } : null;
    },
    save(ticket, token, envelope) {
      if (!safeTicket(ticket) || !safeToken(token)) return;
      if (!active(envelope.state)) { persist(records().filter(item => item.origin !== origin || item.ticket !== ticket || item.token !== token)); return; }
      const items = records();
      const existing = items.find(item => item.origin === origin && item.ticket === ticket);
      const expiresAt = Math.min(Date.parse(envelope.expires_at), now() + MAX_AGE, existing ? existing.expiresAt : Infinity);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) return;
      const record = { origin, ticket, token, fingerprint: envelope.snapshot.fingerprint, expiresAt };
      persist([...items.filter(item => item.origin !== origin || item.ticket !== ticket), record].slice(-MAX_SESSIONS));
    },
    remove(ticket, token) {
      const items = records();
      persist(items.filter(item => item.origin !== origin || item.ticket !== ticket || token && item.token !== token));
    },
  };
}

module.exports = { createReceiverSessionStore };

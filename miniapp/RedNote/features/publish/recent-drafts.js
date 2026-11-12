function createRecentDrafts(now = Date.now) {
  let sequence = 0;
  const entries = [];
  function prune() {
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index].expiresAt <= now()) entries.splice(index, 1);
    }
  }
  return {
    remember({ ticket, snapshot, expiresAt, edits }) {
      prune();
      const expiry = Date.parse(expiresAt);
      if (!ticket || !snapshot || !Number.isFinite(expiry) || expiry <= now()) return;
      const previous = entries.findIndex(entry => entry.ticket === ticket);
      const source = JSON.stringify(snapshot);
      const previousEdits = previous < 0 || entries[previous].source !== source ? null : entries[previous].edits;
      const localEdits = edits || previousEdits;
      const id = previous < 0 ? `recent-${++sequence}` : entries[previous].card.id;
      if (previous >= 0) entries.splice(previous, 1);
      const media = snapshot.media[0];
      const text = localEdits || snapshot;
      entries.unshift({ ticket, source, edits: localEdits ? { ...localEdits, topics: localEdits.topics.slice() } : null,
        expiresAt: expiry, card: {
        id, title: text.title || snapshot.title, summary: text.body.replace(/\s+/g, ' ').slice(0, 52),
        topics: text.topics.slice(0, 2), coverUrl: media.kind === 'image' ? media.preview_url : '',
        mediaCount: snapshot.media.length, isVideo: media.kind === 'video',
      } });
      entries.splice(4);
    },
    list() { prune(); return entries.map(entry => ({ ...entry.card, topics: entry.card.topics.slice() })); },
    ticketFor(id) { prune(); const entry = entries.find(value => value.card.id === id); return entry ? entry.ticket : ''; },
    editsFor(ticket, snapshot) {
      prune();
      const entry = entries.find(value => value.ticket === ticket && value.source === JSON.stringify(snapshot));
      return entry && entry.edits ? { ...entry.edits, topics: entry.edits.topics.slice() } : null;
    },
    forget(ticket) { const index = entries.findIndex(entry => entry.ticket === ticket); if (index >= 0) entries.splice(index, 1); },
  };
}

// Receiving credentials stay in memory only, for this miniapp session.
const recentDrafts = createRecentDrafts();
module.exports = { createRecentDrafts, recentDrafts };

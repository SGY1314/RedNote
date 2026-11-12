const { validateSnapshot } = require('../utils/contract');

function buildOfficialMediaInfo(snapshot) {
  validateSnapshot(snapshot, { official: true });
  if (snapshot.media[0].kind === 'video') return JSON.stringify({ video_resources: { video_url: snapshot.media[0].preview_url } });
  return JSON.stringify({ image_resources: snapshot.media.map(item => ({ url: item.preview_url })) });
}

module.exports = { buildOfficialMediaInfo };

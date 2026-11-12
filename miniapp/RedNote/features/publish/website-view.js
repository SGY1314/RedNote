const labels = {
  scanned: ['待接收', '核对内容后，接收这份稿件。'],
  claimed: ['已接收', '可以继续打开小红书编辑器。'],
  cancelled: ['传送已取消', '请在工作台重新生成。'],
};
function websitePatch(patch) {
  const text = labels[patch.status];
  return text ? { ...patch, statusTitle: text[0], statusDescription: text[1] } : patch;
}
function mediaKey(item) { return JSON.stringify([item.asset_id, item.sha256, item.preview_url]); }
function publishableMedia(media) {
  return Array.isArray(media) && media.length > 0 &&
    (media.every(item => item.kind === 'image') || media.length === 1 && media[0].kind === 'video');
}
function mediaReady(snapshot, media, loaded) {
  return !!snapshot && publishableMedia(snapshot.media) && snapshot.media.every(item => {
    const current = media.find(value => value.asset_id === item.asset_id);
    return current && mediaKey(current) === mediaKey(item)
      && loaded.has(mediaKey(item)) && !current.placeholder;
  });
}
module.exports = { websitePatch, mediaKey, mediaReady, publishableMedia };

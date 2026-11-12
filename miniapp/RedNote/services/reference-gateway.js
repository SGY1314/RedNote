const { DraftError, validateEnvelope } = require('../utils/contract');
const { cloudOrigin, assertCloudRuntime } = require('./cloud-policy');
const manifest = require('../assets/reference/manifest.json');

function createReferenceGateway({ reference, apiBaseUrl, platform, now = Date.now }) {
  let origin = '';
  try { origin = cloudOrigin(apiBaseUrl); } catch (_) { /* Local previews remain available without a server. */ }
  if (!origin.startsWith('https:')) origin = '';
  const image = Object.prototype.hasOwnProperty.call(manifest, reference.file) ? manifest[reference.file] : null;
  if (!image) throw new DraftError('invalid', '参考素材不存在。');
  const assetId = `reference-${reference.id}-v1`;
  const mediaUrl = `${origin || 'https://reference.invalid'}/reference-notes/${reference.file}`;
  const envelope = {
    schema_version: 1, mode: 'development', state: 'claimed', expires_at: new Date(now() + 60 * 60 * 1000).toISOString(),
    snapshot: {
      publication_id: `reference-${reference.id}`, version_id: 'reference-v1', fingerprint: `public-reference-${reference.id}-v1`,
      title: reference.title, body: reference.body, topics: reference.topics.slice(),
      media: [{ asset_id: assetId, kind: 'image', mime: 'image/jpeg', sha256: image.sha256,
        width: image.width, height: image.height, size: image.size, preview_url: mediaUrl }],
    },
  };
  const pending = new Set();
  let disposed = false, verifiedUntil = 0;
  function read() {
    if (disposed) throw new DraftError('cancelled', '预览已关闭。');
    validateEnvelope(envelope, { now: now() });
    return { envelope: JSON.parse(JSON.stringify(envelope)), status: envelope.state };
  }
  function verifyEditorMedia() {
    if (disposed) return Promise.reject(new DraftError('cancelled', '预览已关闭。'));
    if (verifiedUntil > now()) return Promise.resolve();
    if (!origin) return Promise.reject(new DraftError('unavailable', '示例图片暂时无法用于发布。'));
    try { assertCloudRuntime(origin, platform); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      let task, timer, settled = false;
      function finish(error) {
        if (settled) return;
        settled = true; clearTimeout(timer); pending.delete(abort);
        if (error) reject(error); else { verifiedUntil = now() + 60000; resolve(); }
      }
      const abort = () => { finish(new DraftError('cancelled', '预览已关闭。')); if (task && task.abort) task.abort(); };
      pending.add(abort);
      timer = setTimeout(() => { finish(new DraftError('error', '示例图片连接超时，请重试。')); if (task && task.abort) task.abort(); }, 10000);
      try {
        task = platform.request({ url: mediaUrl, method: 'HEAD', timeout: 10000,
          success(response) {
            const headers = Object.fromEntries(Object.entries(response.header || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
            if (response.statusCode !== 200 || !/^image\/jpeg(?:;|$)/i.test(headers['content-type'] || '') ||
              !/^inline(?:;|$)/i.test(headers['content-disposition'] || '')) {
              finish(new DraftError('unavailable', '示例图片暂时无法用于发布，请稍后重试。'));
            } else finish();
          },
          fail() { finish(new DraftError('error', '示例图片加载失败，请检查网络后重试。')); },
        });
      } catch (_) { finish(new DraftError('unavailable', '当前环境无法检查示例图片。')); }
    });
  }
  return {
    kind: 'reference', canPublish: !!origin, mediaOrigin: origin || undefined,
    localMedia: { [assetId]: `/assets/reference/${reference.file}` },
    async load(ticket) { if (ticket) throw new DraftError('invalid', '参考笔记不接收扫码凭证。'); return read(); },
    async refresh() { return read(); }, verifyEditorMedia,
    dispose() { disposed = true; [...pending].forEach(abort => abort()); },
  };
}

module.exports = { createReferenceGateway };

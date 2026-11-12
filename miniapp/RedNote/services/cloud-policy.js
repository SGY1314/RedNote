const { DraftError, isHttpsUrl, validateEnvelope } = require('../utils/contract');

function cloudOrigin(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\s\\#?@]/.test(value)) throw new DraftError('unavailable', '工作台连接地址无效');
  const origin = value.replace(/\/$/, '');
  const loopback = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?$/i.exec(origin);
  if (loopback && (!loopback[1] || Number(loopback[1]) > 0 && Number(loopback[1]) <= 65535)) return origin;
  if (!/^https:\/\/[^/]+$/i.test(origin) || !isHttpsUrl(origin)) throw new DraftError('unavailable', '手机连接需要 HTTPS 服务地址');
  return origin;
}

function assertCloudRuntime(origin, platform) {
  if (!origin.startsWith('http:')) return;
  let runtime;
  try { runtime = platform.getSystemInfoSync().platform; } catch (_) { /* Unknown runtime fails closed. */ }
  if (!['devtools', 'simulator'].includes(String(runtime).toLowerCase())) throw new DraftError('unavailable', '手机连接需要 HTTPS 服务地址');
}

function cloudMediaUrl(value, origin) {
  return typeof value === 'string' && value.startsWith(`${origin}/`) && !/[\s\\#\u0000-\u001f]/.test(value) && !value.slice(origin.length + 1).startsWith('/');
}

function cloudEnvelope(value, origin, now) {
  validateEnvelope(value, { now, allowExpired: true });
  if (!value.state || !value.snapshot.media.every(item => cloudMediaUrl(item.preview_url, origin))) throw new DraftError('invalid', '素材地址或稿件状态不匹配，请重新获取。');
  return JSON.parse(JSON.stringify(value));
}

module.exports = { cloudOrigin, assertCloudRuntime, cloudMediaUrl, cloudEnvelope };

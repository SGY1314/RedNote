const MAX_JSON_BYTES = 256 * 1024;
const SESSION_STATES = ['created', 'scanned', 'claimed', 'editor_opened', 'cancelled', 'expired'];

class DraftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

function fail(message, code = 'invalid') { throw new DraftError(code, message); }
function length(value) { return Array.from(value).length; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value) { return (typeof value === 'string' && value.length > 0) || Number.isSafeInteger(value) && value > 0; }

// Avoid Node-only URL APIs so these same rules run in the native miniapp.
function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f#]/.test(value)) return false;
  const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?][^\s]*)?$/i.exec(value);
  if (!match) return false;
  const host = match[1].toLowerCase();
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return false;
  if (!host.includes('.') || host.endsWith('.') || host.startsWith('.') || host.includes('..')) return false;
  if (host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(host)) return false;
  return host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part));
}

function isDevelopmentUrl(value) {
  return isHttpsUrl(value) || typeof value === 'string' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?(?:\/[^\s\\]*)?$/i.test(value);
}

function validateSnapshot(snapshot, options = {}) {
  if (!isRecord(snapshot)) fail('缺少笔记快照');
  if (!identifier(snapshot.publication_id) || !identifier(snapshot.version_id)) fail('缺少发布稿或版本标识');
  if (typeof snapshot.title !== 'string' || !snapshot.title.trim() || length(snapshot.title) > 20) fail('标题需为 1–20 个字符');
  if (typeof snapshot.body !== 'string' || length(snapshot.body) > 1000) fail('正文不可超过 1000 个字符');
  if (!Array.isArray(snapshot.topics) || snapshot.topics.some(topic => typeof topic !== 'string' || !topic.trim() || /[,\r\n]/.test(topic))) fail('话题格式无效');
  if (typeof snapshot.fingerprint !== 'string' || !snapshot.fingerprint.trim() || snapshot.fingerprint.length > 256) fail('缺少快照指纹');
  if (!Array.isArray(snapshot.media) || snapshot.media.length < 1 || snapshot.media.length > 18) fail('请选择 1–18 张图片或单个视频');
  const kinds = snapshot.media.map(item => item && item.kind);
  if (kinds.some(kind => kind !== 'image' && kind !== 'video') || new Set(kinds).size !== 1 || kinds[0] === 'video' && kinds.length !== 1) fail('图片与视频不可混用，视频只能有一个');
  snapshot.media.forEach(item => {
    if (!identifier(item.asset_id)) fail('素材标识无效');
    if (typeof item.mime !== 'string' || !item.mime.startsWith(`${item.kind}/`)) fail('素材类型不匹配');
    if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)) fail('素材指纹必须为 SHA-256');
    const validateUrl = options.official ? isHttpsUrl : isDevelopmentUrl;
    if (!validateUrl(item.preview_url) || options.official && /^https:\/\/[^/]*\.(invalid|test|example)(?:[/:]|$)/i.test(item.preview_url)) fail(options.official ? '正式发布素材必须使用公开 HTTPS 地址' : '素材地址需为 HTTPS 或本机开发地址');
    ['width', 'height', 'duration', 'size'].forEach(key => {
      if (item[key] != null && (!Number.isFinite(item[key]) || item[key] < 0)) fail(`素材 ${key} 无效`);
    });
  });
  return snapshot;
}

function validateEnvelope(value, options = {}) {
  if (!isRecord(value) || value.schema_version !== 1 || value.mode !== 'development') fail('仅支持版本 1 的开发草稿 JSON');
  if (typeof value.expires_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.expires_at) || !Number.isFinite(Date.parse(value.expires_at))) fail('到期时间无效');
  if (value.ticket != null && (typeof value.ticket !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(value.ticket))) fail('交接票据无效');
  if (value.state != null && !SESSION_STATES.includes(value.state)) fail('未知交接状态');
  if (value.session != null) {
    if (!isRecord(value.session)) fail('交接状态无效');
    const state = value.session.state || value.session.status;
    if (state != null && !SESSION_STATES.concat('revoked').includes(state)) fail('未知交接状态');
  }
  validateSnapshot(value.snapshot, options);
  const now = options.now === undefined ? Date.now() : options.now;
  if (!options.allowExpired && Date.parse(value.expires_at) <= now) fail('开发草稿已过期，请从工作台重新导出', 'expired');
  return value;
}

function parseDevelopmentDraft(text, options) {
  if (typeof text !== 'string' || text.length > MAX_JSON_BYTES) fail('JSON 内容过大，最多 256 KB');
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > MAX_JSON_BYTES) fail('JSON 内容过大，最多 256 KB');
  }
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { fail('JSON 格式无效，请粘贴完整的导出内容'); }
  validateEnvelope(value, options);
  return JSON.parse(JSON.stringify(value));
}

function parseScene(options = {}) {
  const raw = options.scene || options.ticket || '';
  if (!raw) return '';
  if (typeof raw !== 'string' || raw.length > 384) fail('扫码参数无效');
  let value;
  try { value = decodeURIComponent(raw); } catch (_) { fail('扫码参数编码无效'); }
  if (!/^[a-z0-9_-]{1,128}$/i.test(value)) fail('扫码参数无效');
  return value;
}

module.exports = { DraftError, MAX_JSON_BYTES, SESSION_STATES, isHttpsUrl, validateSnapshot, validateEnvelope, parseDevelopmentDraft, parseScene };

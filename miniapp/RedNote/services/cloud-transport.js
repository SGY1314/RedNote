const { DraftError, MAX_JSON_BYTES } = require('../utils/contract');
const { cloudOrigin, assertCloudRuntime } = require('./cloud-policy');
const PATHS = ['/open', '/session', '/claim', '/editor', '/cancel'];

function cloudError(response, path) {
  const data = response.data || {};
  const detail = data.error && typeof data.error === 'object' ? data.error : data;
  const known = ['invalid', 'expired', 'revoked', 'cancelled', 'unavailable'];
  const code = known.includes(detail.code) ? detail.code : response.statusCode === 410 ? 'expired' : 'error';
  const messages = { invalid: '二维码无效，请在工作台重新生成。', expired: '稿件已过期，请在工作台重新生成二维码。', revoked: '传送已撤销，请在工作台重新生成二维码。', cancelled: '传送已取消，请在工作台重新生成二维码。', unavailable: '传送服务暂不可用，请稍后重试。' };
  let message = messages[code] || '暂时无法读取稿件，请稍后重试。';
  if (response.statusCode === 409 && path === '/open') message = '二维码已被使用，请在原设备继续；若无法恢复，请在工作台重新创建传送。';
  if ([401, 403].includes(response.statusCode)) message = '接收凭证已失效，请在工作台重新生成二维码。';
  const error = new DraftError(code, message);
  error.statusCode = response.statusCode;
  return error;
}

function createCloudTransport({ apiBaseUrl, platform, timeoutMs = 10000 }) {
  const origin = cloudOrigin(apiBaseUrl);
  const pending = new Set();
  let disposed = false;
  function request(path, method, data, token) {
    if (disposed) return Promise.reject(new DraftError('cancelled', '预览已关闭'));
    if (!PATHS.includes(path)) return Promise.reject(new DraftError('invalid', '无法完成此操作'));
    try { assertCloudRuntime(origin, platform); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      let settled = false, task, timer;
      const operation = { cancel() { finish(new DraftError('cancelled', '预览已关闭')); if (task && task.abort) task.abort(); } };
      function finish(error, response) {
        if (settled) return;
        settled = true; clearTimeout(timer); pending.delete(operation);
        if (error) reject(error); else resolve(response);
      }
      pending.add(operation);
      timer = setTimeout(() => { finish(new DraftError('error', '连接超时，请检查网络后重试。')); if (task && task.abort) task.abort(); }, timeoutMs);
      try {
        task = platform.request({
          url: `${origin}/v1/development${path}`, method, data,
          header: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          timeout: timeoutMs,
          success(response) {
            if (!response || response.statusCode < 200 || response.statusCode >= 300) return finish(cloudError(response || {}, path));
            try {
              const serialized = JSON.stringify(response.data);
              if (!serialized || serialized.length > MAX_JSON_BYTES) throw new Error('oversized');
              let bytes = 0;
              for (const character of serialized) {
                const code = character.codePointAt(0);
                bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
                if (bytes > MAX_JSON_BYTES) throw new Error('oversized');
              }
              finish(null, JSON.parse(serialized));
            } catch (_) { finish(new DraftError('invalid', '稿件内容无效或过大，请重新生成。')); }
          },
          fail() { finish(new DraftError('error', '暂时无法连接，请检查网络后重试。')); },
        });
      } catch (_) { finish(new DraftError('error', '当前环境无法连接工作台。')); }
    });
  }
  return { origin, request, dispose() { disposed = true; [...pending].forEach(operation => operation.cancel()); } };
}

module.exports = { createCloudTransport };

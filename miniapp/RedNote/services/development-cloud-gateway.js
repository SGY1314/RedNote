const { DraftError, parseScene } = require('../utils/contract');
const { cloudEnvelope } = require('./cloud-policy');
const { createCloudTransport } = require('./cloud-transport');
const { createReceiverSessionStore } = require('./receiver-session-store');

function createDevelopmentCloudGateway({ apiBaseUrl, platform, now = Date.now, timeoutMs }) {
  const transport = createCloudTransport({ apiBaseUrl, platform, timeoutMs });
  const sessions = createReceiverSessionStore({ platform, origin: transport.origin, now });
  let receiverToken = '', current, ticket = '', generation = 0, fingerprint = '';
  function accept(response) {
    const envelope = cloudEnvelope(response && response.envelope, transport.origin, now());
    if (fingerprint && envelope.snapshot.fingerprint !== fingerprint) throw new DraftError('invalid', '稿件内容发生变化，请在工作台重新生成。');
    fingerprint = envelope.snapshot.fingerprint;
    current = envelope;
    if (['cancelled', 'expired'].includes(envelope.state)) forget();
    return { envelope, status: envelope.state };
  }
  function forget() { sessions.remove(ticket, receiverToken); receiverToken = ''; }
  async function operation(path, method = 'POST') {
    if (!receiverToken) throw new DraftError('invalid', '请先扫描工作台二维码。');
    const request = generation;
    // Explicit JSON survives proxies that forward empty POST bodies as chunked.
    try {
      const response = await transport.request(path, method, method === 'POST' ? {} : undefined, receiverToken);
      if (request !== generation) throw new DraftError('cancelled', '较早的交接已关闭');
      return accept(response);
    } catch (error) {
      if (request === generation && (['expired', 'revoked', 'cancelled', 'invalid', 'unauthorized'].includes(error.code) || [401, 403, 404, 410].includes(error.statusCode))) forget();
      throw error;
    }
  }
  return {
    kind: 'development-cloud', mediaOrigin: transport.origin,
    async load(value, source) {
      const nextTicket = parseScene({ ticket: value });
      if (!nextTicket || source === 'import') throw new DraftError('invalid', '请扫描工作台二维码。');
      if (receiverToken && ticket === nextTicket) return operation('/session', 'GET');
      const request = ++generation;
      receiverToken = ''; current = undefined; fingerprint = ''; ticket = nextTicket;
      const saved = sessions.get(ticket);
      if (saved) { receiverToken = saved.token; fingerprint = saved.fingerprint; return operation('/session', 'GET'); }
      const response = await transport.request('/open', 'POST', { ticket });
      if (request !== generation) throw new DraftError('cancelled', '较早的交接已关闭');
      if (!response || typeof response.receiver_token !== 'string' || !/^[a-z0-9_-]{32,256}$/i.test(response.receiver_token)) throw new DraftError('invalid', '未能接收稿件，请在工作台重新生成二维码。');
      const result = accept(response);
      receiverToken = response.receiver_token;
      sessions.save(ticket, receiverToken, result.envelope);
      return result;
    },
    async scan() { if (!current) throw new DraftError('invalid', '尚未载入交接'); return current.state; },
    async claim() { return (await operation('/claim')).status; },
    async openEditor() { return (await operation('/editor')).status; },
    async cancel() { return (await operation('/cancel')).status; },
    refresh() { return operation('/session', 'GET'); },
    dispose() { generation++; receiverToken = ''; current = undefined; fingerprint = ''; transport.dispose(); },
  };
}

module.exports = { createDevelopmentCloudGateway };

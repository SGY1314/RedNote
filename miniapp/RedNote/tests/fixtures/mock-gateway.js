const { DraftError, validateEnvelope } = require('../../utils/contract');
const { createDemoDraft } = require('./demo-drafts');

function createMockGateway({ importedDraft, now = Date.now } = {}) {
  let current;
  let state = 'created';
  function requireActive() {
    if (!current) throw new DraftError('invalid', '尚未加载开发草稿');
    validateEnvelope(current, { now: now() });
    if (state === 'cancelled') throw new DraftError('cancelled', '本次模拟交接已取消');
  }
  return {
    kind: 'mock',
    async load(ticket, source) {
      if (ticket === 'demo-error') throw new DraftError('error', '演示服务暂时不可用，可返回重新加载');
      if (ticket === 'demo-invalid') throw new DraftError('invalid', '票据无效，请从工作台重新生成');
      if (ticket === 'demo-revoked') throw new DraftError('revoked', '这份交接已由电脑端撤销');
      if (source === 'import') {
        if (!importedDraft) throw new DraftError('invalid', '未找到导入草稿，请返回首页重新导入');
        current = JSON.parse(JSON.stringify(importedDraft));
      } else {
        const supported = ['', 'demo-image', 'demo-video', 'demo-expired', 'demo-cancelled'];
        if (!supported.includes(ticket)) throw new DraftError('invalid', '离线模式无法领取真实扫码票据');
        current = createDemoDraft(ticket === 'demo-video' ? 'video' : 'image', now());
        if (ticket === 'demo-expired') current.expires_at = new Date(now() - 1000).toISOString();
      }
      validateEnvelope(current, { now: now(), allowExpired: true });
      const importedState = current.state || current.session && (current.session.state || current.session.status);
      state = ticket === 'demo-cancelled' ? 'cancelled' : importedState || 'created';
      if (state === 'expired' || Date.parse(current.expires_at) <= now()) throw new DraftError('expired', '开发草稿已过期，请从工作台重新导出');
      if (state === 'revoked') throw new DraftError('revoked', '导出的交接已撤销');
      return { envelope: current, status: state };
    },
    async scan() { requireActive(); if (state === 'created') state = 'scanned'; return state; },
    async claim() { requireActive(); if (state !== 'scanned') throw new DraftError('invalid', '请先加载并查看草稿'); state = 'claimed'; return state; },
    async openEditor() { requireActive(); if (state !== 'claimed') throw new DraftError('invalid', '请先模拟领取草稿'); state = 'editor_opened'; return state; },
    async cancel() { requireActive(); state = 'cancelled'; return state; },
  };
}

module.exports = { createMockGateway };

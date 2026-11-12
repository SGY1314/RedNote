const STATUS = {
  loading: ['正在载入', '正在准备你的笔记'],
  created: ['待查看', '草稿已准备好'],
  scanned: ['待接收', '核对内容后，接收这份稿件。'],
  claimed: ['已接收', '可以继续打开小红书编辑器。'],
  editor_opened: ['已交接', '交接状态不代表笔记已发布。'],
  cancelled: ['传送已取消', '请在工作台重新生成。'],
  expired: ['交接已过期', '请返回工作台重新导出或创建交接'],
  revoked: ['交接已撤销', '这份内容已停止交接'],
  invalid: ['无法读取草稿', '请检查导入内容或扫码参数'],
  unavailable: ['暂未连接工作台', '请稍后再试。'],
  error: ['暂时无法载入', '请稍后重试'],
};

function statusView(status, message) {
  const text = STATUS[status] || STATUS.error;
  return {
    status,
    statusTitle: text[0],
    statusDescription: message || text[1],
    isError: ['expired', 'revoked', 'invalid', 'unavailable', 'error'].includes(status),
    canClaim: status === 'scanned',
    canOpen: status === 'claimed',
    canCancel: ['created', 'scanned', 'claimed', 'editor_opened'].includes(status),
  };
}

function snapshotView(envelope, mediaOrigin, localMedia = {}) {
  const snapshot = envelope.snapshot;
  return {
    snapshot,
    media: snapshot.media.map((item, index) => ({
      ...item,
      index: index + 1,
      display_url: localMedia[item.asset_id] || item.preview_url,
      placeholder: localMedia[item.asset_id] ? false : mediaOrigin ? !item.preview_url.startsWith(`${mediaOrigin}/`) : !/^https:\/\//i.test(item.preview_url) || /^https:\/\/[^/]*\.invalid\//i.test(item.preview_url),
      isVideo: item.kind === 'video',
    })),
    mediaCount: snapshot.media.length,
    expiresAt: envelope.expires_at,
    expiresLabel: [new Date(envelope.expires_at).getHours(), new Date(envelope.expires_at).getMinutes()].map(value => String(value).padStart(2, '0')).join(':'),
  };
}

module.exports = { statusView, snapshotView };

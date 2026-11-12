const STATUS = {
  loading: ['正在加载', '正在准备参考笔记'],
  created: ['参考笔记', '根据自己的探店体验修改内容。'],
  scanned: ['参考笔记', '根据自己的探店体验修改内容。'],
  claimed: ['参考笔记', '确认内容后，可发布到小红书。'],
  editor_opened: ['已打开发布页', '是否发布，由你在小红书中确认。'],
  cancelled: ['已取消', '可重新扫描商家二维码查看参考素材。'],
  expired: ['二维码已过期', '请联系商家更新二维码，再重新扫码。'],
  revoked: ['参考素材已停用', '请联系商家获取可用的二维码。'],
  invalid: ['暂时无法查看', '请重新扫描商家二维码，或联系商家。'],
  unavailable: ['暂时无法加载', '请稍后重试，或联系商家。'],
  error: ['暂时无法加载', '请检查网络后重新加载。'],
};

function customerPatch(patch) {
  const copy = STATUS[patch.status];
  if (!copy) return patch;
  const usedElsewhere = /二维码已被使用|其他设备|原设备/.test(patch.statusDescription || '');
  return { ...patch, statusTitle: copy[0], statusDescription: usedElsewhere
    ? '二维码已在其他设备打开，请在原设备继续，或联系商家更新二维码。' : copy[1] };
}

function editorMessage(message) {
  if (!message) return '';
  if (/标题/.test(message)) return '标题需为 1–20 个字符，请修改后再试。';
  if (/正文/.test(message)) return '正文不能超过 1000 个字符，请修改后再试。';
  if (/视频/.test(message)) return '视频加载或导入失败，请检查素材格式后重试。';
  if (/过期|失效|撤销|取消|已结束/.test(message)) return '本次素材已失效，请重新扫描商家二维码。';
  if (/图片|素材/.test(message)) return '有素材未能加载，请重新加载后再试。';
  if (/文案已修改/.test(message)) return '内容已修改，请稍后重试。';
  if (/真机|客户端|运行版本|开发|AppID|基础库|环境/.test(message)) return '请在手机小红书中打开后再试。';
  return '暂时无法打开小红书发布页，请稍后重试。';
}

module.exports = { customerPatch, editorMessage };

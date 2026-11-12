const { DraftError, validateEnvelope } = require('../../utils/contract');
const { buildOfficialMediaInfo } = require('../../services/official-gateway');

function versionAtLeast(value, minimum) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(value)) return false;
  const current = value.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(current.length, required.length); i++) {
    const difference = (current[i] || 0) - (required[i] || 0);
    if (difference) return difference > 0;
  }
  return true;
}

// Only local runtime APIs are read. No login, profile, storage or network call.
function inspectDevice(platform) {
  let app = {}, system = {}, componentSupported = false;
  try { app = platform.getAccountInfoSync().miniProgram || {}; } catch (_) { /* Unavailable is a failed check. */ }
  try { system = platform.getSystemInfoSync() || {}; } catch (_) { /* Same fail-closed behavior. */ }
  try { componentSupported = platform.canIUse('post-note-button') === true; } catch (_) { /* Diagnostic only; the native component reports errors. */ }
  const configured = typeof app.appId === 'string' && /^[a-z0-9]{24}$/i.test(app.appId);
  const development = ['develop', 'trial'].includes(app.envVersion);
  const physical = ['ios', 'android'].includes(String(system.platform).toLowerCase());
  const checks = [
    { key: 'app', label: 'AppID', ready: configured, detail: configured ? `已识别 · …${app.appId.slice(-4)}` : '尚未识别真实 AppID' },
    { key: 'environment', label: '运行版本', ready: development, detail: development ? '开发版 / 体验版' : `当前为${app.envVersion === 'release' ? '正式版' : '未识别版本'}，请重新扫码打开开发预览` },
    { key: 'device', label: '真机环境', ready: physical, detail: physical ? String(system.platform) : '请在手机小红书中打开开发预览，电脑模拟器无法核对官方编辑器' },
    { key: 'client', label: '小红书客户端', ready: versionAtLeast(system.version, '8.53'), detail: system.version || '无法读取版本' },
    { key: 'library', label: '基础库', ready: versionAtLeast(system.SDKVersion, '3.105.1'), detail: system.SDKVersion || '无法读取版本' },
    { key: 'component', label: '原生组件探测', ready: componentSupported, required: false, detail: componentSupported ? '探测通过，实际支持以官方组件为准' : '探测未确认，仅供参考；以本人点击官方组件的结果为准' },
  ];
  return { checks, canCheckEditor: checks.every(check => check.required === false || check.ready), appIdConfigured: configured };
}

function editorCheckPayload(envelope, report, now = Date.now()) {
  if (!report || !report.canCheckEditor) {
    const blocked = report && Array.isArray(report.checks) ? report.checks.filter(check => check.required !== false && !check.ready) : [];
    const reason = blocked.map(check => `${check.label}：${check.detail}`).join('；');
    throw new DraftError('unavailable', reason || '无法读取运行环境，请重新扫码打开开发预览');
  }
  validateEnvelope(envelope, { now });
  if (['cancelled', 'expired'].includes(envelope.state)) throw new DraftError('invalid', '已结束的交接不可用于编辑器检查');
  const snapshot = envelope.snapshot;
  return {
    title: snapshot.title, content: snapshot.body, tags: snapshot.topics.join(','),
    mediaInfo: buildOfficialMediaInfo(snapshot),
  };
}

module.exports = { versionAtLeast, inspectDevice, editorCheckPayload };

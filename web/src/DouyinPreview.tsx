import { Alert, Button, Input, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';

const HELPER = 'http://127.0.0.1:17843';
const STORAGE = 'workbench.douyinPreview.connection';
export default function DouyinPreview({launchPath, expiresAt}: {launchPath: string; expiresAt: string}) {
  const [connection, setConnection] = useState(() => {try {return sessionStorage.getItem(STORAGE) || '';} catch {return '';}});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const live = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const expiry = Date.parse(expiresAt);
  useEffect(() => {live.current = true; return () => {live.current = false; generation.current++;};}, []);
  useEffect(() => {setImage(''); setError(''); generation.current++;}, [launchPath, expiresAt]);
  const generate = async () => {
    if (running.current) return;
    if (!/^[a-f0-9]{48}$/.test(connection.trim())) {setError('请先打开本机预览助手，复制连接码到这里'); return;}
    if (expiry <= Date.now() + 5000) {setError('任务即将过期，请重新创建'); return;}
    const revision = ++generation.current;
    running.current = true; setBusy(true); setError(''); setImage('');
    try {
      const response = await fetch(HELPER + '/preview', {method: 'POST', credentials: 'omit',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.trim()},
        body: JSON.stringify({launch_path: launchPath, expires_at: expiresAt}), signal: AbortSignal.timeout(190000)});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '本机出码失败');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qr_image || '') || data.qr_image.length > 1500000
        || Date.parse(data.expires_at) !== expiry) throw Error('助手返回的二维码无效');
      if (expiry <= Date.now() + 5000) throw Error('出码期间任务已过期，请重新创建');
      if (live.current && revision === generation.current) {
        setImage(data.qr_image);
        try {sessionStorage.setItem(STORAGE, connection.trim());} catch { /* Optional per-tab connection memory. */ }
      }
    } catch (e) {
      if (live.current && revision === generation.current) setError(e instanceof TypeError
        ? '无法连接本机预览助手。请在这台电脑启动助手，并允许浏览器访问本地网络；也可使用下面的手动启动参数。'
        : (e as Error).message);
    } finally {running.current = false; if (live.current) setBusy(false);}
  };
  useEffect(() => {
    if (/^[a-f0-9]{48}$/.test(connection.trim())) void generate();
  }, [launchPath, expiresAt]);
  return <div className="douyin-preview-helper">
    <Alert type="info" showIcon message="在本机生成官方预览二维码" description="需在这台电脑启动预览助手，并保持抖音开发者工具登录。首次填写连接码，浏览器询问本地网络权限时请选择允许。" />
    {!image && <Space.Compact style={{width:'100%', margin:'12px 0'}}>
      <Input.Password aria-label="本机预览助手连接码" placeholder="粘贴本机连接码" autoComplete="off" value={connection} disabled={busy} onChange={e => setConnection(e.target.value)} />
      <Button loading={busy} onClick={() => void generate()}>生成预览二维码</Button>
    </Space.Compact>}
    {error && <Alert type="warning" showIcon message={error} />}
    {busy && <p role="status">开发者工具正在打包并生成预览码，请稍候…</p>}
    {image && <div className="mobile-publish-qr"><img src={image} width={232} height={232} alt="抖音开发版预览二维码" /><p>用抖音扫一扫。进入后点击「重新领取」，核对视频再发布。</p><Button onClick={() => void generate()} disabled={busy}>刷新预览码</Button></div>}
    <p className="mobile-publish-help">预览码用于开发测试。任务过期、撤销或被领取后，此窗口停止展示二维码；不会自动发布作品。</p>
  </div>;
}

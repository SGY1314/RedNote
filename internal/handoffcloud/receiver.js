/* Development receiver only. No XHS SDK, login or publishing operations. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const storageKey = 'rednote.cloud.receiver.v1';
  const states = {scanned:'资源已送达此设备', claimed:'资源已接收', editor_opened:'已模拟打开编辑器 · 没有发布笔记'};
  let receiver = '', session = null, busy = false, timer = null, expiryTimer = null;
  let generation = 0, readSequence = 0, visible = true;
  const pending = new Set();
  function abortPending() { for (const controller of pending) controller.abort(); pending.clear(); }
  try { receiver = sessionStorage.getItem(storageKey) || ''; } catch (_) { /* Private browser. */ }
  function save(value) { receiver = value; try { value ? sessionStorage.setItem(storageKey, value) : sessionStorage.removeItem(storageKey); } catch (_) {} }
  function buttons() {
    const active = session && Date.parse(session.expires_at) > Date.now();
    $('claim').disabled = busy || !active || session.state !== 'scanned';
    $('editor').disabled = busy || !active || session.state !== 'claimed';
    $('cancel').disabled = busy || !active;
  }
  function clear(message) {
    generation++; readSequence++; abortPending(); busy = false;
    session = null; save(''); $('draft').hidden = true; $('media').replaceChildren();
    for (const id of ['title', 'body', 'topics', 'expiry']) $(id).textContent = '';
    $('notice').textContent = message; clearTimeout(timer); clearTimeout(expiryTimer); buttons();
  }
  async function request(path, payload) {
    const headers = {}; if (receiver) headers.Authorization = 'Bearer ' + receiver;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController(); pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/v1/development/' + path, {method:payload === undefined ? 'GET' : 'POST', headers, cache:'no-store', credentials:'omit', signal:controller.signal, body:payload === undefined ? undefined : JSON.stringify(payload)});
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error && data.error.message || '网络请求失败'); error.status = response.status; throw error; }
      return data;
    } finally { clearTimeout(timeout); pending.delete(controller); }
  }
  function render(envelope) {
    if (!envelope || !states[envelope.state] || Date.parse(envelope.expires_at) <= Date.now()) { clear('此交接已结束，请在电脑端重新创建'); return; }
    const changed = !session || session.id !== envelope.id;
    session = envelope;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => clear('此交接已过期，请在电脑端重新创建'), Math.max(0, Date.parse(session.expires_at) - Date.now()));
    $('notice').textContent = states[session.state]; $('draft').hidden = false;
    $('title').textContent = session.snapshot.title; $('body').textContent = session.snapshot.body;
    $('topics').textContent = session.snapshot.topics.map((topic) => '#' + topic).join('  ');
    $('expiry').textContent = '有效至 ' + new Date(session.expires_at).toLocaleTimeString();
    if (changed) {
      const nodes = session.snapshot.media.map((item) => {
        const url = new URL(item.preview_url);
        if (url.origin !== location.origin || !url.pathname.startsWith('/v1/media/')) throw new Error('素材地址校验失败');
        const node = document.createElement(item.kind === 'video' ? 'video' : 'img');
        node.src = url.href; node.setAttribute('aria-label', item.kind === 'video' ? '视频素材' : '图片素材');
        if (item.kind === 'video') { node.controls = true; node.preload = 'metadata'; } else node.alt = session.snapshot.title;
        return node;
      });
      $('media').replaceChildren(...nodes);
    }
    buttons();
  }
  async function refresh() {
    if (busy || !receiver || !visible) return;
    if (session && Date.parse(session.expires_at) <= Date.now()) { clear('此交接已过期，请在电脑端重新创建'); return; }
    const revision = generation, sequence = ++readSequence;
    const current = () => visible && !busy && revision === generation && sequence === readSequence;
    try { const data = await request('session'); if (!current()) return; render(data.envelope); }
    catch (error) { if (!current()) return; if (error.status === 410 || error.status === 401) { clear(error.message); return; } $('notice').textContent = '连接暂时中断，正在重试'; }
    if (receiver && current()) timer = setTimeout(refresh, 2000);
  }
  async function act(path) {
    if (busy || !session || !visible) return;
    const revision = ++generation; readSequence++; abortPending();
    const current = () => visible && revision === generation;
    busy = true; buttons(); clearTimeout(timer);
    try { const data = await request(path, {}); if (!current()) return; if (path === 'cancel') clear('此交接已撤销'); else render(data.envelope); }
    catch (error) { if (!current()) return; if (error.status === 410 || error.status === 401) clear(error.message); else $('notice').textContent = error.message; }
    finally { if (current()) { busy = false; buttons(); if (receiver) timer = setTimeout(refresh, 2000); } }
  }
  $('claim').addEventListener('click', () => act('claim'));
  $('editor').addEventListener('click', () => act('editor'));
  $('cancel').addEventListener('click', () => act('cancel'));
  addEventListener('pagehide', () => { visible = false; generation++; readSequence++; busy = false; abortPending(); clearTimeout(timer); clearTimeout(expiryTimer); });
  addEventListener('pageshow', (event) => { visible = true; if (event.persisted && receiver) refresh(); });
  (async () => {
    const revision = generation;
    const current = () => visible && revision === generation;
    const ticket = new URLSearchParams(location.search).get('ticket');
    try {
      if (ticket) {
        save(''); const data = await request('open', {ticket}); if (!current()) return; save(data.receiver_token);
        history.replaceState(null, '', '/receive'); render(data.envelope);
      } else if (receiver) { const data = await request('session'); if (!current()) return; render(data.envelope); }
      else { clear('请从工作台打开新的网络联调链接'); return; }
      if (receiver && current()) timer = setTimeout(refresh, 2000);
    } catch (error) { if (current()) clear(error.message); }
  })();
})();

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, browserLaunchOptions } = require('./browser.cjs');
const base = process.env.WORKBENCH_UI_BASE_URL || 'http://127.0.0.1:8080';
const out = path.resolve(__dirname, '../../data/verification/null-note');
const stamp = '2026-11-03T03:00:00Z';
const project = { id: 'null-topics', name: '空标签项目', platform: 'xhs', kind: 'image', sources: [], asset_ids: null, created_at: stamp };
const reference = { title: '', body: '', topics: null, asset_ids: null };
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1157, height: 765 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push({ message: e.message, stack: e.stack }));
  try {
    await page.route(base + '/api/v1/**', async route => {
      const e = new URL(route.request().url()).pathname.slice(7);
      assert.equal(route.request().method(), 'GET', 'Browsing empty modules must not submit changes or model tasks');
      let body = [];
      if (e === '/auth/me') body = { user: { id: 'qa', username: 'qa', display_name: '创作用户', role: 'creator', status: 'active' } };
      else if (e === '/session') body = { csrf_token: 'fixture' };
      else if (e === '/sync') body = { reset: true, more: false, epoch: 'null-note', cursor: 1, changes: [{ entity: 'projects', id: project.id, value: project }] };
      else if (e === '/collections') body = { items: [], total: 0, tags: [] };
      else if (e === '/rewrites') body = [project];
      else if (e === '/rewrites/' + project.id) body = { project, versions: [], reference_assets: [], reference_videos: [] };
      else if (e === '/rewrites/' + project.id + '/workflow') body = { workflow: { id: project.id, account_profile: {}, title: { key: '', text: '' }, copy: { key: '', body: '', topics: null }, drafts: {} }, reference, titles: [], copies: [], angles: [], image_plans: [] };
      else if (e.endsWith('-models') && process.env.NULL_NOTE_PHASE !== 'before') body = null;
      await route.fulfill({ json: body });
    });
    await page.goto(base + '/#rewrites');
    const nav = page.getByRole('navigation', { name: '仿写创作步骤', exact: true });
    await nav.waitFor();
    for (const name of ['标题仿写', '文案仿写', '图片仿写', '视频仿写', '基本信息']) {
      await nav.getByRole('button', { name, exact: true }).click();
      const crashed = page.getByRole('alert').filter({ hasText: '这个页面出现运行错误' });
      await page.waitForFunction(() => document.querySelector('.workflow-panel') || document.querySelector('.workspace-error-details'));
      assert.equal(await crashed.count(), 0, name + ': nullable source topics must not crash the workspace');
    }
    reference.title = '有正文，没有标签';
    reference.body = '原始正文照常显示。';
    await page.reload();
    await nav.waitFor();
    await nav.getByRole('button', { name: '标题仿写', exact: true }).click();
    await page.getByText(reference.body, { exact: true }).waitFor();
    assert.equal(await page.locator('.title-original-topics').count(), 0);
    await page.screenshot({ path: path.join(out, 'fixed-1157.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: actual nullable source format works in all five modules, and untagged body remains visible without submitting tasks.');
  } catch (error) {
    const detail = await page.locator('.workspace-error-details').textContent().catch(() => null);
    if (detail) errors.push({ message: detail });
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(out, process.env.NULL_NOTE_PHASE === 'before' ? 'before-errors.json' : 'after-errors.json'), JSON.stringify(errors, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

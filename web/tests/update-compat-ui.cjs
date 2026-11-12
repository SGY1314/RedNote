const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, browserLaunchOptions } = require('./browser.cjs');
const base = process.env.WORKBENCH_UI_BASE_URL || 'http://127.0.0.1:8080';
const out = path.resolve(__dirname, '../../data/verification/update-compat');
const project = { id: 'p1', name: '城市漫游', platform: 'xhs', kind: 'image', asset_ids: [], sources: [], created_at: '2026-11-03T01:00:00Z' };
async function fixtures(page) {
  await page.route(base + '/api/v1/**', async route => {
    const e = new URL(route.request().url()).pathname.slice(7);
    let body = [];
    if (e === '/auth/me') body = { user: { id: 'qa', username: 'qa', display_name: '创作用户', role: 'creator', status: 'active' } };
    else if (e === '/session') body = { csrf_token: 'fixture' };
    else if (e === '/sync') body = { reset: true, more: false, epoch: 'update-compat', cursor: 1, changes: [{ entity: 'projects', id: 'p1', value: project }] };
    else if (e === '/collections') body = { items: [], total: 0, tags: [] };
    else if (e === '/rewrites') body = [project];
    else if (e === '/rewrites/p1') body = { project, versions: [], reference_assets: [], reference_videos: [] };
    else if (e === '/rewrites/p1/workflow') body = { workflow: { id: 'p1', title: { key: '', text: '' }, copy: { key: '', body: '', topics: [] }, drafts: {} }, reference: {}, titles: [], copies: [], angles: [], image_plans: [] };
    await route.fulfill({ json: body });
  });
}
(async () => {
  const previous = await fs.readFile(path.join(out, 'previous-assets.json'), 'utf8').then(JSON.parse);
  const current = await fs.readdir(path.resolve(__dirname, '../dist/assets'));
  for (const name of previous) assert(current.includes(name), 'build removed a previously served resource: ' + name);
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const old = await browser.newPage();
    const oldErrors = [];
    old.on('pageerror', e => oldErrors.push(e.message));
    await fixtures(old);
    await old.route(base + '/', route => fs.readFile(path.join(out, 'previous-index.html'), 'utf8').then(body => route.fulfill({ contentType: 'text/html', body })));
    await old.goto(base + '/#collections');
    await old.getByRole('button', { name: '仿写工作台', exact: true }).click();
    await old.getByText('Projects', { exact: true }).waitFor();
    assert.equal(await old.getByRole('alert').count(), 0);
    assert.deepEqual(oldErrors, []);
    await old.close();
    const page = await browser.newPage({ viewport: { width: 1157, height: 765 } });
    await fixtures(page);
    let rejectChunk = true;
    await page.route('**/assets/Rewrites-*.js', route => rejectChunk ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing old chunk' }) : route.continue());
    await page.goto(base + '/#rewrites');
    await page.getByText('工作台已更新，需要重新打开', { exact: true }).waitFor();
    assert.equal(await page.getByText('可能是更新后文件缓存不一致', { exact: false }).count(), 0);
    rejectChunk = false;
    await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
    const heading = page.getByText('Projects', { exact: true });
    await heading.waitFor();
    await page.getByRole('textbox', { name: '搜索项目', exact: true }).fill('城市');
    await page.getByRole('button', { name: /城市漫游/ }).first().waitFor();
    const styles = await heading.evaluate(el => ({ shadow: getComputedStyle(el).textShadow, glow: getComputedStyle(el, '::before').backgroundImage }));
    assert.notEqual(styles.shadow, 'none');
    assert.match(styles.glow, /radial-gradient/);
    await page.screenshot({ path: path.join(out, 'projects-1157.png') });
    for (const width of [1720, 823, 547, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page overflows at ' + width);
      await page.screenshot({ path: path.join(out, 'workspace-' + width + '.png') });
    }
    console.log('PASS: previous build stays loadable, missing lazy chunk reports an update and recovers on explicit refresh, search and heading styles work, five widths do not overflow.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

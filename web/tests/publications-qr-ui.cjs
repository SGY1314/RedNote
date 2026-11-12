const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { chromium, browserLaunchOptions } = require("./browser.cjs");

const bundle = buildSync({
  stdin: {
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import Publications from'./src/Publications';import{workspaceTheme}from'./src/theme';import'./src/workspace.css';import'./src/rednote.css';import'./src/refinement.css';import'./src/preview-design.css';import'./src/forest-theme.css';
const drafts=[{id:'xhs',target_platform:'xhs',kind:'image',title:'小红书手机发布测试',body:'完整正文',topics:['生活'],asset_ids:['image'],ready:true},{id:'douyin',target_platform:'douyin',kind:'video',title:'抖音手机发布测试',body:'视频正文',topics:[],asset_ids:['video'],ready:true},{id:'legacy',target_platform:'xhs',kind:'image',title:'旧版发布记录',body:'保留原稿',topics:[],asset_ids:['image'],ready:true,online_state:'manual_ready',online_job_id:'old-job'}].map(p=>({...p,project_id:'',version_id:'v',created_at:'2026-11-02T01:00:00Z'}));
const assets=[{id:'image',name:'封面',kind:'image',status:'ready'},{id:'video',name:'视频',kind:'video',status:'ready'}];
function Fixture(){const[publications,setPublications]=useState(drafts);window.resolveLegacy=()=>setPublications(p=>p.map(x=>x.id==='legacy'?{...x,online_state:'failed'}:x));return <ConfigProvider theme={workspaceTheme}><App><div className='app-shell reference-design rednote-shell'><aside className='sidebar'><button className='brand'>RedNote</button></aside><main className='main-shell'><header className='topbar'>发布管理</header><div className='page-content page-publications'><Publications publications={publications} assets={assets} jobs={[{id:'old-job',kind:'publish',state:'succeeded'}]} refresh={async()=>{}} onCreate={()=>{}}/></div></main></div></App></ConfigProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: path.resolve(__dirname, ".."),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outdir: "out",
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const origin = "http://127.0.0.1:18887";
const output = path.resolve(
  __dirname,
  "../../data/verification/qr-only-publications",
);
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2kAAAAASUVORK5CYII=",
  "base64",
);

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
    });
    const errors = [],
      requests = [],
      sessions = new Map();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(origin + "/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>',
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/fixture.css")
        return route.fulfill({ contentType: "text/css", body: css });
      requests.push(request.method() + " " + url.pathname);
      if (url.pathname.endsWith("/file"))
        return route.fulfill({ contentType: "image/png", body: pixel });
      if (url.pathname === "/api/v1/session")
        return route.fulfill({ json: { csrf_token: "fixture" } });
      if (url.pathname.startsWith("/api/v1/miniapp/"))
        return route.fulfill({ json: { available: true } });
      if (url.pathname === "/api/v1/post-monitor")
        return route.fulfill({ json: { accounts: [], posts: [] } });
      if (url.pathname.startsWith("/api/v1/rewrites/"))
        return route.fulfill({ json: { versions: [] } });
      if (url.pathname.endsWith("/resolve")) {
        assert.deepEqual(request.postDataJSON(), { not_published: true });
        await page.evaluate(() => window.resolveLegacy());
        return route.fulfill({ json: {} });
      }
      if (/\/(mobile|douyin)-handoff$/.test(url.pathname)) {
        if (request.method() === "POST") {
          const ticket = "a".repeat(32);
          const session = {
            id: "s",
            state: "created",
            ticket,
            expires_at: new Date(Date.now() + 600000).toISOString(),
            miniapp_scheme_url:
              "xhsdiscover://miniapp/123456789012345678901234_trial/pages/publish/index?scene=" +
              ticket,
          };
          sessions.set(url.pathname, session);
          return route.fulfill({ status: 201, json: session });
        }
        return route.fulfill(
          sessions.has(url.pathname)
            ? { json: sessions.get(url.pathname) }
            : { status: 404, json: { error: "尚未创建手机交接" } },
        );
      }
      errors.push(
        "Unexpected request: " + request.method() + " " + url.pathname,
      );
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected fixture request" },
      });
    });
    await page.goto(origin);
    const assertPhoneOnly = async () => {
      assert.equal(await page.locator(".publisher-account-bar").count(), 0);
      for (const name of ["扫码连接", "上传到小红书", "开始准备上传"])
        assert.equal(
          await page.getByRole("button", { name, exact: true }).count(),
          0,
          name,
        );
      assert.ok(
        !requests.some((r) =>
          /\/publisher\/|\/publish-prepare|\/open-editor/.test(r),
        ),
        "account publishing request",
      );
    };
    await page.getByText("小红书手机发布测试", { exact: true }).waitFor();
    for (const width of [1720, 1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      await assertPhoneOnly();
      const filterRow = page.locator(".publication-filter-grid");
      const rowBox = await filterRow.boundingBox();
      const lastFilter = await filterRow.locator(":scope > .ant-select").last().boundingBox();
      const filterLayout = await filterRow.evaluate(el => ({ columns: getComputedStyle(el).gridTemplateColumns, gap: getComputedStyle(el).gap, children: [...el.children].map(child => ({ width: getComputedStyle(child).width, minWidth: getComputedStyle(child).minWidth, column: getComputedStyle(child).gridColumn })) }));
      assert(Math.abs(lastFilter.x + lastFilter.width - rowBox.x - rowBox.width) < 2, "Filters fill the available row at " + width + ' ' + JSON.stringify({rowBox,lastFilter,filterLayout}));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "overflow " + width,
      );
      await page.screenshot({
        path: path.join(output, `list-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    await page.getByText("小红书手机发布测试", { exact: true }).click();
    await page.getByRole("heading", { name: "发布稿详情" }).waitFor();
    await assertPhoneOnly();
    await page
      .getByRole("button", { name: "手机扫码发布", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole("button", { name: "生成二维码", exact: true }).click();
    await page.locator(".mobile-publish-qr").waitFor();
    assert.equal(
      requests.filter(
        (r) => r === "POST /api/v1/publications/xhs/mobile-handoff",
      ).length,
      1,
    );
    await page.screenshot({
      path: path.join(output, "phone-qr.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /^关\s*闭$/ }).click();
    await page.getByRole("button", { name: "返回发布管理" }).click();
    await page.getByText("旧版发布记录", { exact: true }).click();
    await page.getByRole("button", { name: "核实未发布", exact: true }).click();
    await page
      .getByRole("button", { name: "已核实未发布", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "手机扫码发布", exact: true })
      .filter({ visible: true })
      .isEnabled()
      .then((v) => assert.ok(v));
    await page.getByRole("button", { name: "返回发布管理" }).click();
    assert.equal(await page.getByRole("tab").count(), 0);
    assert.equal(
      await page.getByText("小红书帖子数据", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("link", { name: "打开小红书创作平台" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "刷新发布管理" }).count(),
      0,
    );
    assert(
      !requests.some((r) => r.includes("/post-monitor")),
      "Removed monitor must not request post data",
    );
    await assertPhoneOnly();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: QR-only publication list/detail, legacy recovery, removed monitor and toolbar actions, and 1720/1157/823/547/390px layouts.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const { chromium, browserLaunchOptions } = require("./browser.cjs");
const { buildSync } = require("esbuild");
const path = require("node:path"),
  assert = require("node:assert/strict");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
  "base64",
);
const bundle = buildSync({
  stdin: {
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App} from 'antd';import CoverPicker from './src/CoverPicker';import Results from './src/ImageGenerationResults';
function Fixture(){const [assets,setAssets]=useState([{id:'generated',name:'生成图片',kind:'image',source:'generated',status:'ready',library_state:'result'},{id:'library',name:'素材库封面',kind:'image',source:'upload',status:'ready'}]);const [selected,setSelected]=useState([]);const [cover,setCover]=useState('');const refresh=async()=>{const r=await fetch('/api/v1/assets');setAssets(await r.json());};return <App><Results assets={assets} jobs={[{id:'j',result:'generated',state:'succeeded',stage:'完成'}]} selected={selected} disabled={false} canAdd={true} refresh={refresh} onAdd={async id=>setSelected([id])} onRemove={async()=>setSelected([])} onAddMany={async ids=>setSelected(ids)}/><CoverPicker assets={assets} value={cover} disabled={false} refresh={refresh} onConfirm={async id=>{setCover(id);return true;}}/><output data-testid="selected">{selected.join(',')}</output><output data-testid="cover">{cover}</output></App>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: path.resolve(__dirname, ".."),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;
(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage();
    let saves = 0,
      uploads = 0;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const assets = [
      {
        id: "generated",
        name: "生成图片",
        kind: "image",
        source: "generated",
        status: "ready",
        library_state: "result",
      },
      {
        id: "library",
        name: "素材库封面",
        kind: "image",
        source: "upload",
        status: "ready",
      },
    ];
    await page.route("http://media.test/**", async (route) => {
      const r = route.request(),
        p = new URL(r.url()).pathname;
      if (p === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/fixture.js"></script>',
        });
      if (p === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (p.endsWith("/file"))
        return route.fulfill({ contentType: "image/png", body: png });
      if (p === "/api/v1/session")
        return route.fulfill({ json: { csrf_token: "fixture" } });
      if (p.endsWith("/save-to-library")) {
        saves++;
        assets[0].library_state = "saved";
        return route.fulfill({ json: assets[0] });
      }
      if (p === "/api/v1/assets" && r.method() === "POST") {
        uploads++;
        const asset = {
          id: "local-cover",
          name: "local.png",
          kind: "image",
          source: "upload",
          status: "ready",
        };
        assets.push(asset);
        return route.fulfill({ json: asset });
      }
      if (p === "/api/v1/assets") return route.fulfill({ json: assets });
      return route.abort();
    });
    await page.goto("http://media.test/");
    await page
      .getByRole("button", { name: "加入发布素材", exact: true })
      .click();
    await page
      .getByRole("button", { name: "取消加入发布素材", exact: true })
      .waitFor();
    assert.equal(saves, 0);
    await page
      .getByRole("button", { name: "取消加入发布素材", exact: true })
      .click();
    await page
      .getByRole("button", { name: "加入发布素材", exact: true })
      .waitFor();
    assert.equal(await page.getByTestId("selected").textContent(), "");
    await page
      .getByRole("button", { name: "下载到素材库", exact: true })
      .click();
    await page
      .getByRole("button", { name: "已存入素材库", exact: true })
      .waitFor();
    assert.equal(saves, 1);
    assert.equal(await page.getByTestId("selected").textContent(), "");
    await page.getByRole("button", { name: "选择封面", exact: true }).click();
    await page
      .locator("input[type=file]")
      .setInputFiles({ name: "local.png", mimeType: "image/png", buffer: png });
    await page
      .getByRole("button", { name: "使用这张封面", exact: true })
      .waitFor();
    assert.equal(uploads, 0);
    await page.getByRole("button", { name: /^(取\s*消|Cancel)$/i }).click();
    assert.equal(uploads, 0);
    await page.getByRole("button", { name: "选择封面", exact: true }).click();
    await page.getByPlaceholder("搜索素材库图片").fill("素材库封面");
    await page.getByRole("button", { name: "选择并预览", exact: true }).click();
    await page
      .getByRole("button", { name: "使用这张封面", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=cover]").textContent === "library",
    );
    assert.equal(uploads, 0);
    // Reopening an unchanged selection must load preview and re-enable confirmation.
    await page.getByRole("button", { name: "选择封面", exact: true }).click();
    await page
      .getByRole("button", { name: "使用这张封面", exact: true })
      .click();
    await page.getByRole("button", { name: "选择封面", exact: true }).click();
    await page
      .locator("input[type=file]")
      .setInputFiles({ name: "local.png", mimeType: "image/png", buffer: png });
    await page
      .getByRole("button", { name: "使用这张封面", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=cover]").textContent ===
        "local-cover",
    );
    assert.equal(uploads, 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: independent result save/selection/removal, local preview cancellation, library preview and confirmed local cover upload.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

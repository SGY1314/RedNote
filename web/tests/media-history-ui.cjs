const { chromium, browserLaunchOptions } = require("./browser.cjs");
const { buildSync } = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const now = "2026-10-16T03:00:00Z";
const jobs = [
  { id: "active", kind: "collect", state: "running" },
  { id: "done", kind: "download", state: "succeeded", result: "a1" },
  { id: "failed", kind: "asr", state: "blocked", error: "请配置服务" },
  { id: "removed", kind: "ocr", state: "succeeded", history_deleted_at: now },
].map((j) => ({
  target: "p",
  stage: "测试任务",
  updated_at: now,
  created_at: now,
  ...j,
}));
const mutations = [];
const bundle = buildSync({
  stdin: {
    contents: [
      "import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import zhCN from 'antd/locale/zh_CN';import TaskDrawer from './src/workspace/TaskDrawer';import PublicationMedia from './src/components/PublicationMedia';import{publicationSelection}from'./src/publicationSelection';",
      "const assets=['a1','a2','a3','deleted','result'].map((id,i)=>({id,name:id,kind:'image',status:'ready',source:'upload',width:200,height:200+i*40,deleted_at:id==='deleted'?'2026-10-16':'',library_state:id==='result'?'result':'saved'}));",
      "function Fixture(){const[jobs,setJobs]=useState([]);const[open,setOpen]=useState(true);const[selected,setSelected]=useState(['a2','a2','ghost','deleted','result']);const refresh=async()=>setJobs(await fetch('/api/v1/jobs').then(r=>r.json()));useEffect(()=>{refresh()},[]);return <ConfigProvider locale={zhCN}><App><TaskDrawer open={open} onClose={()=>setOpen(false)} jobs={jobs} refresh={refresh}/><button onClick={()=>setOpen(true)}>打开任务</button><p data-count>已选 {publicationSelection(assets,selected,'image').ids.length} 份素材</p><div style={{width:800}}><PublicationMedia assets={assets} selected={selected} kind='image' disabled={false} onChange={async(ids)=>{setSelected(ids);return true}} onOpen={()=>setSelected(ids=>[...ids,'a3'])}/></div></App></ConfigProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);",
    ].join("\n"),
    resolveDir: path.resolve(__dirname, ".."),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;
(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://history.test/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      if (p === "/api/v1/session")
        return route.fulfill({ json: { csrf_token: "fixture" } });
      if (p === "/api/v1/jobs") return route.fulfill({ json: jobs });
      if (p === "/api/v1/jobs/history/delete") {
        const { ids } = req.postDataJSON();
        mutations.push(ids);
        assert.equal(req.headers()["x-csrf-token"], "fixture");
        const deleted_ids = [],
          skipped_active_ids = [];
        for (const id of ids) {
          const j = jobs.find((j) => j.id === id);
          if (["running", "queued"].includes(j.state))
            skipped_active_ids.push(id);
          else {
            j.history_deleted_at = now;
            deleted_ids.push(id);
          }
        }
        return route.fulfill({ json: { deleted_ids, skipped_active_ids } });
      }
      if (p.startsWith("/api/v1/")) {
        if (p.endsWith("/file")) {
          const id = p.split("/")[4],
            i = ["a1", "a2", "a3", "deleted", "result"].indexOf(id);
          return route.fulfill({
            contentType: "image/svg+xml",
            body:
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="' +
              (200 + i * 40) +
              '"><rect width="100%" height="100%" fill="#346cc3"/></svg>',
          });
        }
        throw Error("Unexpected API request: " + req.method() + " " + p);
      }
      if (p === "/fixture.js")
        return route.fulfill({ body: bundle, contentType: "text/javascript" });
      if (p === "/fixture.css")
        return route.fulfill({
          body: await fs.readFile(
            path.resolve(__dirname, "../src/workspace.css"),
          ),
          contentType: "text/css",
        });
      return route.fulfill({
        body: '<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>',
        contentType: "text/html",
      });
    });
    await page.goto("http://history.test/");
    await page.getByText("全部 3", { exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-job-id="active"] button').count(),
      0,
    );
    assert.equal(await page.locator('[data-job-id="removed"]').count(), 0);
    await page
      .locator('[data-job-id="done"]')
      .getByRole("button", { name: "删除历史记录" })
      .click();
    await page.getByRole("button", { name: /取\s*消/ }).click();
    assert.equal(mutations.length, 0, "Cancelling must leave history intact");
    await page
      .locator('[data-job-id="done"]')
      .getByRole("button", { name: "删除历史记录" })
      .click();
    await page
      .locator(".ant-popconfirm-buttons")
      .getByRole("button", { name: "删除历史", exact: true })
      .click();
    await page.getByText("全部 2", { exact: true }).waitFor();
    assert.equal(jobs.find((j) => j.id === "done").result, "a1");
    await page.getByRole("button", { name: /清空历史$/ }).click();
    await page
      .locator(".ant-popconfirm-buttons")
      .getByRole("button", { name: "清空历史", exact: true })
      .click();
    await page.getByText("全部 1", { exact: true }).waitFor();
    assert.deepEqual(mutations, [["done"], ["failed"]]);
    assert.ok(
      await page.locator(".task-modal").getByRole("button", { name: /清空历史$/ }).isDisabled(),
    );
    await page.reload();
    await page.getByText("全部 1", { exact: true }).waitFor();
    await page.locator(".task-modal .ant-modal-close").click();
    await page.locator(".task-modal").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("[data-count]").textContent(),
      "已选 2 份素材",
    );
    assert.equal(
      await page.getByRole("checkbox", { checked: true }).count(),
      2,
    );
    await page
      .getByRole("button", { name: "移除不可用素材", exact: true })
      .click();
    assert.equal(await page.locator(".publication-media-warning").count(), 0);
    const visibleIDs = () =>
      page.locator(".publication-media-tile").evaluateAll((tiles) =>
        tiles.map((t) => t.dataset.assetId),
      );
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".publication-media-tile img")].every(
        (i) => i.complete && i.naturalWidth,
      ),
    );
    assert.deepEqual(await visibleIDs(), ["a2", "result"]);
    assert.equal(await page.getByRole("checkbox", { name: "选择 a3" }).count(), 0);
    await page.getByRole("button", { name: "添加素材" }).click();
    await page.locator('[data-asset-id="a3"]').waitFor();
    assert.deepEqual(await visibleIDs(), ["a2", "result", "a3"]);
    assert.equal(await page.locator("[data-count]").textContent(), "已选 3 份素材");
    await page.getByRole("checkbox", { name: "选择 a3", exact: true }).click();
    await page.locator('[data-asset-id="a3"]').waitFor({ state: "detached" });
    assert.deepEqual(await visibleIDs(), ["a2", "result"]);
    await page
      .getByRole("checkbox", { name: "选择 result", exact: true })
      .click();
    assert.equal(
      await page.locator("[data-count]").textContent(),
      "已选 1 份素材",
    );
    await page.locator('[data-asset-id="result"]').waitFor({ state: "detached" });
    assert.deepEqual(await visibleIDs(), ["a2"]);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: task history and publication media show only selected assets, with add and remove reflected in the grid.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

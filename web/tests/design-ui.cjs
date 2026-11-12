const { chromium, browserLaunchOptions } = require("./browser.cjs");
const { buildSync } = require("esbuild");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const out = path.resolve(
  __dirname,
  "../../../../verification/frontend-design-20261016",
);
const timestamp = "2026-10-16T03:00:00Z";
const image = (width, height, background, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/><circle cx="${width * 0.7}" cy="${height * 0.3}" r="${width * 0.28}" fill="#ffffff35"/><path d="M${width * 0.25} ${height * 0.3}l${width * 0.4} ${-height * 0.05}v${height * 0.4}l${-width * 0.4} ${height * 0.05}z" fill="none" stroke="#fff" stroke-width="3"/><text x="${width * 0.12}" y="${height * 0.83}" fill="#fff" font-family="Arial,sans-serif" font-size="${width * 0.06}" letter-spacing="3">${label}</text></svg>`;
const assets = [
  ["a1", "晨间灵感", 600, 840, "#a94b43", "MORNING NOTES"],
  ["a2", "蓝色手记", 800, 520, "#426d83", "SLOW LIVING"],
  ["a3", "纸上的日常", 600, 720, "#b99569", "PAPER STORIES"],
  ["a4", "生活切片", 600, 600, "#668975", "LIFE IN DETAILS"],
  ["a5", "春日记录", 600, 900, "#8f82a7", "A NEW CHAPTER"],
  ["a6", "周末散步", 900, 600, "#cb8c6b", "WEEKEND WALK"],
].map(([id, name, width, height, color, label]) => ({
  id,
  name,
  width,
  height,
  color,
  label,
  kind: "image",
  source: "upload",
  status: "ready",
  mime: "image/svg+xml",
  duration: 0,
  size: 12000,
  position: 0,
  created_at: timestamp,
}));
const media = { kind: "image", asset_ids: ["a1", "a2", "a3"], cover_id: "" };
const project = {
  id: "project",
  name: "把日常过成喜欢的样子",
  kind: "image",
  platform: "xhs",
  sources: [],
  created_at: timestamp,
  media_selections: { image: media },
  selected_versions: { image: "v1" },
};
const version = {
  id: "v1",
  project_id: project.id,
  number: 1,
  name: "初稿",
  status: "confirmed",
  media,
  title: "给忙碌生活留一点空白",
  body: "清晨的一杯茶，窗边的一束光。\n\n把注意力放回身边的小事，生活也会慢慢变得清晰。",
  topics: ["慢生活", "生活记录"],
  source_ids: [],
  created_at: timestamp,
};
const notes = [
  ["n1", "把日常过成喜欢的样子", "xhs", "image", "生活手记"],
  ["n2", "周末，一起去城市里散步", "douyin", "video", "城市漫游"],
  ["n3", "留一点时间，给自己", "xhs", "image", "日常记录"],
].map(([id, title, platform, kind, author]) => ({
  id,
  title,
  platform,
  kind,
  author,
  note_id: id,
  url: "",
  tags: [],
  revision_id: id,
  likes: 1280,
  favorites: 356,
  comments: 48,
  created_at: timestamp,
  updated_at: timestamp,
}));
const pageErrors = [];
async function routeApp(route) {
  const request = route.request(),
    url = new URL(request.url()),
    p = url.pathname;
  if (p.startsWith("/api/v1")) {
    const e = p.slice(7);
    let body = [];
    if (e === "/session") body = { csrf_token: "fixture" };
    else if (e === "/health") body = { app: "xhs-workbench", status: "ok" };
    else if (e === "/sync")
      body = {
        reset: true,
        more: false,
        epoch: "design",
        cursor: 1,
        changes: Object.entries({
          jobs: [],
          assets,
          projects: [project],
          publications: [],
        }).flatMap(([entity, values]) =>
          values.map((value) => ({ entity, id: value.id, value })),
        ),
      };
    else if (e === "/collections") body = { items: notes, total: notes.length };
    else if (e.startsWith("/assets/") && e.endsWith("/file")) {
      const a = assets.find((value) => value.id === e.split("/")[2]);
      return route.fulfill({
        contentType: "image/svg+xml",
        body: image(a.width, a.height, a.color, a.label),
      });
    } else if (e === "/rewrites/project" && request.method() === "PATCH") {
      const selection = request.postDataJSON();
      Object.assign(project, selection);
      if (selection.asset_ids)
        project.media_selections[selection.kind || project.kind] = {
          asset_ids: selection.asset_ids,
          cover_id: selection.cover_id || "",
        };
      body = project;
    } else if (e === "/rewrites/project")
      body = {
        project,
        versions: [version],
        reference_assets: [],
        reference_videos: [],
      };
    else if (e.startsWith("/rewrite-models"))
      body = [
        {
          id: "model",
          name: "默认模型",
          model: "qwen-plus",
          configured: false,
        },
      ];
    else if (e.includes("/drafts/") && request.method() === "POST")
      body = {
        ...request.postDataJSON(),
        revision: (request.postDataJSON().revision || 0) + 1,
        saved_at: new Date().toISOString(),
      };
    else if (e === "/settings")
      body = {
        services: {
          collector_url: "http://127.0.0.1:5556",
          ocr: { base_url: "", model: "", configured: false },
          asr: { base_url: "", model: "", configured: false },
        },
        dependencies: {},
        data_dir: "fixture",
      };
    else if (request.method() !== "GET" && !e.includes("/drafts/"))
      throw Error(`Unexpected mutation: ${e}`);
    return route.fulfill({ json: body });
  }
  const file = p === "/" ? "index.html" : p.slice(1);
  if (file.includes("..")) return route.abort();
  return route.fulfill({
    body: await fs.readFile(path.join(__dirname, "../dist", file)),
    contentType: file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".png")
          ? "image/png"
          : "text/html",
  });
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1040 },
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.route("http://design.test/**", routeApp);
    await page.goto("http://design.test/");
    await page.getByText(notes[0].title, { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(out, "collections-desktop.png"),
      fullPage: true,
    });
    for (const width of [1440, 1024, 760, 644, 390]) {
      await page.setViewportSize({ width, height: 960 });
      const geometry = await page.evaluate(() => {
        const brand = document
          .querySelector(".topbar-wordmark")
          .getBoundingClientRect();
        const actions = document
          .querySelector(".topbar-actions")
          .getBoundingClientRect();
        const heading = document.querySelector(".workspace-heading");
        const crumb = heading.getBoundingClientRect();
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          gap: actions.left - brand.right,
          crumbGap:
            getComputedStyle(heading).display === "none"
              ? 0
              : brand.left - crumb.right,
        };
      });
      assert.ok(
        geometry.documentWidth <= width,
        `Document overflow at ${width}: ${JSON.stringify(geometry)}`,
      );
      assert.ok(
        geometry.gap >= 0 && geometry.crumbGap >= 0,
        `Header overlap at ${width}: ${JSON.stringify(geometry)}`,
      );
    }
    await page.screenshot({
      path: path.join(out, "collections-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.getByRole("button", { name: "仿写库", exact: true }).click();
    await page.locator(".project-rail-open").first().click();
    await page.getByRole("tab", { name: "素材库", exact: true }).click();
    await page.locator(".local-media-card").first().waitFor();
    assert.equal(
      await page.getByRole("region", { name: "素材筛选", exact: true }).count(),
      0,
      "Extra filters start collapsed",
    );
    const compactHeight = await page
      .locator(".media-library-toolbar")
      .evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(
      compactHeight < 90,
      "Collapsed filters should occupy at most one toolbar row on desktop",
    );
    await page.getByRole("button", { name: /^展开素材筛选/ }).click();
    const filters = page.getByRole("region", { name: "素材筛选", exact: true });
    await filters.getByText("视频", { exact: true }).click();
    await page
      .getByText("筛选结果 0 份 · 已选 0 份", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^收起素材筛选/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: /^展开素材筛选/ })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page.locator(".media-filter-count").textContent(),
      "1",
      "Collapsed panel retains the active filter count",
    );
    assert.equal(
      await page.locator(".local-media-card").count(),
      0,
      "Collapsing must preserve the selected filter",
    );
    await page.getByRole("button", { name: /^展开素材筛选/ }).click();
    await filters
      .getByRole("button", { name: "重置筛选", exact: true })
      .click();
    await page.locator(".local-media-card").first().waitFor();
    await page.getByRole("button", { name: /^收起素材筛选/ }).click();
    await page.screenshot({
      path: path.join(out, "media-desktop.png"),
      fullPage: true,
    });
    const ratios = await page
      .locator(".media-preview-button img")
      .evaluateAll((elements) =>
        elements.map((img) => {
          const rect = img.getBoundingClientRect();
          return {
            ratio: rect.width / rect.height,
            original: img.naturalWidth / img.naturalHeight,
          };
        }),
      );
    assert.ok(
      ratios.every((value) => Math.abs(value.ratio - value.original) < 0.01),
      "Images must keep their original aspect ratios",
    );
    assert.equal(await page.locator(".media-card-details").count(), 0);
    await page
      .getByRole("button", { name: `素材操作 ${assets[0].name}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: /加入发布素材$/ }).waitFor();
    for (const label of ["加入发布素材", "下载", "重命名与分类", "删除"])
      assert.ok(
        await page
          .getByRole("menuitem", { name: new RegExp(label + "$"), exact: true })
          .isVisible(),
        `Missing menu action ${label}`,
      );
    await page.screenshot({
      path: path.join(out, "media-menu.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: /^发布素材/ }).click();
    await page.locator(".publication-media-tile").first().waitFor();
    const gripPosition = await page
      .locator(".media-drag-handle")
      .first()
      .evaluate((button) => {
        const grip = button.getBoundingClientRect(),
          tile = button.closest("article").getBoundingClientRect();
        return { top: grip.top - tile.top, right: tile.right - grip.right };
      });
    assert.ok(
      Math.abs(gripPosition.top - 12) <= 1 &&
        Math.abs(gripPosition.right - 12) <= 1,
      "Drag handle must overlay the top right corner",
    );
    const before = await page
      .locator(".publication-media-tile")
      .evaluateAll((elements) => elements.map((e) => e.dataset.assetId));
    assert.deepEqual(before.slice(0, 3), ["a1", "a2", "a3"]);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await page
      .getByRole("button", { name: `拖拽排序 ${assets[0].name}` })
      .dragTo(page.locator('[data-asset-id="a2"]'));
    await page.waitForFunction(
      () =>
        document.querySelector(".publication-media-tile")?.dataset.assetId ===
        "a2",
    );
    assert.deepEqual(project.media_selections.image.asset_ids, [
      "a2",
      "a1",
      "a3",
    ]);
    await page
      .getByRole("button", { name: `拖拽排序 ${assets[0].name}` })
      .focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction(
      () =>
        document.querySelector(".publication-media-tile")?.dataset.assetId ===
        "a1",
    );
    const removalSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith("/rewrites/project") &&
        !response.request().postDataJSON().asset_ids.includes("a3"),
    );
    await page
      .getByRole("checkbox", { name: `选择 ${assets[2].name}`, exact: true })
      .click();
    await removalSaved;
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-asset-id="a3"].publication-media-tile'),
    );
    assert.deepEqual(project.media_selections.image.asset_ids, ["a1", "a2"]);
    const gallerySnapshot = () =>
      page.locator(".publication-media-tile").evaluateAll((tiles) => {
        const grid = tiles[0].parentElement.getBoundingClientRect();
        return tiles.map((tile) => {
          const r = tile.getBoundingClientRect();
          return {
            id: tile.dataset.assetId,
            src: tile.querySelector("img").src,
            x: r.x - grid.x,
            y: r.y - grid.y,
            width: r.width,
            height: r.height,
          };
        });
      });
    const stableGallery = await gallerySnapshot();
    assert.deepEqual(stableGallery.map((a) => a.id), ["a1", "a2"]);
    const addSaved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith("/rewrites/project") &&
        r.request().postDataJSON().asset_ids.includes("a5"),
    );
    await page.getByRole("button", { name: "添加素材" }).click();
    await page.getByRole("button", { name: `选择素材 ${assets[4].name}` }).click();
    await page.getByRole("button", { name: "完成选择" }).click();
    await addSaved;
    await page.locator('[data-asset-id="a5"].publication-media-tile').waitFor();
    assert.deepEqual((await gallerySnapshot()).map((a) => a.id), ["a1", "a2", "a5"]);
    assert.equal(await page.locator(".publication-media-position").count(), 3);
    const removeSaved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith("/rewrites/project") &&
        !r.request().postDataJSON().asset_ids.includes("a5"),
    );
    await page.getByRole("checkbox", { name: `选择 ${assets[4].name}` }).click();
    await removeSaved;
    await page.locator('[data-asset-id="a5"].publication-media-tile').waitFor({ state: "detached" });
    assert.deepEqual(await gallerySnapshot(), stableGallery);
    assert.equal(await page.getByRole("tab", { name: "发布素材 (2)", exact: true }).count(), 1);
    assert.equal(await page.getByText("已选 2 份素材", { exact: true }).count(), 1);
    assert.equal(await page.locator(".publication-media-position").count(), 2);
    await page.waitForFunction(
      () => !document.querySelector(".media-drag-handle")?.disabled,
    );
    assert.equal(
      await page
        .locator(".media-round-select .ant-checkbox-inner")
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await page.screenshot({
      path: path.join(out, "publication-media.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 644, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const mobileRail = await page.evaluate(() => ({
      railBottom: document
        .querySelector(".rewrite-projects")
        .getBoundingClientRect().bottom,
      editorTop: document.querySelector(".rewrite-main").getBoundingClientRect()
        .top,
    }));
    assert.ok(
      mobileRail.editorTop >= mobileRail.railBottom,
      "Project list must not overlap the editor on small screens",
    );
    await page.screenshot({
      path: path.join(out, "publication-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.getByRole("tab", { name: "素材库", exact: true }).click();
    await page
      .getByRole("button", { name: `素材操作 ${assets[3].name}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: /加入发布素材$/ }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-node-key="publish"]')
        ?.textContent.includes("3"),
    );
    assert.deepEqual(project.media_selections.image.asset_ids, [
      "a1",
      "a2",
      "a4",
    ]);
    assert.deepEqual(pageErrors, []);

    await page.getByRole("tab", { name: "图片仿写", exact: true }).click();
    await page.locator(".image-generation-action").first().waitFor();
    for (const width of [1440, 1145, 644, 390]) {
      await page.setViewportSize({ width, height: 1040 });
      const buttons = await page
        .locator(".image-generation-action")
        .evaluateAll((elements) =>
          elements.map((e) => {
            const r = e.getBoundingClientRect(),
              parent = e.parentElement.getBoundingClientRect();
            return {
              width: r.width,
              parent: parent.width,
              left: r.left - parent.left,
              disabled: e.disabled,
            };
          }),
        );
      assert.equal(buttons.length, 2);
      assert.ok(
        buttons.every(
          (b) => b.width <= 280 && b.width <= b.parent && Math.abs(b.left) < 2,
        ),
        "Image actions must stay compact and left aligned at " +
          width +
          ": " +
          JSON.stringify(buttons),
      );
      assert.ok(
        buttons.every((b) => b.disabled),
        "Unconfigured actions must remain disabled",
      );
    }
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.getByRole("button", { name: "发布管理", exact: true }).click();
    const prepare = page.getByRole("button", {
      name: "去准备内容",
      exact: true,
    });
    await prepare.waitFor();
    assert.equal(
      await prepare.evaluate((e) => getComputedStyle(e).color),
      "rgb(255, 255, 255)",
      "Primary empty-state action must use high-contrast white text",
    );

    // Exercise the shared button separately without making a model request.
    const bundle = buildSync({
      stdin: {
        contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import GenerateButton from './src/components/GenerateButton';function Fixture(){const[loading,setLoading]=useState(false);return <ConfigProvider><GenerateButton loading={loading} onClick={()=>setLoading(true)}>生成专业提示词</GenerateButton></ConfigProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
        resolveDir: path.resolve(__dirname, ".."),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      define: { "process.env.NODE_ENV": '"production"' },
    }).outputFiles[0].text;
    await page.route("http://button.test/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/fixture.js")
        return route.fulfill({ body: bundle, contentType: "text/javascript" });
      if (new URL(route.request().url()).pathname === "/fixture.css")
        return route.fulfill({
          body: await fs.readFile(
            path.join(__dirname, "../src/particle-button.css"),
          ),
          contentType: "text/css",
        });
      return route.fulfill({
        body: '<link rel="stylesheet" href="/fixture.css"><div style="padding:40px" id="root"></div><script src="/fixture.js"></script>',
        contentType: "text/html",
      });
    });
    await page.goto("http://button.test/");
    const button = page.getByRole("button", { name: "生成专业提示词" });
    await button.click();
    assert.equal(await button.getAttribute("data-accelerating"), "true");
    assert.equal(await button.getAttribute("aria-busy"), "true");
    assert.ok(await button.isDisabled());
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".particle-generate-field")
        .evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    console.log(
      "PASS: 5 responsive widths, natural image ratios, contextual actions, drag and keyboard sorting, neutral selection, and particle loading/reduced-motion states (mock services).",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

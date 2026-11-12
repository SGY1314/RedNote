const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(
  __dirname,
  "../../data/verification/details-media-trash",
);
const stamp = "2026-11-03T01:00:00Z";
const longBody = Array.from(
  { length: 36 },
  (_, i) =>
    `${i + 1}. 在城市里慢下来，发现普通日常中值得记录的细节。把每一个周末过成自己喜欢的样子。`,
).join("\n\n");
const notes = Array.from({ length: 3 }, (_, i) => ({
  id: "n" + i,
  revision_id: "r" + i,
  title: i ? "已删除笔记 " + i : "城市里的周末",
  body: longBody,
  topics: ["周末日常"],
  tags: [],
  kind: "image",
  platform: "xhs",
  author: "生活手记",
  deleted_at: i ? stamp : undefined,
  created_at: stamp,
  updated_at: stamp,
}));
const assets = notes.map((n, i) => ({
  id: "a" + i,
  revision_id: n.revision_id,
  name: n.title,
  kind: "image",
  mime: "image/svg+xml",
  source: "collection",
  library_state: "collected",
  status: "ready",
  width: 600,
  height: 720,
  position: 0,
  created_at: stamp,
}));
assets.push(
  ...[1, 2].map((i) => ({
    ...assets[0],
    id: "m" + i,
    name: "已删除素材 " + i,
    source: "upload",
    library_state: "saved",
    revision_id: undefined,
    deleted_at: stamp,
  })),
);
const projects = Array.from({ length: 3 }, (_, i) => ({
  id: "p" + i,
  name: i ? "已删除项目 " + i : "当前创作项目",
  asset_ids: ["a0"],
  sources: [],
  platform: "xhs",
  kind: "image",
  deleted_at: i ? stamp : undefined,
  created_at: stamp,
}));
const pubs = Array.from({ length: 3 }, (_, i) => ({
  id: "pub" + i,
  project_id: "p0",
  version_id: "v0",
  title: i ? "已删除发布稿 " + i : "当前发布稿",
  body: "完整发布正文",
  topics: ["周末"],
  asset_ids: ["a0"],
  ready: true,
  kind: "image",
  target_platform: "xhs",
  deleted_at: i ? stamp : undefined,
  created_at: stamp,
}));
const changes = [],
  errors = [];
let cursor = 0,
  uploadCount = 0;
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
    });
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(base + "/api/v1/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        e = u.pathname.slice(7);
      let body = [];
      if (e === "/auth/me")
        body = {
          user: {
            id: "qa",
            username: "qa",
            display_name: "创作用户",
            role: "creator",
            status: "active",
          },
        };
      else if (e === "/session") body = { csrf_token: "fixture" };
      else if (e === "/sync")
        body = {
          reset: true,
          more: false,
          epoch: "details-trash",
          cursor: ++cursor,
          changes: Object.entries({
            jobs: [],
            assets,
            projects,
            publications: pubs,
          }).flatMap(([entity, values]) =>
            values.map((value) => ({ entity, id: value.id, value })),
          ),
        };
      else if (e === "/collections") {
        const items = notes.filter(
          (n) => !!n.deleted_at === (u.searchParams.get("deleted") === "true"),
        );
        body = { items, total: items.length, tags: [] };
      } else if (e === "/collections/n0")
        body = {
          note: notes[0],
          revision: {
            id: "r0",
            title: notes[0].title,
            body: longBody,
            topics: ["周末日常"],
          },
          assets: [assets[0]],
          extractions: [
            {
              id: "ocr0",
              kind: "ocr",
              text: "已修正的图片文字\n第二段",
              edited: true,
              segments: [],
            },
            {
              id: "asr0",
              kind: "asr",
              text: "修正前的转写",
              edited: true,
              segments: [
                { start_ms: 0, end_ms: 1000, text: "已修正的第一句" },
                { start_ms: 1000, end_ms: 2000, text: "已修正的第二句" },
              ],
            },
          ],
          history: [],
          jobs: [],
        };
      else if (/\/assets\/[^/]+\/file$/.test(e))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="720"><rect width="600" height="720" fill="#d7e6df"/><circle cx="410" cy="190" r="110" fill="#f3e8d3"/></svg>',
        });
      else if (e === "/assets" && req.method() === "POST") {
        uploadCount++;
        const asset = {
          ...assets[0],
          id: "uploaded" + uploadCount,
          name: "上传图片.png",
          source: "upload",
          library_state: "saved",
          revision_id: undefined,
        };
        assets.push(asset);
        body = asset;
      } else if (
        /\/(collections|rewrites|publications|assets)\/batch-(restore|trash|purge)$/.test(
          e,
        )
      ) {
        const input = req.postDataJSON(),
          category = e.split("/")[1],
          records =
            category === "collections"
              ? notes
              : category === "rewrites"
                ? projects
                : category === "assets"
                  ? assets
                  : pubs;
        changes.push({ e, input });
        if (e.endsWith("purge")) {
          assert.equal(input.confirm, true);
          for (const id of input.ids) {
            const index = records.findIndex((r) => r.id === id);
            assert(records[index]?.deleted_at);
            records.splice(index, 1);
          }
        } else
          records
            .filter((r) => input.ids.includes(r.id))
            .forEach((r) => (r.deleted_at = input.deleted ? stamp : undefined));
        body = { count: input.ids.length };
      } else if (e === "/rewrites") body = projects;
      else if (/^\/rewrites\/[^/]+\/workflow$/.test(e))
        body = {
          workflow: {
            id: "p0",
            title: { key: "", text: "" },
            copy: { key: "", body: "", topics: [] },
            drafts: {},
          },
          reference: {},
          titles: [],
          copies: [],
          angles: [],
          image_plans: [],
        };
      else if (/^\/rewrites\/[^/]+$/.test(e))
        body = {
          project: projects.find((p) => p.id === e.split("/")[2]),
          versions: [],
          reference_assets: [],
          reference_videos: [],
        };
      else if (e === "/publications") body = pubs;
      await route.fulfill({ json: body });
    });
    await page.addInitScript(() => {
      window.copiedTexts = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            if (window.rejectCopy) throw new Error("Clipboard unavailable");
            window.copiedTexts.push(text);
          },
        },
      });
    });
    await page.goto(base + "/#collections");
    await page.locator(".collection-card").first().click();
    const detail = page.getByRole("dialog", { name: "笔记详情", exact: true });
    const copy = detail.getByRole("region", { name: "笔记文案" });
    await copy.waitFor();
    await detail.evaluate((el) =>
      Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const opening = await detail.boundingBox();
    assert(opening.width <= 920 && opening.height < 700);
    const bounds = await copy.evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
      overflow: getComputedStyle(el).overflowY,
    }));
    assert(
      bounds.scroll > bounds.height + 100 &&
        bounds.height <= 410 &&
        bounds.overflow === "auto",
    );
    await copy.evaluate((el) => (el.scrollTop = 200));
    assert(await copy.evaluate((el) => el.scrollTop > 0));
    assert(
      await detail.getByRole("heading", { name: notes[0].title }).isVisible(),
    );
    for (const tab of ["提取图片文字", "视频转写", "素材预览"]) {
      await detail.getByRole("tab", { name: tab, exact: true }).click();
      if (tab !== "素材预览") {
        await detail
          .getByRole("button", {
            name: tab === "提取图片文字" ? "复制图片文字" : "复制视频转写",
            exact: true,
          })
          .click();
      }
      const next = await detail.boundingBox();
      assert(
        Math.abs(next.height - opening.height) < 2 &&
          Math.abs(next.width - opening.width) < 2,
      );
    }
    assert.deepEqual(await page.evaluate(() => window.copiedTexts), [
      "已修正的图片文字\n第二段",
      "已修正的第一句\n已修正的第二句",
    ]);
    await detail
      .getByRole("tab", { name: "提取图片文字", exact: true })
      .click();
    await page.evaluate(() => (window.rejectCopy = true));
    await detail
      .getByRole("button", { name: "复制图片文字", exact: true })
      .click();
    await page
      .getByText("复制失败，请手动选择文字复制", { exact: true })
      .waitFor();
    await page.evaluate(() => (window.rejectCopy = false));
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "extraction-copy-1157.png"),
    });
    await detail.getByRole("tab", { name: "素材预览", exact: true }).click();
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "detail-1157.png"),
    });
    const nav = page.getByRole("navigation", { name: "主导航" });
    await detail.locator(".ant-modal-close").click();
    await page
      .locator(".collection-card")
      .first()
      .getByRole("button", { name: "删除采集记录", exact: true })
      .click();
    const confirmation = page.getByRole("dialog");
    const deleteButton = confirmation.getByRole("button", {
      name: "移至回收站",
      exact: true,
    });
    assert.equal(
      await deleteButton.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      await confirmation
        .locator(".ant-modal-confirm-body > .anticon")
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(111, 139, 123)",
    );
    await confirmation.getByRole("button", { name: /^取\s*消$/ }).click();
    await nav.getByRole("button", { name: "素材库", exact: true }).click();
    const media = page.locator(".standalone-media-page");
    await media
      .getByRole("button", { name: "上传素材", exact: true })
      .waitFor()
      .catch(async (error) => {
        console.error({
          errors,
          url: page.url(),
          text: await page.locator(".page-content").innerText(),
        });
        await page.screenshot({
          animations: "disabled",
          path: path.join(out, "failure-media.png"),
        });
        throw error;
      });
    assert.equal(await media.locator(".media-page-intro").count(), 0);
    assert.equal(await media.getByText(/^\d+ 个素材$/).count(), 0);
    await media.getByRole("button", { name: "上传素材", exact: true }).click();
    const upload = page.getByRole("dialog", { name: "上传素材", exact: true });
    await upload.waitFor();
    await upload.getByRole("combobox", { name: "上传素材分类" }).fill("周末");
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "upload-1157.png"),
    });
    await upload.locator("input[type=file]").setInputFiles({
      name: "上传图片.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.waitForFunction(() =>
      document.querySelector(".ant-upload-list-item-done"),
    );
    assert.equal(uploadCount, 1);
    await upload.getByRole("button", { name: /^完\s*成$/ }).click();
    await media
      .getByRole("button", { name: "预览 上传图片.png", exact: true })
      .waitFor();
    await nav.getByRole("button", { name: "回收站", exact: true }).click();
    const trash = page.getByRole("region", { name: "回收站", exact: true });
    await page.locator(".trash-workspace").waitFor();
    assert.equal(
      await page.locator(".trash-workspace .ant-segmented-item").count(),
      5,
    );
    assert.equal(
      await page
        .locator(
          ".page-trash table, .page-trash .collection-primary-tools, .page-trash .panel-tabs",
        )
        .count(),
      0,
    );
    await page.locator('[data-trash-id="n1"]').waitFor();
    assert.equal(await page.locator(".trash-card").count(), 8);
    assert.deepEqual(
      [
        ...new Set(
          await page
            .locator(".trash-card")
            .evaluateAll((els) => els.map((el) => el.dataset.trashCategory)),
        ),
      ].sort(),
      ["assets", "collections", "publications", "rewrites"],
    );
    for (const [category, label, id, original] of [
      ["collections", "采集笔记", "n1", "采集库"],
      ["rewrites", "仿写项目", "p1", "仿写库"],
      ["publications", "发布稿", "pub1", "发布管理"],
      ["assets", "素材库", "m1", "素材库"],
    ]) {
      await page
        .locator(".trash-workspace .ant-segmented")
        .getByText("全部", { exact: true })
        .click();
      const card = page.locator(`[data-trash-id="${id}"]`);
      await card.waitFor();
      await card
        .getByRole("button", { name: "恢复到" + original, exact: true })
        .click();
      await card.waitFor({ state: "detached" });
      await page
        .locator(".trash-workspace .ant-segmented")
        .getByText(label, { exact: true })
        .click();
      const next = page.locator(`[data-trash-id="${id.slice(0, -1)}2"]`);
      await next.waitFor();
      await next.getByRole("button", { name: "彻底删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "彻底删除", exact: true })
        .click();
      await next.waitFor({ state: "detached" });
      assert(
        changes.some(
          (c) => c.e.startsWith("/" + category) && c.input.ids.includes(id),
        ),
      );
    }
    await nav.getByRole("button", { name: "发布管理", exact: true }).click();
    await page
      .getByRole("button", { name: "更多操作 当前发布稿", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "移入回收站", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "移入回收站", exact: true })
      .click();
    await page
      .getByRole("button", { name: "更多操作 当前发布稿", exact: true })
      .waitFor({ state: "detached" });
    assert.equal(pubs.find((p) => p.id === "pub0").deleted_at, stamp);
    await nav.getByRole("button", { name: "回收站", exact: true }).click();
    await page
      .locator(".trash-workspace .ant-segmented")
      .getByText("发布稿", { exact: true })
      .click();
    await page.locator('[data-trash-id="pub0"]').waitFor();
    for (const width of [1720, 1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.waitForTimeout(120);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        animations: "disabled",
        path: path.join(out, `trash-${width}.png`),
      });
    }
    await nav.getByRole("button", { name: "素材库", exact: true }).click();
    await media.getByRole("button", { name: "上传素材", exact: true }).click();
    assert((await upload.boundingBox()).width <= 374);
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "upload-390.png"),
    });
    await upload.getByRole("button", { name: /^完\s*成$/ }).click();
    await nav.getByRole("button", { name: "采集工作台", exact: true }).click();
    await page
      .locator(".collection-card")
      .filter({ hasText: notes[0].title })
      .first()
      .click();
    await copy.waitFor();
    assert(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    assert(await copy.evaluate((el) => el.clientHeight <= 280));
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "detail-390.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: compact stable note detail with independent text scroll, upload dialog and uploaded asset, four masonry trash categories, restore/purge operations, publication trash entry and responsive layouts.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

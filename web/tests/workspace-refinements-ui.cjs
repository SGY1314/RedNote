const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(
  __dirname,
  "../../data/verification/workspace-refinements",
);
const stamp = "2026-11-02T08:00:00Z";
const notes = Array.from({ length: 6 }, (_, i) => ({
  id: "n" + i,
  revision_id: "r" + i,
  platform: "xhs",
  kind: "image",
  title: [
    "给忙碌生活留一点空白，记录城市里慢下来的周末",
    "周末咖啡",
    "街角的光",
  ][i % 3],
  body:
    i % 3 === 0
      ? "第一行，记录日常里的生活与灵感。\n第二行，发现身边值得留意的小事。\n第三行，让慢下来的周末留下温度。"
      : i % 3 === 1
        ? "一杯咖啡的时间。"
        : "",
  topics: i % 3 === 0 ? ["生活记录", "周末日常", "城市漫游"] : [],
  tags: ["666", "旅行"],
  author: "生活手记",
  rating: 3,
  likes: 128,
  favorites: 32,
  comments: 8,
  url: "https://www.xiaohongshu.com/explore/n" + i,
  created_at: stamp,
  updated_at: stamp,
}));
notes[5].tags = null;
const assets = notes.map((note, i) => ({
  id: "a" + i,
  revision_id: note.revision_id,
  name: note.title,
  kind: "image",
  mime: "image/svg+xml",
  source: "collection",
  library_state: "collected",
  status: "ready",
  position: 0,
  width: i % 3 === 1 ? 900 : 600,
  height: i % 3 === 1 ? 600 : i % 3 === 2 ? 1800 : 720,
  size: 1000,
  created_at: stamp,
}));
const projects = [
  {
    id: "p1",
    name: "城市漫游",
    platform: "xhs",
    kind: "image",
    asset_ids: [],
    sources: [],
    created_at: stamp,
  },
];
const jobs = [];
projects.push(
  ...Array.from({ length: 8 }, (_, i) => ({
    ...projects[0],
    id: "p" + (i + 2),
    name: "创作项目 " + (i + 2),
  })),
);
let cursor = 0;
const created = [],
  deleted = [];
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(base + "/api/v1/**", async (route) => {
      const req = route.request(),
        e = new URL(req.url()).pathname.slice(7);
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
          epoch: "refinements",
          cursor: ++cursor,
          changes: Object.entries({
            jobs,
            assets,
            projects,
            publications: [],
          }).flatMap(([entity, values]) =>
            values.map((value) => ({ entity, id: value.id, value })),
          ),
        };
      else if (e === "/collections/tags/delete") {
        const tag = req.postDataJSON().tag;
        deleted.push(tag);
        notes.forEach((note) => {
          note.tags = (note.tags || []).filter((t) => t !== tag);
        });
        body = { count: notes.length };
      } else if (e === "/collections" && req.method() === "POST") {
        jobs.push({
          id: "capture",
          kind: "collect",
          target: "url",
          state: "queued",
          attempts: 1,
          created_at: stamp,
          updated_at: stamp,
        });
        body = { items: [{ job_id: "capture" }] };
      } else if (e === "/collections")
        body = {
          items: notes,
          total: notes.length,
          tags: [...new Set(notes.flatMap((n) => n.tags || []))],
        };
      else if (e === "/assets") body = assets;
      else if (/\/assets\/[^/]+\/file$/.test(e)) {
        const asset = assets.find((item) => item.id === e.split("/")[2]);
        return route.fulfill({
          contentType: "image/svg+xml",
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 600 720" preserveAspectRatio="none"><rect width="600" height="720" fill="#d7e6df"/><circle cx="420" cy="180" r="100" fill="#f3e8d3"/><path d="M0 600Q250 300 600 560V720H0Z" fill="#759989"/></svg>`,
        });
      } else if (e === "/rewrites" && req.method() === "POST") {
        const input = req.postDataJSON();
        created.push(input);
        const p = { ...projects[0], id: "new-project", name: input.name };
        projects.unshift(p);
        body = p;
      } else if (e === "/rewrites") body = projects;
      else if (/^\/rewrites\/[^/]+\/workflow$/.test(e))
        body = {
          workflow: {
            id: e.split("/")[2],
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
      else if (e === "/jobs") body = jobs;
      await route.fulfill({ json: body });
    });
    await page.goto(base + "/#collections");
    const cards = page.locator(".collection-card");
    await cards.first().waitFor();
    assert(await page.locator(".capture-start").isDisabled());
    assert.equal(
      await page
        .locator(".capture-start")
        .evaluate((el) => getComputedStyle(el, "::before").opacity),
      "0.55",
    );
    assert.equal(
      await page
        .locator(".brand-wordmark")
        .evaluate((el) => el.firstChild.textContent.trim()),
      "RedNote",
    );
    assert.equal(await page.locator(".brand-period").count(), 0);
    assert.equal(
      await page
        .locator(".workspace-crumb")
        .evaluate((el) => getComputedStyle(el).fontWeight),
      "600",
    );
    assert.equal(
      await cards.first().getByRole("list", { name: "分类标签" }).innerText(),
      "666\n旅行",
    );
    assert.equal(
      await cards.nth(5).locator(".collection-card-tags").count(),
      0,
    );
    assert.equal(
      await cards.first().locator(".collection-card-dots").count(),
      0,
    );
    for (const [index, ratio] of [
      [0, 600 / 720],
      [1, 1.5],
      [2, 0.75],
    ]) {
      const bounds = await cards
        .nth(index)
        .locator(".collection-card-preview")
        .boundingBox();
      assert(
        Math.abs(bounds.width / bounds.height - ratio) < 0.02,
        "Preview respects ordinary image proportions and caps long-image height",
      );
    }
    const actions = cards.first().locator(".collection-card-actions");
    await cards.first().hover();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".collection-card-actions"))
          .opacity === "1",
    );
    await page.locator(".topbar").hover();
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector(".collection-card-actions"))
            .opacity,
        ) < 0.7,
    );
    assert(await actions.isVisible());
    const controls = await page
      .locator(".collection-primary-tools")
      .evaluate((el) =>
        [...el.children].map((child) => ({
          height: child.getBoundingClientRect().height,
          radius: getComputedStyle(child).borderRadius,
        })),
      );
    assert(
      controls.every(
        (control) => control.height === 40 && control.radius === "8px",
      ),
      "Filter and view controls have a shared size",
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".collection-card")].every(
        (el) => Number(el.style.gridRowEnd.split(" ").at(-1)) > 100,
      ),
    );
    const boxes = await cards.evaluateAll((items) =>
      items.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, bottom: r.bottom };
      }),
    );
    assert(
      boxes[3].y < Math.max(...boxes.slice(0, 3).map((b) => b.bottom)) + 14,
      "Masonry fills shorter columns without waiting for a row",
    );
    const starts = [...new Set(boxes.map((b) => b.x))].sort((a, b) => a - b);
    assert.equal(starts.length, 3);
    assert(Math.abs(starts[1] - starts[0] - boxes[0].width - 16) < 2);
    await cards.first().locator(".note-curation .ant-select-selector").click();
    const deletionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/collections/tags/delete") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "删除标签 666", exact: true })
      .click();
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "Deleting a personal tag requires no confirmation window",
    );
    await deletionResponse;
    assert.deepEqual(deleted, ["666"]);
    await page.reload();
    await cards.first().waitFor();
    assert.equal(
      await cards.first().locator(".collection-card-tags").innerText(),
      "旅行",
    );
    await cards.first().locator(".note-curation .ant-select-selector").click();
    assert.equal(
      await page
        .getByRole("button", { name: "删除标签 666", exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("textbox", { name: "笔记链接或分享文字" })
      .fill("https://www.xiaohongshu.com/explore/1234");
    const capture = page.locator(".capture-start");
    assert(await capture.isEnabled());
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".capture-start"))
          .backgroundColor === "rgb(47, 93, 75)",
    );
    assert.deepEqual(
      await capture.evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
      })),
      { background: "rgb(47, 93, 75)", color: "rgb(255, 255, 255)" },
    );
    await page.screenshot({
      path: path.join(out, "collections-ready-1157.png"),
      fullPage: true,
    });
    const normalShadow = await capture.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    assert(normalShadow.includes("inset"), "The button has a raised face");
    await capture.hover();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".capture-start")).transform ===
        "matrix(1, 0, 0, 1, 0, -1)",
    );
    await page.mouse.down();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".capture-start")).transform ===
        "matrix(1, 0, 0, 1, 0, 2)",
    );
    await page.mouse.move(0, 0);
    await page.mouse.up();
    assert.equal(
      await capture.evaluate(
        (el) => getComputedStyle(el, "::before").animationName,
      ),
      "none",
    );
    await capture.click();
    await page.waitForFunction(
      () =>
        document.querySelector(".capture-start")?.dataset.collecting === "true",
    );
    assert.equal(
      await capture.evaluate(
        (el) => getComputedStyle(el, "::before").animationName,
      ),
      "capture-border-orbit",
    );
    assert.equal(
      await capture.evaluate((el) => getComputedStyle(el, "::before").opacity),
      "1",
      "The colored border remains visible while collection is active",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await capture.evaluate(
        (el) => getComputedStyle(el, "::before").animationName,
      ),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    jobs[0].state = "succeeded";
    jobs[0].updated_at = new Date().toISOString();
    await page.getByRole("button", { name: "后台任务", exact: true }).click();
    await page.locator(".task-modal .ant-modal-close").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".capture-start")?.dataset.collecting ===
        "false",
    );
    for (const width of [1720, 1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.waitForTimeout(150);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      if (width <= 700) {
        const alignment = await page
          .locator(".collection-primary-tools")
          .evaluate((el) => ({
            width: el.clientWidth,
            searchWidth: el.firstElementChild.getBoundingClientRect().width,
          }));
        assert(
          Math.abs(alignment.width - alignment.searchWidth) < 2,
          "Narrow-screen search gets the full row",
        );
      }
      await page.screenshot({
        path: path.join(out, "collections-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    const nav = page.getByRole("navigation", { name: "主导航" });
    await nav.getByRole("button", { name: "仿写工作台", exact: true }).click();
    const rail = page.locator(
      ".rewrite-project-rail-desktop .rewrite-project-rail",
    );
    await rail
      .getByRole("heading", { name: "Projects", exact: true })
      .waitFor();
    const rb = await rail.boundingBox(),
      sb = await page.locator(".sidebar").boundingBox();
    assert(Math.abs(rb.y + rb.height - sb.y - sb.height) < 2);
    assert.equal(
      await rail.evaluate((el) => getComputedStyle(el).borderRadius),
      "24px",
    );
    assert.equal(
      await page
        .locator(".topbar")
        .evaluate((el) => getComputedStyle(el).borderRadius),
      "22px",
    );
    const scrollbar = rail.getByRole("scrollbar", {
      name: "滚动项目列表",
      exact: true,
    });
    await scrollbar.waitFor();
    assert((await scrollbar.boundingBox()).height <= 72);
    assert.equal(
      await scrollbar.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(214, 219, 223)",
    );
    await scrollbar.hover();
    assert.equal(
      await scrollbar.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(146, 157, 170)",
    );
    await scrollbar.focus();
    await scrollbar.press("End");
    await page.waitForFunction(() => {
      const el = document.querySelector(
        ".rewrite-project-rail-desktop .project-rail-list",
      );
      return el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
    });
    await scrollbar.press("Home");
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".rewrite-project-rail-desktop .project-rail-list",
        ).scrollTop === 0,
    );
    const thumbBox = await scrollbar.boundingBox();
    await page.mouse.move(
      thumbBox.x + thumbBox.width / 2,
      thumbBox.y + thumbBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      thumbBox.x + thumbBox.width / 2,
      thumbBox.y + thumbBox.height / 2 + 48,
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".rewrite-project-rail-desktop .project-rail-list",
        ).scrollTop > 0,
    );
    await scrollbar.press("Home");
    await rail.locator(".project-rail-list").hover();
    await page.mouse.wheel(0, 160);
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".rewrite-project-rail-desktop .project-rail-list",
        ).scrollTop > 0,
    );
    await scrollbar.press("Home");
    await rail
      .getByRole("button", { name: "新建创作项目", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "新建项目", exact: true });
    await dialog.waitFor();
    assert.equal(
      created.length,
      0,
      "Opening naming dialog does not create a project",
    );
    await dialog.getByRole("button", { name: /^创\s*建$/ }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(created.length, 0);
    await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .fill("  我的周末计划  ");
    await dialog.getByRole("button", { name: /^创\s*建$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "我的周末计划");
    await rail.getByText("我的周末计划", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(out, "project-list-1157.png"),
      fullPage: true,
    });
    await nav.getByRole("button", { name: "素材库", exact: true }).click();
    const media = page.locator(".standalone-media-page");
    await media.locator(".embedded-workspace").waitFor();
    assert.equal(
      await media
        .getByRole("button", { name: "返回当前仿写", exact: true })
        .count(),
      0,
    );
    assert.equal(await media.locator(".media-page-intro p").count(), 0);
    assert.equal(await media.locator('[aria-label="素材库范围"]').count(), 0);
    assert.equal(
      await media
        .locator(".embedded-workspace")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    for (const width of [1720, 1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(out, "media-" + width + ".png"),
        fullPage: true,
      });
    }
    await nav.getByRole("button", { name: "仿写工作台", exact: true }).click();
    await page
      .getByRole("button", { name: "打开项目列表", exact: true })
      .click();
    const drawer = page.locator(".rewrite-project-drawer");
    assert.equal(
      await drawer.locator(".project-rail-title").isVisible(),
      false,
    );
    assert.equal(
      await drawer.locator(".ant-drawer-title").innerText(),
      "项目列表",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: floating rail, naming validation and persistence, white media workspace, removed controls, durable tag deletion, capture orbit lifecycle and masonry across five widths.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

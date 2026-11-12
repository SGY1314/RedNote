const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(__dirname, "../../data/verification/pixel-theme");
const stamp = "2026-11-05T03:00:00Z";
const note = {
  id: "n",
  revision_id: "r",
  title: "记录值得珍藏的日常",
  body: "沿着熟悉的街道，发现新的创作灵感。",
  topics: ["日常记录"],
  tags: [],
  author: "创作手记",
  platform: "xhs",
  kind: "image",
  created_at: stamp,
};
const asset = {
  id: "a",
  revision_id: "r",
  name: "日常素材",
  kind: "image",
  mime: "image/svg+xml",
  source: "upload",
  library_state: "saved",
  status: "ready",
  width: 640,
  height: 800,
  created_at: stamp,
};
const project = {
  id: "p",
  name: "日常的创作计划",
  note_id: "n",
  revision_id: "r",
  platform: "xhs",
  kind: "image",
  sources: [],
  asset_ids: [],
  created_at: stamp,
};
const pub = {
  id: "pub",
  project_id: "p",
  title: note.title,
  body: note.body,
  topics: note.topics,
  asset_ids: ["a"],
  kind: "image",
  target_platform: "xhs",
  ready: true,
  created_at: stamp,
};
const jobs = [
  {
    id: "job",
    kind: "ocr",
    target: "a",
    state: "succeeded",
    stage: "提取图片文字",
    attempts: 1,
    task_project: {
      id: "n",
      name: note.title,
      category: "collect",
      item_name: "原始图片",
    },
    created_at: stamp,
    updated_at: stamp,
  },
];
const workflow = {
  id: "p",
  account_profile: { status: "skipped", revision: 1 },
  title: { key: "", text: "" },
  copy: { key: "", body: "", topics: [] },
  image_plan_id: "",
  drafts: {},
};
async function fixture(route) {
  const req = route.request(),
    url = new URL(req.url()),
    e = url.pathname.slice(7);
  let body = [];
  if (e === "/auth/me")
    body = {
      user: {
        id: "qa",
        username: "user",
        display_name: "创作用户",
        role: "creator",
        status: "active",
      },
    };
  else if (e === "/session") body = { csrf_token: "qa" };
  else if (e === "/sync")
    body = {
      reset: true,
      more: false,
      epoch: "pixel-qa",
      cursor: 1,
      changes: Object.entries({
        projects: [project],
        assets: [asset],
        publications: [pub],
        jobs,
      }).flatMap(([entity, values]) =>
        values.map((value) => ({ entity, id: value.id, value })),
      ),
    };
  else if (e === "/collections")
    body = {
      items: [
        url.searchParams.get("deleted") === "true"
          ? { ...note, deleted_at: stamp }
          : note,
        ...(url.searchParams.get("deleted") === "true"
          ? []
          : [
              {
                ...note,
                id: "rated-note",
                rating: 3,
                title: "已评分的灵感笔记",
              },
            ]),
      ],
      total: url.searchParams.get("deleted") === "true" ? 1 : 2,
      tags: [],
    };
  else if (e === "/collections/n")
    body = {
      note,
      revision: { ...note, id: "r" },
      history: [],
      assets: [asset],
      jobs: [],
      extractions: [
        { id: "ocr", kind: "ocr", text: "已提取的图片文字", segments: [] },
      ],
    };
  else if (e === "/rewrites/p")
    body = {
      project,
      versions: [],
      reference_assets: [asset],
      reference_videos: [],
    };
  else if (e === "/rewrites/p/workflow")
    body = {
      workflow,
      reference: {
        id: "r",
        title: note.title,
        body: note.body,
        topics: note.topics,
      },
      titles: [],
      copies: [],
      angles: [],
      image_plans: [],
    };
  else if (e === "/publications") body = [pub];
  else if (e === "/usage") body = { usage: [], price_per_1k: 0 };
  else if (e === "/settings")
    body = { services: { text: {}, ocr: {}, asr: {} }, dependencies: {} };
  else if (/\/assets\/[^/]+\/(file|preview)$/.test(e))
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#b6c0ba"/><circle cx="460" cy="180" r="100" fill="#e5dfc3"/><path d="M0 500Q180 340 400 530T700 500V800H0Z" fill="#6b8578"/></svg>',
    });
  assert.equal(
    req.method(),
    "GET",
    "Visual theme checks must not mutate server content",
  );
  await route.fulfill({ json: body });
}
async function dark(locator, name) {
  const result = await locator.first().evaluate((el) => {
    const s = getComputedStyle(el),
      values = s.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    return { color: s.color, background: s.backgroundColor, values };
  });
  assert(
    result.values.slice(0, 3).every((v) => v < 80),
    `${name} must have a dark surface: ${JSON.stringify(result)}`,
  );
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions),
    errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1157, height: 765 },
    });
    await context.route(base + "/api/v1/**", fixture);
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    const page = await context.newPage();
    await page.goto(base + "/#settings");
    await page.getByRole("button", { name: "暗黑像素风", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "pixel",
    );
    await page.evaluate(() =>
      document.fonts.load('12px "Fusion Pixel"', "暗黑像素风"),
    );
    assert(
      await page.evaluate(() =>
        document.fonts.check('12px "Fusion Pixel"', "暗黑像素风"),
      ),
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("rednote.appearance.theme"),
      ),
      "pixel",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "暗黑像素风", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "暗黑像素风", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await dark(page.locator(".client-settings"), "Settings");
    assert.equal(await page.locator(".client-settings-model-note").count(), 0);
    for (const width of [1157, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 765 });
      const cards = await page.locator(".theme-option").evaluateAll((els) =>
        els.map((el) => {
          const bounds = el.getBoundingClientRect();
          const heading = getComputedStyle(el.querySelector("strong"));
          return {
            width: bounds.width,
            height: bounds.height,
            font: heading.font,
          };
        }),
      );
      assert(
        cards.every(
          (card) =>
            Math.abs(card.width - cards[0].width) < 1 &&
            Math.abs(card.height - cards[0].height) < 1 &&
            card.font === cards[0].font,
        ),
        "Pixel theme choice must match the other cards' size and typography",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(out, `settings-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    const nav = page.getByRole("navigation", { name: "主导航" });
    await nav.getByRole("button", { name: "采集工作台", exact: true }).click();
    await page.locator(".collection-card").first().waitFor();
    await dark(page.locator(".capture-card"), "Capture");
    await dark(page.locator(".table-panel"), "Collection panel");
    await dark(page.locator(".collection-card-footer"), "Rating footer");
    const unrated = page
      .locator(".collection-card")
      .first()
      .getByRole("group", { name: "个人评分" });
    const rated = page
      .locator(".collection-card")
      .nth(1)
      .getByRole("group", { name: "个人评分" });
    assert.equal(await unrated.locator(".ant-rate-star-zero").count(), 5);
    assert.equal(await rated.locator(".ant-rate-star-full").count(), 3);
    const contrast = async (rating) =>
      rating.evaluate((el) => {
        const background = getComputedStyle(
          el.closest(".collection-card-footer"),
        ).backgroundColor;
        const luminance = (color) => {
          const values = color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const linear = value / 255;
              return linear <= 0.04045
                ? linear / 12.92
                : ((linear + 0.055) / 1.055) ** 2.4;
            });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const bg = luminance(background);
        return [...el.querySelectorAll(".ant-rate-star-second")].map((star) => {
          const color = luminance(getComputedStyle(star).color);
          const glyph = star.querySelector("svg").getBoundingClientRect();
          return {
            ratio: (Math.max(bg, color) + 0.05) / (Math.min(bg, color) + 0.05),
            width: glyph.width,
            height: glyph.height,
          };
        });
      });
    for (const rating of [unrated, rated]) {
      const stars = await contrast(rating);
      assert.equal(stars.length, 5);
      assert(
        stars.every(
          (star) => star.ratio >= 3 && star.width >= 14 && star.height >= 14,
        ),
        "Every empty or selected star must be clearly visible against the footer",
      );
    }
    await unrated.locator(".ant-rate-star").nth(2).hover();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".collection-card .note-rating")
          .querySelectorAll(".ant-rate-star-full").length === 3,
    );
    assert((await contrast(unrated)).every((star) => star.ratio >= 3));
    await page.screenshot({
      path: path.join(out, "rating-hover.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.mouse.move(1, 1);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".collection-card .note-rating")
          .querySelectorAll(".ant-rate-star-zero").length === 5,
    );
    await page.screenshot({
      path: path.join(out, "ratings-visible.png"),
      fullPage: true,
      animations: "disabled",
    });
    const canvas = await page
      .locator(".pixel-backdrop canvas")
      .evaluate((el) => {
        const data = el
          .getContext("2d")
          .getImageData(0, 0, el.width, el.height).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 30) lit++;
        return { lit, width: el.width, height: el.height };
      });
    assert(
      canvas.lit > 100 && canvas.width < 400,
      "The background must render a real low-resolution lunar scene",
    );
    const capture = page.locator(".capture-start");
    await capture.hover();
    assert.equal(
      await capture.evaluate((el) => getComputedStyle(el).color),
      "rgb(9, 9, 9)",
    );
    await page.screenshot({
      path: path.join(out, "collections.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.locator(".collection-card").first().click();
    const detail = page.getByRole("dialog", { name: "笔记详情", exact: true });
    await detail.waitFor();
    await dark(detail.locator(".ant-modal-content"), "Note dialog");
    await detail
      .getByRole("tab", { name: "提取图片文字", exact: true })
      .click();
    await dark(detail.locator(".extraction-card"), "Extraction");
    await detail.locator(".ant-modal-close").click();
    await page.locator('[title="列表视图"]').click();
    await dark(page.locator(".ant-table-tbody > tr > td"), "Table row");
    await page.getByRole("button", { name: "后台任务", exact: true }).click();
    const tasks = page.getByRole("dialog", {
      name: "后台任务列表",
      exact: true,
    });
    await tasks.locator(".task-project-card").waitFor();
    await dark(tasks.locator(".task-project-card"), "Task card");
    await dark(tasks.locator(".task-project-details li"), "Task step");
    await page.screenshot({
      path: path.join(out, "tasks.png"),
      fullPage: true,
      animations: "disabled",
    });
    await tasks.locator(".ant-modal-close").click();
    await nav.getByRole("button", { name: "仿写工作台", exact: true }).click();
    await page
      .getByRole("textbox", { name: "标题仿写补充要求", exact: true })
      .waitFor();
    await dark(
      page.locator(".creation-workflow > .workflow-panel"),
      "Rewrite panel",
    );
    await page.screenshot({
      path: path.join(out, "rewrites.png"),
      fullPage: true,
      animations: "disabled",
    });
    for (const name of ["文案仿写", "图片仿写", "视频仿写"]) {
      await page
        .getByRole("navigation", { name: "仿写创作步骤" })
        .getByRole("button", { name, exact: true })
        .click();
      await dark(page.locator(".creation-workflow > .workflow-panel"), name);
    }
    await page.screenshot({
      path: path.join(out, "video.png"),
      fullPage: true,
      animations: "disabled",
    });
    await dark(
      page.locator(".original-material-empty"),
      "Original material empty state",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await dark(
      page.locator(".workflow-mobile-dock"),
      "Mobile workflow actions",
    );
    await page.setViewportSize({ width: 1157, height: 765 });
    for (const [name, selector, file] of [
      ["发布管理", ".page-publications .table-panel", "publications"],
      ["素材库", ".page-media .embedded-workspace", "media"],
      ["回收站", ".trash-workspace", "trash"],
    ]) {
      await nav.getByRole("button", { name, exact: true }).click();
      await page.locator(selector).waitFor();
      await dark(page.locator(selector), name);
      await page.screenshot({
        path: path.join(out, `${file}.png`),
        fullPage: true,
        animations: "disabled",
      });
      if (file === "publications") {
        await page
          .getByRole("button", {
            name: `查看发布稿 ${note.title}`,
            exact: true,
          })
          .click();
        const editor = page.getByRole("dialog", {
          name: "确认发布稿",
          exact: true,
        });
        await editor.locator(".publication-draft-editor").waitFor();
        await dark(
          editor.locator(".publication-content-preview"),
          "Publication editor",
        );
        await dark(
          editor.locator(".publication-editor-media"),
          "Publication carousel",
        );
        await page.screenshot({
          path: path.join(out, "publication-editor.png"),
          fullPage: true,
          animations: "disabled",
        });
        await editor.locator(".ant-modal-close").click();
      }
    }
    await page.goto(base + "/#usage");
    await page.locator(".usage-summary-card").first().waitFor();
    await dark(page.locator(".usage-summary-card"), "Usage");
    await page.screenshot({
      path: path.join(out, "usage.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".pixel-twinkles")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    const other = await context.newPage();
    await other.goto(base + "/#settings");
    await other
      .getByRole("button", { name: "莫兰迪暖粉", exact: true })
      .click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "rose",
    );
    await other.getByRole("button", { name: "静谧森林", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "forest",
    );
    assert.equal(await page.locator(".pixel-backdrop").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: third theme, pixel font and lunar canvas, persistence/cross-tab/restore, controls, dark workspace surfaces and portals, desktop/mobile layouts and reduced motion.",
    );
  } catch (error) {
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

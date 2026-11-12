const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(__dirname, "../../data/verification/appearance");
const storageKey = "rednote.appearance.theme";
const errors = [];
const stamp = "2026-11-04T14:00:00Z";
const notes = [
  "把周末过成喜欢的样子",
  "在城市里，留一段慢下来的时间",
  "收藏生活里的微小灵感",
].map((title, i) => ({
  id: "theme-note-" + i,
  note_id: "theme-note-" + i,
  revision_id: "theme-revision-" + i,
  title,
  body: "沿着熟悉的街道散步，在日常里发现值得记录的细节。",
  topics: ["生活记录"],
  tags: [],
  author: "晴日手记",
  kind: "image",
  platform: "xhs",
  created_at: stamp,
  updated_at: stamp,
}));
const assets = notes.map((note, i) => ({
  id: "theme-asset-" + i,
  name: note.title,
  revision_id: note.revision_id,
  kind: "image",
  source: "collection",
  status: "ready",
  width: 640,
  height: 800,
  position: 0,
  created_at: stamp,
}));
const jobs = ["succeeded", "running", "failed"].map((state, i) => ({
  id: "theme-job-" + i,
  kind: "ocr",
  target: assets[i].id,
  state,
  stage: "提取图片文字",
  error: state === "failed" ? "文字提取失败，请重试" : "",
  attempts: 1,
  created_at: stamp,
  updated_at: stamp,
  task_project: {
    category: "collect",
    id: notes[i].id,
    name: notes[i].title,
    item_name: "原始图片.png",
  },
}));
async function fixture(route) {
  const e = new URL(route.request().url()).pathname.slice(7);
  let value = [];
  if (e === "/auth/me")
    value = {
      user: {
        id: "theme-qa",
        username: "user",
        display_name: "创作用户",
        role: "creator",
        status: "active",
      },
    };
  else if (e === "/session") value = { csrf_token: "theme-fixture" };
  else if (e === "/sync")
    value = {
      reset: true,
      epoch: "theme",
      cursor: 1,
      more: false,
      changes: Object.entries({ jobs, assets }).flatMap(([entity, values]) =>
        values.map((value) => ({ entity, id: value.id, value })),
      ),
    };
  else if (e === "/collections") {
    const deleted =
      new URL(route.request().url()).searchParams.get("deleted") === "true";
    value = {
      items: deleted ? [] : notes,
      total: deleted ? 0 : notes.length,
      tags: [],
    };
  } else if (/^\/assets\/[^/]+\/(file|preview)$/.test(e))
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#dfc5d2"/><circle cx="440" cy="200" r="100" fill="#f8f0df"/><path d="M0 600Q190 380 380 600T700 530V800H0Z" fill="#ab8eaa"/></svg>',
    });
  else if (e === "/usage") value = { usage: [], price_per_1k: 0 };
  else if (e === "/settings")
    value = { services: { text: {}, ocr: {}, asr: {} }, dependencies: {} };
  assert.equal(
    route.request().method(),
    "GET",
    `Appearance must not mutate server data: ${e}`,
  );
  await route.fulfill({ json: value });
}
async function waitTheme(page, name) {
  await page.waitForFunction(
    (name) => document.documentElement.dataset.theme === name,
    name,
  );
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width: 1157, height: 765 },
    });
    await context.route(base + "/api/v1/**", fixture);
    context.on("page", (page) =>
      page.on("pageerror", (error) => errors.push(error.message)),
    );
    const page = await context.newPage();
    await page.goto(base + "/#settings");
    const forest = page.getByRole("button", { name: "静谧森林", exact: true });
    const rose = page.getByRole("button", { name: "莫兰迪暖粉", exact: true });
    await forest.waitFor();
    assert.equal(await page.locator(".client-settings-model-note").count(), 0);
    assert.equal(await forest.getAttribute("aria-pressed"), "true");
    const originalSidebar = await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).background);
    await rose.click();
    await waitTheme(page, "rose");
    assert.equal(await rose.getAttribute("aria-pressed"), "true");
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
      "rose",
    );
    assert.notEqual(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).background),
      originalSidebar,
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".client-settings .ant-btn"))
          .color === "rgb(73, 52, 65)",
    );
    await page.reload();
    await rose.waitFor();
    assert.equal(await rose.getAttribute("aria-pressed"), "true");
    for (const width of [1157, 823, 390]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 765 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      const cards = await page
        .locator(".theme-option")
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().toJSON()),
        );
      assert(cards.every((card) => card.x >= 0 && card.right <= width));
      assert.equal(cards.length, 3);
      assert(
        cards.every(
          (card) =>
            Math.abs(card.width - cards[0].width) < 1 &&
            Math.abs(card.height - cards[0].height) < 1,
        ),
        "All three theme cards should use the same dimensions",
      );
      assert(
        await page.locator(".theme-option").evaluateAll((els) =>
          els.every((el) => {
            const preview = el
              .querySelector(".theme-preview")
              .getBoundingClientRect();
            const heading = el
              .querySelector(".theme-option-heading")
              .getBoundingClientRect();
            return heading.top >= preview.bottom;
          }),
        ),
        "Every theme choice should place its name below the preview",
      );
      await page.screenshot({
        path: path.join(out, `rose-settings-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "采集工作台", exact: true })
      .click();
    const input = page.getByRole("textbox", {
      name: "笔记链接或分享文字",
      exact: true,
    });
    await input.fill("还没有提交的采集文字");
    await page.waitForFunction(() =>
      getComputedStyle(
        document.querySelector(".capture-start"),
      ).backgroundImage.includes("152, 90, 114"),
    );
    await page.screenshot({
      path: path.join(out, "rose-collections.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await page
        .locator(".workspace-landscape")
        .evaluate((el) =>
          getComputedStyle(el).backgroundImage.includes("morandi-dunes.webp"),
        ),
    );
    const assetResponse = await context.request.get(
      base + "/themes/morandi-dunes.webp",
    );
    assert(assetResponse.ok());
    assert(assetResponse.headers()["content-type"].includes("image/webp"));
    assert((await assetResponse.body()).length < 200000);
    const panelStyle = await page.locator(".table-panel").evaluate((el) => ({
      background: getComputedStyle(el).backgroundImage,
      blur: getComputedStyle(el).backdropFilter,
    }));
    assert(panelStyle.background.includes("rgba("));
    assert(panelStyle.blur.includes("blur(14px)"));
    await page.locator('[title="列表视图"]').click();
    await page.locator(".ant-table-tbody > tr > td").first().waitFor();
    const tableScroll = page.locator(".page-collections .ant-table-content");
    assert(
      await tableScroll.evaluate((el) => el.scrollWidth > el.clientWidth + 100),
      "The regression fixture must exercise horizontal scrolling",
    );
    for (const progress of [0, 0.45, 1]) {
      await tableScroll.evaluate((el, progress) => {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) * progress;
      }, progress);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const fixed = await page
        .locator(".page-collections .ant-table-cell-fix-right")
        .evaluateAll((els) =>
          els.map((el) => {
            const style = getComputedStyle(el);
            const color = style.backgroundColor;
            return {
              color,
              alpha: color.startsWith("rgba")
                ? Number(color.split(",")[3].replace(")", ""))
                : color.startsWith("rgb")
                  ? 1
                  : 0,
              position: style.position,
            };
          }),
        );
      assert(fixed.length > 1);
      assert(
        fixed.every((cell) => cell.alpha === 1 && cell.position === "sticky"),
        "Fixed header and action cells must fully cover the scrolling text beneath them",
      );
      await page.screenshot({
        path: path.join(out, `rose-fixed-actions-${progress}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await tableScroll.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.screenshot({
      path: path.join(out, "rose-collections-table.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: /^后台任务/ }).click();
    const tasks = page.getByRole("dialog", {
      name: "后台任务列表",
      exact: true,
    });
    await tasks.locator(".task-project-card").first().waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".task-project-icon") &&
        getComputedStyle(document.querySelector(".task-project-icon")).color ===
          "rgb(152, 90, 114)",
    );
    assert.equal(
      await tasks
        .locator(
          '[data-project-key="collect:theme-note-0"] .task-project-details li',
        )
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(243, 229, 237)",
    );
    assert.equal(
      await tasks
        .locator(
          '[data-project-key="collect:theme-note-0"] .ant-progress-success-bg',
        )
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(152, 90, 114)",
    );
    assert.equal(
      await tasks
        .locator(".ant-tag-green")
        .first()
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(143, 82, 109)",
    );
    for (const width of [1157, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 765 });
      assert(
        await tasks.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: path.join(out, `rose-tasks-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    await tasks
      .locator(".ant-segmented-item")
      .filter({ hasText: "已完成" })
      .click();
    await page.screenshot({
      path: path.join(out, "rose-tasks-completed.png"),
      fullPage: true,
      animations: "disabled",
    });
    await tasks.locator(".ant-modal-close").click();
    await tasks.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.notEqual(
      await page
        .locator(".responsive-record-table .ant-table-row")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await page.screenshot({
      path: path.join(out, "rose-collections-table-390.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.setViewportSize({ width: 1157, height: 765 });
    const other = await context.newPage();
    await other.goto(base + "/#settings");
    await other.getByRole("button", { name: "静谧森林", exact: true }).click();
    await waitTheme(page, "forest");
    assert.equal(await input.inputValue(), "还没有提交的采集文字");
    assert.equal(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).background),
      originalSidebar,
    );
    assert.equal(
      await page
        .locator(".workspace-backdrop")
        .evaluate((el) => getComputedStyle(el).display),
      "none",
    );
    await page.getByRole("button", { name: /^后台任务/ }).click();
    await page.locator(".task-project-icon").first().waitFor();
    assert.equal(
      await page
        .locator(".task-project-icon")
        .first()
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(47, 93, 75)",
    );
    await page
      .getByRole("dialog", { name: "后台任务列表", exact: true })
      .locator(".ant-modal-close")
      .click();
    await page.reload();
    await waitTheme(page, "forest");
    await other
      .getByRole("button", { name: "莫兰迪暖粉", exact: true })
      .click();
    await waitTheme(page, "rose");
    for (const route of ["publications", "usage", "trash", "rewrites"]) {
      await page.goto(base + "/#" + route);
      await page.locator(".main-shell").waitFor();
      await waitTheme(page, "rose");
      await page.screenshot({
        path: path.join(out, `rose-${route}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await other.getByRole("button", { name: "静谧森林", exact: true }).focus();
    await other.keyboard.press("Enter");
    await waitTheme(other, "forest");
    await other.screenshot({
      path: path.join(out, "forest-settings.png"),
      fullPage: true,
      animations: "disabled",
    });
    await other.evaluate((key) => {
      localStorage.setItem(key, "unsupported-theme");
    }, storageKey);
    await other.reload();
    await other
      .getByRole("button", { name: "静谧森林", exact: true })
      .waitFor();
    await waitTheme(other, "forest");
    const blocked = await browser.newContext();
    await blocked.route(base + "/api/v1/**", fixture);
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Storage blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("Storage blocked");
      };
    });
    const fallback = await blocked.newPage();
    fallback.on("pageerror", (error) => errors.push(error.message));
    await fallback.goto(base + "/#settings");
    await fallback
      .getByRole("button", { name: "莫兰迪暖粉", exact: true })
      .click();
    await waitTheme(fallback, "rose");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "checks.json"),
      JSON.stringify(
        {
          checks: [
            "theme switching",
            "reload persistence",
            "cross-tab sync without losing form input",
            "forest restoration",
            "keyboard selection",
            "invalid preference fallback",
            "blocked storage",
            "1157/823/390 responsive settings",
            "uniform theme cards and removed model notice",
            "opaque fixed action column at initial, middle and end scroll positions",
            "global pages",
            "rose task portal cards, steps and progress",
            "local dune wallpaper and glass table surfaces",
            "forest task palette preserved",
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS appearance switching, persistence, form preservation, fallback and responsive layouts",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/desktop-toolbars");
const stamp = "2026-11-05T12:00:00Z";
const notes = Array.from({ length: 9 }, (_, i) => ({
  id: "note-" + i,
  note_id: "note-" + i,
  revision_id: "revision-" + i,
  title: "把日常的灵感留下来 " + (i + 1),
  body: "记录生活中的小片段，让每一次创作都有自己的表达。",
  author: "生活手记",
  platform: "xhs",
  kind: "image",
  created_at: stamp,
  updated_at: stamp,
  tags: [],
  topics: ["生活记录"],
}));
const assets = Array.from({ length: 30 }, (_, i) => ({
  id: "asset-" + i,
  name: (i % 4 === 3 ? "视频" : "图片") + "素材 " + (i + 1),
  original_name: "素材-" + i,
  kind: i % 4 === 3 ? "video" : "image",
  source: i % 3 === 1 ? "collection" : "upload",
  category: i % 3 === 0 ? "生活" : "创作",
  revision_id: "revision-" + (i % 9),
  status: "ready",
  width: 480,
  height: 600,
  size: 2400,
  created_at: stamp,
}));
const publications = Array.from({ length: 3 }, (_, i) => ({
  id: "publication-" + i,
  title: i === 1 ? "记录今天的一点小确幸" : "周末生活里的创作灵感 " + (i + 1),
  body: "一段值得记录的日常。",
  topics: ["生活记录"],
  target_platform: i === 0 ? "douyin" : "xhs",
  kind: "image",
  asset_ids: ["asset-" + i],
  cover_id: "asset-" + i,
  ready: true,
  created_at: stamp,
}));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#e5dfd4"/><circle cx="310" cy="180" r="90" fill="#f9f6eb"/><path d="M0 430Q130 300 260 410T510 380V600H0Z" fill="#869f8e"/></svg>';
async function fixture(route) {
  const req = route.request(),
    e = new URL(req.url()).pathname.slice(7);
  assert.equal(req.method(), "GET", "Toolbar checks must not mutate real data");
  let json = [];
  if (e === "/auth/me")
    json = {
      user: {
        id: "creator",
        username: "creator",
        display_name: "创作用户",
        role: "creator",
        status: "active",
      },
    };
  else if (e === "/session") json = { csrf_token: "fixture" };
  else if (e === "/sync")
    json = {
      reset: true,
      epoch: "desktop-toolbar",
      cursor: 1,
      more: false,
      changes: Object.entries({ assets, publications }).flatMap(
        ([entity, values]) =>
          values.map((value) => ({ entity, id: value.id, value })),
      ),
    };
  else if (e === "/collections")
    json = { items: notes, total: notes.length, tags: [] };
  else if (e === "/assets") json = assets;
  else if (e === "/publications") json = publications;
  else if (
    e.startsWith("/assets/") &&
    (e.endsWith("/file") || e.endsWith("/preview"))
  ) {
    const asset = assets.find((a) => a.id === e.split("/")[2]);
    return asset?.kind === "video"
      ? route.fulfill({
          contentType: "video/mp4",
          body: await fs.readFile(
            path.join(__dirname, "fixtures/native-reference.mp4"),
          ),
        })
      : route.fulfill({ contentType: "image/svg+xml", body: svg });
  }
  return route.fulfill({ json });
}
async function choose(page, name, value) {
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name, exact: true }) })
    .click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: new RegExp("^" + value + "$") })
    .click();
}
async function sameRow(page, selector) {
  const boxes = await page
    .locator(selector)
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  assert(boxes.length >= 3);
  assert(
    Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y)) < 2,
    JSON.stringify(boxes),
  );
  assert(boxes.every((b) => b.width > 60));
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  const errors = [];
  try {
    for (const theme of ["forest", "rose", "pixel"]) {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 751 },
        reducedMotion: "reduce",
      });
      await context.addInitScript(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await context.route("**/api/v1/**", fixture);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/#media");
      const cards = page.locator(".local-media-card");
      await cards.first().waitFor();
      assert.equal(await cards.count(), 24);
      const row = page.locator(".page-media .media-library-toolbar-row");
      assert.equal(
        await page
          .locator(".page-media .media-library-toolbar")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      await sameRow(page, ".page-media .media-library-toolbar-row > *");
      const filter = row.locator(".media-filter-toggle"),
        upload = row.getByRole("button", { name: "上传素材", exact: true });
      assert((await upload.boundingBox()).x > (await filter.boundingBox()).x);
      const gridBefore = (await cards.first().boundingBox()).y;
      await filter.click();
      const popup = page.getByRole("region", { name: "素材筛选", exact: true });
      await popup.waitFor();
      const popupBox = await popup.boundingBox(),
        filterBox = await filter.boundingBox();
      assert(popupBox.y >= filterBox.y + filterBox.height);
      assert(popupBox.x >= 0 && popupBox.x + popupBox.width <= 1024);
      assert(
        Math.abs((await cards.first().boundingBox()).y - gridBefore) < 1,
        "Opening filters must not displace assets",
      );
      await page.screenshot({
        path: path.join(out, theme + "-media-filters.png"),
        animations: "disabled",
      });
      await popup.getByText("视频", { exact: true }).click();
      assert.equal(
        await cards.count(),
        assets.filter((a) => a.kind === "video").length,
      );
      await choose(page, "素材来源筛选", "我的上传");
      assert.equal(
        await cards.count(),
        assets.filter((a) => a.kind === "video" && a.source === "upload")
          .length,
      );
      await choose(page, "素材分类筛选", "生活");
      assert.equal(
        await cards.count(),
        assets.filter(
          (a) =>
            a.kind === "video" &&
            a.source === "upload" &&
            a.category === "生活",
        ).length,
      );
      await popup
        .getByRole("button", { name: "重置筛选", exact: true })
        .click();
      assert.equal(await cards.count(), 24);
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
      await filter.click();
      await page
        .getByRole("heading", { name: "全部素材", exact: true })
        .click();
      await popup.waitFor({ state: "hidden" });
      await upload.click();
      const modal = page.getByRole("dialog", { name: "上传素材", exact: true });
      await modal.waitFor();
      await modal.getByRole("button", { name: /完\s*成/ }).click();
      const scroller = page.locator(".page-media");
      await scroller.evaluate((el) => (el.scrollTop = 900));
      await page.waitForFunction(() => {
        const row = document
          .querySelector(".page-media .media-library-toolbar")
          .getBoundingClientRect();
        const area = document
          .querySelector(".page-media")
          .getBoundingClientRect();
        return Math.abs(row.top - area.top) < 2;
      });
      assert(
        (await row.boundingBox()).y >=
          (await page.locator(".topbar").boundingBox()).y,
      );
      await page.getByPlaceholder("搜索名称、原文件名或分类").fill("素材 1");
      assert((await cards.count()) > 0);
      await page.screenshot({
        path: path.join(out, theme + "-media-sticky.png"),
        animations: "disabled",
      });
      await page.getByPlaceholder("搜索名称、原文件名或分类").fill("");
      await page.goto(base + "/#collections");
      await page.locator(".capture-card").waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll(".collection-card").length === 9,
      );
      await page
        .locator(".page-collections")
        .evaluate((el) => (el.scrollTop = 0));
      const space = await page.evaluate(() => {
        const area = document
            .querySelector(".page-collections")
            .getBoundingClientRect(),
          card = document
            .querySelector(".capture-card")
            .getBoundingClientRect();
        return { left: card.left - area.left, right: area.right - card.right };
      });
      assert(space.left >= 65 && space.right >= 65, JSON.stringify(space));
      await page.screenshot({
        path: path.join(out, theme + "-collections-1024.png"),
        animations: "disabled",
      });
      await page.goto(base + "/#publications");
      await page.locator(".publication-filter-grid").waitFor();
      const publicationSpace = await page.evaluate(() => {
        const area = document
            .querySelector(".page-publications")
            .getBoundingClientRect(),
          panel = document
            .querySelector(".page-publications .table-panel")
            .getBoundingClientRect();
        return {
          left: panel.left - area.left,
          right: area.right - panel.right,
        };
      });
      assert(
        publicationSpace.left >= 65 && publicationSpace.right >= 65,
        JSON.stringify(publicationSpace),
      );
      await sameRow(page, ".publication-filter-grid > *");
      await page.getByPlaceholder("搜索发布标题或正文").fill("小确幸");
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr[data-row-key]").length === 1,
      );
      await page.getByPlaceholder("搜索发布标题或正文").fill("");
      await choose(page, "筛选发布平台", "小红书");
      assert.equal(await page.locator("tbody tr[data-row-key]").count(), 2);
      await choose(page, "筛选发布平台", "全部平台");
      await page.screenshot({
        path: path.join(out, theme + "-publications-1024.png"),
        animations: "disabled",
      });
      if (theme === "forest")
        for (const width of [1280, 1600]) {
          await page.setViewportSize({ width, height: 900 });
          await sameRow(page, ".publication-filter-grid > *");
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: path.join(out, "publications-" + width + ".png"),
            animations: "disabled",
          });
        }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS desktop 1024/1280/1600: filter popover, filtering/reset/dismissal, adjacent upload, sticky search, collection margins and single-row publication controls across all three themes. No mobile checks. All API requests mocked/read-only.",
    );
  } catch (error) {
    const failed = browser.contexts().at(-1)?.pages().at(-1);
    if (failed)
      console.log(
        await failed.evaluate(() =>
          [
            ".topbar",
            ".page-media",
            ".standalone-media-page",
            ".media-library-toolbar",
          ].map((selector) => {
            const el = document.querySelector(selector);
            if (!el) return selector;
            const css = getComputedStyle(el);
            return {
              selector,
              rect: el.getBoundingClientRect().toJSON(),
              scrollTop: el.scrollTop,
              paddingTop: css.paddingTop,
              position: css.position,
              top: css.top,
              overflow: css.overflow,
            };
          }),
        ),
      );
    await browser
      .contexts()
      .at(-1)
      ?.pages()
      .at(-1)
      ?.screenshot({
        path: path.join(out, "failure.png"),
        animations: "disabled",
      })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

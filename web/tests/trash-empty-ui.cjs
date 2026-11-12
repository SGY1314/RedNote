const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(__dirname, "../../data/verification/trash-empty");
const stamp = "2026-11-05T10:00:00Z";
const notes = Array.from({ length: 31 }, (_, i) => ({
  id: "n" + i,
  title: i ? "回收笔记 " + i : "保留的笔记",
  body: "内容记录",
  topics: [],
  tags: [],
  kind: "image",
  platform: "xhs",
  author: "创作用户",
  deleted_at: i ? stamp : undefined,
  created_at: stamp,
  updated_at: stamp,
}));
const projects = [
  { id: "p-live", name: "保留的项目", sources: [], kind: "image" },
  { id: "p-trash", name: "回收项目", sources: [], deleted_at: stamp },
];
const publications = [
  {
    id: "pub-live",
    title: "保留的发布稿",
    body: "正文",
    topics: [],
    asset_ids: [],
    ready: true,
  },
  {
    id: "pub-trash",
    title: "回收发布稿",
    body: "正文",
    topics: [],
    asset_ids: [],
    deleted_at: stamp,
  },
];
const assets = [0, 1, 2].map((i) => ({
  id: "a" + i,
  name: i ? "回收素材 " + i : "保留的素材",
  source: "upload",
  library_state: "saved",
  kind: "image",
  status: "ready",
  deleted_at: i ? stamp : undefined,
  width: 640,
  height: 800,
  created_at: stamp,
}));
const changes = [],
  errors = [];
let cursor = 0,
  blocked = true;
async function fixture(route) {
  const req = route.request(),
    url = new URL(req.url()),
    e = url.pathname.slice(7);
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
      epoch: "trash-empty",
      cursor: ++cursor,
      changes: Object.entries({ assets, projects, publications }).flatMap(
        ([entity, values]) =>
          values.map((value) => ({ entity, id: value.id, value })),
      ),
    };
  else if (e === "/collections") {
    const eligible = notes.filter(
      (note) =>
        !!note.deleted_at === (url.searchParams.get("deleted") === "true"),
    );
    const page = Number(url.searchParams.get("page") || 1),
      size = Number(url.searchParams.get("page_size") || 20);
    body = {
      items: eligible.slice((page - 1) * size, page * size),
      total: eligible.length,
      tags: [],
    };
  } else if (e === "/assets") body = assets;
  else if (e === "/rewrites") body = projects;
  else if (e === "/publications") body = publications;
  else if (e === "/rewrites/p-live")
    body = {
      project: projects[0],
      versions: [],
      reference_assets: [],
      reference_videos: [],
    };
  else if (e.endsWith("/workflow"))
    body = {
      workflow: {
        id: "p-live",
        title: { text: "" },
        copy: { body: "", topics: [] },
        account_profile: { status: "skipped" },
        drafts: {},
      },
      reference: {},
      titles: [],
      copies: [],
      image_plans: [],
      angles: [],
    };
  else if (/\/assets\/[^/]+\/file$/.test(e))
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#b5b6a8"/></svg>',
    });
  else if (
    /^\/(collections|rewrites|publications|assets)\/batch-purge$/.test(e)
  ) {
    const category = e.split("/")[1],
      input = req.postDataJSON();
    const records = {
      collections: notes,
      rewrites: projects,
      publications,
      assets,
    }[category];
    assert.equal(input.confirm, true);
    assert(
      input.ids.every((id) =>
        records.some((item) => item.id === id && item.deleted_at),
      ),
    );
    changes.push({ category, input });
    if (category === "assets" && blocked)
      return route.fulfill({
        status: 409,
        json: { error: "素材仍被保留的项目引用，请先解除引用。" },
      });
    for (const id of input.ids)
      records.splice(
        records.findIndex((item) => item.id === id),
        1,
      );
    body = { count: input.ids.length };
  } else if (req.method() !== "GET")
    throw new Error("Unexpected mutation: " + e);
  await route.fulfill({ json: body });
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/**", fixture);
    await page.addInitScript(() => {
      localStorage.setItem("rednote.appearance.theme", "rose");
      localStorage.setItem("gin.draft.p-trash", "deleted-project-draft");
      localStorage.setItem("gin.draft.p-live", "live-project-draft");
    });
    await page.goto(base + "/#trash");
    const workspace = page.locator(".trash-workspace");
    const empty = workspace.getByRole("button", {
      name: "全部清空",
      exact: true,
    });
    await workspace.locator(".trash-card").first().waitFor();
    assert.equal(await workspace.locator(".trash-card").count(), 24);
    await workspace
      .locator(".ant-segmented")
      .getByText("素材库", { exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".trash-card").length === 2,
    );
    for (const theme of ["forest", "rose", "pixel"]) {
      await page.evaluate((theme) => {
        localStorage.setItem("rednote.appearance.theme", theme);
        dispatchEvent(
          new StorageEvent("storage", {
            key: "rednote.appearance.theme",
            newValue: theme,
          }),
        );
      }, theme);
      for (const width of [1157, 390]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 765 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.equal(
          await empty.count(),
          1,
          JSON.stringify({
            theme,
            width,
            hash: await page.evaluate(() => location.hash),
            errors,
            buttons: await workspace.getByRole("button").allTextContents(),
          }),
        );
        const box = await empty.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width);
        await page.screenshot({
          path: path.join(out, `${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    await empty.click();
    const confirm = page.getByRole("dialog", {
      name: "清空全部回收内容？",
      exact: true,
    });
    await confirm
      .getByText("将彻底删除全部分类中的 34 项回收内容，此操作不可恢复。", {
        exact: true,
      })
      .waitFor();
    await confirm.getByRole("button", { name: /^取\s*消$/ }).click();
    assert.equal(changes.length, 0, "Cancel must not delete anything");
    await empty.click();
    await confirm
      .getByRole("button", { name: "全部清空", exact: true })
      .click();
    await confirm
      .getByText("已清理 32 项，剩余内容未全部清空。", { exact: true })
      .waitFor();
    await confirm
      .getByText("素材仍被保留的项目引用，请先解除引用。", { exact: true })
      .waitFor();
    assert.deepEqual(
      changes.map((item) => item.category),
      ["publications", "rewrites", "collections", "assets"],
    );
    assert.equal(
      changes[2].input.ids.length,
      30,
      "Clear all includes notes beyond the first visible page",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("gin.draft.p-trash")),
      null,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("gin.draft.p-live")),
      "live-project-draft",
    );
    await page.screenshot({
      path: path.join(out, "partial-failure.png"),
      fullPage: true,
    });
    blocked = false;
    await confirm
      .getByRole("button", { name: "重试清空", exact: true })
      .click();
    await confirm.waitFor({ state: "hidden" });
    await workspace.getByText("暂无已删除内容", { exact: true }).waitFor();
    assert(await empty.isDisabled());
    assert.deepEqual(
      changes.slice(4).map((item) => item.category),
      ["assets"],
    );
    assert.deepEqual(
      notes.map((item) => item.id),
      ["n0"],
    );
    assert.deepEqual(
      projects.map((item) => item.id),
      ["p-live"],
    );
    assert.deepEqual(
      publications.map((item) => item.id),
      ["pub-live"],
    );
    assert.deepEqual(
      assets.map((item) => item.id),
      ["a0"],
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS clear-all confirmation/cancel, all categories and pages, draft cleanup, protected failure/retry, live-content preservation, empty state and three-theme responsive layout.",
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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

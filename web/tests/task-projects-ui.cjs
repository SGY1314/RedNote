const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080",
  out = path.resolve(__dirname, "../../data/verification/task-projects");
const stamp = "2026-11-02T08:00:00Z",
  projects = [
    {
      id: "rewrite",
      name: "周末咖啡仿写",
      sources: [],
      asset_ids: [],
      created_at: stamp,
    },
  ],
  publications = [
    {
      id: "pub",
      project_id: "rewrite",
      title: "周末咖啡发布稿",
      asset_ids: [],
      ready: true,
      kind: "image",
      topics: [],
      body: "正文",
      created_at: stamp,
    },
  ];
const ref = {
  category: "collect",
  id: "note",
  name: "周末咖啡笔记",
  revision_id: "r",
  current_revision_id: "r",
};
const job = (id, kind, state, target, extra = {}) => ({
  id,
  kind,
  state,
  target,
  created_at: stamp,
  updated_at: stamp,
  attempts: 1,
  stage: "处理中",
  task_project: { ...ref, item_name: id },
  ...extra,
});
const jobs = [
  job("metadata", "collect", "succeeded", "url"),
  job("封面.png", "download", "succeeded", "a"),
  job("视频.mp4", "download", "failed", "b", {
    error: "视频下载失败：源地址失效",
  }),
  job("图片.png", "download", "running", "c"),
  job("image-gen", "image_generation", "running", "rewrite", {
    task_project: {
      category: "rewrite",
      id: "rewrite",
      name: projects[0].name,
    },
    payload: {
      series: {
        asset_ids: ["1", "2", "3"],
        completed: ["1"],
        scenes: ["1", "2", "3"],
      },
    },
  }),
  job("publish-job", "publish", "needs_review", "pub", {
    task_project: {
      category: "publish",
      id: "pub",
      name: publications[0].title,
    },
    error: "发布结果待核实",
  }),
  job("finished-cover", "download", "succeeded", "finished-asset", {
    task_project: {
      category: "collect",
      id: "finished-note",
      name: "已完成图文采集",
    },
  }),
];
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
    });
    page.setDefaultTimeout(10000);
    const errors = [],
      retries = [];
    let cursor = 0;
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
          epoch: "task-projects",
          cursor: ++cursor,
          changes: [
            ...jobs.map((value) => ({ entity: "jobs", id: value.id, value })),
            ...projects.map((value) => ({
              entity: "projects",
              id: value.id,
              value,
            })),
            ...publications.map((value) => ({
              entity: "publications",
              id: value.id,
              value,
            })),
          ],
        };
      else if (e === "/collections") body = { items: [], total: 0 };
      else if (e === "/jobs") body = jobs;
      else if (e === "/rewrites") body = projects;
      else if (e === "/publications") body = publications;
      else if (e.endsWith("/retry")) {
        const j = jobs.find(
          (j) => j.id === decodeURIComponent(e.split("/")[2]),
        );
        retries.push(j.id);
        j.state = "queued";
        j.error = "";
        j.updated_at = new Date().toISOString();
        body = j;
      } else if (e === "/jobs/history/delete") {
        const ids = req.postDataJSON().ids;
        body = { deleted_ids: [], skipped_active_ids: [] };
        jobs
          .filter((j) => ids.includes(j.id))
          .forEach((j) => {
            if (["queued", "running"].includes(j.state))
              body.skipped_active_ids.push(j.id);
            else {
              j.history_deleted_at = stamp;
              body.deleted_ids.push(j.id);
            }
          });
      } else if (e !== "/assets" && e !== "/prompt-presets") {
        errors.push("Unexpected " + e);
      }
      await route.fulfill({ json: body });
    });
    await page.goto(base + "/#tasks");
    const modal = page.getByRole("dialog", { name: "后台任务列表" });
    await modal.waitFor();
    const cards = modal.locator(".task-project-card");
    await cards.first().waitFor();
    await page.waitForFunction(
      () => document.querySelector(".task-modal .ant-modal-body")?.style.height,
    );
    const opened = await modal.boundingBox();
    assert.equal(await cards.count(), 4);
    assert.equal(await modal.getByRole("radio").count(), 3);
    assert.equal(await modal.getByRole("radio", { name: /待处理/ }).count(), 0);
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "进行中 3" })
      .click();
    assert.equal(await cards.count(), 3);
    assert.equal(
      await cards.filter({ hasText: "周末咖啡发布稿" }).count(),
      1,
      "A failed project with no running task stays in the active filter",
    );
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "已完成 1" })
      .click();
    assert.equal(await cards.count(), 1);
    assert((await cards.innerText()).includes("已完成图文采集"));
    const filtered = await modal.boundingBox();
    assert(
      Math.abs(opened.width - filtered.width) < 1 &&
        Math.abs(opened.height - filtered.height) < 1,
      "Filtering keeps the opening window size",
    );
    await modal
      .getByRole("searchbox", { name: "搜索后台任务" })
      .fill("没有此项目");
    assert.equal(await cards.count(), 0);
    const empty = await modal.boundingBox();
    assert(
      Math.abs(opened.height - empty.height) < 1 &&
        Math.abs(opened.width - empty.width) < 1,
      "An empty result keeps the opening window size",
    );
    await page.screenshot({ path: path.join(out, "tasks-empty-stable.png") });
    await modal.getByRole("searchbox", { name: "搜索后台任务" }).fill("");
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "全部 4" })
      .click();
    const collection = cards.filter({ hasText: "周末咖啡笔记" });
    assert((await collection.innerText()).includes("已完成 1 / 3"));
    assert(
      (await collection.locator(".task-project-failures").innerText()).includes(
        "视频.mp4",
      ),
    );
    assert(
      await collection
        .getByRole("button", { name: "删除项目历史" })
        .isDisabled(),
    );
    for (const width of [1720, 1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.waitForTimeout(120);
      assert(
        await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        "modal overflow " + width,
      );
      const bounds = await modal.boundingBox();
      assert(bounds.width <= 800 && bounds.x >= 8);
      if (width > 480) {
        const spacing = await cards.first().evaluate((el) => {
          const card = el.getBoundingClientRect(),
            list = el.parentElement.getBoundingClientRect();
          return {
            left: card.left - list.left,
            right: list.right - card.right,
            width: card.width,
          };
        });
        assert(
          spacing.left >= 20 &&
            spacing.right >= 20 &&
            Math.abs(spacing.left - spacing.right) < 20 &&
            spacing.width <= 680,
          "Cards are centered with breathing room inside the unchanged dialog",
        );
      }
      assert(
        await modal
          .locator(".task-list")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: path.join(out, "tasks-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    const category = modal.locator(".task-dialog-toolbar .ant-select");
    await category.locator(".ant-select-selector").click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("仿写项目", { exact: true })
      .click();
    assert.equal(await cards.count(), 1);
    assert((await cards.innerText()).includes(projects[0].name));
    assert((await cards.innerText()).includes("已完成 1 / 3"));
    await category.locator(".ant-select-selector").click();
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("全部项目", { exact: true })
      .click();
    await modal
      .getByRole("searchbox", { name: "搜索后台任务" })
      .fill("源地址失效");
    assert.equal(await cards.count(), 1);
    await collection
      .locator('[data-job-id="视频.mp4"]')
      .getByRole("button", { name: /重\s*试/ })
      .click();
    await page.locator(".ant-popconfirm-buttons .ant-btn-primary").click();
    await modal.getByRole("searchbox", { name: "搜索后台任务" }).fill("");
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-project-key="collect:note"] .task-project-failures',
        ) === null,
    );
    assert.deepEqual(retries, ["视频.mp4"]);
    const publish = cards.filter({ hasText: publications[0].title });
    const deletion = publish.getByRole("button", { name: "删除项目历史" });
    assert.equal(
      await deletion.evaluate((el) =>
        el.classList.contains("ant-btn-dangerous"),
      ),
      false,
    );
    const color = await deletion.evaluate((el) => getComputedStyle(el).color);
    assert.equal(color, "rgb(102, 112, 133)");
    await deletion.click();
    await page.locator(".ant-popconfirm-buttons .ant-btn-primary").click();
    await page.waitForFunction(
      () => !document.querySelector('[data-category="publish"]'),
    );
    assert.equal(publications.length, 1);
    assert.equal(projects.length, 1);
    assert(jobs.find((j) => j.id === "publish-job").history_deleted_at);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: compact modal, three status filters including failed projects in active, project progress, retry, safe history deletion and five viewport sizes.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

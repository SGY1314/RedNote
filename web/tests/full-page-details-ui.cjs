const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const out = path.resolve(
  __dirname,
  "../../../../../outputs/示例图结构验证-20261027-v23",
);
const now = "2026-10-26T01:00:00Z";
const note = {
  id: "n",
  note_id: "n",
  revision_id: "r",
  platform: "xhs",
  kind: "image",
  title: "把周末过成喜欢的样子",
  body: "走出家门，给生活留一点空白。",
  author: "生活手记",
  tags: ["高赞"],
  topics: ["周末日常"],
  rating: 3,
  likes: 1000,
  favorites: 350,
  comments: 28,
  created_at: now,
  updated_at: now,
};
const project = {
  id: "p",
  name: "周末生活创作",
  note_id: "n",
  revision_id: "r",
  platform: "xhs",
  kind: "image",
  sources: [],
  asset_ids: [],
  created_at: now,
};
const assets = ["a1", "a2", "a3"].map((id, i) => ({
  id,
  name: `图片${i + 1}`,
  kind: "image",
  source: i === 2 ? "generated" : "collection",
  library_state: i === 2 ? "result" : "collected",
  project_id: i === 2 ? "p" : undefined,
  revision_id: i === 2 ? undefined : "r",
  status: "ready",
  width: 600,
  height: 800,
  position: i,
  size: 200,
  duration: 0,
  created_at: now,
}));
const body = Array.from(
  { length: 12 },
  (_, i) =>
    `第${i + 1}个周末小片段：在街角喝一杯咖啡，沿着熟悉的路散步，发现日常也有新的风景。`,
).join("\n\n");
const workflow = {
  id: "p",
  title: { key: "", text: "", angle: "", generation_id: "", confirmed_at: "" },
  copy: {
    key: "",
    title_key: "",
    body: "",
    topics: [],
    generation_id: "",
    confirmed_at: "",
  },
  image_plan_id: "",
  drafts: {},
};
const data = {
  workflow,
  reference: {
    id: "r",
    title: note.title,
    body: note.body,
    topics: note.topics,
  },
  angles: [
    {
      id: "ag",
      model: "角度模型",
      created_at: now,
      notices: [],
      angles: [
        { name: "城市散步", description: "从周末沿途发现的小事切入" },
        { name: "低成本放松", description: "分享普通周末的轻松安排" },
        { name: "留一点空白", description: "从暂停忙碌的片刻展开" },
      ],
    },
  ],
  titles: [
    {
      id: "tg",
      titles: [
        "周末，给生活留一点空白",
        "在熟悉的城市发现新风景",
        "我的低成本周末安排",
      ],
      model: "标题模型",
      created_at: now,
    },
  ],
  copies: [
    {
      id: "cg",
      title_key: "t1",
      copies: [
        { body, topics: ["周末日常"] },
        { body: "一杯咖啡，一段散步，把周末还给自己。", topics: ["生活记录"] },
        { body: "不用安排得很满，在熟悉的街道也能发现新的风景。", topics: [] },
      ],
      model: "文案模型",
      created_at: now,
    },
  ],
  image_plans: [],
};
const calls = [];
const errors = [];
const jobs = [];
const scripts = [];
async function routeApp(route) {
  const req = route.request(),
    u = new URL(req.url()),
    p = u.pathname;
  if (p.startsWith("/api/v1")) {
    const e = p.slice(7);
    let value = [];
    if (e === "/auth/me")
      value = {
        user: {
          id: "user",
          username: "user",
          display_name: "创作用户",
          role: "creator",
          status: "active",
        },
      };
    else if (e === "/session") value = { csrf_token: "test" };
    else if (e === "/sync")
      value = {
        reset: true,
        more: false,
        epoch: "ui",
        cursor: 1,
        changes: Object.entries({
          jobs,
          assets,
          projects: [project],
          publications: publications,
        }).flatMap(([entity, values]) =>
          values.map((value) => ({ entity, id: value.id, value })),
        ),
      };
    else if (e === "/assets" && req.method() === "POST") {
      value = {
        ...assets[0],
        id: "local",
        name: "本地图片",
        source: "upload",
        library_state: "saved",
        revision_id: undefined,
      };
      assets.push(value);
      calls.push({ e, upload: true });
    } else if (e === "/rewrites/p/video/plan") {
      const brief = { ...req.postDataJSON(), copy_key: workflow.copy.key };
      scripts.push({
        id: "vs1",
        project_id: "p",
        model: "fixture",
        title: workflow.title.text,
        concept: "周末散步的完整故事",
        style: "自然生活记录",
        brief,
        shots: [
          {
            duration: 30,
            visual: "0–15秒沿街散步，15–30秒在窗边喝咖啡",
            camera: "平稳跟随",
            narration: "",
          },
        ],
        created_at: now,
      });
      jobs.push({
        id: "vs1",
        kind: "video_plan",
        target: "p",
        state: "succeeded",
        stage: "脚本已完成",
        result: "vs1",
        created_at: now,
        updated_at: now,
      });
      value = { job_id: "vs1" };
    } else if (e === "/rewrites/p/video/scripts") value = scripts;
    else if (e === "/rewrites/p/video/scripts/vs1/confirm") {
      scripts[0].confirmed_at = now;
      value = scripts[0];
    } else if (e === "/collections")
      value = { items: [note], total: 1, tags: ["高赞", "高粉", "优质文案"] };
    else if (e === "/collections/n" && req.method() === "PATCH") {
      Object.assign(note, req.postDataJSON());
      calls.push({ e, body: req.postDataJSON() });
      value = note;
    } else if (e === "/collections/n")
      value = {
        note,
        revision: {
          id: "r",
          title: note.title,
          body: note.body,
          topics: note.topics,
        },
        assets: assets.slice(0, 2),
        history: [],
        extractions: [],
        jobs: [],
      };
    else if (e === "/rewrites/p/workflow") value = data;
    else if (e === "/rewrites/p")
      value = {
        project,
        versions: [],
        reference_assets: assets.slice(0, 2),
        reference_videos: [],
      };
    else if (e === "/prompt-presets")
      value = ["angle", "title", "copy"].flatMap((scope) => [
        {
          id: scope + "-natural",
          scope,
          name: "自然分享",
          description: "从真实生活细节展开",
          is_default: true,
          revision: 1,
        },
        {
          id: scope + "-clear",
          scope,
          name: "清晰实用",
          description: "围绕重点直接表达",
          is_default: false,
          revision: 1,
        },
      ]);
    else if (e.endsWith("-models"))
      value = [
        {
          id: "m",
          name: "默认创作模型",
          model: "fixture",
          configured: true,
          vision: true,
          continuous_min: 2,
          continuous_max: 30,
        },
      ];
    else if (e.startsWith("/rewrites/p/workflow/drafts/")) {
      const scope = e.split("/").at(-1),
        b = req.postDataJSON();
      value = { ...b, revision: b.revision + 1, saved_at: now };
      workflow.drafts[scope] = value;
      calls.push({ e, body: b });
    } else if (e === "/rewrites/p/titles/confirm") {
      const b = req.postDataJSON();
      Object.assign(workflow.title, {
        text: b.text,
        angle: b.angle,
        key: "t1",
        confirmed_at: now,
      });
      value = workflow.title;
      calls.push({ e, body: b });
    } else if (e === "/rewrites/p/copies/confirm") {
      const b = req.postDataJSON();
      Object.assign(workflow.copy, {
        body: b.body,
        topics: b.topics,
        key: "c1",
        title_key: b.title_key,
        confirmed_at: now,
      });
      value = workflow.copy;
      calls.push({ e, body: b });
    } else if (
      e.endsWith("/titles/generate") ||
      e.endsWith("/copies/generate")
    ) {
      calls.push({ e, body: req.postDataJSON() });
      value = { job_id: "test-job" };
    } else if (e === "/settings") value = { services: {}, dependencies: {} };
    else if (e.endsWith("/file") || e.endsWith("/preview"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#b5bda6"/><circle cx="400" cy="240" r="140" fill="#e2d9b5"/><path d="M0 720L260 400L600 650V800H0" fill="#6c8067"/></svg>',
      });
    else if (req.method() !== "GET") throw Error("Unexpected mutation " + e);
    return route.fulfill({ json: value });
  }
  const name = p === "/" ? "index.html" : p.slice(1);
  if (name.includes("..")) return route.abort();
  return route.fulfill({
    body: await fs.readFile(path.resolve(__dirname, "../dist", name)),
    contentType: name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".svg")
          ? "image/svg+xml"
          : "text/html",
  });
}

const publications = [
  {
    id: "pub1",
    project_id: "p",
    version_id: "v2",
    title: "周末，给生活留一点空白",
    body,
    topics: ["周末日常", "生活记录"],
    kind: "image",
    asset_ids: ["a1", "a2"],
    ready: true,
    exported_at: [],
    target_platform: "xhs",
    created_at: now,
  },
  {
    id: "pub2",
    project_id: "p",
    version_id: "v2",
    title: "抖音发布预览",
    body,
    topics: [],
    kind: "video",
    asset_ids: ["video1"],
    ready: true,
    exported_at: [],
    target_platform: "douyin",
    created_at: now,
  },
];
assets.push({ ...assets[0], id: "video1", name: "视频1", kind: "video" });
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://experience.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname === "/api/v1/rewrites/p" &&
        route.request().method() === "GET"
      ) {
        const response = await captureDetail(route);
        return route.fulfill({ json: response });
      }
      return routeApp(route);
    });
    async function captureDetail(route) {
      // Reuse the app fixture; add the immutable release metadata through fulfillment interception.
      let result;
      await routeApp(
        new Proxy(route, {
          get(target, key) {
            if (key === "fulfill")
              return async (options) => {
                result = options.json;
              };
            const v = target[key];
            return typeof v === "function" ? v.bind(target) : v;
          },
        }),
      );
      return {
        ...result,
        versions: [
          {
            id: "v2",
            number: 2,
            name: "完整发布稿",
            created_at: now,
            title: publications[0].title,
            body,
            topics: [],
            project_id: "p",
            status: "confirmed",
            source_ids: [],
          },
        ],
      };
    }
    await page.goto("http://experience.test/#publications");
    await page
      .getByText(publications[0].title, { exact: true })
      .first()
      .click();
    await page
      .getByRole("region", { name: "发布稿详情", exact: true })
      .waitFor();
    await page.getByText("V2 · 完整发布稿", { exact: true }).waitFor();
    assert.equal(await page.locator(".ant-drawer").count(), 0);
    assert.equal(
      await page.locator(".publication-preview-copy p").textContent(),
      body,
    );
    assert.equal(
      await page
        .locator(".publication-detail-page")
        .getByText(body, { exact: true })
        .count(),
      1,
    );
    assert.equal(await page.locator(".publication-preview-slide").count(), 2);
    await page.getByRole("button", { name: "下一张发布素材" }).click();
    await page.waitForTimeout(700);
    assert.equal(
      await page.getByRole("button", { name: "下一张发布素材" }).isDisabled(),
      true,
    );
    for (const width of [1440, 1024, 700, 390, 320]) {
      await page.setViewportSize({ width, height: width > 700 ? 1000 : 844 });
      await page.waitForTimeout(250);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        columns: getComputedStyle(
          document.querySelector(".publication-detail-grid"),
        ).gridTemplateColumns,
      }));
      assert.ok(layout.document <= width + 1, JSON.stringify(layout));
      if (width <= 700) assert.equal(layout.columns.split(" ").length, 1);
      await page.screenshot({
        path: path.join(out, "发布稿详情-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: /记录已发布/ }).click();
    await page.getByRole("dialog", { name: "记录实际发布结果" }).waitFor();
    await page.getByRole("button", { name: /取\s*消/ }).click();
    assert.equal(
      calls.filter((c) => c.e?.startsWith("/publications/")).length,
      0,
    );
    await page.getByRole("button", { name: "返回来源仿写项目" }).click();
    await page.locator(".creation-workflow").waitFor();
    assert.equal(await page.locator(".project-rail").count(), 0);
    await page.getByRole("button", { name: "返回项目列表" }).click();
    await page.locator(".project-card").waitFor();
    await page.screenshot({
      path: path.join(out, "仿写项目列表-320.png"),
      fullPage: true,
    });
    await page.locator(".project-title-button").click();
    await page.locator(".creation-workflow").waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250);
      assert.ok(
        await page
          .locator(".rewrite-full-workspace")
          .evaluate(
            (e) => e.clientWidth > innerWidth * (innerWidth > 700 ? 0.65 : 0.8),
          ),
      );
      await page.screenshot({
        path: path.join(out, "标题仿写-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "发布管理", exact: true }).click();
    await page.getByText("抖音发布预览", { exact: true }).first().click();
    await page.locator(".publication-preview-slide video").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: /记录已发布/ })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "返回发布管理" }).click();
    assert.equal(await page.locator(".publication-detail-page").count(), 0);
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "验证结果.json"),
      JSON.stringify(
        {
          status: "PASS",
          checks: [
            "full page detail",
            "full body appears once",
            "ordered carousel",
            "320–1440 responsive",
            "version V2",
            "source project navigation",
            "project list and editor separated",
            "video controls",
            "Douyin publish guard",
            "no real publishing mutation",
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log("PASS publication detail and rewrite structure");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const out = process.env.WORKBENCH_UI_QA_OUT || path.resolve(
  __dirname,
  "../../data/verification/utility-pages",
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
  account_profile: {status: "skipped", revision: 1},
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
          publications: [],
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

jobs.push(
  ...["running", "succeeded", "blocked"].map((state, i) => ({
    id: "j" + i,
    kind: ["title_rewrite", "image_generation", "asr"][i],
    state,
    target: "p",
    stage: ["正在生成标题", "图片已生成", "等待配置转写服务"][i],
    created_at: now,
    updated_at: now,
  })),
);
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://experience.test/**", routeApp);
    async function capture(name) {
      for (const width of [1440, 700, 390, 320]) {
        await page.setViewportSize({
          width,
          height: width <= 700 ? 844 : 1000,
        });
        await page.waitForTimeout(200);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          name + " overflow " + width,
        );
        await page.screenshot({
          path: path.join(out, name + "-" + width + ".png"),
          fullPage: true,
        });
      }
    }
    await page.goto("http://experience.test/#rewrites");
    await page.locator(".project-title-button").click();
    await page.locator(".creation-workflow").waitFor();
    await page.getByRole("button", { name: "后台任务", exact: true }).click();
    await page.getByRole("dialog", { name: "后台任务列表", exact: true }).waitFor();
    assert.match(page.url(), /#tasks$/);
    assert.equal(await page.locator(".ant-drawer").count(), 0);
    assert.equal(await page.locator(".job-card").count(), 3);
    await capture("用户后台任务");
    await page.getByText("已完成 1", { exact: true }).click();
    assert.equal(await page.locator(".job-card").count(), 1);
    assert.equal(
      await page.locator(".job-card").getAttribute("data-job-id"),
      "j1",
    );
    await page.getByText("全部 3", { exact: true }).click();
    await page
      .getByPlaceholder("搜索任务、项目或处理信息")
      .fill("等待配置");
    assert.equal(await page.locator(".job-card").count(), 1);
    await page
      .getByPlaceholder("搜索任务、项目或处理信息")
      .fill("周末生活");
    assert.equal(await page.locator(".job-card").count(), 3);
    await page.locator(".task-modal .ant-modal-close").click();
    await page.locator(".task-modal").waitFor({ state: "hidden" });
    await page.locator(".creation-workflow").waitFor();
    assert.match(page.url(), /#rewrites$/);
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: /设置/ }).click();
    await page.locator(".settings-page").waitFor();
    assert.match(page.url(), /#settings$/);
    assert.equal(await page.locator(".client-settings > section:first-child .ant-tag").count(),0);
    assert.equal(await page.getByRole("button",{name:/退出登录/}).getAttribute("class").then(x=>x.includes("danger")),false);
    await capture("工作区设置");
    await page.getByRole("button", { name: /打开计费面板/ }).click();
    await page.locator(".usage-dashboard").waitFor();
    assert.match(page.url(), /#usage$/);
    assert.equal(await page.locator(".usage-call-count").count(),0);
    assert.equal(await page.locator(".usage-page-head p").count(),0);
    await capture("计费面板");
    await page.goto("http://experience.test/#settings");
    await page.locator(".settings-page").waitFor();
    assert.equal(await page.locator(".ant-drawer").count(), 0);
    await page.goto("http://experience.test/#tasks");
    await page.getByRole("dialog", { name: "后台任务列表", exact: true }).waitFor();
    assert.equal(await page.locator(".job-card").count(), 3);
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "辅助页面验证.json"),
      JSON.stringify(
        {
          status: "PASS",
          checks: [
            "settings route and task dialog route",
            "return to source rewrite project",
            "task search by project or stage",
            "all/done groups",
            "320–1440 widths",
            "billing navigation",
            "no automatic job mutation",
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log("PASS settings, task dialog and routing");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

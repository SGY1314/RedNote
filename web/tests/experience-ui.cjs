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
    await page.goto("http://experience.test/");
    await page.locator(".collection-card").waitFor();
    await page.getByTitle("列表视图", { exact: true }).click();
    await page.locator(".collection-list-curation").waitFor();
    const listTags = page
      .locator(".collection-list-curation")
      .getByRole("combobox", { name: "个人分类标签" });
    await listTags.fill("高粉");
    await listTags.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".collection-list-curation")
        ?.textContent.includes("已保存"),
    );
    assert.deepEqual(note.tags, ["高赞", "高粉"]);
    await page.getByTitle("卡片视图", { exact: true }).click();
    await page
      .locator(".collection-card .note-curation")
      .getByText("高粉", { exact: true })
      .waitFor();
    await page.locator(".collection-card-body > strong").click();
    await page.getByRole("tab", { name: "原文与媒体" }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "处理记录" }).count(), 0);
    await page.locator(".inline-detail-header").getByRole("button",{name:"返回采集库",exact:true}).click();
    await page.locator(".ant-drawer-mask").waitFor({ state: "hidden" });
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "采集库-电脑.png"),
    });
    await page.getByRole("button", { name: "仿写库", exact: true }).click();
    await page.locator(".project-card").getByRole("button", {name: project.name, exact: true}).click();
    await page.locator(".creation-workflow").waitFor();
    await page.locator(".workflow-candidates article").first().waitFor();
    assert.equal(await page.locator(".workflow-steps .ant-btn").count(), 5);
    assert.equal(
      await page.locator(".workflow-steps").getByText(/角度/).count(),
      0,
    );
    assert.equal(await page.locator("details.workflow-config").count(), 0);
    assert.ok(await page.getByRole("combobox", { name: "标题仿写创作方案" }).isVisible());
    assert.ok(await page.getByRole("textbox", { name: "发帖角度补充要求" }).isVisible());
    assert.ok(await page.locator(".workflow-angle-current").isVisible());
    const configs = page.locator(".workflow-config");
    await configs
      .nth(1)
      .getByRole("combobox", { name: "标题仿写创作方案" })
      .press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .getByText("清晰实用", { exact: true })
      .click();
    await page.getByRole("button", { name: /生成 3 个标题/ }).click();
    await page.waitForTimeout(800);
    assert.equal(
      calls.findLast((x) => x.e.endsWith("/titles/generate")).body.preset_id,
      "title-clear",
    );
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "标题仿写-电脑.png"),
    });
    for (const width of [1440, 1024, 700, 600, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow ${width}`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".workflow-mobile-dock").waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    assert.equal(
      await page.locator(".workflow-navigation").getAttribute("open"),
      null,
    );
    assert.equal(
      await page.locator(".workflow-reference").getAttribute("open"),
      null,
    );
    const dock = await page.locator(".workflow-mobile-dock").boundingBox();
    const nav = await page.locator(".sidebar").boundingBox();
    assert.ok(dock.y + dock.height <= nav.y + 1, "dock overlaps navigation");
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "标题仿写-手机.png"),
    });
    await page
      .locator(".workflow-candidates article")
      .first()
      .getByRole("button")
      .click();
    await page
      .getByRole("textbox", { name: "最终标题", exact: true })
      .fill("这是一个需要超过二十个字才能完成的测试标题请勿发布");
    assert.ok(
      await page
        .locator(".workflow-mobile-dock")
        .getByRole("button", { name: "确认标题并继续" })
        .isDisabled(),
    );
    await page
      .locator(".workflow-candidates article")
      .first()
      .getByRole("button")
      .click();
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "确认标题并继续" })
      .click();
    await page
      .getByRole("textbox", { name: "最终文案", exact: true })
      .waitFor();
    await page
      .locator(".workflow-candidates article")
      .first()
      .locator("summary")
      .click();
    assert.ok(
      await page.locator(".workflow-candidate-full[open] p").isVisible(),
    );
    await page
      .locator(".workflow-candidates article")
      .first()
      .getByRole("button")
      .click();
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "文案仿写-手机.png"),
    });
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "确认文案并继续" })
      .click();
    await page.getByRole("heading", { name: /图片仿写/ }).waitFor();
    assert.equal(await page.locator('.workflow-media-box[aria-label="参考图片"] .workflow-media-page').count(), 2);
    assert.ok(await page.getByRole("textbox", { name: "生成图片提示词", exact: true }).isVisible());
    const referenceSize = await page.locator('.workflow-media-box[aria-label="参考图片"] img').first().boundingBox();
    assert.ok(referenceSize.height >= 250, "Reference image should remain a large complete preview");
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "图片仿写-手机.png"),
    });
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    await page.getByRole("button", { name: /添加参考素材/ }).click();
    await page
      .getByRole("button", { name: "从素材库选择", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "从素材库选择", exact: true })
      .waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "素材选择-手机.png"),
    });
    await page.getByRole("button", { name: /取\s*消/ }).click();
    await page
      .getByRole("button", { name: "添加参考素材", exact: true })
      .click();
    await page
      .locator('.workflow-add-menu input[type="file"]')
      .setInputFiles({
        name: "local.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page
      .getByRole("region", { name: "参考图片", exact: true })
      .getByText("本地图片", { exact: true })
      .first()
      .waitFor();
    assert.equal(calls.filter((c) => c.upload).length, 1);
    await page
      .locator(".workflow-steps")
      .getByRole("button", { name: /视频仿写/ })
      .click();
    await page.getByText("生成完整脚本", { exact: true }).first().waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "视频仿写-手机.png"),
    });
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "生成完整脚本", exact: true })
      .click();
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "确认完整脚本", exact: true })
      .waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "确认完整脚本", exact: true })
      .click();
    await page
      .locator(".workflow-mobile-dock")
      .getByRole("button", { name: "根据确认脚本生成完整视频", exact: true })
      .waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    await page
      .locator(".workflow-steps")
      .getByRole("button", { name: /发布稿/ })
      .click();
    await page.getByRole("heading", { name: /发布稿/ }).waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 1);
    assert.ok(
      await page
        .locator(".workflow-mobile-dock")
        .getByRole("button", { name: "保存发布稿", exact: true })
        .isDisabled(),
    );
    await page.getByRole("button", { name: "采集库", exact: true }).click();
    await page.locator(".collection-card").waitFor();
    assert.equal(await page.locator(".workflow-mobile-dock").count(), 0);
    await page.screenshot({
      animations: "disabled",
      path: path.join(out, "采集库-手机.png"),
    });
    assert.deepEqual(errors, []);
    const report = {
      status: "PASS",
      checks: [
        "settings and step navigation always visible",
        "large reference carousel and compact generated results",
        "shared tags persist across views",
        "no processing tab",
        "angle stays in title",
        "per-stage preset request",
        "360–1440 responsive",
        "single phone dock",
        "20-character limit",
        "confirm title and copy",
        "expand copy",
        "material picker",
        "local upload",
        "video dock",
        "script confirmation and video action",
        "publish guard",
        "dock cleanup",
      ],
      screenshots: out,
    };
    await fs.writeFile(
      path.join(out, "验证结果.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

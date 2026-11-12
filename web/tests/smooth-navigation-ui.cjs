const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out = path.resolve(
  __dirname,
  "../../data/verification/smooth-navigation",
);
const stamp = "2026-11-05T01:00:00Z";
const note = {
  id: "note",
  revision_id: "rev",
  title: "把日常过成喜欢的样子",
  body: "在熟悉的城市里寻找新的灵感。",
  topics: ["生活记录"],
  tags: [],
  author: "日常手记",
  platform: "xhs",
  kind: "image",
  created_at: stamp,
};
const asset = {
  id: "cover",
  name: "日常的灵感",
  kind: "image",
  source: "upload",
  library_state: "saved",
  status: "ready",
  mime: "image/svg+xml",
  revision_id: "rev",
  width: 600,
  height: 750,
  created_at: stamp,
};
const project = {
  id: "project",
  note_id: "note",
  revision_id: "rev",
  name: "周末的创作",
  platform: "xhs",
  kind: "image",
  sources: [],
  asset_ids: [],
  created_at: stamp,
};
const publication = {
  id: "pub",
  project_id: "project",
  title: note.title,
  body: note.body,
  topics: note.topics,
  asset_ids: [asset.id],
  kind: "image",
  target_platform: "xhs",
  ready: true,
  created_at: stamp,
};
const workflow = {
  id: "project",
  account_profile: { status: "skipped", revision: 1 },
  title: { key: "", text: "" },
  copy: { key: "", body: "", topics: [] },
  image_plan_id: "",
  drafts: {},
};
let failWorkflow = false,
  captureRequests = 0;
let releaseWorkflow,
  workflowRequests = 0,
  projectRequests = 0,
  saves = 0;
const ready = new Promise((resolve) => (releaseWorkflow = resolve));
async function fixture(route) {
  const req = route.request(),
    e = new URL(req.url()).pathname.slice(7);
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
      epoch: "smooth",
      cursor: 1,
      changes: Object.entries({
        projects: [project],
        assets: [asset],
        publications: [publication],
      }).flatMap(([entity, values]) =>
        values.map((value) => ({ entity, id: value.id, value })),
      ),
    };
  else if (e === "/collections") {
    if (req.method() === "POST") {
      captureRequests++;
      body = { items: [] };
    } else if (new URL(req.url()).searchParams.get("deleted") === "true")
      body = { items: [{ ...note, deleted_at: stamp }], total: 1, tags: [] };
    else
      body = {
        items: Array.from({ length: 10 }, (_, i) =>
          i === 0 ? note : { ...note, id: "note-" + i },
        ),
        total: 10,
        tags: [],
      };
  } else if (e === "/publications") body = [publication];
  else if (e === "/rewrites/project") {
    projectRequests++;
    body = {
      project,
      versions: [],
      reference_assets: [asset],
      reference_videos: [],
    };
  } else if (e === "/rewrites/project/workflow") {
    workflowRequests++;
    if (failWorkflow)
      return route.fulfill({
        status: 503,
        json: { error: "流程暂时不可用，请重试" },
      });
    await ready;
    body = {
      workflow,
      reference: {
        id: "rev",
        title: note.title,
        body: note.body,
        topics: note.topics,
      },
      titles: [],
      copies: [],
      angles: [],
      image_plans: [],
    };
  } else if (e.includes("/workflow/drafts/")) {
    const scope = e.split("/").at(-1),
      input = req.postDataJSON();
    saves++;
    body = workflow.drafts[scope] = {
      revision: input.revision + 1,
      data: input.data,
      saved_at: stamp,
    };
  } else if (e.includes("/assets/") && /\/(file|preview)$/.test(e))
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="600" height="750" fill="#dfbfd0"/><circle cx="450" cy="180" r="80" fill="#fff3dd"/><path d="M0 500Q200 320 380 500T700 520V750H0Z" fill="#b899b1"/></svg>',
    });
  await route.fulfill({ json: body });
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
        viewport: { width: 1157, height: 765 },
      }),
      errors = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("rednote.appearance.theme", "rose");
    });
    await page.route(base + "/api/v1/**", fixture);
    await page.goto(base + "/#collections");
    await page.locator(".collection-card").first().waitFor();
    const nav = page.getByRole("navigation", { name: "主导航" }),
      button = page.locator(".capture-start");
    assert(await button.isEnabled());
    assert(await page.locator(".capture-clear").isEnabled());
    await button.click();
    await page.locator(".capture-clear").click();
    await page
      .getByRole("textbox", { name: "笔记链接或分享文字", exact: true })
      .fill("  \n ");
    await button.click();
    assert.equal(captureRequests, 0);
    assert.equal(await page.locator(".ant-message-notice-content").count(), 0);
    const field = page.locator(".workspace-dune-field");
    const motion = await field.evaluate((el) => {
      const animation = el.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const before = new DOMMatrix(getComputedStyle(el).transform).m41;
      animation.currentTime = 6000;
      const after = new DOMMatrix(getComputedStyle(el).transform).m41;
      animation.play();
      return {
        distance: Math.abs(after - before),
        duration: animation.effect.getTiming().duration,
      };
    });
    assert.equal(motion.duration, 12000);
    assert(motion.distance > 25);
    const sceneBox = await page.locator(".workspace-backdrop").boundingBox();
    assert.equal(sceneBox.x, 0);
    assert.equal(sceneBox.width, 1157);
    assert((await page.locator(".workspace-dune-tile").count()) > 2);
    await page.locator(".page-content").evaluate((el) => (el.scrollTop = 500));
    await page.waitForFunction(
      () =>
        new DOMMatrix(
          getComputedStyle(
            document.querySelector(".workspace-scene-scroll"),
          ).transform,
        ).m42 === -500,
    );
    await page.screenshot({
      path: path.join(out, "rose-scrolled-scene.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.locator(".page-content").evaluate((el) => (el.scrollTop = 0));
    await page.waitForFunction(
      () =>
        new DOMMatrix(
          getComputedStyle(
            document.querySelector(".workspace-scene-scroll"),
          ).transform,
        ).m42 === 0,
    );
    assert(
      (
        await page
          .locator(".workspace-crumb")
          .evaluate((el) => getComputedStyle(el).fontFamily)
      ).includes("SimSun"),
    );
    await page
      .getByRole("textbox", { name: "笔记链接或分享文字", exact: true })
      .fill("未提交的灵感");
    await button.hover();
    await page.waitForFunction(() =>
      getComputedStyle(
        document.querySelector(".capture-start"),
      ).backgroundImage.includes("193, 140, 162"),
    );
    assert(
      !(
        await button.evaluate(
          (el) => getComputedStyle(el, "::before").backgroundImage,
        )
      ).includes("116, 190, 160"),
    );
    await page
      .locator(".retained-rewrite-page .creation-workflow")
      .waitFor({ state: "attached" });
    await page.evaluate(() => {
      window.blankFrames = [];
      window.frameMonitor = true;
      window.originalBackdrop = document.querySelector(".workspace-backdrop");
      const frame = () => {
        const page = document.querySelector(".page-content");
        if (page.classList.contains("page-rewrites")) {
          const workflow = page.querySelector(".creation-workflow");
          if (
            !workflow ||
            /正在(加载创作流程|恢复项目|打开仿写工作台)/.test(
              workflow.innerText,
            )
          )
            window.blankFrames.push(performance.now());
        }
        if (window.frameMonitor) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await nav.getByRole("button", { name: "仿写工作台", exact: true }).click();
    assert(
      await page.locator(".page-collections .capture-card").isVisible(),
      "Keep current page while cold workflow is pending",
    );
    await page.waitForTimeout(150);
    releaseWorkflow();
    const requirements = page.getByRole("textbox", {
      name: "标题仿写补充要求",
      exact: true,
    });
    await requirements.waitFor();
    assert(
      (
        await page
          .locator(".creation-workflow > .workflow-panel")
          .first()
          .evaluate((el) => getComputedStyle(el).backdropFilter)
      ).includes("14px"),
    );
    await page.screenshot({
      path: path.join(out, "rose-rewrite-glass.png"),
      fullPage: true,
      animations: "disabled",
    });
    await requirements.fill("返回后保留的创作要求");
    await page.waitForFunction(() =>
      document
        .querySelector(".workflow-save-announcement")
        ?.textContent.includes("已自动保存"),
    );
    await page.evaluate(
      () =>
        (window.originalWorkflow =
          document.querySelector(".creation-workflow")),
    );
    const loaded = { workflowRequests, projectRequests };
    for (let i = 0; i < 3; i++) {
      await nav
        .getByRole("button", { name: "采集工作台", exact: true })
        .click();
      await page.locator(".page-collections .capture-card").waitFor();
      await nav
        .getByRole("button", { name: "仿写工作台", exact: true })
        .click();
      await requirements.waitFor();
      assert.equal(await requirements.inputValue(), "返回后保留的创作要求");
      assert(
        await page.evaluate(
          () =>
            window.originalWorkflow ===
            document.querySelector(".creation-workflow"),
        ),
      );
    }
    assert.equal(workflowRequests, loaded.workflowRequests);
    assert.equal(projectRequests, loaded.projectRequests);
    await page.evaluate(() => (window.frameMonitor = false));
    assert.deepEqual(await page.evaluate(() => window.blankFrames), []);
    assert(
      await page.evaluate(
        () =>
          window.originalBackdrop ===
          document.querySelector(".workspace-backdrop"),
      ),
    );
    const animation = await page
      .locator(".workspace-dune-field")
      .evaluate((el) => getComputedStyle(el).animationName);
    assert.equal(animation, "rose-dunes-drift");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".workspace-dune-field")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await nav.getByRole("button", { name: "发布管理", exact: true }).click();
    await page.locator(".publication-note").waitFor();
    assert(
      (
        await page
          .locator(".page-publications .table-panel")
          .evaluate((el) => getComputedStyle(el).backdropFilter)
      ).includes("14px"),
    );
    await page.screenshot({
      path: path.join(out, "rose-publications.png"),
      fullPage: true,
      animations: "disabled",
    });
    await nav.getByRole("button", { name: "素材库", exact: true }).click();
    await page
      .getByRole("heading", { name: "全部素材", exact: true })
      .waitFor();
    assert(
      (
        await page
          .locator(".page-media .embedded-workspace")
          .evaluate((el) => getComputedStyle(el).backdropFilter)
      ).includes("14px"),
    );
    assert(
      (
        await page
          .locator(".media-library-heading h2")
          .evaluate((el) => getComputedStyle(el).fontFamily)
      ).includes("YouYuan"),
    );
    await page.screenshot({
      path: path.join(out, "rose-media.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.locator(".workflow-mobile-dock").count(),
      0,
      "Inactive retained editor must not show its mobile actions on other pages",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(out, "rose-media-390.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    assert(saves > 0);
    await nav.getByRole("button", { name: "回收站", exact: true }).click();
    await page.locator(".trash-card").first().waitFor();
    assert(
      (
        await page
          .locator(".trash-workspace")
          .evaluate((el) => getComputedStyle(el).backdropFilter)
      ).includes("14px"),
    );
    await page.screenshot({
      path: path.join(out, "rose-trash-glass.png"),
      fullPage: true,
      animations: "disabled",
    });
    failWorkflow = true;
    const failurePage = await browser.newPage();
    await failurePage.route(base + "/api/v1/**", fixture);
    await failurePage.goto(base + "/#collections");
    await failurePage.locator(".capture-card").waitFor();
    await failurePage
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "仿写工作台", exact: true })
      .click();
    await failurePage
      .getByRole("button", { name: "重试加载", exact: true })
      .waitFor();
    assert(
      await failurePage.locator(".page-rewrites").isVisible(),
      "Failed preparation reveals a retryable error instead of holding the previous page",
    );
    failWorkflow = false;
    await failurePage
      .getByRole("button", { name: "重试加载", exact: true })
      .click();
    await failurePage
      .getByRole("textbox", { name: "标题仿写补充要求", exact: true })
      .waitFor();
    await failurePage.close();
    console.log(
      "PASS: no blank transition frames under delayed workflow, retained draft and DOM across repeated navigation, rose hover states, persistent background motion/reduced motion, publication/media glass and rounded heading.",
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

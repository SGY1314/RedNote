const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
  routeAPI,
  projects,
  workflows,
  source,
  jobs,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/rose-workspace");
const prompt =
  "根据账号定位与原始内容生成文案，保持信息准确。\n" +
  JSON.stringify(
    {
      copies: [
        { body: "自然清楚的文案正文", topics: ["日常记录", "创作灵感"] },
      ],
    },
    null,
    2,
  ) +
  "\n" +
  Array(8).fill("保留真实信息，按补充要求调整语气，避免夸张陈述。").join("\n");
const requests = [],
  errors = [];
async function fixture(route) {
  const req = route.request(),
    e = new URL(req.url()).pathname.slice(7);
  if (/^\/rewrites\/[^/]+\/workflow$/.test(e)) {
    const workflow = workflows[e.split("/")[2]];
    return route.fulfill({
      json: {
        workflow,
        basis: { title: workflow.title, copy: workflow.copy },
        reference: source,
        titles: [],
        copies: [],
        image_plans: [],
        angles: [],
        title_system_prompts: { 3: prompt },
        copy_system_prompts: { 3: prompt },
        media_system_prompts: { image: prompt, video: prompt },
      },
    });
  }
  if (e.endsWith("/copies/generate")) {
    assert.equal(req.method(), "POST");
    requests.push(req.postDataJSON());
    jobs.push({
      id: "mock-copy-job",
      kind: "copy_rewrite",
      target: projects[0].id,
      state: "queued",
      stage: "模拟文案生成任务",
      attempts: 1,
      created_at: "2026-11-05T14:00:00Z",
      updated_at: "2026-11-05T14:00:00Z",
    });
    return route.fulfill({ json: { job_id: "mock-copy-job" } });
  }
  return routeAPI(route);
}
function contrast(fg, bg) {
  const luminance = (input) => {
    const channels = input
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width: 1144, height: 751 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() =>
      localStorage.setItem("rednote.appearance.theme", "rose"),
    );
    await context.route("**/api/v1/**", fixture);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/#rewrites");
    const nav = page.getByRole("navigation", { name: "仿写创作步骤" });
    await nav.getByRole("button", { name: /文案仿写/ }).click();
    const copy = page.locator(".copy-rewrite-panel");
    const requirements = page.getByRole("textbox", {
      name: "文案仿写补充要求",
      exact: true,
    });
    await requirements.waitFor();
    const generate = copy.getByRole("button", {
      name: "开始生成",
      exact: true,
    });
    const action = await generate.boundingBox();
    const topbar = await page.locator(".topbar").boundingBox();
    assert(
      action.y >= topbar.y + topbar.height && action.y + action.height <= 751,
      "Generation action should be visible even before scrolling through a long prompt",
    );
    assert(action.height >= 44);
    const selected = await nav
      .locator('[aria-current="step"]')
      .evaluate((el) => ({
        shadow: getComputedStyle(el).boxShadow,
        fg: getComputedStyle(el).color,
        bg: getComputedStyle(el).backgroundColor,
      }));
    assert(selected.shadow.includes("inset"));
    assert(contrast(selected.fg, selected.bg) >= 4.5);
    const system = copy.getByRole("textbox", {
      name: "系统提示词",
      exact: true,
    });
    const systemStyle = await system.evaluate((el) => ({
      fg: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
      font: getComputedStyle(el).fontFamily,
      readonly: el.readOnly,
    }));
    assert(systemStyle.font.includes("Consolas") && systemStyle.readonly);
    assert(contrast(systemStyle.fg, systemStyle.bg) >= 4.5);
    const inputStyle = await requirements.evaluate((el) => ({
      fg: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderColor,
    }));
    assert(contrast(inputStyle.fg, inputStyle.bg) >= 4.5);
    assert(
      contrast("rgb(98, 75, 89)", "rgb(226, 200, 215)") >= 4.5,
      "Project metadata should retain readable contrast on the rose rail",
    );
    await page.screenshot({
      path: path.join(out, "copy-1144.png"),
      fullPage: true,
    });
    await requirements.fill("保留正在编辑的要求，用自然语气讲清楚具体细节。");
    await page.waitForFunction(() =>
      document
        .querySelector(".workflow-save-announcement")
        ?.textContent.includes("已自动保存"),
    );
    const search = page.getByRole("textbox", { name: "搜索项目", exact: true });
    await search.fill("周末");
    const before = await page.locator(".rewrite-main").boundingBox();
    await page.evaluate(() => {
      window.originalPanel = document.querySelector(".copy-rewrite-panel");
    });
    await page
      .getByRole("button", { name: "收起项目列表", exact: true })
      .click();
    await page.locator(".rewrite-full-workspace.is-rail-collapsed").waitFor();
    const after = await page.locator(".rewrite-main").boundingBox();
    assert(after.width - before.width >= 150);
    assert.equal(
      await requirements.inputValue(),
      "保留正在编辑的要求，用自然语气讲清楚具体细节。",
    );
    assert(
      await page.evaluate(
        () =>
          window.originalPanel ===
          document.querySelector(".copy-rewrite-panel"),
      ),
    );
    assert.equal(
      await page
        .getByRole("separator", { name: "调整项目列表宽度", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: path.join(out, "copy-expanded-editor-1144.png"),
      fullPage: true,
    });
    await page.reload();
    await requirements.waitFor();
    assert(
      await page
        .locator(".rewrite-full-workspace")
        .evaluate((el) => el.classList.contains("is-rail-collapsed")),
    );
    assert.equal(
      await requirements.inputValue(),
      "保留正在编辑的要求，用自然语气讲清楚具体细节。",
    );
    await page
      .getByRole("button", { name: "展开项目列表", exact: true })
      .click();
    const separator = page.getByRole("separator", {
      name: "调整项目列表宽度",
      exact: true,
    });
    const railWidth = Number(await separator.getAttribute("aria-valuenow"));
    await separator.press("ArrowRight");
    assert.equal(
      Number(await separator.getAttribute("aria-valuenow")),
      railWidth + 16,
    );
    await separator.press("ArrowLeft");
    for (const width of [823, 547, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await generate.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, `copy-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1144, height: 751 });
    await nav.getByRole("button", { name: /图片仿写/ }).click();
    const image = page.locator(".media-rewrite-image");
    const imageGenerate = image.getByRole("button", {
      name: "开始生成",
      exact: true,
    });
    await image
      .getByRole("checkbox", { name: "参考图片1", exact: true })
      .uncheck();
    await image
      .getByRole("button", { name: "下一张图片", exact: true })
      .click();
    await image
      .getByRole("checkbox", { name: "参考图片2", exact: true })
      .uncheck();
    assert(
      await imageGenerate.isDisabled(),
      "A stronger visual action must still enforce required inputs",
    );
    const imageAction = await imageGenerate.boundingBox();
    assert(imageAction.y + imageAction.height <= 751);
    await page.screenshot({
      path: path.join(out, "image-required-reference.png"),
      fullPage: true,
    });
    await nav.getByRole("button", { name: /文案仿写/ }).click();
    await generate.click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          ".copy-rewrite-panel .title-generate-toolbar button",
        )?.disabled,
    );
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].requirements,
      "保留正在编辑的要求，用自然语气讲清楚具体细节。",
    );
    await page
      .getByRole("button", { name: "收起项目列表", exact: true })
      .click();
    assert.equal(requests.length, 1);
    assert(
      await copy.locator(".title-generate-toolbar button").isDisabled(),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS rose contrast and prompt typography, visible generation controls, stronger selected step, persistent rail collapse/resize, draft retention, responsive layout and mock generation validation.",
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

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
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/copy-letter");
const candidates = [1, 2, 3].map((index) => ({
  body: `第${index}份文案：从磨豆到缓慢注水，记录一杯手冲的日常。`,
  topics: ["手冲日常", `文案${index}`],
}));
const stages = [],
  errors = [];
async function fixture(route) {
  const req = route.request(),
    endpoint = new URL(req.url()).pathname.slice(7);
  if (/^\/rewrites\/[^/]+\/workflow$/.test(endpoint)) {
    const workflow = workflows[endpoint.split("/")[2]];
    return route.fulfill({
      json: {
        workflow,
        basis: { title: workflow.title, copy: workflow.copy },
        reference: source,
        titles: [],
        copies: [
          {
            id: "copy-letter-batch",
            title_key: workflow.title.key,
            copies: candidates,
            model: "模拟文案模型",
            created_at: "2026-11-05T14:00:00Z",
          },
        ],
        image_plans: [],
        angles: [],
        copy_system_prompts: { 3: "保留真实信息，写出自然清楚的文案。" },
      },
    });
  }
  if (endpoint.endsWith("/workflow/stage")) {
    const data = req.postDataJSON();
    assert.equal(data.step, "copy");
    stages.push(data);
    const workflow = workflows[endpoint.split("/")[2]];
    workflow.copy = {
      ...workflow.copy,
      body: data.text,
      topics: data.topics,
      generation_id: data.generation_id,
    };
  }
  return routeAPI(route);
}
async function saved(page) {
  await page.waitForFunction(() =>
    document
      .querySelector(".workflow-save-announcement")
      ?.textContent.includes("已自动保存"),
  );
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#rewrites");
    await page
      .getByRole("navigation", { name: "仿写创作步骤" })
      .getByRole("button", { name: "文案仿写", exact: true })
      .click();
    const panel = page.locator(".copy-rewrite-panel"),
      letter = panel.locator(".copy-letter-panel");
    const choose = panel.getByRole("button", {
      name: "选用当前文案",
      exact: true,
    });
    const view = (index) =>
      panel.getByRole("button", {
        name: index < 0 ? "查看原始文案" : `查看文案${index + 1}`,
        exact: true,
      });
    const open = () =>
      panel.getByRole("button", { name: "打开文案信笺", exact: true }).click();
    const text = panel.getByRole("textbox", { name: "最终文案", exact: true });
    const draft = () => workflows[projects[0].id].drafts.copy?.data;
    const confirm = async () => {
      const count = stages.length;
      await panel
        .locator(".workflow-next")
        .getByRole("button", { name: /确\s*认$/ })
        .click();
      await page.waitForFunction(
        () => !document.querySelector(".copy-letter-choice")?.disabled,
      );
      assert.equal(stages.length, count + 1);
    };
    assert.equal(await panel.locator(".workflow-history").count(), 0);
    assert.equal(await choose.getAttribute("aria-pressed"), "true");
    assert(await panel.locator(".copy-envelope-puppy").isVisible());
    assert.equal(
      await letter
        .locator(".copy-letter-workspace")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(251, 240, 245)",
    );
    const toolbar = panel.locator(".title-generate-toolbar");
    assert.equal(
      await toolbar.evaluate(
        (el) => getComputedStyle(el).borderBottomLeftRadius,
      ),
      "12px",
    );
    const box = await toolbar.boundingBox();
    assert(Math.abs(box.y + box.height - 751) < 1);
    await view(0).click();
    assert.equal(await choose.getAttribute("aria-pressed"), "false");
    assert.equal(
      draft()?.generation_id,
      undefined,
      "Browsing should not select a copy",
    );
    await choose.click();
    await saved(page);
    assert.equal(draft().candidate_index, 0);
    await view(1).click();
    await open();
    await text.fill("编辑后的第二份文案，浏览和编辑不会替换已选用的一份。");
    await saved(page);
    assert.equal(draft().text, candidates[0].body);
    assert.equal(draft().candidate_index, 0);
    assert.equal(
      draft().candidate_copies["copy-letter-batch"][1].body,
      await text.inputValue(),
    );
    await confirm();
    assert.equal(
      stages.at(-1).text,
      candidates[0].body,
      "Confirmation must use the selected copy rather than the viewed one",
    );
    await choose.click();
    await saved(page);
    assert.equal(draft().candidate_index, 1);
    assert.equal(await letter.locator(".copy-letter-chosen-mark").count(), 1);
    await page.reload();
    await choose.waitFor();
    assert.equal(await view(1).getAttribute("aria-pressed"), "true");
    assert.equal(await choose.getAttribute("aria-pressed"), "true");
    await letter.scrollIntoViewIfNeeded();
    await letter.screenshot({ path: path.join(out, "rose-closed-1144.png") });
    await open();
    assert((await text.inputValue()).includes("编辑后的第二份文案"));
    await letter.screenshot({ path: path.join(out, "rose-open-1144.png") });
    await view(-1).click();
    await open();
    await text.fill("自行编辑原始文案，采集记录继续保留。");
    await saved(page);
    assert.equal(draft().candidate_index, 1);
    await choose.click();
    await saved(page);
    await confirm();
    assert.equal(stages.at(-1).text, "自行编辑原始文案，采集记录继续保留。");
    assert.equal(stages.at(-1).generation_id, "");
    assert.equal(source.body, "先磨豆，再缓慢注水。记录真实生活中的咖啡香气。");
    await page.setViewportSize({ width: 390, height: 844 });
    await letter.scrollIntoViewIfNeeded();
    await letter.screenshot({ path: path.join(out, "rose-closed-390.png") });
    assert(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    for (const theme of ["forest", "pixel"]) {
      const next = await browser.newContext({
        viewport: { width: 1144, height: 751 },
        reducedMotion: "reduce",
      });
      await next.addInitScript(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await next.route("**/api/v1/**", fixture);
      const other = await next.newPage();
      await other.goto(base + "/#rewrites");
      await other
        .getByRole("navigation", { name: "仿写创作步骤" })
        .getByRole("button", { name: "文案仿写", exact: true })
        .click();
      assert(!(await other.locator(".copy-envelope-puppy").isVisible()));
      await other
        .locator(".copy-letter-panel")
        .screenshot({ path: path.join(out, theme + "-closed.png") });
      await next.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS rose envelope and dog, rounded flush toolbar, single explicit choice, independent viewing/editing, saved selection, selected confirmation, preserved source and other themes. All requests mocked.",
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

const {
  chromium,
  fs,
  path,
  assert,
  routeAPI,
  assets,
  jobs,
  workflows,
  publications,
  stamp,
} = require("./direct-media-fixture.cjs");
(async () => {
  for (let i = 1; i <= 5; i++)
    assets.push({
      id: "generated-" + i,
      name: "生成图" + i,
      source: "generated",
      kind: "image",
      status: "ready",
      project_id: "media-project",
      created_at: stamp,
    });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  let confirms = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: 1124, height: 884 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname.slice(7);
      if (p === "/profile/default") return route.fulfill({ json: {} });
      if (p.endsWith("/workflow/stage")) {
        const data = req.postDataJSON(),
          w = workflows[p.split("/")[2]];
        if (data.step === "title") w.title = { ...w.title, text: data.text };
        if (data.step === "copy")
          w.copy = { ...w.copy, body: data.text, topics: data.topics };
        if (["title", "copy"].includes(data.step)) {
          for (const scope of ["title", "copy", "image", "video-script"]) {
            const d = w.drafts[scope];
            d.data.reference_input = {
              ...d.data.reference_input,
              ...(data.step === "title"
                ? { title: data.text }
                : { body: data.text, topics: data.topics }),
            };
            d.revision++;
          }
        }
        return routeAPI(route);
      }
      if (p === "/publications/confirm") {
        confirms++;
        for (const input of req.postDataJSON().items) {
          assert(input.prepared_version_id);
          const pub = { id:input.id, ...input.edit, version_id:input.prepared_version_id, target_platform:input.target_platform, ready:true, confirmed_at:stamp };
          publications.push(pub);
        }
        return route.fulfill({ json: {} });
      }
      return routeAPI(route);
    });
    await page.goto("http://127.0.0.1:8081/#rewrites");
    const nav = page.getByRole("navigation", {
      name: "仿写创作步骤",
      exact: true,
    });
    await nav.waitFor();
    await nav.getByRole("button", { name: "标题仿写", exact: true }).click();
    let panel = page.locator(".title-rewrite-panel:not(.copy-rewrite-panel)");
    await panel
      .getByRole("textbox", { name: "自定义标题", exact: true })
      .fill("确认后的新标题");
    await panel
      .getByRole("button", { name: /确认/, exact: false })
      .last()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="参考标题"]')?.value ===
        "确认后的新标题",
    );
    await nav.getByRole("button", { name: "文案仿写", exact: true }).click();
    panel = page.locator(".copy-rewrite-panel");
    assert.equal(
      await panel
        .getByRole("textbox", { name: "参考标题", exact: true })
        .inputValue(),
      "确认后的新标题",
    );
    if(await panel.getByRole("button",{name:"打开文案信笺",exact:true}).isVisible()) await panel.getByRole("button",{name:"打开文案信笺",exact:true}).click();
    await panel
      .getByRole("textbox", { name: "最终文案", exact: true })
      .fill("确认后的新文案内容");
    await panel.getByRole("button", { name: /确认/ }).last().click();
    await page.waitForFunction(
      () =>
        document.querySelector('textarea[aria-label="参考文案"]')?.value ===
        "确认后的新文案内容",
    );
    await nav.getByRole("button", { name: "图片仿写", exact: true }).click();
    panel = page.locator(".media-rewrite-image");
    assert.equal(
      await panel
        .getByRole("textbox", { name: "参考文案", exact: true })
        .inputValue(),
      "确认后的新文案内容",
    );
    const region = page.getByRole("region", {
      name: "图片生成时间线",
      exact: true,
    });
    assert.equal(await region.getByText(/原始图片/).count(), 0);
    assert.equal(
      await region.locator('[data-result-id^="generated-"]').count(),
      5,
    );
    const track = region.locator(".image-timeline-track");
    assert(await track.evaluate((el) => el.scrollWidth > el.clientWidth));
    await region
      .getByRole("button", { name: "下一组图片", exact: true })
      .click();
    await page.waitForTimeout(400);
    assert(await track.evaluate((el) => el.scrollLeft > 0));
    await track.evaluate((el) => (el.scrollLeft = 0));
    await region
      .getByRole("checkbox", { name: "选用生成图1", exact: true })
      .check();
    await panel.getByRole("button", { name: /发布/ }).last().click();
    let dialog = page.getByRole("dialog", { name: "确认发布稿", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "暂不确认", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(confirms, 0);
    assert.equal(publications.length,0);
    assert(page.url().endsWith("#rewrites"));
    await panel.waitFor();
    await panel.getByRole("button", { name: /发布/ }).last().click();
    dialog = page.getByRole("dialog", { name: "确认发布稿", exact: true });
    await dialog
      .getByRole("button", { name: "确认，加入发布管理", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(confirms, 1);
    assert(publications.some((p) => p.ready));
    assert(page.url().endsWith("#rewrites"));
    await panel.waitFor();
    const out = path.resolve(
      __dirname,
      "../../data/verification/confirmation-followup",
    );
    await fs.mkdir(out, { recursive: true });
    await page.screenshot({
      path: path.join(out, "image-results.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Confirmed references, horizontal results without originals, cancel stays on rewrite, confirm sets pending publication: passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

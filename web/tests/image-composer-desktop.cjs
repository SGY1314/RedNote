const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
  stamp,
  projects,
  workflows,
  assets,
  jobs,
  versions,
  publications,
  requests,
  complete,
  choose,
  routeAPI,
} = require("./direct-media-fixture.cjs");
async function chooseSetting(page, panel, name, value) {
  await panel
    .getByRole("button", { name: new RegExp("^" + name + "：") })
    .click();
  await choose(
    page,
    page.getByRole("region", { name: name + "设置", exact: true }),
    name,
    value,
  );
  await page.keyboard.press("Escape");
}
const out = path.resolve(__dirname, "../../data/verification/image-composer");
const errors = [],
  checks = [];
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(predicate(), "Mock state did not settle");
};
assets
  .slice(0, 2)
  .forEach((asset) =>
    Object.assign(asset, { width: 480, height: 640, size: 250000 }),
  );
assets[1].library_state = "collected";
let uploads = 0;
async function fixture(route) {
  const request = route.request(),
    endpoint = new URL(request.url()).pathname.slice(7);
  if (endpoint === "/assets" && request.method() === "POST") {
    assert(
      request.postDataBuffer().includes(Buffer.from("media-project")),
      "Reference upload belongs to its project",
    );
    const asset = {
      id: "uploaded-reference-" + ++uploads,
      name: "新参考图" + uploads,
      original_name: "reference.png",
      kind: "image",
      source: "upload",
      status: "ready",
      project_id: "media-project",
      library_state: "saved",
      width: uploads === 1 ? 1800 : 600,
      height: uploads === 1 ? 600 : 1200,
      size: 5000,
      created_at: stamp,
    };
    assets.push(asset);
    return route.fulfill({ json: asset });
  }
  if (endpoint.startsWith("/assets/") && endpoint.endsWith("/file")) {
    const asset = assets.find((item) => item.id === endpoint.split("/")[2]);
    if (asset?.kind === "image") {
      const width = asset.width || 480,
        height = asset.height || 640;
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eee0e8"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.32}" fill="#b9829b"/><path d="M0 ${height / 2}H${width}M${width / 2} 0V${height}" stroke="#654253" stroke-width="3"/></svg>`,
      });
    }
  }
  return routeAPI(route);
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    ...browserLaunchOptions,
    args: ["--no-proxy-server"],
  });
  let currentPage;
  try {
    for (const theme of ["forest", "pixel", "rose"]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("rednote.appearance.theme", theme);
        localStorage.setItem("rednote.rewrite.rail-collapsed", "true");
      }, theme);
      await context.route("**/api/v1/**", fixture);
      const page = (currentPage = await context.newPage());
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(15000);
      await page.goto(base + "/#rewrites");
      const nav = page.getByRole("navigation", {
        name: "仿写创作步骤",
        exact: true,
      });
      await nav.getByRole("button", { name: /图片仿写/ }).click();
      const image = page.locator(".media-rewrite-image");
      await image.waitFor();
      for (const width of [1036, 1280, 1600]) {
        await page.setViewportSize({
          width,
          height: width === 1036 ? 763 : 900,
        });
        await page
          .locator(".rewrite-main")
          .evaluate((el) => (el.scrollTop = 0));
        await page.waitForTimeout(180);
        assert(
          await image.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `${theme} ${width} editor overflow`,
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        const reference = await image
          .locator(".image-reference-panel")
          .boundingBox();
        const config = await image
          .locator(".image-configuration-panel")
          .boundingBox();
        assert(
          Math.abs(reference.y - config.y) < 2,
          `${theme} ${width} side by side`,
        );
        assert(config.x >= reference.x + reference.width + 12);
        assert.equal(
          await image
            .locator(".image-advanced-settings, .image-reference-info")
            .count(),
          0,
        );
        assert.equal(
          await image.locator(".generation-option-button").count(),
          4,
        );
        assert.equal(
          await image
            .getByRole("button", { name: "上传图片", exact: true })
            .count(),
          0,
        );
        await page.screenshot({
          path: path.join(out, `${theme}-${width}.png`),
        });
      }
      checks.push(theme + ": 1036/1280/1600 desktop columns, theme, overflow");
      if (theme !== "rose") {
        await context.close();
        continue;
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await image
        .getByRole("button", { name: "查看参考图片2", exact: true })
        .click();
      assert.equal(
        (
          await image.getByLabel("素材序号", { exact: true }).innerText()
        ).trim(),
        "2 / 2",
      );
      await image
        .getByRole("checkbox", { name: "参考图片2", exact: true })
        .uncheck();
      await image
        .getByRole("button", { name: "查看参考图片1", exact: true })
        .click();
      assert(
        await image
          .getByRole("checkbox", { name: "参考图片1", exact: true })
          .isChecked(),
      );
      assert.equal(await image.locator(".image-thumbnail-selected").count(), 1);
      assert.equal(await image.locator(".image-reference-actions").count(), 0);
      await image
        .getByRole("button", { name: "查看参考图片2", exact: true })
        .click();
      await image
        .getByRole("checkbox", { name: "参考图片2", exact: true })
        .check();
      assert.equal(await image.locator(".image-thumbnail-selected").count(), 2);
      checks.push(
        "removed reference action groups; thumbnail preview and independent selection retained",
      );

      const file = {
        name: "reference.png",
        mimeType: "image/png",
        buffer: Buffer.from("mock-image-only"),
      };
      for (let index = 1; index <= 2; index++) {
        await image
          .locator('.image-timeline-dropzone input[type="file"]')
          .setInputFiles(file);
        await image
          .locator(`[data-upload-id="uploaded-reference-${index}"]`)
          .waitFor();
        await waitFor(() => uploads === index);
      }
      assert.equal(await image.locator(".image-thumbnail-selected").count(), 2);
      checks.push(
        "result uploads retained and do not alter reference selection",
      );
      for (const width of [1024, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        const timeline = image.getByRole("region", {
          name: "图片生成时间线",
          exact: true,
        });
        await timeline.scrollIntoViewIfNeeded();
        for (const asset of assets.filter((item) =>
          item.id.startsWith("uploaded-reference-"),
        )) {
          const card = timeline.locator(`[data-upload-id="${asset.id}"]`);
          const preview = card.locator(".media-output-preview");
          const frame = await preview.boundingBox();
          assert(
            Math.abs(frame.width / frame.height - asset.width / asset.height) <
              0.01,
            "Upload preview retains the native ratio",
          );
          assert.equal(
            await preview
              .locator("img")
              .evaluate((el) => getComputedStyle(el).objectFit),
            "contain",
          );
        }
        assert(
          await timeline.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
      }
      await page.setViewportSize({ width: 1036, height: 900 });
      await page
        .getByRole("button", { name: "展开项目列表", exact: true })
        .click();
      const narrowTimeline = image.getByRole("region", {
        name: "图片生成时间线",
        exact: true,
      });
      await narrowTimeline.scrollIntoViewIfNeeded();
      const narrowEntry = narrowTimeline
        .locator(".image-timeline-entry")
        .nth(1);
      assert.equal(
        await narrowEntry.evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
        1,
        "Narrow editor uses a single-column timeline",
      );
      assert(
        (
          await narrowTimeline
            .locator(".image-timeline-dropzone .ant-upload-drag")
            .boundingBox()
        ).height <= 181,
        "Empty upload stays compact",
      );
      await narrowTimeline
        .locator('[data-upload-id="uploaded-reference-1"]')
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, "rose-adaptive-timeline-1036.png"),
      });
      await page
        .getByRole("button", { name: "收起项目列表", exact: true })
        .click();
      await page.setViewportSize({ width: 1280, height: 900 });
      await narrowTimeline
        .locator('[data-upload-id="uploaded-reference-1"]')
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, "rose-adaptive-timeline-1280.png"),
      });
      checks.push(
        "landscape and portrait upload ratios at 1024/1280/1600; single-column timeline with expanded desktop project rail",
      );

      await image
        .getByRole("textbox", { name: "图片仿写补充要求", exact: true })
        .fill("保留主体，使用柔和光线与复古纸张质感。");
      assert.equal(
        await image
          .getByRole("textbox", { name: "图片系统提示词", exact: true })
          .getAttribute("readonly"),
        "",
      );
      await chooseSetting(page, image, "图片生成模型", "图片模型二");
      await chooseSetting(page, image, "图片画质", "4K");
      await chooseSetting(page, image, "图片生成数量", "2 张");
      await chooseSetting(page, image, "图片长宽比", "16:9");
      const generate = image.locator(".generation-composer-submit");
      await generate.scrollIntoViewIfNeeded();
      const dock = await image
        .locator(".generation-composer-pill")
        .boundingBox();
      const scroller = await page.locator(".rewrite-main").boundingBox();
      assert(
        dock.y + dock.height <= scroller.y + scroller.height + 2,
        "Generation action stays inside the editor viewport",
      );
      await page.screenshot({
        path: path.join(out, "rose-icon-settings-and-action.png"),
      });
      await generate.click();
      await waitFor(() => requests.length === 1);
      assert.equal(requests[0].model_id, "image-alt");
      assert.equal(requests[0].quality, "4k");
      assert.equal(requests[0].ratio, "16:9");
      assert.equal(requests[0].count, 2);
      assert.equal(
        requests[0].requirements,
        "保留主体，使用柔和光线与复古纸张质感。",
      );
      assert.deepEqual(requests[0].reference_asset_ids, [
        "source-1",
        "source-2",
      ]);
      assert(await generate.isDisabled());
      await page.reload();
      await image.waitFor();
      assert(await generate.isDisabled());
      assert.equal(requests.length, 1);
      complete(jobs[0]);
      await image
        .getByRole("checkbox", { name: "选用成图1", exact: true })
        .waitFor();
      assert(
        !(await image
          .getByRole("checkbox", { name: "选用成图1", exact: true })
          .isChecked()),
      );
      await image
        .getByRole("checkbox", { name: "选用成图1", exact: true })
        .check();
      await image
        .getByRole("button", { name: /确\s*认$/, exact: true })
        .click();
      await waitFor(() => versions.length === 1);
      assert.deepEqual(versions[0].media.asset_ids, [jobs[0].result]);
      await image
        .getByRole("button", { name: /发\s*布$/, exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "确认发布稿", exact: true })
        .waitFor();
      assert.equal(publications.length, 1);
      await page
        .getByRole("dialog", { name: "确认发布稿", exact: true })
        .getByRole("button", { name: "暂不确认", exact: true })
        .click();
      checks.push(
        "generation payload, task recovery without resubmit, manual result selection, confirm and draft publication",
      );

      await page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("button", { name: "仿写工作台", exact: true })
        .click();
      await nav.getByRole("button", { name: /视频仿写/ }).click();
      const video = page.locator(".media-rewrite-video");
      await video
        .getByRole("textbox", { name: "视频脚本", exact: true })
        .waitFor();
      assert.equal(
        await video
          .locator(".generation-composer .generation-option-button")
          .count(),
        6,
      );
      await chooseSetting(page, video, "视频生成模型", "视频模型");
      await video.getByRole("button", { name: /^视频声音：/ }).click();
      assert(
        await page
          .getByRole("region", { name: "视频声音设置", exact: true })
          .getByRole("switch", { name: "视频声音", exact: true })
          .count(),
      );
      await page.keyboard.press("Escape");
      assert.equal(await video.locator(".image-composer").count(), 0);
      checks.push(
        "video editor and its script, model, duration/audio controls retained",
      );

      const originalID = "original-project";
      projects.push({
        ...projects[0],
        id: originalID,
        name: "自主创作布局验证",
        note_id: undefined,
      });
      workflows[originalID] = {
        ...structuredClone(workflows[projects[0].id]),
        id: originalID,
        drafts: {
          source: {
            revision: 1,
            data: {
              title: "自主标题",
              body: "自主文案",
              topics: ["自主话题"],
              asset_ids: ["source-video"],
            },
          },
        },
        stage_versions: {},
      };
      await page
        .getByRole("button", { name: "展开项目列表", exact: true })
        .click();
      await page
        .locator(".project-title-button")
        .filter({ hasText: "自主创作布局验证" })
        .click();
      await nav.getByRole("button", { name: /图片仿写/ }).click();
      await image.locator(".image-reference-empty").waitFor();
      assert(
        await image
          .getByRole("button", { name: "开始生成", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await image
          .getByRole("textbox", { name: "创作标题", exact: true })
          .inputValue(),
        "自主标题",
      );
      await image
        .getByRole("textbox", { name: "创作标题", exact: true })
        .fill("保留自主标题编辑");
      await image
        .getByRole("textbox", { name: "创作文案", exact: true })
        .fill("保留自主文案编辑");
      assert(
        await image
          .getByRole("combobox", { name: "创作话题", exact: true })
          .count(),
      );
      await image.locator(".image-reference-empty").click({ trial: true });
      await waitFor(
        () =>
          workflows[originalID].drafts.source.data.title ===
            "保留自主标题编辑" &&
          workflows[originalID].drafts.source.data.body === "保留自主文案编辑",
      );
      assert.deepEqual(workflows[originalID].drafts.source.data.asset_ids, [
        "source-video",
      ]);
      assert.equal(
        workflows[originalID].drafts.source.data.title,
        "保留自主标题编辑",
      );
      assert.equal(
        workflows[originalID].drafts.source.data.body,
        "保留自主文案编辑",
      );
      await page.reload();
      await image.locator(".image-reference-empty").waitFor();
      assert.equal(
        await image
          .getByRole("textbox", { name: "创作标题", exact: true })
          .inputValue(),
        "保留自主标题编辑",
      );
      checks.push(
        "empty-reference original creation, editable title/body/topics and saved draft recovery preserving videos",
      );
      await page.screenshot({
        path: path.join(out, "rose-original-project.png"),
      });
      await page.setViewportSize({ width: 1036, height: 900 });
      await page
        .getByRole("button", { name: "展开项目列表", exact: true })
        .click();
      const narrowReference = await image
        .locator(".image-reference-panel")
        .boundingBox();
      const narrowConfig = await image
        .locator(".image-configuration-panel")
        .boundingBox();
      assert(
        narrowConfig.y > narrowReference.y + narrowReference.height,
        "Expanded rail uses a stacked editor when necessary",
      );
      assert(
        await image.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      checks.push(
        "1036px desktop with expanded project list: stacked layout without overflow",
      );
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "verification.json"),
      JSON.stringify(
        { status: "PASS", mockAPI: true, desktopOnly: true, checks, errors },
        null,
        2,
      ),
    );
    console.log(
      "PASS image composer desktop layout and workflow: " + checks.join("; "),
    );
  } catch (error) {
    await currentPage
      ?.screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

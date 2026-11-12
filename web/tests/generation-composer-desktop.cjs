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
  jobs,
  requests,
  scriptRequests,
  complete,
  choose,
  routeAPI,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(
  __dirname,
  "../../data/verification/generation-composer",
);
const textRequests = [],
  titles = [],
  copies = [];
const errors = [],
  checks = [];
async function fixture(route) {
  const req = route.request(),
    endpoint = new URL(req.url()).pathname.slice(7);
  if (/\/(titles|copies)\/generate$/.test(endpoint)) {
    const data = req.postDataJSON(),
      title = endpoint.endsWith("/titles/generate");
    textRequests.push({ kind: title ? "title" : "copy", ...data });
    const id = "text-job-" + textRequests.length;
    const items = Array.from({ length: data.count }, (_, index) =>
      title
        ? `清晨手冲灵感${index + 1}`
        : {
            body: `第${index + 1}份生活笔记，记录磨豆到注水。`,
            topics: ["手冲"],
          },
    );
    const entry = {
      id,
      count: data.count,
      model: "文字模型二",
      requirements: data.requirements,
      created_at: stamp,
    };
    if (title) titles.unshift({ ...entry, titles: items });
    else
      copies.unshift({
        ...entry,
        title_key: workflows[projects[0].id].title.key,
        copies: items,
      });
    jobs.push({
      id,
      target: projects[0].id,
      kind: title ? "title_rewrite" : "copy_rewrite",
      state: "succeeded",
      stage: "已完成",
      result: id,
      created_at: stamp,
      updated_at: stamp,
    });
    return route.fulfill({ json: { job_id: id } });
  }
  if (endpoint.endsWith("/workflow")) {
    const w = workflows[endpoint.split("/")[2]];
    return route.fulfill({
      json: {
        workflow: w,
        basis: { title: w.title, copy: w.copy },
        reference: {
          id: "r-media",
          title: "一杯咖啡的清晨",
          body: "记录磨豆与注水的过程。",
          topics: ["手冲"],
        },
        titles,
        copies,
        image_plans: [],
        angles: [],
        title_system_prompts: Object.fromEntries(
          [1, 3, 5].map((count) => [count, `生成${count}个自然标题。`]),
        ),
        copy_system_prompts: Object.fromEntries(
          [1, 2, 3, 4, 5].map((count) => [count, `生成${count}份完整文案。`]),
        ),
        media_system_prompts: {
          image: "参考原图创作新图。",
          video: "根据脚本和补充要求生成视频。",
        },
      },
    });
  }
  if (/^\/(title|copy|video-script)-models$/.test(endpoint))
    return route.fulfill({
      json: [
        { id: "text", name: "文字模型一", model: "fixture", configured: true },
        {
          id: "text-alt",
          name: "文字模型二",
          model: "fixture-alt",
          configured: true,
        },
      ],
    });
  return routeAPI(route);
}
async function selectOption(page, panel, name, value) {
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
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    ...browserLaunchOptions,
    args: ["--no-proxy-server"],
  });
  let page;
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
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "/#rewrites");
      const nav = page.getByRole("navigation", {
        name: "仿写创作步骤",
        exact: true,
      });
      for (const [label, selector, count] of [
        ["标题仿写", ".title-rewrite-panel:not(.copy-rewrite-panel)", 2],
        ["文案仿写", ".copy-rewrite-panel", 2],
        ["视频仿写", ".media-rewrite-video", 6],
      ]) {
        await nav.getByRole("button", { name: new RegExp(label) }).click();
        const panel = page.locator(selector),
          composer = panel.locator(".generation-composer");
        await composer.waitFor();
        if (label === "视频仿写") {
          assert.equal(
            await panel.locator(".original-material-actions").count(),
            0,
          );
          const sound = panel.getByRole("button", { name: /^视频声音：/ });
          await sound.click();
          const popup = page.getByRole("region", {
            name: "视频声音设置",
            exact: true,
          });
          const bounds = await popup.boundingBox();
          assert(
            bounds.width <= 180 && bounds.height <= 30,
            "Sound setting has no unused space",
          );
          const heading = await popup.locator("h4").boundingBox();
          const toggle = popup.getByRole("switch", {
            name: "视频声音",
            exact: true,
          });
          const toggleBounds = await toggle.boundingBox();
          assert(
            Math.abs(heading.y - toggleBounds.y) < 5,
            "Label and switch share one row",
          );
          assert.equal(
            await sound.locator(".generation-sound-particles i").count(),
            4,
          );
          await page.emulateMedia({ reducedMotion: "no-preference" });
          const particle = sound
            .locator(".generation-sound-particles i")
            .first();
          assert.equal(
            await particle.evaluate((el) => getComputedStyle(el).animationName),
            "generation-sound-rush",
          );
          const first = await particle.evaluate(
            (el) => getComputedStyle(el).transform,
          );
          await page.waitForTimeout(140);
          assert.notEqual(
            await particle.evaluate((el) => getComputedStyle(el).transform),
            first,
            "Sound particles move while enabled",
          );
          await toggle.click();
          assert.equal(
            await sound.locator(".generation-sound-particles").count(),
            0,
          );
          assert.equal(await toggle.getAttribute("aria-checked"), "false");
          await toggle.click();
          assert.equal(
            await sound.locator(".generation-sound-particles").count(),
            1,
          );
          await page.screenshot({
            path: path.join(out, `${theme}-sound-compact.png`),
          });
          await page.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(
            await sound
              .locator(".generation-sound-particles")
              .evaluate((el) => getComputedStyle(el).display),
            "none",
          );
          await page.keyboard.press("Escape");
          checks.push(
            theme +
              ": compact inline sound setting, enabled/disabled particles and reduced motion",
          );
        }
        assert.equal(
          await composer.locator(".generation-option-button").count(),
          count,
        );
        for (const width of [1024, 1280]) {
          await page.setViewportSize({
            width,
            height: width === 1024 ? 751 : 900,
          });
          await composer.scrollIntoViewIfNeeded();
          assert(
            await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          );
          assert(
            await composer.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 1,
            ),
          );
          const radius = await composer
            .locator(".generation-composer-pill")
            .evaluate((el) =>
              parseFloat(getComputedStyle(el).borderBottomLeftRadius),
            );
          assert(radius >= 24, "All corners are rounded");
          assert.equal(
            await panel
              .locator(
                ".title-generate-toolbar, .media-property-grid, .media-generate-row",
              )
              .count(),
            0,
          );
          await page.screenshot({
            path: path.join(out, `${theme}-${label}-${width}.png`),
          });
        }
      }
      checks.push(
        theme +
          ": desktop 1024/1280 title, copy, video rounded input and icon controls",
      );
      if (theme !== "rose") {
        await context.close();
        continue;
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      for (const [label, selector, modelName, countName, value, scope] of [
        [
          "标题仿写",
          ".title-rewrite-panel:not(.copy-rewrite-panel)",
          "标题仿写模型",
          "标题生成数量",
          "5 个",
          "title",
        ],
        [
          "文案仿写",
          ".copy-rewrite-panel",
          "文案仿写模型",
          "文案生成份数",
          "2 份",
          "copy",
        ],
      ]) {
        await nav.getByRole("button", { name: new RegExp(label) }).click();
        const panel = page.locator(selector);
        const input = panel.getByRole("textbox", {
          name: label + "补充要求",
          exact: true,
        });
        await input.fill(
          "保留真实的生活场景和细节，保持自然语气。".repeat(300).slice(0, 4000),
        );
        assert.equal((await input.inputValue()).length, 4000);
        assert(
          (await input.boundingBox()).height < 160,
          "Long requirements scroll inside the input",
        );
        assert(
          await panel
            .locator(".generation-composer")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
        await panel
          .locator(".generation-composer")
          .screenshot({ path: path.join(out, scope + "-long-input.png") });
        await input.fill("保留自然语气，加入具体的生活细节。\n不要夸张措辞。");
        await panel
          .getByRole("button", { name: new RegExp("^" + modelName + "：") })
          .focus();
        await page.keyboard.press("Enter");
        await page
          .getByRole("region", { name: modelName + "设置", exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        await selectOption(page, panel, modelName, "文字模型二");
        await selectOption(page, panel, countName, value);
        assert.equal(
          await panel
            .getByRole("textbox", { name: "系统提示词", exact: true })
            .getAttribute("readonly"),
          "",
        );
        await panel
          .getByRole("button", { name: "开始生成", exact: true })
          .click();
        await panel
          .getByRole("button", { name: "开始生成", exact: true })
          .waitFor({ state: "visible" });
        await page.waitForFunction(
          (scope) =>
            document.querySelector(
              scope === "title"
                ? '[aria-label="编辑标题1"]'
                : '[aria-label="查看文案1"]',
            ),
          scope,
        );
        const payload = textRequests.at(-1);
        assert.equal(payload.kind, scope);
        assert.equal(payload.model_id, "text-alt");
        assert.equal(payload.count, scope === "title" ? 5 : 2);
        assert(payload.requirements.includes("生活细节"));
        await page.reload();
        await input.waitFor();
        assert((await input.inputValue()).includes("生活细节"));
        assert.equal(
          textRequests.length,
          scope === "title" ? 1 : 2,
          "Refreshing does not repeat generation",
        );
        checks.push(
          scope +
            ": 4000-character input, keyboard settings, icon model/count choices, requirements payload, generated candidates and draft restore",
        );
      }
      await nav.getByRole("button", { name: /视频仿写/ }).click();
      const video = page.locator(".media-rewrite-video");
      await video
        .getByRole("textbox", { name: "视频脚本", exact: true })
        .fill("0–12秒：磨豆、注水，再展示成品。");
      await selectOption(page, video, "脚本模型", "文字模型二");
      await selectOption(page, video, "视频生成数量", "2 条");
      await selectOption(page, video, "视频画质", "1080P");
      await selectOption(page, video, "视频长宽比", "16:9");
      await video.getByRole("button", { name: /^视频时长：/ }).click();
      await page
        .getByRole("region", { name: "视频时长设置", exact: true })
        .getByRole("spinbutton", { name: "视频时长", exact: true })
        .fill("12");
      await page.keyboard.press("Escape");
      await video.getByRole("button", { name: /^视频声音：/ }).click();
      await page
        .getByRole("region", { name: "视频声音设置", exact: true })
        .getByRole("switch", { name: "视频声音", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await video
        .getByRole("textbox", { name: "视频仿写补充要求", exact: true })
        .fill("自然光，动作连贯。");
      const enqueued = page.waitForResponse(
        (response) =>
          response.url().endsWith("/workflow/video") &&
          response.request().method() === "POST",
      );
      await video
        .getByRole("button", { name: "开始生成", exact: true })
        .click();
      await enqueued;
      await page.waitForFunction(
        () =>
          document.querySelector(
            ".media-rewrite-video .generation-composer-submit",
          )?.disabled,
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].duration, 12);
      assert.equal(requests[0].audio, false);
      assert.equal(requests[0].count, 2);
      assert.equal(requests[0].quality, "1080p");
      assert.equal(requests[0].ratio, "16:9");
      assert.equal(requests[0].requirements, "自然光，动作连贯。");
      assert(requests[0].script.includes("磨豆"));
      complete(jobs.find((job) => job.kind === "video_generate"));
      await video
        .getByRole("checkbox", { name: "选用成片1", exact: true })
        .waitFor();
      assert(
        !(await video
          .getByRole("checkbox", { name: "选用成片1", exact: true })
          .isChecked()),
      );
      const scriptEnqueued = page.waitForResponse(
        (response) =>
          response.url().endsWith("/workflow/video-script") &&
          response.request().method() === "POST",
      );
      await video
        .getByRole("button", { name: "生成脚本", exact: true })
        .click();
      await scriptEnqueued;
      await page.waitForFunction(
        () => document.querySelector(".video-script-editor textarea")?.disabled,
      );
      assert.equal(scriptRequests.length, 1);
      assert.equal(scriptRequests[0].model_id, "text-alt");
      checks.push(
        "video: six icon settings, script model, script/requirements payload and manual result selection",
      );
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "verification.json"),
      JSON.stringify(
        { status: "PASS", desktopOnly: true, mockAPI: true, checks, errors },
        null,
        2,
      ),
    );
    console.log("PASS " + checks.join("; "));
  } catch (error) {
    await page
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

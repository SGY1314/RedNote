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
  publications,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/button-themes");
const palettes = {
  forest: {
    normal: "rgb(47, 93, 75)",
    hover: "rgb(62, 113, 93)",
    active: "rgb(36, 74, 59)",
    disabled: "rgb(237, 240, 244)",
  },
  rose: {
    normal: "rgb(152, 90, 114)",
    hover: "rgb(133, 76, 100)",
    active: "rgb(116, 61, 84)",
    disabled: "rgb(243, 233, 237)",
  },
  pixel: {
    normal: "rgb(229, 229, 223)",
    hover: "rgb(255, 255, 255)",
    active: "rgb(191, 191, 181)",
    disabled: "rgb(37, 37, 34)",
  },
};
publications.push({
  id: "theme-publication",
  title: "发布按钮主题检查",
  body: "核对正文和素材。",
  topics: [],
  kind: "image",
  asset_ids: ["source-1"],
  target_platform: "xhs",
  ready: false,
  revision: 1,
  created_at: "2026-11-05T10:00:00Z",
});

(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  const errors = [];
  try {
    for (const [theme, palette] of Object.entries(palettes)) {
      workflows[projects[0].id].drafts = {};
      const context = await browser.newContext({
        viewport: { width: 1157, height: 765 },
        reducedMotion: "reduce",
      });
      await context.addInitScript(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await context.route("**/api/v1/**", routeAPI);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      const style = async (button, expected, description) => {
        try {
          await page.waitForFunction(
            ([el, color]) => getComputedStyle(el).backgroundColor === color,
            [await button.elementHandle(), expected],
            { timeout: 3000 },
          );
        } catch (error) {
          const actual = await button.evaluate((el) => ({
            background: getComputedStyle(el).backgroundColor,
            classes: el.className,
            disabled: el.disabled,
            hover: el.matches(":hover"),
            active: el.matches(":active"),
          }));
          await page.screenshot({
            path: path.join(out, `${theme}-failure.png`),
            fullPage: true,
          });
          throw new Error(
            `${description}: expected ${expected}, actual ${JSON.stringify(actual)}`,
            { cause: error },
          );
        }
        assert.equal(
          await button.evaluate((el) => getComputedStyle(el).backgroundColor),
          expected,
          description,
        );
      };
      const check = async (button, disabled, description) => {
        if (disabled) {
          assert(await button.isDisabled(), description);
          await button.hover();
          await style(
            button,
            palette.disabled,
            `${theme} disabled hover: ${description}`,
          );
          await page.mouse.down();
          await style(
            button,
            palette.disabled,
            `${theme} disabled press: ${description}`,
          );
          await page.mouse.move(1, 1);
          await page.mouse.up();
        } else {
          assert(await button.isEnabled(), description);
          await page.mouse.move(1, 1);
          await style(
            button,
            palette.normal,
            `${theme} normal: ${description}`,
          );
          await button.hover();
          await style(button, palette.hover, `${theme} hover: ${description}`);
          await page.mouse.down();
          await style(button, palette.active, `${theme} press: ${description}`);
          // Release outside the action so verification does not submit generation.
          await page.mouse.move(1, 1);
          await page.mouse.up();
        }
      };
      await page.goto(base + "/#rewrites");
      const nav = page.getByRole("navigation", { name: "仿写创作步骤" });
      await nav.getByRole("button", { name: /图片仿写/ }).click();
      const image = page.locator(".media-rewrite-image");
      const generateImage = image.getByRole("button", {
        name: "开始生成",
        exact: true,
      });
      await generateImage.waitFor();
      await image
        .getByRole("checkbox", { name: "参考图片1", exact: true })
        .uncheck();
      await image
        .getByRole("button", { name: "下一张图片", exact: true })
        .click();
      await image
        .getByRole("checkbox", { name: "参考图片2", exact: true })
        .uncheck();
      await image
        .getByRole("button", { name: "上一张图片", exact: true })
        .click();
      await image
        .getByRole("checkbox", { name: "参考图片1", exact: true })
        .waitFor();
      await check(generateImage, true, "image generation without a reference");
      await page.screenshot({
        path: path.join(out, `${theme}-disabled-image.png`),
        fullPage: true,
      });
      await image
        .getByRole("checkbox", { name: "参考图片1", exact: true })
        .check();
      await page.waitForFunction(
        () =>
          !document.querySelector(
            ".media-rewrite-image .media-generate-row button",
          ).disabled,
      );
      await check(generateImage, false, "image generation");
      await generateImage.hover();
      await page.screenshot({
        path: path.join(out, `${theme}-image-hover.png`),
        fullPage: true,
      });
      await nav.getByRole("button", { name: /视频仿写/ }).click();
      const video = page.locator(".media-rewrite-video");
      const generateVideo = video.getByRole("button", {
        name: "开始生成",
        exact: true,
      });
      await check(generateVideo, true, "video generation without a script");
      await video
        .getByRole("textbox", { name: "视频脚本", exact: true })
        .fill("镜头一：拍摄桌面上的手冲咖啡，缓慢推近。");
      await page.waitForFunction(
        () =>
          !document.querySelector(
            ".media-rewrite-video .media-generate-row button",
          ).disabled,
      );
      await check(generateVideo, false, "video generation");
      for (const step of ["标题仿写", "文案仿写"]) {
        await nav.getByRole("button", { name: new RegExp(step) }).click();
        const generate = page
          .locator(".creation-workflow > .workflow-panel")
          .getByRole("button", { name: "开始生成", exact: true });
        await check(generate, false, step);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const dock = page.getByRole("region", {
        name: "当前步骤操作",
        exact: true,
      });
      await dock.waitFor();
      const confirm = dock.locator(".ant-btn-primary");
      await check(confirm, await confirm.isDisabled(), "mobile confirmation");
      await page.setViewportSize({ width: 1157, height: 765 });
      await page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("button", { name: "发布管理", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "查看发布稿 发布按钮主题检查",
          exact: true,
        })
        .click();
      const modal = page.getByRole("dialog", {
        name: "确认发布稿",
        exact: true,
      });
      const ready = modal.getByRole("button", {
        name: "确认，设为等待发布",
        exact: true,
      });
      await modal
        .getByRole("textbox", { name: "发布稿正文", exact: true })
        .waitFor();
      await check(ready, false, "portal confirmation");
      await modal
        .getByRole("textbox", { name: "发布稿正文", exact: true })
        .fill("");
      await check(ready, true, "disabled portal confirmation");
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "checks.json"),
      JSON.stringify(
        {
          status: "PASS",
          themes: Object.keys(palettes),
          checks: [
            "disabled hover and press",
            "image/video/title/copy normal hover press",
            "mobile dock",
            "modal confirmation",
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS theme-aware primary states across image, video, title, copy, mobile dock and portal dialogs.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

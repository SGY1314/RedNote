const {
  chromium,
  fs,
  path,
  assert,
  routeAPI,
  assets,
  workflows,
} = require("./direct-media-fixture.cjs");
(async () => {
  const out = path.resolve(
    __dirname,
    "../../data/verification/reference-input",
  );
  await fs.mkdir(out, { recursive: true });
  for (let i = 3; i <= 5; i++)
    assets.push({
      ...assets[0],
      id: "source-" + i,
      name: "参考图" + i,
      position: i,
    });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/v1/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith("/profile/default"))
        return route.fulfill({ json: { account_name: "测试默认名称" } });
      return routeAPI(route);
    });
    await page.goto("http://127.0.0.1:8081/#rewrites");
    const nav = page.getByRole("navigation", {
      name: "仿写创作步骤",
      exact: true,
    });
    await nav.waitFor();
    for (const label of ["标题仿写", "文案仿写", "图片仿写", "视频仿写"]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      const panel = page.getByRole("region", { name: "参考内容", exact: true });
      await panel.waitFor();
      await page.waitForTimeout(800);
      console.log(label, await panel.locator("input[type=checkbox]").count());
      await page.screenshot({
        path: path.join(out, "current.png"),
        fullPage: true,
      });
      assert.equal(
        await panel
          .getByRole("checkbox", { name: "参考标题", exact: true })
          .isChecked(),
        true,
      );
      await panel
        .getByRole("checkbox", { name: "参考标题", exact: true })
        .uncheck();
      assert.equal(
        await panel
          .getByRole("textbox", { name: "参考标题", exact: true })
          .isDisabled(),
        true,
      );
      await panel
        .getByRole("checkbox", { name: "参考标题", exact: true })
        .check();
      await panel
        .getByRole("textbox", { name: "参考标题", exact: true })
        .fill("手动参考标题");
      if (label === "视频仿写") {
        const script = page.getByRole("group", {
          name: "视频脚本生成栏",
          exact: true,
        });
        const input = page.getByRole("textbox", {
          name: "视频脚本",
          exact: true,
        });
        const video = page.getByRole("group", {
          name: "视频生成生成栏",
          exact: true,
        });
        const a = await script.boundingBox(),
          b = await input.boundingBox(),
          c = await video.boundingBox();
        assert(a.y < b.y && b.y < c.y);
      }
      await page.screenshot({
        path: path.join(out, label + ".png"),
        fullPage: true,
      });
    }
    assert.equal(
      workflows["media-project"].drafts.title.data.reference_input.asset_ids
        .length,
      3,
    );
    await page.goto("http://127.0.0.1:8081/#settings");
    await page
      .getByRole("heading", { name: "默认基本信息", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(out, "settings.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Desktop reference selection, default three images, manual input, disabled state, script/video ordering and settings passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
  routeAPI,
  projects,
  assets,
  publications,
  source,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(
    __dirname,
    "../../data/verification/publication-editor",
  ),
  requests = [];
for (let i = 3; i <= 4; i++)
  assets.push({
    id: "source-" + i,
    name: "原图" + i,
    kind: "image",
    source: "collection",
    revision_id: source.id,
    status: "ready",
  });
const pub = {
  id: "editable-publication",
  project_id: projects[0].id,
  version_id: "saved-version",
  title: "发布稿编辑测试",
  body: "这是待编辑的正文。\n#原始话题[话题]#",
  topics: ["原始话题"],
  kind: "image",
  asset_ids: ["source-1", "source-2", "source-3", "source-4"],
  cover_id: "source-1",
  ready: false,
  revision: 1,
  target_platform: "xhs",
  created_at: "2026-11-04T08:00:00Z",
  exported_at: [],
};
publications.push(pub);
let fail = false;
async function route(r) {
  const req = r.request(),
    e = new URL(req.url()).pathname.slice(7);
  if (e === "/publications/confirm") {
    const data = req.postDataJSON();
    requests.push(data);
    if (fail)
      return r.fulfill({
        status: 500,
        json: { error: "保存暂时失败，请重试" },
      });
    for (const item of data.items) {
      assert.equal(item.revision, pub.revision);
      Object.assign(pub, item.edit, {
        ready: true,
        revision: pub.revision + 1,
      });
    }
    return r.fulfill({ json: { items: [pub] } });
  }
  return routeAPI(r);
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
        viewport: { width: 1157, height: 765 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/v1/**", route);
    await page.goto(base + "/#publications");
    const open = async () => {
      await page
        .getByRole("button", { name: "查看发布稿 " + pub.title, exact: true })
        .first()
        .click();
      await page
        .getByRole("textbox", { name: "发布稿标题", exact: true })
        .waitFor();
    };
    await open();
    const modal = page.getByRole("dialog", { name: "确认发布稿", exact: true }),
      title = modal.getByRole("textbox", { name: "发布稿标题", exact: true }),
      body = modal.getByRole("textbox", { name: "发布稿正文", exact: true }),
      ok = modal.getByRole("button", {
        name: "确认，设为等待发布",
        exact: true,
      });
    assert.equal(await body.inputValue(), "这是待编辑的正文。");
    assert.equal(await title.getAttribute("readonly"), null);
    assert((await modal.boundingBox()).y >= 100);
    assert.equal(
      await modal.locator(".publication-editor-thumbnails button").count(),
      4,
    );
    await modal
      .getByRole("button", { name: "预览发布图片 3", exact: true })
      .click();
    assert(
      (
        await modal
          .getByRole("img", { name: "发布图片 3", exact: true })
          .getAttribute("src")
      ).includes("source-3"),
    );
    await modal
      .getByRole("button", { name: "上一张发布素材", exact: true })
      .click();
    assert.equal(
      await modal
        .locator(".publication-editor-thumbnails button[aria-current=true]")
        .getAttribute("aria-label"),
      "预览发布图片 2",
    );
    await title.fill("不保存的修改");
    await modal
      .getByRole("button", { name: "移除当前图片", exact: true })
      .click();
    await modal.getByRole("button", { name: "暂不确认", exact: true }).click();
    assert.equal(pub.title, "发布稿编辑测试");
    assert.equal(pub.asset_ids.length, 4);
    await open();
    assert.equal(await title.inputValue(), pub.title);
    assert.equal(
      await modal.locator(".publication-editor-thumbnails button").count(),
      4,
    );
    for (let i = 0; i < 4; i++)
      await modal
        .getByRole("button", { name: "移除当前图片", exact: true })
        .click();
    assert(await ok.isDisabled());
    await modal.getByRole("button", { name: "撤销移除", exact: true }).click();
    assert(await ok.isEnabled());
    await modal.getByRole("button", { name: "暂不确认", exact: true }).click();
    await open();
    await title.fill("编辑后的发布标题");
    await body.fill("用户修改后的正文，保留真实记录。");
    const topics = modal.getByRole("combobox", {
      name: "发布稿话题",
      exact: true,
    });
    await topics.fill("新话题");
    await topics.press("Enter");
    await topics.press("Escape");
    await modal
      .getByRole("button", { name: "移除当前图片", exact: true })
      .click();
    assert.equal(
      await modal.locator(".publication-editor-thumbnails button").count(),
      3,
    );
    for (const width of [1157, 823, 547, 390]) {
      await page.setViewportSize({ width, height: 765 });
      const box = await modal.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      const button = await ok.boundingBox();
      assert(button.y + button.height <= 765);
      await modal
        .locator(".ant-modal-body")
        .evaluate((el) => (el.scrollTop = 0));
      const preview = await modal
        .locator(".publication-editor-preview")
        .boundingBox();
      const fields = await modal
        .locator(".publication-editor-fields")
        .boundingBox();
      const stage = await modal
        .locator(".publication-editor-media")
        .boundingBox();
      const thumbnails = await modal
        .locator(".publication-editor-thumbnails")
        .boundingBox();
      assert(
        thumbnails.y >= stage.y + stage.height,
        "Thumbnails must not obscure the preview or playback controls",
      );
      if (width > 760) {
        assert(
          fields.x >= preview.x + preview.width,
          "Desktop copy belongs beside the preview",
        );
        assert(stage.height > 300 && stage.width < box.width / 2);
      } else {
        assert(
          fields.y >= preview.y + preview.height,
          "Mobile copy belongs below the preview",
        );
      }
      await modal.screenshot({
        path: path.join(out, "editor-" + width + ".png"),
        animations: "disabled",
      });
    }
    fail = true;
    await ok.click();
    await modal.getByText("保存暂时失败，请重试", { exact: true }).waitFor();
    assert.equal(await title.inputValue(), "编辑后的发布标题");
    assert.equal(
      await modal.locator(".publication-editor-thumbnails button").count(),
      3,
    );
    assert.equal(pub.asset_ids.length, 4);
    fail = false;
    await body.fill("保存重试后的发布正文。");
    await ok.click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(pub.title, "编辑后的发布标题");
    assert.equal(pub.body, "保存重试后的发布正文。");
    assert.deepEqual(pub.asset_ids, ["source-2", "source-3", "source-4"]);
    assert(pub.topics.includes("新话题"));
    await page.reload();
    await open();
    assert.equal(await title.inputValue(), pub.title);
    assert.equal(await body.inputValue(), pub.body);
    assert.equal(
      await modal.locator(".publication-editor-thumbnails button").count(),
      3,
    );
    await modal.getByRole("button", { name: "暂不确认", exact: true }).click();
    Object.assign(pub, {
      kind: "video",
      asset_ids: ["source-video"],
      title: "一段值得记录的日常",
      body: "记录真实的生活片段，在发布前核对标题、正文与话题。",
      target_platform: "douyin",
    });
    for (const theme of ["forest", "rose", "pixel"]) {
      await page.evaluate(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await page.reload();
      await open();
      const player = modal.getByLabel("发布视频 1", { exact: true });
      await player.evaluate((el) => el.load());
      await page.waitForFunction(
        () =>
          document.querySelector(".publication-editor-media > video")
            ?.readyState >= 1,
      );
      assert.equal(
        await player.evaluate((el) => getComputedStyle(el).objectFit),
        "contain",
      );
      for (const width of [1157, 823, 390]) {
        const height = width < 600 ? 844 : 765;
        await page.setViewportSize({ width, height });
        await modal.locator(".ant-modal-body").evaluate((el) => {
          el.scrollTop = 0;
        });
        const stage = await modal
          .locator(".publication-editor-media")
          .boundingBox();
        const fields = await modal
          .locator(".publication-editor-fields")
          .boundingBox();
        const button = await ok.boundingBox();
        assert(button.y + button.height <= height);
        assert(
          stage.height > 350,
          "Portrait video should have a taller, readable preview",
        );
        if (width > 760)
          assert(
            fields.x >= stage.x + stage.width &&
              stage.width / stage.height < 1.1,
          );
        else assert(fields.y > stage.y + stage.height);
        await modal.screenshot({
          path: path.join(out, `video-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
      await modal
        .getByRole("button", { name: "移除当前视频", exact: true })
        .click();
      assert(await ok.isDisabled());
      await modal
        .getByRole("button", { name: "撤销移除", exact: true })
        .click();
      assert(await ok.isEnabled());
      await modal
        .getByRole("button", { name: "暂不确认", exact: true })
        .click();
      assert.deepEqual(pub.asset_ids, ["source-video"]);
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, "verification.json"),
      JSON.stringify(
        {
          status: "PASS",
          checks: [
            "lower modal position and four viewport sizes",
            "two-column desktop editor and stacked mobile editor",
            "taller video preview in all three themes",
            "clickable thumbnails below the media and arrows",
            "title body topics editable",
            "remove and undo; cannot confirm empty media",
            "cancel discards local changes",
            "failed save retains edits",
            "confirm submits edits and refresh restores saved content",
          ],
          requests: requests.length,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS editable publication confirmation, media removal, thumbnail carousel and responsive layout.",
    );
  } catch (e) {
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

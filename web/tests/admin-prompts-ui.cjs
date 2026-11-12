const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, browserLaunchOptions } = require("./browser.cjs");
const base = process.env.WORKBENCH_UI_BASE_URL || "http://127.0.0.1:8080";
const out =
  process.env.WORKBENCH_UI_QA_OUT ||
  path.resolve(__dirname, "../../data/verification/admin-four-prompts");
const labels = {
  title: "标题仿写",
  copy: "文案仿写",
  image: "图片仿写",
  "video-script": "视频脚本",
  video: "视频生成",
};

(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1157, height: 765 },
    });
    page.setDefaultTimeout(10000);
    const errors = [],
      presets = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let serial = 0;
    await page.route(base + "/api/v1/**", async (route) => {
      const request = route.request(),
        endpoint = new URL(request.url()).pathname.slice(7);
      if (endpoint === "/auth/me")
        return route.fulfill({
          json: {
            user: {
              id: "prompt-admin",
              username: "admin",
              display_name: "管理员",
              role: "admin",
              status: "active",
            },
          },
        });
      if (endpoint === "/session")
        return route.fulfill({ json: { csrf_token: "fixture" } });
      if (endpoint === "/admin/overview")
        return route.fulfill({
          json: {
            users: [],
            usage: [],
            tasks: [],
            summary: {
              active_users: 0,
              calls: 0,
              tokens: 0,
              cost: 0,
              active_tasks: 0,
              failed_tasks: 0,
            },
            price_per_1k: 0,
          },
        });
      if (endpoint === "/admin/settings")
        return route.fulfill({ json: { services: {}, dependencies: {} } });
      if (
        endpoint === "/admin/users" ||
        endpoint === "/admin/audit" ||
        endpoint.startsWith("/admin/models/")
      )
        return route.fulfill({ json: [] });
      if (endpoint.startsWith("/admin/prompt-presets")) {
        if (request.method() === "GET") return route.fulfill({ json: presets });
        const id = endpoint.split("/")[3];
        if (request.method() === "DELETE") {
          const index = presets.findIndex((item) => item.id === id);
          assert.ok(index >= 0);
          presets.splice(index, 1);
          return route.fulfill({ json: { deleted: true, id } });
        }
        const input = request.postDataJSON();
        assert.ok(labels[input.scope], "unsupported prompt scope");
        const index = presets.findIndex((item) => item.id === id);
        const saved = {
          ...input,
          id: id || `prompt-${++serial}`,
          revision: index < 0 ? 1 : presets[index].revision + 1,
          updated_at: new Date().toISOString(),
        };
        if (saved.is_default && saved.enabled)
          presets.forEach((item) => {
            if (item.scope === saved.scope) item.is_default = false;
          });
        if (!saved.enabled) saved.is_default = false;
        if (index < 0) presets.push(saved);
        else presets[index] = saved;
        return route.fulfill({ json: saved });
      }
      errors.push("Unexpected request " + endpoint);
      return route.fulfill({ json: [] });
    });
    await page.goto(base + "/#admin/prompts");
    const tabs = page.locator(".admin-prompts-tabs");
    await tabs.waitFor();
    assert.equal(await tabs.locator(".ant-segmented-item").count(), 5);
    assert.equal(await page.getByText("发帖角度", { exact: true }).count(), 0);
    const create = page.getByRole("button", { name: /新增方案/ });
    for (const [scope, label] of Object.entries(labels)) {
      await tabs
        .locator(".ant-segmented-item")
        .filter({ hasText: label })
        .click();
      await create.click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("方案名称", { exact: true })
        .fill(label + "默认配置");
      await dialog
        .locator("textarea")
        .fill(label + "的管理员系统提示词，保留真实细节。");
      await dialog
        .getByRole("button", { name: "保存方案", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await page
        .locator(".admin-prompts-item")
        .filter({ hasText: label + "默认配置" })
        .waitFor();
      assert.equal(
        presets.find((item) => item.scope === scope).is_default,
        true,
      );
    }
    await tabs
      .locator(".ant-segmented-item")
      .filter({ hasText: "图片仿写" })
      .click();
    await page.getByRole("button", { name: /编辑/ }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("更新后的图片系统提示词");
    await dialog.locator(".admin-prompts-switches .ant-switch").first().click();
    assert.ok(
      await dialog
        .locator(".admin-prompts-switches .ant-switch")
        .last()
        .isDisabled(),
    );
    await dialog.getByRole("button", { name: "保存方案", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("已停用", { exact: true }).waitFor();
    assert.equal(presets.find((item) => item.scope === "image").revision, 2);
    assert.equal(
      presets.find((item) => item.scope === "image").prompt,
      "更新后的图片系统提示词",
    );
    for (const width of [1720, 1157]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.waitForTimeout(150);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "page overflow " + width,
      );
      assert.ok(
        await tabs.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        "stage tabs overflow " + width,
      );
      await page.screenshot({
        path: path.join(out, `admin-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1157, height: 765 });
    await tabs
      .locator(".ant-segmented-item")
      .filter({ hasText: "视频生成" })
      .click();
    await page
      .locator(".admin-prompts-item")
      .getByRole("button", { name: /删除/ })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "删除方案", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.ok(!presets.some((item) => item.scope === "video"));
    await page
      .getByText("此环节暂未添加方案，将使用系统基础规则", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: five prompt stages; create/edit/disable/delete; no angle tab; 1720/1157px desktop layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

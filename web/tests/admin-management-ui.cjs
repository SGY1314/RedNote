const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/admin-management"),
  stamp = "2026-11-05T14:00:00Z";
const users = [
  {
    id: "admin",
    username: "workbench",
    display_name: "管理员",
    role: "admin",
    status: "active",
    note: "管理工作区与创作配置",
  },
  {
    id: "creator",
    username: "creator",
    display_name: "创作用户",
    role: "creator",
    status: "active",
    note: "负责日常创作与发布内容",
  },
  {
    id: "operator",
    username: "operator",
    display_name: "内容运营与素材管理负责人",
    role: "operator",
    status: "disabled",
    note: "这是一条较长的职责备注，用于检查宽度受限时仍保持表格布局清晰。",
  },
].map((u) => ({
  ...u,
  created_at: stamp,
  last_login_at: u.id === "operator" ? undefined : stamp,
}));
const catalogs = Object.fromEntries(
  [
    "rewrite",
    "angle",
    "title",
    "copy",
    "image-plan",
    "image",
    "video-script",
    "video",
  ].map((cap) => [
    cap,
    [
      {
        id: "primary",
        name: "DeepSeek Flash",
        model: "deepseek-flash",
        base_url: "https://api.example.test/compatible-mode/v1",
        configured: true,
      },
      {
        id: "secondary",
        name: "专业长文与复杂场景模型",
        model: "long-context-model-20261105",
        base_url: "https://workspace.example.test/compatible-mode/v1",
        configured: true,
      },
      {
        id: "unconfigured",
        name: "待配置模型",
        model: "qwen-plus",
        base_url: "https://api.example.test/v1",
        configured: false,
      },
    ],
  ]),
);
const writes = [],
  errors = [];
async function fixture(route) {
  const req = route.request(),
    e = new URL(req.url()).pathname.slice(7),
    method = req.method();
  let json = [];
  if (e === "/auth/me") json = { user: users[0] };
  else if (e === "/session") json = { csrf_token: "fixture" };
  else if (e === "/admin/overview")
    json = {
      users,
      usage: [],
      tasks: [],
      summary: {
        active_users: users.filter((u) => u.status === "active").length,
        calls: 0,
        tokens: 0,
        cost: 0,
        active_tasks: 0,
        failed_tasks: 0,
      },
      price_per_1k: 0,
    };
  else if (e === "/admin/users" && method === "POST") {
    const body = req.postDataJSON();
    writes.push({ e, method });
    json = { ...body, id: "new-user", status: "active", created_at: stamp };
    delete json.password;
    users.push(json);
  } else if (e.startsWith("/admin/users/")) {
    const id = e.split("/")[3],
      u = users.find((u) => u.id === id);
    assert(u);
    if (method === "PATCH") {
      Object.assign(u, req.postDataJSON());
      writes.push({ e, method });
      json = { updated: true };
    } else if (method === "DELETE") {
      users.splice(users.indexOf(u), 1);
      writes.push({ e, method });
      json = { deleted: true };
    } else throw Error("Unexpected user request " + e);
  } else if (e === "/admin/settings")
    json = { services: { text: {}, ocr: {}, asr: {} }, dependencies: {} };
  else if (e.startsWith("/admin/models/")) {
    const [, cap, id] =
      e.match(/^\/admin\/models\/([^/]+)(?:\/([^/]+))?$/) || [];
    if (method === "PUT") {
      const body = req.postDataJSON();
      assert.equal(
        body.secret,
        "",
        "Editing must preserve an existing saved key",
      );
      assert.equal(id, "primary");
      const index = catalogs[cap].findIndex((m) => m.id === id);
      catalogs[cap][index] = { ...body, configured: true };
      delete catalogs[cap][index].secret;
      writes.push({ e, method });
      json = catalogs[cap][index];
    } else {
      assert.equal(method, "GET");
      json = catalogs[cap];
    }
  } else assert.equal(method, "GET", "Unexpected mutation " + e);
  return route.fulfill({ json });
}
async function select(page, label, value) {
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: label, exact: true }) })
    .click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: new RegExp("^" + value + "$") })
    .click();
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width: 1144, height: 751 },
      reducedMotion:
        process.env.REDUCED_MOTION === "1" ? "reduce" : "no-preference",
    });
    await context.addInitScript(() =>
      localStorage.setItem("rednote.appearance.theme", "pixel"),
    );
    await context.route("**/api/v1/**", fixture);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#admin/users");
    const panel = page.locator(".admin-users-page");
    await panel.waitFor();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "admin",
    );
    assert.equal(
      await page.getByRole("button", { name: "刷新管理数据" }).count(),
      0,
    );
    const rows = panel.locator("tbody tr[data-row-key]");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".admin-users-page tbody tr[data-row-key]")
          .length === 3,
    );
    assert(
      await panel
        .locator(".ant-table-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    assert(
      await panel
        .locator(".admin-user-name strong")
        .filter({ hasText: "创作用户" })
        .evaluate((el) => el.getBoundingClientRect().height < 28),
    );
    await page
      .getByRole("textbox", { name: "搜索用户", exact: true })
      .fill("creator");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".admin-users-page tbody tr[data-row-key]")
          .length === 1,
    );
    await page.getByRole("textbox", { name: "搜索用户", exact: true }).fill("");
    await select(page, "筛选用户角色", "运营账号");
    assert.equal(await rows.count(), 1);
    await select(page, "筛选账号状态", "已停用");
    assert.equal(await rows.count(), 1);
    await select(page, "筛选用户角色", "全部角色");
    await select(page, "筛选账号状态", "全部状态");
    for (const width of [1440, 1144, 823]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
      await page.screenshot({
        path: path.join(out, "users-" + width + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1144, height: 751 });
    await page
      .getByRole("button", { name: "更多用户操作 管理员", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("menuitem", { name: /停用账号/ })
        .getAttribute("aria-disabled"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("menuitem", { name: /删除用户/ })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /新增用户/ }).click();
    let dialog = page.getByRole("dialog", { name: "新增用户", exact: true });
    await dialog.getByLabel("用户名", { exact: true }).fill("fixture-user");
    await dialog
      .getByLabel("初始密码", { exact: true })
      .fill("fixture-password");
    await dialog.getByLabel("显示名称", { exact: true }).fill("界面测试用户");
    await dialog.getByRole("button", { name: /^保\s*存$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "编辑用户 界面测试用户", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "编辑用户 界面测试用户", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "编辑用户", exact: true });
    await dialog
      .getByLabel("显示名称", { exact: true })
      .fill("更新后的测试用户");
    await dialog.getByRole("button", { name: /^保\s*存$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", {
        name: "更多用户操作 更新后的测试用户",
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: /重置密码/ }).click();
    dialog = page.getByRole("dialog", {
      name: "重置密码：更新后的测试用户",
      exact: true,
    });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await page
      .getByRole("button", {
        name: "更多用户操作 更新后的测试用户",
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: /停用账号/ }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('.admin-users-page tr[data-row-key="new-user"]')
        ?.textContent.includes("已停用"),
    );
    await page
      .getByRole("button", {
        name: "更多用户操作 更新后的测试用户",
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: /删除用户/ }).click();
    dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByText("删除这个用户？", { exact: true }) });
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    assert(users.some((u) => u.id === "new-user"));
    const nav = page.getByRole("navigation", { name: "管理端导航" });
    await nav.getByRole("button", { name: "模型配置", exact: true }).click();
    const group = page.locator(".admin-model-group");
    await group.locator(".admin-model-entry").first().waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".ant-message-notice"),
    );
    assert.equal(
      await page.locator(".admin-capability-tabs .ant-segmented-item").count(),
      8,
    );
    assert.equal(
      await page
        .locator(".admin-capability-tabs")
        .getByText("发帖角度", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".admin-capability-tabs")
        .getByText("画面规划", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByText("服务端统一配置模型与密钥", { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator(".admin-model-top p").count(), 0);
    for (const width of [1720, 1144, 823]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
      assert(
        await group
          .locator(".admin-model-entry")
          .first()
          .evaluate((el) => {
            const a = el.getBoundingClientRect(),
              b = el
                .querySelector(".admin-model-entry-actions")
                .getBoundingClientRect();
            return b.right <= a.right + 1 && b.left >= a.left;
          }),
      );
      await page.screenshot({
        path: path.join(out, "models-" + width + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1144, height: 751 });
    await page
      .locator(".admin-capability-tabs")
      .getByText("文案仿写", { exact: true })
      .click();
    await group
      .getByRole("button", { name: "编辑模型 DeepSeek Flash", exact: true })
      .click();
    const editor = page.locator(".admin-model-editor");
    await editor
      .getByLabel("配置名称", { exact: true })
      .fill("更新后的文案模型");
    await editor.getByRole("button", { name: "保存配置", exact: true }).click();
    await group.getByText("更新后的文案模型", { exact: true }).waitFor();
    assert.equal(catalogs.rewrite[0].name, "DeepSeek Flash");
    assert.equal(catalogs.copy[0].name, "更新后的文案模型");
    await page
      .locator(".admin-capability-tabs")
      .getByText("图片", { exact: true })
      .click();
    await group
      .getByRole("button", { name: "删除模型 DeepSeek Flash", exact: true })
      .click();
    dialog = page.getByRole("dialog").last();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    assert.equal(catalogs.image.length, 3);
    await page.getByRole("button", { name: /服务与环境设置/ }).click();
    await page.getByRole("dialog").waitFor();
    const themeSnapshot = () =>
      page.evaluate(() => {
        const css = (selector) => {
          const style = getComputedStyle(document.querySelector(selector));
          return [
            style.backgroundColor,
            style.color,
            style.borderColor,
            style.fontFamily,
          ];
        };
        return {
          sidebar: css(".admin-sidebar"),
          heading: css(".admin-heading h1"),
          button: css(".admin-model-group-head .ant-btn-primary"),
          dialog: css(".ant-drawer-content"),
          input: css(".ant-drawer input"),
        };
      });
    await page.locator(".ant-drawer input").first().waitFor();
    const before = await themeSnapshot();
    const sibling = await context.newPage();
    await sibling.goto(base + "/#admin/overview");
    for (const theme of ["rose", "forest", "pixel"]) {
      await sibling.evaluate(
        (theme) => localStorage.setItem("rednote.appearance.theme", theme),
        theme,
      );
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "admin",
      );
      assert.deepEqual(await themeSnapshot(), before);
    }
    await sibling.close();
    await page.screenshot({
      path: path.join(out, "settings-independent-theme.png"),
      animations: "disabled",
    });
    await page.reload();
    await page.locator(".admin-model-entry").first().waitFor();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "admin",
    );
    assert.equal(
      writes.filter(
        (w) => w.e.startsWith("/admin/models/") && w.method === "PUT",
      ).length,
      1,
    );
    assert.equal(writes.filter((w) => w.method === "DELETE").length, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS user management, eight model categories, removed labels/refresh, scoped edit with key preservation, settings, responsive layouts and fixed admin palette across user themes/storage events/reload. All requests mocked.",
    );
  } catch (e) {
    const failedPage = browser.contexts()[0]?.pages()[0];
    if (failedPage)
      await fs.writeFile(
        path.join(out, "popup-debug.json"),
        JSON.stringify(
          await failedPage.evaluate(() =>
            [
              ...document.querySelectorAll(".ant-select,.ant-select-dropdown"),
            ].map((el) => ({
              cls: el.className,
              rect: el.getBoundingClientRect().toJSON(),
              style: el.getAttribute("style"),
              transform: getComputedStyle(el).transform,
              visibility: getComputedStyle(el).visibility,
              text: el.textContent.slice(0, 100),
            })),
          ),
          null,
          2,
        ),
      );
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

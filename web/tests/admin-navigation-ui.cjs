const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
  routeAPI,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/admin-navigation");
const stamp = "2026-11-05T14:00:00Z";
const admin = {
  id: "navigation-admin",
  username: "admin",
  display_name: "管理员",
  role: "admin",
  status: "active",
  created_at: stamp,
};
const creator = {
  id: "navigation-creator",
  username: "creator",
  display_name: "创作用户",
  role: "creator",
  status: "active",
  created_at: stamp,
};
const usage = [
  {
    id: "usage",
    user_id: creator.id,
    user: creator.display_name,
    at: stamp,
    kind: "title_rewrite",
    feature: "标题仿写",
    model: "模拟模型",
    input: 1600,
    output: 300,
    total: 1900,
    cost: 0.04,
    state: "succeeded",
    stateLabel: "成功",
    jobID: "job",
  },
];
const requests = [],
  errors = [];
async function fixture(route) {
  const req = route.request(),
    endpoint = new URL(req.url()).pathname.slice(7);
  requests.push({ method: req.method(), endpoint });
  assert.equal(
    req.method(),
    "GET",
    "Navigation validation should not mutate server data",
  );
  let json = [];
  if (endpoint === "/auth/me") json = { user: admin };
  else if (endpoint === "/session") json = { csrf_token: "fixture" };
  else if (endpoint === "/admin/overview")
    json = {
      users: [admin, creator],
      usage,
      tasks: [
        {
          user: "不应展示的任务",
          job: {
            id: "hidden",
            kind: "cleanup",
            state: "failed",
            updated_at: stamp,
          },
        },
      ],
      summary: {
        active_users: 2,
        calls: 1,
        tokens: 1900,
        cost: 0.04,
        active_tasks: 1,
        failed_tasks: 1,
      },
      price_per_1k: 0.02,
    };
  else if (endpoint === "/admin/audit")
    return route.fulfill({
      status: 500,
      json: { error: "Removed module must not be requested" },
    });
  else if (endpoint === "/admin/users") json = [admin, creator];
  else if (endpoint === "/admin/settings")
    json = { services: {}, dependencies: {} };
  else if (endpoint.startsWith("/admin/models/"))
    json = [
      {
        id: "mock-model",
        name: "模拟模型",
        model: "fixture",
        configured: true,
        vision: true,
      },
    ];
  await route.fulfill({ json });
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width: 1144, height: 751 },
      reducedMotion: "reduce",
    });
    await context.route("**/api/v1/**", fixture);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#admin/tasks");
    const nav = page.getByRole("navigation", { name: "管理端导航" });
    await page
      .getByRole("heading", { name: "管理总览", exact: true })
      .waitFor();
    await page.waitForURL((url) => url.hash === "#admin/overview");
    assert.equal(await nav.locator("button").count(), 5);
    assert.equal(
      await nav.getByRole("button", { name: "后台任务", exact: true }).count(),
      0,
    );
    assert.equal(
      await nav.getByRole("button", { name: "操作记录", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.locator(".admin-todo,.admin-recent-tasks").count(),
      0,
    );
    assert.equal(
      await page.getByText("不应展示的任务", { exact: true }).count(),
      0,
    );
    await page.locator(".admin-user-usage").waitFor();
    assert.equal(await page.locator(".admin-metric").count(), 4);
    const container = await page.locator(".admin-overview-grid").boundingBox(),
      panel = await page.locator(".admin-user-usage").boundingBox();
    assert(
      Math.abs(container.width - panel.width) < 1,
      "User usage should use the available overview width",
    );
    for (const hash of ["#admin/audit", "#/admin/tasks", "#/admin/audit"]) {
      await page.evaluate((hash) => (location.hash = hash), hash);
      await page.waitForURL((url) => url.hash === "#admin/overview");
      await page
        .getByRole("heading", { name: "管理总览", exact: true })
        .waitFor();
    }
    for (const [key, label] of [
      ["users", "用户管理"],
      ["models", "模型配置"],
      ["prompts", "创作提示词"],
      ["usage", "用量与计费"],
      ["overview", "管理总览"],
    ]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await page.waitForURL((url) => url.hash === "#admin/" + key);
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
      await page
        .getByRole("status")
        .filter({ hasText: "服务端已连接" })
        .waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.screenshot({
        path: path.join(out, key + "-1144.png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    for (const width of [1440, 823, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert(
        await page.evaluate(
          () =>
            Math.abs(
              document
                .querySelector(".admin-overview-grid")
                .getBoundingClientRect().width -
                document
                  .querySelector(".admin-user-usage")
                  .getBoundingClientRect().width,
            ) < 1,
        ),
      );
      await page.screenshot({
        path: path.join(out, "overview-" + width + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    assert.equal(
      requests.filter((r) => r.endpoint === "/admin/audit").length,
      0,
    );
    const creatorContext = await browser.newContext({
      viewport: { width: 1144, height: 751 },
    });
    await creatorContext.route("**/api/v1/**", routeAPI);
    const workspace = await creatorContext.newPage();
    workspace.on("pageerror", (e) => errors.push(e.message));
    await workspace.goto(base + "/#tasks");
    await workspace
      .getByRole("dialog", { name: "后台任务列表", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS five remaining admin modules, removed overview sections, old-route redirects, no audit fetch, full-width responsive overview and retained creator task dialog. All API requests mocked.",
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

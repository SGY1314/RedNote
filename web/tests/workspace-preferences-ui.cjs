const { chromium, browserLaunchOptions } = require("./browser.cjs");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const out = path.resolve(
  __dirname,
  "../../../../verification/workspace-optimizations-20261016",
);
const projects = [
  {
    id: "new",
    name: "我的新创作",
    kind: "image",
    platform: "xhs",
    sources: [],
    created_at: "2026-10-16T03:00:00Z",
  },
  {
    id: "old",
    name: "周末旅行灵感",
    kind: "image",
    platform: "douyin",
    note_id: "note",
    sources: [],
    created_at: "2026-10-15T03:00:00Z",
  },
];
let writes = [],
  statusReads = 0;
async function respond(route) {
  const req = route.request(),
    url = new URL(req.url()),
    p = url.pathname;
  if (p.startsWith("/api/v1")) {
    const endpoint = p.slice(7);
    let body = [];
    if (req.method() !== "GET") writes.push(endpoint);
    if (endpoint === "/session") body = { csrf_token: "fixture" };
    else if (endpoint === "/health") body = { status: "ok" };
    else if (endpoint === "/sync")
      body = {
        reset: true,
        more: false,
        epoch: "fixture",
        cursor: 1,
        changes: projects.map((value) => ({
          entity: "projects",
          id: value.id,
          value,
        })),
      };
    else if (endpoint === "/collections") body = { items: [], total: 0 };
    else if (/^\/rewrites\/(new|old)$/.test(endpoint))
      body = {
        project: projects.find((p) => p.id === endpoint.split("/").at(-1)),
        versions: [],
        reference_assets: [],
        reference_videos: [],
      };
    else if (endpoint.includes("/drafts/"))
      body = {
        ...req.postDataJSON(),
        revision: 1,
        saved_at: new Date().toISOString(),
      };
    else if (endpoint === "/publisher/status") {
      statusReads++;
      body = {
        is_logged_in: true,
        state: "success",
        username: "小红书测试账号",
        user_id: "xhs-fixture",
      };
    } else if (endpoint === "/platforms/douyin/account") {
      statusReads++;
      body = {
        is_logged_in: true,
        state: "success",
        username: "抖音测试账号",
        user_id: "dy-fixture",
        main_verified: true,
        creator_verified: true,
      };
    } else if (req.method() !== "GET")
      throw Error(`Unexpected external action: ${endpoint}`);
    return route.fulfill({ json: body });
  }
  const file = p === "/" ? "index.html" : p.slice(1);
  if (file.includes("..")) return route.abort();
  return route.fulfill({
    body: await fs.readFile(path.join(__dirname, "../dist", file)),
    contentType: file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".png")
          ? "image/png"
          : "text/html",
  });
}
async function accountGeometry(page) {
  return page.locator(".platform-account-card").evaluateAll((cards) =>
    cards.map((card) => {
      const names = [
        ".account-avatar",
        ".account-title-row strong",
        ".account-status",
        ".account-action-refresh",
        ".account-action-connect",
        ".account-publish-help summary",
      ];
      const rect = card.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        positions: names.map((name) => {
          const r = card.querySelector(name).getBoundingClientRect();
          return { x: r.x, y: r.y - rect.y };
        }),
      };
    }),
  );
}
function checkAlignment(cards, width) {
  assert.equal(cards.length, 2);
  assert.ok(
    Math.abs(cards[0].width - cards[1].width) <= 1,
    `Account widths differ at ${width}`,
  );
  assert.ok(
    Math.abs(cards[0].height - cards[1].height) <= 1,
    `Account heights differ at ${width}`,
  );
  cards[0].positions.forEach((position, i) => {
    assert.ok(
      Math.abs(position.x - cards[1].positions[i].x) <= 1,
      `Account column ${i} differs at ${width}`,
    );
    assert.ok(
      Math.abs(position.y - cards[1].positions[i].y) <= 1,
      `Account row ${i} differs at ${width}`,
    );
  });
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://preferences.test/**", respond);
    await page.goto("http://preferences.test/#collections");
    await page.getByText("全部笔记", { exact: false }).waitFor();
    assert.equal(await page.locator(".capture-foot > span").count(), 0);
    await page.getByRole("button", { name: "仿写库", exact: true }).click();
    await page.locator(".project-rail-open").first().waitFor();
    const filterPositions = await page
      .locator(".project-rail-filters")
      .evaluate((e) =>
        [...e.children].map((child) => child.getBoundingClientRect().top),
      );
    assert.ok(
      Math.abs(filterPositions[0] - filterPositions[1]) <= 1,
      "Search and platform filter must share a row",
    );
    assert.ok(await page.getByText("来源平台", { exact: true }).isVisible());
    const pin = page.getByRole("button", {
      name: "置顶项目 周末旅行灵感",
      exact: true,
    });
    await pin.click();
    await page
      .getByRole("button", { name: "取消置顶 周末旅行灵感", exact: true })
      .waitFor();
    assert.ok(
      (await page.locator(".project-rail-open").first().textContent()).includes(
        "周末旅行灵感",
      ),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "取消置顶 周末旅行灵感", exact: true })
      .waitFor();
    assert.ok(
      (await page.locator(".project-rail-open").first().textContent()).includes(
        "周末旅行灵感",
      ),
      "Pin must survive reload",
    );
    const pinAndDelete = await page
      .locator(".project-rail-item-actions")
      .first()
      .evaluate((e) =>
        [...e.children].map((child) => child.getBoundingClientRect().top),
      );
    assert.ok(pinAndDelete[0] < pinAndDelete[1], "Pin belongs above delete");
    const deletionColors = await page
      .locator(".rewrite-delete-button:not(:disabled)")
      .evaluateAll((elements) =>
        elements.map((e) => getComputedStyle(e).color),
      );
    assert.ok(
      deletionColors.length >= 3 &&
        deletionColors.every((color) => color === "rgb(147, 158, 174)"),
      "All project delete controls must be gray",
    );
    const separator = page.getByRole("separator", { name: "调整项目列表宽度" });
    const before = Number(await separator.getAttribute("aria-valuenow"));
    const box = await separator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    const widened = Number(await separator.getAttribute("aria-valuenow"));
    assert.ok(
      widened > before + 50,
      "Dragging the separator must widen the rail",
    );
    await page.reload();
    await separator.waitFor();
    assert.equal(
      Number(await separator.getAttribute("aria-valuenow")),
      widened,
      "Width must survive reload",
    );
    const title = page.getByRole("textbox", { name: "创作标题", exact: true });
    await title.fill("保留正在编辑的标题");
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await title.inputValue(),
      "保留正在编辑的标题",
      "Resizing must preserve edits",
    );
    await page.keyboard.press("Home");
    assert.equal(Number(await separator.getAttribute("aria-valuenow")), 244);
    await page.keyboard.press("End");
    assert.equal(
      Number(await separator.getAttribute("aria-valuenow")),
      Number(await separator.getAttribute("aria-valuemax")),
    );
    await page.setViewportSize({ width: 1145, height: 960 });
    await page.screenshot({
      path: path.join(out, "project-list.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /项目与模型管理$/ }).click();
    await page.locator(".project-card").first().waitFor();
    assert.ok(
      (await page.locator(".project-card").first().textContent()).includes(
        "周末旅行灵感",
      ),
      "Project management must use the pinned order too",
    );
    await page
      .getByRole("button", { name: "取消置顶 周末旅行灵感", exact: true })
      .click();
    assert.ok(
      (await page.locator(".project-rail-open").first().textContent()).includes(
        "我的新创作",
      ),
    );
    await page.setViewportSize({ width: 644, height: 960 });
    assert.ok(
      !(await separator.isVisible()),
      "Stacked mobile layout does not need a resize separator",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.getByRole("button", { name: "发布管理", exact: true }).click();
    await page.locator(".platform-account-card").first().waitFor();
    for (const width of [1440, 1145, 644, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      checkAlignment(await accountGeometry(page), width);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Overflow at ${width}`,
      );
    }
    await page.setViewportSize({ width: 1145, height: 1000 });
    await page.screenshot({
      path: path.join(out, "accounts-aligned.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "刷新账号状态", exact: true })
      .click();
    await page.getByText("小红书测试账号", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "检查抖音账号", exact: true })
      .click();
    await page.getByText("抖音测试账号", { exact: true }).waitFor();
    checkAlignment(await accountGeometry(page), 1145);
    assert.equal(
      statusReads,
      2,
      "Original account refresh handlers must remain connected",
    );
    await page
      .getByRole("button", { name: "更多抖音账号操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /打开专用官方浏览器$/ }).waitFor();
    assert.ok(
      await page.getByRole("menuitem", { name: /断开账号$/ }).isVisible(),
    );
    assert.deepEqual(errors, []);
    assert.ok(
      writes.every(
        (endpoint) =>
          endpoint.includes("/drafts/") ||
          ["/publisher/status", "/platforms/douyin/account"].includes(endpoint),
      ),
      "Preferences must not change backend project data",
    );
    console.log(
      "PASS: removed caption; compact filters; pin/unpin persistence and ordering; gray delete controls; drag/keyboard width persistence and draft preservation; aligned logged-out/logged-in accounts at 4 widths; original account handlers retained (mock services).",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

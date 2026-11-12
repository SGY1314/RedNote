const {
  chromium,
  browserLaunchOptions,
  fs,
  path,
  assert,
  base,
  routeAPI,
} = require("./direct-media-fixture.cjs");
const out = path.resolve(__dirname, "../../data/verification/admin-surface");
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const guest = await browser.newContext({
      viewport: { width: 1144, height: 751 },
      reducedMotion: "reduce",
    });
    await guest.addInitScript(() =>
      localStorage.setItem("rednote.appearance.theme", "rose"),
    );
    await guest.route("**/api/v1/**", (route) => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/auth/me")
          ? { user: null }
          : [],
      });
    });
    const page = await guest.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#admin/login");
    await page.getByRole("form", { name: "管理员登录" }).waitFor();
    const snapshot = () =>
      page.evaluate(() => {
        const style = (selector) => {
          const s = getComputedStyle(document.querySelector(selector));
          return [s.backgroundColor, s.color, s.fontFamily];
        };
        return {
          theme: document.documentElement.dataset.theme,
          heading: style(".login-form-card h2"),
          button: style(".login-form-card .ant-btn-primary"),
          story: style(".login-story"),
        };
      });
    const fixed = await snapshot();
    assert.equal(fixed.theme, "admin");
    for (const preference of ["pixel", "forest", "rose"]) {
      await page.evaluate(
        (t) => localStorage.setItem("rednote.appearance.theme", t),
        preference,
      );
      await page.reload();
      await page.getByRole("form", { name: "管理员登录" }).waitFor();
      assert.deepEqual(await snapshot(), fixed);
    }
    await page.screenshot({
      path: path.join(out, "admin-login.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: /创作用户登录/ }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "rose",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("rednote.appearance.theme"),
      ),
      "rose",
    );
    await page.screenshot({
      path: path.join(out, "user-login-restored.png"),
      animations: "disabled",
    });
    const creator = await browser.newContext({
      viewport: { width: 1144, height: 751 },
    });
    const adminRequests = [];
    await creator.route("**/api/v1/**", (route) => {
      if (new URL(route.request().url()).pathname.includes("/admin/"))
        adminRequests.push(route.request().url());
      return routeAPI(route);
    });
    const userPage = await creator.newPage();
    await userPage.goto(base + "/#admin/users");
    await userPage.locator(".page-collections").waitFor();
    assert.equal(await userPage.locator(".admin-shell").count(), 0);
    assert.deepEqual(adminRequests, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS fixed admin login across three saved themes, restored creator appearance after leaving admin, creator route guard without admin API access. All API requests mocked.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

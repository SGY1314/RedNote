const { chromium, browserLaunchOptions } = require("./browser.cjs");
const { buildSync } = require("esbuild");
const path = require("node:path");
const assert = require("node:assert/strict");

const bundle = buildSync({
  stdin: {
    contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from 'antd'; import Douyin from './src/Douyin'; createRoot(document.getElementById('root')).render(<App><Douyin jobs={[]} refresh={async()=>{}}>{()=>null}</Douyin></App>);",
    resolveDir: path.resolve(__dirname, ".."),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

(async () => {
  const browser = await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage();
    const calls = { loginStart: 0, loginStatus: 0, automaticAccount: 0, manualAccount: 0, browser: 0 };
    let scanned = false;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://douyin-login.test/**", async (route) => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      if (pathname === "/fixture.js")
        return route.fulfill({ body: bundle, contentType: "text/javascript" });
      if (pathname === "/api/v1/session")
        return route.fulfill({ json: { csrf_token: "test" } });
      if (pathname === "/api/v1/platforms/douyin/login") {
        if (req.method() === "POST") {
          calls.loginStart++;
          return route.fulfill({ json: {
            state: "waiting_scan", is_logged_in: false,
            img: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y4U0xQAAAAASUVORK5CYII=",
          } });
        }
        calls.loginStatus++;
        return route.fulfill({ json: scanned
          ? { state: "success", is_logged_in: true, creator_verified: true, user_id: "123", username: "扫码账号" }
          : { state: "verifying", is_logged_in: false } });
      }
      if (pathname === "/api/v1/platforms/douyin/account") {
        if (req.method() === "GET") calls.automaticAccount++;
        else calls.manualAccount++;
        return route.fulfill({ json: { state: "unverified", is_logged_in: false } });
      }
      if (pathname === "/api/v1/platforms/douyin/browser") {
        calls.browser++;
        return route.fulfill({ json: { state: "browser_open", is_logged_in: false } });
      }
      return route.fulfill({
        body: '<div id="root"></div><script src="/fixture.js"></script>',
        contentType: "text/html",
      });
    });

    await page.goto("http://douyin-login.test/");
    await page.getByRole("button", { name: "抖音扫码登录" }).click();
    let dialog = page.getByRole("dialog", { name: "扫码连接抖音" });
    await dialog.getByText("验证中，正在核实创作者中心账号").first().waitFor();
    await page.waitForTimeout(2500);
    assert.equal(calls.loginStart, 1,
      "Passive status checks must not request a second QR or reload the official page");
    await dialog.getByRole("button", { name: "检查登录状态" }).click();
    assert.equal(calls.manualAccount, 1);
    await dialog.getByRole("button", { name: /完\s*成/ }).click();
    await dialog.waitFor({ state: "hidden" });
    scanned = true;
    await page.getByText("扫码账号").first().waitFor();
    assert.ok(calls.loginStatus >= 2,
      "Login status must keep updating after the QR dialog closes");
    assert.equal(calls.automaticAccount, 0,
      "Automatic polling must not open account probe tabs");

    scanned = false;
    await page.reload();
    await page.getByRole("button", { name: "抖音扫码登录" }).click();
    dialog = page.getByRole("dialog", { name: "扫码连接抖音" });
    await dialog.getByRole("button", { name: "打开专用官方浏览器" }).click();
    await dialog.waitFor({ state: "hidden" });
    scanned = true;
    await page.getByText("扫码账号").first().waitFor();
    assert.equal(calls.browser, 1);
    assert.equal(calls.automaticAccount, 0);
    assert.deepEqual(errors, []);
    console.log("PASS: Douyin login keeps observing after the QR dialog closes, auto-connects after scan, and avoids automatic account probe tabs.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

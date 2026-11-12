const fs = require("node:fs"),
  path = require("node:path");
const runtime = [
  "../../douyin/node_modules/playwright",
  "../../../../douyin/node_modules/playwright",
]
  .map((value) => path.resolve(__dirname, value))
  .find((value) => fs.existsSync(value));
if (!runtime)
  throw Error(
    "Playwright runtime missing; install the douyin package dependencies first.",
  );
const { chromium } = require(runtime);
const configured = process.env.WORKBENCH_TEST_CHROMIUM;
const cached = path.join(
  process.env.LOCALAPPDATA || "",
  "ms-playwright/chromium-1243/chrome-win64/chrome.exe",
);
const browserLaunchOptions = {
  headless: true,
  ...(configured || fs.existsSync(cached)
    ? { executablePath: configured || cached }
    : {}),
};
module.exports = { chromium, browserLaunchOptions };

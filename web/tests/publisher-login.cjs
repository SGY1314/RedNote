const assert = require("node:assert/strict"),
  path = require("node:path"),
  Module = require("node:module");
const { buildSync } = require("esbuild"),
  React = require("react"),
  { renderToStaticMarkup } = require("react-dom/server"),
  { App } = require("antd");
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(
  buildSync({
    stdin: {
      contents:
        'export {default as Panel} from "./src/PublisherPanel"; export * from "./src/publisherLogin";',
      resolveDir: path.resolve(__dirname, ".."),
      loader: "tsx",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0].text,
  __filename,
);
const { Panel, publisherLoginLabels, loginTerminal } = mod.exports;
for (const state of [
  "waiting_scan",
  "verifying",
  "verification_required",
  "expired",
  "failed",
  "success",
]) {
  const html = renderToStaticMarkup(
    React.createElement(
      App,
      null,
      React.createElement(Panel, {
        account: {
          state,
          is_logged_in: state === "success",
          username: "测试账号",
          user_id: state === "success" ? "id" : "",
        },
        open: false,
        onOpen() {},
        onAccount() {},
      }),
    ),
  );
  assert.ok(publisherLoginLabels[state]);
  assert.ok(!html.includes("platform-account-card"));
  assert.ok(!html.includes("上传到小红书"));
  assert.equal(loginTerminal(state), ["expired", "failed"].includes(state));
}
console.log(
  "PASS: login states remain distinct; closed post-data connection does not render an account publishing card.",
);

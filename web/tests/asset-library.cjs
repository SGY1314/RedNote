global.location = { hash: "" };
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { App } = require("antd");
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(
  buildSync({
    stdin: {
      contents:
        'export * from "./src/assetLibrary";export {default as Results} from "./src/ImageGenerationResults";export {default as Library} from "./src/MediaLibrary";',
      resolveDir: path.resolve(__dirname, ".."),
      loader: "tsx",
    },
    bundle: true,
    packages: "external",
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  __filename,
);
const { inMediaLibrary, Results, Library } = mod.exports;
const result = {
  id: "generated",
  name: "尚未存入的生成图片",
  kind: "image",
  status: "ready",
  source: "generated",
  library_state: "result",
  created_at: "2026-10-15T00:00:00Z",
  width: 20,
  height: 30,
};
const legacy = {
  ...result,
  id: "legacy",
  name: "已有素材",
  library_state: undefined,
};
assert.equal(inMediaLibrary(result), false);
assert.equal(inMediaLibrary({ ...result, kind: "video" }), false);
assert.equal(inMediaLibrary({ ...result, library_state: "saved" }), true);
assert.equal(inMediaLibrary(legacy), true);
assert.equal(inMediaLibrary({ ...legacy, source: "collection", library_state: "collected" }), false);
assert.equal(inMediaLibrary({ ...legacy, source: "collection", library_state: "saved" }), true);
assert.equal(
  inMediaLibrary({ ...legacy, source: "collection", status: "remote" }),
  false,
);
const render = (component, props) =>
  renderToStaticMarkup(
    React.createElement(App, null, React.createElement(component, props)),
  );
const props = {
  jobs: [{ id: "j", result: result.id, state: "succeeded", stage: "已完成" }],
  assets: [result],
  selected: [],
  canAdd: true,
  disabled: false,
  onAdd: async () => {},
  onRemove: async () => {},
  onAddMany: async () => {},
  refresh: async () => {},
};
let html = render(Results, props);
assert.ok(html.includes("下载到素材库") && html.includes("加入发布素材"));
html = render(Results, { ...props, selected: [result.id] });
assert.ok(html.includes("取消加入发布素材") && html.includes("下载到素材库"));
html = render(Results, {
  ...props,
  assets: [{ ...result, library_state: "saved" }],
});
assert.ok(html.includes("已存入素材库") && html.includes("加入发布素材"));
html = render(Library, {
  assets: [result, legacy],
  embedded: true,
  open: true,
  onClose() {},
  refresh: async () => {},
});
assert.ok(html.includes("已有素材") && !html.includes(result.name));
console.log(
  "PASS: generated results, library membership and publication selection remain independent; legacy library retained.",
);

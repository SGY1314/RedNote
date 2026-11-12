const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/publicationSelection.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  __filename,
);
const { publicationSelection } = mod.exports;
const make = (id, extra = {}) => ({
  id,
  kind: "image",
  status: "ready",
  source: "upload",
  ...extra,
});
const assets = [
  make("a"),
  make("b"),
  make("c"),
  make("result", { library_state: "result" }),
  make("deleted", { deleted_at: "2026-10-16" }),
  make("remote", { status: "remote" }),
  make("video", { kind: "video" }),
];
const selection = publicationSelection(
  assets,
  ["b", "b", "result", "missing", "deleted", "remote", "video"],
  "image",
);
assert.deepEqual(selection.ids, ["b", "result"]);
assert.deepEqual(selection.unavailable, [
  "missing",
  "deleted",
  "remote",
  "video",
]);
assert.deepEqual(
  selection.available.map((a) => a.id),
  ["b", "result"],
);
assert.deepEqual(
  publicationSelection(assets, ["result", "b"], "image").available.map((a) => a.id),
  ["result", "b"],
);
assert.deepEqual(publicationSelection(assets, [], "image").available, []);
assert.deepEqual(
  publicationSelection(assets, ["video", "video", "a"], "video").ids,
  ["video"],
);
console.log(
  "PASS: publication selection displays only unique usable selected media in saved order, including selected results.",
);

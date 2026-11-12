const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const source = buildSync({
  entryPoints: [path.join(__dirname, "../src/sync.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const mod = new Module("sync");
mod._compile(source, "sync.cjs");
const { mergeChanges } = mod.exports;
const old = [
  { id: "a", name: "original", created_at: "2026-01-01" },
  { id: "b", created_at: "2026-01-02" },
];
assert.equal(mergeChanges(old, "assets", { changes: [], reset: false }), old);
const result = mergeChanges(old, "assets", {
  reset: false,
  changes: [
    { entity: "assets", id: "a", value: { ...old[0], name: "renamed" } },
    { entity: "assets", id: "b", value: null },
    { entity: "jobs", id: "unrelated", value: { id: "unrelated" } },
    { entity: "assets", id: "c", value: { id: "c", created_at: "2026-01-03" } },
  ],
});
assert.deepEqual(
  result.map((x) => x.id),
  ["c", "a"],
);
assert.equal(result[1].name, "renamed");
assert.equal(old[0].name, "original");
assert.deepEqual(
  mergeChanges(result, "assets", { reset: true, changes: [] }),
  [],
);
console.log(
  "PASS: incremental update, deletion, reset, ordering, idle identity and entity isolation",
);

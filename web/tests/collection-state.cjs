const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  entryPoints: [path.join(__dirname, "../src/collectionState.ts")],
  bundle: true, write: false, platform: "node", format: "cjs",
}).outputFiles[0].text)(compiled, compiled.exports);
const { collectionState } = compiled.exports;
const note = { id: "n", revision_id: "r", url: "https://example.test/n" };
const asset = { id: "a", revision_id: "r", status: "ready" };
const job = { kind: "ocr", target: "a", state: "failed", error: "识别失败", updated_at: "2026-10-31T01:00:00Z" };
assert.equal(collectionState(note, [asset], []).label, "成功");
assert.equal(collectionState(note, [{ ...asset, status: "failed" }], []).label, "失败");
assert.equal(collectionState(note, [asset], [job]).label, "失败");
assert.equal(collectionState(note, [asset], [{ ...job, state: "succeeded", updated_at: "2026-10-31T02:00:00Z" }, job]).label, "成功");
assert.equal(collectionState(note, [asset], [{ ...job, target: "another-asset" }]).label, "成功");
assert.equal(collectionState(note, [asset], [{ ...job, kind: "collect", target: note.url }]).label, "失败");
assert.equal(collectionState(note, [asset], [{ ...job, state: "blocked" }]).label, "待配置");
assert.equal(collectionState(note, [asset], [{ ...job, state: "running" }]).label, "处理中");
assert.equal(collectionState(note, [], [{ ...job, target: "a" }]).label, "成功");
assert.equal(collectionState({ ...note, revision_id: "" }, [], []).label, "待处理");
console.log("PASS collection success/failure, retry recovery and unrelated task isolation.");

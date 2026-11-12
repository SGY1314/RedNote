const assert = require("node:assert/strict"),
  path = require("node:path"),
  Module = require("node:module"),
  { buildSync } = require("esbuild");
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/workspace/taskProjects.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0].text,
  __filename,
);
const { groupTaskProjects, matchesTaskSearch } = mod.exports;
const ref = {
  category: "collect",
  id: "note",
  name: "咖啡笔记",
  revision_id: "current",
  current_revision_id: "current",
};
const job = (id, kind, state, target, extra = {}) => ({
  id,
  kind,
  state,
  target,
  stage: "",
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  attempts: 1,
  task_project: { ...ref, item_name: id },
  ...extra,
});
const jobs = [
  job("metadata", "collect", "succeeded", "url"),
  job("cover.png", "download", "succeeded", "a"),
  job("video.mp4", "download", "failed", "b", { error: "视频下载失败" }),
  job("image.png", "download", "running", "c"),
];
let groups = groupTaskProjects(jobs);
assert.equal(groups.length, 1);
assert.equal(groups[0].total, 3);
assert.equal(groups[0].completed, 1);
assert.equal(groups[0].percent, 67);
assert.equal(groups[0].failures[0].id, "video.mp4");
assert.equal(groups[0].active, true);
assert(matchesTaskSearch(groups[0], "视频下载失败"));
jobs[2].state = "queued";
groups = groupTaskProjects(jobs);
assert.equal(groups[0].failures.length, 0);
assert.equal(groups[0].percent, 33);
const historical = job("old", "download", "failed", "old", {
  task_project: { ...ref, revision_id: "old" },
});
groups = groupTaskProjects([...jobs, historical]);
assert.equal(groups[0].total, 3);
assert.equal(groups[0].failures.length, 0);
assert.equal(groups[0].jobs.length, 5);
const image = job("generation", "image_generation", "running", "rewrite", {
  task_project: { category: "rewrite", id: "rewrite", name: "仿写项目" },
  payload: {
    series: {
      asset_ids: ["1", "2", "3"],
      scenes: ["1", "2", "3"],
      completed: ["1"],
      reference_limit: 3,
    },
  },
});
const publication = job("publish", "publish", "succeeded", "pub", {
  task_project: { category: "publish", id: "pub", name: "发布稿" },
});
groups = groupTaskProjects([...jobs, image, publication]);
assert.equal(groups.length, 3);
const rewrite = groups.find((g) => g.category === "rewrite");
assert.equal(rewrite.total, 3);
assert.equal(rewrite.completed, 1);
assert.equal(rewrite.percent, 33);
assert.equal(groups.find((g) => g.category === "publish").percent, 100);
console.log(
  "PASS: project grouping, media progress, per-material failures, retry recovery, stale history, generation batches and category isolation.",
);

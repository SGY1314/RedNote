const assert = require("node:assert/strict"),
  path = require("node:path"),
  Module = require("node:module");
const { buildSync } = require("esbuild");
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(
  buildSync({
    stdin: {
      contents:
        'export * from "./src/draftSync";export * from "./src/versionDiff";',
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
const { DraftSync, preferredDraft, versionChanges } = mod.exports;
(async () => {
  const calls = [],
    pending = [],
    messages = [];
  const sync = new DraftSync(
    (key, data) => {
      calls.push({ key, data });
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
    (key, text) => messages.push([key, text]),
  );
  sync.seed("p/image", 0);
  sync.seed("p/video", 0);
  sync.enqueue("p/image", { content: "first" });
  const first = sync.flush("p/image");
  sync.enqueue("p/image", { content: "latest" });
  assert.equal(calls.length, 1);
  pending[0].resolve({ revision: 1, saved_at: "2026-10-15T10:00:00Z" });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].data.content, "latest");
  assert.equal(calls[1].data.revision, 1);
  pending[1].resolve({ revision: 2, saved_at: "2026-10-15T10:00:01Z" });
  await first;
  sync.enqueue("p/image", { content: "latest" });
  await sync.flush("p/image");
  assert.equal(calls.length, 2);
  sync.enqueue("p/video", { content: "video" });
  const video = sync.flush("p/video");
  assert.equal(calls[2].data.revision, 0);
  pending[2].reject(Error("conflict"));
  await video;
  sync.enqueue("p/video", { content: "newer video" });
  await sync.flush("p/video");
  assert.equal(calls.length, 3);
  assert.ok(messages.at(-1)[1].includes("conflict"));
  assert.equal(preferredDraft(null, { content: "server" }).content, "server");
  assert.equal(
    preferredDraft(
      { content: "new", edited_at: "2026-10-15T12:00:00Z" },
      { content: "old", saved_at: "2026-10-15T11:00:00Z" },
    ).content,
    "new",
  );
  assert.equal(preferredDraft({content:'newer edit',edited_at:'2026-10-15T12:00:00Z'},{content:'old request',edited_at:'2026-10-15T11:00:00Z',saved_at:'2026-10-15T13:00:00Z'}).content,'newer edit');
  const v = {
    title: "a",
    body: "第一段\n第二段",
    topics: [],
    media: { kind: "image", asset_ids: ["1", "2"], cover_id: "" },
  };
  assert.deepEqual(versionChanges(v, v), ["发布内容相同"]);
  const d = versionChanges(v, {
    ...v,
    body: "第一段\n新段",
    media: { ...v.media, asset_ids: ["2", "1"], cover_id: "2" },
  });
  assert.ok(d.some((x) => x.includes("第 2 段")));
  assert.ok(d.includes("素材顺序已调整"));
  assert.ok(d.includes("封面已更换"));
  console.log(
    "PASS: serialized autosave, later edits, per-format revisions, conflicts, restoration and publication differences",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

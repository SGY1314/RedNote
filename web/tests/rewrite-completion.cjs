const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const source = buildSync({
  entryPoints: [path.join(__dirname, "../src/rewriteCompletion.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const mod = new Module("rewriteCompletion");
mod._compile(source, "rewriteCompletion.cjs");
const {
  restoreGeneratedText,
  rewriteCompletionAction,
  rewriteDraftFingerprint,
} = mod.exports;
const blank = {
  content: { title: "", body: "", topics: [] },
  versionID: "",
  sourceIDs: ["original"],
  media: {
    kind: "video",
    asset_ids: ["chosen-video"],
    cover_id: "chosen-cover",
  },
};
const generated = {
  id: "v3",
  title: "完整标题",
  body: "完整视频正文",
  topics: ["生活"],
  source_ids: ["original"],
  media: { kind: "video", asset_ids: ["old-video"], cover_id: "" },
};
const original = JSON.stringify(blank);
const restored = restoreGeneratedText(blank, generated);
assert.equal(restored.content.title, generated.title);
assert.equal(restored.content.body, generated.body);
assert.equal(restored.versionID, "v3");
assert.deepEqual(
  restored.media,
  blank.media,
  "restore must retain newly selected video and cover",
);
assert.equal(JSON.stringify(blank), original, "do not mutate stored snapshot");
assert.equal(
  rewriteCompletionAction(blank, true),
  "restore-text",
  "empty media draft must not block generated copy",
);
assert.strictEqual(
  restoreGeneratedText(blank),
  blank,
  "no result must remain empty",
);
assert.strictEqual(
  restoreGeneratedText(blank, {
    ...generated,
    media: { kind: "image", asset_ids: [] },
  }),
  blank,
  "image result must not enter video draft",
);

const submitted = rewriteDraftFingerprint(blank);
assert.equal(rewriteCompletionAction(blank, true, submitted), "apply");
const edited = {
  ...blank,
  content: { ...blank.content, body: "我在等待时手动输入的新内容" },
};
assert.equal(rewriteCompletionAction(edited, true, submitted), "preserve");
assert.strictEqual(
  restoreGeneratedText(edited, generated),
  edited,
  "preserve nonempty draft on reload",
);
const changedMedia = {
  ...blank,
  media: { ...blank.media, asset_ids: ["new-video"] },
};
assert.equal(
  rewriteCompletionAction(changedMedia, true, submitted),
  "preserve",
  "do not silently overwrite changed media",
);
const changedVersion = { ...blank, versionID: "v2" };
assert.equal(rewriteCompletionAction({...blank,creative:{angle:"等待生成时的新角度"}},true,submitted),"preserve","creative edits during generation must survive");
assert.equal(
  rewriteCompletionAction(changedVersion, false, submitted),
  "preserve",
  "manual version switch must win",
);
assert.strictEqual(
  restoreGeneratedText(changedVersion, generated),
  changedVersion,
  "intentional deletion of old text must survive reload",
);
assert.equal(
  rewriteCompletionAction(edited, true, rewriteDraftFingerprint(edited)),
  "apply",
  "unchanged nonempty submission should receive generated new version",
);
assert.equal(
  rewriteCompletionAction(edited, true),
  "preserve",
  "unknown submission after reload must preserve edits",
);
const changedTopics = {
  ...blank,
  content: { ...blank.content, topics: ["手动话题"] },
};
assert.equal(
  rewriteCompletionAction(changedTopics, true, submitted),
  "preserve",
);
console.log(
  "PASS: empty video draft recovery, generated copy autofill, unchanged submission, edits/media/version protection and format isolation",
);

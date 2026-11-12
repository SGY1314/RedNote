const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const mod = new Module("completion");
mod._compile(
  buildSync({
    entryPoints: [path.join(__dirname, "../src/rewriteCompletion.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
  "completion.cjs",
);
const source = ts.createSourceFile(
  "Rewrites.tsx",
  fs.readFileSync(path.join(__dirname, "../src/Rewrites.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function handler(name) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `missing production handler ${name}`);
  return ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(name) {
  const request = deferred(),
    reload = deferred(),
    calls = [];
  const content = { title: "提交时标题", body: "原正文", topics: [] };
  const media = { kind: "image", asset_ids: ["image-a"], cover_id: "" };
  const v = {
    id: "v2",
    number: 2,
    title: "提交时标题",
    body: "原正文",
    topics: [],
    media,
  };
  const ctx = {
    mediaSaving: { current: false },
    uploadInProgress: { current: false },
    versionMutation: { current: false },
    selectedID: "a",
    selectedProject: { current: "a" },
    editorVisit: { current: { epoch: 1 } },
    content,
    versionID: "v1",
    sourceIDs: ["original"],
    requirements: "",
    creative: {},
    currentRequirements: { current: "" },
    kind: "image",
    chosen: media.asset_ids,
    cover: "",
    workspaceKind: "image",
    project: { kind: "image" },
    v,
    confirm: true,
    completionEditor: {
      current: {
        projectID: "a",
        content,
        versionID: "v1",
        sourceIDs: ["original"],
        media,
      },
    },
    rewriteDraftFingerprint: mod.exports.rewriteDraftFingerprint,
    setBusy: (value) => calls.push(["busy", value]),
    post: async (...args) => {
      calls.push(["post", ...args]);
      return request.promise;
    },
    patch: async (...args) => {
      calls.push(["patch", ...args]);
      return request.promise;
    },
    load: async () => {
      calls.push(["load"]);
      return reload.promise;
    },
    applyVersion: (value) => calls.push(["apply", value.id]),
    clearFormatDraft: (...args) => calls.push(["clear", ...args]),
    setProject: () => calls.push(["project"]),
    setReadyGenerated: () => {},
    setCompare: () => {},
    message: {
      success: () => {},
      info: () => {},
      error: (e) => {
        throw Error(e);
      },
    },
  };
  const fn = vm.runInNewContext(handler(name), ctx);
  return { ctx, fn, calls, request, reload, v };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  {
    const f = fixture("persistMedia");
    assert.equal(
      await f.fn({
        kind: "image",
        asset_ids: ["image-a", "image-a"],
        cover_id: "",
      }),
      true,
    );
    assert.equal(
      f.calls.length,
      0,
      "selecting the same asset again must not write or refresh",
    );
    f.ctx.mediaSaving.current = true;
    assert.equal(await f.fn({ kind: "image", asset_ids: ["image-b"] }), false);
    assert.equal(
      f.calls.length,
      0,
      "an in-flight selection must not be submitted twice",
    );
  }
  for (const scenario of [
    "unchanged",
    "typing",
    "media",
    "project",
    "leave-return",
    "during-reload",
  ]) {
    const f = fixture("save");
    const pending = f.fn();
    if (scenario === "typing")
      f.ctx.completionEditor.current.content = {
        ...f.ctx.content,
        body: "刚输入的新正文",
      };
    if (scenario === "media")
      f.ctx.completionEditor.current.media = {
        kind: "image",
        asset_ids: ["image-b"],
        cover_id: "",
      };
    if (scenario === "project") f.ctx.selectedProject.current = "b";
    if (scenario === "leave-return") f.ctx.editorVisit.current.epoch += 2;
    f.request.resolve(f.v);
    await tick();
    if (scenario === "during-reload")
      f.ctx.completionEditor.current.content = {
        ...f.ctx.content,
        title: "加载列表期间的新标题",
      };
    f.reload.resolve();
    await pending;
    assert.equal(
      f.calls.some((x) => x[0] === "apply"),
      scenario === "unchanged",
      scenario,
    );
    assert.equal(
      f.calls.some((x) => x[0] === "clear"),
      scenario === "unchanged",
      `${scenario}: preserve local draft`,
    );
    assert.equal(f.ctx.versionMutation.current, false);
  }
  {
    const f = fixture("save");
    const pending = f.fn();
    await f.fn();
    assert.equal(f.calls.filter((x) => x[0] === "post").length, 1);
    f.request.resolve(f.v);
    f.reload.resolve();
    await pending;
  }
  for (const scenario of ["unchanged", "typing", "project", "leave-return"]) {
    const f = fixture("choose");
    const pending = f.fn();
    if (scenario === "typing")
      f.ctx.completionEditor.current.content = {
        ...f.ctx.content,
        title: "不要覆盖我",
      };
    if (scenario === "project") f.ctx.selectedProject.current = "b";
    if (scenario === "leave-return") f.ctx.editorVisit.current.epoch += 2;
    f.request.resolve({ kind: "image", asset_ids: ["image-a"] });
    f.reload.resolve();
    await pending;
    assert.equal(
      f.calls.some((x) => x[0] === "apply"),
      scenario === "unchanged",
      `choose ${scenario}`,
    );
    assert.equal(
      f.calls.some((x) => x[0] === "clear"),
      scenario === "unchanged",
      `choose ${scenario}: preserve draft`,
    );
    assert.equal(
      f.calls.some((x) => x[0] === "post"),
      scenario === "unchanged",
      `choose ${scenario}: no stale confirmation`,
    );
  }
  {
    const f = fixture("choose"),
      confirmation = deferred();
    f.ctx.post = () => confirmation.promise;
    const pending = f.fn();
    f.request.resolve({ kind: "image" });
    await tick();
    f.ctx.completionEditor.current.content = {
      ...f.ctx.content,
      body: "确认请求进行中输入的新内容",
    };
    confirmation.resolve();
    await pending;
    assert.equal(
      f.calls.some((x) => x[0] === "apply" || x[0] === "clear"),
      false,
      "confirmation response must also preserve later edits",
    );
  }
  console.log(
    "PASS: production save/version handlers preserve later edits, media, project changes and return visits; duplicate save blocked.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

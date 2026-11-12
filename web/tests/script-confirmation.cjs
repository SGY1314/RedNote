const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const source = ts.createSourceFile(
  "VideoDirector.tsx",
  fs.readFileSync(path.join(__dirname, "../src/VideoDirector.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function button(name) {
  let callback;
  function walk(n) {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(source) === "Button" &&
      n.children.some((c) => ts.isJsxText(c) && c.text.trim() === name)
    ) {
      callback = n.openingElement.attributes.properties
        .find((p) => p.name?.getText(source) === "onClick")
        ?.initializer?.expression?.getText(source);
    }
    ts.forEachChild(n, walk);
  }
  walk(source);
  assert.ok(callback, `button not found: ${name}`);
  return ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
(async () => {
  for (const { dirty, stale } of [
    { dirty: true, stale: false },
    { dirty: false, stale: false },
    { dirty: false, stale: true },
  ]) {
    const changed = dirty || stale;
    const old = {
        id: "s1",
        title: "修改后的脚本",
        brief: { copy_text: "旧文案", copy_key: "old" },
      },
      calls = [];
    let action;
    const ctx = {
      projectID: "p",
      draft: old,
      dirty,
      stale,
      text: "当前已确认文案",
      workflowCopyKey: "copy-current",
      post: async (url, input) => {
        calls.push([url, input]);
        return url.endsWith("/confirm")
          ? { ...ctx.draft, confirmed_at: "now" }
          : { ...input, id: "s2" };
      },
      setDraft: (v) => {
        ctx.draft = v;
      },
      setScripts() {},
      message: { success() {} },
      action: (fn) => {
        action = fn();
        return action;
      },
    };
    vm.runInNewContext(button("确认完整脚本"), ctx)();
    await action;
    assert.equal(calls.length, changed ? 2 : 1);
    assert.ok(
      calls[calls.length - 1][0].endsWith(`/${changed ? "s2" : "s1"}/confirm`),
    );
    assert.equal(ctx.draft.confirmed_at, "now");
    if (changed) {
      assert.equal(calls[0][1].brief.copy_text, ctx.text);
      assert.equal(calls[0][1].brief.copy_key, ctx.workflowCopyKey);
      assert.equal(calls[0][1].parent_id, "s1");
      assert.equal(old.id, "s1");
    }
  }
  let confirmation,
    action,
    removed = [];
  const ctx = {
    projectID: "p",
    draft: { id: "s1" },
    draftKey: "draft",
    suppressDefault: { current: false },
    waiting: { current: "job" },
    post: async (url) => {
      assert.ok(url.endsWith("/s1/cancel"));
      return { id: "s1", cancelled_at: "now" };
    },
    modal: {
      confirm: (opts) => {
        confirmation = opts;
      },
    },
    action: (fn) => {
      action = fn();
      return action;
    },
    localStorage: { setItem() {}, removeItem: (k) => removed.push(k) },
    setScripts() {},
    setDraft: (v) => (ctx.draft = v),
    message: { success() {} },
  };
  vm.runInNewContext(button("取消该脚本"), ctx)();
  await confirmation.onOk();
  await action;
  assert.equal(ctx.draft, undefined);
  assert.equal(ctx.suppressDefault.current, true);
  assert.equal(ctx.waiting.current, "");
  assert.ok(removed.includes("draft"));
  console.log(
    "PASS: edited scripts save before confirmation; unchanged scripts do not duplicate; cancellation clears current draft and prevents default reopening.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

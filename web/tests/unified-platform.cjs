const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function source(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function find(tree, predicate) {
  let result;
  function visit(node) {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, "handler not found");
  return result;
}
function execute(text, context) {
  return vm.runInNewContext(
    ts.transpileModule(`(${text})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
}
(async () => {
  const app = source("App.tsx");
  const route = find(
    app,
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "parseRoute",
  );
  const adminKeys = execute(
    find(
      app,
      (n) => ts.isVariableDeclaration(n) && n.name.getText(app) === "adminKeys",
    ).initializer.getText(app),
    {},
  );
  assert.deepEqual(Array.from(adminKeys), [
    "overview",
    "users",
    "models",
    "prompts",
    "usage",
  ]);
  for (const hash of ["#rewrites", "#xhs/rewrites", "#douyin/rewrites"]) {
    const got = execute(route.getText(app), {
      pages: [{ key: "rewrites" }],
      utilityPages: [{ key: "settings" }, { key: "tasks" }],
      adminKeys,
    })(hash);
    assert.equal(got.page, "rewrites");
    assert.equal(
      got.platform,
      undefined,
      "legacy route must not scope the workspace",
    );
  }
  for (const [hash, area, page] of [
    ["#/settings", "workspace", "settings"],
    ["#tasks", "workspace", "tasks"],
    ["#/admin/tasks", "admin", "overview"],
    ["#admin/audit", "admin", "overview"],
    ["#/admin/login", "admin-login", "login"],
    ["#not-a-page", "workspace", "collections"],
  ]) {
    const got = execute(route.getText(app), {
      pages: [{ key: "collections" }],
      utilityPages: [{ key: "settings" }, { key: "tasks" }],
      adminKeys,
    })(hash);
    assert.equal(got.area, area);
    assert.equal(got.page, page);
  }
  const collections = source("Collections.tsx");
  const submit = find(
    collections,
    (n) =>
      ts.isVariableDeclaration(n) && n.name.getText(collections) === "submit",
  ).initializer;
  let submitted;
  await execute(submit.getText(collections), {
    text: "mixed platform links",
    platform: "xhs",
    sending: false,
    setSending() {},
    setCaptureJobs() {},
    setCaptureItems() {},
    setCaptureOpen() {},
    setText() {},
    setDetailID() {},
    load() {},
    refresh: async () => {},
    message: {
      info() {},
      success() {},
      error(e) {
        throw Error(e);
      },
    },
    post: async (path, body) => {
      submitted = body;
      return { items: [] };
    },
  })();
  assert.equal(
    submitted.platform,
    undefined,
    "list filter must not reject mixed input",
  );
  assert.equal(submitted.text, "mixed platform links");

  const rewrites = source("Rewrites.tsx");
  const modal = find(
    rewrites,
    (n) =>
      ts.isJsxOpeningElement(n) &&
      n.tagName.getText(rewrites) === "Modal" &&
      n.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.text === "title" &&
          a.initializer?.text === "从完整版本建立发布稿",
      ),
  );
  const handler = modal.attributes.properties.find(
    (a) => a.name?.text === "onOk",
  ).initializer.expression;
  for (const target of ["xhs", "douyin", "both"]) {
    let created,
      navigated = false;
    await execute(handler.getText(rewrites), {
      platform: target === "xhs" ? "douyin" : "xhs",
      publishPlatform: target,
      versionID: "confirmed-version",
      creatingPublication: { current: false },
      publicationRequest: { current: { key: "", id: "" } },
      editorVisit: { current: { projectID: "p", epoch: 0 } },
      setPublicationBusy() {},
      crypto: { randomUUID: () => "request-" + target },
      post: async (path, body) => {
        assert.equal(path, "/publications");
        created = body;
      },
      refresh: async () => {},
      setPublishModal() {},
      onPublish: () => {
        navigated = true;
      },
      message: {
        success() {},
        error(e) {
          throw Error(e);
        },
      },
    })();
    assert.equal(
      created.target_platform,
      target,
      "publication must use explicit target rather than source platform",
    );
    assert.equal(created.version_id, "confirmed-version");
    assert.equal(created.request_id, "request-" + target);
    assert.equal(navigated, true);
  }
  const requests = [];
  let finishRequest;
  let attempts = 0,
    uuidCalls = 0,
    navigations = 0;
  const context = {
    publishPlatform: "both",
    versionID: "confirmed-version",
    creatingPublication: { current: false },
    publicationRequest: { current: { key: "", id: "" } },
    editorVisit: { current: { projectID: "p", epoch: 0 } },
    setPublicationBusy() {},
    setPublishModal() {},
    refresh: async () => {},
    crypto: { randomUUID: () => "retry-" + ++uuidCalls },
    onPublish: () => {
      navigations++;
    },
    message: { success() {}, error() {} },
    post: async (path, body) => {
      requests.push(body);
      if (++attempts === 1) {
        await new Promise((resolve) => {
          finishRequest = resolve;
        });
        throw Error("response lost");
      }
    },
  };
  const submitPublication = execute(handler.getText(rewrites), context);
  const first = submitPublication();
  await submitPublication();
  assert.equal(requests.length, 1, "double click must not submit twice");
  finishRequest();
  await first;
  await submitPublication();
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].request_id,
    requests[1].request_id,
    "retry after a lost response must reuse the original request ID",
  );
  assert.equal(uuidCalls, 1);
  assert.equal(navigations, 1);
  assert.equal(context.creatingPublication.current, false);
  const douyin = source("Douyin.tsx");
  const prepareModal = find(
    douyin,
    (n) =>
      ts.isJsxOpeningElement(n) &&
      n.tagName.getText(douyin) === "Modal" &&
      n.attributes.properties.some(
        (a) =>
          a.name?.text === "title" &&
          a.initializer?.text === "上传到抖音编辑页",
      ),
  );
  const prepareHandler = prepareModal.attributes.properties.find(
    (a) => a.name?.text === "onOk",
  ).initializer.expression;
  for (const verified of [true, false]) {
    const calls = [];
    const prepare = execute(prepareHandler.getText(douyin), {
      perform: (fn) => fn(),
      setAccount() {},
      setDraft() {},
      refresh: async () => {},
      message: { success() {}, info() {} },
      draft: { id: "draft-douyin" },
      visibility: "self",
      post: async (path, body) => {
        calls.push({ path, body });
        return {
          user_id: "123",
          is_logged_in: true,
          creator_verified: verified,
          main_verified: !verified,
        };
      },
    });
    if (verified) {
      await prepare();
      assert.equal(calls[1].path, "/publications/draft-douyin/publish-prepare");
      assert.equal(calls[1].body.account_id, "123");
    } else {
      await assert.rejects(prepare(), /创作者中心账号/);
      assert.equal(
        calls.length,
        1,
        "main-site login must not authorize upload",
      );
    }
  }
  console.log(
    "PASS: legacy route compatibility, mixed collection submission and explicit cross-platform publication targets.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

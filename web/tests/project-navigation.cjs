const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const source = ts.createSourceFile(
  "App.tsx",
  fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler, selection, selectedProject;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "createProject"
  )
    handler = node.initializer.getText(source);
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "selectedID")
    selection = node.initializer.expression.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "selectedProjectID")
    selectedProject = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (selection === "selectedProjectID") selection = selectedProject;
const compile = (text) =>
  ts.transpileModule(`(${text})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
(async () => {
  let release;
  const pending = new Promise((r) => (release = r));
  let calls = 0,
    successText = "",
    projects = [{ id: "old", platform: "xhs" }],
    navigated;
  const context = {
    creatingProject: { current: false },
    setProjectCreating: () => {},
    setNewProjectOpen: () => {},
    platform: "xhs",
    projectID: "old",
    platformProjects: projects,
    post: async (path, body) => {
      assert.equal(
        body.platform,
        undefined,
        "source project creation must infer platform from its note",
      );
      calls++;
      return { id: "new", platform: "xhs", reused: calls > 1 };
    },
    setProjects: (fn) => {
      projects = fn(projects);
    },
    setProjectID: (id) => {
      context.projectID = id;
    },
    navigate: (page) => {
      navigated = page;
      assert.equal(
        vm.runInNewContext(compile(selection), context),
        "new",
        "new ID must be visible even before the project list synchronizes",
      );
    },
    refresh: () => pending,
    message: {
      success(text) {
        successText = text;
      },
      error(e) {
        throw Error(e);
      },
    },
  };
  const create = vm.runInNewContext(compile(handler), context);
  const request = create("note", "image");
  await new Promise((r) => setImmediate(r));
  await create("note", "image");
  assert.equal(calls, 1, "double click should not create a second project");
  assert.equal(navigated, "rewrites");
  assert.equal(projects[0].id, "new");
  assert.equal(context.projectID, "new");
  release();
  await request;
  assert.equal(context.creatingProject.current, false);
  await create("note", "image");
  assert.equal(
    projects.filter((p) => p.id === "new").length,
    1,
    "reused project must not be appended twice",
  );
  assert.equal(context.projectID, "new");
  assert.ok(successText.includes("已打开原项目"));
  console.log(
    "PASS: newly collected project opens before sync finishes; stale lists cannot select the previous project; double creation blocked.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

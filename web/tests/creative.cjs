const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { App } = require("antd");
const compiled = buildSync({
  stdin: {
    contents:
      'export * from "./src/creative"; export {default as ImagePlanning} from "./src/ImagePlanning"; export {default as AngleSuggestions} from "./src/AngleSuggestions";',
    resolveDir: path.resolve(__dirname, ".."),
    loader: "tsx",
  },
  bundle: true,
  packages: "external",
  write: false,
  platform: "node",
  format: "cjs",
}).outputFiles[0].text;
const mod = new Module(__filename);
mod.paths = module.paths;
mod._compile(compiled, __filename);
const {
  creativeSignature,
  CreativeControls,
  VersionCreative,
  ImagePlanning,
  AngleSuggestions,
  readCreative,
} = mod.exports;
const c = {
  topic: "租房桌面整理",
  angle: "共享角度",
  image_angle: "图片专用",
  image_hook: "detail",
  video_hook: "action",
};
assert.equal(
  creativeSignature(c, "image"),
  creativeSignature({ ...c, angle: "改变共享角度" }, "image"),
);
assert.notEqual(
  creativeSignature(c, "video"),
  creativeSignature({ ...c, angle: "改变共享角度" }, "video"),
);
const render = (Component, props) =>
  renderToStaticMarkup(
    React.createElement(App, null, React.createElement(Component, props)),
  );
assert.notEqual(
  creativeSignature(c, "image"),
  creativeSignature({ ...c, topic: "新主题" }, "image"),
);
assert.ok(
  render(CreativeControls, {
    medium: "image",
    value: c,
    onChange() {},
  }).includes("首图吸引方式"),
);
assert.ok(
  render(CreativeControls, {
    medium: "video",
    value: { ...c, video_hook: "custom", video_custom: "接住杯子" },
    onChange() {},
  }).includes("接住杯子"),
);
const base = {
  projectID: "p",
  models: [],
  defaultModelID: "m",
  count: 1,
  copyText: "新文案",
  prompt: "",
  referenceIDs: [],
  scenes: ["手动修改画面"],
  onApply() {},
  refresh: async () => {},
  onBusyChange() {},
  creative: c,
};
const jobs = [
  {
    id: "j",
    target: "p",
    kind: "image_plan",
    state: "succeeded",
    created_at: "2026-10-13",
    payload: {
      input: { copy_text: "旧文案", creative: c },
      plan: { scenes: ["原画面"] },
    },
  },
];
const stale = render(ImagePlanning, { ...base, jobs });
assert.ok(stale.includes("可重新规划") && stale.includes("查看最近的规划"));
const compare = render(VersionCreative, {
  version: {
    creative: c,
    generation_records: [
      {
        asset_id: "a",
        kind: "image_generation",
        model: "test-model",
        details: {
          creative: { angle: "生成时旧角度", image_hook: "result" },
          scenes: ["旧图对应画面"],
        },
      },
    ],
  },
});
assert.ok(
  compare.includes("生成时旧角度") &&
    compare.includes("租房桌面整理") &&
    compare.includes("共享角度") &&
    compare.includes("旧图对应画面"),
);
const suggestions = render(AngleSuggestions, {
  projectID: "p",
  modelID: "m",
  configured: false,
  sourceIDs: [],
  text: "",
  audience: "",
  requirements: "",
  creative: c,
  jobs: [],
  refresh: async () => {},
  onChoose() {},
});
assert.ok(
  suggestions.includes("AI 建议角度") && suggestions.includes("disabled"),
);
global.localStorage = { getItem: () => "{bad json" };
assert.equal(readCreative("p"), undefined);
console.log(
  "PASS: medium angle inheritance, custom hooks, stale plan notice, historical provenance and unconfigured suggestion controls.",
);
const props = {
  projectID: "p",
  modelID: "m",
  configured: true,
  sourceIDs: [],
  text: "",
  audience: "",
  requirements: "",
  creative: {},
  jobs: [
    {
      id: "failed-old",
      kind: "angle_suggest",
      target: "p",
      created_at: "2026-10-15",
      state: "failed",
      error: "角度建议格式不正确，请重试或手动填写",
    },
  ],
  refresh: async () => {},
  onChoose() {},
};
const empty = render(AngleSuggestions, props);
const topicOnly = render(AngleSuggestions, {
  ...props,
  creative: { topic: "租房桌面整理" },
});
assert.ok(
  !topicOnly.includes("disabled"),
  "topic alone should permit suggestions before writing copy",
);
const bodyOnly = render(AngleSuggestions, { ...props, text: "已写好的正文" });
assert.ok(
  !bodyOnly.includes("disabled"),
  "copy alone should permit topic suggestions",
);
const both = render(AngleSuggestions, {
  ...props,
  text: "已写好的正文",
  creative: { topic: "租房桌面整理" },
});
assert.ok(
  !both.includes("disabled"),
  "topic and copy together should permit suggestions",
);
assert.ok(
  render(AngleSuggestions, {
    ...props,
    text: "  \n ",
    creative: { topic: "  " },
  }).includes("disabled"),
);
assert.ok(empty.includes("先填写主题") && empty.includes("disabled"));
assert.ok(empty.includes("查看上次任务记录"));
assert.ok(
  !empty.includes("角度建议格式不正确") && !empty.includes("ant-alert-warning"),
);
const referenced = render(AngleSuggestions, {
  ...props,
  sourceIDs: ["reference"],
  hasReferenceContent: true,
});
assert.ok(referenced.includes("角度可以留空"));
assert.ok(!referenced.includes("disabled"));
console.log(
  "PASS: empty angle input does not display old failure; valid reference permits suggestions without manually entering an angle.",
);

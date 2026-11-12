const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { App: AntApp } = require("antd");
const built = buildSync({
  stdin: {
    contents:
      'export {default as MediaLibrary} from "./src/MediaLibrary"; export {default as ImageGenerator} from "./src/ImageGeneration"; export {default as Shell} from "./src/App"; export {default as Rewrites} from "./src/Rewrites"; export {default as Publications} from "./src/Publications"; export {default as Surface} from "./src/WorkspaceSurface";',
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
mod._compile(built, __filename);
const { Shell, Rewrites, Publications, Surface, ImageGenerator, MediaLibrary } =
  mod.exports;
global.location = { hash: "#xhs/collections" };
global.localStorage = {
  getItem: (key) => (key === "gin.sidebar.collapsed" ? "false" : null),
  setItem() {},
  removeItem() {},
};
const render = (component, props) =>
  renderToStaticMarkup(
    React.createElement(AntApp, null, React.createElement(component, props)),
  );
const shell = render(Shell, {});
for (const label of [
  "收起侧边栏",
  "内容工作台",
  "后台任务",
  "列配置",
  "全部平台",
])
  assert.ok(shell.includes(label), `shell missing ${label}`);
global.localStorage.getItem = (key) =>
  key === "gin.sidebar.collapsed" ? "true" : null;
assert.ok(!shell.includes("读取剪贴板") && !shell.includes("读取并采集"));
assert.ok(!shell.includes("切换到抖音") && !shell.includes("切换到小红书"));
const collapsed = render(Shell, {});
assert.ok(collapsed.includes("sidebar-collapsed"));
assert.ok(collapsed.includes("展开侧边栏"));
const project = {
  id: "p1",
  name: "示例创作项目",
  sources: [],
  created_at: "2026-10-12T12:00:00Z",
  kind: "image",
};
const rewrites = render(Rewrites, {
  projects: [project],
  assets: [],
  jobs: [],
  selectedID: "p1",
  onSelect() {},
  onCreate() {},
  refresh: async () => {},
  onPublish() {},
  openMedia() {},
});
for (const label of [
  "rewrite-projects",
  "示例创作项目",
  "文案编辑",
  "图片仿写",
  "视频仿写",
  "素材库",
  "发布素材",
  "项目与模型管理",
])
  assert.ok(rewrites.includes(label), `rewrite layout missing ${label}`);
assert.ok(rewrites.includes("<details"), "reference material stays accessible");
const pub = render(Publications, {
  publications: [],
  assets: [],
  jobs: [],
  refresh: async () => {},
  onCreate() {},
});
for (const label of [
  "publication-summary",
  "待准备",
  "可发布",
  "已发布",
  "搜索发布标题或正文",
])
  assert.ok(pub.includes(label), `publication layout missing ${label}`);
const surface = render(Surface, {
  embedded: true,
  open: true,
  title: "图片工作区",
  children: React.createElement("button", null, "生成操作"),
});
assert.ok(surface.includes("embedded-workspace"));
assert.ok(surface.includes("生成操作"));
assert.ok(!surface.includes("ant-drawer"));
console.log(
  "PASS: expanded/collapsed shell, collection actions, project rail, five tabs, publication counters, and embedded editors render.",
);

assert.ok(!pub.includes("导出发布包") && !pub.includes("已导出"));
assert.ok(!rewrites.includes("本次图片模型"));
assert.ok(rewrites.includes("200字、800～1000字、简短一些"));
const imageJobs = [
  {
    id: "old",
    target: "p1",
    kind: "image_generation",
    state: "succeeded",
    created_at: "2026-10-12T10:00:00Z",
    result: "img1",
  },
  {
    id: "new",
    target: "p1",
    kind: "image_generation",
    state: "failed",
    created_at: "2026-10-13T10:00:00Z",
    error: "测试失败",
  },
];
const generated = render(ImageGenerator, {
  embedded: true,
  projectID: "p1",
  jobs: imageJobs,
  assets: [{ id: "img1", name: "原来的图片", status: "ready", kind: "image" }],
  models: [],
  planningModels: [],
  selected: [],
  references: [],
  text: "文案",
  onAdd() {},
  onAddMany() {},
  onRemove() {},
});
assert.ok(
  generated.includes("测试失败") && generated.includes("<summary>历史生成"),
);
assert.ok(
  generated.indexOf("测试失败") < generated.indexOf("<summary>历史生成"),
);
assert.ok(
  generated.indexOf("原来的图片") > generated.indexOf("<summary>历史生成"),
);
assert.ok(
  !generated.includes("替换当前图片") && generated.includes("加入发布素材"),
);

const library = render(MediaLibrary, {
  embedded: true,
  open: true,
  onClose() {},
  refresh: async () => {},
  assets: [
    {
      id: "remote",
      name: "未选中的远程素材",
      source: "collection",
      status: "remote",
      kind: "image",
    },
    {
      id: "pending",
      name: "尚未完成的下载",
      source: "collection",
      status: "pending",
      kind: "video",
    },
    {
      id: "saved",
      name: "已下载的采集素材",
      source: "collection",
      status: "ready",
      kind: "image",
    },
  ],
});
assert.ok(library.includes("已下载的采集素材"));
assert.ok(
  !library.includes("未选中的远程素材") && !library.includes("尚未完成的下载"),
);
assert.ok(!shell.includes("图片和视频由你选择下载到素材库"));

const combinedProjects = render(Rewrites, {
  projects: [
    { ...project, platform: "xhs", name: "红书来源项目" },
    { ...project, id: "p2", platform: "douyin", name: "抖音来源项目" },
  ],
  assets: [],
  jobs: [],
  selectedID: "",
  onSelect() {},
  onCreate() {},
  refresh: async () => {},
  onPublish() {},
  openMedia() {},
});
assert.ok(
  combinedProjects.includes("红书来源项目") &&
    combinedProjects.includes("抖音来源项目"),
);
const draft = {
  id: "xhs-draft",
  title: "红书发布稿",
  body: "文案",
  topics: [],
  kind: "image",
  asset_ids: [],
  ready: true,
  target_platform: "xhs",
  group_id: "group-shared",
  created_at: "2026-10-14",
};
const combinedPublications = render(Publications, {
  publications: [
    draft,
    {
      ...draft,
      id: "dy-draft",
      title: "抖音发布稿",
      target_platform: "douyin",
      online_state: "unknown",
    },
  ],
  assets: [],
  jobs: [],
  refresh: async () => {},
  onCreate() {},
});
for (const text of [
  "红书发布稿",
  "抖音发布稿",
  "小红书账号",
  "抖音账号",
  "发布结果不明",
])
  assert.ok(
    combinedPublications.includes(text),
    `unified publications missing ${text}`,
  );
assert.equal(
  (combinedPublications.match(/data-row-key=/g) || []).length,
  2,
  "both platforms must share one table",
);
const dyRow = combinedPublications
  .split('data-row-key="dy-draft"')[1]
  .split("</tr>")[0];
assert.ok(dyRow.includes("上传到抖音") && dyRow.includes("核实未发布"));
assert.ok(
  !dyRow.includes("发布到小红书"),
  "Douyin action routed to wrong platform",
);
const manualPublications = render(Publications, {
  publications: [
    {
      ...draft,
      id: "dy-manual",
      target_platform: "douyin",
      online_state: "manual_review",
    },
  ],
  assets: [],
  jobs: [],
  refresh: async () => {},
  onCreate() {},
});
const manualRow = manualPublications
  .split('data-row-key="dy-manual"')[1]
  .split("</tr>")[0];
assert.ok(
  manualRow.includes("待官网核对") && manualRow.includes("继续官方编辑"),
);
assert.ok(
  !manualRow.includes("核对并发布"),
  "unverified editor cannot offer automatic publish",
);
for (const hash of [
  "#xhs/collections",
  "#douyin/collections",
  "#collections",
]) {
  global.location.hash = hash;
  const legacy = render(Shell, {});
  assert.ok(
    legacy.includes("采集小红书 / 抖音内容") && legacy.includes("全部平台"),
  );
}
console.log(
  "PASS: unified platform navigation, mixed project/publication lists and platform-specific publish controls.",
);

assert.ok(combinedPublications.includes("双平台同稿"));

const manualXHS = render(Publications, {
  publications: [
    {
      id: "manual-xhs",
      target_platform: "xhs",
      kind: "image",
      ready: true,
      title: "预发布测试",
      body: "正文",
      topics: [],
      asset_ids: [],
      online_state: "manual_ready",
      online_job_id: "prepare-xhs",
    },
  ],
  assets: [],
  jobs: [{ id: "prepare-xhs", kind: "publish", state: "succeeded" }],
  refresh: async () => {},
  onCreate() {},
});
for (const text of [
  "待手动发布",
  "手机扫码发布",
  "复制文案",
  "记录已发布",
  "查看发布稿",
])
  assert.ok(manualXHS.includes(text), `manual XHS missing ${text}`);
const manualButtons = [
  ...manualXHS.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g),
].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
assert.ok(
  !manualButtons.includes("确认发布"),
  "XHS must not offer automatic submission",
);
for (const text of [
  "扫码连接",
  "上传到小红书",
  "连接后可上传到小红书官方编辑页",
])
  assert.ok(
    !manualXHS.includes(text),
    `removed account publishing UI: ${text}`,
  );
console.log(
  "PASS: XHS publishing offers phone QR, retains legacy records, and removes account upload.",
);

assert.ok(!manualXHS.includes("目标平台作品链接"));
assert.ok(
  !manualButtons.includes("核实未发布，重新准备"),
  "recovery belongs in details, not the four-action list",
);
const videoSource = require("node:fs").readFileSync(
  path.join(__dirname, "../src/VideoDirector.tsx"),
  "utf8",
);
assert.ok(
  !videoSource.includes("/compose") && !videoSource.includes("预览满意"),
  "video creation must not require a separate composition step",
);

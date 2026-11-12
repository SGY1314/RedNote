# 前端维护说明

## 入口与职责

- `src/App.tsx`：导航、当前项目和全局面板；仿写、发布及辅助面板按需加载。
- `src/hooks/useWorkspaceSync.ts`：增量同步、轮询与旧后端兼容。业务组件通过 `refresh` 刷新，不各自启动全库轮询。
- `src/hooks/useModelCatalog.ts`：文案、图片、视频模型目录。保留有效选项，忽略过时请求和卸载后的响应。
- `src/rewrites/ProjectRail.tsx`：项目搜索、列表和模型入口。
- `src/rewrites/ReferencePanel.tsx`：参考文字、图片和视频选择。
- `src/rewrites/CopyEditor.tsx`：标题、正文和话题字段。
- `src/rewrites/VersionComparison.tsx`：完整版本比较与选择；确认和持久化仍由父级业务流程执行。
- `src/workspace/TaskDrawer.tsx`：后台任务分类、进度与重试。
- `src/theme.ts`：Ant Design 控件主题；`src/workspace.css`：布局、响应式与页面样式；`src/particle-button.css`：共用生成按钮动效。

`Rewrites.tsx` 仍承担草稿同步、版本与素材事务编排。这些流程有防并发覆盖和版本一致性检查，后续拆分应保持测试覆盖，不能为了缩短文件删掉保护逻辑。

## 修改约定

1. 新 UI 优先放到对应业务组件。纯展示接收类型明确的 props，网络请求和版本事务不要藏进展示组件。
2. 调整已有样式时修改原规则，不增加第二套覆盖样式；同时检查展开/收起侧栏及窄窗口。
3. 编译开启 `noUnusedLocals`、`noUnusedParameters`，删除未使用的导入、参数和分支，不用关闭检查或 `any` 消除报错。
4. 不改动“生成结果、素材库、发布选择”的独立状态；不把上传完成或发布超时当成发布成功。

## 验证

在项目目录执行 `npm --prefix web run test:logic`、`npm --prefix web run test:layout`、`npm --prefix web run build`。

浏览器交互测试：`test:rewrite-ui`、`test:media-ui`、`test:video-ui`、`test:design`。测试使用模拟接口，不调用真实模型或发布作品。`tests/browser.cjs` 统一使用 Chromium；可通过 `WORKBENCH_TEST_CHROMIUM` 指定可执行文件。便携版会使用包内 douyin 的 Playwright 依赖，源码独立使用时先安装 douyin 依赖。

手动核对：采集筛选/详情 → 加入仿写 → 展开或收起 AI 设置 → 编辑及保存命名版本 → 对比素材和正文 → 建立对应平台发布稿；另检查素材库、任务筛选和侧栏收起后的入口。更新前端后按 Ctrl+F5 刷新工作台。


## 2026-10-16 界面调整

沿用原工作台的白色画布、图标导航、RedNote 字标、蓝色导航与紫色生成操作。页头改为自适应布局，收起侧栏为首次打开的默认状态，用户展开后的选择会保留。

- `components/GenerateButton.tsx`：共用生成操作，保留外层业务事件与 loading 状态；执行期间禁用重复操作，并显示粒子加速；减少动态效果设置下关闭粒子。
- `components/PublicationMedia.tsx`：保持媒体原比例的瀑布流、右上角拖拽柄与右下角中性圆形选择键；保留现有版本素材保存事务。已选素材支持拖拽和 Alt + 方向键排序。
- `MediaLibrary.tsx`：自然比例瀑布流，逐项操作归入右上角菜单，重命名、分类、批量选择与回收站保留；在创作项目内可从菜单加入发布素材。上传区域可展开，卡片上不显示基本信息。
- `tests/design-ui.cjs`：覆盖五种窗口宽度、菜单入口、图片比例、拖拽/键盘顺序、素材加入与取消，以及生成按钮的 loading 和减少动态效果状态；截图使用独立模拟内容。

本次源码在便携包的 `source/xhs-workbench` 中；便携包的 `web/dist` 是对应生产构建。原始源码归档备份保存在 `verification/frontend-design-20261016/original-source.zip`。


## 工作区细节优化

- 采集区域移除说明文字；项目搜索和“来源平台”筛选位于同一行。
- 项目置顶使用 `gin.rewrite.pinned-projects` 保存到当前浏览器，列表和项目管理卡片保持同一置顶顺序；取消置顶恢复原顺序。
- `rewrites/ResizableWorkspace.tsx` 管理项目列表宽度，右边界支持拖动、方向键、Home/End 和双击恢复默认值；宽度保存在 `gin.rewrite.rail-width`。窄窗口保持上下布局。
- 仿写项目的删除按钮统一为灰色，保留原有删除确认与回收站行为。
- `components/PlatformAccountCard.tsx` 统一小红书与抖音账号区域的头像、名称、状态和按钮位置。抖音的专用浏览器及断开操作收进更多菜单，发布说明可展开；原账号与发布接口保留。
- `npm run test:workspace-ui` 使用模拟接口验证置顶/宽度持久化、编辑内容保留、删除样式、平台对齐和账号检查事件；不操作真实账号。

本轮只修改前端，无后端接口或数据结构变更。

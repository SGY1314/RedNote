# 前端维护说明

当前前端源码位于 `src`，静态运行资源位于 `public`，测试位于 `tests`。历史 `src-backup-*` 副本已移除，旧内容可从 Git 记录查看。

## 开发入口

- `src/App.tsx`：应用入口与导航。
- `src/Rewrites.tsx`、`src/rewrites`：仿写工作台和生成流程。
- `src/Publications.tsx`：发布管理。
- `src/MediaLibrary.tsx`：素材库。
- `src/hooks`：草稿同步、后台状态及模型目录等共用逻辑。
- `src/workspace`：工作区布局、后台任务及共用界面。

## 验证

```powershell
npm.cmd --prefix web ci
npm.cmd --prefix web run dev
npm.cmd --prefix web run test:logic
npm.cmd --prefix web run build
```

开发代理连接 `http://127.0.0.1:8080` 的 Go 后端。未启动后端时，登录及业务 API 不可用。

桌面浏览器回归使用 `douyin` 目录中的 Playwright，先执行 `npm.cmd --prefix douyin ci`。`tests/browser.cjs` 支持 `WORKBENCH_TEST_CHROMIUM` 指定浏览器；部分脚本固定使用 8081，运行前检查地址。模拟 API 验证不代表真实模型和平台发布已验收。

## 修改约定

保持草稿并发保护、参考内容策略和发布快照一致性。生成结果、素材库收录和发布素材选择分别保存；图片与视频选择互不覆盖。不将上传准备成功或超时当作发布成功。编译保持 `noUnusedLocals`、`noUnusedParameters` 检查。

完整开发、打包和检查说明见 [MAINTENANCE.md](../docs/MAINTENANCE.md)，已知问题见[最新项目检查报告](../docs/项目检查报告-20261112.md)。

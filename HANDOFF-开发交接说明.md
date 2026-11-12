# RedNote 网站开发交接

这是供修改的网站完整前后端源码包，不是数据库备份或可直接部署的安装包。
基线：2026-10-29 视频发布源码，加上已上线的抖音开发预览入口。
尚未上线的图文 H5 实验代码未混入本包。网站仍包含多平台业务代码，但使用能力取决于独立配置。

## 修改入口

- web/src：React、TypeScript、Vite、Ant Design 前端，修改界面主要在此。
- web/src/App.tsx：主应用；Rewrites.tsx：仿写；MobilePublishDialog.tsx：手机发布；DouyinPreview.tsx：开发预览入口。
- cmd/workbench、internal：Go 后端、API、任务、数据访问及迁移。
- collector、publisher、douyin：采集及发布适配器，含依赖锁和第三方许可证。
- config/example.json：非敏感本地配置模板。
- docs、web/tests、internal 中的 *_test.go：业务说明及测试。
- miniapp/RedNote：已有小红书小程序配套源码，其本地连接配置已清空。

本包聚焦网站；独立抖音云服务、抖音小程序和本机预览助手需单独交接与配置。本机预览按钮依赖本机助手，缺少助手不表示普通网站页面构建失败。

## 先修改前端

安装 Node.js 22.12 或更新的兼容版本，在项目根目录执行：

```powershell
npm.cmd --prefix web ci
npm.cmd --prefix web run dev
```

浏览器打开终端显示的地址，通常为 http://127.0.0.1:5173 。开发代理连接 http://127.0.0.1:8080 的 Go 后端；未启动后端时，登录和业务 API 不可用。

## 启动后端

安装满足 go.mod 要求的 Go，先构建前端，再创建本地配置：

```powershell
npm.cmd --prefix web run build
Copy-Item config/example.json config/local.json
go run ./cmd/workbench -config config/local.json
```

已有 local.json 时不要覆盖。浏览器访问 http://127.0.0.1:8080 。这是空白的新开发环境；创建或注册开发账户后使用。AI 服务需要开发者自己的密钥；采集和发布需要另外启动配套服务及配置自己的账户，详见 README.md。
Windows 的完整环境安装脚本为 setup.cmd，包含较大工具下载；其中固定下载版本应先确认仍可获取。仅改界面优先用上面的手动步骤。

## 提交修改前验证

```powershell
npm.cmd --prefix web run test:logic
npm.cmd --prefix web run build
go test ./...
```

网页交互测试按 web/package.json 对应脚本运行，部分需要浏览器和 douyin 目录的 Playwright 依赖。不要使用真实发布动作代替普通界面测试。

## 不包含的内容

账号、数据库、私人素材、Cookies、登录会话、AI 密钥、服务器密码、生产配置、依赖安装目录和构建缓存均未交接。不能直接连接或恢复原网站数据。第三方源码及许可证保留，应遵守相应许可证。

## 对方改好后如何交回

请交回修改后的源码或 Git diff、改动说明、启动步骤和验证结果。只改界面时重点交回 web/src 及相关资源；新增依赖须一并交回 package.json、package-lock.json。不要交回 node_modules、数据库或真实密钥，也不要直接覆盖原服务器。

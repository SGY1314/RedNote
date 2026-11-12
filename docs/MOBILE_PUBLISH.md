# 手机扫码发布（v19 接入版）

2026-10-29：已新增抖音视频手机交接入口，详见 [抖音手机发布说明](DOUYIN_MOBILE_PUBLISH.md)。下文为原小红书图文接入说明。

在原双平台源码中加入小红书手机图文发布入口。原有桌面小红书上传及本地版抖音发布代码保留；当前云端版仍禁用扫码登录、抖音采集和自动上传。手机图文入口无需登录桌面小红书账号，但需要独立的公网 HTTPS 交接服务和已配置的小红书小程序体验版；源码包没有包含可直接使用的服务配置或小程序 AppID。

## 使用

1. 仿写项目保存并确认包含文案和图片的完整版本，创建目标为小红书的发布稿。
2. 发布管理中点击该稿件的「手机扫码发布」→「生成二维码」。
3. 用小红书扫一扫接收。小程序加载稿件后自动复制**标题、正文和话题标签**，也可手动点击「一键复制文案」。
4. 点击底部「发小红书」，进入官方编辑器。如官方页面未带入文案，长按粘贴后自行核对并发布。
5. 扫码、复制、打开编辑器或返回工作台均不代表发布成功。实际发布后可使用原有「记录已发布」。

目前手机入口支持 1–18 张 JPEG/PNG 图片（每张不超过20MiB），标题不超过20个 Unicode字符、正文非空且不超过1000个字符。数量为当前交接协议上限，最终以客户端允许范围为准。视频与其他图片格式继续使用原有发布方式；本次不新增手机视频导入能力。

## 本机连接现有服务

在新项目目录执行：

```powershell
.\scripts\connect-existing-mobile-publish.ps1 -SourceWorkbench 'C:\path\to\existing\xhs-workbench'
```

它读取旧项目的 `config.cloud.local.json` 和 `config.miniapp.local.json`，写入新项目对应本地配置，控制密钥仅保留原位置的绝对路径引用，不复制密钥。旧项目私有交接连接需要保持运行。该步骤不更新任何云端服务或体验版。

跨机器使用时，参考根目录的两个 example JSON，分别配置交接服务控制地址、公网 HTTPS 地址、服务端控制密钥文件，以及已填写真实24位 AppID的小程序项目绝对路径。没有配置时窗口明确提示不可用。服务端配置不能放进小程序；项目运行目录默认是配置目录，也可在工作台配置中显式指定 `mobile_publish_config_dir`。

小程序维护源码位于 `miniapp/RedNote`，包含本轮新版发布界面、整份文案自动复制、官方 `post-note-button` 直接入口及93项测试。使用 `scripts/sync-miniapp.ps1 -Destination <开发者工具项目>` 同步源码，会保留目标 AppID、私有编译设置和 `config/runtime.local.js`。运行地址通过该私有文件中的 `gateway: 'development-cloud'`、`apiBaseUrl: 'https://交接域名'` 配置。开发者工具重新编译可预览；体验版需要自行上传更新。

体验路由使用 `_trial` 和官方 HTTPS 状态页包裹的深链，固定进入 `pages/publish/index?scene=<本次随机凭证>`；正式版设置 `launch_environment: 'release'`。不复用样本中的 page_key。配置真实 AppID、服务地址、HTTPS 域名及体验版后，还需本人用手机验证平台体验权限与完整导入；桌面测试不能替代。

## 交接边界

- 新接口 `GET /api/v1/miniapp/cloud` 与 `POST/GET /api/v1/publications/:id/mobile-handoff`、`POST .../cancel` 使用现有登录、CSRF与每用户独立数据库。不能通过其他账号的发布稿ID查询、上传或撤销。
- 后端从固定确认版本核对文案和有序素材，封面作为首图。图片重新校验实际文件、SHA-256、尺寸、格式与大小，流式上传到与现有小程序兼容的交接服务。
- 上传凭证最长10分钟；轮询只返回状态，不再次下发扫码凭证。扫码或过期后隐藏二维码；关闭再打开窗口需撤销旧交接后重新生成。
- 同一稿件已有活动交接时不重复上传。上传响应丢失且无法确认时暂时阻止重复上传，待旧票据过期后再生成；未知结果不能假称已撤销。
- 交接服务源码附于 `internal/handoffcloud` 和 `cmd/handoff-cloud`，使用原协议；已有服务无需重新部署。公网应经HTTPS代理，仅暴露接收和媒体路由，控制路由必须保持私有。

## 验证

```powershell
go test ./... -count=1
npm.cmd --prefix web run build
npm.cmd --prefix web run test:logic
npm.cmd --prefix web run test:mobile
node --test miniapp/RedNote/tests/*.test.js
```

手机界面、剪贴板许可、实际跳转与最终发布仍需体验版真机验收。本轮本地集成测试使用有效PNG和真实交接服务协议，不调用账号发布或AI服务，不上传云端。

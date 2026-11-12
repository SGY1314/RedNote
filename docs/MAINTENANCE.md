# 开发维护与打包

本文件合并旧的开发交接、源码包说明和阶段性界面记录。当前已知问题见[项目检查报告](项目检查报告-20261112.md)。历史备份、旧报告和旧脚本可从精简前提交 `e2b93cf` 查看，不需要再在当前目录保留一套副本。

## 目录职责

| 目录 | 用途 |
| --- | --- |
| `web/src`、`web/public` | 当前前端源码、字体、图标、配套小程序使用的公开示例图片 |
| `web/tests` | 前端逻辑及桌面模拟回归；测试辅助文件也需保留 |
| `cmd`、`internal` | Go 服务端、任务、数据存储、权限及配套交接服务，含测试 |
| `collector` | Python 采集适配、固定版本上游源码、运行资源及许可证 |
| `douyin` | 抖音适配器及测试，依赖锁文件和参考来源说明 |
| `publisher` | 小红书本地发布组件、修改记录、Go 源码及测试 |
| `miniapp/RedNote` | 配套小红书小程序源码、示例资源及测试 |
| `scripts` | 安装、启动、停止、同步及两种用途不同的打包入口 |
| `config`、根目录 `config.*.example.json` | 无密钥的配置示例 |

`.tools`、`bin`、`node_modules`、`web/dist`、`data`、`logs` 均为本地生成或运行目录，不上传 GitHub。测试、依赖锁文件和许可证虽然不直接显示在界面中，但属于可维护源码的一部分。

## 安装和验证

Windows 首次安装需要 Node.js 22.12 或更新兼容版本，执行 `setup.cmd`。该脚本下载项目独立工具链、安装依赖并构建程序，需要联网。然后执行 `start.cmd`，默认访问 `http://127.0.0.1:8080`。运行自己的实例前确认端口与其他安装不冲突。

也可使用满足 `go.mod` 要求的 Go 和已有 Node.js 手动开发：

```powershell
npm.cmd --prefix web ci
npm.cmd --prefix douyin ci --ignore-scripts
npm.cmd --prefix web run build
if (!(Test-Path config/local.json)) { Copy-Item config/example.json config/local.json }
go run ./cmd/workbench -config config/local.json
```

采集、模型和配套发布服务还需各自的依赖、地址及账号配置；仅启动网站不代表这些外部能力已经可用。

常用检查：

```powershell
go test ./...
go vet ./...
npm.cmd --prefix web run test:logic
npm.cmd --prefix web run build
npm.cmd --prefix douyin test
if (!(Test-Path miniapp/RedNote/config/runtime.local.js)) {
    Copy-Item miniapp/RedNote/config/runtime.example.js miniapp/RedNote/config/runtime.local.js
}
npm.cmd --prefix miniapp/RedNote test
Push-Location publisher/upstream
go test . ./cookies -run TestWorkbench -count=1
go build .
Pop-Location
```

`publisher/upstream` 是独立 Go 模块，根目录 `go test ./...` 不覆盖它。其工作台专项测试与历史上游测试的区别见最新检查报告。不要为了让旧测试通过而恢复已关闭的接口或退回明文会话。

浏览器验证使用桌面尺寸与模拟 API；安装 `douyin` 依赖后，可通过 `WORKBENCH_TEST_CHROMIUM` 指定 Chrome 路径。部分历史脚本固定使用本机 8081 地址，运行前检查脚本的地址和登录方式。真实采集、供应商生成、手机扫码与实际发稿需分别联调，模拟测试通过不代表真实平台已验收。

## 打包入口

- **源码交接**：`scripts/package-dev-handoff.py --output <新ZIP路径>`。打包当前源码、配置示例、测试、文档和许可证，排除工具链、用户数据及私有配置；为小程序加入安全空配置，并在包内生成文件 SHA-256 清单和包外校验文件。
- **Windows 运行版**：`scripts/package-release.py --name <新版本名> --node <附带LICENSE的node.exe路径>`。需要先构建前后端与发布组件，打包运行依赖和一份源码归档，不复用用户使用过的目录。

执行 Python 脚本时可使用 `.tools/py312/python.exe`。输出必须使用新文件名或新版本名，不能覆盖正在运行的安装目录。旧的 interface、preview、mobile、workflow 四个阶段性源码打包脚本已合并到上述源码交接入口。

仓库不保留会随源码修改失效的旧 `source-manifest.json`；该清单只在每次生成源码包时创建。

## 精简范围与维护原则

本轮移除旧前端副本、上游截图与宣传资料、无关部署示例、编辑器配置、独立 skills、重复打包入口和阶段性文档。采集与发布组件的业务源码、运行资源、测试、第三方许可证和依赖锁文件均保留。

以后清理文件前，核对导入、构建、嵌入资源、测试与打包引用。第三方来源和裁剪说明保存在 `collector/UPSTREAM.md`、`publisher/README.md` 和 `THIRD_PARTY_NOTICES.md`。当前业务数据不参与仓库清理。

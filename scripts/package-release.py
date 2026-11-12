"""Build a fresh, data-free Windows distribution; never reuse a used installation.

Run with the project's embedded Python after building both executables and web/dist.
The archive includes one source ZIP, runtime dependencies and their licenses.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
OUTPUTS = PROJECT.parent / "outputs"
SKIP_DIRS = {"__pycache__", ".git", ".venv", ".pytest_cache", "Volume", ".runtime"}
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".dpapi", ".token", ".log", ".pem", ".key"}


def ignored(directory, names):
    return [n for n in names if not (n == "cacert.pem" and Path(directory).name == "certifi")
            and (n in SKIP_DIRS or n.startswith(".env")
                 or Path(n).suffix.lower() in PRIVATE_SUFFIXES | {".pyc", ".tsbuildinfo"})]


def copy_tree(source, target, extra=()):
    shutil.copytree(source, target, ignore=lambda d, ns: ignored(d, ns) + [n for n in ns if n in extra])


def source_archive(path):
    # Explicit top-level allowlist: never traverse live data, logs or local config.
    roots = ["cmd", "internal", "collector", "douyin", "publisher", "scripts", "docs", "web"]
    files = ["go.mod", "go.sum", "README.md", "THIRD_PARTY_NOTICES.md", "start.cmd", "stop.cmd", "restart.cmd", "setup.cmd", "config/example.json", "config/model-presets.json"]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in roots:
            for directory, dirs, names in os.walk(PROJECT / name):
                dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS | {"node_modules", "dist", ".github", ".claude", ".cursor", "donate"})
                if Path(directory) == PROJECT / "publisher/upstream":
                    dirs[:] = [d for d in dirs if d not in {"assets", "examples"}]
                for filename in sorted(set(names) - set(ignored(directory, names))):
                    file = Path(directory) / filename
                    if file.suffix.lower() in {".zip", ".exe"}:
                        continue
                    archive.write(file, "xhs-workbench/" + file.relative_to(PROJECT).as_posix())
        for name in files:
            archive.write(PROJECT / name, "xhs-workbench/" + name)


def write(path, text, encoding="utf-8-sig"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding=encoding)


def validate_public_presets(path):
    def check(value):
        if isinstance(value, dict):
            assert not ({"secret", "token", "api_key", "cookie", "password", "mask", "configured"} & value.keys()), "Credentials must not be included in presets"
            if "base_url" in value:
                url = urlsplit(value["base_url"])
                assert not (url.username or url.password or url.query or url.fragment), "Preset URL must not contain credentials or query parameters"
            for entry in value.values():
                check(entry)
        elif isinstance(value, list):
            for entry in value:
                check(entry)
    check(json.loads(path.read_text(encoding="utf-8")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True, help="New folder and ZIP name, never an existing installation")
    parser.add_argument("--node", required=True, type=Path, help="node.exe with LICENSE alongside it")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.name):
        parser.error("Use letters, digits, hyphens or underscores for the release name")
    dest = OUTPUTS / args.name
    archive_path = OUTPUTS / (args.name + ".zip")
    if dest.exists() or archive_path.exists():
        parser.error("Release already exists; choose a new name. Existing files are never overwritten.")
    if shutil.disk_usage(OUTPUTS).free < 1024 ** 3:
        parser.error("At least 1 GiB of free space is required for staging and ZIP creation.")
    binaries = {}
    for name in ("workbench", "publisher"):
        pending = PROJECT / "bin" / (name + "-next.exe")
        binaries[name] = pending if pending.is_file() else PROJECT / "bin" / (name + ".exe")
    required = list(binaries.values()) + [PROJECT / "web/dist/index.html", args.node, args.node.parent / "LICENSE", PROJECT / ".tools/py312/python.exe", PROJECT / "douyin/node_modules/playwright/package.json"]
    for path in required:
        if not path.is_file():
            parser.error("Missing release input: " + str(path))
    validate_public_presets(PROJECT / "config/model-presets.json")
    dest.mkdir(parents=True)

    def copy(rel, target=None):
        src = PROJECT / rel
        dst = dest / (target or rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    for name, binary in binaries.items():
        copy(binary.relative_to(PROJECT), "bin/" + name + ".exe")
    copy_tree(PROJECT / "web/dist", dest / "web/dist")
    copy_tree(PROJECT / "collector", dest / "collector", ("upstream.zip", "tests"))
    copy_tree(PROJECT / "douyin", dest / "douyin", tuple(p.name for p in (PROJECT / "douyin").glob("*.test.mjs")))
    copy_tree(PROJECT / ".tools/py312", dest / ".tools/py312")
    copy_tree(PROJECT / ".tools/ffmpeg", dest / ".tools/ffmpeg", ("ffplay.exe",))
    (dest / ".tools/node").mkdir()
    shutil.copy2(args.node, dest / ".tools/node/node.exe")
    shutil.copy2(args.node.parent / "LICENSE", dest / ".tools/node/LICENSE")
    for name in ("start.ps1", "stop.ps1", "restart.ps1", "process-identity.ps1", "portable-check.ps1"):
        copy("scripts/" + name)
    copy("config/example.json")
    copy("config/model-presets.json")
    copy("config/example.json", "config/local.json")
    copy("THIRD_PARTY_NOTICES.md")
    # Frontend bundles do not contain node_modules; retain installed dependency notices separately.
    for path in (PROJECT / "web/node_modules").rglob("*"):
        if path.is_file() and path.name.lower().split(".")[0] in {"license", "licence", "notice", "copying"}:
            target = dest / "licenses/frontend" / path.relative_to(PROJECT / "web/node_modules")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    for name in ("data", "logs"):
        (dest / name).mkdir()
    for name in ("start", "stop", "restart", "check"):
        script = "portable-check" if name == "check" else name
        tail = "pause" if name == "check" else "if errorlevel 1 pause"
        write(dest / (name + ".cmd"), '@echo off\ncd /d "%~dp0"\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\' + script + '.ps1"\n' + tail + '\n', "ascii")
    write(dest / "scripts/environment.ps1", """$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$TaskPython = Join-Path $ProjectRoot '.tools\\py312\\python.exe'
$TaskFFmpeg = Get-ChildItem (Join-Path $ProjectRoot '.tools\\ffmpeg') -Directory | Select-Object -First 1
$env:PATH = (Join-Path $ProjectRoot '.tools\\node') + ';' + (Join-Path $TaskFFmpeg.FullName 'bin') + ';' + $env:PATH
$env:PYTHONDONTWRITEBYTECODE = '1'
function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}
""")
    source_archive(dest / "源码.zip")
    write(dest / "使用说明.txt", """内容工作台 · Windows 64 位便携版

发给别人：发送整个 ZIP。对方先完整解压，再双击 start.cmd，不能在压缩包里直接运行。
建议解压到 D:\\Gin-Workbench 等当前用户可写目录，不要只复制 EXE。

start.cmd：启动并打开 http://127.0.0.1:8080/。
stop.cmd：停止这份软件的后台服务。
restart.cmd：停止后重新启动，用于更新或故障恢复。
check.cmd：检查内置运行依赖。
黑窗口报错时请保留错误文字，结合 logs 排查。

运行条件：Windows 10/11 64 位，安装 Microsoft Edge，正常联网。
已内置 Python、Node.js、Playwright、FFmpeg/FFprobe、后端和前端，无需安装 Go、npm 或执行 setup。
采集和上传取决于平台页面、网络和验证状态；本人扫码登录，必要时本人完成验证。
AI 文案、图片、视频和提取功能需自行配置可用模型及密钥，服务商可能收费。
已预填现有模型名称、API地址和模型ID，首次启动自动导入，密钥全部为空。
打开仿写库对应的模型配置，选中预设后填入自己的密钥并保存。OCR和转写在设置中配置。
百炼预设使用分发者当前的工作空间地址，自己的密钥须有对应权限；独立工作空间请改为自己的地址。
不配置 AI 仍可管理素材和手动编辑。小红书上传到官方编辑页后，由本人预览并点击发布。

同一台电脑只启动一份工作台。端口 8080、5556、18060 被其他目录版本占用时，
先打开那份软件的 stop.cmd，停止成功后再启动本包；不要强行结束不明进程。

本包不含笔记、素材、账号会话、密钥、数据库或历史日志。data、logs 初始为空。
使用后产生的数据留在本文件夹。以后转发请使用原始空白 ZIP，勿转发自己用过的目录。
Windows 加密会话与密钥绑定本机用户，换电脑后需重新登录和配置。

源码仅保留一份「源码.zip」，正常使用不必解压。第三方许可证和来源说明保留在包内。
验证范围和清理记录见「打包说明.txt」；SHA256SUMS.json 记录各文件校验值。
""")
    write(dest / "打包说明.txt", """本次整理
- 从原项目重新打包，不复制任何正在使用的工作台 data、logs 或 config/local.json。
- 只保留一套运行程序和一份源码归档，去除重复源码目录、旧构建、开发工具链、缓存和临时文件。
- 清除小红书旧的自动点击发布及结果等待代码，保留上传准备、账号检查和手动发布流程。
- 前端模块依赖检查未发现脱离入口的 TS/TSX/CSS 文件，没有删除仍在使用的页面。
- 保留第三方运行依赖、许可证、来源和可编辑源码。

本包不把模拟测试当成真实账号验收。具体测试结果另见发布时的验证报告。
""")
    validate(dest)
    print("Prepared release: " + str(dest), flush=True)
    finalize(dest)


def validate(dest):
    validate_public_presets(dest / "config/model-presets.json")
    assert not any((dest / "data").iterdir()) and not any((dest / "logs").iterdir())
    assert (dest / "config/local.json").read_bytes() == (dest / "config/example.json").read_bytes()
    for path in dest.rglob("*"):
        if path.is_file():
            public_ca = path.name == "cacert.pem" and path.parent.name == "certifi"
            assert public_ca or path.suffix.lower() not in PRIVATE_SUFFIXES, path
            assert not path.name.startswith(".env"), path
    with zipfile.ZipFile(dest / "源码.zip") as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            rel = Path(name).relative_to("xhs-workbench")
            assert rel.parts[0] not in {"data", "logs", ".tools", "bin"}, name
            assert rel.as_posix() != "config/local.json", name


def finalize(dest):
    validate(dest)
    files = sorted(p for p in dest.rglob("*") if p.is_file() and p.name != "SHA256SUMS.json")
    manifest = {}
    for index, path in enumerate(files, 1):
        with path.open("rb") as stream:
            manifest[path.relative_to(dest).as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
        if index % 1000 == 0:
            print(f"Checksummed {index}/{len(files)} files", flush=True)
    write(dest / "SHA256SUMS.json", json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    target = dest.with_suffix(".zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for index, path in enumerate(files + [dest / "SHA256SUMS.json"], 1):
            archive.write(path, dest.name + "/" + path.relative_to(dest).as_posix())
            if index % 1000 == 0:
                print(f"Archived {index}/{len(files)} files", flush=True)
        for name in ("data", "logs"):
            archive.writestr(dest.name + "/" + name + "/", "")
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, digest in manifest.items():
            assert hashlib.sha256(archive.read(dest.name + "/" + name)).hexdigest() == digest, name
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    write(target.with_suffix(".zip.sha256"), digest + "  " + target.name + "\n", "ascii")
    print(f"Verified ZIP: {target} ({target.stat().st_size / 1048576:.1f} MiB, {len(files)} files)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, shutil.Error) as error:
        raise SystemExit("Packaging failed; keep the original installation. Check disk space and file access. " + type(error).__name__)

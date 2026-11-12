$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$TaskGo = Join-Path $ProjectRoot '.tools\go\bin'
$TaskPython = Join-Path $ProjectRoot '.tools\py312\python.exe'
$TaskFFmpeg = Get-ChildItem (Join-Path $ProjectRoot '.tools\ffmpeg') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
$TaskBins = @($TaskGo)
if ($TaskFFmpeg) { $TaskBins += (Join-Path $TaskFFmpeg.FullName 'bin') }
$env:PATH = ($TaskBins -join ';') + ';' + $env:PATH
$env:GOPATH = Join-Path $ProjectRoot '.tools\gopath'
$env:GOCACHE = Join-Path $ProjectRoot '.tools\gocache'
$env:GOPROXY = 'https://goproxy.cn,https://proxy.golang.org,direct'
$env:UV_CACHE_DIR = Join-Path $ProjectRoot '.tools\uv-cache'

function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}

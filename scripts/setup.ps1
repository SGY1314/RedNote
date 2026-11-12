param([switch]$SkipCollector)
. (Join-Path $PSScriptRoot 'environment.ps1')
Set-Location -LiteralPath $ProjectRoot
New-Item -ItemType Directory -Force -Path '.tools','bin','config','logs','data' | Out-Null
function Get-CheckedArchive([string]$Url,[string]$File,[string]$SHA256) {
    if (!(Test-Path -LiteralPath $File)) { Invoke-WebRequest -UseBasicParsing $Url -OutFile $File }
    if ($SHA256 -and (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLower() -ne $SHA256.ToLower()) { throw "Checksum mismatch: $File" }
}
if (!(Test-Path '.tools\go\bin\go.exe')) {
    Get-CheckedArchive 'https://go.dev/dl/go1.27.1.windows-amd64.zip' '.tools\go.zip' 'a3911b5e0e1b1053f25ed0675f4c1c6aad1e2bfcf253df2b9be4caabd2edd95d'
    Expand-Archive -LiteralPath '.tools\go.zip' -DestinationPath '.tools' -Force
}
if (!(Test-Path -LiteralPath $TaskPython)) {
    Get-CheckedArchive 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' '.tools\python-embed.zip' '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
    Expand-Archive -LiteralPath '.tools\python-embed.zip' -DestinationPath '.tools\py312' -Force
    Set-Content -LiteralPath '.tools\py312\python312._pth' -Value "python312.zip`n.`nLib\site-packages`nimport site" -Encoding ascii
}
if (!(Test-Path '.tools\uv\uv.exe')) {
    Get-CheckedArchive 'https://github.com/astral-sh/uv/releases/download/0.8.22/uv-x86_64-pc-windows-msvc.zip' '.tools\uv.zip' '5049375aa2a5162f132b2c1cb992e25d42d47d934cab8c174dbe6f60973dcc12'
    Expand-Archive -LiteralPath '.tools\uv.zip' -DestinationPath '.tools\uv' -Force
}
if (!(Get-ChildItem '.tools\ffmpeg' -Directory -ErrorAction SilentlyContinue)) {
    Get-CheckedArchive 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip' '.tools\ffmpeg.zip' '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
    Expand-Archive -LiteralPath '.tools\ffmpeg.zip' -DestinationPath '.tools\ffmpeg' -Force
}
if (!$SkipCollector) {
    $commit = '47840a1bee8438324ff10753c4291148c46071c8'
    $vendor = "collector\vendor\XHS-Downloader-$commit"
    if (!(Test-Path -LiteralPath $vendor)) {
        New-Item -ItemType Directory -Force 'collector\vendor' | Out-Null
        Get-CheckedArchive "https://codeload.github.com/JoeanAmier/XHS-Downloader/zip/$commit" 'collector\vendor\upstream.zip' ''
        Expand-Archive -LiteralPath 'collector\vendor\upstream.zip' -DestinationPath 'collector\vendor' -Force
    }
    & '.\.tools\uv\uv.exe' pip install --link-mode copy --python $TaskPython --target '.tools\py312\Lib\site-packages' -r 'collector\requirements.lock' --index-url 'https://pypi.org/simple'
    Assert-NativeSuccess 'Collector dependencies'
}
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or later before building the frontend.' }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 22 or later is required.' }
Push-Location (Join-Path $ProjectRoot 'douyin')
try { & npm.cmd ci --ignore-scripts --no-audit --no-fund; Assert-NativeSuccess 'Douyin dependencies' } finally { Pop-Location }
& npm.cmd --prefix web ci --no-audit --no-fund
Assert-NativeSuccess 'npm ci'
& npm.cmd --prefix web run build
Assert-NativeSuccess 'Frontend build'
New-Item -ItemType Directory -Force '.tools\test-temp' | Out-Null
$env:TMP = Join-Path $ProjectRoot '.tools\test-temp'
$env:TEMP = $env:TMP
& '.\.tools\go\bin\go.exe' test ./...
Assert-NativeSuccess 'Go tests'
& '.\.tools\go\bin\go.exe' build -trimpath -o bin/workbench.exe ./cmd/workbench
Assert-NativeSuccess 'Backend build'
Push-Location (Join-Path $ProjectRoot 'publisher\upstream')
try {
    & (Join-Path $TaskGo 'go.exe') test . ./cookies -run TestWorkbench -count=1
    Assert-NativeSuccess 'QR publisher isolation and encryption tests'
    & (Join-Path $TaskGo 'go.exe') build -trimpath -o (Join-Path $ProjectRoot 'bin\publisher.exe') .
    Assert-NativeSuccess 'QR publisher build'
} finally { Pop-Location }
if (Test-Path -LiteralPath 'bin\publisher-next.exe') { Remove-Item -LiteralPath (Join-Path $ProjectRoot 'bin\publisher-next.exe') -Force }
if (Test-Path -LiteralPath 'bin\workbench-next.exe') { Remove-Item -LiteralPath (Join-Path $ProjectRoot 'bin\workbench-next.exe') -Force }
if (!(Test-Path 'config\local.json')) { Copy-Item -LiteralPath 'config\example.json' -Destination 'config\local.json' }
if (!(Test-Path 'miniapp\RedNote\config\runtime.local.js')) { Copy-Item -LiteralPath 'miniapp\RedNote\config\runtime.example.js' -Destination 'miniapp\RedNote\config\runtime.local.js' }
Write-Host 'Ready. Run scripts/start.ps1' -ForegroundColor Green

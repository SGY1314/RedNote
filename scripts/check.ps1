. (Join-Path $PSScriptRoot 'environment.ps1')
Write-Host 'Gin Workbench - dependency check'
foreach ($name in @('node', 'npm.cmd', 'go', 'ffmpeg', 'ffprobe')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { Write-Host "[OK] $name : $($cmd.Source)" -ForegroundColor Green }
    else { Write-Host "[MISSING] $name" -ForegroundColor Yellow }
}
if (Test-Path -LiteralPath $TaskPython) { & $TaskPython --version } else { Write-Host '[MISSING] local Python 3.12' }
if (Test-Path (Join-Path $ProjectRoot 'bin\workbench.exe')) { Write-Host '[OK] backend executable' }
if (Test-Path (Join-Path $ProjectRoot 'web\dist\index.html')) { Write-Host '[OK] frontend build' }
if (Test-Path (Join-Path $ProjectRoot 'bin\publisher.exe')) { Write-Host '[OK] QR publisher executable' }
elseif (Test-Path (Join-Path $ProjectRoot 'bin\publisher-next.exe')) { Write-Host '[OK] QR publisher staged; restart to activate' }
else { Write-Host '[MISSING] QR publisher; run setup.cmd' }
if (Test-Path (Join-Path $ProjectRoot 'douyin\node_modules\playwright\package.json')) { Write-Host '[OK] Douyin Playwright adapter' } else { Write-Host '[MISSING] Douyin dependencies; run setup.cmd' }
if ((Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") -or (Test-Path "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe")) { Write-Host '[OK] Edge for Douyin' } else { Write-Host '[MISSING] Install Microsoft Edge for Douyin' }
foreach ($port in @(8081, 5557, 18061)) {
    $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connection) { Write-Host "Port $port is in use. PID: $($connection.OwningProcess -join ',')" }
    else { Write-Host "Port $port is free." }
}

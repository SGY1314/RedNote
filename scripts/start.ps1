param([switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'environment.ps1')
Set-Location -LiteralPath $ProjectRoot
New-Item -ItemType Directory -Force -Path 'logs','data' | Out-Null
if (!(Test-Path 'bin\workbench.exe') -or !(Test-Path 'web\dist\index.html')) { throw 'Run scripts/setup.ps1 first.' }
$statePath = Join-Path $ProjectRoot 'data\processes.json'
$processes = @()
$running = $false
try { $existing = Invoke-RestMethod 'http://127.0.0.1:8081/api/v1/health' -TimeoutSec 1; $running = $existing.app -eq 'xhs-workbench' } catch {}
if ($running) { throw 'The workbench is already running at http://127.0.0.1:8081. Stop it before restarting.' }
foreach ($port in @(8081,5557,18061)) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($busy) { throw "Port $port is already in use. Stop the existing workbench or service first." }
}
if (!(Test-Path 'data\collector.token')) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    [IO.File]::WriteAllText((Join-Path $ProjectRoot 'data\collector.token'), [Convert]::ToBase64String($bytes))
}
function Install-PendingExecutable([string]$PendingName, [string]$ActiveName) {
    $pending = Join-Path $ProjectRoot $PendingName
    $active = Join-Path $ProjectRoot $ActiveName
    if (!(Test-Path -LiteralPath $pending)) { return }
    # Move-Item -Force still refuses to replace an existing EXE on Windows.
    # Copy first, then remove the pending file only after the replacement succeeds.
    Copy-Item -LiteralPath $pending -Destination $active -Force
    Remove-Item -LiteralPath $pending -Force
}
Install-PendingExecutable 'bin\workbench-next.exe' 'bin\workbench.exe'
Install-PendingExecutable 'bin\publisher-next.exe' 'bin\publisher.exe'
if (Test-Path -LiteralPath 'bin\publisher.exe') {
    New-Item -ItemType Directory -Force 'data\publisher' | Out-Null
    $publisherTokenPath = Join-Path $ProjectRoot 'data\publisher.token'
    if (!(Test-Path -LiteralPath $publisherTokenPath)) { [IO.File]::WriteAllText($publisherTokenPath, [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')) }
    $browserPaths = @("${env:ProgramFiles}\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe", "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe")
    $publisherBrowser = $browserPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($publisherBrowser) {
        $savedAuth=$env:AUTH_TOKEN; $savedCookie=$env:COOKIES_PATH; $savedBrowser=$env:WORKBENCH_BROWSER
        try {
            $env:AUTH_TOKEN=(Get-Content -LiteralPath $publisherTokenPath -Raw).Trim()
            $env:COOKIES_PATH=Join-Path $ProjectRoot 'data\publisher\session.dpapi'
            $env:WORKBENCH_BROWSER=$publisherBrowser
            $publisherExe=Join-Path $ProjectRoot 'bin\publisher.exe'
            $publisher=Start-Process -FilePath $publisherExe -ArgumentList @('-port','127.0.0.1:18061') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput 'logs\publisher.out.log' -RedirectStandardError 'logs\publisher.err.log' -PassThru
            $processes += @{id=$publisher.Id;path=$publisherExe;kind='publisher';started=$publisher.StartTime.ToUniversalTime().ToString('o')}
            $processes | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
            $publisherReady=$false
            for ($attempt=0;$attempt -lt 20;$attempt++) {
                if ($publisher.HasExited) { break }
                try {
                    $publisherHealth=Invoke-RestMethod 'http://127.0.0.1:18061/health' -TimeoutSec 1
                    if ($publisherHealth.app -eq 'xhs-workbench-publisher') { $publisherReady=$true;break }
                } catch {}
                Start-Sleep -Milliseconds 250
            }
            if (!$publisherReady) { Write-Warning 'QR publisher failed to start. See logs/publisher.err.log. Local editing remains available.' }
        } finally { $env:AUTH_TOKEN=$savedAuth; $env:COOKIES_PATH=$savedCookie; $env:WORKBENCH_BROWSER=$savedBrowser }
    } else { Write-Warning 'QR publishing requires Chrome or Edge. Other workbench features are available.' }
}
if (Test-Path -LiteralPath $TaskPython) {
    $collector = Start-Process -FilePath $TaskPython -ArgumentList @('collector/server.py') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput 'logs\collector.out.log' -RedirectStandardError 'logs\collector.err.log' -PassThru
    $processes += @{id=$collector.Id;path=$TaskPython;kind='collector';started=$collector.StartTime.ToUniversalTime().ToString('o')}
    $processes | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    $collectorReady = $false
    $collectorToken = (Get-Content -LiteralPath 'data\collector.token' -Raw).Trim()
    for ($attempt=0;$attempt -lt 30;$attempt++) {
        if ($collector.HasExited) { break }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:5557/health' -Headers @{'X-Collector-Token'=$collectorToken} -TimeoutSec 1
            if ($health.status -eq 'ok') { $collectorReady=$true;break }
        } catch {}
        Start-Sleep -Milliseconds 300
    }
    if (!$collectorReady) { throw 'Collector failed to start. See logs/collector.err.log; run stop.cmd before retrying.' }
}
# Start workers only after the collector is ready, so restored jobs do not fail
# during Python's initial imports.
$backend = Start-Process -FilePath (Join-Path $ProjectRoot 'bin\workbench.exe') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput 'logs\backend.out.log' -RedirectStandardError 'logs\backend.err.log' -PassThru
$processes += @{id=$backend.Id;path=(Join-Path $ProjectRoot 'bin\workbench.exe');kind='backend';started=$backend.StartTime.ToUniversalTime().ToString('o')}
$processes | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
$ready = $false
for ($attempt=0;$attempt -lt 30;$attempt++) {
    try { $health=Invoke-RestMethod 'http://127.0.0.1:8081/api/v1/health' -TimeoutSec 1; if ($health.status -eq 'ok') { $ready=$true;break } } catch {}
    Start-Sleep -Milliseconds 500
}
if (!$ready) { throw 'Backend failed to start. See logs/backend.err.log' }
Write-Host 'Workbench: http://127.0.0.1:8081' -ForegroundColor Green
if (!$NoBrowser) { Start-Process 'http://127.0.0.1:8081' }

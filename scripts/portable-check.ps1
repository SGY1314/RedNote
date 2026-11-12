. (Join-Path $PSScriptRoot 'environment.ps1')
Set-Location -LiteralPath $ProjectRoot
foreach ($relative in @('bin/workbench.exe','bin/publisher.exe','web/dist/index.html','config/model-presets.json','collector/server.py','douyin/node_modules/playwright/package.json','.tools/node/node.exe','.tools/py312/python.exe')) {
    if (!(Test-Path -LiteralPath $relative)) { throw "Missing: $relative" }
    Write-Host "[OK] $relative" -ForegroundColor Green
}
& node --version
Assert-NativeSuccess 'Node'
& $TaskPython -B -c "import runpy; runpy.run_path('collector/server.py',run_name='dependency_check'); print('Collector imports OK')"
Assert-NativeSuccess 'Collector dependencies'
& $TaskPython -B -c "import ssl, certifi; from curl_cffi.requests import Session; ssl.create_default_context(cafile=certifi.where()); Session().close(); print('HTTPS certificate bundle OK')"
Assert-NativeSuccess 'HTTPS certificates'
& node --input-type=module -e "await import('./douyin/node_modules/playwright/index.mjs'); console.log('Playwright import OK')"
Assert-NativeSuccess 'Playwright'
foreach ($program in @('ffmpeg','ffprobe')) {
    $version = & $program -version
    Assert-NativeSuccess $program
    $version | Select-Object -First 1
}
$edgePaths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe")
if ($edgePaths | Where-Object { Test-Path -LiteralPath $_ }) { Write-Host '[OK] Microsoft Edge' }
else { Write-Warning 'Install Microsoft Edge for platform login and uploading.' }
Write-Host 'Runtime dependencies checked. Live network and account actions are not tested here.'

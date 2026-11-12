$ErrorActionPreference = 'Stop'
# Run from Explorer (restart.cmd) to use the user's ordinary Windows network
# environment, instead of inheriting an assistant/development tool sandbox.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Stop failed; existing processes were left untouched.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Start failed. See logs.' }

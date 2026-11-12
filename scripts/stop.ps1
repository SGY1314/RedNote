. (Join-Path $PSScriptRoot 'environment.ps1')
. (Join-Path $PSScriptRoot 'process-identity.ps1')
$statePath = Join-Path $ProjectRoot 'data\processes.json'
$entries = @()
if (Test-Path -LiteralPath $statePath) {
    $entries = @(Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)
}
# Recover only listeners whose executable and collector command belong to this project.
# A missing process file must not leave the previous collector blocking restart.
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(8081,5557,18061) })
foreach ($listener in $listeners) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction Stop
    $kind = Get-WorkbenchProcessKind $info $listener.LocalPort $ProjectRoot $TaskPython
    if (!$kind) {
        Write-Host "Current workbench folder: $ProjectRoot"
        if ($info.ExecutablePath) { Write-Host "Port owner executable: $($info.ExecutablePath)" }
        throw "Port $($listener.LocalPort) belongs to a process outside this installation (PID $($listener.OwningProcess)), or its identity cannot be verified. If another workbench folder is running, use that folder's stop.cmd first. No unverified process was stopped."
    }
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    $entries = @($entries | Where-Object { $_.id -ne $proc.Id })
    $entries += @{ id=$proc.Id; path=$info.ExecutablePath; kind=$kind; started=$proc.StartTime.ToUniversalTime().ToString('o') }
}
if (!$entries.Count) { Write-Host 'No managed processes.';exit }
# Preserve recovered records if stopping is interrupted or fails.
$entries | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
$remaining = @()
foreach ($entry in ($entries | Sort-Object @{Expression={if ($_.kind -eq 'backend') { 0 } else { 1 }}})) {
    $proc = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if (!$proc) { continue }
    $actualPath = $proc.Path
    if (!$actualPath) { $remaining += $entry; Write-Warning 'Cannot verify process executable; not stopped.';continue }
    # Normalize redundant separators reported by some Windows process providers.
    $actual = ($actualPath -replace '[\\/]+','\').Trim()
    $expectedPath = $entry.path
    if (!$expectedPath) { if ($entry.kind -eq 'collector') { $expectedPath=$TaskPython } else { Write-Warning 'Missing expected executable; not stopped.';continue } }
    $expected = ($expectedPath -replace '[\\/]+','\').Trim()
    if ($actual -ne $expected -or !$actual.StartsWith($ProjectRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { Write-Warning 'Process identity changed; not stopped.';continue }
    if ($proc.StartTime.ToUniversalTime().ToString('o') -ne $entry.started) { Write-Warning 'PID reused; not stopped.';continue }
    if ($entry.kind -eq 'backend') {
        try {
            $session = Invoke-RestMethod 'http://127.0.0.1:8081/api/v1/session' -TimeoutSec 2
            Invoke-RestMethod 'http://127.0.0.1:8081/api/v1/shutdown' -Method Post -Headers @{'X-CSRF-Token'=$session.csrf_token} -ContentType 'application/json' -Body '{}' -TimeoutSec 2 | Out-Null
            $proc.WaitForExit(10000) | Out-Null
        } catch { Write-Warning 'Graceful stop unavailable; pending tasks will be recovered on restart.' }
    }
    if (!$proc.HasExited) {
        if ($entry.kind -eq 'publisher') {
            & taskkill.exe /PID $proc.Id /T /F | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the verified publisher process. Process records retained.' }
        }
        else { Stop-Process -Id $proc.Id -ErrorAction Stop }
        if (!$proc.WaitForExit(10000)) { throw 'Verified project process did not exit. Process records retained.' }
    }
    Write-Host "Stopped $($entry.kind)."
}
if ($remaining.Count) {
    $remaining | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    throw 'Some project processes could not be verified. Process records retained.'
}
Remove-Item -LiteralPath $statePath -Force

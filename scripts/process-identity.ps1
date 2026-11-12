function Get-WorkbenchProcessKind($ProcessInfo, [int]$Port, [string]$Root, [string]$PythonPath) {
    if (!$ProcessInfo.ExecutablePath) { return $null }
    $actual = ($ProcessInfo.ExecutablePath -replace '[\\/]+','\').Trim()
    if ($Port -eq 8081 -and $actual -ieq (Join-Path $Root 'bin\workbench.exe')) { return 'backend' }
    if ($Port -eq 18061 -and $actual -ieq (Join-Path $Root 'bin\publisher.exe')) { return 'publisher' }
    if ($Port -eq 5557 -and $actual -ieq $PythonPath) {
        $command = $ProcessInfo.CommandLine -replace '/', '\'
        $relative = '(?:^|[\s"])collector\\server\.py(?:[\s"]|$)'
        $absolute = '(?:^|[\s"])' + [regex]::Escape((Join-Path $Root 'collector\server.py')) + '(?:[\s"]|$)'
        if ($command -match $relative -or $command -match $absolute) { return 'collector' }
    }
    return $null
}

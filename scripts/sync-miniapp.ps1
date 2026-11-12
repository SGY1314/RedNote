[CmdletBinding(SupportsShouldProcess)]
param([Parameter(Mandatory = $true)][string]$Destination)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\miniapp\RedNote'))
$targetPath = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw 'Miniapp source is missing: miniapp\RedNote'
}
if ($targetPath.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($targetPath).TrimEnd('\', '/')) {
    throw 'Choose a dedicated miniapp project folder, not a drive root.'
}
$sourcePrefix = $sourcePath.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$targetPrefix = $targetPath.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($sourcePath.Equals($targetPath, [StringComparison]::OrdinalIgnoreCase) -or
    $targetPath.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $sourcePath.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source and destination must be separate project folders.'
}

$copied = 0
foreach ($file in Get-ChildItem -LiteralPath $sourcePath -File -Recurse) {
    $relative = $file.FullName.Substring($sourcePrefix.Length)
    if ($relative -match '(^|[\\/])(node_modules|\.git|test-results[^\\/]*|coverage)([\\/]|$)' -or
        $file.Name -match '^(\.env(?:\..*)?|project\.private\.config\.json|config\.local\.json)$' -or
        $file.Extension -match '^\.(pem|key|log|tmp)$') { continue }
    $targetFile = [IO.Path]::GetFullPath((Join-Path $targetPath $relative))
    if (-not $targetFile.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "File escapes the selected destination: $relative"
    }
    # Retain the developer tool's AppID and local compiler settings.
    if ($relative -in @('project.config.json', 'config\runtime.local.js', 'config/runtime.local.js') -and (Test-Path -LiteralPath $targetFile)) { continue }
    if ($PSCmdlet.ShouldProcess($targetFile, 'Copy miniapp source')) {
        $parentPath = [IO.Path]::GetDirectoryName($targetFile)
        if (-not (Test-Path -LiteralPath $parentPath)) {
            New-Item -ItemType Directory -Path $parentPath -Force | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $targetFile -Force
        $copied++
    }
}
Write-Output "Copied $copied source files. Existing project configuration and private destination files were retained."

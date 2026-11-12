[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SourceWorkbench)
$ErrorActionPreference = 'Stop'
$targetRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath($SourceWorkbench)
$cloud = Get-Content -LiteralPath (Join-Path $sourceRoot 'config.cloud.local.json') -Raw | ConvertFrom-Json
$miniapp = Get-Content -LiteralPath (Join-Path $sourceRoot 'config.miniapp.local.json') -Raw | ConvertFrom-Json
$keyPath = [string]$cloud.control_key_file
if (-not [IO.Path]::IsPathRooted($keyPath)) { $keyPath = Join-Path $sourceRoot $keyPath }
$keyPath = [IO.Path]::GetFullPath($keyPath)
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'The existing handoff control key file is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $miniapp.project_path 'project.config.json') -PathType Leaf)) { throw 'The existing miniapp project is missing.' }
# Keep the private key in its original protected location. Only an absolute
# reference is written into this project's untracked local configuration.
$outputCloud = @{server_url=$cloud.server_url;public_url=$cloud.public_url;control_key_file=$keyPath}
$outputMiniapp = @{project_path=$miniapp.project_path;launch_environment=$miniapp.launch_environment}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $targetRoot 'config.cloud.local.json'), ($outputCloud | ConvertTo-Json), $utf8)
[IO.File]::WriteAllText((Join-Path $targetRoot 'config.miniapp.local.json'), ($outputMiniapp | ConvertTo-Json), $utf8)
Write-Output 'Connected to the existing phone handoff service and miniapp project. Private credentials were not copied. No remote service or miniapp build was changed.'

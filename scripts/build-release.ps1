[CmdletBinding()]
param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$bundleName = "stream-notes-v$version-windows-x64"
$outputRoot = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $projectRoot "release"
}
$bundleRoot = Join-Path $outputRoot $bundleName
$zipPath = Join-Path $outputRoot "$bundleName.zip"
$checksumPath = "$zipPath.sha256"

function Invoke-CheckedCommand([string]$command, [string[]]$arguments) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$command failed with exit code $LASTEXITCODE."
  }
}

function Assert-ChildPath([string]$parent, [string]$child) {
  $parentFull = [System.IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  $childFull = [System.IO.Path]::GetFullPath($child)
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe release path: $childFull"
  }
}

$katexDist = Join-Path $projectRoot "node_modules\katex\dist"
if (-not (Test-Path -LiteralPath $katexDist)) {
  throw "KaTeX is not installed. Run npm ci first."
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExecutable = $nodeCommand.Source
$nodeArchitecture = & $nodeExecutable -p "process.arch"
if ($nodeArchitecture -ne "x64") {
  throw "The Windows release requires an x64 Node.js runtime. Current architecture: $nodeArchitecture"
}

$nodeLicense = Join-Path (Split-Path -Parent $nodeExecutable) "LICENSE"
if (-not (Test-Path -LiteralPath $nodeLicense)) {
  throw "The Node.js LICENSE file was not found beside node.exe."
}

Invoke-CheckedCommand "npm.cmd" @("run", "check")

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
Assert-ChildPath $outputRoot $bundleRoot
if (Test-Path -LiteralPath $bundleRoot) {
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}
foreach ($artifact in @($zipPath, $checksumPath)) {
  Assert-ChildPath $outputRoot $artifact
  if (Test-Path -LiteralPath $artifact) {
    Remove-Item -LiteralPath $artifact -Force
  }
}

New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "runtime") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "licenses") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleRoot "node_modules\katex") -Force | Out-Null

$applicationFiles = @(
  "app.js",
  "create-desktop-shortcut.ps1",
  "favicon.svg",
  "index.html",
  "install-desktop-shortcut.cmd",
  "interaction.js",
  "LICENSE",
  "package.json",
  "parser.js",
  "PRIVACY.md",
  "server.js",
  "stage-layout.js",
  "start-stream-notes.cmd",
  "start-stream-notes.ps1",
  "state.js",
  "stop-stream-notes.cmd",
  "stop-stream-notes.ps1",
  "stream-notes.ico",
  "styles.css",
  "THIRD_PARTY_NOTICES.md"
)

foreach ($relativePath in $applicationFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination (Join-Path $bundleRoot $relativePath)
}

Copy-Item -LiteralPath (Join-Path $projectRoot "docs\USER_GUIDE.txt") -Destination (Join-Path $bundleRoot "README.txt")
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\BOOTH_USER_GUIDE.md") -Destination (Join-Path $bundleRoot "USER_GUIDE.md")
Copy-Item -LiteralPath (Join-Path $projectRoot "licenses\KATEX-LICENSE.txt") -Destination (Join-Path $bundleRoot "licenses\KATEX-LICENSE.txt")
Copy-Item -LiteralPath $katexDist -Destination (Join-Path $bundleRoot "node_modules\katex") -Recurse
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $bundleRoot "runtime\node.exe")
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $bundleRoot "runtime\LICENSE")

Compress-Archive -LiteralPath $bundleRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipStream = [System.IO.File]::OpenRead($zipPath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash($zipStream)
  $hash = ([System.BitConverter]::ToString($hashBytes) -replace "-", "").ToLowerInvariant()
} finally {
  $sha256.Dispose()
  $zipStream.Dispose()
}
Set-Content -LiteralPath $checksumPath -Value "$hash  $([System.IO.Path]::GetFileName($zipPath))" -Encoding ASCII

Write-Output "Created: $zipPath"
Write-Output "SHA256: $hash"

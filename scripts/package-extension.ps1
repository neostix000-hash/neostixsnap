# Builds a Chrome Web Store / Load unpacked zip from extension/.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-extension.ps1
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $projectRoot 'extension'
$manifestPath = Join-Path $extensionDir 'manifest.json'

if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$distDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

$zipName = 'neostixsnap-v{0}.zip' -f $manifest.version
$zipPath = Join-Path $distDir $zipName
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('neostixsnap-package-{0}' -f [guid]::NewGuid().ToString('N'))

try {
  Copy-Item -Path $extensionDir -Destination $tempDir -Recurse -Force

  # Never ship local preview harnesses, notes, or maps.
  Get-ChildItem -Path $tempDir -Recurse -File |
    Where-Object {
      $_.Name -like '__preview*' -or
      $_.Name -like '*.map' -or
      $_.Name -like '*.log'
    } |
    Remove-Item -Force

  if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
  $sizeKb = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
  Write-Host ("Packaged {0} ({1} KB)" -f $zipPath, $sizeKb)
  Write-Host ("Manifest version: {0}" -f $manifest.version)
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
  }
}

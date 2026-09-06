<#
.SYNOPSIS
  Package extension/ into an installable .xpi (a zip with files at the root and
  forward-slash entry names, as Firefox requires).
.PARAMETER OutDir
  Output directory. Defaults to <repo>\dist.
#>
param([string]$OutDir)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ExtDir   = Join-Path $RepoRoot 'extension'
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$manifest = Get-Content (Join-Path $ExtDir 'manifest.json') -Raw | ConvertFrom-Json
$xpi = Join-Path $OutDir ("windows_spotlight_sync-{0}.xpi" -f $manifest.version)
if (Test-Path $xpi) { Remove-Item $xpi -Force }

# Anything that is not part of the shipped extension.
$exclude = @('CLAUDE.md', '.DS_Store', 'Thumbs.db', 'desktop.ini')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($xpi, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $base = (Resolve-Path $ExtDir).Path.TrimEnd('\') + '\'
    Get-ChildItem -LiteralPath $ExtDir -Recurse -File | ForEach-Object {
        if ($exclude -contains $_.Name) { return }
        $entry = $_.FullName.Substring($base.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        Write-Host "  + $entry"
    }
} finally {
    $zip.Dispose()
}

Write-Host "Built $xpi"

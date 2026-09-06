<#
.SYNOPSIS
  Install the Windows Spotlight Sync native-messaging helper for the current user.
.DESCRIPTION
  * Generates native-host\..\AppData manifest with an ABSOLUTE, machine-specific
    path to spotlight_host.cmd (this is the bug that broke every earlier build).
  * Registers it under HKCU so Firefox can find it.
  * Builds an installable .xpi.
  * Optionally writes a Firefox enterprise policy to install the extension
    permanently (-Managed; needs an elevated shell and a signed .xpi or a
    Firefox build with xpinstall.signatures.required = false).
.PARAMETER Managed
  Also drop distribution\policies.json into the Firefox install directory.
#>
param([switch]$Managed)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$HostDir    = Join-Path $RepoRoot 'native-host'
$HostCmd    = Join-Path $HostDir 'spotlight_host.cmd'
$Template   = Join-Path $HostDir 'windows_spotlight_sync.template.json'
$AppDir     = Join-Path $env:LOCALAPPDATA 'FirefoxSpotlightSync'
$Manifest   = Join-Path $AppDir 'windows_spotlight_sync.json'
$RegKey     = 'HKCU:\Software\Mozilla\NativeMessagingHosts\windows_spotlight_sync'

foreach ($f in @($HostCmd, (Join-Path $HostDir 'spotlight_host.ps1'), $Template)) {
    if (-not (Test-Path $f)) { throw "Missing required file: $f" }
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Write-Host "Writing native-messaging manifest..." -ForegroundColor Cyan
$m = Get-Content $Template -Raw | ConvertFrom-Json
$m.path = $HostCmd                               # absolute, this machine
($m | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $Manifest -Encoding UTF8
Write-Host "  $Manifest"
Write-Host "  path -> $HostCmd"

Write-Host "Registering with Firefox (HKCU)..." -ForegroundColor Cyan
New-Item -Path $RegKey -Force | Out-Null
Set-ItemProperty -Path $RegKey -Name '(default)' -Value $Manifest

Write-Host "Building extension package..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'build-xpi.ps1')
$xpi = Get-ChildItem (Join-Path $RepoRoot 'dist') -Filter *.xpi -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1

# ---- optional: permanent install via enterprise policy --------------------
if ($Managed) {
    $ff = $null
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'Mozilla Firefox'),
        (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox')
    )) { if ($p -and (Test-Path (Join-Path $p 'firefox.exe'))) { $ff = $p; break } }

    if (-not $ff) {
        Write-Warning "Firefox install directory not found; skipping -Managed policy."
    } elseif (-not $xpi) {
        Write-Warning "No .xpi was built; skipping -Managed policy."
    } else {
        $distDir = Join-Path $ff 'distribution'
        try {
            New-Item -ItemType Directory -Force -Path $distDir | Out-Null
            $policy = @{
                policies = @{
                    ExtensionSettings = @{
                        'windows-spotlight-sync@example.local' = @{
                            installation_mode = 'normal_installed'
                            install_url       = ([Uri]$xpi.FullName).AbsoluteUri
                        }
                    }
                }
            }
            ($policy | ConvertTo-Json -Depth 10) |
                Set-Content -LiteralPath (Join-Path $distDir 'policies.json') -Encoding UTF8
            Write-Host "  policy written: $(Join-Path $distDir 'policies.json')" -ForegroundColor Green
        } catch {
            Write-Warning "Could not write policy (needs an elevated shell): $($_.Exception.Message)"
        }
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "1. Fully close and reopen Firefox."
if ($xpi) {
    Write-Host "2. Permanent:  install $($xpi.Name) from dist\  (see README for signing notes)."
    Write-Host "   Temporary:  about:debugging#/runtime/this-firefox -> Load Temporary Add-on"
    Write-Host "               -> $RepoRoot\extension\manifest.json"
} else {
    Write-Host "2. Load extension\manifest.json via about:debugging."
}
Write-Host "3. If a new tab does not show the wallpaper, run scripts\diagnose.ps1."

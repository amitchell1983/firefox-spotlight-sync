<#
.SYNOPSIS
  Remove the Windows Spotlight Sync native-messaging registration.
.PARAMETER KeepData
  Keep %LOCALAPPDATA%\FirefoxSpotlightSync (history + state).
#>
param([switch]$KeepData)

$ErrorActionPreference = 'Continue'

$RegKey = 'HKCU:\Software\Mozilla\NativeMessagingHosts\windows_spotlight_sync'
$AppDir = Join-Path $env:LOCALAPPDATA 'FirefoxSpotlightSync'

if (Test-Path $RegKey) {
    Remove-Item -Path $RegKey -Recurse -Force
    Write-Host "Removed registry key: $RegKey"
} else {
    Write-Host "Registry key not present."
}

if (-not $KeepData -and (Test-Path $AppDir)) {
    Remove-Item -LiteralPath $AppDir -Recurse -Force
    Write-Host "Removed data directory: $AppDir"
} elseif ($KeepData) {
    Write-Host "Kept data directory: $AppDir"
}

# Best-effort: drop our entry from a Firefox managed policy, if present.
foreach ($p in @(
    (Join-Path $env:ProgramFiles 'Mozilla Firefox\distribution\policies.json'),
    (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\distribution\policies.json')
)) {
    if ($p -and (Test-Path $p)) {
        try {
            $j = Get-Content $p -Raw | ConvertFrom-Json
            if ($j.policies.ExtensionSettings.'spotlight-sync@amitchell1983.github.io') {
                $j.policies.ExtensionSettings.PSObject.Properties.Remove('spotlight-sync@amitchell1983.github.io')
                ($j | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $p -Encoding UTF8
                Write-Host "Updated policy: $p"
            }
        } catch {
            Write-Warning "Could not update $p ($($_.Exception.Message)). Edit it manually if needed."
        }
    }
}

Write-Host "Remove the extension itself from about:addons."

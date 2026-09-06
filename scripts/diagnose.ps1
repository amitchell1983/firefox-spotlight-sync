<#
.SYNOPSIS
  End-to-end diagnostic for Windows Spotlight Sync.
.DESCRIPTION
  Verifies helper files, the generated native-messaging manifest and the path
  inside it, the Firefox registry entry, Windows' reported wallpaper and the
  Spotlight cache locations, then performs a live request/response against the
  helper over the native-messaging protocol.
#>
$ErrorActionPreference = 'Continue'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$HostDir    = Join-Path $RepoRoot 'native-host'
$HostPs1    = Join-Path $HostDir 'spotlight_host.ps1'
$HostCmd    = Join-Path $HostDir 'spotlight_host.cmd'
$AppDir     = Join-Path $env:LOCALAPPDATA 'FirefoxSpotlightSync'
$Manifest   = Join-Path $AppDir 'windows_spotlight_sync.json'
$RegKey     = 'HKCU:\Software\Mozilla\NativeMessagingHosts\windows_spotlight_sync'

function Line { param($k, $v) "{0,-26} {1}" -f $k, $v }
function Invoke-HostRoundTrip {
    param([Parameter(Mandatory)] $Request, [int]$TimeoutSeconds = 20)

    # Drive the real .cmd launcher exactly as Firefox does, feeding a framed
    # request from a temp file (writing the pipe in-process can prepend a BOM).
    $json  = ($Request | ConvertTo-Json -Compress)
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $inF  = [System.IO.Path]::GetTempFileName()
    $outF = [System.IO.Path]::GetTempFileName()
    $errF = [System.IO.Path]::GetTempFileName()
    try {
        $ms = New-Object System.IO.MemoryStream
        $ms.Write([BitConverter]::GetBytes([uint32]$bytes.Length), 0, 4)
        $ms.Write($bytes, 0, $bytes.Length)
        [System.IO.File]::WriteAllBytes($inF, $ms.ToArray())

        $p = Start-Process -FilePath $HostCmd -NoNewWindow -PassThru `
                -RedirectStandardInput $inF -RedirectStandardOutput $outF -RedirectStandardError $errF
        if (-not $p.WaitForExit($TimeoutSeconds * 1000)) { try { $p.Kill() } catch { } }
        Start-Sleep -Milliseconds 200

        $ob = [System.IO.File]::ReadAllBytes($outF)
        if ($ob.Length -lt 4) {
            $e = (Get-Content $errF -Raw)
            return @{ ok = $false; error = "no response header"; stderr = $e }
        }
        $len = [BitConverter]::ToUInt32($ob, 0)
        $take = [Math]::Min($len, $ob.Length - 4)
        return ([Text.Encoding]::UTF8.GetString($ob, 4, $take) | ConvertFrom-Json)
    } finally {
        foreach ($f in @($inF, $outF, $errF)) { Remove-Item $f -ErrorAction SilentlyContinue }
    }
}

Write-Host "=== Windows Spotlight Sync diagnostic ===" -ForegroundColor Cyan
Write-Host (Line 'PowerShell version'  $PSVersionTable.PSVersion)
Write-Host (Line 'Host script'         "$(Test-Path $HostPs1)  $HostPs1")
Write-Host (Line 'Host launcher'       "$(Test-Path $HostCmd)  $HostCmd")

try { Add-Type -AssemblyName System.Drawing; Write-Host (Line 'System.Drawing' 'available') }
catch { Write-Host (Line 'System.Drawing' "MISSING: $($_.Exception.Message)") -ForegroundColor Red }

Write-Host ""
Write-Host (Line 'Manifest exists' (Test-Path $Manifest))
if (Test-Path $Manifest) {
    $m = Get-Content $Manifest -Raw | ConvertFrom-Json
    Write-Host (Line 'Manifest.path' $m.path)
    Write-Host (Line 'Manifest.path exists' (Test-Path $m.path))
    Write-Host (Line 'allowed_extensions' ($m.allowed_extensions -join ', '))
    Get-Content $Manifest
}

Write-Host ""
Write-Host "Registry entry ($RegKey):"
$reg = Get-ItemProperty $RegKey -ErrorAction SilentlyContinue
if ($reg) {
    Write-Host (Line '(default)' $reg.'(default)')
    Write-Host (Line 'matches manifest' ($reg.'(default)' -eq $Manifest))
} else {
    Write-Host "  <not found>  run scripts\install.ps1" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Windows wallpaper registry value:"
try { Write-Host "  $(Get-ItemPropertyValue 'HKCU:\Control Panel\Desktop' -Name Wallpaper)" }
catch { Write-Host "  <unreadable: $($_.Exception.Message)>" }

Write-Host ""
Write-Host "Spotlight cache candidates:"
@(
    (Join-Path $env:WINDIR       'SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\DesktopSpotlight\Assets\Images'),
    (Join-Path $env:LOCALAPPDATA 'Packages\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\LocalCache\Microsoft\IrisService'),
    (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets')
) | ForEach-Object { Write-Host ("  {0}  {1}" -f (Test-Path $_), $_) }

Write-Host ""
Write-Host (Line 'App data dir' "$(Test-Path $AppDir)  $AppDir")
$idx = Join-Path $AppDir 'history\index.json'
if (Test-Path $idx) {
    $h = Get-Content $idx -Raw | ConvertFrom-Json
    Write-Host (Line 'History entries' (@($h).Count))
}

Write-Host ""
Write-Host "Live helper round-trip (get_current):" -ForegroundColor Cyan
try {
    $r = Invoke-HostRoundTrip -Request @{ action = 'get_current'; id = 'diag' }
    if ($r.ok) {
        Write-Host (Line '  ok' $true) -ForegroundColor Green
        Write-Host (Line '  source' $r.source)
        Write-Host (Line '  hash' $r.hash)
        Write-Host (Line '  image bytes (b64)' $r.base64Len)
        if ($r.meta) { Write-Host (Line '  meta' (($r.meta.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')) }
    } else {
        Write-Host (Line '  ok' $false) -ForegroundColor Yellow
        Write-Host (Line '  error' $r.error)
    }
} catch {
    Write-Host "  round-trip failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Windows Spotlight Sync -- native messaging host
#
# Dependency-free (Windows PowerShell 5.1 + .NET Framework System.Drawing).
# Speaks Firefox's native messaging wire protocol on stdin/stdout:
#
#     [uint32 little-endian payload length][UTF-8 JSON payload]
#
# Supports both connection styles:
#   * browser.runtime.connectNative     -- long-lived port, receives push events
#   * browser.runtime.sendNativeMessage -- one-shot request/response
#
# IMPORTANT: nothing may be written to real stdout except framed native
# messages. Diagnostics go to stderr only (Firefox routes them to the browser
# console). Do not add Write-Host / Write-Output anywhere in this script.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
Set-StrictMode -Version 2.0

Add-Type -AssemblyName System.Drawing

# --------------------------------------------------------------------------
# Paths / state
# --------------------------------------------------------------------------
$script:AppDir     = Join-Path $env:LOCALAPPDATA 'FirefoxSpotlightSync'
$script:HistoryDir = Join-Path $script:AppDir 'history'
$script:StateFile  = Join-Path $script:AppDir 'state.json'
$null = New-Item -ItemType Directory -Force -Path $script:HistoryDir

$script:Config = [ordered]@{
    pollSeconds  = 15
    historyMax   = 10
    maxDimension = 1600
    jpegQuality  = 82
}

# Firefox caps a single host -> extension message at 1 MB. Keep the base64
# image payload under this so the JSON envelope still fits.
$script:MaxBase64 = 700000

$script:StdIn  = [Console]::OpenStandardInput()
$script:StdOut = [Console]::OpenStandardOutput()
$script:Queue  = [System.Collections.Concurrent.ConcurrentQueue[object]]::new()
$script:Current = $null

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
function Write-StdErr {
    param([string]$Message)
    try { [Console]::Error.WriteLine('[spotlight-host] ' + $Message) } catch { }
}

function Prop {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }
    if ($Object.PSObject.Properties[$Name]) { return $Object.PSObject.Properties[$Name].Value }
    return $Default
}

function Write-NativeMessage {
    param([Parameter(Mandatory)] $Object)
    $json  = $Object | ConvertTo-Json -Depth 12 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $len   = [BitConverter]::GetBytes([uint32]$bytes.Length)   # little-endian on x86/x64
    $script:StdOut.Write($len, 0, 4)
    $script:StdOut.Write($bytes, 0, $bytes.Length)
    $script:StdOut.Flush()
}

function Clamp-Config {
    $c = $script:Config
    $c.pollSeconds  = [Math]::Min(600, [Math]::Max(5,   [int]$c.pollSeconds))
    $c.historyMax   = [Math]::Min(50,  [Math]::Max(0,   [int]$c.historyMax))
    $c.maxDimension = [Math]::Min(3840,[Math]::Max(640, [int]$c.maxDimension))
    $c.jpegQuality  = [Math]::Min(95,  [Math]::Max(40,  [int]$c.jpegQuality))
}

function Save-State {
    try {
        $s = [ordered]@{
            config      = $script:Config
            currentHash = (Prop $script:Current 'hash')
            savedAt     = (Get-Date).ToString('o')
        }
        ($s | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $script:StateFile -Encoding UTF8
    } catch { Write-StdErr "save state failed: $_" }
}

function Load-State {
    if (Test-Path -LiteralPath $script:StateFile) {
        try {
            $s = Get-Content -LiteralPath $script:StateFile -Raw | ConvertFrom-Json
            $cfg = Prop $s 'config'
            if ($cfg) {
                foreach ($k in @('pollSeconds','historyMax','maxDimension','jpegQuality')) {
                    $v = Prop $cfg $k
                    if ($null -ne $v) { $script:Config[$k] = [int]$v }
                }
            }
        } catch { Write-StdErr "load state failed: $_" }
    }
    Clamp-Config
}

# --------------------------------------------------------------------------
# Wallpaper discovery
# --------------------------------------------------------------------------
function Get-RegistryWallpaper {
    try {
        $v = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name Wallpaper -ErrorAction Stop).Wallpaper
        if ($v -and (Test-Path -LiteralPath $v -PathType Leaf)) { return $v }
    } catch { }
    return $null
}

function Get-CacheCandidates {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Packages\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\LocalCache\Microsoft\IrisService'),
        (Join-Path $env:WINDIR       'SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\DesktopSpotlight\Assets\Images'),
        (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets')
    )
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($r in $roots) {
        if (-not (Test-Path -LiteralPath $r)) { continue }
        try {
            Get-ChildItem -LiteralPath $r -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Length -ge 100kb } |
                ForEach-Object { $out.Add($_) }
        } catch { }
    }
    return $out
}

function Get-FileHashHex {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try { return ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLowerInvariant() }
        finally { $fs.Dispose() }
    } finally { $sha.Dispose() }
}

function Get-SpotlightMeta {
    param([string]$ImagePath)
    $meta = [ordered]@{}
    try {
        $dir = Split-Path -Parent $ImagePath
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $meta }

        $jsonFiles = @(Get-ChildItem -LiteralPath $dir -Filter *.json -File -ErrorAction SilentlyContinue |
                       Select-Object -First 6)
        foreach ($j in $jsonFiles) {
            try { $obj = Get-Content -LiteralPath $j.FullName -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
            catch { continue }
            foreach ($k in @('title','copyright','description','headline','location','locationName','entityDescription')) {
                $v = Prop $obj $k
                if ($v -and -not $meta.Contains($k)) { $meta[$k] = [string]$v }
            }
        }

        if ($meta.Count -eq 0) {
            $blobs = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
                       Where-Object { $_.Length -lt 200kb -and ($_.Extension -in @('.json','.txt','')) } |
                       Select-Object -First 10)
            $patterns = @(
                @{ k = 'title';     re = '"(?:title|headline)"\s*:\s*"([^"]{2,200})"' },
                @{ k = 'copyright'; re = '"copyright"\s*:\s*"([^"]{2,300})"' },
                @{ k = 'location';  re = '"(?:location|locationName|country|entityName)"\s*:\s*"([^"]{2,200})"' }
            )
            foreach ($f in $blobs) {
                $c = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
                if (-not $c) { continue }
                foreach ($p in $patterns) {
                    if ($meta.Contains($p.k)) { continue }
                    $m = [regex]::Match($c, $p.re)
                    if ($m.Success) { $meta[$p.k] = $m.Groups[1].Value }
                }
            }
        }
    } catch { Write-StdErr "meta scan failed: $_" }
    return $meta
}

function Resolve-Current {
    $path   = Get-RegistryWallpaper
    $source = 'registry'

    if (-not $path) {
        $cand = @(Get-CacheCandidates | Sort-Object LastWriteTimeUtc -Descending)
        if ($cand.Count -eq 0) { return $null }
        $pick = $null
        foreach ($f in ($cand | Select-Object -First 12)) {
            try {
                $img = [System.Drawing.Image]::FromFile($f.FullName)
                try { $landscape = ($img.Width -ge 1000 -and $img.Width -ge $img.Height) }
                finally { $img.Dispose() }
                if ($landscape) { $pick = $f; break }
            } catch { }
        }
        if (-not $pick) { $pick = $cand[0] }
        $path   = $pick.FullName
        $source = 'cache'
    }

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }

    $entry = [ordered]@{
        path   = $path
        source = $source
        hash   = (Get-FileHashHex $path)
        ts     = (Get-Date).ToString('o')
        meta   = (Get-SpotlightMeta $path)
    }

    # The registry image is often TranscodedWallpaper (no Spotlight metadata
    # alongside it). Fall back to the newest IrisService asset for metadata.
    if ($entry.meta.Count -eq 0 -and $source -eq 'registry') {
        $iris = @(Get-CacheCandidates |
                  Where-Object { $_.FullName -like '*IrisService*' } |
                  Sort-Object LastWriteTimeUtc -Descending |
                  Select-Object -First 1)
        if ($iris.Count) { $entry.meta = Get-SpotlightMeta $iris[0].FullName }
    }

    return $entry
}

# --------------------------------------------------------------------------
# Image encoding
# --------------------------------------------------------------------------
function Encode-Jpeg {
    param([string]$Path, [int]$MaxDim, [int]$Quality)
    $img = [System.Drawing.Image]::FromFile($Path)
    try {
        $w = $img.Width; $h = $img.Height
        $scale = [Math]::Min(1.0, $MaxDim / [double][Math]::Max($w, $h))
        $nw = [Math]::Max(1, [int][Math]::Round($w * $scale))
        $nh = [Math]::Max(1, [int][Math]::Round($h * $scale))

        $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
        try {
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.DrawImage($img, 0, 0, $nw, $nh)
            } finally { $g.Dispose() }

            $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                   Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid } |
                   Select-Object -First 1
            $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)

            $ms = New-Object System.IO.MemoryStream
            try { $bmp.Save($ms, $enc, $ep); return , $ms.ToArray() }
            finally { $ms.Dispose(); $ep.Dispose() }
        } finally { $bmp.Dispose() }
    } finally { $img.Dispose() }
}

function Get-BoundedDataUrl {
    param([string]$Path)
    $dim = [int]$script:Config.maxDimension
    $q   = [int]$script:Config.jpegQuality
    $b64 = ''
    for ($i = 0; $i -lt 6; $i++) {
        $bytes = Encode-Jpeg -Path $Path -MaxDim $dim -Quality $q
        $b64   = [Convert]::ToBase64String($bytes)
        if ($b64.Length -le $script:MaxBase64) { break }
        if ($q -gt 62) { $q -= 8 } else { $dim = [int]($dim * 0.85) }
    }
    return @{ dataUrl = "data:image/jpeg;base64,$b64"; base64Len = $b64.Length }
}

# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------
function Get-HistoryIndexPath { Join-Path $script:HistoryDir 'index.json' }

function Load-HistoryIndex {
    $p = Get-HistoryIndexPath
    if (Test-Path -LiteralPath $p) {
        try { return @(Get-Content -LiteralPath $p -Raw | ConvertFrom-Json) } catch { return @() }
    }
    return @()
}

function Save-HistoryIndex {
    param($Items)
    try { (@($Items) | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath (Get-HistoryIndexPath) -Encoding UTF8 }
    catch { Write-StdErr "save history failed: $_" }
}

function Register-History {
    param($Current)
    if (-not $Current -or [int]$script:Config.historyMax -le 0) { return }

    $idx = @(Load-HistoryIndex)
    if ($idx.Count -gt 0 -and $idx[0].hash -eq $Current.hash) { return }
    $idx = @($idx | Where-Object { $_.hash -ne $Current.hash })

    $file = Join-Path $script:HistoryDir ('{0}-{1}.jpg' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Current.hash.Substring(0, 8))
    try { [System.IO.File]::WriteAllBytes($file, (Encode-Jpeg -Path $Current.path -MaxDim 1600 -Quality 82)) }
    catch { Write-StdErr "history capture failed: $_"; return }

    $entry = [ordered]@{
        hash   = $Current.hash
        ts     = $Current.ts
        file   = $file
        source = $Current.source
        origin = $Current.path
        meta   = $Current.meta
    }
    $idx = @(@($entry) + $idx)

    $max = [int]$script:Config.historyMax
    if ($idx.Count -gt $max) {
        foreach ($old in $idx[$max..($idx.Count - 1)]) {
            try { Remove-Item -LiteralPath $old.file -ErrorAction SilentlyContinue } catch { }
        }
        $idx = @($idx[0..($max - 1)])
    }
    Save-HistoryIndex $idx
}

function Build-HistoryMessage {
    $items = foreach ($e in @(Load-HistoryIndex)) {
        $thumb = $null
        if (Test-Path -LiteralPath $e.file) {
            try { $thumb = 'data:image/jpeg;base64,' + [Convert]::ToBase64String((Encode-Jpeg -Path $e.file -MaxDim 360 -Quality 68)) }
            catch { }
        }
        [ordered]@{ hash = $e.hash; ts = $e.ts; source = $e.source; meta = $e.meta; thumb = $thumb }
    }
    return @{ type = 'history'; ok = $true; items = @($items) }
}

function Build-ImageMessage {
    param([string]$Hash)
    $e = @(Load-HistoryIndex) | Where-Object { $_.hash -eq $Hash } | Select-Object -First 1
    if ($e -and (Test-Path -LiteralPath $e.file)) {
        $b64 = [Convert]::ToBase64String((Encode-Jpeg -Path $e.file -MaxDim ([int]$script:Config.maxDimension) -Quality ([int]$script:Config.jpegQuality)))
        return @{ type = 'image'; ok = $true; hash = $Hash; image = "data:image/jpeg;base64,$b64"; meta = $e.meta; timestamp = $e.ts }
    }
    return @{ type = 'image'; ok = $false; hash = $Hash; error = 'not_found' }
}

# --------------------------------------------------------------------------
# Message assembly
# --------------------------------------------------------------------------
function Build-CurrentMessage {
    param($Current, [string]$Type = 'current')
    if (-not $Current) {
        $top = @(Load-HistoryIndex) | Select-Object -First 1
        return @{
            type          = $Type
            ok            = $false
            error         = 'spotlight_unavailable'
            lastKnownHash = (Prop $top 'hash')
        }
    }
    $d = Get-BoundedDataUrl -Path $Current.path
    return @{
        type      = $Type
        ok        = $true
        hash      = $Current.hash
        source    = $Current.source
        path      = $Current.path
        timestamp = $Current.ts
        meta      = $Current.meta
        image     = $d.dataUrl
        base64Len = $d.base64Len
    }
}

function Handle-Message {
    param([string]$Json)
    $msg = $null
    try { $msg = $Json | ConvertFrom-Json } catch { Write-NativeMessage @{ type = 'error'; error = 'bad_json' }; return }

    $action = [string](Prop $msg 'action')
    $id     = Prop $msg 'id'
    $reply  = $null

    switch ($action) {
        'ping'        { $reply = @{ type = 'pong' } }
        'get_current' { $reply = Build-CurrentMessage $script:Current 'current' }
        'get_history' { $reply = Build-HistoryMessage }
        'get_image'   { $reply = Build-ImageMessage ([string](Prop $msg 'hash')) }
        'clear_history' {
            foreach ($e in @(Load-HistoryIndex)) {
                try { Remove-Item -LiteralPath $e.file -ErrorAction SilentlyContinue } catch { }
            }
            Save-HistoryIndex @()
            $reply = @{ type = 'history'; ok = $true; items = @() }
        }
        'set_config'  {
            $cfg = Prop $msg 'config'
            if ($cfg) {
                foreach ($k in @('pollSeconds','historyMax','maxDimension','jpegQuality')) {
                    $v = Prop $cfg $k
                    if ($null -ne $v) { $script:Config[$k] = [int]$v }
                }
                Clamp-Config
                Save-State
            }
            $reply = @{ type = 'config'; ok = $true; config = $script:Config }
        }
        default { $reply = @{ type = 'error'; error = 'unknown_action'; action = $action } }
    }

    if ($null -ne $id) { $reply['id'] = $id }
    Write-NativeMessage $reply
}

# --------------------------------------------------------------------------
# stdin reader (separate runspace; enqueues raw JSON strings, then EOF)
# --------------------------------------------------------------------------
function Start-Reader {
    $script:Rs = [runspacefactory]::CreateRunspace()
    $script:Rs.Open()
    $script:RsPs = [powershell]::Create()
    $script:RsPs.Runspace = $script:Rs
    $null = $script:RsPs.AddScript({
        param($stdin, $queue)
        function ReadExact($s, $n) {
            $b = New-Object byte[] $n
            $o = 0
            while ($o -lt $n) {
                $r = $s.Read($b, $o, $n - $o)
                if ($r -le 0) { return $null }
                $o += $r
            }
            return , $b
        }
        try {
            while ($true) {
                $lb = ReadExact $stdin 4
                if ($null -eq $lb) { break }
                $len = [BitConverter]::ToUInt32($lb, 0)
                if ($len -eq 0) { continue }
                if ($len -gt 67108864) { break }   # 64 MB sanity cap on inbound
                $pb = ReadExact $stdin $len
                if ($null -eq $pb) { break }
                $queue.Enqueue([Text.Encoding]::UTF8.GetString($pb))
            }
        } catch {
            [Console]::Error.WriteLine('[spotlight-host] reader: ' + $_)
        }
        $queue.Enqueue(@{ __eof = $true })
    }).AddArgument($script:StdIn).AddArgument($script:Queue)
    $script:RsHandle = $script:RsPs.BeginInvoke()
}

function Shutdown {
    param([int]$Code = 0)
    try { $script:StdOut.Flush() } catch { }
    try { if ($script:RsPs) { $script:RsPs.Stop() } } catch { }
    try { if ($script:Rs)  { $script:Rs.Close() } } catch { }
    [Environment]::Exit($Code)
}

# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------
function Main {
    Load-State
    Start-Reader

    try { $script:Current = Resolve-Current } catch { Write-StdErr "initial resolve failed: $_" }
    if ($script:Current) { try { Register-History $script:Current } catch { Write-StdErr "history capture failed: $_" } }
    Save-State
    Write-StdErr "ready (source=$(Prop $script:Current 'source' '<none>'))"

    $lastCheck = [DateTime]::UtcNow

    while ($true) {
        $item = $null
        while ($script:Queue.TryDequeue([ref]$item)) {
            if ($item -is [string]) {
                try { Handle-Message $item } catch { Write-StdErr "handle failed: $_" }
            } elseif ($item -is [hashtable] -and $item.ContainsKey('__eof')) {
                Shutdown 0
            }
        }

        if (([DateTime]::UtcNow - $lastCheck).TotalSeconds -ge [int]$script:Config.pollSeconds) {
            $lastCheck = [DateTime]::UtcNow
            try {
                $next = Resolve-Current
                if ($next -and (-not $script:Current -or $next.hash -ne $script:Current.hash)) {
                    $script:Current = $next
                    Register-History $next
                    Save-State
                    Write-NativeMessage (Build-CurrentMessage $next 'changed')
                }
            } catch { Write-StdErr "poll failed: $_" }
        }

        Start-Sleep -Milliseconds 400
    }
}

try {
    Main
} catch {
    Write-StdErr "fatal: $_"
    Shutdown 1
}

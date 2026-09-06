# CLAUDE.md — native-host/

The native-messaging helper. **Windows PowerShell 5.1 + .NET Framework only**
— no Python, no Pillow, no PyInstaller. `System.Drawing` does the resizing.

## Files

| File | Role |
|------|------|
| `spotlight_host.ps1` | The helper. |
| `spotlight_host.cmd` | Launcher Firefox actually executes (`powershell.exe -File spotlight_host.ps1`). Firefox appends the manifest path / extension id as args; the `.cmd` intentionally does **not** forward them. |
| `windows_spotlight_sync.template.json` | Manifest template. `install.ps1` copies it to `%LOCALAPPDATA%\FirefoxSpotlightSync\windows_spotlight_sync.json` with `path` set to the absolute `.cmd` path. |

## Structure of `spotlight_host.ps1`

- **IO**: raw `[Console]::OpenStandardInput/Output()` streams. `Write-NativeMessage`
  frames replies (`uint32` LE length + UTF-8 JSON, `ConvertTo-Json -Depth 12 -Compress`).
- **Reader runspace** (`Start-Reader`): a second runspace does the blocking
  `stdin` reads and enqueues raw JSON strings onto a `ConcurrentQueue`; on EOF
  it enqueues `@{__eof=$true}`. Only the main thread writes stdout.
- **Main loop** (`Main`): drains the queue (`Handle-Message`), and every
  `Config.pollSeconds` runs `Resolve-Current`; if the SHA-1 changed it captures
  history and pushes a `changed` message. `__eof` ⇒ `Shutdown 0` (this also
  handles one-shot `sendNativeMessage` clients).
- **Discovery**: `Get-RegistryWallpaper` → `Get-CacheCandidates` (Iris /
  DesktopSpotlight / ContentDeliveryManager). `Resolve-Current` returns
  `{path, source, hash, ts, meta}`.
- **Encoding**: `Encode-Jpeg` (bicubic downscale) → `Get-BoundedDataUrl` shrinks
  until base64 ≤ `MaxBase64` (700 KB) to stay under Firefox's 1 MB message cap.
- **History**: `%LOCALAPPDATA%\FirefoxSpotlightSync\history\` + `index.json`,
  capped at `Config.historyMax`, re-encoded to ≤1600 px.
- **Metadata**: `Get-SpotlightMeta` — best-effort parse of sibling `*.json` /
  blob files for `title` / `copyright` / `location`. Absent ⇒ `{}`; never fatal.
- **Config**: persisted to `state.json`, clamped by `Clamp-Config`.

## Hard rules

- **stdout is sacred** — framed messages only. Everything else → `Write-StdErr`.
  Keep `$ProgressPreference = 'SilentlyContinue'`.
- `Set-StrictMode -Version 2.0` is on: read optional PSCustomObject fields via
  `Prop $obj 'name' $default`, never `$obj.name` directly.
- Return byte arrays with a leading comma (`return , $bytes`) so PowerShell
  does not unroll them.
- `Dispose()` every `Image` / `Bitmap` / `Graphics` / stream (all wrapped in
  `try/finally`).

## Manual test

```powershell
.\..\scripts\diagnose.ps1     # does a real framed get_current round-trip
```

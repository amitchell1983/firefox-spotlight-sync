# Windows Spotlight Sync for Firefox

Replaces the Firefox **New Tab** background with the current **Windows
Spotlight** desktop wallpaper, and keeps it in sync automatically as Windows
rotates it.

- **No Python / no dependencies** — the helper is a single PowerShell script
  using components already on Windows.
- **Automatic updates** — a persistent background page holds a live connection
  to the helper, which watches for wallpaper changes and pushes them.
- **Efficient** — the full image crosses native messaging only when it changes;
  opening a New Tab reads a local cache.
- **History, metadata, and Firefox-style controls** — clock, search, darkening,
  blur, caption, and a history strip, all in a settings panel.
- **100% local** — no web service, no telemetry.

## Requirements

- Windows 10/11 with Windows Spotlight enabled for the desktop or lock screen.
- Windows PowerShell 5.1 (built in) — the `powershell.exe` that ships with Windows.
- Firefox 115+.

## Install

1. Extract this project somewhere permanent, e.g. `C:\Tools\FirefoxSpotlightSync`.
2. Open **PowerShell** in that folder and run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\install.ps1
   ```
   This generates the native-messaging manifest with an absolute path to the
   helper, registers it under your user account (`HKCU`), and builds
   `dist\windows_spotlight_sync-<version>.xpi`.
3. **Fully close and reopen Firefox.**
4. Load the extension:
   - **Temporary** (resets on Firefox restart): open
     `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
     select `extension\manifest.json`.
   - **Permanent**: see *Permanent installation* below.
5. Open a new tab.

## Permanent installation

Firefox only loads extensions permanently if they are signed, **or** the build
allows unsigned extensions:

- **Firefox Developer Edition / Nightly / ESR** — set
  `xpinstall.signatures.required = false` in `about:config`, then open the
  `.xpi` from `dist\` (drag it onto Firefox or `about:addons` → *Install Add-on
  From File*).
- **Managed install** — run an **elevated** PowerShell and:
  ```powershell
  .\scripts\install.ps1 -Managed
  ```
  This writes `distribution\policies.json` in the Firefox program folder with an
  `ExtensionSettings` entry pointing at the built `.xpi`. Signature rules still
  apply on release Firefox.
- **Signed** — submit `extension/` to
  [addons.mozilla.org](https://addons.mozilla.org/developers/) for signing and
  install the signed `.xpi`.

## Settings

Open the **⚙** button on the New Tab page (or the extension's options page):

- Clock (12/24 h, seconds), search box + engine
- **Shortcuts** — your Firefox Top Sites plus tiles you add yourself (hover a
  tile to remove it; the **+** tile adds one). 10 wide; 1-4 rows in settings.
  Drag an unpinned tile to reorder it; use 📌 to lock a tile in place (a pinned
  tile can't be moved or removed until you unpin it). Added shortcuts pick up
  the site's favicon automatically.
- Darkening and blur of the background
- Wallpaper caption (title / location / copyright, when Windows provides it)
- History size, check interval, and image resolution (these are applied by the
  helper)
- **🕐** button: browse and preview saved wallpapers; *Back to live* returns to
  the current one.

## Troubleshooting

Run:
```powershell
.\scripts\diagnose.ps1
```
It checks the helper files, the generated manifest and the path inside it, the
Firefox registry entry, Windows' reported wallpaper, the Spotlight cache
folders, and performs a **live request/response** against the helper. Paste its
output when reporting a problem.

Common causes:
- Firefox was not fully restarted after `install.ps1`.
- The temporary add-on was dropped on Firefox restart (use a permanent install).
- Spotlight is disabled — enable it in *Settings → Personalization*.

## Uninstall

```powershell
.\scripts\uninstall.ps1        # add -KeepData to keep history/state
```
Then remove the extension from `about:addons`.

## How it works

```
Windows Spotlight cache ──► spotlight_host.ps1 ──(native messaging)──► background.js ──► storage.local ──► New Tab
        registry wallpaper        (poll + hash)        push "changed"        cache            render (crossfade)
```

The helper prefers the wallpaper Windows itself reports
(`HKCU\Control Panel\Desktop\Wallpaper`) and falls back to the newest large
landscape image in the Spotlight caches. See `CLAUDE.md` for the full protocol
and internals.

## Privacy

Everything runs on your machine. The extension has no host permissions; the
shortcuts grid reads Firefox's own Top Sites via the `topSites` API, and the
helper only reads local image files and the wallpaper registry value. The only
outbound request the page can make is loading `/favicon.ico` from a site you
added yourself as a custom shortcut (when its icon isn't already in Top Sites).

## License

MIT — see `LICENSE`.

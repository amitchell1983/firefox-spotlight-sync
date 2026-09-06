# Changelog

## Unreleased

### Added
- **Shortcuts grid** on the New Tab page: Firefox Top Sites
  (`topSites` permission) merged with user-added tiles, each removable; an
  "Add" tile creates custom shortcuts. New settings: *Show shortcuts* and
  *Shortcut count* (4 / 8 / 12). Stored in `storage.local.shortcuts`
  (`{ custom, blocked }`). Favicons come from the topSites API — still no
  network requests from the page.

## 0.2.0 — 2026-09-05

Full rebuild around a dependency-free helper and automatic sync.

### Added
- **Automatic change detection.** The background page holds a persistent
  `connectNative` port; the helper polls for wallpaper changes and pushes a
  `changed` event. New tabs update without being reopened.
- **Wallpaper history.** Configurable (off / 5 / 10 / 20 / 50). Browse and
  preview past wallpapers from the New Tab history panel; clear from options.
- **Spotlight metadata.** Best-effort title / location / copyright caption when
  Windows provides it.
- **Settings panel** on the New Tab page: clock (12/24 h, seconds), search box
  and engine, darkening, blur, caption toggle, plus helper settings (interval,
  history size, image resolution).
- **`scripts/install.ps1`** generates the native manifest with an absolute,
  machine-specific path — no manual JSON editing.
- **`scripts/diagnose.ps1`** now performs a live framed request/response against
  the helper in addition to file/registry checks.
- **`scripts/build-xpi.ps1`** and `scripts/uninstall.ps1`.
- Enterprise-policy install path (`install.ps1 -Managed`) for permanent
  installation, documented alongside the signing requirements.
- `CLAUDE.md` at the repo root and in `extension/` and `native-host/`.

### Changed
- **Native host rewritten in PowerShell.** Removed Python, Pillow and
  PyInstaller entirely; resizing uses .NET `System.Drawing`.
- Image transfer is now change-triggered only; routine New Tab opens read a
  local `storage.local` cache instead of receiving a fresh base64 image.
- Image payload is bounded below Firefox's 1 MB native-message limit by
  progressively reducing quality then dimensions.

### Fixed
- Native-messaging manifest shipped with a hard-coded build-environment path
  (`/mnt/data/...`). The manifest is now generated at install time and never
  committed.

### Removed
- `native-host/spotlight_host.py`, `native-host/spotlight_host.bat`,
  root `install-host.ps1` and `diagnose.ps1` (replaced by `scripts/`).

## 0.1.1 — prior

Firefox New Tab showed the current Spotlight image on tab open, via a
Python + Pillow native host built with PyInstaller. Broke on install because
the packaged native manifest contained a Linux build path.

# Changelog

## Unreleased

### Added
- **Manual shortcut icon.** Custom shortcuts have an "Icon URL" field (in the
  Add form and a new edit ✎ button on each custom tile) so you can point at an
  icon yourself when the site's favicon doesn't load. A manual icon is marked
  `iconManual` and never auto-overwritten; clearing it re-resolves normally.
  The edit form also lets you change a shortcut's name/URL (pin + order
  references migrate with a URL change).
- **Settings & shortcuts persist across updates.** `settings` and `shortcuts`
  are mirrored to `storage.sync`; on startup anything missing from
  `storage.local` (e.g. after an update or reinstall) is restored from it.
  `data:` favicons are dropped from the synced copy (re-resolved on restore) to
  stay within sync quota. Options page gains **Export / Import** (JSON) for a
  full-fidelity backup. Note: `storage.local` remains the working copy and wins
  when both exist — this is update resilience, not live multi-device merge.

## 0.3.0 — 2026-09-05

### Added
- The Spotlight page is now also the **homepage / new-window page**, not just
  the New Tab page (`chrome_settings_overrides.homepage`). Firefox asks once to
  confirm the homepage change; it can be reverted from
  `about:preferences#home` or by removing the extension.
- Custom (user-added) shortcuts now get a real favicon: the **Add** form shows
  a live icon preview as you type the URL, and each custom tile resolves its
  icon from a matching Top Sites favicon when possible, otherwise the site's
  own `/favicon.ico` (falling back to a letter tile if there is none). Resolved
  icons are cached on the shortcut (`storage.local.shortcuts.custom[].icon`).

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
- **Shortcuts grid** on the New Tab page: Firefox Top Sites
  (`topSites` permission) merged with user-added tiles, each removable; an
  "Add" tile creates custom shortcuts. Fixed 10 tiles wide; settings *Show
  shortcuts* and *Shortcut rows* (1-4, default 3 → 10x3). Favicons come from
  the topSites API — still no network requests from the page.
- **Reposition & pin shortcuts.** Drag an unpinned tile onto any slot to move
  it there, shifting the other unpinned tiles (`storage.local.shortcuts.order`).
  The 📌 button pins/unpins a tile: a **pinned tile is locked** — it can't be
  dragged, can't be displaced by a drop, its remove (×) is disabled, and its
  slot is fixed (`storage.local.shortcuts.pinned`, `{ url: slotIndex }`).
  Dragging never changes pin state. The 📌 icon shows only on hover; the ring
  around a tile marks it as pinned.
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

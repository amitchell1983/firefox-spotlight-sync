# CLAUDE.md — extension/

WebExtension, **Manifest V2** (Firefox 115+). No build step; files load as-is.
No bundler, no npm. Use the `browser.*` promise API.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV2. `persistent: true` background (we hold a long-lived native port). `chrome_url_overrides.newtab`. `permissions: nativeMessaging, storage, topSites`. |
| `background.js` | Owns the single `connectNative("windows_spotlight_sync")` port. Caches the current image into `storage.local`, retries the port with exponential backoff (3s→60s), and proxies page requests to the helper with `id` correlation. |
| `newtab.html/.css/.js` | Renders from `storage.local`; two `.bg` layers for crossfade; settings + history panel; clock; search. Never calls `connectNative` itself. |
| `options.html/.css/.js` | Setup instructions, live "Test native helper", history size + clear, reset settings. |
| `icons/icon.svg` | Toolbar / about:addons icon. |

## storage.local schema

```jsonc
current  = { status: "ok"|"disconnected"|"unavailable",
             hash, image /* data URL */, meta, source, path, timestamp, updatedAt, error? }
settings = { clock, clockSeconds, hour24, search, engine,
             darkness, blur, showMeta, shortcuts, shortcutRows,
             historyMax, pollSeconds, maxDimension, jpegQuality }   // last 4 forwarded to the helper via set_config
shortcuts = { custom: [{ title, url }], blocked: [url, ...],
              pinned: { "<url>": <slotIndex> } }                    // overlay on browser.topSites.get()
```

Shortcuts grid: candidates = `custom` tiles then
`browser.topSites.get({includeFavicon:true})` minus `blocked`. `computeSlots()`
**locks** each `pinned` url to its exact slot index (never moved; a same-index
collision is the only exception), then fills the remaining gaps left-to-right;
rendered through the last filled slot (interior gaps are drop targets). Grid is
fixed 10 wide; `shortcutRows` 1-4 (default 3). Tiles are `draggable`; dropping
on a slot pins the dragged url there and, if occupied, swaps — the displaced
tile takes the dragged tile's old slot (`dropOnSlot`, using `currentSlots`).
The 📌 button pins/unpins in place. Favicons come from the topSites API
(Firefox's cache) — the page makes no network requests.

`newtab.js` merges `settings` over `DEFAULTS`; `background.js` forwards the
four host keys to the helper via `set_config` whenever `settings` changes.

## Page ⇄ background messages (`runtime.sendMessage`)

`get_current` · `refresh` · `get_history` · `get_image {hash}` ·
`clear_history` · `ping` · `set_host_config`. Background returns a Promise;
on port failure it falls back to the cached `storage.local.current`.

## Rules

- Do not add a New-Tab-time native call on the render path — read
  `storage.local.current` and subscribe to `storage.onChanged`.
- Keep MV2 + `persistent: true`; the port must outlive individual tabs.
- No remote scripts/styles/fonts; everything is local (AMO policy + privacy).
- Extension id is fixed: `windows-spotlight-sync@example.local`.

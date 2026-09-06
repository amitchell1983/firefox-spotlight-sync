"use strict";

const $ = (sel) => document.querySelector(sel);

const DEFAULTS = {
  clock: true,
  clockSeconds: false,
  hour24: false,
  search: true,
  engine: "google",
  darkness: 0.28,
  blur: 0,
  showMeta: true,
  shortcuts: true,
  shortcutRows: 3,
  historyMax: 10,
  pollSeconds: 15,
  maxDimension: 1600,
  jpegQuality: 82,
};

const ENGINES = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

// -------------------------------------------------------------------------
// Persistence: `settings` + `shortcuts` are mirrored to storage.sync so they
// survive an extension update / reinstall (storage.local can be cleared then).
// storage.local stays the working copy everything else reads.
// -------------------------------------------------------------------------
const SYNCED_KEYS = ["settings", "shortcuts"];

function shortcutsForSync(v) {
  if (!v || !Array.isArray(v.custom)) return v;
  return {
    ...v,
    custom: v.custom.map((c) => {
      if (c.icon && c.icon.startsWith("data:")) {
        const { icon, ...rest } = c; // drop heavy inline icon; re-resolves on restore
        return rest;
      }
      return c;
    }),
  };
}

function mirrorToSync(partial) {
  const out = {};
  for (const [k, v] of Object.entries(partial)) {
    out[k] = k === "shortcuts" ? shortcutsForSync(v) : v;
  }
  // best-effort: sync may be disabled or over quota — the local copy still holds
  return browser.storage.sync.set(out).catch(() => {});
}

async function saveSetting(settings) {
  await browser.storage.local.set({ settings });
  mirrorToSync({ settings });
}

async function persistShortcuts(data) {
  await browser.storage.local.set({ shortcuts: data });
  mirrorToSync({ shortcuts: data });
}

// On startup, pull any synced key that the local store is missing (fresh install
// after an update). Local wins when both exist — it's this device's working copy.
async function reconcileSyncedStorage() {
  let loc = {};
  let syn = {};
  try {
    loc = await browser.storage.local.get(SYNCED_KEYS);
  } catch (e) {
    /* ignore */
  }
  try {
    syn = await browser.storage.sync.get(SYNCED_KEYS);
  } catch (e) {
    /* ignore */
  }
  const patch = {};
  for (const k of SYNCED_KEYS) {
    if (loc[k] === undefined && syn[k] !== undefined) patch[k] = syn[k];
  }
  if (Object.keys(patch).length) {
    try {
      await browser.storage.local.set(patch);
    } catch (e) {
      /* ignore */
    }
  }
}

const els = {
  shade: $("#shade"),
  clock: $("#clock"),
  date: $("#date"),
  search: $("#search"),
  q: $("#q"),
  shortcuts: $("#shortcuts"),
  meta: $("#meta"),
  status: $("#status"),
  btnLive: $("#btn-live"),
  btnHistory: $("#btn-history"),
  btnSettings: $("#btn-settings"),
  panel: $("#panel"),
  panelTitle: $("#panel-title"),
  panelClose: $("#panel-close"),
  settingsView: $("#settings-view"),
  historyView: $("#history-view"),
  historyGrid: $("#history-grid"),
  historyHint: $("#history-hint"),
  sourceHint: $("#source-hint"),
};

let settings = { ...DEFAULTS };
let bgFront = $("#bg-a");
let bgBack = $("#bg-b");
let liveHash = null;
let pinnedHash = null;

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function showImage(url) {
  bgBack.style.backgroundImage = `url("${url}")`;
  bgBack.classList.add("visible");
  bgFront.classList.remove("visible");
  [bgFront, bgBack] = [bgBack, bgFront];
}

function setStatus(text) {
  els.status.textContent = text || "";
  els.status.hidden = !text;
}

function renderMeta(meta) {
  if (!settings.showMeta || !meta) {
    els.meta.hidden = true;
    return;
  }
  const title = meta.title || meta.headline || "";
  const sub = [meta.location, meta.copyright].filter(Boolean).join(" · ");
  if (!title && !sub) {
    els.meta.hidden = true;
    return;
  }
  els.meta.replaceChildren();
  if (title) {
    const t = document.createElement("div");
    t.className = "meta-title";
    t.textContent = title;
    els.meta.appendChild(t);
  }
  if (sub) {
    const s = document.createElement("div");
    s.className = "meta-sub";
    s.textContent = sub;
    els.meta.appendChild(s);
  }
  els.meta.hidden = false;
}

function renderCurrent(cur) {
  if (!cur) return;
  if (cur.image && (cur.hash !== liveHash || !document.querySelector(".bg.visible"))) {
    liveHash = cur.hash || liveHash;
    showImage(cur.image);
  }
  renderMeta(cur.meta);
  els.sourceHint.textContent = cur.source ? `Source: ${cur.source}` : "";

  if (cur.status === "disconnected") {
    setStatus("Spotlight helper offline — showing last image");
  } else if (cur.status === "unavailable") {
    setStatus("Spotlight temporarily unavailable — showing last image");
  } else {
    setStatus("");
  }
}

// -------------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------------
function applySettings() {
  els.clock.hidden = !settings.clock;
  els.date.hidden = !settings.clock;
  els.search.hidden = !settings.search;
  els.shade.style.background = `rgba(0,0,0,${settings.darkness})`;
  const blur = `blur(${settings.blur}px)`;
  bgFront.style.filter = blur;
  bgBack.style.filter = blur;
  tickClock();
  renderShortcuts();
}

function bindSettingControls() {
  const map = [
    ["#s-clock", "clock", "checked"],
    ["#s-clock-seconds", "clockSeconds", "checked"],
    ["#s-hour24", "hour24", "checked"],
    ["#s-search", "search", "checked"],
    ["#s-showmeta", "showMeta", "checked"],
    ["#s-shortcuts", "shortcuts", "checked"],
    ["#s-shortcutrows", "shortcutRows", "number"],
    ["#s-engine", "engine", "value"],
    ["#s-darkness", "darkness", "number"],
    ["#s-blur", "blur", "number"],
    ["#s-historymax", "historyMax", "number"],
    ["#s-pollseconds", "pollSeconds", "number"],
    ["#s-maxdimension", "maxDimension", "number"],
  ];
  for (const [sel, key, kind] of map) {
    const el = $(sel);
    if (!el) continue;
    if (kind === "checked") el.checked = !!settings[key];
    else el.value = String(settings[key]);
    el.addEventListener("change", async () => {
      if (kind === "checked") settings[key] = el.checked;
      else if (kind === "number") settings[key] = Number(el.value);
      else settings[key] = el.value;
      await saveSetting(settings);
      applySettings();
      renderMeta(lastRenderedMeta);
    });
  }
}

let lastRenderedMeta = null;

// -------------------------------------------------------------------------
// Shortcuts (Firefox Top Sites + user-added tiles)
// -------------------------------------------------------------------------
let dragUrl = null; // url of the tile currently being dragged
let currentSlots = []; // last rendered slot layout, indexed by grid position

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function letterFor(site) {
  const h = hostOf(site.url || "");
  return (h[0] || (site.title || "?")[0] || "?").toUpperCase();
}

function tileFace(site) {
  const face = document.createElement("span");
  face.className = "face";
  const src = site.favicon || site.icon;
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", () => {
      img.remove();
      face.textContent = letterFor(site);
    });
    img.src = src;
    face.appendChild(img);
  } else {
    face.textContent = letterFor(site);
  }
  return face;
}

// Best icon for a user-added shortcut, resolved without extra API surface:
// reuse a Top Sites favicon for the same host if we have one, otherwise point
// at the site's own /favicon.ico (falls back to a letter tile if it 404s).
function iconForCustom(url, topByHost) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (topByHost && topByHost.get(host)) return topByHost.get(host);
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return null;
  }
}

async function saveShortcuts(data) {
  await persistShortcuts(data);
  renderShortcuts();
}

// Pin `url` — lock it to its current grid slot. Only the pin button calls this.
async function pinAt(data, url, idx) {
  data.pinned = { ...(data.pinned || {}) };
  data.pinned[url] = idx;
  await saveShortcuts(data);
}

async function unpin(data, url) {
  data.pinned = { ...(data.pinned || {}) };
  delete data.pinned[url];
  await saveShortcuts(data);
}

// Reorder an unpinned tile to the position of slot `idx`, shifting the other
// unpinned tiles. Never changes pin state; pinned slots are rejected upstream.
async function reorderTo(data, url, idx) {
  let list = currentSlots.filter((s) => s && !s.pinned).map((s) => s.url);
  const from = list.indexOf(url);
  if (from < 0) return;

  const target = currentSlots[idx];
  let to;
  if (target && !target.pinned && target.url !== url) {
    const t = list.indexOf(target.url);
    list.splice(from, 1);
    const t2 = list.indexOf(target.url);
    to = from < t ? t2 + 1 : t2; // dragged tile takes the target's visual slot
  } else {
    const before = currentSlots
      .slice(0, idx)
      .filter((s) => s && !s.pinned && s.url !== url).length;
    list.splice(from, 1);
    to = before;
  }
  to = Math.max(0, Math.min(to, list.length));
  list.splice(to, 0, url);

  data.order = list;
  await saveShortcuts(data);
}

function wireDropTarget(el, data, idx) {
  const locked = () => !!(currentSlots[idx] && currentSlots[idx].pinned);
  el.addEventListener("dragover", (e) => {
    if (!dragUrl || locked()) return; // a pinned slot cannot be a drop target
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-target");
    if (dragUrl && !locked()) reorderTo(data, dragUrl, idx);
  });
}

function makeTile(site, data, idx) {
  const a = document.createElement("a");
  a.className = "tile" + (site.pinned ? " pinned" : "");
  a.href = site.url;
  a.title = site.url;
  a.draggable = !site.pinned; // pinned tiles are locked in place
  a.appendChild(tileFace(site));

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = site.title || hostOf(site.url);
  a.appendChild(label);

  const pin = document.createElement("button");
  pin.className = "pin";
  pin.type = "button";
  pin.textContent = "\u{1F4CC}";
  pin.title = site.pinned ? "Unpin" : "Pin in place";
  pin.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (site.pinned) unpin(data, site.url);
    else pinAt(data, site.url, idx);
  });
  a.appendChild(pin);

  const rm = document.createElement("button");
  rm.className = "remove";
  rm.type = "button";
  rm.textContent = "×";
  if (site.pinned) {
    rm.disabled = true;
    rm.title = "Unpin to remove";
  } else {
    rm.title = "Remove";
    rm.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (site.custom) {
        data.custom = (data.custom || []).filter((c) => c.url !== site.url);
      } else {
        data.blocked = [...(data.blocked || []), site.url];
      }
      data.order = (data.order || []).filter((u) => u !== site.url);
      if (data.pinned && site.url in data.pinned) {
        data.pinned = { ...data.pinned };
        delete data.pinned[site.url];
      }
      await saveShortcuts(data);
    });
  }
  a.appendChild(rm);

  if (site.custom) {
    const edit = document.createElement("button");
    edit.className = "edit";
    edit.type = "button";
    edit.textContent = "✎"; // pencil
    edit.title = "Edit name / URL / icon";
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entry = (data.custom || []).find((c) => c.url === site.url) || site;
      showShortcutForm(data, entry);
    });
    a.appendChild(edit);
  }

  if (!site.pinned) {
    a.addEventListener("dragstart", (e) => {
      dragUrl = site.url;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", site.url);
      a.classList.add("dragging");
    });
    a.addEventListener("dragend", () => {
      dragUrl = null;
      a.classList.remove("dragging");
    });
  }
  wireDropTarget(a, data, idx);
  return a;
}

function makeEmptySlot(data, idx) {
  const d = document.createElement("div");
  d.className = "tile empty";
  const face = document.createElement("span");
  face.className = "face";
  d.appendChild(face);
  wireDropTarget(d, data, idx);
  return d;
}

// Lock pinned shortcuts to their exact slot; fill the remaining slots with the
// other candidates, ordered by `order` (drag arrangement) then natural order.
function computeSlots(candidates, pinned, order, limit) {
  const slots = new Array(limit).fill(null);
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const placedPinned = new Set();

  Object.keys(pinned || {})
    .map((url) => [url, Number(pinned[url])])
    .filter(([url, i]) => byUrl.has(url) && Number.isInteger(i) && i >= 0 && i < limit)
    .sort((a, b) => a[1] - b[1])
    .forEach(([url, i]) => {
      if (slots[i]) return; // exact-slot collision (rare): loser flows into a gap
      slots[i] = { ...byUrl.get(url), pinned: true };
      placedPinned.add(url);
    });

  const orderIdx = new Map((order || []).map((u, i) => [u, i]));
  const rest = candidates
    .filter((c) => !placedPinned.has(c.url))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const oa = orderIdx.has(a.c.url) ? orderIdx.get(a.c.url) : Infinity;
      const ob = orderIdx.has(b.c.url) ? orderIdx.get(b.c.url) : Infinity;
      return oa - ob || a.i - b.i;
    })
    .map((x) => x.c);

  let cursor = 0;
  for (const c of rest) {
    while (cursor < limit && slots[cursor]) cursor++;
    if (cursor >= limit) break;
    slots[cursor] = { ...c, pinned: false };
  }
  return slots;
}

function makeAddTile(data) {
  const btn = document.createElement("button");
  btn.className = "tile add";
  btn.type = "button";
  const face = document.createElement("span");
  face.className = "face";
  face.textContent = "+";
  btn.appendChild(face);
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Add";
  btn.appendChild(label);
  btn.addEventListener("click", () => showShortcutForm(data));
  return btn;
}

function normalizeUrl(v) {
  let u = (v || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    return new URL(u).href;
  } catch {
    return "";
  }
}

// Add form (editEntry omitted) or edit form for an existing custom shortcut.
// The optional "Icon URL" field lets you point at an icon manually when the
// site's favicon doesn't load.
function showShortcutForm(data, editEntry) {
  const box = els.shortcuts;
  const open = box.querySelector(".shortcut-form");
  if (open) open.remove();

  const editing = !!editEntry;
  const form = document.createElement("form");
  form.className = "shortcut-form";

  const preview = document.createElement("span");
  preview.className = "face preview";
  preview.textContent = "+";

  const name = document.createElement("input");
  name.className = "name";
  name.placeholder = "Name";
  name.required = true;

  const url = document.createElement("input");
  url.className = "url";
  url.type = "text";
  url.placeholder = "example.com";
  url.required = true;

  const iconUrl = document.createElement("input");
  iconUrl.className = "icon-url";
  iconUrl.type = "text";
  iconUrl.placeholder = "Icon URL (optional)";

  if (editing) {
    name.value = editEntry.title || "";
    url.value = editEntry.url || "";
    iconUrl.value = editEntry.iconManual ? editEntry.icon || "" : "";
  }

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "chip";
  save.textContent = editing ? "Update" : "Save";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "chip ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => form.remove());

  let resolvedIcon = editing ? editEntry.icon || null : null;
  let debounce;
  const updatePreview = () => {
    const manual = iconUrl.value.trim();
    const u = normalizeUrl(url.value);
    const src = manual || (u ? iconForCustom(u, null) : null);
    resolvedIcon = null;
    preview.textContent = "";
    if (!src) {
      preview.textContent = "+";
      return;
    }
    const img = document.createElement("img");
    img.alt = "";
    img.addEventListener("load", () => {
      resolvedIcon = src;
    });
    img.addEventListener("error", () => {
      img.remove();
      preview.textContent = ((hostOf(u) || "?")[0] || "?").toUpperCase();
    });
    img.src = src;
    preview.appendChild(img);
  };
  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(updatePreview, 400);
  };
  url.addEventListener("input", schedule);
  iconUrl.addEventListener("input", schedule);
  updatePreview();

  form.append(preview, name, url, iconUrl, save, cancel);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = normalizeUrl(url.value);
    if (!u) return;
    const manual = iconUrl.value.trim();

    const entry = { title: name.value.trim() || hostOf(u), url: u };
    if (manual) {
      entry.icon = manual;
      entry.iconManual = true;
    } else if (resolvedIcon) {
      entry.icon = resolvedIcon; // a favicon that actually loaded; else backfilled
    }

    data.custom = [...(data.custom || [])];
    if (editing) {
      const i = data.custom.findIndex((c) => c.url === editEntry.url);
      if (i >= 0) data.custom[i] = entry;
      else data.custom.push(entry);
      if (editEntry.url !== u) {
        if (data.pinned && editEntry.url in data.pinned) {
          data.pinned = { ...data.pinned, [u]: data.pinned[editEntry.url] };
          delete data.pinned[editEntry.url];
        }
        if (Array.isArray(data.order)) {
          data.order = data.order.map((x) => (x === editEntry.url ? u : x));
        }
      }
    } else {
      data.custom.push(entry);
    }
    await saveShortcuts(data);
  });

  box.appendChild(form);
  (editing ? url : name).focus();
}

async function renderShortcuts() {
  const box = els.shortcuts;
  if (!box) return;
  if (!settings.shortcuts) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }

  const store = await browser.storage.local.get("shortcuts");
  const data = store.shortcuts || { custom: [], blocked: [], pinned: {}, order: [] };

  let top = [];
  try {
    top = await browser.topSites.get({ includeFavicon: true, limit: 50 });
  } catch (e) {
    top = [];
  }

  const topByHost = new Map();
  for (const s of top) {
    try {
      if (s.favicon) topByHost.set(new URL(s.url).hostname, s.favicon);
    } catch (e) {
      /* ignore */
    }
  }

  // Give every custom shortcut an icon (Top Sites favicon for the same host,
  // else the site's /favicon.ico). Persist the backfill so it's resolved once;
  // the `icon` key is always written (even null) so this runs at most once.
  let iconsChanged = false;
  const custom = (data.custom || []).map((c) => {
    if ("icon" in c || c.favicon) return c;
    iconsChanged = true;
    return { ...c, icon: iconForCustom(c.url, topByHost) };
  });
  if (iconsChanged) {
    data.custom = custom;
    persistShortcuts(data).catch(() => {});
  }

  const blocked = new Set(data.blocked || []);
  const customUrls = new Set(custom.map((c) => c.url));
  const rows = Math.min(4, Math.max(1, settings.shortcutRows || 3));
  const limit = rows * 10; // grid is 10 tiles wide
  const candidates = [
    ...custom.map((c) => ({ ...c, custom: true })),
    ...top.filter((s) => !blocked.has(s.url) && !customUrls.has(s.url)),
  ];

  const slots = computeSlots(candidates, data.pinned || {}, data.order || [], limit);
  currentSlots = slots;
  let lastFilled = -1;
  slots.forEach((s, i) => { if (s) lastFilled = i; });

  box.replaceChildren();
  box.hidden = false;
  // Render through the last filled slot (gaps stay as drop targets); trailing
  // empty slots are omitted so the grid isn't a field of dashed boxes.
  for (let i = 0; i <= lastFilled; i++) {
    box.appendChild(slots[i] ? makeTile(slots[i], data, i) : makeEmptySlot(data, i));
  }
  box.appendChild(makeAddTile(data));
}

// -------------------------------------------------------------------------
// Clock
// -------------------------------------------------------------------------
function tickClock() {
  if (!settings.clock) return;
  const now = new Date();
  const opts = { hour: "numeric", minute: "2-digit", hour12: !settings.hour24 };
  if (settings.clockSeconds) opts.second = "2-digit";
  els.clock.textContent = new Intl.DateTimeFormat(undefined, opts).format(now);
  els.date.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

// -------------------------------------------------------------------------
// History
// -------------------------------------------------------------------------
async function openHistory() {
  els.panel.hidden = false;
  els.settingsView.hidden = true;
  els.historyView.hidden = false;
  els.panelTitle.textContent = "History";
  els.historyGrid.replaceChildren();
  els.historyHint.textContent = "Loading history…";

  const res = await browser.runtime.sendMessage({ type: "get_history" });
  if (!res || !res.ok || !res.items || res.items.length === 0) {
    els.historyHint.textContent =
      res && res.error ? `History unavailable: ${res.error}` : "No history yet.";
    return;
  }
  els.historyHint.textContent = "Click an image to preview it.";
  for (const item of res.items) {
    if (!item.thumb) continue;
    const img = document.createElement("img");
    img.src = item.thumb;
    img.title = [item.meta && item.meta.title, item.ts].filter(Boolean).join("\n");
    img.addEventListener("click", () => previewFromHistory(item.hash));
    els.historyGrid.appendChild(img);
  }
}

async function previewFromHistory(hash) {
  const res = await browser.runtime.sendMessage({ type: "get_image", hash });
  if (res && res.ok && res.image) {
    pinnedHash = hash;
    showImage(res.image);
    renderMeta(res.meta);
    lastRenderedMeta = res.meta;
    els.btnLive.hidden = false;
    setStatus("Previewing a saved wallpaper");
  }
}

async function backToLive() {
  pinnedHash = null;
  els.btnLive.hidden = true;
  liveHash = null;
  const { current } = await browser.storage.local.get("current");
  if (current) {
    renderCurrent(current);
    lastRenderedMeta = current.meta;
  }
}

// -------------------------------------------------------------------------
// Wiring
// -------------------------------------------------------------------------
els.search.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = els.q.value.trim();
  if (v) location.href = (ENGINES[settings.engine] || ENGINES.google) + encodeURIComponent(v);
});

els.btnSettings.addEventListener("click", () => {
  const showing = !els.panel.hidden && !els.settingsView.hidden;
  els.panel.hidden = showing;
  els.settingsView.hidden = false;
  els.historyView.hidden = true;
  els.panelTitle.textContent = "Settings";
});
els.btnHistory.addEventListener("click", openHistory);
els.panelClose.addEventListener("click", () => (els.panel.hidden = true));
els.btnLive.addEventListener("click", backToLive);

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    applySettings();
  }
  if (changes.current && !pinnedHash) {
    const cur = changes.current.newValue;
    renderCurrent(cur);
    lastRenderedMeta = cur && cur.meta;
  }
  if (changes.shortcuts) renderShortcuts();
});

async function init() {
  await reconcileSyncedStorage();
  const store = await browser.storage.local.get(["settings", "current"]);
  settings = { ...DEFAULTS, ...(store.settings || {}) };
  bindSettingControls();
  applySettings();

  if (store.current && store.current.image) {
    renderCurrent(store.current);
    lastRenderedMeta = store.current.meta;
  } else {
    setStatus("Waiting for Windows Spotlight…");
  }

  browser.runtime
    .sendMessage({ type: "get_current" })
    .then((r) => {
      if (pinnedHash) return;
      if (r && r.ok && r.image) {
        renderCurrent({
          status: "ok",
          hash: r.hash,
          image: r.image,
          meta: r.meta || {},
          source: r.source,
        });
        lastRenderedMeta = r.meta || {};
      } else if (r && r.status) {
        renderCurrent(r);
      }
    })
    .catch(() => {});

  tickClock();
  setInterval(tickClock, 1000);
}

init();

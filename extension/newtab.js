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
  els.meta.innerHTML = "";
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
      await browser.storage.local.set({ settings });
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

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function tileFace(site) {
  const face = document.createElement("span");
  face.className = "face";
  if (site.favicon) {
    const img = document.createElement("img");
    img.src = site.favicon;
    img.alt = "";
    face.appendChild(img);
  } else {
    const h = hostOf(site.url);
    face.textContent = (h[0] || (site.title || "?")[0] || "?").toUpperCase();
  }
  return face;
}

async function pinAt(data, url, idx) {
  data.pinned = { ...(data.pinned || {}) };
  data.pinned[url] = idx;
  await browser.storage.local.set({ shortcuts: data });
  renderShortcuts();
}

async function unpin(data, url) {
  data.pinned = { ...(data.pinned || {}) };
  delete data.pinned[url];
  await browser.storage.local.set({ shortcuts: data });
  renderShortcuts();
}

function wireDropTarget(el, data, idx) {
  el.addEventListener("dragover", (e) => {
    if (!dragUrl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-target");
    if (dragUrl) pinAt(data, dragUrl, idx);
  });
}

function makeTile(site, data, idx) {
  const a = document.createElement("a");
  a.className = "tile" + (site.pinned ? " pinned" : "");
  a.href = site.url;
  a.title = site.url;
  a.draggable = true;
  a.appendChild(tileFace(site));

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = site.title || hostOf(site.url);
  a.appendChild(label);

  const pin = document.createElement("button");
  pin.className = "pin";
  pin.type = "button";
  pin.textContent = "\u{1F4CC}";
  pin.title = site.pinned ? "Unpin" : "Pin here";
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
  rm.title = "Remove";
  rm.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (site.custom) {
      data.custom = (data.custom || []).filter((c) => c.url !== site.url);
    } else {
      data.blocked = [...(data.blocked || []), site.url];
    }
    if (data.pinned) {
      data.pinned = { ...data.pinned };
      delete data.pinned[site.url];
    }
    await browser.storage.local.set({ shortcuts: data });
    renderShortcuts();
  });
  a.appendChild(rm);

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

// Place pinned shortcuts at their slots, then fill the rest left-to-right.
function computeSlots(candidates, pinned, limit) {
  const slots = new Array(limit).fill(null);
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const placed = new Set();

  Object.keys(pinned || {})
    .map((url) => [url, Number(pinned[url])])
    .filter(([url, i]) => byUrl.has(url) && i >= 0 && i < limit)
    .sort((a, b) => a[1] - b[1])
    .forEach(([url, i]) => {
      let slot = i;
      while (slot < limit && slots[slot]) slot++;
      if (slot < limit) {
        slots[slot] = { ...byUrl.get(url), pinned: true };
        placed.add(url);
      }
    });

  let cursor = 0;
  for (const c of candidates) {
    if (placed.has(c.url)) continue;
    while (cursor < limit && slots[cursor]) cursor++;
    if (cursor >= limit) break;
    slots[cursor] = { ...c, pinned: false };
    placed.add(c.url);
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
  btn.addEventListener("click", () => showAddForm(data));
  return btn;
}

function showAddForm(data) {
  const box = els.shortcuts;
  if (box.querySelector(".shortcut-form")) return;
  const form = document.createElement("form");
  form.className = "shortcut-form";

  const name = document.createElement("input");
  name.className = "name";
  name.placeholder = "Name";
  name.required = true;

  const url = document.createElement("input");
  url.className = "url";
  url.type = "text";
  url.placeholder = "example.com";
  url.required = true;

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "chip";
  save.textContent = "Save";

  form.append(name, url, save);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let u = url.value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    data.custom = [...(data.custom || []), { title: name.value.trim() || hostOf(u), url: u }];
    await browser.storage.local.set({ shortcuts: data });
    renderShortcuts();
  });

  box.appendChild(form);
  name.focus();
}

async function renderShortcuts() {
  const box = els.shortcuts;
  if (!box) return;
  if (!settings.shortcuts) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  const store = await browser.storage.local.get("shortcuts");
  const data = store.shortcuts || { custom: [], blocked: [], pinned: {} };

  let top = [];
  try {
    top = await browser.topSites.get({ includeFavicon: true, limit: 50 });
  } catch (e) {
    top = [];
  }

  const blocked = new Set(data.blocked || []);
  const customUrls = new Set((data.custom || []).map((c) => c.url));
  const rows = Math.min(4, Math.max(1, settings.shortcutRows || 3));
  const limit = rows * 10; // grid is 10 tiles wide
  const candidates = [
    ...(data.custom || []).map((c) => ({ ...c, custom: true })),
    ...top.filter((s) => !blocked.has(s.url) && !customUrls.has(s.url)),
  ];

  const slots = computeSlots(candidates, data.pinned || {}, limit);
  let lastFilled = -1;
  slots.forEach((s, i) => { if (s) lastFilled = i; });

  box.innerHTML = "";
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
  els.historyGrid.innerHTML = "";
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

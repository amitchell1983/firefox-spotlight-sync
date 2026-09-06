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
}

function bindSettingControls() {
  const map = [
    ["#s-clock", "clock", "checked"],
    ["#s-clock-seconds", "clockSeconds", "checked"],
    ["#s-hour24", "hour24", "checked"],
    ["#s-search", "search", "checked"],
    ["#s-showmeta", "showMeta", "checked"],
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

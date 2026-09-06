"use strict";

// Windows Spotlight Sync -- background page.
//
// Holds one long-lived connectNative() port to the PowerShell helper. The
// helper pushes a "changed" message whenever Windows rotates the Spotlight
// wallpaper; we cache the image in storage.local so opening a New Tab never
// has to touch native messaging. New Tab / options pages talk to us over
// runtime.sendMessage; per-request correlation uses an "id" the helper echoes.

const HOST = "windows_spotlight_sync";
const RECONNECT_MIN = 3000;
const RECONNECT_MAX = 60000;

let port = null;
let reconnectDelay = RECONNECT_MIN;
let reqSeq = 0;
const pending = new Map(); // id -> { resolve, timer }

function nextId() {
  reqSeq += 1;
  return `bg-${reqSeq}-${Date.now()}`;
}

function connect() {
  try {
    port = browser.runtime.connectNative(HOST);
  } catch (e) {
    console.warn("connectNative failed:", e);
    port = null;
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener((p) => {
    const err =
      (p && p.error && p.error.message) ||
      (browser.runtime.lastError && browser.runtime.lastError.message) ||
      "disconnected";
    console.warn("native host disconnected:", err);
    port = null;
    for (const { resolve, timer } of pending.values()) {
      clearTimeout(timer);
      resolve({ ok: false, error: "host disconnected" });
    }
    pending.clear();
    updateCurrentStatus("disconnected", String(err));
    scheduleReconnect();
  });

  reconnectDelay = RECONNECT_MIN;
  request({ action: "get_current" }).catch(() => {});
  pushHostConfig().catch(() => {});
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

function onHostMessage(msg) {
  if (msg && msg.id && pending.has(msg.id)) {
    const { resolve, timer } = pending.get(msg.id);
    clearTimeout(timer);
    pending.delete(msg.id);
    resolve(msg);
  }

  if (msg && (msg.type === "current" || msg.type === "changed")) {
    if (msg.ok && msg.image) {
      storeCurrent({
        status: "ok",
        hash: msg.hash,
        image: msg.image,
        meta: msg.meta || {},
        source: msg.source || "",
        path: msg.path || "",
        timestamp: msg.timestamp || null,
        updatedAt: Date.now(),
      });
    } else {
      updateCurrentStatus("unavailable", msg.error || "spotlight unavailable");
    }
  }
}

function request(payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!port) {
      reject(new Error("native host not connected"));
      return;
    }
    const id = nextId();
    payload.id = id;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("native host timeout"));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      port.postMessage(payload);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

async function storeCurrent(obj) {
  try {
    await browser.storage.local.set({ current: obj });
  } catch (e) {
    console.error("storeCurrent failed:", e);
  }
}

async function updateCurrentStatus(status, error) {
  try {
    const { current } = await browser.storage.local.get("current");
    if (current) {
      current.status = status;
      current.error = error;
      await browser.storage.local.set({ current });
    } else {
      await browser.storage.local.set({
        current: { status, error, updatedAt: Date.now() },
      });
    }
  } catch (e) {
    console.error("updateCurrentStatus failed:", e);
  }
}

// `settings` + `shortcuts` are mirrored to storage.sync so they survive an
// extension update (storage.local may be cleared). On startup, pull anything
// the local store is missing.
async function reconcileSyncedStorage() {
  const keys = ["settings", "shortcuts"];
  let loc = {};
  let syn = {};
  try {
    loc = await browser.storage.local.get(keys);
  } catch (e) {
    /* ignore */
  }
  try {
    syn = await browser.storage.sync.get(keys);
  } catch (e) {
    /* ignore */
  }
  const patch = {};
  for (const k of keys) {
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

async function pushHostConfig() {
  const { settings } = await browser.storage.local.get("settings");
  const s = settings || {};
  return request({
    action: "set_config",
    config: {
      pollSeconds: s.pollSeconds ?? 15,
      historyMax: s.historyMax ?? 10,
      maxDimension: s.maxDimension ?? 1600,
      jpegQuality: s.jpegQuality ?? 82,
    },
  });
}

browser.runtime.onMessage.addListener((message) => {
  switch (message && message.type) {
    case "get_current":
      if (port) {
        return request({ action: "get_current" }).catch(async (e) => {
          const { current } = await browser.storage.local.get("current");
          return current || { ok: false, error: String(e) };
        });
      }
      return browser.storage.local
        .get("current")
        .then((r) => r.current || { ok: false, error: "native host not connected" });

    case "refresh":
      return request({ action: "get_current" }).catch((e) => ({
        ok: false,
        error: String(e),
      }));

    case "get_history":
      return request({ action: "get_history" }, 45000).catch((e) => ({
        ok: false,
        error: String(e),
      }));

    case "get_image":
      return request({ action: "get_image", hash: message.hash }, 45000).catch(
        (e) => ({ ok: false, error: String(e) })
      );

    case "clear_history":
      return request({ action: "clear_history" }, 20000).catch((e) => ({
        ok: false,
        error: String(e),
      }));

    case "ping":
      return request({ action: "ping" }, 8000).catch((e) => ({
        ok: false,
        error: String(e),
      }));

    case "set_host_config":
      return pushHostConfig()
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: String(e) }));

    default:
      return false;
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    pushHostConfig().catch(() => {});
  }
});

reconcileSyncedStorage().finally(connect);

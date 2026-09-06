"use strict";

const $ = (s) => document.querySelector(s);
const statusEl = $("#status");
const historyMsg = $("#history-msg");
const ioMsg = $("#io-msg");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// Mirror settings/shortcuts to storage.sync so they survive extension updates.
function shortcutsForSync(v) {
  if (!v || !Array.isArray(v.custom)) return v;
  return {
    ...v,
    custom: v.custom.map((c) => {
      if (c.icon && c.icon.startsWith("data:")) {
        const { icon, ...rest } = c;
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
  return browser.storage.sync.set(out).catch(() => {});
}
async function saveLocalAndSync(partial) {
  await browser.storage.local.set(partial);
  await mirrorToSync(partial);
}

async function testHost() {
  setStatus("Contacting native helper…");
  const res = await browser.runtime.sendMessage({ type: "get_current" });
  if (res && res.ok && res.image) {
    setStatus(`Connected. Current source: ${res.source || "unknown"}.`, "ok");
  } else if (res && res.status === "ok") {
    setStatus(`Connected (cached). Source: ${res.source || "unknown"}.`, "ok");
  } else {
    setStatus(
      "Not connected: " +
        ((res && res.error) || "no response") +
        ". Run scripts\\install.ps1 and restart Firefox.",
      "bad"
    );
  }
}

$("#btn-test").addEventListener("click", testHost);

$("#btn-refresh").addEventListener("click", async () => {
  setStatus("Requesting a fresh wallpaper…");
  const res = await browser.runtime.sendMessage({ type: "refresh" });
  setStatus(
    res && res.ok ? "Wallpaper refreshed." : "Refresh failed: " + ((res && res.error) || "unknown"),
    res && res.ok ? "ok" : "bad"
  );
});

$("#btn-clear-history").addEventListener("click", async () => {
  const res = await browser.runtime.sendMessage({ type: "clear_history" });
  historyMsg.textContent = res && res.ok ? "History cleared." : "Could not clear history.";
});

$("#btn-reset").addEventListener("click", async () => {
  await saveLocalAndSync({ settings: {} });
  historyMsg.textContent = "Settings reset to defaults.";
});

const histSel = $("#o-historymax");
browser.storage.local.get("settings").then(({ settings }) => {
  histSel.value = String((settings && settings.historyMax) ?? 10);
});
histSel.addEventListener("change", async () => {
  const { settings } = await browser.storage.local.get("settings");
  const next = { ...(settings || {}), historyMax: Number(histSel.value) };
  await saveLocalAndSync({ settings: next });
  historyMsg.textContent = "Saved.";
});

// ---- export / import ----------------------------------------------------
$("#btn-export").addEventListener("click", async () => {
  const { settings, shortcuts } = await browser.storage.local.get(["settings", "shortcuts"]);
  const payload = {
    app: "windows-spotlight-sync",
    kind: "settings-and-shortcuts",
    exportedAt: new Date().toISOString(),
    settings: settings || {},
    shortcuts: shortcuts || {},
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "windows-spotlight-sync-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ioMsg.textContent = "Exported.";
});

$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "windows-spotlight-sync") throw new Error("not a Windows Spotlight Sync backup");
    const patch = {};
    if (data.settings && typeof data.settings === "object") patch.settings = data.settings;
    if (data.shortcuts && typeof data.shortcuts === "object") patch.shortcuts = data.shortcuts;
    if (!Object.keys(patch).length) throw new Error("nothing to import");
    await saveLocalAndSync(patch);
    ioMsg.textContent = "Imported. Open a new tab to see the result.";
  } catch (err) {
    ioMsg.textContent = "Import failed: " + err.message;
  } finally {
    e.target.value = "";
  }
});

testHost();

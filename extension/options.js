"use strict";

const $ = (s) => document.querySelector(s);
const statusEl = $("#status");
const historyMsg = $("#history-msg");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
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
  await browser.storage.local.set({ settings: {} });
  historyMsg.textContent = "Settings reset to defaults.";
});

const histSel = $("#o-historymax");
browser.storage.local.get("settings").then(({ settings }) => {
  histSel.value = String((settings && settings.historyMax) ?? 10);
});
histSel.addEventListener("change", async () => {
  const { settings } = await browser.storage.local.get("settings");
  const next = { ...(settings || {}), historyMax: Number(histSel.value) };
  await browser.storage.local.set({ settings: next });
  historyMsg.textContent = "Saved.";
});

testHost();

const portEl = document.getElementById("port");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");
const saveEl = document.getElementById("save");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

async function refresh() {
  const stored = await chrome.storage.local.get(["token", "port"]);
  portEl.value = String(stored.port || 7420);
  tokenEl.value = stored.token || "";
  chrome.runtime.sendMessage({ type: "status" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Background worker is starting…");
      return;
    }
    if (response?.connected) setStatus("Connected to Locus", "ok");
    else if (stored.token) setStatus("Token saved. Waiting for Locus…");
    else setStatus("Paste the token from Settings → Chrome");
  });
}

saveEl.addEventListener("click", async () => {
  const token = tokenEl.value.trim();
  const port = Number(portEl.value) || 7420;
  await chrome.storage.local.set({ token, port });
  chrome.runtime.sendMessage({ type: "reconnect" });
  setStatus(token ? "Connecting…" : "Token cleared");
  setTimeout(() => void refresh(), 400);
});

void refresh();

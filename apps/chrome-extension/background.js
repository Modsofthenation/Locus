const DEFAULT_PORT = 7420;
const SNAPSHOT_TOOLS = new Set(["browser_snapshot"]);

let socket;
let helloOk = false;
let screencastTimer;
let reconnectTimer;
let pointer = { x: 640, y: 400 };

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function restricted(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
}

async function settings() {
  const stored = await storageGet(["token", "port"]);
  const port = Number(stored.port) || DEFAULT_PORT;
  return { token: String(stored.token || "").trim(), port };
}

function wsUrl(port, token) {
  const params = new URLSearchParams({ token });
  return `ws://127.0.0.1:${port}/ws/chrome-extension?${params.toString()}`;
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => tab.id != null)
    .map((tab) => ({
      targetId: String(tab.id),
      url: tab.url || "",
      title: tab.title || "",
      active: Boolean(tab.active && tab.highlighted),
    }));
}

async function pushTabs() {
  send({ type: "tabs", tabs: await listTabs() });
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "banner", on: true });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["banner.css"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

function tabReply(msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(msg.tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, output: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, output: "no content script" });
    });
  });
}

async function activeTab(preferredId) {
  if (preferredId) {
    const id = Number(preferredId);
    if (Number.isFinite(id)) {
      const [tab] = await chrome.tabs.query({}).then((rows) => rows.filter((row) => row.id === id));
      if (tab) return tab;
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active;
}

async function handleCommand(message) {
  const name = message.name;
  const args = message.args || {};
  const tab = await activeTab(message.tabId || args.targetId);
  if (name === "browser_tabs") {
    const action = String(args.action || "list");
    if (action === "list") {
      const tabs = await listTabs();
      return {
        ok: true,
        output: tabs.map((row) => `${row.targetId} ${row.url}`).join("\n") || "(no tabs)",
      };
    }
    if (action === "new") {
      const url = String(args.url || "https://example.com");
      if (restricted(url)) {
        return {
          ok: false,
          output:
            "Live Chrome can only open http(s) pages. chrome://, file:, and other schemes are refused.",
        };
      }
      const created = await chrome.tabs.create({ url });
      return { ok: true, output: String(created.id ?? "tab created") };
    }
    if (action === "close") {
      const id = Number(args.targetId);
      if (!Number.isFinite(id)) return { ok: false, output: "targetId is required" };
      await chrome.tabs.remove(id);
      return { ok: true, output: "close" };
    }
    if (action === "select") {
      const id = Number(args.targetId);
      if (!Number.isFinite(id)) return { ok: false, output: "targetId is required" };
      const found = await chrome.tabs.get(id);
      if (found.windowId != null) await chrome.windows.update(found.windowId, { focused: true });
      await chrome.tabs.update(id, { active: true });
      return { ok: true, output: "select" };
    }
    return { ok: false, output: `unknown tabs action ${action}` };
  }
  if (name === "browser_navigate") {
    const url = String(args.url || "").trim();
    if (!url) return { ok: false, output: "url is required" };
    if (restricted(url)) {
      return {
        ok: false,
        output:
          "Live Chrome can only open http(s) pages. chrome://, file:, and other schemes are refused.",
      };
    }
    if (tab?.id != null) await chrome.tabs.update(tab.id, { url });
    else await chrome.tabs.create({ url });
    return { ok: true, output: `opened ${url}` };
  }
  if (name === "screenshot") {
    if (!tab?.id) return { ok: false, output: "no active tab" };
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const data = String(dataUrl).replace(/^data:image\/png;base64,/, "");
    return { ok: true, output: "screenshot", image: { mime: "image/png", data } };
  }
  if (!tab?.id) return { ok: false, output: "no active tab" };
  if (restricted(tab.url)) {
    return {
      ok: false,
      output:
        "Live Chrome can only open http(s) pages. chrome://, file:, and other schemes are refused.",
    };
  }
  await ensureContent(tab.id);
  if (SNAPSHOT_TOOLS.has(name) || name === "browser_snapshot") {
    return tabReply({ type: "snapshot", tabId: tab.id });
  }
  if (name === "browser_click") {
    return tabReply({ type: "click", tabId: tab.id, ref: args.ref });
  }
  if (name === "browser_type") {
    return tabReply({ type: "type", tabId: tab.id, ref: args.ref, text: args.text });
  }
  if (name === "mouse_move") {
    pointer = { x: Number(args.x) || 0, y: Number(args.y) || 0 };
    return tabReply({ type: "mouse", tabId: tab.id, kind: "mouseMoved", ...pointer });
  }
  if (name === "mouse_click") {
    pointer = {
      x: Number(args.x ?? pointer.x) || 0,
      y: Number(args.y ?? pointer.y) || 0,
    };
    await tabReply({
      type: "mouse",
      tabId: tab.id,
      kind: "mousePressed",
      ...pointer,
      clickCount: args.count || 1,
    });
    return tabReply({
      type: "mouse",
      tabId: tab.id,
      kind: "mouseReleased",
      ...pointer,
      clickCount: args.count || 1,
    });
  }
  if (name === "mouse_drag") {
    await tabReply({
      type: "mouse",
      tabId: tab.id,
      kind: "mousePressed",
      x: args.x1 ?? pointer.x,
      y: args.y1 ?? pointer.y,
    });
    pointer = { x: Number(args.x2) || 0, y: Number(args.y2) || 0 };
    return tabReply({ type: "mouse", tabId: tab.id, kind: "mouseReleased", ...pointer });
  }
  if (name === "mouse_scroll") {
    return tabReply({
      type: "mouse",
      tabId: tab.id,
      kind: "mouseWheel",
      x: args.x ?? pointer.x,
      y: args.y ?? pointer.y,
      deltaY: (Number(args.delta) || 0) * 80,
    });
  }
  if (name === "key") {
    await tabReply({ type: "key", tabId: tab.id, kind: "keyDown", key: args.key });
    return tabReply({ type: "key", tabId: tab.id, kind: "keyUp", key: args.key });
  }
  if (name === "type_text") {
    return tabReply({ type: "insertText", tabId: tab.id, text: args.text });
  }
  if (name === "browser_console") {
    return tabReply({ type: "console", tabId: tab.id });
  }
  if (name === "browser_network") {
    return tabReply({ type: "network", tabId: tab.id });
  }
  return {
    ok: false,
    output:
      "Live Chrome does not support this tool. Use isolated host-chrome, or pick screenshot / snapshot / click / type / tabs / navigate.",
  };
}

async function captureFrame() {
  try {
    const tab = await activeTab();
    if (!tab?.windowId) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 70,
    });
    const data = String(dataUrl).replace(/^data:image\/jpeg;base64,/, "");
    send({
      type: "frame",
      mime: "image/jpeg",
      data,
      metadata: {
        deviceWidth: tab.width || 1280,
        deviceHeight: tab.height || 800,
        offsetTop: 0,
        pageScaleFactor: 1,
      },
    });
  } catch {
    /* tab may be privileged */
  }
}

function setScreencast(on) {
  if (screencastTimer) {
    clearInterval(screencastTimer);
    screencastTimer = undefined;
  }
  if (!on) return;
  void captureFrame();
  screencastTimer = setInterval(() => void captureFrame(), 700);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, 1500);
}

async function connect() {
  const { token, port } = await settings();
  if (!token) {
    helloOk = false;
    return;
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    socket = undefined;
  }
  try {
    socket = new WebSocket(wsUrl(port, token));
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener("open", () => {
    send({ type: "hello", token, version: 1 });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === "hello-ok") {
      helloOk = true;
      void pushTabs();
      void chrome.action.setBadgeText({ text: "on" });
      void chrome.action.setBadgeBackgroundColor({ color: "#f5b942" });
      return;
    }
    if (message.type === "hello-error") {
      helloOk = false;
      void chrome.action.setBadgeText({ text: "!" });
      return;
    }
    if (message.type === "ping") {
      send({ type: "pong" });
      return;
    }
    if (message.type === "screencast") {
      setScreencast(Boolean(message.on));
      return;
    }
    if (message.type === "command") {
      void handleCommand(message).then((result) => {
        send({
          type: "result",
          id: message.id,
          ok: Boolean(result.ok),
          output: String(result.output || ""),
          image: result.image,
        });
        void pushTabs();
      });
    }
  });
  socket.addEventListener("close", () => {
    helloOk = false;
    setScreencast(false);
    void chrome.action.setBadgeText({ text: "" });
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void connect();
});
chrome.runtime.onStartup.addListener(() => {
  void connect();
});
chrome.tabs.onUpdated.addListener(() => {
  if (helloOk) void pushTabs();
});
chrome.tabs.onActivated.addListener(() => {
  if (helloOk) void pushTabs();
});
chrome.tabs.onRemoved.addListener(() => {
  if (helloOk) void pushTabs();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.token || changes.port) void connect();
});
chrome.alarms.create("locus-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "locus-reconnect" && (!socket || socket.readyState !== WebSocket.OPEN)) {
    void connect();
  }
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "status") {
    sendResponse({ connected: helloOk });
    return;
  }
  if (msg?.type === "reconnect") {
    void connect();
    sendResponse({ ok: true });
  }
});
void connect();

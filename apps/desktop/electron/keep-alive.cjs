"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { readFile, rm, writeFile, mkdir } = require("node:fs/promises");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");

const OWNER_RE = /^[A-Za-z0-9-]{8,80}$/;

/** What to do with the control-plane child when the desktop quits. */
function serverQuitAction(input) {
  const keep = Boolean(input && input.keepAlive === true);
  const owns = Boolean(input && input.ownsChild === true);
  const adopted = Number.isInteger(input && input.adoptedPid) && input.adoptedPid > 1;
  if (keep) return owns ? "detach" : "leave";
  if (owns) return "stop";
  if (adopted) return "stop-adopted";
  return "leave";
}

function detachChild(child) {
  if (!child || typeof child.unref !== "function") return;
  child.unref();
}

function locusHome(home) {
  return home || process.env.LOCUS_HOME || join(homedir(), ".locus");
}

function desktopServerRecordPath(home) {
  return join(locusHome(home), "desktop-server.json");
}

async function rememberDesktopServer(path, record) {
  const pid = record && record.pid;
  const owner = record && record.owner;
  if (!Number.isInteger(pid) || pid <= 1 || !OWNER_RE.test(owner || "")) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ pid, owner })}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readDesktopServer(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const pid = parsed && parsed.pid;
    const owner = parsed && parsed.owner;
    if (!Number.isInteger(pid) || pid <= 1 || !OWNER_RE.test(owner || "")) return undefined;
    return { pid, owner };
  } catch {
    return undefined;
  }
}

async function forgetDesktopServer(path) {
  await rm(path, { force: true });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function environHasOwner(raw, owner) {
  if (!OWNER_RE.test(owner || "")) return false;
  const needle = Buffer.from(`LOCUS_DESKTOP_OWNER=${owner}`);
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ""));
  const idx = buf.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 || buf[idx - 1] === 0;
  const after = idx + needle.length === buf.length || buf[idx + needle.length] === 0;
  return before && after;
}

function processHasOwner(pid, owner) {
  if (!pidAlive(pid) || !OWNER_RE.test(owner || "")) return false;
  if (process.platform === "linux") {
    try {
      return environHasOwner(readFileSync(`/proc/${pid}/environ`), owner);
    } catch {
      return false;
    }
  }
  if (process.platform === "darwin") {
    const result = spawnSync("ps", ["-E", "-p", String(pid)], { encoding: "utf8" });
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    return stdout.includes(`LOCUS_DESKTOP_OWNER=${owner}`);
  }
  return false;
}

function stopAdoptedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function probeControlPlane(fetchImpl, url, timeoutMs) {
  const timeout = typeof timeoutMs === "number" ? timeoutMs : 400;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    return Boolean(res && res.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function controlPlaneKeepAlive(fetchImpl, url) {
  try {
    const res = await fetchImpl(url);
    if (!res || !res.ok) return false;
    const body = await res.json();
    return Boolean(body && body.keepAlive === true);
  } catch {
    return false;
  }
}

module.exports = {
  serverQuitAction,
  detachChild,
  desktopServerRecordPath,
  rememberDesktopServer,
  readDesktopServer,
  forgetDesktopServer,
  pidAlive,
  environHasOwner,
  processHasOwner,
  stopAdoptedProcess,
  probeControlPlane,
  controlPlaneKeepAlive,
};

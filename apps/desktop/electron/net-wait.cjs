const TRANSIENT_LOAD =
  /ERR_NO_BUFFER_SPACE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_ABORTED|ERR_FAILED|WSAENOBUFS|\b10055\b|\(-176\)/;

function errorText(err) {
  if (!err || typeof err !== "object") return String(err ?? "");
  const parts = [err.message, err.code, err.errno, err.name];
  return parts.filter((part) => part != null && part !== "").join(" ");
}

function isTransientLoadError(err) {
  return TRANSIENT_LOAD.test(errorText(err));
}

async function drainResponse(res) {
  if (!res) return;
  try {
    if (typeof res.arrayBuffer === "function") {
      await res.arrayBuffer();
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    res.body?.cancel?.();
  } catch {
    /* ignore */
  }
}

async function waitForUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 40_000;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let delay = 250;
  while (now() < deadline) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(1500) });
      const ok = Boolean(res?.ok);
      await drainResponse(res);
      if (ok) return;
    } catch {
      /* retry */
    }
    await sleep(delay);
    delay = Math.min(1000, delay + 100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** Best-effort wait until nothing answers so a replacement server can bind. */
async function waitUntilUrlDown(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(400) });
      await drainResponse(res);
    } catch {
      return;
    }
    await sleep(100);
  }
}

async function loadUrlWithRetry(win, url, opts = {}) {
  const attempts = opts.attempts ?? 8;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await win.loadURL(url);
      return;
    } catch (err) {
      last = err;
      if (!isTransientLoadError(err) || i === attempts - 1) throw err;
      await sleep(Math.min(2000, 200 * 2 ** i));
    }
  }
  throw last;
}

module.exports = {
  drainResponse,
  isTransientLoadError,
  loadUrlWithRetry,
  waitForUrl,
  waitUntilUrlDown,
};

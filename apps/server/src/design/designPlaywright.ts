import { WebSocket as WsWebSocket } from "ws";
import type { ToolResult } from "@locus/guest-agent";
import { launchHostChrome, LiveCdp, rewriteCdpWs, type WsCtor } from "@locus/guest-agent";
import {
  ASSET_STATS_EVAL,
  looksUnwiredAsset,
  looksWiredAsset,
  PLAYWRIGHT_CHROME_MISSING,
  PLAYWRIGHT_EMPTY_CANVAS,
  PLAYWRIGHT_MISSING_URL,
  PLAYWRIGHT_BAD_URL,
  PLAYWRIGHT_TAINTED_CANVAS,
  PLAYWRIGHT_VIEWPORTS,
  assetStudioStatsFailReason,
  formatAssetStudioStats,
  formatPlaywrightReport,
  htmlHasLocator,
  htmlHasText,
  isPlaywrightPageUrl,
  parseAssetStudioStats,
  parsePlaywrightSteps,
  parsePlaywrightViewport,
  playwrightLooksTainted,
  playwrightStepNeedsLive,
  playwrightWantsLive,
  playwrightWantsScreenshot,
  playwrightStepsWantDrive,
  GAME_DRIVE_MIN_TIME,
  GAME_DRIVE_WAIT_MS,
  type PlaywrightStep,
  type PlaywrightStepResult,
  type PlaywrightViewportName,
} from "@locus/shared";

export type CanvasBrowser = {
  goto(url: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(): Promise<string | undefined>;
  console(): Promise<string[]>;
  title(): Promise<string>;
  close(): Promise<void>;
};

const FIND = `function locusFind(locator){
  const loc = String(locator || "").trim();
  if (!loc) return null;
  if (loc.toLowerCase().startsWith("text=")) {
    const needle = loc.slice(5);
    const nodes = document.querySelectorAll("button, a, [role='button'], input, textarea, select, label, [aria-label], h1, h2, h3, p, span, li, div");
    for (const el of nodes) {
      const t = ((el.innerText || el.textContent || el.getAttribute("aria-label") || el.value || "") + "").trim();
      if (t.includes(needle)) return el;
    }
    return null;
  }
  try { return document.querySelector(loc); } catch { return null; }
}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const GAME_TIME_EVAL = `(() => {
  try {
    const game = window.__locusGame;
    const fn = game && typeof game.stats === "function" ? game.stats : null;
    if (!fn) return null;
    const raw = fn();
    const t = raw && typeof raw === "object" ? raw.time : raw;
    const n = typeof t === "number" ? t : Number(t);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
})()`;

async function waitForGameDriveTime(
  browser: CanvasBrowser,
  waitMs: number,
): Promise<number | null> {
  const deadline = Date.now() + Math.max(0, waitMs);
  let time = await browser.evaluate<number | null>(GAME_TIME_EVAL).catch(() => null);
  while ((time == null || time < GAME_DRIVE_MIN_TIME) && Date.now() < deadline) {
    await sleep(50);
    time = await browser.evaluate<number | null>(GAME_TIME_EVAL).catch(() => null);
  }
  return time;
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function debuggerUrl(endpoint: { host: string; port: number }): Promise<string> {
  let last = "Host Chrome has no page target";
  for (let i = 0; i < 8; i += 1) {
    try {
      const res = await fetch(`http://${endpoint.host}:${endpoint.port}/json/list`);
      const targets = (await res.json()) as Array<{
        type?: string;
        webSocketDebuggerUrl?: string;
      }>;
      const page =
        targets.find((row) => row.type === "page" && row.webSocketDebuggerUrl) ??
        targets.find((row) => row.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return rewriteCdpWs(page.webSocketDebuggerUrl, endpoint.host, endpoint.port);
      }
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
    await sleep(150);
  }
  throw new Error(last);
}

export async function launchCdpCanvasBrowser(opts: {
  profileDir: string;
  viewport: { width: number; height: number };
}): Promise<CanvasBrowser> {
  const chrome = await launchHostChrome(opts.profileDir);
  let cdp: LiveCdp | undefined;
  try {
    const wsUrl = await debuggerUrl(chrome.endpoint);
    cdp = await LiveCdp.connect(wsUrl, WsWebSocket as unknown as WsCtor);
    const session = cdp;
    const logs: string[] = [];
    session.onEvent((method, params) => {
      if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as
          { text?: string; exception?: { description?: string; value?: unknown } } | undefined;
        const text = String(
          details?.exception?.description ?? details?.exception?.value ?? details?.text ?? "",
        ).trim();
        if (text) logs.push(text);
        return;
      }
      if (method !== "Runtime.consoleAPICalled") return;
      const args = Array.isArray(params.args) ? params.args : [];
      const text = args
        .map((arg) => {
          const row = arg as { value?: unknown; description?: string };
          return String(row.value ?? row.description ?? "");
        })
        .filter(Boolean)
        .join(" ");
      if (text) logs.push(text);
    });
    await session.call("Page.enable", {});
    await session.call("Runtime.enable", {});
    await session.call("Emulation.setDeviceMetricsOverride", {
      width: opts.viewport.width,
      height: opts.viewport.height,
      deviceScaleFactor: 1,
      mobile: opts.viewport.width < 800,
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = (await session.call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails?.text) throw new Error(result.exceptionDetails.text);
      return result.result?.value as T;
    };
    return {
      async goto(url) {
        await session.call("Page.navigate", { url });
        for (let i = 0; i < 40; i += 1) {
          const state = await evaluate<string>("document.readyState").catch(() => "");
          if (state === "complete" || state === "interactive") return;
          await sleep(50);
        }
      },
      evaluate,
      async screenshot() {
        const shot = (await session.call("Page.captureScreenshot", { format: "png" })) as {
          data?: string;
        };
        return shot.data?.replace(/\s/g, "") || undefined;
      },
      async console() {
        return logs.slice(-40);
      },
      async title() {
        return String((await evaluate<string>("document.title")) ?? "");
      },
      async close() {
        session.close();
        chrome.close();
      },
    };
  } catch (err) {
    cdp?.close();
    chrome.close();
    throw err;
  }
}

function withFinder(body: string): string {
  return `(() => { ${FIND}\n${body}\n})()`;
}

async function runLiveStep(
  browser: CanvasBrowser,
  step: PlaywrightStep,
): Promise<PlaywrightStepResult> {
  if (step.kind === "expect") {
    const found = await browser.evaluate<boolean>(
      withFinder(
        `return Boolean(document.body && document.body.innerText.includes(${JSON.stringify(step.text)}));`,
      ),
    );
    return {
      step,
      ok: Boolean(found),
      detail: found ? undefined : "not on page",
    };
  }
  if (step.kind === "seed") {
    const result = await browser.evaluate<{ ok: boolean }>(
      `(() => {
        const n = ${JSON.stringify(step.value)};
        window.__locusGameSeed = n;
        document.documentElement.style.setProperty("--seed", String(n));
        const game = window.__locusGame;
        if (game && typeof game.seed === "function") game.seed(n);
        if (game && typeof game.reset === "function") game.reset();
        return { ok: true };
      })()`,
    );
    return { step, ok: Boolean(result?.ok) };
  }
  if (step.kind === "wait") {
    if (step.ms != null) {
      await sleep(Math.min(Math.max(0, step.ms), 20_000));
      return { step, ok: true };
    }
    for (let i = 0; i < 25; i += 1) {
      const found = await browser.evaluate<boolean>(
        withFinder(`return Boolean(locusFind(${JSON.stringify(step.locator)}));`),
      );
      if (found) return { step, ok: true };
      await sleep(200);
    }
    return { step, ok: false, detail: "timed out" };
  }
  if (step.kind === "fill") {
    const result = await browser.evaluate<{ ok: boolean; error?: string }>(
      withFinder(`
        const el = locusFind(${JSON.stringify(step.locator)});
        if (!el) return { ok: false, error: "not found" };
        el.focus();
        if ("value" in el) el.value = ${JSON.stringify(step.text)};
        else el.textContent = ${JSON.stringify(step.text)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      `),
    );
    return { step, ok: Boolean(result?.ok), detail: result?.error };
  }
  if (step.kind === "key") {
    const result = await browser.evaluate<{ ok: boolean; error?: string }>(
      `(() => {
        const code = ${JSON.stringify(step.key)};
        const key = code.startsWith("Key") ? code.slice(3).toLowerCase() : code.replace(/^Arrow/, "Arrow");
        const opts = { key: key === "Space" ? " " : key, code: code === "Space" ? "Space" : code, bubbles: true };
        window.dispatchEvent(new KeyboardEvent("keydown", opts));
        document.dispatchEvent(new KeyboardEvent("keydown", opts));
        window.dispatchEvent(new KeyboardEvent("keyup", opts));
        document.dispatchEvent(new KeyboardEvent("keyup", opts));
        return { ok: true };
      })()`,
    );
    return { step, ok: Boolean(result?.ok), detail: result?.error };
  }
  const result = await browser.evaluate<{ ok: boolean; error?: string }>(
    withFinder(`
      const el = locusFind(${JSON.stringify(step.locator)});
      if (!el) return { ok: false, error: "not found" };
      el.click();
      return { ok: true };
    `),
  );
  return { step, ok: Boolean(result?.ok), detail: result?.error };
}

function runStaticStep(html: string, step: PlaywrightStep): PlaywrightStepResult {
  if (step.kind === "expect") {
    const ok = htmlHasText(html, step.text);
    return { step, ok, detail: ok ? undefined : "not in markup" };
  }
  if (step.kind === "key" || step.kind === "seed") {
    return { step, ok: false, detail: "markup only — live browser required" };
  }
  if (step.kind === "wait" && step.ms != null) {
    return { step, ok: false, detail: "markup only — live browser required" };
  }
  const found = htmlHasLocator(html, step.locator);
  return {
    step,
    ok: false,
    detail: found ? "markup only — live browser required" : "not in markup",
  };
}

export async function runDesignPlaywright(input: {
  html?: string | null;
  url: string;
  args: Record<string, unknown>;
  requireHtml?: boolean;
  assetStats?: boolean;
  gameDrive?: boolean;
  driveWaitMs?: number;
  browser?: CanvasBrowser;
  launch?: (viewport: { width: number; height: number }) => Promise<CanvasBrowser>;
}): Promise<ToolResult> {
  if (input.requireHtml !== false && !input.html?.trim()) {
    return { ok: false, output: PLAYWRIGHT_EMPTY_CANVAS };
  }
  if (!input.url.trim()) {
    return { ok: false, output: PLAYWRIGHT_MISSING_URL };
  }
  if (!isPlaywrightPageUrl(input.url)) {
    return { ok: false, output: PLAYWRIGHT_BAD_URL };
  }
  const html = input.html ?? "";
  const viewportName: PlaywrightViewportName = parsePlaywrightViewport(input.args.viewport);
  const viewport = PLAYWRIGHT_VIEWPORTS[viewportName];
  const steps = parsePlaywrightSteps(input.args);
  const wantShot = playwrightWantsScreenshot(input.args);
  const wantLive = playwrightWantsLive(input.args, steps);

  let browser = input.browser;
  let note: string | undefined;
  if (!browser && input.launch) {
    const reachable = await probeUrl(input.url);
    if (reachable) {
      try {
        browser = await input.launch(viewport);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        note = /LOCUS_CHROME|Chrome|Chromium|Edge|msedge|ENOENT|not found/i.test(message)
          ? PLAYWRIGHT_CHROME_MISSING
          : message;
      }
    } else if (wantLive) {
      note = `HTTP origin is not reachable at ${input.url}`;
    }
  } else if (!browser && wantLive) {
    note = PLAYWRIGHT_CHROME_MISSING;
  }

  if (browser) {
    try {
      await browser.goto(input.url);
      const results: PlaywrightStepResult[] = [];
      for (const step of steps) results.push(await runLiveStep(browser, step));
      if (input.gameDrive && playwrightStepsWantDrive(steps)) {
        const time = await waitForGameDriveTime(browser, input.driveWaitMs ?? GAME_DRIVE_WAIT_MS);
        if (time == null || time < GAME_DRIVE_MIN_TIME) {
          results.push({
            step: { kind: "expect", text: `stats.time>=${GAME_DRIVE_MIN_TIME}` },
            ok: false,
            detail: `time is ${time == null ? "missing" : time} after drive steps; HUD expect is not a playtest`,
          });
        }
      }
      if (/\bgetImageData\s*\(/.test(html)) await sleep(250);
      const title = await browser.title().catch(() => "");
      const logs = await browser.console().catch(() => []);
      const probe = await browser
        .evaluate<{ stats?: string; text?: string }>(
          `(() => {
            let stats;
            try {
              const asset = window.__locusAsset;
              const game = window.__locusGame;
              const fn = asset && typeof asset.stats === "function" ? asset.stats
                : game && typeof game.stats === "function" ? game.stats : null;
              if (fn) {
                const raw = fn();
                if (raw && typeof raw === "object") {
                  stats = "stats " + Object.keys(raw).map((k) => k + "=" + raw[k]).join(" ");
                } else if (raw != null) stats = "stats " + String(raw);
              }
            } catch (err) {
              stats = "stats error " + (err && err.message ? err.message : err);
            }
            const text = ((document.body && document.body.innerText) || "").slice(0, 800);
            return { stats, text };
          })()`,
        )
        .catch(() => ({ stats: undefined, text: "" }));
      let screenshotBase64: string | undefined;
      if (wantShot) screenshotBase64 = await browser.screenshot().catch(() => undefined);
      const blob = [title, logs.join("\n"), probe?.stats, probe?.text].filter(Boolean).join("\n");
      const tainted = playwrightLooksTainted(blob);
      let ok = results.every((row) => row.ok) && !tainted;
      let statsLine = probe?.stats;
      if (input.assetStats) {
        const raw = await browser.evaluate<unknown>(ASSET_STATS_EVAL).catch(() => undefined);
        const stats = parseAssetStudioStats(raw);
        if (stats) {
          statsLine = formatAssetStudioStats(stats);
          const fail = assetStudioStatsFailReason(stats);
          if (fail) {
            ok = false;
            statsLine = `${statsLine} — ${fail}`;
          }
        } else {
          const html = input.html ?? "";
          const sprite = /data-locus-asset-mode=["']2d["']|\bmode\s*[:=]\s*["']2d["']/i.test(html);
          if (!sprite && (looksUnwiredAsset(html) || looksWiredAsset(html))) {
            ok = false;
            statsLine =
              statsLine || "stats missing — no window.__locusAsset.stats (CSS-3D is not a mesh)";
          }
        }
      }
      return {
        ok,
        output: formatPlaywrightReport({
          viewport: viewportName,
          mode: "live",
          results,
          title,
          console: logs,
          screenshot: Boolean(screenshotBase64),
          stats: statsLine,
          note: tainted ? PLAYWRIGHT_TAINTED_CANVAS : undefined,
        }),
        screenshotBase64,
      };
    } catch (err) {
      note = err instanceof Error ? err.message : String(err);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  const results = steps.map((step) => runStaticStep(html, step));
  const liveMissing = steps.some(playwrightStepNeedsLive);
  const ok = !liveMissing && results.every((row) => row.ok);
  return {
    ok,
    output: formatPlaywrightReport({
      viewport: viewportName,
      mode: "static",
      results,
      note: note ?? (liveMissing ? PLAYWRIGHT_CHROME_MISSING : undefined),
    }),
  };
}

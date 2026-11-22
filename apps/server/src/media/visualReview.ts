import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VisualBaseline, VisualViewport } from "@locus/shared";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { resolveHostChromeBin } from "@locus/guest-agent";
import { requireSafeSessionId } from "../session/sessionPaths.js";

const ORIGIN = "http://locus-visual.invalid";
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
const ID = /^[a-f0-9-]{36}$/;

type LoadAsset = (url: URL, signal: AbortSignal) => Promise<Response>;

async function capture(path: string, load: LoadAsset): Promise<Record<VisualViewport, Buffer>> {
  const executablePath = resolveHostChromeBin();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    chromiumSandbox: true,
    proxy: { server: "http://127.0.0.1:1" },
    args: [
      "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
    timeout: 10_000,
  });
  const signal = AbortSignal.timeout(30_000);
  try {
    const shots = {} as Record<VisualViewport, Buffer>;
    for (const viewport of ["desktop", "mobile"] as const) {
      const context = await browser.newContext({
        viewport: VIEWPORTS[viewport],
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        serviceWorkers: "block",
        ...(viewport === "mobile" ? { isMobile: true, hasTouch: true } : {}),
      });
      try {
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== ORIGIN || route.request().method() !== "GET" || signal.aborted) {
            return route.abort();
          }
          try {
            const response = await load(url, signal);
            // Keep redirects inside the preview. Playwright only routes the first URL
            // of a redirected request, so a redirect must never leave the browser.
            if (!response.ok || response.status === 204 || response.status === 205) {
              await response.body?.cancel().catch(() => undefined);
              return route.fulfill({ status: response.status >= 400 ? response.status : 502 });
            }
            const body = await readPreviewBody(response);
            await route.fulfill({
              status: response.status,
              contentType: response.headers.get("content-type") ?? undefined,
              body,
              headers: { "cache-control": "no-store" },
            });
          } catch {
            await route.abort().catch(() => undefined);
          }
        });
        const page = await context.newPage();
        const response = await page.goto(ORIGIN + path, { waitUntil: "load", timeout: 12_000 });
        if (!response?.ok())
          throw new Error("The preview page did not return a successful response");
        shots[viewport] = await page.screenshot({
          animations: "disabled",
          caret: "hide",
          timeout: 8_000,
        });
      } finally {
        await context.close();
      }
    }
    return shots;
  } finally {
    await browser.close();
  }
}

async function readPreviewBody(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > MAX_ASSET_BYTES) throw new Error("Preview asset exceeds the screenshot limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function visualDifference(before: Buffer, after: Buffer) {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error("Screenshot dimensions do not match the baseline");
  }
  const highlight = new PNG({ width: first.width, height: first.height });
  const changed = pixelmatch(first.data, second.data, highlight.data, first.width, first.height);
  return {
    highlight: PNG.sync.write(highlight),
    percentage: (100 * changed) / (first.width * first.height),
  };
}

export class VisualReview {
  private readonly busy = new Set<string>();

  constructor(private readonly dataDir: string) {}

  private root(sessionId: string): string {
    return join(this.dataDir, "visual-reviews", requireSafeSessionId(sessionId));
  }

  async list(sessionId: string): Promise<VisualBaseline[]> {
    return readFile(join(this.root(sessionId), "baselines.json"), "utf8").then(
      (value) => JSON.parse(value) as VisualBaseline[],
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
  }

  async image(sessionId: string, id: string, name: string): Promise<Buffer> {
    if (!ID.test(id) || !/^(desktop|mobile)-(before|after|diff)\.png$/.test(name)) {
      throw new Error("Invalid visual review image");
    }
    const baseline = (await this.list(sessionId)).find((row) => row.id === id);
    if (!baseline) throw new Error("Visual baseline not found");
    const dir = name.includes("-before.") ? baseline.id : baseline.comparison?.id;
    if (!dir) throw new Error("Comparison not found");
    return readFile(join(this.root(sessionId), dir, name));
  }

  async run(
    sessionId: string,
    input: { name?: string; baselineId?: string; path: string },
    load: LoadAsset,
  ): Promise<VisualBaseline[]> {
    if (this.busy.has(sessionId)) throw new Error("A visual capture is already running");
    const root = this.root(sessionId);
    if (this.busy.size >= 2) throw new Error("Two visual captures are already running");
    this.busy.add(sessionId);
    const id = randomUUID();
    const dir = join(root, id);
    const metadata = join(root, `${id}.json.tmp`);
    try {
      const rows = await this.list(sessionId);
      const previous = input.baselineId
        ? rows.find((row) => row.id === input.baselineId)
        : undefined;
      if (input.baselineId && !previous) throw new Error("Visual baseline not found");
      const name = input.name?.trim();
      if (!previous && (!name || name.length > 80))
        throw new Error("Enter a baseline name of up to 80 characters");
      if (!previous && rows.length >= 20)
        throw new Error("This session already has 20 visual baselines");
      const path = previous?.path ?? input.path;
      const shots = await capture(path, load);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const capturedAt = new Date().toISOString();
      if (previous) {
        const percentages = {} as Record<VisualViewport, number>;
        for (const viewport of ["desktop", "mobile"] as const) {
          const before = await readFile(join(root, previous.id, `${viewport}-before.png`));
          const result = visualDifference(before, shots[viewport]);
          percentages[viewport] = result.percentage;
          await Promise.all([
            writeFile(join(dir, `${viewport}-after.png`), shots[viewport]),
            writeFile(join(dir, `${viewport}-diff.png`), result.highlight),
          ]);
        }
        rows[rows.indexOf(previous)] = { ...previous, comparison: { id, capturedAt, percentages } };
      } else {
        for (const viewport of ["desktop", "mobile"] as const) {
          await writeFile(join(dir, `${viewport}-before.png`), shots[viewport]);
        }
        rows.unshift({ id, name: name!, path, capturedAt });
      }
      await writeFile(metadata, JSON.stringify(rows), { mode: 0o600 });
      await rename(metadata, join(root, "baselines.json"));
      if (previous?.comparison) {
        await rm(join(root, previous.comparison.id), { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      return rows;
    } catch (error) {
      await Promise.all([
        rm(dir, { recursive: true, force: true }).catch(() => undefined),
        rm(metadata, { force: true }).catch(() => undefined),
      ]);
      throw error;
    } finally {
      this.busy.delete(sessionId);
    }
  }
}

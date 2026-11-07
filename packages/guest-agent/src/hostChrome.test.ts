import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYWRIGHT_CHROME_MISSING } from "@locus/shared";
import { HostGuestRuntime } from "./host.js";
import type { ChromiumDriver } from "./chromium.js";
import { hostChromeCandidates, resolveHostChromeBin } from "./hostChrome.js";

const WIN_ENV = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  USERPROFILE: "C:\\Users\\me",
};

describe("host Chrome intercept", () => {
  it("does not run browser tools as a shell command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-chrome-"));
    await writeFile(join(dir, "app.ts"), "export {}\n");
    const prev = process.env.LOCUS_CHROME;
    process.env.LOCUS_CHROME = join(dir, "missing-chrome");
    const calls: string[][] = [];
    try {
      const runtime = new HostGuestRuntime(
        "ubuntu",
        dir,
        async (argv) => {
          calls.push(argv);
          return { code: 0, stdout: "shell", stderr: "" };
        },
        join(dir, "chrome-profile"),
      );
      const result = await runtime.execute({ name: "screenshot", args: {} });
      expect(calls).toEqual([]);
      expect(result.ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.LOCUS_CHROME;
      else process.env.LOCUS_CHROME = prev;
    }
  });

  it("routes browser tools through a live Chrome driver when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-live-chrome-"));
    const calls: string[][] = [];
    const runtime = new HostGuestRuntime(
      "ubuntu",
      dir,
      async (argv) => {
        calls.push(argv);
        return { code: 0, stdout: "shell", stderr: "" };
      },
      join(dir, "chrome-profile"),
      () =>
        ({
          handle: async (req) => ({ ok: true, output: `live:${req.name}` }),
          navigate: async (url) => ({ ok: true, output: `opened ${url}` }),
        }) as ChromiumDriver,
    );
    const snap = await runtime.execute({ name: "browser_snapshot", args: {} });
    expect(snap).toEqual({ ok: true, output: "live:browser_snapshot" });
    const nav = await runtime.execute({ name: "exec", args: { command: "https://example.com" } });
    expect(nav).toEqual({ ok: true, output: "opened https://example.com" });
    expect(calls).toEqual([]);
    expect(runtime.chromium()?.handle).toBeTypeOf("function");
  });
});

describe("host Chrome discovery", () => {
  it("finds Windows Program Files Chrome before PATH names", () => {
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    expect(hostChromeCandidates({ platform: "win32", env: WIN_ENV })).toEqual(
      expect.arrayContaining([
        chrome,
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]),
    );
    expect(
      resolveHostChromeBin({
        platform: "win32",
        env: WIN_ENV,
        exists: (path) => path === chrome,
      }),
    ).toBe(chrome);
  });

  it("finds 32-bit Microsoft Edge when Chrome is not installed", () => {
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(
      resolveHostChromeBin({
        platform: "win32",
        env: WIN_ENV,
        exists: (path) => path === edge,
      }),
    ).toBe(edge);
  });

  it("treats LOCUS_CHROME as the only candidate", () => {
    const override = "C:\\custom\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(
      hostChromeCandidates({
        platform: "win32",
        env: { ...WIN_ENV, LOCUS_CHROME: override },
      }),
    ).toEqual([override]);
    expect(
      resolveHostChromeBin({
        platform: "win32",
        env: { ...WIN_ENV, LOCUS_CHROME: "C:\\missing\\chrome.exe" },
        exists: (path) => path === edge,
      }),
    ).toBeUndefined();
  });

  it("prefers CHROME_PATH when that file exists", () => {
    const custom = "/opt/chrome/chrome";
    expect(
      resolveHostChromeBin({
        platform: "linux",
        env: { CHROME_PATH: custom },
        exists: (path) => path === custom,
      }),
    ).toBe(custom);
  });

  it("walks PATH for google-chrome", () => {
    expect(
      resolveHostChromeBin({
        platform: "linux",
        env: { PATH: "/opt/custom/bin:/usr/bin" },
        exists: (path) => path === "/opt/custom/bin/google-chrome",
      }),
    ).toBe("/opt/custom/bin/google-chrome");
  });

  it("finds macOS Google Chrome in Applications", () => {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(
      resolveHostChromeBin({
        platform: "darwin",
        env: { HOME: "/Users/me" },
        exists: (path) => path === chrome,
      }),
    ).toBe(chrome);
  });

  it("finds a Playwright Chromium cache build as a last resort", () => {
    const cache = "C:\\Users\\me\\AppData\\Local\\ms-playwright";
    const bin = `${cache}\\chromium-1140\\chrome-win\\chrome.exe`;
    expect(
      resolveHostChromeBin({
        platform: "win32",
        env: WIN_ENV,
        readdir: (dir) => (dir === cache ? ["chromium-headless-shell-1", "chromium-1140"] : []),
        exists: (path) => path === bin,
      }),
    ).toBe(bin);
  });

  it("returns undefined when nothing is installed", () => {
    expect(
      resolveHostChromeBin({
        platform: "win32",
        env: WIN_ENV,
        exists: () => false,
        readdir: () => [],
      }),
    ).toBeUndefined();
    expect(PLAYWRIGHT_CHROME_MISSING).toMatch(/Edge/);
  });
});

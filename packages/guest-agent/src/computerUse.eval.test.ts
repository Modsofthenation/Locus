import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { CdpChromiumDriver } from "./chromium.js";

const enabled = process.env.LOCUS_COMPUTER_USE === "1";
describe.skipIf(!enabled)("real Chromium computer-use tasks", () => {
  let chrome: ChildProcess;
  let server: Server;
  let profile: string;
  let base: string;
  let driver: CdpChromiumDriver;
  let port = 0;
  let calls = 0;
  const results: Array<{ task: string; durationMs: number; success: boolean; toolCalls: number }> =
    [];
  const tool = async (
    name: Parameters<CdpChromiumDriver["handle"]>[0]["name"],
    args: Record<string, unknown> = {},
  ) => {
    calls++;
    return driver.handle({ name, args });
  };
  const navigate = (url: string) => tool("browser_navigate", { url });
  const task = (name: string, fn: () => Promise<void>) =>
    it(
      name,
      async () => {
        const started = performance.now();
        const before = calls;
        let success = false;
        try {
          await fn();
          success = true;
        } finally {
          results.push({
            task: name,
            success,
            durationMs: performance.now() - started,
            toolCalls: calls - before,
          });
        }
      },
      30000,
    );
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><title>Computer fixture</title>
      <label>Name<input id="name" aria-label="Name" value="hello"></label>
      <label>Plan<select id="plan" aria-label="Plan"><option value="free">Free</option><option value="pro">Pro</option></select></label>
      <label><input type="checkbox" id="check">Accept</label>
      <button id="submit" onclick="setTimeout(()=>document.querySelector('#result').textContent=document.querySelector('#name').value+':'+document.querySelector('#plan').value+':'+document.querySelector('#check').checked,150)">Submit</button>
      <button id="popup" onclick="window.open('/popup')">Popup</button><output id="result"></output>
      <div id="cover" style="display:none;position:fixed;inset:0;background:white;z-index:10">Overlay</div>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    profile = await mkdtemp(join(tmpdir(), "locus-computer-eval-"));
    chrome = spawn(
      process.env.CHROMIUM_BIN ?? "chromium",
      [
        "--headless=new",
        "--no-sandbox",
        "--force-device-scale-factor=2",
        "--disable-dev-shm-usage",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    for (let i = 0; i < 100; i++) {
      try {
        port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
        if (port) break;
      } catch {
        /* Chrome starting */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!port)
      throw new Error("Chromium did not start; set CHROMIUM_BIN to an installed executable");
    driver = new CdpChromiumDriver(
      "eval",
      async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch,
      {
        endpoint: async () => ({ host: "127.0.0.1", port }),
        launch: async () => ({ ok: true, output: "ready" }),
      },
    );
  }, 15000);
  afterAll(async () => {
    await driver?.stopScreencast();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill("SIGKILL");
      await exited;
    }
    await new Promise<void>((r) => server?.close(() => r()));
    if (profile) await rm(profile, { recursive: true, force: true });
    if (process.env.LOCUS_COMPUTER_REPORT)
      await writeFile(
        process.env.LOCUS_COMPUTER_REPORT,
        JSON.stringify({ backend: "chromium", results }, null, 2),
      );
  });
  async function ref(label: string) {
    const snap = await tool("browser_snapshot");
    expect(snap.ok).toBe(true);
    const line = snap.output.split("\n").find((line) => line.includes(label));
    if (!line) throw new Error(`Missing control ${label}: ${snap.output}`);
    return line.split(" ")[0]!;
  }
  async function evaluate(expression: string) {
    const pages = await driver.listPages();
    const active = pages.find((p) => p.active)!;
    const endpoint = `ws://127.0.0.1:${port}/devtools/page/${active.targetId}`;
    const { cdpCall } = await import("./cdpSession.js");
    const r = (await cdpCall(endpoint, "Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    expect(active).toBeDefined();
    return r.result?.value;
  }
  task("fills a form, selects a plan, checks consent and waits for validation", async () => {
    expect((await navigate(base)).ok).toBe(true);
    expect(
      (
        await tool("browser_action", {
          ref: await ref('textbox "Name"'),
          action: "fill",
          value: "Ada",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await tool("browser_action", {
          ref: await ref('combobox "Plan"'),
          action: "select",
          value: "pro",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await tool("browser_action", {
          ref: await ref('checkbox "Accept"'),
          action: "check",
          checked: true,
        })
      ).ok,
    ).toBe(true);
    expect((await tool("browser_click", { ref: await ref('button "Submit"') })).ok).toBe(true);
    expect((await tool("browser_wait", { text: "Ada:pro:true" })).ok).toBe(true);
    expect(await evaluate("document.querySelector('#result').textContent")).toBe("Ada:pro:true");
  });
  task("translates Ctrl+A and replaces selected text", async () => {
    await navigate(base);
    await tool("browser_click", { ref: await ref('textbox "Name"') });
    await tool("key", { key: "ctrl+a" });
    await tool("type_text", { text: "世界" });
    expect(await evaluate("document.querySelector('#name').value")).toBe("世界");
  });
  task("rejects stale and obstructed refs", async () => {
    await navigate(base);
    const stale = await ref('button "Submit"');
    await navigate(base + "/next");
    expect((await tool("browser_click", { ref: stale })).ok).toBe(false);
    const blocked = await ref('button "Submit"');
    await evaluate("document.querySelector('#cover').style.display='block'");
    expect((await tool("browser_click", { ref: blocked })).category).toBe("not-actionable");
    expect(await evaluate("document.querySelector('#result').textContent")).toBe("");
  });
  task("keeps popup, selected tab, screenshots and stream on the same target", async () => {
    await navigate(base);
    const original = (await driver.listPages()).find((p) => p.active)!;
    await tool("browser_click", { ref: await ref('button "Popup"') });
    const popup = (await driver.listPages()).find((p) => p.targetId !== original.targetId)!;
    expect(popup).toBeDefined();
    expect((await driver.listPages()).find((p) => p.active)?.targetId).toBe(original.targetId);
    await driver.startScreencast(() => undefined);
    expect((await tool("browser_tabs", { action: "select", targetId: popup.targetId })).ok).toBe(
      true,
    );
    expect((await driver.listPages()).find((p) => p.active)?.targetId).toBe(popup.targetId);
    const screenshot = await tool("screenshot");
    expect(screenshot.screenshotBase64).toBeTruthy();
    const png = Buffer.from(screenshot.screenshotBase64!, "base64");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
    await tool("browser_tabs", { action: "close", targetId: popup.targetId });
    expect((await driver.listPages()).find((p) => p.active)?.targetId).toBe(original.targetId);
    await driver.stopScreencast();
    expect((await tool("browser_tabs", { action: "new", url: base + "/created" })).ok).toBe(true);
    expect((await driver.listPages()).find((p) => p.active)?.url).toBe(base + "/created");
  });
  task("reports navigation failures and bounded wait timeouts", async () => {
    expect((await navigate("http://127.0.0.1:1")).category).toBe("navigation");
    await navigate(base);
    expect((await tool("browser_wait", { text: "never appears", timeout_ms: 100 })).ok).toBe(false);
  });
});

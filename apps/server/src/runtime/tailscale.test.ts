import { describe, expect, it } from "vitest";
import type { CommandRunner } from "@locus/hypervisor";
import { hooksUrl, readTailscaleStatus, setTailscaleFunnel } from "./tailscale.js";

type ExecResult = { stdout: string; stderr: string; code: number };

function runner(handlers: Record<string, ExecResult | string>): CommandRunner {
  return {
    which: async (bin) => (bin === "tailscale" ? "/usr/bin/tailscale" : null),
    exists: async () => false,
    exec: async (_cmd, args) => {
      const key = args.join(" ");
      const hit = Object.entries(handlers).find(([prefix]) => key.startsWith(prefix));
      if (!hit) return { stdout: "", stderr: `unexpected ${key}`, code: 1 };
      const value = hit[1];
      if (typeof value === "string") return { stdout: value, stderr: "", code: 0 };
      return value;
    },
    spawn: () => {
      throw new Error("unused");
    },
  };
}

describe("tailscale funnel", () => {
  it("reports missing binary", async () => {
    const missing: CommandRunner = {
      which: async () => null,
      exists: async () => false,
      exec: async () => ({ stdout: "", stderr: "", code: 1 }),
      spawn: () => {
        throw new Error("unused");
      },
    };
    const status = await readTailscaleStatus(missing, 7420);
    expect(status.installed).toBe(false);
    expect(status.funnelEnabled).toBe(false);
  });

  it("parses a hooks-only Funnel URL", async () => {
    const status = await readTailscaleStatus(
      runner({
        "status --json": JSON.stringify({
          BackendState: "Running",
          Self: { DNSName: "box.tailnet.ts.net." },
        }),
        "serve status --json": JSON.stringify({
          Web: {
            "box.tailnet.ts.net:443": {
              "/api/hooks": { Proxy: "http://127.0.0.1:7420/api/hooks" },
            },
          },
        }),
      }),
      7420,
    );
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.funnelUrl).toBe("https://box.tailnet.ts.net/api/hooks");
    expect(hooksUrl("https://box.tailnet.ts.net", "auto-1")).toBe(
      "https://box.tailnet.ts.net/api/hooks/automations/auto-1",
    );
  });

  it("ignores Funnel configs that expose more than /api/hooks", async () => {
    const status = await readTailscaleStatus(
      runner({
        "status --json": JSON.stringify({
          BackendState: "Running",
          Self: { DNSName: "box.tailnet.ts.net." },
        }),
        "serve status --json": JSON.stringify({
          Web: {
            "box.tailnet.ts.net:443": {
              "/": { Proxy: "http://127.0.0.1:7420" },
              "/api/hooks": { Proxy: "http://127.0.0.1:7420/api/hooks" },
            },
          },
        }),
      }),
      7420,
    );
    expect(status.funnelUrl).toBeUndefined();
    expect(status.funnelEnabled).toBe(false);
  });

  it("enables Funnel with a loopback hooks proxy", async () => {
    const calls: string[] = [];
    const status = await setTailscaleFunnel(
      {
        which: async () => "/usr/bin/tailscale",
        exists: async () => true,
        exec: async (_cmd, args) => {
          calls.push(args.join(" "));
          if (args[0] === "serve" && args.includes("--bg"))
            return { stdout: "", stderr: "", code: 0 };
          if (args[0] === "funnel" && args.includes("on"))
            return { stdout: "", stderr: "", code: 0 };
          if (args[0] === "funnel" && args.includes("off"))
            return { stdout: "", stderr: "", code: 0 };
          if (args[0] === "serve" && args.includes("reset"))
            return { stdout: "", stderr: "", code: 0 };
          if (args.join(" ") === "status --json") {
            return {
              stdout: JSON.stringify({
                BackendState: "Running",
                Self: { DNSName: "box.tailnet.ts.net." },
              }),
              stderr: "",
              code: 0,
            };
          }
          if (args.join(" ") === "serve status --json") {
            return {
              stdout: JSON.stringify({
                Web: {
                  "box.tailnet.ts.net:443": {
                    "/api/hooks": { Proxy: "http://127.0.0.1:7420/api/hooks" },
                  },
                },
              }),
              stderr: "",
              code: 0,
            };
          }
          return { stdout: "", stderr: "", code: 0 };
        },
        spawn: () => {
          throw new Error("unused");
        },
      },
      7420,
      true,
    );
    expect(calls.some((row) => row === "serve reset")).toBe(true);
    expect(
      calls.some(
        (row) => row.includes("set-path=/api/hooks") && row.includes("127.0.0.1:7420/api/hooks"),
      ),
    ).toBe(true);
    expect(status.funnelUrl).toBe("https://box.tailnet.ts.net/api/hooks");
  });
});

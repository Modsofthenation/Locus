import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { SessionService } from "../session/sessions.js";
import { registerAndroidRoutes } from "./androidRoutes.js";

const environment = vi.hoisted(() =>
  vi.fn(async () => ({ sdk: null, avds: [], devices: [], issues: ["Install SDK"] })),
);
vi.mock("../android/runner.js", () => ({ androidEnvironment: environment }));

function app(peer = "127.0.0.1", authorized = true) {
  const server = new Hono();
  const projectRoot = vi.fn(async () => {
    if (!authorized) throw new Error("Not a local Host Android workflow");
    return "/workspace";
  });
  registerAndroidRoutes(server, {
    sessions: { androidProjectRoot: projectRoot } as unknown as SessionService,
    peerAddress: () => peer,
  });
  return { server, projectRoot };
}

describe("Android route authorization", () => {
  it("accepts the local operator and reports missing SDK", async () => {
    const { server, projectRoot } = app();
    const response = await server.request("/api/sessions/a1/android/environment");
    expect(response.status).toBe(200);
    expect(projectRoot).toHaveBeenCalledWith("a1");
    const payload = (await response.json()) as { issues: string[] };
    expect(payload.issues).toEqual(["Install SDK"]);
  });
  it("rejects remote peers on all device and project endpoints", async () => {
    const { server, projectRoot } = app("192.168.1.10");
    for (const [method, endpoint] of [
      ["GET", "environment"],
      ["GET", "screen"],
      ["GET", "apk"],
      ["GET", "project"],
      ["POST", "metro/stop"],
      ["POST", "input"],
      ["POST", "boot"],
      ["POST", "stop"],
      ["POST", "job"],
    ]) {
      expect(
        (await server.request(`/api/sessions/a1/android/${endpoint}`, { method })).status,
      ).toBe(403);
    }
    expect(projectRoot).not.toHaveBeenCalled();
  });
  it("rejects malicious and opaque origins even from loopback", async () => {
    const { server } = app();
    for (const origin of ["https://attacker.example", "null"])
      expect(
        (await server.request("/api/sessions/a1/android/environment", { headers: { origin } }))
          .status,
      ).toBe(403);
  });
  it("requires a local Host Android workflow even for screen capture", async () => {
    const { server } = app("127.0.0.1", false);
    expect(
      (await server.request("/api/sessions/a1/android/screen?serial=emulator-5554")).status,
    ).toBe(400);
  });
});

import type { Context, Hono } from "hono";
import { realpath } from "node:fs/promises";
import { isLoopbackOrigin } from "@locus/shared";
import { isLocalOperator } from "../core/localguard.js";
import type { SessionService } from "../session/sessions.js";
import {
  androidApk,
  androidEnvironment,
  androidInput,
  androidProjectInfo,
  androidScreen,
  bootAndroid,
  isAndroidAction,
  latestAndroidJob,
  startAndroidJob,
  stopAndroid,
  stopMetro,
  type AndroidInput,
} from "../android/runner.js";

export function registerAndroidRoutes(
  app: Hono,
  opts: {
    sessions: SessionService;
    peerAddress?: (c: Context) => string | undefined;
  },
) {
  app.use("/api/sessions/:id/android/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!isLocalOperator(c, opts.peerAddress) || (origin && !isLoopbackOrigin(origin)))
      return c.json({ error: "Android development is available only to the local operator" }, 403);
    try {
      await opts.sessions.androidProjectRoot(c.req.param("id")!);
    } catch (error) {
      return c.json({ error: String(error) }, 400);
    }
    await next();
  });
  const root = async (c: Context) =>
    realpath(await opts.sessions.androidProjectRoot(c.req.param("id")!));
  const failure = (c: Context, error: unknown) =>
    c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  app.get("/api/sessions/:id/android/environment", async (c) => {
    try {
      return c.json(await androidEnvironment());
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post("/api/sessions/:id/android/boot", async (c) => {
    try {
      const input = await c.req.json();
      if (typeof input.avd !== "string") throw new Error("Select an installed virtual device");
      await bootAndroid(input.avd);
      return c.json({ started: true });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.get("/api/sessions/:id/android/screen", async (c) => {
    try {
      const png = await androidScreen(c.req.query("serial") ?? "");
      c.header("Cache-Control", "no-store");
      return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png" });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post("/api/sessions/:id/android/stop", async (c) => {
    try {
      const input = await c.req.json();
      if (typeof input.serial !== "string") throw new Error("Select a running emulator");
      await stopAndroid(input.serial);
      return c.json({ stopped: true });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post("/api/sessions/:id/android/input", async (c) => {
    try {
      const input = await c.req.json();
      if (
        !input ||
        typeof input.serial !== "string" ||
        !input.input ||
        typeof input.input !== "object"
      )
        throw new Error("Invalid emulator input");
      await androidInput(input.serial, input.input as AndroidInput);
      return c.json({ ok: true });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.get("/api/sessions/:id/android/project", async (c) => {
    try {
      return c.json(await androidProjectInfo(await root(c)));
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post("/api/sessions/:id/android/metro/stop", async (c) => {
    try {
      await stopMetro(await root(c));
      return c.json({ stopped: true });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.get("/api/sessions/:id/android/job", async (c) => {
    try {
      return c.json({ job: latestAndroidJob(await root(c)) });
    } catch (error) {
      return failure(c, error);
    }
  });
  app.post("/api/sessions/:id/android/job", async (c) => {
    try {
      const input = await c.req.json();
      if (!isAndroidAction(input.action)) throw new Error("Unsupported Android action");
      if (input.serial !== undefined && typeof input.serial !== "string")
        throw new Error("Invalid device");
      if (input.packageName !== undefined && typeof input.packageName !== "string")
        throw new Error("Invalid applicationId");
      return c.json(
        await startAndroidJob(await root(c), input.action, input.serial, input.packageName),
        202,
      );
    } catch (error) {
      return failure(c, error);
    }
  });
  app.get("/api/sessions/:id/android/apk", async (c) => {
    try {
      c.header("Content-Disposition", 'attachment; filename="app-debug.apk"');
      c.header("Cache-Control", "no-store");
      return c.body(new Uint8Array(await androidApk(await root(c))), 200, {
        "Content-Type": "application/vnd.android.package-archive",
      });
    } catch (error) {
      return failure(c, error);
    }
  });
}

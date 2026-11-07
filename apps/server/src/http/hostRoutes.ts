import type { Hono } from "hono";
import type { ClientEvent, SetupStatus } from "@locus/shared";
import { qemuInstallDoneProgress, qemuInstallStartProgress } from "@locus/shared";
import { browseDiskImages, browseHostDir, saveHostFile } from "../workspace/hostWorkspace.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import type { Hub } from "../core/hub.js";
import { errorMessage } from "./sessionJson.js";
import {
  installQemu,
  type CommandRunner,
  type HostCapabilities,
  type HostSetupInfo,
  type Hypervisor,
  type QemuInstallResult,
} from "@locus/hypervisor";

function qemuInstallEmitter(hub?: Hub) {
  let log = "";
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (event: Omit<Extract<ClientEvent, { type: "qemu.install.progress" }>, "type">) => {
    hub?.broadcast({ type: "qemu.install.progress", ...event });
  };
  return {
    start() {
      log = "";
      send(qemuInstallStartProgress());
    },
    chunk(text: string) {
      log += text;
      const now = Date.now();
      const emit = () => {
        last = Date.now();
        send({
          phase: "Installing QEMU",
          log: log.slice(-8000),
          percent: Math.min(90, 8 + Math.round(log.length / 80)),
        });
      };
      if (now - last < 120) {
        clearTimeout(timer);
        timer = setTimeout(emit, 120);
        return;
      }
      emit();
    },
    finish(ok: boolean, fullLog: string, error?: string) {
      clearTimeout(timer);
      log = fullLog || log;
      send({
        ...qemuInstallDoneProgress(log.slice(-8000), ok ? undefined : error),
      });
    },
  };
}

export function registerHostRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    runner: CommandRunner;
    host?: { platform?: string; osRelease?: string };
    getHypervisor: () => Hypervisor;
    setHypervisor: (hypervisor: Hypervisor) => void;
    getCapabilities: () => HostCapabilities | undefined;
    setCapabilities: (capabilities: HostCapabilities) => void;
    setupJson: () => Promise<SetupStatus>;
    hostInfo: () => Promise<HostSetupInfo>;
    hub?: Hub;
    installQemu?: (opts?: { onOutput?: (chunk: string) => void }) => Promise<QemuInstallResult>;
    onQemuInstalled?: () => Promise<{
      hypervisor: Hypervisor;
      capabilities: HostCapabilities;
    } | void>;
  },
): void {
  app.get("/api/host/browse", async (c) => {
    try {
      return c.json(await browseHostDir(c.req.query("path") ?? undefined, opts.store.dataDir));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/host/browse-images", async (c) => {
    try {
      return c.json(await browseDiskImages(c.req.query("path") ?? undefined, opts.store.dataDir));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post("/api/host/save-file", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      dir?: unknown;
      filename?: unknown;
      contentBase64?: unknown;
    };
    try {
      return c.json(
        await saveHostFile({
          dir: typeof body.dir === "string" ? body.dir : "",
          filename: typeof body.filename === "string" ? body.filename : "",
          contentBase64: typeof body.contentBase64 === "string" ? body.contentBase64 : "",
          dataDir: opts.store.dataDir,
        }),
      );
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.get("/api/hypervisor", (c) =>
    c.json({
      kind: opts.getHypervisor().kind,
      capabilities: opts.getCapabilities() ?? null,
    }),
  );

  app.get("/api/setup", async (c) => c.json(await opts.setupJson()));

  app.post("/api/hypervisor/install", async (c) => {
    const hypervisor = opts.getHypervisor();
    const capabilities = opts.getCapabilities();
    const host = await opts.hostInfo();
    if (hypervisor.kind === "qemu" && capabilities?.qemuBinary) {
      return c.json({
        ok: true,
        qemuFound: true,
        restartRequired: false,
        log: "",
        setup: await opts.setupJson(),
      });
    }
    if (!host.install.canInstall) {
      return c.json(
        {
          error: `No one-click installer for ${host.os.label}. ${host.install.manualHint}`,
          setup: await opts.setupJson(),
        },
        400,
      );
    }
    try {
      const emit = qemuInstallEmitter(opts.hub);
      emit.start();
      const runInstall =
        opts.installQemu ??
        ((input?: { onOutput?: (chunk: string) => void }) =>
          installQemu(opts.runner, {
            platform: opts.host?.platform,
            osRelease: opts.host?.osRelease,
            onOutput: input?.onOutput,
          }));
      const result = await runInstall({ onOutput: (chunk) => emit.chunk(chunk) });
      emit.finish(result.ok, result.log, result.error);
      if (!result.ok) {
        return c.json(
          {
            error: result.error || "Install failed",
            log: result.log,
            setup: await opts.setupJson(),
          },
          400,
        );
      }
      let restartRequired = hypervisor.kind !== "qemu";
      if (opts.onQemuInstalled) {
        const next = await opts.onQemuInstalled();
        if (next) {
          opts.setHypervisor(next.hypervisor);
          opts.setCapabilities(next.capabilities);
          opts.sessions.setHypervisor(next.hypervisor);
          restartRequired = next.hypervisor.kind !== "qemu";
        }
      }
      const setup = await opts.setupJson();
      return c.json({
        ok: true,
        qemuFound: setup.qemuFound,
        restartRequired,
        log: result.log,
        setup,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Install failed" }, 500);
    }
  });
}

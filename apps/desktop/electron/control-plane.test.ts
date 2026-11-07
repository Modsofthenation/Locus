import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  restartDelayMs,
  controlPlaneNeedsRespawn,
  controlPlaneStartAction,
  HEALTH_FAILS_BEFORE_KILL,
} = createRequire(import.meta.url)(join(desktopRoot, "electron/control-plane.cjs")) as {
  restartDelayMs: (attempt: number, minMs?: number, maxMs?: number) => number;
  controlPlaneNeedsRespawn: (input: {
    quitting?: boolean;
    healthUp?: boolean;
    processAlive?: boolean;
    failCount?: number;
  }) => boolean;
  controlPlaneStartAction: (input?: {
    healthUp?: boolean;
    uiUp?: boolean;
    owned?: boolean;
  }) => "start" | "adopt" | "restart" | "leave";
  HEALTH_FAILS_BEFORE_KILL: number;
};

describe("control plane restart", () => {
  it("backs off then caps", () => {
    expect(restartDelayMs(0)).toBe(500);
    expect(restartDelayMs(1)).toBe(1_000);
    expect(restartDelayMs(2)).toBe(2_000);
    expect(restartDelayMs(8)).toBe(8_000);
  });

  it("respawns a dead process immediately and a hung one after failed probes", () => {
    expect(controlPlaneNeedsRespawn({ quitting: true, healthUp: false })).toBe(false);
    expect(controlPlaneNeedsRespawn({ healthUp: true, processAlive: true, failCount: 9 })).toBe(
      false,
    );
    expect(controlPlaneNeedsRespawn({ healthUp: false, processAlive: false })).toBe(true);
    expect(controlPlaneNeedsRespawn({ healthUp: false, processAlive: true, failCount: 1 })).toBe(
      false,
    );
    expect(
      controlPlaneNeedsRespawn({
        healthUp: false,
        processAlive: true,
        failCount: HEALTH_FAILS_BEFORE_KILL,
      }),
    ).toBe(true);
  });

  it("restarts a desktop-owned plane that is up without UI", () => {
    expect(controlPlaneStartAction({ healthUp: true, uiUp: true, owned: true })).toBe("adopt");
    expect(controlPlaneStartAction({ healthUp: true, uiUp: true, owned: false })).toBe("adopt");
    expect(controlPlaneStartAction({ healthUp: true, uiUp: false, owned: true })).toBe("restart");
    expect(controlPlaneStartAction({ healthUp: true, uiUp: false, owned: false })).toBe("leave");
    expect(controlPlaneStartAction({ healthUp: false, uiUp: false, owned: false })).toBe("start");
  });
});

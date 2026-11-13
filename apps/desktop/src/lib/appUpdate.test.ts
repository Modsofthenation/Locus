import { describe, expect, it, vi } from "vitest";
import {
  installAppUpdate,
  installOutcomeMessage,
  shouldAnnounceUpdate,
  type AppUpdateInfo,
} from "./appUpdate";

const available: AppUpdateInfo = {
  status: "available",
  current: "0.20.0",
  latest: "v0.21.0",
  asset: { name: "Locus-0.21.0.AppImage", url: "https://example/Locus-0.21.0.AppImage" },
  checksums: { name: "SHA256SUMS-linux", url: "https://example/SHA256SUMS-linux" },
};

describe("shouldAnnounceUpdate", () => {
  it("announces each new version once", () => {
    expect(shouldAnnounceUpdate(available, null)).toBe(true);
    expect(shouldAnnounceUpdate(available, "0.21.0")).toBe(false);
    expect(shouldAnnounceUpdate(available, "v0.21.0")).toBe(false);
    expect(shouldAnnounceUpdate(available, "0.20.5")).toBe(true);
  });

  it("stays quiet when up to date or unavailable", () => {
    expect(shouldAnnounceUpdate({ status: "up-to-date", latest: "v0.20.0" }, null)).toBe(false);
    expect(shouldAnnounceUpdate({ status: "unavailable" }, null)).toBe(false);
  });
});

describe("installAppUpdate", () => {
  it("verifies, then hands the file to the desktop installer", async () => {
    const download = vi
      .fn()
      .mockResolvedValue({ path: "/h/.locus/updates/x", sha256: "a", verified: true });
    const installUpdate = vi.fn().mockResolvedValue({ ok: true, action: "relaunching" });
    const outcome = await installAppUpdate(available, {
      download,
      open: vi.fn(),
      bridge: {
        setCloseGuard: () => undefined,
        onCloseRequested: () => () => undefined,
        ackClosePrompt: () => undefined,
        confirmClose: () => undefined,
        installUpdate,
      },
    });
    expect(download).toHaveBeenCalledWith(available.asset, available.checksums);
    expect(installUpdate).toHaveBeenCalledWith("/h/.locus/updates/x");
    expect(outcome).toEqual({ action: "relaunching", path: "/h/.locus/updates/x" });
    expect(installOutcomeMessage(outcome, "0.21.0")).toMatch(/restart/);
  });

  it("opens the verified file in a browser build without the bridge", async () => {
    const open = vi.fn().mockResolvedValue({ ok: true });
    const outcome = await installAppUpdate(available, {
      download: vi.fn().mockResolvedValue({ path: "/p", sha256: "a", verified: true }),
      open,
      bridge: undefined,
    });
    expect(open).toHaveBeenCalledWith("/p");
    expect(outcome.action).toBe("opened");
  });

  it("surfaces a failed install", async () => {
    await expect(
      installAppUpdate(available, {
        download: vi.fn().mockResolvedValue({ path: "/p", sha256: "a", verified: true }),
        bridge: {
          setCloseGuard: () => undefined,
          onCloseRequested: () => () => undefined,
          ackClosePrompt: () => undefined,
          confirmClose: () => undefined,
          installUpdate: vi.fn().mockResolvedValue({ ok: false, error: "disk full" }),
        },
      }),
    ).rejects.toThrow("disk full");
  });

  it("falls back to the download link when there is no SHA256SUMS", async () => {
    const outcome = await installAppUpdate({ ...available, checksums: undefined });
    expect(outcome).toEqual({ action: "download-only", url: available.asset!.url });
  });
});

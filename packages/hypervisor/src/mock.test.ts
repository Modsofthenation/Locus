import { describe, expect, it } from "vitest";
import {
  WINDOWS_10_DEFAULT_HARDWARE,
  WINDOWS_11_DEFAULT_HARDWARE,
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
} from "@locus/shared";
import { MockHypervisor, validateTemplate } from "./mock.js";
import type { GuestOs, VmTemplate } from "@locus/shared";

function template(os: GuestOs): VmTemplate {
  const now = new Date().toISOString();
  const hardware =
    os === "windows-11"
      ? { ...WINDOWS_11_DEFAULT_HARDWARE }
      : os === "windows-10"
        ? { ...WINDOWS_10_DEFAULT_HARDWARE }
        : { ...UBUNTU_DEFAULT_HARDWARE };
  return {
    id: "t1",
    name: os,
    os,
    description: "test",
    isoPath: "/isos/guest.iso",
    hardware,
    networking: defaultNetworking(os, 0),
    createdAt: now,
    updatedAt: now,
  };
}

describe("MockHypervisor", () => {
  it("creates and boots a VM to running", async () => {
    const hv = new MockHypervisor("/tmp/locus-test");
    const vm = await hv.create({
      sessionId: "s1",
      name: "agent-1",
      template: template("ubuntu"),
      slot: 0,
    });
    expect(vm.status).toBe("creating");
    expect(vm.ssh?.port).toBeGreaterThan(0);

    const started = await hv.start(vm.id);
    expect(["booting", "ready", "running"]).toContain(started.status);

    await new Promise((r) => setTimeout(r, 1100));
    expect(hv.get(vm.id)?.status).toBe("running");
    expect(hv.logs(vm.id)).toMatch(/creating/);
    expect(hv.logs(vm.id)).toMatch(/running/);
  });

  it("exposes RDP for Windows guests", async () => {
    const hv = new MockHypervisor("/tmp/locus-test");
    const vm = await hv.create({
      sessionId: "s1",
      name: "win",
      template: template("windows-11"),
      slot: 2,
    });
    expect(vm.rdp).toBeDefined();
    expect(vm.display?.protocol).toBe("spice");
  });

  it("allocates the next free slot after destroy", async () => {
    const hv = new MockHypervisor("/tmp/locus-test");
    const a = await hv.create({ sessionId: "s1", name: "a", template: template("ubuntu") });
    const b = await hv.create({ sessionId: "s1", name: "b", template: template("ubuntu") });
    expect(a.display?.port).toBe(5910);
    expect(b.display?.port).toBe(5911);
    await hv.destroy(a.id);
    const c = await hv.create({ sessionId: "s1", name: "c", template: template("ubuntu") });
    expect(c.display?.port).toBe(5910);
    await hv.destroy(b.id);
    await hv.destroy(c.id);
  });

  it("adopts a persisted VM and writes a snapshot", async () => {
    const hv = new MockHypervisor("/tmp/locus-test");
    const vm = await hv.create({ sessionId: "s1", name: "a", template: template("ubuntu") });
    hv.forceRunning(vm.id);
    const restored = hv.adopt({ ...hv.get(vm.id)!, status: "running" }, template("ubuntu"));
    expect(restored.status).toBe("stopped");
    const dest = "/tmp/locus-test/images/snap.qcow2";
    await hv.snapshotDisk(vm.id, dest);
    const { readFile, rm } = await import("node:fs/promises");
    expect(await readFile(dest, "utf8")).toContain(vm.id);
    await rm(dest, { force: true });
    await hv.destroy(vm.id);
  });

  it("restores a snapshot onto the mock disk", async () => {
    const hv = new MockHypervisor("/tmp/locus-test");
    const vm = await hv.create({ sessionId: "s1", name: "a", template: template("ubuntu") });
    const dest = "/tmp/locus-test/images/snap.qcow2";
    await hv.snapshotDisk(vm.id, dest);
    await hv.restoreDisk(vm.id, dest);
    const { readFile, rm } = await import("node:fs/promises");
    expect(await readFile(vm.diskPath, "utf8")).toContain(vm.id);
    await rm(dest, { force: true });
    await rm(vm.diskPath, { force: true });
    await hv.destroy(vm.id);
  });
});

describe("validateTemplate", () => {
  it("rejects Windows 11 without TPM", () => {
    const t = template("windows-11");
    t.hardware.enableTpm = false;
    expect(validateTemplate(t)).toContain("Windows 11 requires TPM 2.0");
  });

  it("accepts a stock Ubuntu template", () => {
    expect(validateTemplate(template("ubuntu"))).toEqual([]);
  });

  it("accepts Debian and Windows 10 stock templates", () => {
    expect(validateTemplate(template("debian"))).toEqual([]);
    expect(validateTemplate(template("windows-10"))).toEqual([]);
  });
});

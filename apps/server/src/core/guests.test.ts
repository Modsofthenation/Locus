import { describe, expect, it } from "vitest";
import type { VmInstance } from "@locus/shared";
import { WindowsGuestRuntime } from "@locus/guest-agent";
import { GuestHub } from "./guests.js";

function dockerVm(id = "v1"): VmInstance {
  return {
    id,
    sessionId: "s1",
    templateId: "docker",
    os: "ubuntu",
    name: "c",
    status: "ready",
    runtime: "docker",
    dockerImage: "locus/agent",
    containerId: "abc",
    diskPath: "/tmp/ws",
    createdAt: "",
    updatedAt: "",
  };
}

describe("GuestHub", () => {
  it("rebuilds docker runtimes after the live engine flag flips", () => {
    const hub = new GuestHub({ liveDocker: false });
    const vm = dockerVm();
    const first = hub.forVm(vm);
    expect(first.liveGuest).toBeFalsy();
    hub.setLiveDocker(true);
    const second = hub.forVm(vm);
    expect(second).not.toBe(first);
    expect(second.liveGuest).toBe(true);
  });

  it("keeps host runtimes when qemu live flips", () => {
    const hub = new GuestHub();
    const host = hub.forHost("s1", "ubuntu", "/tmp/host");
    hub.setLiveQemu(true);
    expect(hub.forHost("s1", "ubuntu", "/tmp/host")).toBe(host);
  });

  it("selects Windows SSH+WinRM failover through the Guest factory", () => {
    const hub = new GuestHub({ liveQemu: true });
    const runtime = hub.forVm({
      id: "win1",
      sessionId: "s1",
      templateId: "windows-11",
      os: "windows-11",
      name: "win",
      status: "ready",
      runtime: "vm",
      diskPath: "/tmp/win",
      createdAt: "",
      updatedAt: "",
      ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
      winrm: { host: "127.0.0.1", port: 5985, username: "locus" },
    });
    expect(runtime).toBeInstanceOf(WindowsGuestRuntime);
  });
});

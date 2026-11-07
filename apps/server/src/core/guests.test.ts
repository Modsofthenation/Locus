import { describe, expect, it } from "vitest";
import type { VmInstance } from "@locus/shared";
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
});

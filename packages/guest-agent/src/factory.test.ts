import { describe, expect, it } from "vitest";
import type { VmInstance } from "@locus/shared";
import { createGuestRuntime } from "./factory.js";
import { DockerGuestRuntime } from "./docker.js";
import { HostGuestRuntime } from "./host.js";
import { MockGuestRuntime } from "./mock.js";
import { SshGuestRuntime } from "./ssh.js";
import { WindowsGuestRuntime } from "./windows.js";

function vm(partial: Partial<VmInstance> = {}): VmInstance {
  return {
    id: "v1",
    sessionId: "s1",
    templateId: "ubuntu",
    os: "ubuntu",
    name: "guest",
    status: "ready",
    runtime: "vm",
    diskPath: "/tmp/ws",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("createGuestRuntime", () => {
  it("picks Docker, Host, SSH, and mock adapters", () => {
    expect(createGuestRuntime(vm({ runtime: "docker" }), { liveDocker: true })).toBeInstanceOf(
      DockerGuestRuntime,
    );
    expect(createGuestRuntime(vm({ runtime: "docker" }))).toBeInstanceOf(MockGuestRuntime);
    expect(createGuestRuntime(vm({ runtime: "host" }))).toBeInstanceOf(HostGuestRuntime);
    expect(
      createGuestRuntime(
        vm({
          ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
        }),
        { liveQemu: true },
      ),
    ).toBeInstanceOf(SshGuestRuntime);
    expect(createGuestRuntime(vm())).toBeInstanceOf(MockGuestRuntime);
  });

  it("gives Windows guests SSH+WinRM failover on both hubs", () => {
    const runtime = createGuestRuntime(
      vm({
        os: "windows-11",
        ssh: { host: "127.0.0.1", port: 2201, username: "locus" },
        winrm: { host: "127.0.0.1", port: 5985, username: "locus" },
      }),
      { liveQemu: true },
    );
    expect(runtime).toBeInstanceOf(WindowsGuestRuntime);
    expect(runtime.os).toBe("windows-11");
  });
});

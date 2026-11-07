import { describe, expect, it } from "vitest";
import type { LocusConfig, WorkerBackend } from "@locus/shared";
import { UBUNTU_DEFAULT_HARDWARE, defaultNetworking } from "@locus/shared";
import { appendConfigList, patchConfigList, removeConfigList } from "./configDraft";

const worker = (patch: Partial<WorkerBackend> = {}): WorkerBackend => ({
  id: "w1",
  name: "Office",
  url: "https://192.168.1.10:7421",
  token: "secret",
  ...patch,
});

function draft(patch: Partial<LocusConfig> = {}): LocusConfig {
  return {
    theme: "ember",
    providers: [],
    templates: [],
    hardwareProfiles: [],
    forges: [],
    advanced: {
      dataDir: "/tmp",
      qemuBinary: "qemu-system-x86_64",
      swtpmBinary: "swtpm",
      ovmfCodePath: "",
      ovmfVarsPath: "",
      maxConcurrentVms: 4,
      defaultAcceleratorAuto: true,
      logLevel: "info",
      bindHost: "127.0.0.1",
      bindPort: 7420,
      openBrowserOnStart: true,
      hostSharePath: "",
    },
    ...patch,
  };
}

describe("patchConfigList", () => {
  it("patches one worker row without mutating the draft", () => {
    const before = draft({ workers: [worker(), worker({ id: "w2", name: "Lab" })] });
    const after = patchConfigList(before, "workers", 1, { name: "Studio" });
    expect(before.workers?.[1]?.name).toBe("Lab");
    expect(after.workers?.map((row) => row.name)).toEqual(["Office", "Studio"]);
    expect(after.workers?.[1]?.url).toBe("https://192.168.1.10:7421");
  });

  it("accepts a row function for deletes and nested hardware", () => {
    const before = draft({
      workers: [worker({ kind: "cloud" })],
      templates: [
        {
          id: "ubuntu-24.04",
          name: "Ubuntu",
          os: "ubuntu",
          description: "",
          isoPath: "/iso",
          hardware: { ...UBUNTU_DEFAULT_HARDWARE },
          networking: defaultNetworking("ubuntu", 0),
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    const cleared = patchConfigList(before, "workers", 0, (row) => {
      const next = { ...row };
      delete next.kind;
      return next;
    });
    expect(cleared.workers?.[0]?.kind).toBeUndefined();
    const nested = patchConfigList(before, "templates", 0, (row) => ({
      ...row,
      hardware: { ...row.hardware, cpuCores: 8 },
    }));
    expect(nested.templates[0]?.hardware.cpuCores).toBe(8);
    expect(before.templates[0]?.hardware.cpuCores).toBe(UBUNTU_DEFAULT_HARDWARE.cpuCores);
  });

  it("is a no-op for a missing index", () => {
    const before = draft({ workers: [worker()] });
    expect(patchConfigList(before, "workers", 4, { name: "Nope" })).toBe(before);
  });
});

describe("appendConfigList / removeConfigList", () => {
  it("appends and removes without sharing the array", () => {
    const before = draft({ workers: [worker()] });
    const added = appendConfigList(before, "workers", worker({ id: "w2", name: "Lab" }));
    expect(added.workers).toHaveLength(2);
    expect(before.workers).toHaveLength(1);
    const removed = removeConfigList(added, "workers", 0);
    expect(removed.workers?.map((row) => row.id)).toEqual(["w2"]);
  });
});

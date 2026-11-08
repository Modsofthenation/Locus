import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloudImageFor,
  defaultNetworking,
  hostCloudImageArch,
  UBUNTU_DEFAULT_HARDWARE,
  type VmTemplate,
} from "@locus/shared";
import { resolveWorkerVmTemplate } from "./vmMedia.js";

function template(isoPath: string): VmTemplate {
  return {
    id: "ubuntu-24.04",
    name: "Ubuntu",
    os: "ubuntu",
    description: "test",
    isoPath,
    hardware: { ...UBUNTU_DEFAULT_HARDWARE },
    networking: defaultNetworking("ubuntu", 0),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveWorkerVmTemplate", () => {
  it("keeps an iso path that exists on this machine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-iso-"));
    const iso = join(dir, "ubuntu.img");
    await writeFile(iso, "img");
    const next = await resolveWorkerVmTemplate(dir, template(iso));
    expect(next.isoPath).toBe(iso);
  });

  it("falls back to LOCUS_WORKER_HOME/media cloud images", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-media-"));
    const cloud = cloudImageFor("ubuntu", hostCloudImageArch())!;
    await mkdir(join(dir, "media"), { recursive: true });
    const local = join(dir, "media", cloud.filename);
    await writeFile(local, "img");
    const next = await resolveWorkerVmTemplate(dir, template("/laptop/missing.img"));
    expect(next.isoPath).toBe(local);
  });
});

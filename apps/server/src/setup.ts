import {
  assessSetup,
  hasUsableKey,
  isLinux,
  type GoldenImage,
  type LocusConfig,
  type PackageManager,
  type SetupStatus,
} from "@locus/shared";
import type { HostCapabilities } from "@locus/hypervisor";

export function buildSetupStatus(opts: {
  config: LocusConfig;
  hypervisorKind: "qemu" | "mock";
  dockerKind?: "docker" | "mock";
  capabilities?: HostCapabilities | null;
  images: GoldenImage[];
  platform?: string;
  distro?: string;
  packageManager?: PackageManager | null;
}): SetupStatus {
  const qemuFound = Boolean(opts.capabilities?.qemuBinary) || opts.hypervisorKind === "qemu";
  const linuxImageReady =
    opts.config.templates.some((t) => isLinux(t.os) && t.isoPath.trim()) ||
    opts.images.some((img) => isLinux(img.os));
  const hasProvider = opts.config.providers.some(
    (p) => p.enabled && hasUsableKey(p.apiKey, p.baseUrl, p.kind),
  );
  return assessSetup({
    hypervisorKind: opts.hypervisorKind,
    qemuFound,
    hasKvm: opts.capabilities?.hasKvm,
    kvmUsable: opts.capabilities?.kvmUsable,
    linuxImageReady,
    dockerFound: opts.dockerKind === "docker",
    hasProvider,
    hasGoldenImage: opts.images.length > 0,
    setupCompleted: opts.config.setupCompleted,
    platform: opts.platform ?? process.platform,
    distro: opts.distro,
    packageManager: opts.packageManager,
  });
}

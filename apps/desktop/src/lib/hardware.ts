import { resolveVmHardware, type GuestOs, type LocusConfig } from "@locus/shared";

export function suggestedHardware(
  config: LocusConfig | null,
  os: GuestOs,
  templateId: string,
  repoUrl?: string,
) {
  const template = config?.templates.find((t) => t.id === templateId);
  if (!template) {
    return {
      cpuCores: 4,
      memoryMb: os === "windows-11" ? 8192 : 4096,
      diskSizeGb: os === "windows-11" ? 80 : os === "windows-10" ? 60 : 40,
    };
  }
  return resolveVmHardware(template.hardware, {
    os,
    profiles: config?.hardwareProfiles,
    repoUrl,
  });
}

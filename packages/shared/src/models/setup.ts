export type HypervisorKind = "qemu" | "mock";
export type HostPlatform = "linux" | "darwin" | "win32" | "unknown";
export type PackageManager =
  "apt" | "dnf" | "pacman" | "zypper" | "brew" | "winget" | "choco" | "scoop";

export interface HostOsInfo {
  platform: HostPlatform;
  label: string;
  distro?: string;
}

export interface QemuInstallRecipe {
  method: PackageManager | "manual";
  displayCommand: string;
  canInstall: boolean;
  packages: string[];
  manualHint: string;
}

export interface SetupStatus {
  hypervisorKind: HypervisorKind;
  qemuFound: boolean;
  qemuHint: string;
  kvmLabel: string;
  linuxImageReady: boolean;
  dockerFound: boolean;
  hasProvider: boolean;
  hasGoldenImage: boolean;
  setupCompleted: boolean;
  ready: boolean;
  needsWizard: boolean;
  hostOs: HostOsInfo;
  qemuInstall: QemuInstallRecipe;
}

const LINUX_APT_PACKAGES = [
  "qemu-system-x86",
  "qemu-system-arm",
  "qemu-utils",
  "ovmf",
  "qemu-efi-aarch64",
  "swtpm",
];
const LINUX_DNF_PACKAGES = ["qemu-kvm", "qemu-img", "edk2-ovmf", "edk2-aarch64", "swtpm"];
const LINUX_PACMAN_PACKAGES = ["qemu-full", "swtpm", "edk2-ovmf"];
const LINUX_ZYPPER_PACKAGES = ["qemu", "qemu-tools", "qemu-ovmf-x86_64", "swtpm"];
const WIN_MANUAL_HINT =
  "Install QEMU from https://www.qemu.org/download/#windows and add it to PATH.";
const WIN_WINGET =
  "winget install --id SoftwareFreedomConservancy.QEMU -e --accept-package-agreements --accept-source-agreements --disable-interactivity";
const WIN_CHOCO = "choco install qemu -y";
const WIN_SCOOP = "scoop install qemu";
const DARWIN_BREW = "brew install qemu";

export function hostPlatformOf(platform = ""): HostPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "unknown";
}

export function parseOsRelease(text: string): {
  id?: string;
  idLike?: string;
  prettyName?: string;
} {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return {
    id: values.ID || undefined,
    idLike: values.ID_LIKE || undefined,
    prettyName: values.PRETTY_NAME || undefined,
  };
}

export function packageManagerForDistro(id?: string, idLike?: string): PackageManager | null {
  const tokens = `${id ?? ""} ${idLike ?? ""}`.toLowerCase().split(/\s+/);
  if (
    tokens.some((t) =>
      ["ubuntu", "debian", "linuxmint", "pop", "elementary", "raspbian"].includes(t),
    )
  )
    return "apt";
  if (tokens.some((t) => ["fedora", "rhel", "centos", "rocky", "almalinux", "ol"].includes(t)))
    return "dnf";
  if (tokens.some((t) => ["arch", "manjaro", "endeavouros", "omarchy"].includes(t)))
    return "pacman";
  if (tokens.some((t) => ["opensuse", "opensuse-leap", "opensuse-tumbleweed", "sles"].includes(t)))
    return "zypper";
  return null;
}

export function describeHostOs(platform = "", distro?: string): HostOsInfo {
  const kind = hostPlatformOf(platform);
  if (kind === "darwin") return { platform: kind, label: "macOS", distro };
  if (kind === "win32") return { platform: kind, label: "Windows", distro };
  if (kind === "linux")
    return { platform: kind, label: distro ? `Linux (${distro})` : "Linux", distro };
  return { platform: "unknown", label: "this computer", distro };
}

export function qemuInstallRecipe(
  platform = "",
  packageManager?: PackageManager | null,
): QemuInstallRecipe {
  const kind = hostPlatformOf(platform);
  if (kind === "darwin") {
    return {
      method: "brew",
      displayCommand: DARWIN_BREW,
      canInstall: packageManager === "brew",
      packages: ["qemu"],
      manualHint: "Install Homebrew from https://brew.sh then run brew install qemu.",
    };
  }
  if (kind === "win32") {
    if (packageManager === "choco") {
      return {
        method: "choco",
        displayCommand: WIN_CHOCO,
        canInstall: true,
        packages: ["qemu"],
        manualHint: WIN_MANUAL_HINT,
      };
    }
    if (packageManager === "scoop") {
      return {
        method: "scoop",
        displayCommand: WIN_SCOOP,
        canInstall: true,
        packages: ["qemu"],
        manualHint: WIN_MANUAL_HINT,
      };
    }
    return {
      method: "winget",
      displayCommand: WIN_WINGET,
      canInstall: packageManager === "winget",
      packages: ["SoftwareFreedomConservancy.QEMU"],
      manualHint: WIN_MANUAL_HINT,
    };
  }
  if (packageManager === "dnf") {
    return {
      method: "dnf",
      displayCommand: `sudo dnf install -y ${LINUX_DNF_PACKAGES.join(" ")}`,
      canInstall: true,
      packages: LINUX_DNF_PACKAGES,
      manualHint: `sudo dnf install -y ${LINUX_DNF_PACKAGES.join(" ")}`,
    };
  }
  if (packageManager === "pacman") {
    return {
      method: "pacman",
      displayCommand: `sudo pacman -S --noconfirm ${LINUX_PACMAN_PACKAGES.join(" ")}`,
      canInstall: true,
      packages: LINUX_PACMAN_PACKAGES,
      manualHint: `sudo pacman -S --noconfirm ${LINUX_PACMAN_PACKAGES.join(" ")}`,
    };
  }
  if (packageManager === "zypper") {
    return {
      method: "zypper",
      displayCommand: `sudo zypper --non-interactive install ${LINUX_ZYPPER_PACKAGES.join(" ")}`,
      canInstall: true,
      packages: LINUX_ZYPPER_PACKAGES,
      manualHint: `sudo zypper --non-interactive install ${LINUX_ZYPPER_PACKAGES.join(" ")}`,
    };
  }
  return {
    method: "apt",
    displayCommand: `sudo apt install ${LINUX_APT_PACKAGES.join(" ")}`,
    canInstall: packageManager === "apt",
    packages: LINUX_APT_PACKAGES,
    manualHint: `sudo apt install ${LINUX_APT_PACKAGES.join(" ")}`,
  };
}

export function qemuInstallHint(platform = "", packageManager?: PackageManager | null): string {
  return qemuInstallRecipe(platform, packageManager).displayCommand;
}

export function kvmStatusLabel(input: { hasKvm?: boolean; kvmUsable?: boolean }): string {
  if (!input.hasKvm) return "KVM not present — guests will use TCG (slower)";
  if (input.kvmUsable === false) return "KVM present but unusable — using TCG";
  return "KVM available";
}

export function assessSetup(input: {
  hypervisorKind: HypervisorKind;
  qemuFound: boolean;
  hasKvm?: boolean;
  kvmUsable?: boolean;
  linuxImageReady: boolean;
  dockerFound?: boolean;
  hasProvider: boolean;
  hasGoldenImage: boolean;
  setupCompleted?: boolean;
  platform?: string;
  distro?: string;
  packageManager?: PackageManager | null;
}): SetupStatus {
  const dockerFound = Boolean(input.dockerFound);
  const ready = input.hasProvider;
  const qemuInstall = qemuInstallRecipe(input.platform, input.packageManager);
  return {
    hypervisorKind: input.hypervisorKind,
    qemuFound: input.qemuFound,
    qemuHint: qemuInstall.displayCommand,
    kvmLabel: kvmStatusLabel(input),
    linuxImageReady: input.linuxImageReady,
    dockerFound,
    hasProvider: input.hasProvider,
    hasGoldenImage: input.hasGoldenImage,
    setupCompleted: Boolean(input.setupCompleted),
    ready,
    needsWizard: !input.setupCompleted && !ready,
    hostOs: describeHostOs(input.platform, input.distro),
    qemuInstall,
  };
}

export type SetupTodoId = "provider" | "docker" | "vm";

export interface SetupTodo {
  id: SetupTodoId;
  label: string;
  done: boolean;
  optional?: boolean;
}

/** Provider, plus optional Docker and VM remaining after Skip for now. */
export function setupTodos(setup: SetupStatus): SetupTodo[] {
  return [
    { id: "provider", label: "Provider", done: setup.hasProvider },
    { id: "docker", label: "Docker", done: setup.dockerFound, optional: true },
    {
      id: "vm",
      label: "VM desktop",
      done: setup.qemuFound && setup.linuxImageReady,
      optional: true,
    },
  ];
}

export function setupHasRemainingTodos(setup: SetupStatus): boolean {
  return setupTodos(setup).some((row) => !row.done);
}

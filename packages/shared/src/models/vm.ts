export type GuestOs = "ubuntu" | "debian" | "omarchy" | "windows-11" | "windows-10";

export type AgentRuntime = "vm" | "docker" | "host";

export const AGENT_RUNTIMES: AgentRuntime[] = ["docker", "vm", "host"];

export function isAgentRuntime(value: unknown): value is AgentRuntime {
  return value === "vm" || value === "docker" || value === "host";
}

export function sessionRuntime(session: { runtime?: AgentRuntime }): AgentRuntime {
  if (session.runtime === "docker" || session.runtime === "host") return session.runtime;
  return "vm";
}

export function runtimeNeedsGuest(runtime: AgentRuntime): boolean {
  return runtime !== "host";
}

/** Locally built first-party image (git, Node, Chromium/Xvfb, ffmpeg, code-server). */
/** Compat tag. `npm run images` also tags `locus/agent:<app version>`. */
export const LOCUS_AGENT_IMAGE_TAG = "0.1";
export const LOCUS_AGENT_IMAGE = `locus/agent:${LOCUS_AGENT_IMAGE_TAG}`;
export const LOCUS_AGENT_IMAGE_VERSION = "0.20.0";
export const DEFAULT_DOCKER_IMAGE = "locus/agent";
/** In-guest code-server bind. Host reaches it through a loopback docker-exec tunnel, never a published port. */
export const LOCUS_CODE_SERVER_PORT = 3999;

export const LOCUS_DOCKER_ALIASES: Record<string, string> = {
  "locus/agent": LOCUS_AGENT_IMAGE,
  "locus/node": LOCUS_AGENT_IMAGE,
  "locus/web-qa": LOCUS_AGENT_IMAGE,
  "locus/design": LOCUS_AGENT_IMAGE,
};

export const DEFAULT_DOCKER_IMAGES: Array<{ image: string; name: string; summary: string }> = [
  {
    image: DEFAULT_DOCKER_IMAGE,
    name: "locus/agent",
    summary:
      "First-party image: git, Node 22, Chromium/Xvfb, ffmpeg, and code-server. Built locally on first use.",
  },
  {
    image: "ubuntu:24.04",
    name: "Ubuntu 24.04",
    summary: "General-purpose Linux shell. Install packages yourself.",
  },
  { image: "debian:12-slim", name: "Debian 12", summary: "Small Debian image for CLI work." },
  {
    image: "python:3.12-bookworm",
    name: "Python 3.12",
    summary: "Python 3.12 on Debian Bookworm.",
  },
];

export const DOCKER_WORKSPACE = "/workspace";
export const LINUX_WORKSPACE = "/home/locus/workspace";
export const WINDOWS_WORKSPACE = "C:\\Users\\locus\\workspace";

/** Reject shell metacharacters and absurd length; docker argv is still not a shell. */
export function parseDockerImage(raw: string): string | undefined {
  const image = raw.trim();
  if (!image || image.length > 256) return undefined;
  if (/\s/.test(image)) return undefined;
  if (/[;|&$<>`]/.test(image)) return undefined;
  return LOCUS_DOCKER_ALIASES[image.toLowerCase()] ?? image;
}

export function isLocusAgentImage(image: string): boolean {
  return parseDockerImage(image) === LOCUS_AGENT_IMAGE;
}

export const GUEST_OSES: GuestOs[] = ["ubuntu", "debian", "omarchy", "windows-11", "windows-10"];

export function isGuestOs(value: string): value is GuestOs {
  return (GUEST_OSES as string[]).includes(value);
}

export function isLinux(os: GuestOs): boolean {
  return os === "ubuntu" || os === "debian" || os === "omarchy";
}

/** UEFI firmware (OVMF) is required for Windows 11, Omarchy, and Secure Boot guests. */
export function needsUefi(os: GuestOs, hardware?: Pick<VmHardware, "enableSecureBoot">): boolean {
  return os === "windows-11" || os === "omarchy" || Boolean(hardware?.enableSecureBoot);
}

export function isWindows(os: GuestOs): boolean {
  return os === "windows-11" || os === "windows-10";
}

export const GUEST_OS_OPTIONS: Array<{ os: GuestOs; name: string; summary: string }> = [
  {
    os: "ubuntu",
    name: "Ubuntu 24.04",
    summary: "GNOME desktop, SSH, autoinstall or cloud-init, and Linux computer-use tools.",
  },
  {
    os: "debian",
    name: "Debian 12",
    summary: "XFCE desktop, SSH, cloud-init (cloud image), and the same Linux tools as Ubuntu.",
  },
  {
    os: "omarchy",
    name: "Omarchy 4",
    summary: "Arch + Hyprland ISO with unattended cidata install, UEFI, SSH, and Linux tools.",
  },
  {
    os: "windows-11",
    name: "Windows 11",
    summary: "TPM + Secure Boot, RDP, PowerShell, and UI Automation.",
  },
  {
    os: "windows-10",
    name: "Windows 10",
    summary: "RDP and WinRM without TPM, PowerShell, and UI Automation.",
  },
];

export function guestLabel(os: GuestOs): string {
  return GUEST_OS_OPTIONS.find((o) => o.os === os)?.name ?? os;
}

export function configuredGuestOsOptions(
  templates: Array<{ os: GuestOs; isoPath: string }> | undefined,
): typeof GUEST_OS_OPTIONS {
  return GUEST_OS_OPTIONS.filter((opt) =>
    templates?.some((t) => t.os === opt.os && t.isoPath.trim()),
  );
}

export function pickConfiguredOs(
  templates: Array<{ os: GuestOs; isoPath: string }> | undefined,
  preferred?: GuestOs,
): GuestOs {
  const available = configuredGuestOsOptions(templates);
  if (preferred && available.some((opt) => opt.os === preferred)) return preferred;
  return available[0]?.os ?? preferred ?? "ubuntu";
}

export const LINUX_HOST_MOUNT = "/mnt/host";
export const WINDOWS_HOST_MOUNT = "C:\\host";

export function guestShareRoot(os: GuestOs): string {
  return isWindows(os) ? WINDOWS_HOST_MOUNT : LINUX_HOST_MOUNT;
}

export function guestSharePath(os: GuestOs, filename: string): string {
  const name = filename.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? filename;
  return isWindows(os) ? `${WINDOWS_HOST_MOUNT}\\${name}` : `${LINUX_HOST_MOUNT}/${name}`;
}

export type VmLifecycle =
  | "creating"
  | "booting"
  | "installing"
  | "ready"
  | "running"
  | "paused"
  | "stopping"
  | "stopped"
  | "error";

export function isGuestReady(status?: string): boolean {
  return status === "running" || status === "ready" || status === "paused";
}

export function isGuestStarting(status?: string): boolean {
  return status === "creating" || status === "booting" || status === "installing";
}

/** Chat/composer wait: Guest still booting, or Session provisioning without a ready Machine. */
export function isChatWaitingForGuest(input: {
  viewing?: unknown;
  vmStatus?: string;
  sessionStatus?: string;
}): boolean {
  if (input.viewing) return false;
  return (
    isGuestStarting(input.vmStatus) ||
    (input.sessionStatus === "provisioning" && !isGuestReady(input.vmStatus))
  );
}

export type DisplayProtocol = "vnc" | "spice";

export type Accelerator = "kvm" | "whpx" | "hvf" | "tcg";

export interface CloudInitConfig {
  hostname: string;
  username: string;
  password?: string;
  sshAuthorizedKeys: string[];
  packages: string[];
  runcmd: string[];
}

export interface WindowsUnattendConfig {
  hostname: string;
  username: string;
  password: string;
  locale: string;
  skipOobe: boolean;
  enableRdp: boolean;
  enableWinRm: boolean;
  autologon: boolean;
}

export interface VmHardware {
  cpuCores: number;
  memoryMb: number;
  diskSizeGb: number;
  accelerator: Accelerator;
  enableTpm: boolean;
  enableSecureBoot: boolean;
  display: DisplayProtocol;
}

export type HardwareOverride = Partial<Pick<VmHardware, "cpuCores" | "memoryMb" | "diskSizeGb">>;

export interface RepoHardwareProfile {
  id: string;
  name: string;
  repoPattern: string;
  os?: GuestOs;
  hardware: HardwareOverride;
}

export interface VmNetworking {
  mode: "user";
  sshHostPort: number;
  rdpHostPort: number;
  winrmHostPort: number;
  vncDisplay: number;
  extraForwards: Array<{ hostPort: number; guestPort: number; proto: "tcp" | "udp" }>;
  restrict?: boolean;
  proxyPort?: number;
}

export type NetworkJail = "open" | "restricted" | "none";

export const NETWORK_JAILS: NetworkJail[] = ["open", "restricted", "none"];

export function isNetworkJail(value: unknown): value is NetworkJail {
  return value === "open" || value === "restricted" || value === "none";
}

export function defaultNetworkJail(_imageId?: string): NetworkJail {
  return "restricted";
}

export function formatNetworkJail(jail: NetworkJail): string {
  if (jail === "restricted") return "Forge and providers only";
  if (jail === "none") return "No guest internet";
  return "Open network";
}

export function hostFromHttpUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

export function parseAllowHosts(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const hosts: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    let host = part.trim().toLowerCase();
    if (!host) continue;
    host = host
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
    if (!host || host.length > 253) continue;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) continue;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

export function forgeProviderAllowlist(input: {
  providers?: Array<{ baseUrl: string }>;
  forges?: Array<{ apiBaseUrl: string }>;
  integrations?: Array<{ baseUrl: string }>;
  extraHosts?: string[];
  advanced?: { extraAllowHosts?: string[] };
}): string[] {
  const hosts = new Set([
    "github.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "bitbucket.org",
    "api.bitbucket.org",
    "gitlab.com",
    "atlassian.net",
    "slack.com",
    "api.incident.io",
    "app.incident.io",
    "linear.app",
    "api.linear.app",
  ]);
  for (const provider of input.providers ?? []) {
    const host = hostFromHttpUrl(provider.baseUrl);
    if (host) hosts.add(host);
  }
  for (const forge of input.forges ?? []) {
    const host = hostFromHttpUrl(forge.apiBaseUrl);
    if (host) hosts.add(host);
  }
  for (const row of input.integrations ?? []) {
    const host = hostFromHttpUrl(row.baseUrl);
    if (host) hosts.add(host);
  }
  for (const host of parseAllowHosts([
    ...(input.extraHosts ?? []),
    ...(input.advanced?.extraAllowHosts ?? []),
  ])) {
    hosts.add(host);
  }
  return [...hosts];
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return allow.some((entry) => {
    const e = entry.toLowerCase();
    return h === e || h.endsWith(`.${e}`);
  });
}

export function jailNetworking(
  jail: NetworkJail,
  proxyPort?: number,
): Pick<VmNetworking, "restrict" | "proxyPort"> {
  return {
    restrict: jail === "restricted" || jail === "none",
    proxyPort: jail === "restricted" ? proxyPort : undefined,
  };
}

export interface VmTemplate {
  id: string;
  name: string;
  os: GuestOs;
  description: string;
  isoPath: string;
  virtioIsoPath?: string;
  firmwarePath?: string;
  hardware: VmHardware;
  networking: VmNetworking;
  cloudInit?: CloudInitConfig;
  unattend?: WindowsUnattendConfig;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayEndpoint {
  protocol: DisplayProtocol;
  host: string;
  port: number;
  password?: string;
  websocketPort?: number;
}

export interface SerialEndpoint {
  kind: "unix" | "tcp" | "pipe";
  path?: string;
  host?: string;
  port?: number;
}

export interface VmInstance {
  id: string;
  sessionId: string;
  templateId: string;
  os: GuestOs;
  name: string;
  status: VmLifecycle;
  error?: string;
  diskPath: string;
  display?: DisplayEndpoint;
  serial?: SerialEndpoint;
  ssh?: { host: string; port: number; username: string; identityFile?: string };
  rdp?: { host: string; port: number; username: string };
  winrm?: { host: string; port: number; username: string; password?: string };
  pid?: number;
  slot?: number;
  imageId?: string;
  runtime?: AgentRuntime;
  /** Settings → Workers id when this guest lives on a remote worker. */
  backendId?: string;
  /** Control-plane namespace on a shared worker (`X-Locus-Plane`). */
  planeId?: string;
  dockerImage?: string;
  containerId?: string;
  network?: NetworkJail;
  createdAt: string;
  updatedAt: string;
}

export const UBUNTU_DEFAULT_HARDWARE: VmHardware = {
  cpuCores: 4,
  memoryMb: 4096,
  diskSizeGb: 40,
  accelerator: "kvm",
  enableTpm: false,
  enableSecureBoot: false,
  display: "vnc",
};

export const DEBIAN_DEFAULT_HARDWARE: VmHardware = { ...UBUNTU_DEFAULT_HARDWARE };

export const OMARCHY_DEFAULT_HARDWARE: VmHardware = {
  ...UBUNTU_DEFAULT_HARDWARE,
  memoryMb: 8192,
};

export const WINDOWS_11_DEFAULT_HARDWARE: VmHardware = {
  cpuCores: 4,
  memoryMb: 8192,
  diskSizeGb: 80,
  accelerator: "kvm",
  enableTpm: true,
  enableSecureBoot: true,
  display: "spice",
};

export const WINDOWS_10_DEFAULT_HARDWARE: VmHardware = {
  cpuCores: 4,
  memoryMb: 4096,
  diskSizeGb: 60,
  accelerator: "kvm",
  enableTpm: false,
  enableSecureBoot: false,
  display: "spice",
};

export function validateHardwareOverride(hw: HardwareOverride): string | undefined {
  if (hw.cpuCores !== undefined && (!Number.isFinite(hw.cpuCores) || hw.cpuCores < 1)) {
    return "CPU cores must be at least 1";
  }
  if (hw.memoryMb !== undefined && (!Number.isFinite(hw.memoryMb) || hw.memoryMb < 512)) {
    return "Memory must be at least 512 MB";
  }
  if (hw.diskSizeGb !== undefined && (!Number.isFinite(hw.diskSizeGb) || hw.diskSizeGb < 8)) {
    return "Disk must be at least 8 GB";
  }
  return undefined;
}

export function mergeHardware(base: VmHardware, override?: HardwareOverride): VmHardware {
  if (!override) return { ...base };
  return {
    ...base,
    cpuCores: override.cpuCores ?? base.cpuCores,
    memoryMb: override.memoryMb ?? base.memoryMb,
    diskSizeGb: override.diskSizeGb ?? base.diskSizeGb,
  };
}

function normalizeRepo(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

export function matchRepoHardware(
  profiles: RepoHardwareProfile[],
  repoUrl: string | undefined,
  os: GuestOs,
): HardwareOverride | undefined {
  if (!repoUrl) return undefined;
  const url = normalizeRepo(repoUrl);
  const hit = profiles.find((profile) => {
    const pattern = profile.repoPattern.trim();
    if (!pattern) return false;
    if (profile.os && profile.os !== os) return false;
    return url.includes(normalizeRepo(pattern));
  });
  return hit?.hardware;
}

export function resolveVmHardware(
  base: VmHardware,
  opts: {
    os: GuestOs;
    profiles?: RepoHardwareProfile[];
    repoUrl?: string;
    override?: HardwareOverride;
  },
): VmHardware {
  const fromRepo = matchRepoHardware(opts.profiles ?? [], opts.repoUrl, opts.os);
  return mergeHardware(mergeHardware(base, fromRepo), opts.override);
}

export function formatHardware(
  hw: Pick<VmHardware, "cpuCores" | "memoryMb" | "diskSizeGb">,
): string {
  const gb =
    hw.memoryMb >= 1024 && hw.memoryMb % 1024 === 0
      ? `${hw.memoryMb / 1024} GB`
      : `${hw.memoryMb} MB`;
  return `${hw.cpuCores} CPU · ${gb} · ${hw.diskSizeGb} GB disk`;
}

export function defaultNetworking(os: GuestOs, slot: number): VmNetworking {
  const base = 2200 + slot * 10;
  return {
    mode: "user",
    sshHostPort: isLinux(os) ? base : base + 1,
    rdpHostPort: isWindows(os) ? base + 2 : 0,
    winrmHostPort: isWindows(os) ? base + 3 : 0,
    vncDisplay: slot + 10,
    extraForwards: [],
  };
}

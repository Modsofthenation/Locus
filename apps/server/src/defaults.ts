import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BUILTIN_PROVIDERS,
  DEFAULT_ADVANCED,
  DEFAULT_THEME,
  DEBIAN_DEFAULT_HARDWARE,
  OMARCHY_DEFAULT_HARDWARE,
  UBUNTU_DEFAULT_HARDWARE,
  WINDOWS_10_DEFAULT_HARDWARE,
  WINDOWS_11_DEFAULT_HARDWARE,
  defaultNetworking,
  generateGuestPassword,
  LEGACY_LINUX_GUEST_PASSWORD,
  LEGACY_WINDOWS_GUEST_PASSWORD,
  type AdvancedSettings,
  type AiProvider,
  type LocusConfig,
  type VmTemplate,
} from "@locus/shared";
import { randomUUID } from "node:crypto";

export function defaultDataDir(): string {
  return process.env.LOCUS_HOME ?? join(homedir(), ".locus");
}

export function assertWipeableDataDir(dataDir: string): string {
  const resolved = resolve(dataDir.trim());
  if (!dataDir.trim()) throw new Error("Refusing to wipe an empty data directory");
  const banned = [
    resolve("/"),
    resolve(homedir()),
    resolve("/tmp"),
    resolve("/var"),
    resolve("/etc"),
    resolve("/usr"),
    resolve("/home"),
    resolve("/Users"),
  ];
  if (banned.includes(resolved) || dirname(resolved) === resolved) {
    throw new Error(`Refusing to wipe ${resolved}`);
  }
  return resolved;
}

function stamp(): string {
  return new Date().toISOString();
}

export function builtinTemplates(opts?: { randomPasswords?: boolean }): VmTemplate[] {
  const t = stamp();
  const randomPasswords = opts?.randomPasswords ?? true;
  const linuxPassword = randomPasswords ? generateGuestPassword() : LEGACY_LINUX_GUEST_PASSWORD;
  const windowsPassword = randomPasswords ? generateGuestPassword() : LEGACY_WINDOWS_GUEST_PASSWORD;
  return [
    {
      id: "ubuntu-24.04",
      name: "Ubuntu 24.04 LTS",
      os: "ubuntu",
      description: "Desktop Ubuntu guest with GNOME, SSH, and the Locus Linux agent.",
      isoPath: "",
      hardware: { ...UBUNTU_DEFAULT_HARDWARE },
      networking: defaultNetworking("ubuntu", 0),
      cloudInit: {
        hostname: "locus-ubuntu",
        username: "locus",
        password: linuxPassword,
        sshAuthorizedKeys: [],
        packages: [
          "ubuntu-desktop-minimal",
          "git",
          "openssh-server",
          "xdotool",
          "scrot",
          "wmctrl",
          "xclip",
          "python3",
          "ffmpeg",
          "ripgrep",
        ],
        runcmd: [
          "systemctl enable --now ssh",
          "systemctl set-default graphical.target",
          "mkdir -p /etc/gdm3 /var/lib/AccountsService/users /mnt/host",
          "printf '[daemon]\\nAutomaticLoginEnable=true\\nAutomaticLogin=locus\\nWaylandEnable=false\\n' > /etc/gdm3/custom.conf",
          "printf '[User]\\nSession=ubuntu-xorg\\nXSession=ubuntu-xorg\\nSystemAccount=false\\n' > /var/lib/AccountsService/users/locus",
          "printf 'hostshare /mnt/host 9p trans=virtio,version=9p2000.L,_netdev,nofail 0 0\\n' >> /etc/fstab",
          "mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host || true",
          "systemctl restart gdm3 || systemctl restart gdm || true",
        ],
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "debian-12",
      name: "Debian 12",
      os: "debian",
      description: "Debian 12 guest with a desktop, SSH, and the Locus Linux agent.",
      isoPath: "",
      hardware: { ...DEBIAN_DEFAULT_HARDWARE },
      networking: defaultNetworking("debian", 0),
      cloudInit: {
        hostname: "locus-debian",
        username: "locus",
        password: linuxPassword,
        sshAuthorizedKeys: [],
        packages: [
          "xfce4",
          "lightdm",
          "git",
          "openssh-server",
          "xdotool",
          "scrot",
          "wmctrl",
          "xclip",
          "python3",
          "ffmpeg",
          "ripgrep",
        ],
        runcmd: [
          "systemctl enable --now ssh",
          "systemctl set-default graphical.target",
          "mkdir -p /etc/lightdm/lightdm.conf.d /mnt/host",
          "printf '[Seat:*]\\nautologin-user=locus\\nautologin-user-timeout=0\\n' > /etc/lightdm/lightdm.conf.d/locus.conf",
          "printf 'hostshare /mnt/host 9p trans=virtio,version=9p2000.L,_netdev,nofail 0 0\\n' >> /etc/fstab",
          "mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host || true",
          "systemctl restart lightdm || true",
        ],
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "omarchy-4",
      name: "Omarchy 4",
      os: "omarchy",
      description:
        "Omarchy 4 (Quattro) guest: Arch, Hyprland, unattended ISO install, SSH, and the Locus Linux agent.",
      isoPath: "",
      hardware: { ...OMARCHY_DEFAULT_HARDWARE },
      networking: defaultNetworking("omarchy", 0),
      cloudInit: {
        hostname: "locus-omarchy",
        username: "locus",
        password: linuxPassword,
        sshAuthorizedKeys: [],
        packages: [],
        runcmd: [],
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "windows-11",
      name: "Windows 11",
      os: "windows-11",
      description: "Windows 11 guest with TPM, VirtIO, RDP, and the Locus Windows agent.",
      isoPath: "",
      hardware: { ...WINDOWS_11_DEFAULT_HARDWARE },
      networking: defaultNetworking("windows-11", 0),
      unattend: {
        hostname: "LOCUS-WIN",
        username: "locus",
        password: windowsPassword,
        locale: "en-US",
        skipOobe: true,
        enableRdp: true,
        enableWinRm: true,
        autologon: true,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "windows-10",
      name: "Windows 10",
      os: "windows-10",
      description:
        "Windows 10 guest with VirtIO, RDP, WinRM, and the Locus Windows agent. TPM is optional.",
      isoPath: "",
      hardware: { ...WINDOWS_10_DEFAULT_HARDWARE },
      networking: defaultNetworking("windows-10", 0),
      unattend: {
        hostname: "LOCUS-WIN10",
        username: "locus",
        password: windowsPassword,
        locale: "en-US",
        skipOobe: true,
        enableRdp: true,
        enableWinRm: true,
        autologon: true,
      },
      createdAt: t,
      updatedAt: t,
    },
  ];
}

export function builtinProviders(): AiProvider[] {
  return BUILTIN_PROVIDERS.map((p) => ({
    ...p,
    id: randomUUID(),
    apiKey: "",
  }));
}

export function defaultConfig(dataDir: string): LocusConfig {
  const advanced: AdvancedSettings = {
    ...DEFAULT_ADVANCED,
    dataDir,
    hostSharePath: join(dataDir, "share"),
  };
  return {
    theme: DEFAULT_THEME,
    providers: builtinProviders(),
    templates: builtinTemplates({ randomPasswords: true }),
    hardwareProfiles: [],
    mcpServers: [],
    skills: [],
    integrations: [],
    integrationPlugins: [],
    forges: [
      {
        id: randomUUID(),
        kind: "github",
        name: "GitHub",
        apiBaseUrl: "https://api.github.com",
      },
      {
        id: randomUUID(),
        kind: "gitlab",
        name: "GitLab",
        apiBaseUrl: "https://gitlab.com/api/v4",
      },
      {
        id: randomUUID(),
        kind: "bitbucket",
        name: "Bitbucket",
        apiBaseUrl: "https://api.bitbucket.org/2.0",
      },
    ],
    advanced,
  };
}

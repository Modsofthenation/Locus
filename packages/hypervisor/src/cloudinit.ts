import type { CloudInitConfig, GuestOs } from "@locus/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha512Crypt } from "./sha512crypt.js";

export interface RenderCloudInitOptions {
  os?: GuestOs;
  autoinstall?: boolean;
}

export function renderCloudInit(
  config: CloudInitConfig,
  opts: RenderCloudInitOptions = {},
): { userData: string; metaData: string } {
  const base = renderUserData(config);
  const userData =
    opts.autoinstall && opts.os === "ubuntu" ? wrapUbuntuAutoinstall(config, base) : base;
  const metaData = [
    `instance-id: locus-${config.hostname}`,
    `local-hostname: ${config.hostname}`,
    "",
  ].join("\n");
  return { userData, metaData };
}

function renderUserData(config: CloudInitConfig): string {
  const keys = config.sshAuthorizedKeys.map((k) => `    - ${yamlScalar(k)}`).join("\n");
  const packages = config.packages.map((p) => `  - ${yamlScalar(p)}`).join("\n");
  const runcmd = config.runcmd.map((c) => `  - ${yamlScalar(c)}`).join("\n");
  const passwordAuth = Boolean(config.password) && config.sshAuthorizedKeys.length === 0;
  return [
    "#cloud-config",
    `hostname: ${yamlScalar(config.hostname)}`,
    "manage_etc_hosts: true",
    "users:",
    `  - name: ${yamlScalar(config.username)}`,
    "    sudo: ALL=(ALL) NOPASSWD:ALL",
    "    groups: sudo, adm",
    "    shell: /bin/bash",
    config.password ? `    lock_passwd: false` : "    lock_passwd: true",
    config.password ? `    passwd: ${yamlScalar(sha512Crypt(config.password))}` : "",
    config.sshAuthorizedKeys.length ? "    ssh_authorized_keys:" : "",
    keys,
    `ssh_pwauth: ${passwordAuth ? "true" : "false"}`,
    "package_update: true",
    packages ? "packages:" : "",
    packages,
    runcmd ? "runcmd:" : "",
    runcmd,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function wrapUbuntuAutoinstall(config: CloudInitConfig, installedUserData: string): string {
  const keys = config.sshAuthorizedKeys.map((k) => `      - ${yamlScalar(k)}`).join("\n");
  const packages = config.packages.map((p) => `    - ${yamlScalar(p)}`).join("\n");
  const indented = installedUserData
    .split("\n")
    .map((line) => (line ? `    ${line}` : line))
    .join("\n");
  return [
    "#cloud-config",
    "autoinstall:",
    "  version: 1",
    "  identity:",
    `    hostname: ${yamlScalar(config.hostname)}`,
    `    username: ${yamlScalar(config.username)}`,
    `    password: ${yamlScalar(config.password ? sha512Crypt(config.password) : "*")}`,
    "  ssh:",
    "    install-server: true",
    config.sshAuthorizedKeys.length ? "    authorized-keys:" : "",
    keys,
    "  storage:",
    "    layout:",
    "      name: direct",
    packages ? "  packages:" : "",
    packages,
    "  late-commands:",
    "    - curtin in-target -- systemctl enable ssh",
    "    - curtin in-target -- systemctl set-default graphical.target",
    "  user-data: |",
    indented,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

export async function writeCloudInitDir(
  dir: string,
  config: CloudInitConfig,
  opts: RenderCloudInitOptions = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const { userData, metaData } = renderCloudInit(config, opts);
  await writeFile(join(dir, "user-data"), userData, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(dir, "meta-data"), metaData, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(dir, "vendor-data"), "#cloud-config\n", { encoding: "utf8", mode: 0o600 });
  return dir;
}

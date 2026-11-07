import type { CloudInitConfig } from "@locus/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha512Crypt } from "./sha512crypt.js";

const ESP_BYTES = 2 * 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const ESP_ID = "ea21d3f2-82bb-49cc-ab5d-6f81ae94e18d";
const ROOT_ID = "8c2c2b92-1070-455d-b76a-56263bab24aa";

export interface RenderOmarchyCidataOptions {
  diskSizeGb: number;
  runtimePackage?: string;
  settingsPackage?: string;
}

export function renderOmarchyCidata(
  config: CloudInitConfig,
  opts: RenderOmarchyCidataOptions,
): Record<string, string> {
  const diskBytes = Math.max(8, Math.round(opts.diskSizeGb)) * 1024 * 1024 * 1024;
  const bootStart = MIB;
  const bootSize = ESP_BYTES;
  const mainStart = bootSize + bootStart;
  const mainSize = diskBytes - mainStart - MIB;
  if (!config.password?.trim()) {
    throw new Error("Omarchy install needs a guest password");
  }
  const passwordHash = sha512Crypt(config.password);
  const files: Record<string, string> = {
    "user_credentials.json": `${JSON.stringify(
      {
        root_enc_password: passwordHash,
        users: [
          {
            enc_password: passwordHash,
            groups: [],
            sudo: true,
            username: config.username,
          },
        ],
      },
      null,
      4,
    )}\n`,
    "user_configuration.json": `${JSON.stringify(
      {
        app_config: null,
        "archinstall-language": "English",
        auth_config: {},
        audio_config: { audio: "pipewire" },
        bootloader_config: { bootloader: "Limine", uki: false, removable: false },
        custom_commands: [],
        omarchy_install: {
          mode: "full_disk",
          defer_provisioning: false,
          target_mount: "/mnt",
          boot: {
            esp_mount: "/boot",
            esp_path: "/EFI/limine",
            efi_binary: "limine_x64.efi",
            enable_fallback: true,
          },
          storage: { kernel: "linux" },
        },
        disk_config: {
          config_type: "default_layout",
          device_modifications: [
            {
              device: "/dev/vda",
              partitions: [
                {
                  btrfs: [],
                  dev_path: null,
                  flags: ["boot", "esp"],
                  fs_type: "fat32",
                  mount_options: [],
                  mountpoint: "/boot",
                  obj_id: ESP_ID,
                  size: sector(bootSize),
                  start: sector(bootStart),
                  status: "create",
                  type: "primary",
                },
                {
                  btrfs: [
                    { mountpoint: "/", name: "@" },
                    { mountpoint: "/home", name: "@home" },
                    { mountpoint: "/var/log", name: "@log" },
                    { mountpoint: "/var/cache/pacman/pkg", name: "@pkg" },
                  ],
                  dev_path: null,
                  flags: [],
                  fs_type: "btrfs",
                  mount_options: ["compress=zstd"],
                  mountpoint: null,
                  obj_id: ROOT_ID,
                  size: sector(mainSize),
                  start: sector(mainStart),
                  status: "create",
                  type: "primary",
                },
              ],
              wipe: true,
            },
          ],
        },
        hostname: config.hostname,
        kernels: ["linux"],
        network_config: { type: "iso" },
        ntp: true,
        parallel_downloads: 8,
        script: null,
        services: [],
        swap: true,
        timezone: "UTC",
        locale_config: { kb_layout: "us", sys_enc: "UTF-8", sys_lang: "en_US.UTF-8" },
        mirror_config: {
          custom_repositories: [],
          custom_servers: [
            { url: "https://mirror.omarchy.org/$repo/os/$arch" },
            { url: "https://mirror.rackspace.com/archlinux/$repo/os/$arch" },
            { url: "https://geo.mirror.pkgbuild.com/$repo/os/$arch" },
          ],
          mirror_regions: {},
          optional_repositories: [],
        },
        packages: [
          "base-devel",
          "git",
          "omarchy-keyring",
          opts.settingsPackage ?? "omarchy-settings",
          opts.runtimePackage ?? "omarchy",
        ],
        profile_config: { gfx_driver: null, greeter: null, profile: {} },
        version: "3.0.9",
      },
      null,
      4,
    )}\n`,
    "user_full_name.txt": `${config.username}\n`,
    "user_email_address.txt": "\n",
    "user_encrypt_installation.txt": "false\n",
  };
  if (config.sshAuthorizedKeys.length) {
    files.authorized_keys = `${config.sshAuthorizedKeys.filter(Boolean).join("\n")}\n`;
  }
  return files;
}

export async function writeOmarchyCidataDir(
  dir: string,
  config: CloudInitConfig,
  opts: RenderOmarchyCidataOptions,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const files = renderOmarchyCidata(config, opts);
  await Promise.all(
    Object.entries(files).map(([name, body]) =>
      writeFile(join(dir, name), body, { encoding: "utf8", mode: 0o600 }),
    ),
  );
  return dir;
}

function sector(value: number): {
  sector_size: { unit: "B"; value: 512 };
  unit: "B";
  value: number;
} {
  return { sector_size: { unit: "B", value: 512 }, unit: "B", value };
}

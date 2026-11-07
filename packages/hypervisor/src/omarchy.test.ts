import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderOmarchyCidata, writeOmarchyCidataDir } from "./omarchy.js";

const cloudInit = {
  hostname: "locus-omarchy",
  username: "locus",
  password: "locus",
  sshAuthorizedKeys: ["ssh-ed25519 AAAAC3 locus@host"],
  packages: [],
  runcmd: [],
};

describe("omarchy cidata", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("renders archinstall files for a virtio disk and SSH key", () => {
    const files = renderOmarchyCidata(cloudInit, { diskSizeGb: 40 });
    const config = JSON.parse(files["user_configuration.json"]!) as {
      hostname: string;
      omarchy_install: { mode: string };
      disk_config: {
        device_modifications: Array<{
          device: string;
          partitions: Array<{ size: { value: number }; start: { value: number } }>;
        }>;
      };
      packages: string[];
    };
    const creds = JSON.parse(files["user_credentials.json"]!) as {
      users: Array<{ username: string; enc_password: string; sudo: boolean }>;
    };
    expect(config.hostname).toBe("locus-omarchy");
    expect(config.omarchy_install.mode).toBe("full_disk");
    expect(config.disk_config.device_modifications[0]?.device).toBe("/dev/vda");
    expect(config.packages).toEqual(
      expect.arrayContaining(["omarchy", "omarchy-settings", "omarchy-keyring"]),
    );
    const root = config.disk_config.device_modifications[0]?.partitions[1];
    expect(root?.start.value).toBe(2 * 1024 * 1024 * 1024 + 1024 * 1024);
    expect(root?.size.value).toBe(40 * 1024 * 1024 * 1024 - root!.start.value - 1024 * 1024);
    expect(creds.users[0]).toMatchObject({ username: "locus", sudo: true });
    expect(creds.users[0]?.enc_password).toMatch(/^\$6\$/);
    expect(files.authorized_keys).toContain("ssh-ed25519 AAAAC3 locus@host");
    expect(files["user_encrypt_installation.txt"]).toBe("false\n");
  });

  it("omits authorized_keys when none are provided", () => {
    const files = renderOmarchyCidata({ ...cloudInit, sshAuthorizedKeys: [] }, { diskSizeGb: 40 });
    expect(files.authorized_keys).toBeUndefined();
  });

  it("writes the seed directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-omarchy-"));
    dirs.push(dir);
    await writeOmarchyCidataDir(dir, cloudInit, { diskSizeGb: 40 });
    const listed = await readFile(join(dir, "user_configuration.json"), "utf8");
    expect(listed).toContain("full_disk");
  });
});

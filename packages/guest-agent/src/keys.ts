import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface HostSshKey {
  privateKeyPath: string;
  publicKey: string;
}

export type Keygen = (args: string[]) => Promise<void>;

export async function ensureHostKey(
  dataDir: string,
  keygen: Keygen = sshKeygen,
): Promise<HostSshKey> {
  const dir = join(dataDir, "ssh");
  const privateKeyPath = join(dir, "id_ed25519");
  const publicKeyPath = `${privateKeyPath}.pub`;
  await mkdir(dir, { recursive: true });
  if (!(await exists(privateKeyPath)) || !(await exists(publicKeyPath))) {
    await keygen(["-t", "ed25519", "-f", privateKeyPath, "-N", "", "-C", "locus@host", "-q"]);
  }
  await chmod(privateKeyPath, 0o600).catch(() => undefined);
  const publicKey = (await readFile(publicKeyPath, "utf8")).trim();
  if (!publicKey.startsWith("ssh-")) {
    throw new Error("Host SSH public key is missing or invalid");
  }
  return { privateKeyPath, publicKey };
}

/**
 * Like ensureHostKey, but a missing `ssh-keygen` (minimal Linux installs,
 * containers) does not stop the control plane: Host and Docker agents never use
 * this key. VM guests do, so the caller logs the reason and VMs can't be reached
 * over SSH until the key exists.
 */
export async function tryEnsureHostKey(
  dataDir: string,
  keygen: Keygen = sshKeygen,
): Promise<{ key: HostSshKey; error?: undefined } | { key: HostSshKey; error: string }> {
  try {
    return { key: await ensureHostKey(dataDir, keygen) };
  } catch (err) {
    const privateKeyPath = join(dataDir, "ssh", "id_ed25519");
    return {
      key: { privateKeyPath, publicKey: "" },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One line for the server log when tryEnsureHostKey could not make the key. */
export function hostKeyWarning(error: string): string {
  return `Warning: ${error}. Host and Docker agents still work; VM agents need ssh-keygen (install openssh-client, then restart Locus).`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sshKeygen(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh-keygen", args, { stdio: "ignore", windowsHide: true });
    child.on("error", (err) => {
      reject(new Error(`ssh-keygen is required to create ~/.locus/ssh (${err.message})`));
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ssh-keygen exited with code ${code}`));
    });
  });
}

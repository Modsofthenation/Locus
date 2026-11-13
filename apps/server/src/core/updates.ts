import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  LOCUS_RELEASES_API_URL,
  LOCUS_RELEASES_URL,
  checksumLineFor,
  isNewerVersion,
  pickChecksumsAsset,
  pickReleaseAsset,
  type ReleaseAsset,
} from "@locus/shared";

export type UpdateStatus = "available" | "up-to-date" | "unavailable";

export interface AppUpdate {
  status: UpdateStatus;
  current: string;
  latest?: string;
  name?: string;
  notes?: string;
  htmlUrl?: string;
  asset?: ReleaseAsset;
  checksums?: ReleaseAsset;
  message?: string;
}

type GithubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

export function githubReleaseToUpdate(
  current: string,
  platform: string,
  json: GithubRelease,
): AppUpdate {
  const latest = typeof json.tag_name === "string" ? json.tag_name : "";
  if (!latest) {
    return {
      status: "unavailable",
      current,
      message: "The latest GitHub release has no version tag.",
    };
  }
  const assets = Array.isArray(json.assets)
    ? json.assets.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const rec = row as { name?: unknown; browser_download_url?: unknown };
        if (typeof rec.name !== "string" || typeof rec.browser_download_url !== "string") return [];
        return [{ name: rec.name, url: rec.browser_download_url }];
      })
    : [];
  const htmlUrl = typeof json.html_url === "string" ? json.html_url : undefined;
  const name = typeof json.name === "string" ? json.name : latest;
  const notes = typeof json.body === "string" ? json.body : undefined;
  const newer = isNewerVersion(latest, current);
  return {
    status: newer ? "available" : "up-to-date",
    current,
    latest,
    name,
    notes,
    htmlUrl,
    asset: pickReleaseAsset(assets, platform),
    checksums: pickChecksumsAsset(assets, platform),
  };
}

export async function downloadAndVerifyUpdate(opts: {
  asset: ReleaseAsset;
  checksums: ReleaseAsset;
  destDir: string;
  fetchFn?: typeof fetch;
}): Promise<{ path: string; sha256: string; verified: true }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sumsRes = await fetchFn(opts.checksums.url);
  if (!sumsRes.ok) throw new Error(`Could not download ${opts.checksums.name}`);
  const sums = await sumsRes.text();
  const expected = checksumLineFor(sums, opts.asset.name);
  if (!expected) throw new Error(`${opts.asset.name} is not in ${opts.checksums.name}`);
  const fileRes = await fetchFn(opts.asset.url);
  if (!fileRes.ok) throw new Error(`Could not download ${opts.asset.name}`);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  if (sha256 !== expected) throw new Error("SHA-256 did not match SHA256SUMS");
  await mkdir(opts.destDir, { recursive: true, mode: 0o700 });
  const dest = join(opts.destDir, opts.asset.name);
  await writeFile(dest, buf, { mode: 0o700 });
  return { path: dest, sha256, verified: true };
}

export function openVerifiedUpdate(path: string, platform = process.platform): void {
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? path : "xdg-open";
  const args = platform === "win32" ? [] : [path];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

export async function checkGithubRelease(opts: {
  current: string;
  platform: string;
  fetchFn?: typeof fetch;
  userAgent?: string;
}): Promise<AppUpdate> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(LOCUS_RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": opts.userAgent ?? `Locus/${opts.current}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) {
      return {
        status: "unavailable",
        current: opts.current,
        htmlUrl: LOCUS_RELEASES_URL,
        message:
          "No GitHub release found yet. Check for updates works after a v* tag is published.",
      };
    }
    if (!res.ok) {
      return {
        status: "unavailable",
        current: opts.current,
        message: `GitHub releases returned HTTP ${res.status}.`,
      };
    }
    const json = (await res.json()) as GithubRelease;
    return githubReleaseToUpdate(opts.current, opts.platform, json);
  } catch (err) {
    return {
      status: "unavailable",
      current: opts.current,
      message: err instanceof Error ? err.message : "Could not reach GitHub releases.",
    };
  }
}

const CHECK_TTL_MS = 60 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 10 * 60 * 1000;

/**
 * Cache GitHub release checks so the desktop's background check, Settings → About, the
 * phone and the CLI share one request an hour (GitHub allows 60 unauthenticated per hour).
 */
export class UpdateChecker {
  private cache = new Map<string, { at: number; result: AppUpdate }>();

  constructor(
    private readonly check: typeof checkGithubRelease = checkGithubRelease,
    private readonly now: () => number = Date.now,
  ) {}

  async get(opts: {
    current: string;
    platform: string;
    fetchFn?: typeof fetch;
    refresh?: boolean;
  }): Promise<AppUpdate & { checkedAt: string }> {
    const key = `${opts.platform}:${opts.current}`;
    const hit = this.cache.get(key);
    if (hit && !opts.refresh) {
      const ttl = hit.result.status === "unavailable" ? UNAVAILABLE_TTL_MS : CHECK_TTL_MS;
      if (this.now() - hit.at < ttl)
        return { ...hit.result, checkedAt: new Date(hit.at).toISOString() };
    }
    const result = await this.check({
      current: opts.current,
      platform: opts.platform,
      fetchFn: opts.fetchFn,
    });
    const at = this.now();
    this.cache.set(key, { at, result });
    return { ...result, checkedAt: new Date(at).toISOString() };
  }
}

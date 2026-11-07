export const LOCUS_GITHUB_OWNER = "Modsofthenation";
export const LOCUS_GITHUB_REPO = "Locus";
export const LOCUS_GITHUB_URL = `https://github.com/${LOCUS_GITHUB_OWNER}/${LOCUS_GITHUB_REPO}`;
export const LOCUS_RELEASES_URL = `${LOCUS_GITHUB_URL}/releases`;
export const LOCUS_RELEASES_API_URL = `https://api.github.com/repos/${LOCUS_GITHUB_OWNER}/${LOCUS_GITHUB_REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  url: string;
}

/** Numeric parts of a `v0.4.2` / `0.4.2` tag. Extra labels (`-beta.1`) are ignored. */
export function parseVersionTag(tag: string): number[] {
  const core = tag.trim().replace(/^v/i, "").split("-")[0] ?? "";
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Negative if `a` is older than `b`, zero if equal, positive if `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersionTag(a);
  const right = parseVersionTag(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export function pickReleaseAsset(
  assets: ReleaseAsset[],
  platform: string,
): ReleaseAsset | undefined {
  const names = assets.filter((row) => row.name && row.url);
  if (platform === "darwin") {
    return names.find((row) => /\.dmg$/i.test(row.name) && !/blockmap/i.test(row.name));
  }
  if (platform === "win32") {
    return names.find((row) => /\.exe$/i.test(row.name) && !/blockmap/i.test(row.name));
  }
  return names.find((row) => /\.AppImage$/i.test(row.name));
}

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
  arch: string = process.arch,
): ReleaseAsset | undefined {
  const names = assets.filter((row) => row.name && row.url && !/blockmap/i.test(row.name));
  const preferArm = arch === "arm64";
  const ranked = (rows: ReleaseAsset[]) => {
    if (!rows.length) return undefined;
    const arm = rows.filter((row) => /arm64|aarch64/i.test(row.name));
    const rest = rows.filter((row) => !/arm64|aarch64/i.test(row.name));
    return preferArm ? (arm[0] ?? rest[0]) : (rest[0] ?? arm[0]);
  };
  if (platform === "darwin") {
    return ranked(names.filter((row) => /\.dmg$/i.test(row.name)));
  }
  if (platform === "win32") {
    return ranked(names.filter((row) => /\.exe$/i.test(row.name)));
  }
  return (
    ranked(names.filter((row) => /\.AppImage$/i.test(row.name))) ??
    ranked(names.filter((row) => /\.deb$/i.test(row.name))) ??
    ranked(names.filter((row) => /\.rpm$/i.test(row.name)))
  );
}

export function pickChecksumsAsset(
  assets: ReleaseAsset[],
  platform: string,
): ReleaseAsset | undefined {
  const names = assets.filter((row) => row.name && row.url);
  const want =
    platform === "darwin"
      ? /^SHA256SUMS-macos$/i
      : platform === "win32"
        ? /^SHA256SUMS-windows$/i
        : /^SHA256SUMS-linux$/i;
  return names.find((row) => want.test(row.name));
}

export function checksumLineFor(sumFile: string, fileName: string): string | undefined {
  for (const line of sumFile.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+(\S+)$/.exec(line.trim());
    const hex = match?.[1];
    if (match && hex && match[2] === fileName) return hex.toLowerCase();
  }
  return undefined;
}

import {
  LOCUS_RELEASES_API_URL,
  LOCUS_RELEASES_URL,
  isNewerVersion,
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
  };
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

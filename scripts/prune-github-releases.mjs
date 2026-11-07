import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DEFAULT_KEEP = 3;

/**
 * GitHub lists releases newest-first. Keep the newest `keep` non-draft
 * releases and return the rest (oldest published installers to delete).
 */
export function pickReleasesToDelete(releases, keep = DEFAULT_KEEP) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("keep must be a positive integer");
  }
  return releases.filter((row) => row && row.draft !== true).slice(keep);
}

async function githubJson(url, token, method = "GET") {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "locus-prune-github-releases",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (method === "DELETE" && (res.status === 204 || res.status === 404)) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${method} ${url} → HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function pruneGithubReleases(opts) {
  const keep = opts.keep ?? DEFAULT_KEEP;
  const token = opts.token;
  const repo = opts.repo;
  const fetchJson = opts.fetchJson ?? githubJson;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!repo || !repo.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");

  const releases = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await fetchJson(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    releases.push(...batch);
    if (batch.length < 100) break;
  }

  const toDelete = pickReleasesToDelete(releases, keep);
  const deleted = [];
  for (const rel of toDelete) {
    const id = rel.id;
    const tag = typeof rel.tag_name === "string" ? rel.tag_name : String(id);
    if (typeof id !== "number") throw new Error(`release ${tag} has no numeric id`);
    process.stdout.write(`Deleting GitHub Release ${tag}\n`);
    await fetchJson(`https://api.github.com/repos/${repo}/releases/${id}`, token, "DELETE");
    deleted.push(tag);
  }
  const published = releases.filter((row) => row && row.draft !== true).length;
  process.stdout.write(
    `Kept ${Math.min(keep, published)} of ${published} published releases; deleted ${deleted.length}.\n`,
  );
  return { deleted, published, keep };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  await pruneGithubReleases({
    keep: Number(process.env.KEEP_RELEASES ?? DEFAULT_KEEP),
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
  });
}

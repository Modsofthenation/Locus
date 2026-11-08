import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { cloudImageFor, VIRTIO_ISO, type GuestOs } from "@locus/shared";

type MediaItem = { name: string; url: string; filename: string };

const USER_AGENT = "Locus/0.1 (+https://github.com/Modsofthenation/Locus)";
const MAX_REDIRECTS = 8;
const RETRY_CODES = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
]);

type DownloadRequestOptions = http.RequestOptions & { autoSelectFamily?: boolean };

export function downloadConnectOptions(family: 4 | 6): DownloadRequestOptions {
  return {
    method: "GET",
    family,
    // Node 20+ Happy Eyeballs still races AAAA records unless family is pinned.
    autoSelectFamily: false,
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
  };
}

export function wrapDownloadError(err: unknown): Error {
  if (err instanceof Error && err.message.startsWith("Download failed:")) return err;
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  const detail = [code, message]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(": ");
  return new Error(`Download failed: ${detail || "fetch failed"}`, { cause: err });
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: string; cause?: { code?: string }; errors?: Array<{ code?: string }> };
  if (e.code) return e.code;
  if (e.cause?.code) return e.cause.code;
  const nested = e.errors?.map((item) => item.code).filter(Boolean);
  return nested?.length ? nested.join(",") : undefined;
}

function isRetryable(err: unknown): boolean {
  const code = errorCode(err);
  if (!code) return false;
  return code.split(",").some((part) => RETRY_CODES.has(part));
}

function combineFamilyErrors(ipv4Err: unknown, ipv6Err: unknown): Error {
  const ipv4 = wrapDownloadError(ipv4Err).message.replace(/^Download failed: /, "");
  const ipv6 = wrapDownloadError(ipv6Err).message.replace(/^Download failed: /, "");
  return new Error(`Download failed: IPv4 ${ipv4}; IPv6 ${ipv6}`, { cause: ipv4Err });
}

export async function downloadToFile(url: string, dest: string): Promise<void> {
  try {
    await downloadOnce(url, dest, 4);
  } catch (err) {
    if (isRetryable(err)) {
      try {
        await downloadOnce(url, dest, 6);
        return;
      } catch (retryErr) {
        throw combineFamilyErrors(err, retryErr);
      }
    }
    throw wrapDownloadError(err);
  }
}

async function downloadOnce(
  url: string,
  dest: string,
  family: 4 | 6,
  redirects = 0,
): Promise<void> {
  if (redirects > MAX_REDIRECTS) throw new Error("Download failed: too many redirects");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Download failed: unsupported URL ${parsed.protocol}`);
  }
  const tmp = `${dest}.part`;

  try {
    await new Promise<void>((resolve, reject) => {
      const transport = parsed.protocol === "https:" ? https.request : http.request;
      const req = transport(parsed, downloadConnectOptions(family), (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          const next = new URL(location, url).toString();
          res.resume();
          downloadOnce(next, dest, family, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${status}`));
          return;
        }
        const out = createWriteStream(tmp, { mode: 0o600 });
        pipeline(res, out)
          .then(() => rename(tmp, dest))
          .then(() => resolve())
          .catch(reject);
      });
      req.on("timeout", () => req.destroy(new Error("Download failed: connection timed out")));
      req.on("error", reject);
      req.setTimeout(60_000);
      req.end();
    });
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

async function saveMedia(
  dataDir: string,
  item: MediaItem,
): Promise<{ path: string; url: string; name: string }> {
  const dir = join(dataDir, "media");
  await mkdir(dir, { recursive: true });
  const dest = join(dir, item.filename);
  await downloadToFile(item.url, dest);
  return { path: dest, url: item.url, name: item.name };
}

export async function fetchCloudImage(
  dataDir: string,
  os: GuestOs,
): Promise<{ path: string; url: string; name: string }> {
  const item = cloudImageFor(os);
  if (!item) throw new Error(`No cloud image catalog entry for ${os}`);
  return saveMedia(dataDir, item);
}

export async function fetchVirtioIso(
  dataDir: string,
): Promise<{ path: string; url: string; name: string }> {
  return saveMedia(dataDir, VIRTIO_ISO);
}

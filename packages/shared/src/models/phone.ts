import { isLoopbackHost } from "../security.js";
import { parseWorkerFingerprint } from "./worker.js";

export const PHONE_COOKIE = "locus_phone";

export interface PhoneRemote {
  enabled: boolean;
  token?: string;
}

export function phoneListenHost(enabled: boolean, bindHost = "127.0.0.1"): string {
  return enabled ? "0.0.0.0" : bindHost || "127.0.0.1";
}

/** RFC1918, Tailscale CGNAT, and IPv6 unique-local / link-local. Not the public internet. */
export function isLanPeerHost(host: string): boolean {
  const hostname = stripIpv4Mapped(host);
  if (!hostname || isLoopbackHost(hostname)) return false;
  if (hostname.includes(":")) return isPrivateV6(hostname);
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Tailscale MagicDNS names. TCP peers are still IPs; this is for Origin / typed hosts. */
export function isTailscaleMagicDns(host: string): boolean {
  const hostname = stripIpv4Mapped(host);
  return (
    hostname === "ts.net" ||
    hostname.endsWith(".ts.net") ||
    hostname === "tailscale.net" ||
    hostname.endsWith(".tailscale.net")
  );
}

/** Hosts the Android app may open with a pairing token. Not loopback (that is the phone). */
export function isPhonePairingHost(host: string): boolean {
  return isLanPeerHost(host) || isTailscaleMagicDns(host);
}

export function isLanOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isLoopbackHost(parsed.hostname) || isPhonePairingHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function pairingHttpUrl(address: string, port: number, token: string): string {
  const host = address.includes(":") ? `[${address}]` : address;
  const params = new URLSearchParams({ token });
  return `http://${host}:${port}/?${params.toString()}`;
}

export function pairingHttpsUrl(
  address: string,
  port: number,
  token: string,
  fingerprint?: string,
): string {
  const host = address.includes(":") ? `[${address}]` : address;
  const params = new URLSearchParams({ token });
  const fp = pairingFingerprintParam(fingerprint);
  if (fp) params.set("fp", fp);
  return `https://${host}:${port}/?${params.toString()}`;
}

export function pairingAppUrl(
  address: string,
  port: number,
  token: string,
  fingerprint?: string,
): string {
  const params = new URLSearchParams({ host: address, port: String(port), token });
  const fp = pairingFingerprintParam(fingerprint);
  if (fp) params.set("fp", fp);
  return `locus://pair?${params.toString()}`;
}

function pairingFingerprintParam(fingerprint?: string): string | undefined {
  const parsed = parseWorkerFingerprint(fingerprint);
  return parsed ? parsed.slice("sha256:".length) : undefined;
}

/** Prefer Wi-Fi / RFC1918, then Tailscale, and deprioritize typical Docker bridges. */
export function preferredPairingLink<T extends { address: string }>(links: T[]): T | undefined {
  if (!links.length) return undefined;
  return [...links].sort(
    (a, b) => pairingAddressRank(a.address) - pairingAddressRank(b.address),
  )[0];
}

export function pairingAddressRank(address: string): number {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.startsWith("192.168.")) return 0;
  if (host.startsWith("10.")) return 1;
  if (host.startsWith("100.")) return 2;
  if (host === "172.17.0.1" || host === "172.18.0.1") return 9;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 3;
  if (host.includes(":")) return 8;
  return 7;
}

export function formatPhoneToken(token: string): string {
  const raw = token.replace(/^ph_/i, "").replace(/[^0-9a-f]/gi, "");
  const groups = raw.match(/.{1,4}/g) ?? [raw];
  return groups.join("-").toUpperCase();
}

function stripIpv4Mapped(host: string): string {
  const hostname = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (hostname.startsWith("::ffff:")) return hostname.slice("::ffff:".length);
  return hostname;
}

function isPrivateV6(hostname: string): boolean {
  if (hostname === "::1") return false;
  if (hostname.startsWith("fe80:")) return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  return false;
}

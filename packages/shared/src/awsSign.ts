import { createHash, createHmac } from "node:crypto";
import { awsSigningRegion, awsSigningService, type AwsSigV4Credentials } from "./awsEndpoint.js";

export type AwsV4SignInput = {
  method: string;
  url: string;
  region: string;
  service: string;
  payload: string;
  accessKeyId: string;
  secret: string;
  sessionToken?: string;
  extra?: Record<string, string>;
  now?: Date;
};

/** SigV4 headers for a single AWS request. No SDK. */
export function signAwsV4(input: AwsV4SignInput): Record<string, string> {
  const parsed = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(input.payload);
  const headers: Record<string, string> = {
    host: parsed.host,
    "x-amz-date": amzDate,
    ...(input.extra ?? {}),
  };
  const sessionToken = input.sessionToken?.trim();
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  const signedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join("");
  const signedHeaders = signedNames.join(";");
  const canonical = [
    input.method,
    parsed.pathname || "/",
    parsed.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secret}`, dateStamp), input.region), input.service),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function signedAwsHeaders(input: {
  method: string;
  url: string;
  payload: string;
  creds: AwsSigV4Credentials;
  nativeService: string;
  extra?: Record<string, string>;
  now?: Date;
}): Record<string, string> {
  return signAwsV4({
    method: input.method,
    url: input.url,
    region: awsSigningRegion(input.url, input.nativeService, input.creds.region),
    service: awsSigningService(input.url, input.nativeService),
    payload: input.payload,
    accessKeyId: input.creds.accessKeyId,
    secret: input.creds.secretAccessKey,
    sessionToken: input.creds.sessionToken,
    extra: input.extra,
    now: input.now,
  });
}

/** Overlay SigV4 on a fetch init. Drops Bearer so AWS IAM auth is the only Authorization. */
export function applyAwsSigV4Headers(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } | undefined,
  creds: AwsSigV4Credentials,
  nativeService: string,
  now?: Date,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(init?.headers ?? {})) {
    if (key.toLowerCase() === "authorization") continue;
    extra[key] = value;
  }
  return signedAwsHeaders({
    method: (init?.method ?? "GET").toUpperCase(),
    url,
    payload: init?.body ?? "",
    creds,
    nativeService,
    extra,
    now,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

import {
  isLoopbackHost,
  awsQueryResult,
  awsSigningRegion,
  awsSigningService,
  awsXmlError,
  parseAwsXml,
  resolveAwsServiceUrl,
} from "@locus/shared";
import { signAwsV4 } from "@locus/shared/awsSign";
import type { IntegrationAccount } from "@locus/shared";

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
};

const IMDS_HOST = "169.254.169.254";
const ECS_HOST = "169.254.170.2";
const CREDENTIAL_TIMEOUT_MS = 2_000;
const STS_VERSION = "2011-06-15";

export async function resolveAwsCredentials(
  account: IntegrationAccount,
  fetchFn: typeof fetch,
  env: NodeJS.Dict<string> = process.env,
): Promise<AwsCredentials> {
  const region =
    account.region?.trim() ||
    env.AWS_REGION?.trim() ||
    env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1";
  let creds: AwsCredentials | undefined;
  if (account.accessKeyId?.trim() && account.token?.trim()) {
    creds = {
      accessKeyId: account.accessKeyId.trim(),
      secretAccessKey: account.token.trim(),
      sessionToken: account.sessionToken?.trim() || undefined,
      region,
    };
  } else if (account.useInstanceMetadata) {
    creds = await loadInstanceMetadataCredentials(fetchFn, env, region);
  }
  if (!creds) {
    throw new Error(
      "Add an AWS access key in Settings → Integrations, or enable instance metadata (IMDS)",
    );
  }
  const roleArn = account.roleArn?.trim();
  if (!roleArn) return creds;
  return assumeRole(fetchFn, creds, roleArn, account);
}

export function iamEndpointUrl(
  account: Pick<IntegrationAccount, "baseUrl" | "gatewayUrl" | "region">,
): string {
  return resolveAwsServiceUrl({
    service: "iam",
    region: account.region?.trim() || "us-east-1",
    overrideUrl: account.baseUrl,
    gatewayUrl: account.gatewayUrl,
  });
}

export function stsEndpointUrl(
  account: Pick<IntegrationAccount, "stsUrl" | "gatewayUrl" | "region">,
  region: string,
): string {
  return resolveAwsServiceUrl({
    service: "sts",
    region,
    overrideUrl: account.stsUrl,
    gatewayUrl: account.gatewayUrl,
  });
}

export async function awsQuery(input: {
  fetchFn: typeof fetch;
  creds: AwsCredentials;
  service: "iam" | "sts";
  url: string;
  action: string;
  version: string;
  params?: Record<string, string>;
}): Promise<unknown> {
  const body = new URLSearchParams({
    Action: input.action,
    Version: input.version,
    ...(input.params ?? {}),
  }).toString();
  const url = input.url;
  const headers = signAwsV4({
    method: "POST",
    url,
    region: awsSigningRegion(url, input.service, input.creds.region),
    service: awsSigningService(url, input.service),
    payload: body,
    accessKeyId: input.creds.accessKeyId,
    secret: input.creds.secretAccessKey,
    sessionToken: input.creds.sessionToken,
    extra: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
  });
  const res = await input.fetchFn(url, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(awsXmlError(text, input.action, res.status));
  return parseAwsXml(text);
}

async function assumeRole(
  fetchFn: typeof fetch,
  creds: AwsCredentials,
  roleArn: string,
  account: IntegrationAccount,
): Promise<AwsCredentials> {
  const body = await awsQuery({
    fetchFn,
    creds,
    service: "sts",
    url: stsEndpointUrl(account, creds.region),
    action: "AssumeRole",
    version: STS_VERSION,
    params: { RoleArn: roleArn, RoleSessionName: "locus" },
  });
  const result = awsQueryResult(body, "AssumeRole") as {
    Credentials?: {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      SessionToken?: string;
    };
  };
  const next = result.Credentials;
  if (!next?.AccessKeyId || !next.SecretAccessKey) {
    throw new Error("AWS AssumeRole did not return credentials");
  }
  return {
    accessKeyId: next.AccessKeyId,
    secretAccessKey: next.SecretAccessKey,
    sessionToken: next.SessionToken,
    region: creds.region,
  };
}

async function loadInstanceMetadataCredentials(
  fetchFn: typeof fetch,
  env: NodeJS.Dict<string>,
  region: string,
): Promise<AwsCredentials> {
  const fromEnv = envCredentials(env, region);
  if (fromEnv) return fromEnv;
  if (
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim() ||
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim()
  ) {
    const ecs = await ecsCredentials(fetchFn, env, region);
    if (!ecs) {
      throw new Error("AWS container credentials URI did not return credentials");
    }
    return ecs;
  }
  return imdsCredentials(fetchFn, region);
}

function envCredentials(env: NodeJS.Dict<string>, region: string): AwsCredentials | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return undefined;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    region,
  };
}

async function ecsCredentials(
  fetchFn: typeof fetch,
  env: NodeJS.Dict<string>,
  region: string,
): Promise<AwsCredentials | undefined> {
  const full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim();
  const relative = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim();
  const url =
    full ||
    (relative ? `http://${ECS_HOST}${relative.startsWith("/") ? relative : `/${relative}`}` : "");
  if (!url) return undefined;
  assertCredentialUrl(url);
  const headers: Record<string, string> = {};
  const token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN?.trim();
  if (token) headers.Authorization = token;
  return fetchJsonCredentials(fetchFn, url, headers, region);
}

async function imdsCredentials(fetchFn: typeof fetch, region: string): Promise<AwsCredentials> {
  const tokenRes = await credentialFetch(fetchFn, `http://${IMDS_HOST}/latest/api/token`, {
    method: "PUT",
    headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
  });
  if (!tokenRes.ok) {
    throw new Error(
      `IMDS token failed (${tokenRes.status}). Enable instance metadata or paste an access key.`,
    );
  }
  const token = (await tokenRes.text()).trim();
  if (!token) throw new Error("IMDS returned an empty session token");
  const listRes = await credentialFetch(
    fetchFn,
    `http://${IMDS_HOST}/latest/meta-data/iam/security-credentials/`,
    { headers: { "X-aws-ec2-metadata-token": token } },
  );
  if (!listRes.ok) {
    throw new Error(
      `IMDS role list failed (${listRes.status}). This host has no instance profile, or IMDS is off.`,
    );
  }
  const role = (await listRes.text()).trim().split(/\s+/)[0] ?? "";
  if (!role) throw new Error("IMDS listed no IAM role");
  return fetchJsonCredentials(
    fetchFn,
    `http://${IMDS_HOST}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`,
    { "X-aws-ec2-metadata-token": token },
    region,
  );
}

async function fetchJsonCredentials(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  region: string,
): Promise<AwsCredentials> {
  const res = await credentialFetch(fetchFn, url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Instance metadata credentials failed (${res.status})`);
  let parsed: {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    Token?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("Instance metadata did not return JSON credentials");
  }
  if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
    throw new Error("Instance metadata JSON was missing AccessKeyId");
  }
  return {
    accessKeyId: parsed.AccessKeyId,
    secretAccessKey: parsed.SecretAccessKey,
    sessionToken: parsed.Token,
    region,
  };
}

function assertCredentialUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("AWS container credentials URI is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AWS container credentials URI must be http(s)");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === IMDS_HOST || host === ECS_HOST || isLoopbackHost(host)) return;
  throw new Error("AWS container credentials URI host is not instance metadata");
}

async function credentialFetch(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchFn(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
  });
}

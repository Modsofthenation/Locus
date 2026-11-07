import { invalidHttpUrl, isLoopbackHost } from "./security.js";

export type AwsQueryService = "iam" | "sts" | "ecs";

export type AwsSigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
};

export type UnwrappedAwsApiGatewayWebhook = {
  raw: string;
  contentType?: string;
  headers: Record<string, string>;
  requestTime?: string;
};

const IAM_DEFAULT_HOST = "iam.amazonaws.com";

export function defaultAwsServiceUrl(service: AwsQueryService, region: string): string {
  const trimmed = region.trim() || "us-east-1";
  if (service === "iam") {
    if (trimmed.startsWith("cn-")) return "https://iam.amazonaws.com.cn/";
    return "https://iam.amazonaws.com/";
  }
  if (service === "sts") {
    if (trimmed.startsWith("cn-")) return `https://sts.${trimmed}.amazonaws.com.cn/`;
    if (trimmed.startsWith("us-gov-")) return `https://sts.${trimmed}.amazonaws.com/`;
    return `https://sts.${trimmed}.amazonaws.com/`;
  }
  if (trimmed.startsWith("cn-")) return `https://ecs.${trimmed}.amazonaws.com.cn/`;
  if (trimmed.startsWith("us-gov-")) return `https://ecs.${trimmed}.amazonaws.com/`;
  return `https://ecs.${trimmed}.amazonaws.com/`;
}

export function iamSigningRegion(host: string): string {
  const lower = host.toLowerCase();
  if (lower.includes("us-gov")) return "us-gov-west-1";
  if (lower.endsWith(".amazonaws.com.cn") || lower.includes(".cn-")) return "cn-north-1";
  return "us-east-1";
}

export function isAwsApiGatewayHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower.includes(".execute-api.") || lower.includes(".execute-api-");
}

export function awsSigningService(url: string, nativeService: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (isAwsApiGatewayHost(host)) return "execute-api";
    if (host.includes("bedrock")) return nativeService.trim() || "bedrock";
  } catch {
    /* keep native */
  }
  return nativeService.trim() || "execute-api";
}

export function awsSigningRegion(url: string, nativeService: string, fallback: string): string {
  const region = fallback.trim() || "us-east-1";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return nativeService === "iam" ? iamSigningRegion(host || IAM_DEFAULT_HOST) : region;
  }
  const execute = host.match(/\.execute-api\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
  if (execute?.[1]) return execute[1];
  const vpce = host.match(/\.([a-z]{2}(?:-[a-z0-9]+)+-\d)\.vpce\.amazonaws\.com(?:\.cn)?$/);
  if (vpce?.[1]) return vpce[1];
  const regional = host.match(
    /^(?:[a-z0-9-]+\.)+([a-z]{2}(?:-[a-z0-9]+)+-\d)\.amazonaws\.com(?:\.cn)?$/,
  );
  if (regional?.[1]) return regional[1];
  if (nativeService === "iam") return iamSigningRegion(host);
  return region;
}

export function canonicalizeAwsEndpointUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  parsed.hash = "";
  const href = parsed.toString();
  return href.endsWith("/") && parsed.pathname === "/" ? href : href.replace(/\/+$/, "");
}

export function isDefaultAwsServiceUrl(
  raw: string | undefined,
  service: AwsQueryService,
  region: string,
): boolean {
  if (!raw?.trim()) return true;
  try {
    const actual = new URL(canonicalizeAwsEndpointUrl(raw));
    const expected = new URL(defaultAwsServiceUrl(service, region));
    const actualPath = actual.pathname === "" ? "/" : actual.pathname;
    const expectedPath = expected.pathname === "" ? "/" : expected.pathname;
    return (
      actual.hostname.toLowerCase() === expected.hostname.toLowerCase() &&
      actualPath === expectedPath &&
      !actual.search
    );
  } catch {
    return false;
  }
}

export function resolveAwsServiceUrl(input: {
  service: AwsQueryService;
  region: string;
  overrideUrl?: string;
  gatewayUrl?: string;
}): string {
  const region = input.region.trim() || "us-east-1";
  const override = input.overrideUrl?.trim();
  if (override && !isDefaultAwsServiceUrl(override, input.service, region)) {
    return canonicalizeAwsEndpointUrl(override);
  }
  const gateway = input.gatewayUrl?.trim();
  if (gateway) return canonicalizeAwsEndpointUrl(gateway);
  if (override) return canonicalizeAwsEndpointUrl(override);
  return canonicalizeAwsEndpointUrl(defaultAwsServiceUrl(input.service, region));
}

export function awsEndpointUrlError(raw: string | undefined, label: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const error = invalidHttpUrl(raw.trim(), label);
  if (error) return error;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
      return `${label} must be https`;
    }
  } catch {
    return `${label} is not a valid URL`;
  }
  return undefined;
}

export function providerLooksLikeAws(provider: { baseUrl?: string; name?: string }): boolean {
  if (provider.name?.trim().toLowerCase() === "amazon bedrock") return true;
  const base = provider.baseUrl?.trim();
  if (!base) return false;
  try {
    const host = new URL(base).hostname.toLowerCase();
    return (
      isAwsApiGatewayHost(host) ||
      host.includes("bedrock") ||
      host.includes(".vpce.amazonaws.com") ||
      host.endsWith(".amazonaws.com") ||
      host.endsWith(".amazonaws.com.cn")
    );
  } catch {
    return false;
  }
}

export function providerUsesAwsSigV4(provider: {
  baseUrl?: string;
  name?: string;
  accessKeyId?: string;
}): boolean {
  return Boolean(provider.accessKeyId?.trim()) && providerLooksLikeAws(provider);
}

export function providerAwsService(provider: { baseUrl?: string; name?: string }): string {
  try {
    const host = new URL(provider.baseUrl ?? "").hostname.toLowerCase();
    if (host.includes("bedrock")) return "bedrock";
    if (isAwsApiGatewayHost(host)) return "execute-api";
  } catch {
    /* default */
  }
  if (provider.name?.trim().toLowerCase() === "amazon bedrock") return "bedrock";
  return "execute-api";
}

export function awsCredentialsFromEnv(
  env: Record<string, string>,
  fallbackRegion = "us-east-1",
): AwsSigV4Credentials | undefined {
  const accessKeyId = (env.AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY)?.trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_KEY)?.trim();
  if (!accessKeyId || !secretAccessKey) return undefined;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    region: env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || fallbackRegion,
  };
}

export function mcpAwsService(url: string, env: Record<string, string>): string {
  const override = env.AWS_SIGV4?.trim() || env.AWS_SERVICE?.trim();
  if (override) return override;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("bedrock")) return "bedrock";
    if (isAwsApiGatewayHost(host)) return "execute-api";
  } catch {
    /* default */
  }
  return "execute-api";
}

function lowerHeaders(headers: unknown, multi?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (key: unknown, value: unknown) => {
    if (typeof key !== "string" || !key.trim()) return;
    const name = key.toLowerCase();
    if (typeof value === "string" && value && out[name] == null) out[name] = value;
    if (Array.isArray(value) && typeof value[0] === "string" && out[name] == null) {
      out[name] = value[0];
    }
  };
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) take(key, value);
  }
  if (multi && typeof multi === "object" && !Array.isArray(multi)) {
    for (const [key, value] of Object.entries(multi as Record<string, unknown>)) take(key, value);
  }
  return out;
}

export function isAwsApiGatewayEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const ctx = row.requestContext;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return false;
  const context = ctx as Record<string, unknown>;
  if (
    row.version === "2.0" &&
    (typeof row.rawPath === "string" || typeof row.routeKey === "string")
  ) {
    return true;
  }
  if (typeof context.apiId === "string") return true;
  if (typeof context.resourceId === "string") return true;
  if (context.http && typeof context.http === "object") return true;
  return false;
}

function requestTimeSeconds(event: Record<string, unknown>): string | undefined {
  const ctx =
    event.requestContext && typeof event.requestContext === "object"
      ? (event.requestContext as Record<string, unknown>)
      : undefined;
  const raw = ctx?.timeEpoch ?? ctx?.requestTimeEpoch;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const seconds = raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  return String(seconds);
}

function decodeGatewayBody(event: Record<string, unknown>): string {
  const body = event.body;
  if (body == null) return "";
  const encoded = typeof body === "string" ? body : JSON.stringify(body);
  if (event.isBase64Encoded === true && typeof body === "string") {
    return Buffer.from(body, "base64").toString("utf8");
  }
  return encoded;
}

/** If the POST is an API Gateway REST/HTTP proxy event, return the inner body and headers. */
export function unwrapAwsApiGatewayWebhook(
  raw: string,
  contentType?: string,
): UnwrappedAwsApiGatewayWebhook {
  const trimmed = raw.trim();
  if (!trimmed) return { raw, contentType, headers: {} };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isAwsApiGatewayEvent(parsed)) return { raw, contentType, headers: {} };
    const headers = lowerHeaders(parsed.headers, parsed.multiValueHeaders);
    return {
      raw: decodeGatewayBody(parsed),
      contentType: headers["content-type"] || contentType,
      headers,
      requestTime: requestTimeSeconds(parsed),
    };
  } catch {
    return { raw, contentType, headers: {} };
  }
}

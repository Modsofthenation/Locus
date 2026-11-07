import { awsQueryResult, encodeIntegrationJson, type IntegrationAccount } from "@locus/shared";
import {
  awsQuery,
  iamEndpointUrl,
  resolveAwsCredentials,
  stsEndpointUrl,
  type AwsCredentials,
} from "./awsCredentials.js";

const IAM_VERSION = "2010-05-08";
const STS_VERSION = "2011-06-15";

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function splitList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((row) => row.trim())
        .filter(Boolean),
    ),
  ];
}

function memberParams(key: string, values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  values.forEach((value, i) => {
    out[`${key}.member.${i + 1}`] = value;
  });
  return out;
}

function maxItems(args: Record<string, unknown>): string {
  const raw = args.max_items ?? args.maxItems ?? args.MaxItems;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 20;
  if (!Number.isFinite(n) || n <= 0) return "20";
  return String(Math.min(100, Math.floor(n)));
}

export async function callAwsIam(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; output: string }> {
  const creds = await resolveAwsCredentials(account, fetchFn);
  if (name === "aws_sts_identity") {
    const body = await awsQuery({
      fetchFn,
      creds,
      service: "sts",
      url: stsEndpointUrl(account, creds.region),
      action: "GetCallerIdentity",
      version: STS_VERSION,
    });
    return { ok: true, output: encodeIntegrationJson(awsQueryResult(body, "GetCallerIdentity")) };
  }
  if (name === "aws_iam_list") return listIam(args, account, creds, fetchFn);
  if (name === "aws_iam_get") return getIam(args, account, creds, fetchFn);
  if (name === "aws_iam_simulate") return simulateIam(args, account, creds, fetchFn);
  return { ok: false, output: `Unknown AWS tool ${name}` };
}

async function iam(
  account: IntegrationAccount,
  creds: AwsCredentials,
  fetchFn: typeof fetch,
  action: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const body = await awsQuery({
    fetchFn,
    creds,
    service: "iam",
    url: iamEndpointUrl(account),
    action,
    version: IAM_VERSION,
    params,
  });
  return awsQueryResult(body, action);
}

async function listIam(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  creds: AwsCredentials,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; output: string }> {
  const resource = (str(args, "resource") || "user").toLowerCase();
  const params: Record<string, string> = { MaxItems: maxItems(args) };
  const prefix = str(args, "path_prefix") || str(args, "PathPrefix");
  const marker = str(args, "marker") || str(args, "Marker");
  if (prefix) params.PathPrefix = prefix;
  if (marker) params.Marker = marker;
  if (resource === "role") {
    return {
      ok: true,
      output: encodeIntegrationJson(await iam(account, creds, fetchFn, "ListRoles", params)),
    };
  }
  if (resource === "policy" || resource === "policies") {
    params.Scope = "All";
    return {
      ok: true,
      output: encodeIntegrationJson(await iam(account, creds, fetchFn, "ListPolicies", params)),
    };
  }
  if (resource !== "user" && resource !== "users") {
    return { ok: false, output: "resource must be user, role, or policy" };
  }
  return {
    ok: true,
    output: encodeIntegrationJson(await iam(account, creds, fetchFn, "ListUsers", params)),
  };
}

async function getIam(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  creds: AwsCredentials,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; output: string }> {
  const resource = str(args, "resource").toLowerCase();
  const name = str(args, "name") || str(args, "arn") || str(args, "user") || str(args, "role");
  if (!resource) return { ok: false, output: "resource is required" };
  if (!name) return { ok: false, output: "name or arn is required" };
  if (resource === "user") {
    return {
      ok: true,
      output: encodeIntegrationJson(
        await iam(account, creds, fetchFn, "GetUser", { UserName: name }),
      ),
    };
  }
  if (resource === "role") {
    return {
      ok: true,
      output: encodeIntegrationJson(
        await iam(account, creds, fetchFn, "GetRole", { RoleName: name }),
      ),
    };
  }
  if (resource === "attached_role_policies" || resource === "attached-role-policies") {
    return {
      ok: true,
      output: encodeIntegrationJson(
        await iam(account, creds, fetchFn, "ListAttachedRolePolicies", { RoleName: name }),
      ),
    };
  }
  if (resource === "policy") {
    const arn = name.startsWith("arn:") ? name : "";
    if (!arn) return { ok: false, output: "policy arn is required" };
    return {
      ok: true,
      output: encodeIntegrationJson(
        await iam(account, creds, fetchFn, "GetPolicy", { PolicyArn: arn }),
      ),
    };
  }
  return { ok: false, output: "resource must be user, role, policy, or attached_role_policies" };
}

async function simulateIam(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  creds: AwsCredentials,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; output: string }> {
  const principal = str(args, "principal") || str(args, "PolicySourceArn");
  const actionsRaw = args.actions ?? args.action ?? args.ActionNames;
  const actions = Array.isArray(actionsRaw)
    ? actionsRaw.filter((row): row is string => typeof row === "string").map((row) => row.trim())
    : splitList(typeof actionsRaw === "string" ? actionsRaw : "");
  if (!principal) return { ok: false, output: "principal is required" };
  if (!actions.length) return { ok: false, output: "actions is required" };
  const resourcesRaw = args.resources ?? args.resource ?? args.ResourceArns;
  const resources = Array.isArray(resourcesRaw)
    ? resourcesRaw.filter((row): row is string => typeof row === "string").map((row) => row.trim())
    : splitList(typeof resourcesRaw === "string" ? resourcesRaw : "");
  const params = {
    PolicySourceArn: principal,
    ...memberParams("ActionNames", actions),
    ...(resources.length ? memberParams("ResourceArns", resources) : {}),
  };
  return {
    ok: true,
    output: encodeIntegrationJson(
      await iam(account, creds, fetchFn, "SimulatePrincipalPolicy", params),
    ),
  };
}

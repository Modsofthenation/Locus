import { describe, expect, it } from "vitest";
import { IntegrationsClient } from "./integrations.js";
import type { IntegrationAccount } from "@locus/shared";

const keys: IntegrationAccount = {
  id: "a1",
  kind: "aws",
  name: "AWS IAM",
  enabled: true,
  baseUrl: "https://iam.amazonaws.com",
  accessKeyId: "AKIATEST",
  token: "secret",
  region: "us-east-1",
};

function identityXml(): string {
  return `<?xml version="1.0"?>
    <GetCallerIdentityResponse>
      <GetCallerIdentityResult>
        <Arn>arn:aws:iam::123:user/alice</Arn>
        <UserId>AIDA</UserId>
        <Account>123</Account>
      </GetCallerIdentityResult>
    </GetCallerIdentityResponse>`;
}

function listUsersXml(): string {
  return `<ListUsersResponse>
    <ListUsersResult>
      <Users>
        <member><UserName>alice</UserName><Arn>arn:aws:iam::123:user/alice</Arn></member>
      </Users>
      <IsTruncated>false</IsTruncated>
    </ListUsersResult>
  </ListUsersResponse>`;
}

const AWS_ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
] as const;

function withCleanAwsEnv(run: () => Promise<void>): Promise<void> {
  const prev = Object.fromEntries(AWS_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AWS_ENV_KEYS) delete process.env[key];
  return run().finally(() => {
    for (const key of AWS_ENV_KEYS) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe("AWS IAM integration", () => {
  it("returns caller identity with SigV4", async () => {
    const calls: Array<{ url: string; auth: string | null; token: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        auth: headers.get("authorization"),
        token: headers.get("x-amz-security-token"),
      });
      expect(headers.get("content-type")).toContain("application/x-www-form-urlencoded");
      expect(String(init?.body)).toContain("Action=GetCallerIdentity");
      return new Response(identityXml());
    });
    const result = await client.call("aws_sts_identity", {}, [keys]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("arn:aws:iam::123:user/alice");
    expect(calls[0]?.url).toBe("https://sts.us-east-1.amazonaws.com/");
    expect(calls[0]?.auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(calls[0]?.token).toBeNull();
  });

  it("posts IAM through a gateway path and signs execute-api", async () => {
    const calls: Array<{ url: string; auth: string }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization") ?? "",
      });
      return new Response(listUsersXml());
    });
    const result = await client.call("aws_iam_list", { resource: "user" }, [
      {
        ...keys,
        gatewayUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://abc.execute-api.us-east-1.amazonaws.com/prod");
    expect(calls[0]?.auth).toContain("/execute-api/");
  });

  it("keeps a custom IAM path instead of the gateway", async () => {
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url) => {
      urls.push(String(url));
      return new Response(listUsersXml());
    });
    const result = await client.call("aws_iam_list", { resource: "user" }, [
      {
        ...keys,
        baseUrl: "https://vpce-1.iam.amazonaws.com/custom",
        gatewayUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(urls[0]).toBe("https://vpce-1.iam.amazonaws.com/custom");
  });

  it("sends STS identity to a custom STS endpoint", async () => {
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url) => {
      urls.push(String(url));
      return new Response(identityXml());
    });
    const result = await client.call("aws_sts_identity", {}, [
      { ...keys, stsUrl: "https://vpce-9.sts.us-east-1.vpce.amazonaws.com" },
    ]);
    expect(result.ok).toBe(true);
    expect(urls[0]).toBe("https://vpce-9.sts.us-east-1.vpce.amazonaws.com/");
  });

  it("lists IAM users", async () => {
    const bodies: string[] = [];
    const client = new IntegrationsClient(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(listUsersXml());
    });
    const result = await client.call("aws_iam_list", { resource: "user" }, [keys]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("alice");
    expect(bodies[0]).toContain("Action=ListUsers");
    expect(bodies[0]).toContain("MaxItems=20");
  });

  it("gets a role and simulates access", async () => {
    const actions: string[] = [];
    const client = new IntegrationsClient(async (_url, init) => {
      const body = String(init?.body);
      const action = /Action=([^&]+)/.exec(body)?.[1] ?? "";
      actions.push(action);
      if (action === "GetRole") {
        return new Response(
          `<GetRoleResponse><GetRoleResult><Role><RoleName>ops</RoleName><Arn>arn:aws:iam::123:role/ops</Arn></Role></GetRoleResult></GetRoleResponse>`,
        );
      }
      return new Response(
        `<SimulatePrincipalPolicyResponse><SimulatePrincipalPolicyResult><EvaluationResults>
          <member><EvalActionName>s3:GetObject</EvalActionName><EvalDecision>allowed</EvalDecision></member>
        </EvaluationResults></SimulatePrincipalPolicyResult></SimulatePrincipalPolicyResponse>`,
      );
    });
    const got = await client.call("aws_iam_get", { resource: "role", name: "ops" }, [keys]);
    expect(got.ok).toBe(true);
    expect(got.output).toContain("ops");
    const simulated = await client.call(
      "aws_iam_simulate",
      { principal: "arn:aws:iam::123:role/ops", actions: "s3:GetObject" },
      [keys],
    );
    expect(simulated.ok).toBe(true);
    expect(simulated.output).toContain("allowed");
    expect(actions).toEqual(["GetRole", "SimulatePrincipalPolicy"]);
  });

  it("loads IMDS credentials when enabled and no access key is pasted", async () => {
    await withCleanAwsEnv(async () => {
      const urls: string[] = [];
      const client = new IntegrationsClient(async (url, init) => {
        const href = String(url);
        urls.push(href);
        if (href.endsWith("/latest/api/token") && init?.method === "PUT") {
          return new Response("imds-token");
        }
        if (href.endsWith("/security-credentials/")) {
          return new Response("locus-role");
        }
        if (href.endsWith("/security-credentials/locus-role")) {
          return new Response(
            JSON.stringify({
              AccessKeyId: "ASIATEST",
              SecretAccessKey: "imds-secret",
              Token: "imds-session",
            }),
          );
        }
        const headers = new Headers(init?.headers);
        expect(headers.get("x-amz-security-token")).toBe("imds-session");
        expect(headers.get("authorization")).toContain("ASIATEST");
        return new Response(identityXml());
      });
      const result = await client.call("aws_sts_identity", {}, [
        {
          id: "a1",
          kind: "aws",
          name: "AWS IAM",
          enabled: true,
          baseUrl: "https://iam.amazonaws.com",
          useInstanceMetadata: true,
        },
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("alice");
      expect(urls[0]).toBe("http://169.254.169.254/latest/api/token");
    });
  });

  it("refuses an ECS credentials URI that is not instance metadata", async () => {
    await withCleanAwsEnv(async () => {
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = "https://evil.example/creds";
      const client = new IntegrationsClient(async () => new Response("no"));
      const result = await client.call("aws_sts_identity", {}, [
        {
          id: "a1",
          kind: "aws",
          name: "AWS IAM",
          enabled: true,
          baseUrl: "https://iam.amazonaws.com",
          useInstanceMetadata: true,
        },
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/not instance metadata/);
    });
  });

  it("assumes a role before calling IAM", async () => {
    const actions: string[] = [];
    const client = new IntegrationsClient(async (url, init) => {
      const body = String(init?.body);
      const action = /Action=([^&]+)/.exec(body)?.[1] ?? "";
      actions.push(action);
      if (action === "AssumeRole") {
        expect(String(url)).toContain("sts.us-east-1.amazonaws.com");
        expect(body).toContain("RoleArn=arn%3Aaws%3Aiam%3A%3A123%3Arole%2FLocus");
        return new Response(
          `<AssumeRoleResponse><AssumeRoleResult><Credentials>
            <AccessKeyId>ASIAASSUMED</AccessKeyId>
            <SecretAccessKey>assumed-secret</SecretAccessKey>
            <SessionToken>assumed-session</SessionToken>
          </Credentials></AssumeRoleResult></AssumeRoleResponse>`,
        );
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toContain("ASIAASSUMED");
      expect(headers.get("x-amz-security-token")).toBe("assumed-session");
      return new Response(identityXml());
    });
    const result = await client.call("aws_sts_identity", {}, [
      { ...keys, roleArn: "arn:aws:iam::123:role/Locus" },
    ]);
    expect(result.ok).toBe(true);
    expect(actions).toEqual(["AssumeRole", "GetCallerIdentity"]);
  });

  it("asks for keys when AWS is enabled without IMDS", async () => {
    const client = new IntegrationsClient(async () => new Response("no"));
    const result = await client.call("aws_sts_identity", {}, [
      {
        id: "a1",
        kind: "aws",
        name: "AWS IAM",
        enabled: true,
        baseUrl: "https://iam.amazonaws.com",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/aws token/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  awsCredentialsFromEnv,
  awsSigningRegion,
  awsSigningService,
  canonicalizeAwsEndpointUrl,
  defaultAwsServiceUrl,
  isAwsApiGatewayEvent,
  isDefaultAwsServiceUrl,
  mcpAwsService,
  providerLooksLikeAws,
  providerUsesAwsSigV4,
  resolveAwsServiceUrl,
  unwrapAwsApiGatewayWebhook,
} from "./awsEndpoint.js";
import { applyAwsSigV4Headers } from "./awsSign.js";

describe("AWS endpoint resolution", () => {
  it("keeps IAM and STS defaults, then a gateway, then an override path", () => {
    expect(defaultAwsServiceUrl("iam", "us-east-1")).toBe("https://iam.amazonaws.com/");
    expect(defaultAwsServiceUrl("sts", "eu-west-1")).toBe("https://sts.eu-west-1.amazonaws.com/");
    expect(isDefaultAwsServiceUrl("https://iam.amazonaws.com", "iam", "us-east-1")).toBe(true);
    expect(
      resolveAwsServiceUrl({
        service: "iam",
        region: "us-east-1",
        overrideUrl: "https://iam.amazonaws.com",
        gatewayUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod",
      }),
    ).toBe("https://abc.execute-api.us-east-1.amazonaws.com/prod");
    expect(
      resolveAwsServiceUrl({
        service: "iam",
        region: "us-east-1",
        overrideUrl: "https://vpce-1.iam.amazonaws.com/custom",
        gatewayUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod",
      }),
    ).toBe("https://vpce-1.iam.amazonaws.com/custom");
    expect(
      resolveAwsServiceUrl({
        service: "sts",
        region: "us-west-2",
        gatewayUrl: "https://abc.execute-api.us-west-2.amazonaws.com/prod/sts",
      }),
    ).toBe("https://abc.execute-api.us-west-2.amazonaws.com/prod/sts");
    expect(canonicalizeAwsEndpointUrl("vpce-9.iam.amazonaws.com")).toBe(
      "https://vpce-9.iam.amazonaws.com/",
    );
  });

  it("signs execute-api hosts as execute-api in the URL's region", () => {
    const gw = "https://abc.execute-api.eu-west-1.amazonaws.com/prod/iam";
    expect(awsSigningService(gw, "iam")).toBe("execute-api");
    expect(awsSigningRegion(gw, "iam", "us-east-1")).toBe("eu-west-1");
    expect(awsSigningService("https://iam.amazonaws.com/", "iam")).toBe("iam");
    expect(
      awsSigningRegion(
        "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1",
        "bedrock",
        "us-east-1",
      ),
    ).toBe("us-west-2");
    expect(
      awsSigningRegion("https://vpce-1.iam.us-east-2.vpce.amazonaws.com", "iam", "us-east-1"),
    ).toBe("us-east-2");
  });
});

describe("provider and MCP SigV4", () => {
  it("only signs OpenAI-compatible providers that look like AWS and have an access key id", () => {
    expect(
      providerLooksLikeAws({
        name: "Custom",
        baseUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod/v1",
      }),
    ).toBe(true);
    expect(
      providerUsesAwsSigV4({
        name: "Custom",
        baseUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod/v1",
        accessKeyId: "AKIATEST",
      }),
    ).toBe(true);
    expect(
      providerUsesAwsSigV4({
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        accessKeyId: "AKIATEST",
      }),
    ).toBe(false);
    expect(
      providerLooksLikeAws({
        name: "Amazon Bedrock",
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
      }),
    ).toBe(true);
  });

  it("reads MCP keys from env and overlays SigV4 on fetch headers", () => {
    expect(
      awsCredentialsFromEnv({
        AWS_ACCESS_KEY_ID: "AKIATEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "us-west-2",
      }),
    ).toEqual({
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      sessionToken: undefined,
      region: "us-west-2",
    });
    expect(mcpAwsService("https://abc.execute-api.us-east-1.amazonaws.com/mcp", {})).toBe(
      "execute-api",
    );
    expect(mcpAwsService("https://mcp.example/sse", { AWS_SIGV4: "lambda" })).toBe("lambda");
    const headers = applyAwsSigV4Headers(
      "https://abc.execute-api.us-east-1.amazonaws.com/prod/mcp",
      {
        method: "POST",
        headers: {
          authorization: "Bearer leftover",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: '{"jsonrpc":"2.0"}',
      },
      {
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        region: "us-east-1",
      },
      "execute-api",
      new Date("2026-01-02T03:04:05.000Z"),
    );
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260102\/us-east-1\/execute-api\/aws4_request/,
    );
    expect(headers.authorization).not.toContain("Bearer");
    expect(headers.accept).toBe("application/json, text/event-stream");
  });
});

describe("API Gateway webhook unwrap", () => {
  it("unwraps HTTP API v2 and REST proxy events, and leaves Slack JSON alone", () => {
    expect(isAwsApiGatewayEvent({ type: "event_callback", event: { type: "message" } })).toBe(
      false,
    );
    const httpApi = unwrapAwsApiGatewayWebhook(
      JSON.stringify({
        version: "2.0",
        routeKey: "POST /api/hooks/automations/{id}",
        rawPath: "/api/hooks/automations/a1",
        headers: { "x-locus-secret": "from-event", "content-type": "application/json" },
        requestContext: { apiId: "abc", timeEpoch: 1_767_000_000_000 },
        body: JSON.stringify({ text: "via gateway" }),
        isBase64Encoded: false,
      }),
    );
    expect(JSON.parse(httpApi.raw)).toEqual({ text: "via gateway" });
    expect(httpApi.headers["x-locus-secret"]).toBe("from-event");
    expect(httpApi.requestTime).toBe("1767000000");

    const rest = unwrapAwsApiGatewayWebhook(
      JSON.stringify({
        httpMethod: "POST",
        headers: { "X-Api-Key": "from-rest" },
        requestContext: { apiId: "xyz", resourceId: "res", requestTimeEpoch: 1_767_000_001_000 },
        body: Buffer.from(JSON.stringify({ text: "rest" }), "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );
    expect(JSON.parse(rest.raw)).toEqual({ text: "rest" });
    expect(rest.headers["x-api-key"]).toBe("from-rest");
    expect(rest.requestTime).toBe("1767000001");

    const passthrough = unwrapAwsApiGatewayWebhook(JSON.stringify({ text: "direct" }));
    expect(passthrough.raw).toBe(JSON.stringify({ text: "direct" }));
    expect(passthrough.headers).toEqual({});
  });
});

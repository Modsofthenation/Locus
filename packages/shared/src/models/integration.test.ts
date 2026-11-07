import { describe, expect, it } from "vitest";
import {
  awsCredentialReady,
  integrationHasToken,
  kubernetesReady,
  parseIntegrationAccount,
} from "./integration.js";

describe("AWS IAM account", () => {
  it("parses keys, role, and IMDS", () => {
    const parsed = parseIntegrationAccount({
      id: "a1",
      kind: "aws",
      name: "AWS IAM",
      enabled: true,
      baseUrl: "https://iam.amazonaws.com",
      accessKeyId: "AKIATEST",
      token: "secret",
      sessionToken: "sess",
      region: "eu-west-1",
      roleArn: "arn:aws:iam::123:role/Locus",
      useInstanceMetadata: true,
      stsUrl: "https://vpce-1.sts.eu-west-1.vpce.amazonaws.com",
      gatewayUrl: "https://abc.execute-api.eu-west-1.amazonaws.com/prod",
    });
    expect(parsed).toMatchObject({
      kind: "aws",
      accessKeyId: "AKIATEST",
      token: "secret",
      sessionToken: "sess",
      region: "eu-west-1",
      roleArn: "arn:aws:iam::123:role/Locus",
      useInstanceMetadata: true,
      stsUrl: "https://vpce-1.sts.eu-west-1.vpce.amazonaws.com",
      gatewayUrl: "https://abc.execute-api.eu-west-1.amazonaws.com/prod",
    });
    expect(awsCredentialReady(parsed!)).toBe(true);
    expect(integrationHasToken(parsed!)).toBe(true);
  });

  it("is ready from IMDS without a pasted key", () => {
    const parsed = parseIntegrationAccount({
      id: "a1",
      kind: "aws",
      name: "AWS IAM",
      enabled: true,
      baseUrl: "https://iam.amazonaws.com",
      useInstanceMetadata: true,
    });
    expect(parsed?.token).toBeUndefined();
    expect(awsCredentialReady(parsed!)).toBe(true);
    expect(
      awsCredentialReady({
        kind: "aws",
        enabled: true,
        accessKeyId: "AKIATEST",
        token: "secret",
      }),
    ).toBe(true);
    expect(awsCredentialReady({ kind: "aws", enabled: true, token: "secret" })).toBe(false);
  });
});

describe("Kubernetes account", () => {
  it("is ready from a bearer token or loopback kubectl proxy", () => {
    const remote = parseIntegrationAccount({
      id: "k1",
      kind: "kubernetes",
      name: "Kubernetes",
      enabled: true,
      baseUrl: "https://k8s.example.com",
      token: "s.token",
    });
    expect(kubernetesReady(remote!)).toBe(true);
    expect(integrationHasToken(remote!)).toBe(true);
    expect(
      kubernetesReady({
        kind: "kubernetes",
        enabled: true,
        baseUrl: "http://127.0.0.1:8001",
      }),
    ).toBe(true);
    expect(
      kubernetesReady({
        kind: "kubernetes",
        enabled: true,
        baseUrl: "https://k8s.example.com",
      }),
    ).toBe(false);
  });
});

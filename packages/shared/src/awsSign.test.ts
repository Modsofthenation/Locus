import { describe, expect, it } from "vitest";
import { signAwsV4 } from "./awsSign.js";

describe("signAwsV4", () => {
  const now = new Date("2026-01-02T03:04:05.000Z");

  it("signs a POST with a stable frozen clock", () => {
    const headers = signAwsV4({
      method: "POST",
      url: "https://iam.amazonaws.com/",
      region: "us-east-1",
      service: "iam",
      payload: "Action=ListUsers&Version=2010-05-08",
      accessKeyId: "AKIATEST",
      secret: "secret",
      extra: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      now,
    });
    expect(headers.host).toBe("iam.amazonaws.com");
    expect(headers["x-amz-date"]).toBe("20260102T030405Z");
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260102\/us-east-1\/iam\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    const again = signAwsV4({
      method: "POST",
      url: "https://iam.amazonaws.com/",
      region: "us-east-1",
      service: "iam",
      payload: "Action=ListUsers&Version=2010-05-08",
      accessKeyId: "AKIATEST",
      secret: "secret",
      extra: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      now,
    });
    expect(again.authorization).toBe(headers.authorization);
  });

  it("includes a session token in signed headers", () => {
    const headers = signAwsV4({
      method: "POST",
      url: "https://sts.us-east-1.amazonaws.com/",
      region: "us-east-1",
      service: "sts",
      payload: "Action=GetCallerIdentity&Version=2011-06-15",
      accessKeyId: "ASIATEST",
      secret: "secret",
      sessionToken: "session",
      extra: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      now,
    });
    expect(headers["x-amz-security-token"]).toBe("session");
    expect(headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token",
    );
  });
});

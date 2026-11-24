import { describe, expect, it } from "vitest";
import { bitbucketAuthHeaders } from "./forgeHttp.js";

const base = {
  id: "bb",
  kind: "bitbucket" as const,
  name: "Bitbucket",
  apiBaseUrl: "https://api.bitbucket.org/2.0",
};
const decode = (header?: string) =>
  Buffer.from((header ?? "").replace(/^Basic /, ""), "base64").toString();

describe("bitbucketAuthHeaders", () => {
  it("uses Bearer for access and OAuth tokens", () => {
    expect(bitbucketAuthHeaders({ ...base, token: "ATCTT3x" }).authorization).toBe(
      "Bearer ATCTT3x",
    );
    expect(bitbucketAuthHeaders({ ...base, token: "oauth" }).authorization).toBe("Bearer oauth");
  });

  it("uses Basic email:token for Atlassian API tokens", () => {
    const header = bitbucketAuthHeaders({
      ...base,
      token: "ATATT3x",
      username: "dev@corp.example",
    });
    expect(decode(header.authorization)).toBe("dev@corp.example:ATATT3x");
  });

  it("uses Basic username:password for app passwords", () => {
    const header = bitbucketAuthHeaders({ ...base, token: "ATBB1", username: "devname" });
    expect(decode(header.authorization)).toBe("devname:ATBB1");
  });

  it("falls back to Bearer when the API token has no email to pair with", () => {
    expect(
      bitbucketAuthHeaders({ ...base, token: "ATATT3x", username: "devname" }).authorization,
    ).toBe("Bearer ATATT3x");
  });
});

import { describe, expect, it } from "vitest";
import { formatRemoteError, isForgeAuthError } from "./remoteError.js";

const BITBUCKET =
  '{"type": "error", "error": {"message": "Token is invalid, expired, or not supported for this endpoint."}}';

describe("formatRemoteError", () => {
  it("extracts Bitbucket token JSON", () => {
    expect(formatRemoteError(BITBUCKET)).toBe(
      "Token is invalid, expired, or not supported for this endpoint.",
    );
    expect(
      formatRemoteError({
        type: "error",
        error: { message: "Token is invalid, expired, or not supported for this endpoint." },
      }),
    ).toBe("Token is invalid, expired, or not supported for this endpoint.");
  });

  it("unwraps a Locus { error } envelope that still holds JSON", () => {
    expect(formatRemoteError({ error: BITBUCKET })).toBe(
      "Token is invalid, expired, or not supported for this endpoint.",
    );
  });

  it("reads GitHub and GitLab shapes", () => {
    expect(formatRemoteError({ message: "Bad credentials" })).toBe("Bad credentials");
    expect(
      formatRemoteError({ error: "invalid_token", error_description: "The access token expired" }),
    ).toBe("The access token expired");
    expect(formatRemoteError({ error: "busy" })).toBe("busy");
  });

  it("keeps plain sentences and uses a fallback for empty blobs", () => {
    expect(formatRemoteError("inbox down")).toBe("inbox down");
    expect(formatRemoteError("", "HTTP 401")).toBe("HTTP 401");
    expect(formatRemoteError({ type: "error", error: {} }, "HTTP 400")).toBe("HTTP 400");
  });
});

describe("isForgeAuthError", () => {
  it("flags token and credential failures", () => {
    expect(isForgeAuthError("Token is invalid, expired, or not supported for this endpoint.")).toBe(
      true,
    );
    expect(isForgeAuthError("Bad credentials")).toBe(true);
    expect(isForgeAuthError("Could not link repo")).toBe(false);
  });
});

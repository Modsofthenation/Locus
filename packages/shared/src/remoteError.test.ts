import { describe, expect, it } from "vitest";
import {
  forgeAccessMessage,
  forgeAccessProblem,
  forgeRateLimitResetMinutes,
  formatRemoteError,
  isForgeAuthError,
} from "./remoteError.js";

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

describe("forgeAccessProblem", () => {
  it("round-trips the server's needs-token and rate-limit sentences", () => {
    const needs = forgeAccessMessage("GitHub", "needs_token");
    const limited = forgeAccessMessage("GitHub", "rate_limited");
    expect(forgeAccessProblem(needs)).toBe("needs_token");
    expect(forgeAccessProblem(limited)).toBe("rate_limited");
    expect(isForgeAuthError(needs)).toBe(true);
    expect(isForgeAuthError(limited)).toBe(true);
  });

  it("treats the legacy sign-in sentence as needs-token and ignores other errors", () => {
    expect(forgeAccessProblem("Sign in or add a GitHub token in Settings → Git")).toBe(
      "needs_token",
    );
    expect(forgeAccessProblem("HTTP 500")).toBeNull();
    expect(forgeAccessProblem(undefined)).toBeNull();
  });
});

describe("forgeRateLimitResetMinutes", () => {
  it("says when an anonymous rate limit resets and reads it back", () => {
    const now = Date.UTC(2026, 10, 13, 12, 0, 0);
    const limited = forgeAccessMessage("GitHub", "rate_limited", now + 22.5 * 60_000, now);
    expect(limited).toContain("Resets in 23 minutes.");
    expect(forgeAccessProblem(limited)).toBe("rate_limited");
    expect(forgeRateLimitResetMinutes(limited)).toBe(23);
    const unknown = forgeAccessMessage("GitHub", "rate_limited");
    expect(unknown).toContain("Try again later.");
    expect(forgeRateLimitResetMinutes(unknown)).toBeNull();
  });
});

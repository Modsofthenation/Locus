import { describe, expect, it } from "vitest";
import { parseIntegrationAccount } from "./integration.js";
import {
  GMAIL_OAUTH_SCOPES,
  GOOGLE_STATE_PREFIX,
  googleAccessToken,
  googleAuthorizeUrl,
  googleOauthCallbackUrl,
  googleOauthClientIdEnv,
  googleOauthScopes,
  googleTokenExpired,
  isGoogleIntegrationKind,
  isGoogleOauthState,
} from "./google.js";

describe("Google OAuth helpers", () => {
  it("builds an offline authorize URL and callback on loopback", () => {
    const url = googleAuthorizeUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: googleOauthCallbackUrl(7420),
      state: `${GOOGLE_STATE_PREFIX}abc`,
      scopes: googleOauthScopes("gmail"),
    });
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly"));
    expect(url).toContain(encodeURIComponent("http://127.0.0.1:7420/api/oauth/callback"));
    expect(GMAIL_OAUTH_SCOPES).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(googleOauthClientIdEnv()).toBe("LOCUS_GOOGLE_OAUTH_CLIENT_ID");
    expect(isGoogleOauthState("google.abc")).toBe(true);
    expect(isGoogleOauthState("slack.abc")).toBe(false);
    expect(isGoogleIntegrationKind("gmail")).toBe(true);
    expect(isGoogleIntegrationKind("gcal")).toBe(true);
    expect(isGoogleIntegrationKind("gdrive")).toBe(true);
    expect(isGoogleIntegrationKind("slack")).toBe(false);
  });

  it("prefers the access token and treats expiry as stale", () => {
    expect(googleAccessToken({ token: "ya29.a", userToken: "ya29.b" })).toBe("ya29.a");
    expect(googleAccessToken({ userToken: "ya29.b" })).toBe("ya29.b");
    expect(googleTokenExpired({ tokenExpiresAt: Date.now() - 1_000 })).toBe(true);
    expect(googleTokenExpired({ tokenExpiresAt: Date.now() + 60_000 })).toBe(false);
    expect(googleTokenExpired({})).toBe(false);
  });

  it("parses a Gmail OAuth account including refresh token", () => {
    const account = parseIntegrationAccount({
      id: "gm1",
      kind: "gmail",
      name: "Gmail",
      enabled: true,
      baseUrl: "https://gmail.googleapis.com",
      token: "ya29.a",
      refreshToken: "1//r",
      tokenExpiresAt: 1_700_000_000_000,
      oauthClientId: "cid",
      userName: "you@acme.com",
      authMethod: "oauth",
    });
    expect(account?.refreshToken).toBe("1//r");
    expect(account?.tokenExpiresAt).toBe(1_700_000_000_000);
    expect(account?.userName).toBe("you@acme.com");
    expect(account?.authMethod).toBe("oauth");
  });
});

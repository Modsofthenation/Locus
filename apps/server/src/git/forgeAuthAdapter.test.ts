import { describe, expect, it } from "vitest";
import { forgeAuthAdapter } from "./forgeAuthAdapter.js";

describe("forgeAuthAdapter", () => {
  it("selects device vs redirect and whether a client secret is required", () => {
    expect(forgeAuthAdapter("github")).toMatchObject({
      method: "device",
      requiresClientSecret: false,
    });
    expect(forgeAuthAdapter("gitlab")).toMatchObject({
      method: "redirect",
      requiresClientSecret: true,
    });
    expect(forgeAuthAdapter("bitbucket")).toMatchObject({
      method: "redirect",
      requiresClientSecret: true,
    });
  });

  it("packages refresh bodies per kind", () => {
    const gh = forgeAuthAdapter("github").refreshTokenForm(
      "https://github.com",
      "id",
      "secret",
      "rt",
    );
    expect(gh.body).toMatchObject({
      grant_type: "refresh_token",
      client_id: "id",
      client_secret: "secret",
    });
    expect(gh.url).toBe("https://github.com/login/oauth/access_token");

    const gl = forgeAuthAdapter("gitlab").refreshTokenForm(
      "https://gitlab.com",
      "id",
      "secret",
      "rt",
    );
    expect(gl.body.client_id).toBe("id");
    expect(gl.headers.authorization).toBeUndefined();
    expect(gl.url).toBe("https://gitlab.com/oauth/token");

    const bb = forgeAuthAdapter("bitbucket").refreshTokenForm(
      "https://bitbucket.org",
      "id",
      "secret",
      "rt",
    );
    expect(bb.body.client_id).toBeUndefined();
    expect(bb.headers.authorization).toMatch(/^Basic /);
    expect(bb.url).toBe("https://bitbucket.org/site/oauth2/access_token");
  });

  it("packages code exchange for redirect forges", () => {
    const input = {
      origin: "https://gitlab.com",
      clientId: "id",
      clientSecret: "secret",
      code: "c",
      redirectUri: "http://127.0.0.1/cb",
      codeVerifier: "v",
    };
    const gl = forgeAuthAdapter("gitlab").exchangeCodeForm(input);
    expect(gl.body.client_id).toBe("id");
    expect(gl.body.client_secret).toBe("secret");
    const bb = forgeAuthAdapter("bitbucket").exchangeCodeForm({
      ...input,
      origin: "https://bitbucket.org",
    });
    expect(bb.body.client_id).toBeUndefined();
    expect(bb.headers.authorization).toMatch(/^Basic /);
  });

  it("sets GitHub username Accept without a Bitbucket URL branch", () => {
    const gh = forgeAuthAdapter("github");
    expect(gh.usernameUrl("https://api.github.com")).toBe("https://api.github.com/user");
    expect(gh.usernameHeaders("tok").accept).toBe("application/vnd.github+json");
    expect(forgeAuthAdapter("bitbucket").usernameUrl("https://api.bitbucket.org/2.0")).toBe(
      "https://api.bitbucket.org/2.0/user",
    );
  });
});

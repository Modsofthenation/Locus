import { describe, expect, it } from "vitest";
import {
  allowPhoneAccess,
  generatePhoneToken,
  operatorCookie,
  operatorCredentialFromHeaders,
  phoneCookie,
  tokenFromCookie,
  tokenFromHeaders,
} from "./phoneRemote.js";

describe("phone remote gate", () => {
  it("allows loopback with no pairing token", () => {
    expect(
      allowPhoneAccess({
        peer: "127.0.0.1",
        origin: "http://127.0.0.1:5173",
      }),
    ).toBe(true);
    expect(allowPhoneAccess({})).toBe(true);
  });

  it("rejects a public origin even from loopback", () => {
    expect(
      allowPhoneAccess({
        peer: "127.0.0.1",
        origin: "https://evil.example",
      }),
    ).toBe(false);
  });

  it("rejects LAN peers until pairing is enabled with a matching token", () => {
    const remote = { enabled: true, token: "ph_secret" };
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
      }),
    ).toBe(false);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        token: "nope",
        remote,
      }),
    ).toBe(false);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        token: "ph_secret",
        remote,
      }),
    ).toBe(true);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "https://192.168.1.8:7420",
        token: "ph_secret",
        remote,
      }),
    ).toBe(true);
  });

  it("lets a LAN phone load the UI without a cookie, but not /api or /ws", () => {
    const remote = { enabled: true, token: "ph_secret" };
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        remote,
        method: "GET",
        path: "/",
      }),
    ).toBe(true);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        remote,
        method: "GET",
        path: "/assets/app.js",
      }),
    ).toBe(true);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        remote,
        method: "GET",
        path: "/api/health",
      }),
    ).toBe(false);
    expect(
      allowPhoneAccess({
        peer: "192.168.1.20",
        origin: "http://192.168.1.8:7420",
        remote,
        method: "GET",
        path: "/ws",
      }),
    ).toBe(false);
  });

  it("allows a Tailscale MagicDNS origin from a CGNAT peer", () => {
    expect(
      allowPhoneAccess({
        peer: "100.64.1.2",
        origin: "http://desk.tail123.ts.net:7420",
        token: "ph_secret",
        remote: { enabled: true, token: "ph_secret" },
      }),
    ).toBe(true);
  });

  it("rejects the public internet even with a valid token", () => {
    expect(
      allowPhoneAccess({
        peer: "8.8.8.8",
        origin: "http://192.168.1.8:7420",
        token: "ph_secret",
        remote: { enabled: true, token: "ph_secret" },
      }),
    ).toBe(false);
  });

  it("reads the pairing cookie and generates unique tokens", () => {
    expect(tokenFromCookie("locus_phone=ph_abc; other=1")).toBe("ph_abc");
    expect(tokenFromHeaders({ cookie: "locus_phone=ph_abc" })).toBe("ph_abc");
    expect(tokenFromHeaders({ authorization: "Bearer ph_from_header" })).toBe("ph_from_header");
    expect(generatePhoneToken()).toMatch(/^ph_[0-9a-f]{32}$/);
    expect(generatePhoneToken()).not.toBe(generatePhoneToken());
  });

  it("marks the pairing cookie Secure on HTTPS", () => {
    expect(phoneCookie("ph_abc")).not.toMatch(/Secure/);
    expect(phoneCookie("ph_abc", true)).toMatch(/Secure/);
  });
});

describe("operator token gate", () => {
  const operatorToken = `op_${"c".repeat(64)}`;
  const base = { peer: "127.0.0.1", operatorToken };

  it("refuses loopback /api and /ws without the operator token", () => {
    expect(allowPhoneAccess({ ...base, path: "/api/sessions", method: "GET" })).toBe(false);
    expect(
      allowPhoneAccess({ ...base, origin: "http://127.0.0.1:7420", path: "/api/sessions" }),
    ).toBe(false);
    expect(allowPhoneAccess({ ...base, path: "/ws", method: "GET" })).toBe(false);
    expect(
      allowPhoneAccess({ ...base, path: "/api/sessions", operatorCredential: "op_wrong" }),
    ).toBe(false);
    // Unknown peer (no socket address) is not a free pass either.
    expect(
      allowPhoneAccess({ operatorToken, path: "/api/config", method: "GET", peer: undefined }),
    ).toBe(false);
  });

  it("allows loopback /api with the operator token", () => {
    expect(
      allowPhoneAccess({ ...base, path: "/api/sessions", operatorCredential: operatorToken }),
    ).toBe(true);
    expect(
      allowPhoneAccess({
        ...base,
        origin: "http://127.0.0.1:5173",
        path: "/ws",
        operatorCredential: operatorToken,
      }),
    ).toBe(true);
  });

  it("keeps the UI, health, webhooks, OAuth callback, /mcp and /play open on loopback", () => {
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/assets/index.js"],
      ["GET", "/api/health"],
      ["POST", "/api/hooks/automations/a1"],
      ["GET", "/api/oauth/callback"],
      ["POST", "/mcp"],
      ["POST", "/mcp/sessions/s1"],
      ["POST", "/play/tok/booth"],
    ] as const) {
      expect(allowPhoneAccess({ ...base, method, path }), `${method} ${path}`).toBe(true);
    }
  });

  it("lets canvas files through only on the canvas preview host", () => {
    const path = "/api/sessions/s1/canvas-files/index.html";
    expect(allowPhoneAccess({ ...base, path })).toBe(false);
    expect(allowPhoneAccess({ ...base, path, canvasPreviewHost: true })).toBe(true);
    expect(allowPhoneAccess({ ...base, path: "/api/sessions/s1", canvasPreviewHost: true })).toBe(
      false,
    );
  });

  it("still accepts a paired phone token from loopback", () => {
    const remote = { enabled: true, token: generatePhoneToken() };
    expect(allowPhoneAccess({ ...base, remote, token: remote.token, path: "/api/sessions" })).toBe(
      true,
    );
  });

  it("leaves loopback trusted when no operator token is configured", () => {
    expect(allowPhoneAccess({ peer: "127.0.0.1", path: "/api/sessions" })).toBe(true);
  });

  it("reads the credential from cookie, header, bearer, or query", () => {
    expect(
      operatorCredentialFromHeaders(
        new Headers({ cookie: `a=1; locus_operator=${operatorToken}` }),
      ),
    ).toBe(operatorToken);
    expect(operatorCredentialFromHeaders(new Headers({ "x-locus-operator": operatorToken }))).toBe(
      operatorToken,
    );
    expect(
      operatorCredentialFromHeaders(new Headers({ authorization: `Bearer ${operatorToken}` })),
    ).toBe(operatorToken);
    expect(operatorCredentialFromHeaders(new Headers(), `/ws?operator=${operatorToken}`)).toBe(
      operatorToken,
    );
    expect(operatorCredentialFromHeaders(new Headers())).toBeUndefined();
  });

  it("sets an HttpOnly SameSite=Strict cookie", () => {
    const cookie = operatorCookie(operatorToken);
    expect(cookie).toContain(`locus_operator=${operatorToken}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });
});

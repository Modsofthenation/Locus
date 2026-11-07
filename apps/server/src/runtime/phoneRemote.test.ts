import { describe, expect, it } from "vitest";
import {
  allowPhoneAccess,
  generatePhoneToken,
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

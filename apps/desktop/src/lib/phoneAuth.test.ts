import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPhoneAuth,
  initPhoneAuth,
  phoneAuthHeaders,
  phoneToken,
  withPhoneToken,
} from "./phoneAuth";

afterEach(() => {
  clearPhoneAuth();
  sessionStorage.clear();
});

describe("initPhoneAuth", () => {
  it("stores the pairing token and strips it from the address bar", () => {
    const replaceState = vi.fn();
    const storage = new Map<string, string>();
    initPhoneAuth(
      { pathname: "/", search: "?token=ph_secret&tab=phone", hash: "#agents" },
      { replaceState },
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
    );
    expect(phoneToken()).toBe("ph_secret");
    expect(phoneAuthHeaders()).toEqual({ authorization: "Bearer ph_secret" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?tab=phone#agents");
    expect(withPhoneToken("ws://192.168.0.155:7420/ws")).toBe(
      "ws://192.168.0.155:7420/ws?token=ph_secret",
    );
    expect(withPhoneToken("/api/sessions/s1/screenshots/shot.png")).toBe(
      "/api/sessions/s1/screenshots/shot.png?token=ph_secret",
    );
    expect(withPhoneToken("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("reloads a stored token when the query string is gone", () => {
    const storage = new Map<string, string>([["locus.phoneToken", "ph_saved"]]);
    initPhoneAuth(
      { pathname: "/", search: "", hash: "" },
      { replaceState: vi.fn() },
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
    );
    expect(phoneToken()).toBe("ph_saved");
    expect(withPhoneToken("ws://127.0.0.1:7420/ws")).toBe("ws://127.0.0.1:7420/ws?token=ph_saved");
  });
});

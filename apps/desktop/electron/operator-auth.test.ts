import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { isControlPlaneApiUrl, operatorCookies, operatorHeaders, readOperatorToken } = createRequire(
  import.meta.url,
)(join(desktopRoot, "electron/operator-auth.cjs")) as {
  isControlPlaneApiUrl: (url: string, origins: string[]) => boolean;
  operatorCookies: (
    token: string,
    urls: string[],
  ) => Array<{ url: string; name: string; value: string; httpOnly: boolean; sameSite: string }>;
  operatorHeaders: (token: string | undefined) => Record<string, string>;
  readOperatorToken: (
    home: string,
    env?: Record<string, string | undefined>,
    readFile?: (path: string, enc: string) => string,
  ) => string | undefined;
};

describe("operator auth (desktop)", () => {
  it("reads the token from env first, then <home>/operator.token", () => {
    expect(readOperatorToken("/h", { LOCUS_OPERATOR_TOKEN: " op_env " })).toBe("op_env");
    const read = (path: string) => {
      expect(path).toBe(join("/h", "operator.token"));
      return "op_file\n";
    };
    expect(readOperatorToken("/h", {}, read)).toBe("op_file");
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(readOperatorToken("/h", {}, missing)).toBeUndefined();
  });

  it("sets one HttpOnly strict cookie per loopback host, ignoring ports", () => {
    const cookies = operatorCookies("op_x", [
      "http://127.0.0.1:5173",
      "http://127.0.0.1:7420",
      "http://localhost:5173",
      "https://example.com",
    ]);
    expect(cookies.map((c) => c.url).sort()).toEqual(["http://127.0.0.1/", "http://localhost/"]);
    for (const cookie of cookies) {
      expect(cookie).toMatchObject({
        name: "locus_operator",
        value: "op_x",
        httpOnly: true,
        sameSite: "strict",
      });
    }
  });

  it("adds the header only when there is a token", () => {
    expect(operatorHeaders("op_x")).toEqual({ "x-locus-operator": "op_x" });
    expect(operatorHeaders(undefined)).toEqual({});
  });

  it("downloads control-plane /api links in-app instead of the system browser", () => {
    const origins = ["http://127.0.0.1:5173", "http://127.0.0.1:7420"];
    expect(
      isControlPlaneApiUrl("http://127.0.0.1:7420/api/sessions/s1/recordings/a.webm", origins),
    ).toBe(true);
    expect(isControlPlaneApiUrl("http://127.0.0.1:5173/api/sessions/s1/artifacts/x", origins)).toBe(
      true,
    );
    expect(isControlPlaneApiUrl("http://127.0.0.1:7420/play/tok/", origins)).toBe(false);
    expect(isControlPlaneApiUrl("http://127.0.0.1:3000/api/x", origins)).toBe(false);
    expect(isControlPlaneApiUrl("https://github.com/api/x", origins)).toBe(false);
    expect(isControlPlaneApiUrl("not a url", origins)).toBe(false);
  });
});

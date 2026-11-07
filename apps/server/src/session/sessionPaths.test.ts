import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { requireSafeSessionId, resolveSafeSessionFile } from "./sessionPaths.js";

describe("requireSafeSessionId", () => {
  it("accepts a plain id and rejects path escape", () => {
    expect(requireSafeSessionId("sess-1")).toBe("sess-1");
    expect(() => requireSafeSessionId("../escape")).toThrow(/Invalid session/);
    expect(() => requireSafeSessionId("a,b")).toThrow(/Invalid session/);
  });
});

describe("resolveSafeSessionFile", () => {
  it("keeps a leaf inside the session directory", () => {
    const dir = "/data/shots";
    expect(resolveSafeSessionFile(dir, "sess-1", "abc.png", "Invalid screenshot filename")).toBe(
      resolve(dir, "sess-1", "abc.png"),
    );
  });

  it("rejects escape, nested paths, and failed accept checks", () => {
    const dir = "/data/shots";
    expect(() =>
      resolveSafeSessionFile(dir, "../escape", "abc.png", "Invalid screenshot filename"),
    ).toThrow(/Invalid session/);
    expect(() =>
      resolveSafeSessionFile(dir, "sess-1", "../passwd", "Invalid screenshot filename"),
    ).toThrow(/Invalid screenshot filename/);
    expect(() =>
      resolveSafeSessionFile(dir, "sess-1", "abc.txt", "Invalid screenshot filename", (name) =>
        /\.png$/i.test(name),
      ),
    ).toThrow(/Invalid screenshot filename/);
  });
});

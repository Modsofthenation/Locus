import { describe, expect, it } from "vitest";
import { locusWindowTitle } from "./windowTitle";

describe("locusWindowTitle", () => {
  it("prefers Needs you, then unread, then the product name", () => {
    expect(locusWindowTitle({ needsYou: 0, unread: 0 })).toBe("Locus");
    expect(locusWindowTitle({ needsYou: 2, unread: 5 })).toBe("(2) Needs you · Locus");
    expect(locusWindowTitle({ needsYou: 0, unread: 3 })).toBe("(3) Locus");
  });
});

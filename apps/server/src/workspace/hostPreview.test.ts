import { describe, expect, it } from "vitest";
import { isLikelyHttpListenPort } from "./hostPreview.js";

describe("isLikelyHttpListenPort", () => {
  it("accepts common and ranged HTTP ports", () => {
    expect(isLikelyHttpListenPort(5173)).toBe(true);
    expect(isLikelyHttpListenPort(3000)).toBe(true);
    expect(isLikelyHttpListenPort(22)).toBe(false);
    expect(isLikelyHttpListenPort(53)).toBe(false);
  });
});

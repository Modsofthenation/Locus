import { describe, expect, it } from "vitest";
import { computerCapabilitiesResult } from "./computerCapabilities.js";

describe("computer capabilities", () => {
  it("shapes one CDP payload for Host and Docker adapters", () => {
    const result = computerCapabilitiesResult({
      browser: true,
      note: "Chromium must be installed; use a VM guest for native applications.",
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      backend: "cdp",
      browser: true,
      nativeDesktop: false,
      observation: ["browser_snapshot", "screenshot"],
      actions: ["browser_action", "browser_click", "browser_type", "key"],
      note: "Chromium must be installed; use a VM guest for native applications.",
    });
  });
});

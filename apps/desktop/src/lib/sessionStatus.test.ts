import { describe, expect, it } from "vitest";
import { sessionStatusLabel } from "./sessionStatus";

describe("sessionStatusLabel", () => {
  it("maps known statuses to a short word", () => {
    expect(sessionStatusLabel("idle")).toBe("Idle");
    expect(sessionStatusLabel("running")).toBe("Running");
    expect(sessionStatusLabel("needs-you")).toBe("Needs you");
    expect(sessionStatusLabel("provisioning")).toBe("Starting");
    expect(sessionStatusLabel(undefined)).toBe("Idle");
  });
});

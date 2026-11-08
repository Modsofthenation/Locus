import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEnvironmentName, defaultGoldenName, promptGoldenName } from "./goldenName";

describe("golden names", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the session title when present", () => {
    expect(defaultGoldenName("Fix login")).toBe("Fix login image");
    expect(defaultGoldenName("Web app", "workspace")).toBe("Web app image");
    expect(defaultGoldenName(undefined)).toBe("golden image");
    expect(defaultGoldenName("  ", "workspace")).toBe("workspace image");
    expect(defaultEnvironmentName("Setup environment · acme/app")).toBe(
      "Setup environment · acme/app env",
    );
    expect(defaultEnvironmentName()).toBe("product env");
    expect(
      defaultEnvironmentName(`Setup environment · ${"org/very-long-repo-name".repeat(4)}`).length,
    ).toBe(64);
  });

  it("prompts and keeps the fallback on a blank answer", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("nightly-node");
    expect(await promptGoldenName("Web app image")).toBe("nightly-node");
    vi.mocked(window.prompt).mockReturnValue("  ");
    expect(await promptGoldenName("Web app image")).toBe("Web app image");
    vi.mocked(window.prompt).mockReturnValue(null);
    expect(await promptGoldenName("Web app image")).toBeNull();
    vi.mocked(window.prompt).mockReturnValue(undefined as unknown as string);
    expect(await promptGoldenName("Web app image")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { setPendingSettingsQuery, takePendingSettingsQuery } from "./settingsQuery";

describe("pending settings query", () => {
  it("hands the palette query to Settings once", () => {
    setPendingSettingsQuery("  OpenAI  ");
    expect(takePendingSettingsQuery()).toBe("OpenAI");
    expect(takePendingSettingsQuery()).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { parseLocale, t } from "./i18n.js";

describe("i18n", () => {
  it("substitutes named placeholders from the English catalog", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("nope")).toBe("en");
    expect(t("empty.firstTask.cta")).toBe("Fill the composer");
    expect(t("usage.total", { total: "$1.00", llm: "$0.80", vm: "$0.20" })).toBe(
      "$1.00 total ($0.80 LLM · $0.20 VM)",
    );
    expect(t("missing.key")).toBe("missing.key");
  });
});

import { describe, expect, it } from "vitest";
import {
  isDefaultGuestPassword,
  LEGACY_LINUX_GUEST_PASSWORD,
  LEGACY_WINDOWS_GUEST_PASSWORD,
} from "@locus/shared";
import { builtinTemplates } from "./defaults.js";

describe("builtinTemplates", () => {
  it("does not plant well-known guest passwords by default", () => {
    for (const template of builtinTemplates()) {
      expect(isDefaultGuestPassword(template.cloudInit?.password)).toBe(false);
      expect(isDefaultGuestPassword(template.unattend?.password)).toBe(false);
    }
  });

  it("keeps legacy passwords only when tests opt in", () => {
    const templates = builtinTemplates({ randomPasswords: false });
    expect(templates[0]?.cloudInit?.password).toBe(LEGACY_LINUX_GUEST_PASSWORD);
    expect(templates.find((row) => row.os === "windows-11")?.unattend?.password).toBe(
      LEGACY_WINDOWS_GUEST_PASSWORD,
    );
  });
});

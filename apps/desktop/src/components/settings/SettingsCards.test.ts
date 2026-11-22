import { describe, expect, it } from "vitest";
import {
  cliAgentProviderFromPreset,
  isBuiltinTemplate,
  machineImageName,
  machineReady,
  machineStatusLabel,
} from "./SettingsCards";

describe("machine settings helpers", () => {
  it("treats shipped template ids as builtin", () => {
    expect(isBuiltinTemplate("ubuntu-24.04")).toBe(true);
    expect(isBuiltinTemplate("windows-11")).toBe(true);
    expect(isBuiltinTemplate("custom-1")).toBe(false);
  });

  it("reads the image filename and ready state from a path", () => {
    expect(machineImageName("/home/me/.locus/media/ubuntu-24.04-server-cloudimg-amd64.img")).toBe(
      "ubuntu-24.04-server-cloudimg-amd64.img",
    );
    expect(machineReady({ isoPath: "  /iso/ubuntu.img  " })).toBe(true);
    expect(machineReady({ isoPath: "   " })).toBe(false);
    expect(machineStatusLabel({ os: "ubuntu", isoPath: "/iso/ubuntu.img" })).toBe("ubuntu.img");
    expect(machineStatusLabel({ os: "debian", isoPath: "" })).toBe("Needs an image");
    expect(machineStatusLabel({ os: "windows-11", isoPath: "" })).toBe("Needs a licensed ISO");
  });
});

describe("Custom CLI agent presets", () => {
  it("builds an off, uniquely named cli-agent row from a preset", () => {
    const row = cliAgentProviderFromPreset("gemini", ["Gemini CLI"]);
    expect(row).toMatchObject({
      name: "Gemini CLI 2",
      kind: "cli-agent",
      enabled: false,
      defaultModel: "gemini-2.5-pro",
    });
    expect(row.cli?.command).toBe("gemini");
    expect(row.cli?.preset).toBe("gemini");
    const custom = cliAgentProviderFromPreset("nope", []);
    expect(custom.cli).toMatchObject({ command: "", preset: "custom" });
  });
});

import { describe, expect, it } from "vitest";
import {
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
    expect(machineStatusLabel({ os: "debian", isoPath: "" })).toBe("no image set - won't start");
    expect(machineStatusLabel({ os: "windows-11", isoPath: "" })).toBe("licensed ISO required");
  });
});

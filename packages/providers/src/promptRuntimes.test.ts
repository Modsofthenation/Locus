import { describe, expect, it } from "vitest";
import {
  machineLabel,
  promptIdentity,
  promptRuntime,
  promptWorkspace,
  workspaceToolingRules,
} from "./promptRuntimes.js";

describe("promptRuntime", () => {
  it("maps design, host, docker, and vm without nested flags", () => {
    expect(promptRuntime({ kind: "design", runtime: "host" })).toBe("design");
    expect(promptRuntime({ kind: "game", runtime: "host" })).toBe("game");
    expect(promptRuntime({ kind: "assets", runtime: "host" })).toBe("assets");
    expect(promptRuntime({ kind: "board", runtime: "host" })).toBe("board");
    expect(promptRuntime({ kind: "project", runtime: "host" })).toBe("project");
    expect(promptRuntime({ runtime: "host" })).toBe("host");
    expect(promptRuntime({ runtime: "docker" })).toBe("docker");
    expect(promptRuntime({ runtime: "vm" })).toBe("vm");
    expect(promptRuntime({})).toBe("vm");
  });

  it("labels the machine and identity copy from the runtime", () => {
    expect(machineLabel("board")).toBe("host");
    expect(promptIdentity("board")).toMatch(/Locus Board/);
    expect(machineLabel("project")).toBe("host");
    expect(promptIdentity("project")).toMatch(/coordinator/);
    expect(machineLabel("docker")).toBe("container");
    expect(machineLabel("host")).toBe("host");
    expect(machineLabel("vm")).toBe("guest VM");
    expect(promptIdentity("design")).toMatch(/Locus Design/);
    expect(promptIdentity("game")).toMatch(/Locus Games/);
    expect(promptIdentity("assets")).toMatch(/Locus Assets/);
    expect(promptWorkspace("game", { osLabel: "Ubuntu" })).toMatch(/playable HTML game/);
    expect(promptWorkspace("game", { osLabel: "Ubuntu" })).toMatch(/vendor\/assets/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/asset studio/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/getImageData/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/source\.png/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/reconstruct\.js/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/not billboard/);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).toMatch(/do not call preview/i);
    expect(promptWorkspace("assets", { osLabel: "Ubuntu" })).not.toMatch(
      /call preview with no port/,
    );
    expect(promptWorkspace("design", { osLabel: "Ubuntu" })).toMatch(
      /never split the page into parts/,
    );
    expect(promptWorkspace("design", { osLabel: "Ubuntu" })).toMatch(/Finish with <\/html>/);
    expect(promptIdentity("host")).toMatch(/on this machine/);
    expect(promptWorkspace("docker", { dockerImage: "locus/agent", osLabel: "Ubuntu" })).toMatch(
      /locus\/agent/,
    );
    expect(promptWorkspace("vm", { osLabel: "Ubuntu" })).toBe("Guest OS: Ubuntu.");
    expect(workspaceToolingRules()).toMatch(/before claiming done/);
    expect(workspaceToolingRules()).toMatch(/smallest patch/);
  });
});

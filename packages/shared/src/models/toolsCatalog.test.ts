import { describe, expect, it } from "vitest";
import { DOCKER_TOOLS, HOST_BROWSER_TOOLS, HOST_TOOLS, SHARED_RUNTIME_TOOLS } from "./tools.js";

describe("Guest runtime catalogs", () => {
  it("derives Host and Docker lists from one shared catalog plus deltas", () => {
    const host = new Set(HOST_TOOLS);
    const docker = new Set(DOCKER_TOOLS);
    expect(HOST_TOOLS).toHaveLength(host.size);
    expect(DOCKER_TOOLS).toHaveLength(docker.size);
    for (const name of SHARED_RUNTIME_TOOLS) {
      expect(host.has(name)).toBe(true);
      expect(docker.has(name)).toBe(true);
    }
    expect(docker.has("start_process")).toBe(true);
    expect(docker.has("record_screen")).toBe(true);
    expect(host.has("start_process")).toBe(false);
    expect(host.has("record_screen")).toBe(false);
    expect(host.has("board_list")).toBe(true);
    expect(host.has("team_message")).toBe(true);
    expect(docker.has("board_list")).toBe(false);
    expect(docker.has("team_message")).toBe(false);
    for (const name of HOST_BROWSER_TOOLS) {
      expect(host.has(name)).toBe(true);
      expect(docker.has(name)).toBe(true);
    }
  });
});

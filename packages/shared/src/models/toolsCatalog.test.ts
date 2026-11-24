import { describe, expect, it } from "vitest";
import {
  BOARD_CHAT_TOOLS,
  DOCKER_TOOLS,
  HOST_BROWSER_TOOLS,
  HOST_PLANNING_TOOLS,
  HOST_TOOLS,
  PROJECT_CHAT_TOOLS,
  SHARED_RUNTIME_TOOLS,
} from "./tools.js";

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

  it("derives Board and Project catalogs from planning tools plus shared slices", () => {
    expect(BOARD_CHAT_TOOLS).toHaveLength(new Set(BOARD_CHAT_TOOLS).size);
    expect(PROJECT_CHAT_TOOLS).toHaveLength(new Set(PROJECT_CHAT_TOOLS).size);
    for (const name of BOARD_CHAT_TOOLS) {
      if (name.startsWith("board_")) expect(HOST_PLANNING_TOOLS).toContain(name);
      else expect(SHARED_RUNTIME_TOOLS).toContain(name);
    }
    for (const name of PROJECT_CHAT_TOOLS) {
      if (
        name.startsWith("board_") ||
        name.startsWith("team_") ||
        HOST_PLANNING_TOOLS.includes(name)
      ) {
        expect(HOST_PLANNING_TOOLS).toContain(name);
      } else {
        expect(SHARED_RUNTIME_TOOLS).toContain(name);
      }
    }
    expect(BOARD_CHAT_TOOLS).toContain("board_cluster");
    expect(BOARD_CHAT_TOOLS).not.toContain("project_spawn");
    expect(BOARD_CHAT_TOOLS).not.toContain("exec");
    expect(PROJECT_CHAT_TOOLS).toContain("project_spawn");
    expect(PROJECT_CHAT_TOOLS).toContain("board_list");
    expect(PROJECT_CHAT_TOOLS).not.toContain("board_upsert");
    expect(PROJECT_CHAT_TOOLS).not.toContain("apply_patch");
  });
});

import { describe, expect, it } from "vitest";
import { isGameSession, isUnityProjectSession } from "./models/session.js";

describe("Unity Games session routing", () => {
  const unity = { kind: undefined, runtime: "host", playbook: "LOCUS_UNITY_WORKFLOW" } as const;

  it("recognizes local Unity coding sessions without treating them as HTML canvas games", () => {
    expect(isUnityProjectSession(unity)).toBe(true);
    expect(isGameSession(unity)).toBe(false);
  });

  it("excludes other agents, workers and ordinary web games", () => {
    expect(
      isUnityProjectSession({ kind: "agent", runtime: "docker", playbook: "LOCUS_UNITY_WORKFLOW" }),
    ).toBe(false);
    expect(
      isUnityProjectSession({ kind: "agent", runtime: "host", playbook: "general coding" }),
    ).toBe(false);
    expect(
      isUnityProjectSession({ kind: "game", runtime: "host", playbook: "LOCUS_UNITY_WORKFLOW" }),
    ).toBe(false);
  });
});

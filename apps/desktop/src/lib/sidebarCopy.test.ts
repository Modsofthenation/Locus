import { describe, expect, it } from "vitest";
import { countPhrase, sidebarBrandSubtitle } from "./sidebarCopy";

const base = {
  inboxOpen: false,
  inboxCount: 0,
  section: "agents" as const,
  mode: "developer" as const,
  settingsTab: "providers" as const,
  agentCount: 2,
  needsCount: 1,
  designCount: 0,
  gameCount: 0,
  assetCount: 0,
  ideCount: 0,
  repoCount: 0,
  boardCount: 0,
  projectCount: 0,
  automationCount: 0,
};

describe("sidebarCopy", () => {
  it("counts nouns and summarizes the open section", () => {
    expect(countPhrase(1, "agent")).toBe("1 agent");
    expect(countPhrase(2, "agent")).toBe("2 agents");
    expect(sidebarBrandSubtitle(base)).toBe("2 agents · 1 needs you");
    expect(sidebarBrandSubtitle({ ...base, needsCount: 0, agentCount: 1 })).toBe("1 agent");
    expect(sidebarBrandSubtitle({ ...base, inboxOpen: true, inboxCount: 3 })).toBe("3 waiting");
    expect(sidebarBrandSubtitle({ ...base, inboxOpen: true, inboxCount: 0 })).toBe("Caught up");
    expect(sidebarBrandSubtitle({ ...base, section: "settings" })).toBe("Providers");
    expect(sidebarBrandSubtitle({ ...base, section: "docker", dockerKind: "mock" })).toBe(
      "Docker · mock",
    );
    expect(
      sidebarBrandSubtitle({
        ...base,
        section: "project",
        mode: "swarm",
        projectCount: 1,
      }),
    ).toBe("1 team");
  });
});

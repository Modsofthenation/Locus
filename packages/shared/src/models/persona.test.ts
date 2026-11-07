import { describe, expect, it } from "vitest";
import {
  composePersonaInstructions,
  HUB_ROLE_PRESETS,
  hubRolePersonaDefaults,
  isDesignerHubRole,
  parseHubAvatarId,
  parseProductMode,
  parseSessionPersona,
  parseSessionSurface,
  sessionDisplayName,
  sessionMatchesSurface,
  surfaceForProductMode,
  teammateMentionAliases,
  teammateMentionHandle,
  titleFromCreateInput,
} from "../index.js";

describe("productMode", () => {
  it("defaults to developer and aliases legacy chatHub to swarm", () => {
    expect(parseProductMode(undefined)).toBe("developer");
    expect(parseProductMode("nope")).toBe("developer");
    expect(parseProductMode("chatHub")).toBe("swarm");
    expect(parseProductMode("swarm")).toBe("swarm");
  });
});

describe("session surface", () => {
  it("defaults missing to developer", () => {
    expect(parseSessionSurface(undefined)).toBe("developer");
    expect(parseSessionSurface("swarm")).toBe("swarm");
    expect(surfaceForProductMode("swarm")).toBe("swarm");
    expect(surfaceForProductMode("developer")).toBe("developer");
    expect(sessionMatchesSurface({}, "developer")).toBe(true);
    expect(sessionMatchesSurface({}, "swarm")).toBe(false);
    expect(sessionMatchesSurface({ surface: "swarm" }, "swarm")).toBe(true);
  });
});

describe("session persona", () => {
  it("parses persona fields", () => {
    expect(
      parseSessionPersona({
        displayName: " Nova ",
        avatarId: "tide",
        avatarPose: "think",
        avatarAccessory: "antenna",
        avatarAccent: "#Abc",
        hubRole: "Researcher",
        personality: "Curious",
      }),
    ).toEqual({
      displayName: "Nova",
      avatarId: "tide",
      avatarPose: "think",
      avatarAccessory: "antenna",
      avatarAccent: "#abc",
      hubRole: "Researcher",
      personality: "Curious",
    });
    expect(parseSessionPersona({ avatarId: "nope" })).toBeUndefined();
    expect(parseHubAvatarId("ember")).toBe("ember");
    expect(parseHubAvatarId("nope")).toBe("spark");
  });

  it("ignores junk accent and accessory none", () => {
    expect(
      parseSessionPersona({ avatarId: "spark", avatarAccessory: "none", avatarAccent: "red" }),
    ).toEqual({
      avatarId: "spark",
    });
  });

  it("prefers displayName for titles and labels", () => {
    expect(sessionDisplayName({ title: "Host agent", persona: { displayName: "Nova" } })).toBe(
      "Nova",
    );
    expect(
      titleFromCreateInput({
        os: "ubuntu",
        persona: { displayName: "Nova" },
        prompt: "hello world this is a long prompt",
      }),
    ).toBe("Nova");
  });

  it("hyphenates spaced names for @handles and mention aliases", () => {
    expect(teammateMentionHandle("The Builder")).toBe("The-Builder");
    expect(teammateMentionHandle("Head of staff")).toBe("Head-of-staff");
    expect(teammateMentionHandle("The Knowledge base")).toBe("The-Knowledge-base");
    expect(teammateMentionHandle("Nova")).toBe("Nova");
    expect(
      teammateMentionAliases({
        title: "Agent",
        persona: { displayName: "The Builder" },
      }),
    ).toEqual(["the builder", "the-builder", "the", "agent"]);
  });

  it("composes personality into instructions", () => {
    expect(composePersonaInstructions("Be brief.", { hubRole: "Ops", personality: "Calm." })).toBe(
      "Your hub role is Ops. Calm.\n\nBe brief.",
    );
  });

  it("formats a Swarm teammate brief with team norms", () => {
    const text = composePersonaInstructions(
      "Own the backlog.",
      { hubRole: "Coordinator", personality: "Direct." },
      {
        surface: "swarm",
      },
    );
    expect(text).toContain("Teammate brief (master prompt");
    expect(text).toContain("Role: Coordinator");
    expect(text).toContain("Personality: Direct.");
    expect(text).toContain("Brief:\nOwn the backlog.");
    expect(text).toContain("team_roster");
    expect(text).toContain("team_add_teammate");
    expect(text).toContain("team_message");
    expect(text).toContain("fire-and-forget");
    expect(text).toContain("project context/");
  });

  it("asks Swarm teammates without a role to confirm it", () => {
    const text = composePersonaInstructions(
      undefined,
      { displayName: "Nova" },
      { surface: "swarm" },
    );
    expect(text).toContain("Role: unset");
    expect(text).not.toContain("team_add_teammate");
  });

  it("includes Designer in hub role presets with UI/UX defaults", () => {
    expect(HUB_ROLE_PRESETS).toContain("Designer");
    expect(isDesignerHubRole("Designer")).toBe(true);
    expect(isDesignerHubRole("designer")).toBe(true);
    expect(isDesignerHubRole("Builder")).toBe(false);
    expect(hubRolePersonaDefaults("Designer")).toEqual({
      personality: "Visual, empathetic, precise about craft.",
      avatarId: "bloom",
    });
    expect(hubRolePersonaDefaults("Builder")).toEqual({});
  });

  it("formats Swarm Designer guidance without coordinator powers", () => {
    const text = composePersonaInstructions(
      "Own the product look.",
      { hubRole: "Designer", personality: "Visual, empathetic, precise about craft." },
      { surface: "swarm" },
    );
    expect(text).toContain("Role: Designer");
    expect(text).toContain("UI/UX Designer");
    expect(text).toContain("accessibility");
    expect(text).toContain("team_message");
    expect(text).toContain("Design-canvas");
    expect(text).not.toContain("team_add_teammate");
  });
});

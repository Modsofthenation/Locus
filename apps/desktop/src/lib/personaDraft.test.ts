import { describe, expect, it } from "vitest";
import { DEFAULT_HUB_AVATAR } from "@locus/shared";
import {
  applyHubRoleToDraft,
  draftFromPersona,
  emptyPersonaDraft,
  personaFromDraft,
  shouldPatchPersona,
} from "./personaDraft";

describe("personaFromDraft / draftFromPersona", () => {
  it("round-trips trimmed fields and falls back to title", () => {
    const draft = draftFromPersona({ displayName: "Nova", hubRole: "Builder" }, "Host agent");
    expect(draft.displayName).toBe("Nova");
    expect(
      personaFromDraft({ ...emptyPersonaDraft(), displayName: "  ", hubRole: " Ops " }),
    ).toEqual({
      displayName: undefined,
      avatarId: DEFAULT_HUB_AVATAR,
      avatarPose: "idle",
      avatarAccessory: "none",
      avatarAccent: undefined,
      hubRole: "Ops",
      personality: undefined,
    });
  });
});

describe("applyHubRoleToDraft", () => {
  it("fills Designer personality and avatar only when still blank", () => {
    const filled = applyHubRoleToDraft(emptyPersonaDraft(), "Designer");
    expect(filled.personality).toMatch(/Visual/);
    expect(filled.avatarId).toBe("bloom");
    const kept = applyHubRoleToDraft(
      { ...emptyPersonaDraft(), personality: "dry", avatarId: "ember" },
      "Designer",
    );
    expect(kept.personality).toBe("dry");
    expect(kept.avatarId).toBe("ember");
  });
});

describe("shouldPatchPersona", () => {
  it("skips Design and empty developer chats", () => {
    expect(shouldPatchPersona({ isDesign: true, swarmMode: true, hasPersona: true })).toBe(false);
    expect(shouldPatchPersona({ isDesign: false, swarmMode: false, hasPersona: false })).toBe(
      false,
    );
    expect(shouldPatchPersona({ isDesign: false, swarmMode: true, hasPersona: false })).toBe(true);
  });
});

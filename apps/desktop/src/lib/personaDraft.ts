import {
  DEFAULT_HUB_AVATAR,
  DEFAULT_HUB_AVATAR_ACCESSORY,
  DEFAULT_HUB_AVATAR_POSE,
  hubRolePersonaDefaults,
  type HubAvatarAccessory,
  type HubAvatarId,
  type HubAvatarPose,
  type SessionPersona,
} from "@locus/shared";

export type PersonaDraft = {
  displayName: string;
  avatarId: HubAvatarId;
  avatarPose: HubAvatarPose;
  avatarAccessory: HubAvatarAccessory;
  avatarAccent?: string;
  hubRole: string;
  personality: string;
};

export function emptyPersonaDraft(): PersonaDraft {
  return {
    displayName: "",
    avatarId: DEFAULT_HUB_AVATAR,
    avatarPose: DEFAULT_HUB_AVATAR_POSE,
    avatarAccessory: DEFAULT_HUB_AVATAR_ACCESSORY,
    hubRole: "",
    personality: "",
  };
}

export function draftFromPersona(persona?: SessionPersona | null, title?: string): PersonaDraft {
  return {
    displayName: persona?.displayName ?? title ?? "",
    avatarId: persona?.avatarId ?? DEFAULT_HUB_AVATAR,
    avatarPose: persona?.avatarPose ?? DEFAULT_HUB_AVATAR_POSE,
    avatarAccessory: persona?.avatarAccessory ?? DEFAULT_HUB_AVATAR_ACCESSORY,
    avatarAccent: persona?.avatarAccent,
    hubRole: persona?.hubRole ?? "",
    personality: persona?.personality ?? "",
  };
}

export function personaFromDraft(draft: PersonaDraft): SessionPersona {
  return {
    displayName: draft.displayName.trim() || undefined,
    avatarId: draft.avatarId,
    avatarPose: draft.avatarPose,
    avatarAccessory: draft.avatarAccessory,
    avatarAccent: draft.avatarAccent,
    hubRole: draft.hubRole.trim() || undefined,
    personality: draft.personality.trim() || undefined,
  };
}

export function applyHubRoleToDraft(draft: PersonaDraft, role: string): PersonaDraft {
  const defaults = hubRolePersonaDefaults(role);
  return {
    ...draft,
    hubRole: role,
    personality:
      defaults.personality && !draft.personality.trim() ? defaults.personality : draft.personality,
    avatarId:
      defaults.avatarId && draft.avatarId === DEFAULT_HUB_AVATAR
        ? defaults.avatarId
        : draft.avatarId,
  };
}

export function shouldPatchPersona(input: {
  isDesign: boolean;
  swarmMode: boolean;
  hasPersona: boolean;
}): boolean {
  return !input.isDesign && (input.swarmMode || input.hasPersona);
}

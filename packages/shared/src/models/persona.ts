/** Hub-facing identity layered on AgentSession — not pipeline /roles. */

export const HUB_AVATAR_IDS = ["spark", "grove", "tide", "ember", "slate", "bloom"] as const;
export type HubAvatarId = (typeof HUB_AVATAR_IDS)[number];
export const DEFAULT_HUB_AVATAR: HubAvatarId = "spark";

export const HUB_AVATAR_POSES = ["idle", "think", "rest", "sad"] as const;
export type HubAvatarPose = (typeof HUB_AVATAR_POSES)[number];
export const DEFAULT_HUB_AVATAR_POSE: HubAvatarPose = "idle";

export const HUB_AVATAR_ACCESSORIES = ["none", "antenna", "badge", "bow"] as const;
export type HubAvatarAccessory = (typeof HUB_AVATAR_ACCESSORIES)[number];
export const DEFAULT_HUB_AVATAR_ACCESSORY: HubAvatarAccessory = "none";

export const HUB_ROLE_PRESETS = [
  "Companion",
  "Researcher",
  "Ops",
  "Reviewer",
  "Builder",
  "Designer",
  "Coordinator",
] as const;

export interface SessionPersona {
  /** Hub-facing name; falls back to session.title when missing. */
  displayName?: string;
  avatarId?: HubAvatarId;
  /** Mascot face pose for this teammate. */
  avatarPose?: HubAvatarPose;
  /** Optional Locus accessory layered on the mascot. */
  avatarAccessory?: HubAvatarAccessory;
  /** Optional custom accent hex (#rgb / #rrggbb). Overrides preset color. */
  avatarAccent?: string;
  /** Free-text hub role (presets in HUB_ROLE_PRESETS). */
  hubRole?: string;
  /** Soft personality overlay composed with instructions. */
  personality?: string;
}

export function isHubAvatarId(value: unknown): value is HubAvatarId {
  return typeof value === "string" && (HUB_AVATAR_IDS as readonly string[]).includes(value);
}

export function parseHubAvatarId(raw: unknown): HubAvatarId {
  return isHubAvatarId(raw) ? raw : DEFAULT_HUB_AVATAR;
}

export function isHubAvatarPose(value: unknown): value is HubAvatarPose {
  return typeof value === "string" && (HUB_AVATAR_POSES as readonly string[]).includes(value);
}

export function parseHubAvatarPose(raw: unknown): HubAvatarPose {
  return isHubAvatarPose(raw) ? raw : DEFAULT_HUB_AVATAR_POSE;
}

export function isHubAvatarAccessory(value: unknown): value is HubAvatarAccessory {
  return typeof value === "string" && (HUB_AVATAR_ACCESSORIES as readonly string[]).includes(value);
}

export function parseHubAvatarAccessory(raw: unknown): HubAvatarAccessory {
  return isHubAvatarAccessory(raw) ? raw : DEFAULT_HUB_AVATAR_ACCESSORY;
}

/** Accepts #rgb or #rrggbb. Junk becomes undefined. */
export function parseHubAvatarAccent(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value))
    return value.toLowerCase();
  return undefined;
}

export function parseSessionPersona(raw: unknown): SessionPersona | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const displayName =
    typeof value.displayName === "string" && value.displayName.trim()
      ? value.displayName.trim()
      : undefined;
  const hubRole =
    typeof value.hubRole === "string" && value.hubRole.trim() ? value.hubRole.trim() : undefined;
  const personality =
    typeof value.personality === "string" && value.personality.trim()
      ? value.personality.trim()
      : undefined;
  const avatarId = isHubAvatarId(value.avatarId) ? value.avatarId : undefined;
  const avatarPose = isHubAvatarPose(value.avatarPose) ? value.avatarPose : undefined;
  const avatarAccessory = isHubAvatarAccessory(value.avatarAccessory)
    ? value.avatarAccessory
    : undefined;
  const avatarAccent = parseHubAvatarAccent(value.avatarAccent);
  if (
    !displayName &&
    !avatarId &&
    !avatarPose &&
    !avatarAccessory &&
    !avatarAccent &&
    !hubRole &&
    !personality
  ) {
    return undefined;
  }
  return {
    ...(displayName ? { displayName } : {}),
    ...(avatarId ? { avatarId } : {}),
    ...(avatarPose ? { avatarPose } : {}),
    ...(avatarAccessory && avatarAccessory !== "none" ? { avatarAccessory } : {}),
    ...(avatarAccent ? { avatarAccent } : {}),
    ...(hubRole ? { hubRole } : {}),
    ...(personality ? { personality } : {}),
  };
}

/** Prefer persona display name, then title. */
export function sessionDisplayName(session: {
  title?: string;
  persona?: SessionPersona | null;
}): string {
  const name = session.persona?.displayName?.trim();
  if (name) return name;
  return session.title?.trim() || "Agent";
}

/** Composer @handle for a display name: "The Builder" → The-Builder. */
export function teammateMentionHandle(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, ""))
    .filter(Boolean)
    .join("-");
}

/** Tokens that resolve a teammate @mention, including hyphenated spaced names. */
export function teammateMentionAliases(session: {
  title?: string;
  persona?: SessionPersona | null;
}): string[] {
  const aliases = new Set<string>();
  for (const name of [sessionDisplayName(session), session.title?.trim() ?? ""]) {
    if (!name) continue;
    aliases.add(name.toLowerCase());
    const handle = teammateMentionHandle(name);
    if (handle) aliases.add(handle.toLowerCase());
    const first = name.split(/\s+/)[0]?.toLowerCase();
    if (first) aliases.add(first);
  }
  return [...aliases];
}

export function sessionAvatarId(session: { persona?: SessionPersona | null }): HubAvatarId {
  return parseHubAvatarId(session.persona?.avatarId);
}

export function sessionAvatarPose(session: { persona?: SessionPersona | null }): HubAvatarPose {
  return parseHubAvatarPose(session.persona?.avatarPose);
}

export function sessionAvatarAccessory(session: {
  persona?: SessionPersona | null;
}): HubAvatarAccessory {
  return parseHubAvatarAccessory(session.persona?.avatarAccessory);
}

/** Accent used by PersonaAvatar CSS (`data-avatar`). Custom hex wins over preset. */
export function hubAvatarAccent(id: HubAvatarId, custom?: string | null): string {
  const override = parseHubAvatarAccent(custom);
  if (override) return override;
  switch (id) {
    case "grove":
      return "#3d8b6e";
    case "tide":
      return "#2f6fed";
    case "ember":
      return "#c45c26";
    case "slate":
      return "#5a6577";
    case "bloom":
      return "#b44d7a";
    case "spark":
    default:
      return "#c9a227";
  }
}

export function sessionAvatarAccent(session: { persona?: SessionPersona | null }): string {
  return hubAvatarAccent(sessionAvatarId(session), session.persona?.avatarAccent);
}

export function hubAvatarLabel(id: HubAvatarId): string {
  switch (id) {
    case "grove":
      return "Grove";
    case "tide":
      return "Tide";
    case "ember":
      return "Ember";
    case "slate":
      return "Slate";
    case "bloom":
      return "Bloom";
    case "spark":
    default:
      return "Spark";
  }
}

export function hubAvatarAccessoryLabel(id: HubAvatarAccessory): string {
  switch (id) {
    case "antenna":
      return "Antenna";
    case "badge":
      return "Badge";
    case "bow":
      return "Bow";
    case "none":
    default:
      return "None";
  }
}

/** True when hubRole is the Coordinator preset (case-insensitive). */
export function isCoordinatorHubRole(role?: string | null): boolean {
  return Boolean(role?.trim() && /^coordinator$/i.test(role.trim()));
}

/** True when hubRole is the Designer (UI/UX) preset (case-insensitive). */
export function isDesignerHubRole(role?: string | null): boolean {
  return Boolean(role?.trim() && /^designer$/i.test(role.trim()));
}

/**
 * Suggested persona fields for known hub roles. Empty for free-text / unknown roles.
 * Used by New teammate + team_add_teammate when the operator leaves fields blank.
 */
export function hubRolePersonaDefaults(role?: string | null): {
  personality?: string;
  avatarId?: HubAvatarId;
} {
  if (isDesignerHubRole(role)) {
    return {
      personality: "Visual, empathetic, precise about craft.",
      avatarId: "bloom",
    };
  }
  return {};
}

/**
 * Compose operator instructions. On Swarm (`surface: "swarm"`), formats a
 * labeled teammate brief that acts as the master prompt for the chat.
 */
export function composePersonaInstructions(
  instructions?: string | null,
  persona?: SessionPersona | null,
  opts?: { surface?: string | null },
): string | undefined {
  const base = instructions?.trim() || "";
  const role = persona?.hubRole?.trim() || "";
  const personality = persona?.personality?.trim() || "";
  const swarm = opts?.surface === "swarm" || opts?.surface === "chatHub";

  if (!swarm) {
    const bits: string[] = [];
    if (role) bits.push(`Your hub role is ${role}.`);
    if (personality) bits.push(personality);
    if (!bits.length) return base || undefined;
    const overlay = bits.join(" ");
    return base ? `${overlay}\n\n${base}` : overlay;
  }

  const lines: string[] = [
    "Teammate brief (master prompt — follow for the whole chat):",
    role ? `Role: ${role}` : "Role: unset — ask the user what your role on the team should be.",
  ];
  if (personality) lines.push(`Personality: ${personality}`);
  if (base) lines.push(`Brief:\n${base}`);
  lines.push(
    "",
    "Team norms:",
    "- Stay in character; keep replies conversational and concise like a messaging app.",
    "- Use team_roster and team_peer_status when asked about the team or peer status.",
    "- To ask another teammate to do work, call team_message (fire-and-forget). Do not wait on shell `locus agent chat` — it blocks your turn. You will get a peer update when they finish, need you, or fail.",
    "- Shared team briefing lives in project context/ (INDEX.md and notes). Prefer project_context_read/write over pasting the same setup into every handoff. Each teammate still has their own computer.",
  );
  if (isCoordinatorHubRole(role)) {
    lines.push(
      "- You are the Coordinator: when asked to add someone, use team_add_teammate (name, role, optional personality/brief). Roles include Designer for UI/UX.",
      "- Dispatch peers with team_message, keep talking with the user while they work, then report back from peer updates.",
    );
  }
  if (isDesignerHubRole(role)) {
    lines.push(
      "- You are the UI/UX Designer: critique layouts, visuals, interaction flows, hierarchy, and accessibility.",
      "- Give concrete design feedback (what to change and why). Propose structure, visual direction, and UX flows in prose; use simple ASCII/wireframe sketches when helpful.",
      "- Stay on this Swarm host chat — you are not a Design-canvas session. Hand implementation to a Builder via team_message; escalate scope questions to the Coordinator.",
    );
  }
  return lines.join("\n");
}

import type { ApprovalPolicy } from "./approval.js";
import type { AutonomyTier } from "./autonomy.js";
import type { BrainSettings } from "./brain.js";
import type { GitForgeAccount } from "./git.js";
import type { IntegrationAccount } from "./integration.js";
import type { IntegrationPlugin } from "./plugin.js";
import type { McpServerConfig } from "./mcp.js";
import type { AiProvider } from "./provider.js";
import type { AgentSkill } from "./skill.js";
import type { ThemeId } from "./theme.js";
import type { RepoHardwareProfile, VmTemplate } from "./vm.js";
import type { WorkerBackend } from "./worker.js";
import type { NamedEnvironment } from "./namedEnv.js";
import type { PhoneRemote } from "./phone.js";
import type { ChromeExtensionSettings } from "./chromeExtension.js";
import type { ManagedPolicyStatus } from "./policy.js";

export interface AdvancedSettings {
  dataDir: string;
  qemuBinary: string;
  swtpmBinary: string;
  ovmfCodePath: string;
  ovmfVarsPath: string;
  maxConcurrentVms: number;
  maxAgentRounds?: number;
  maxUsdPerTurn?: number;
  maxMsPerTurn?: number;
  maxSubagentsPerTurn?: number;
  notifyWebhook?: string;
  webhookBaseUrl?: string;
  slackSigningSecret?: string;
  extraAllowHosts?: string[];
  approvalPolicy?: ApprovalPolicy;
  autonomy?: AutonomyTier;
  defaultAcceleratorAuto: boolean;
  /** Host Python or venv for IDE pylsp (Jedi). Empty means auto-detect. */
  pythonInterpreter?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  bindHost: string;
  bindPort: number;
  openBrowserOnStart: boolean;
  hostSharePath: string;
  /** Host-side n-gram grep for Docker/Host bind mounts. Default on. */
  workspaceGrepIndex?: boolean;
  /** Guest boot wait before a turn gives up, in ms. Default 15 minutes. */
  guestBootTimeoutMs?: number;
  /** How long a Needs-you approval waits before auto-deny, in ms. Default 30 minutes. */
  approvalTimeoutMs?: number;
  /** Composer follow-up queue depth. Default 32. */
  maxPromptQueue?: number;
  /** Newest automation chats to keep per job. Default 60. */
  maxAutomationChats?: number;
}

export const DEFAULT_GUEST_BOOT_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

export function guestBootTimeoutMs(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 30_000) {
    return Math.min(Math.round(raw), 60 * 60_000);
  }
  return DEFAULT_GUEST_BOOT_TIMEOUT_MS;
}

export function approvalTimeoutMs(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 60_000) {
    return Math.min(Math.round(raw), 24 * 60 * 60_000);
  }
  return DEFAULT_APPROVAL_TIMEOUT_MS;
}

export function promptQueueLimit(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(Math.round(raw), 256);
  }
  return 32;
}

export function automationChatLimit(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(Math.round(raw), 500);
  }
  return 60;
}

export const PRODUCT_MODES = ["developer", "swarm"] as const;
export type ProductMode = (typeof PRODUCT_MODES)[number];
export const DEFAULT_PRODUCT_MODE: ProductMode = "developer";

/** Legacy Chat Hub id — accepted on load, rewritten to `swarm` on save. */
export const LEGACY_PRODUCT_MODE_CHAT_HUB = "chatHub";

export function parseProductMode(raw: unknown): ProductMode {
  if (raw === "swarm" || raw === LEGACY_PRODUCT_MODE_CHAT_HUB) return "swarm";
  return DEFAULT_PRODUCT_MODE;
}

export interface LocusConfig {
  theme: ThemeId;
  /**
   * Product shell: Agents (full control plane) or Swarm (teammate-first).
   * Default developer so existing installs keep today’s UI.
   * Legacy config value `chatHub` is accepted and normalized to `swarm`.
   */
  productMode?: ProductMode;
  /** Chat thread density. Default compact. */
  chatDensity?: ChatDensity;
  /** Files editor font size in px (10–20). Default 12. */
  editorFontSize?: number;
  /** Format the buffer on save. Default true. */
  formatOnSave?: boolean;
  /** Show the files-editor minimap. Default true. */
  showMinimap?: boolean;
  providers: AiProvider[];
  templates: VmTemplate[];
  hardwareProfiles: RepoHardwareProfile[];
  forges: GitForgeAccount[];
  integrations?: IntegrationAccount[];
  /** AI-authored HTTP integration plugins. Config fields render in Settings. */
  integrationPlugins?: IntegrationPlugin[];
  mcpServers?: McpServerConfig[];
  skills?: AgentSkill[];
  /** LAN (or later cloud) machines running locus-worker. */
  workers?: WorkerBackend[];
  /** Stable id this control plane sends as `X-Locus-Plane`. */
  workerPlaneId?: string;
  /** UI locale. Default `en`. */
  locale?: string;
  /** Guided first Host task after setup. */
  setupFirstTask?: "pending" | "done" | "dismissed";
  /** Named guest presets (golden + jail + recipe + spend + Where). */
  namedEnvironments?: NamedEnvironment[];
  /** Opt-in Android / phone remote. Token is vaulted. */
  phoneRemote?: PhoneRemote;
  /** Opt-in Chrome extension. Token is vaulted. Host agents may then use live tabs. */
  chromeExtension?: ChromeExtensionSettings;
  advanced: AdvancedSettings;
  setupCompleted?: boolean;
  /** Design system new Design sessions use when the empty state does not pick one. */
  defaultDesignSystemId?: string;
  /** Asset style new Assets sessions use when the empty state does not pick one. */
  defaultAssetStyleId?: string;
  /** Game style new Games sessions use when the empty state does not pick one. */
  defaultGameStyleId?: string;
  /** Desktop notification when an agent turn finishes. Default true. */
  notifyAgents?: boolean;
  /** Desktop notification when a session needs you. Default true. */
  notifyNeedsYou?: boolean;
  /** Desktop notification for Slack Activity. Default true. */
  notifySlack?: boolean;
  /** Desktop notification when an automation run finishes. Default true. */
  notifyAutomations?: boolean;
  /** When Automations alerts are on, only fire for failed runs. Default off. */
  notifyAutomationsFailedOnly?: boolean;
  /** Quiet-hours start `HH:MM` local. Empty means no quiet hours. */
  notifyQuietStart?: string;
  /** Quiet-hours end `HH:MM` local. Wraps overnight when start is later than end. */
  notifyQuietEnd?: string;
  /** Check GitHub Releases for a newer Locus in the background. Default true. */
  checkForUpdates?: boolean;
  /** Codebase / Stack diff layout. Default unified. */
  diffLayout?: DiffLayout;
  /** Shared knowledge brain (distiller model, auto-index, pause ingest). */
  brain?: BrainSettings;
  /** Runtime-only admin policy. Loaded from disk, never written back to config.json. */
  managedPolicy?: ManagedPolicyStatus;
}

export const DIFF_LAYOUTS = ["unified", "split"] as const;
export type DiffLayout = (typeof DIFF_LAYOUTS)[number];

export function parseDiffLayout(raw: unknown): DiffLayout {
  return raw === "split" ? "split" : "unified";
}

export const CHAT_DENSITIES = ["comfortable", "compact", "dense"] as const;
export type ChatDensity = (typeof CHAT_DENSITIES)[number];
export const DEFAULT_CHAT_DENSITY: ChatDensity = "compact";

export function parseChatDensity(raw: unknown): ChatDensity {
  return CHAT_DENSITIES.includes(raw as ChatDensity) ? (raw as ChatDensity) : DEFAULT_CHAT_DENSITY;
}

export const DEFAULT_EDITOR_FONT_SIZE = 12;

export function editorFontSize(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(20, Math.max(10, Math.round(raw)));
}

/** Missing or junk stays on so existing installs keep formatting on save. */
export function parseFormatOnSave(raw: unknown): boolean {
  return raw !== false;
}

/** Missing or junk stays on so existing installs keep the editor minimap. */
export function parseShowMinimap(raw: unknown): boolean {
  return raw !== false;
}

export type DesktopNotifySource = "agents" | "needsYou" | "slack" | "automations";

export interface DesktopNotifyPrefs {
  notifyAgents: boolean;
  notifyNeedsYou: boolean;
  notifySlack: boolean;
  notifyAutomations: boolean;
  notifyAutomationsFailedOnly: boolean;
  notifyQuietStart?: string;
  notifyQuietEnd?: string;
}

/** Missing or junk values stay on so existing configs keep notifying. */
export function parseNotifyPref(raw: unknown): boolean {
  return raw !== false;
}

/** Background update checks are on unless turned off. */
export function parseCheckForUpdates(raw: unknown): boolean {
  return raw !== false;
}

/** Accepts `H:MM` or `HH:MM`. Junk or empty is no quiet bound. */
export function parseQuietTime(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function minutesFromQuietTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function inQuietHours(now: Date, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false;
  const from = minutesFromQuietTime(start);
  const to = minutesFromQuietTime(end);
  if (from === to) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (from < to) return mins >= from && mins < to;
  return mins >= from || mins < to;
}

export function parseDesktopNotifyPrefs(raw: unknown): DesktopNotifyPrefs {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const notifyQuietStart = parseQuietTime(value.notifyQuietStart);
  const notifyQuietEnd = parseQuietTime(value.notifyQuietEnd);
  return {
    notifyAgents: parseNotifyPref(value.notifyAgents),
    notifyNeedsYou: parseNotifyPref(value.notifyNeedsYou),
    notifySlack: parseNotifyPref(value.notifySlack),
    notifyAutomations: parseNotifyPref(value.notifyAutomations),
    notifyAutomationsFailedOnly: value.notifyAutomationsFailedOnly === true,
    ...(notifyQuietStart && notifyQuietEnd ? { notifyQuietStart, notifyQuietEnd } : {}),
  };
}

export function desktopNotifyEnabled(
  prefs: Partial<DesktopNotifyPrefs> | null | undefined,
  source: DesktopNotifySource,
): boolean {
  if (!prefs) return true;
  if (source === "agents") return parseNotifyPref(prefs.notifyAgents);
  if (source === "needsYou") return parseNotifyPref(prefs.notifyNeedsYou);
  if (source === "slack") return parseNotifyPref(prefs.notifySlack);
  return parseNotifyPref(prefs.notifyAutomations);
}

/** Source toggle plus quiet hours. Use this at fire time. */
export function desktopNotifyAllowed(
  prefs: Partial<DesktopNotifyPrefs> | null | undefined,
  source: DesktopNotifySource,
  now = new Date(),
): boolean {
  if (!desktopNotifyEnabled(prefs, source)) return false;
  return !inQuietHours(now, prefs?.notifyQuietStart, prefs?.notifyQuietEnd);
}

export function anyDesktopNotifyEnabled(
  prefs: Partial<DesktopNotifyPrefs> | null | undefined,
): boolean {
  return (
    desktopNotifyEnabled(prefs, "agents") ||
    desktopNotifyEnabled(prefs, "needsYou") ||
    desktopNotifyEnabled(prefs, "slack") ||
    desktopNotifyEnabled(prefs, "automations")
  );
}

export const DEFAULT_ADVANCED: Omit<AdvancedSettings, "dataDir"> = {
  qemuBinary: "qemu-system-x86_64",
  swtpmBinary: "swtpm",
  ovmfCodePath: "",
  ovmfVarsPath: "",
  maxConcurrentVms: 4,
  defaultAcceleratorAuto: true,
  logLevel: "info",
  bindHost: "127.0.0.1",
  bindPort: 7420,
  openBrowserOnStart: true,
  hostSharePath: "",
  guestBootTimeoutMs: DEFAULT_GUEST_BOOT_TIMEOUT_MS,
  approvalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
  maxPromptQueue: 32,
  maxAutomationChats: 60,
};

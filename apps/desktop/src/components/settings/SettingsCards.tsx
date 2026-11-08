import { useRef, useState, type ReactNode } from "react";
import {
  BUILTIN_PROVIDERS,
  CURSOR_CLI_BASE_URL,
  CLAUDE_CODE_BASE_URL,
  CODEX_CLI_BASE_URL,
  KIRO_CLI_BASE_URL,
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_FARGATE_CLUSTER,
  DEFAULT_FARGATE_REGION,
  DEFAULT_FARGATE_SIZE,
  DEFAULT_WORKER_IDLE_TTL_MS,
  INTEGRATION_KINDS,
  NAMED_ENV_NAME_MAX,
  cursorModelPickerIds,
  defaultIntegrationUrl,
  cursorModelSelectValue,
  forgeAccountHandle,
  forgeAccountInitials,
  forgeAccountStatus,
  forgeAccountSubtitle,
  forgeHostLabel,
  forgeLabel,
  forgeOauthScopes,
  forgeSupportsSso,
  generateGuestPassword,
  guestLabel,
  hasUsableKey,
  googleAccessToken,
  integrationLabel,
  awsCredentialReady,
  kubernetesReady,
  providerLooksLikeAws,
  isDefaultGuestPassword,
  isGoogleIntegrationKind,
  isIntegrationKind,
  isLinux,
  isWindows,
  namedEnvironmentSummary,
  parseSlackChannelAllowlist,
  pluginFunctionName,
  publishedRates,
  retargetCursorModel,
  sessionDisplayName,
  slackAccountLinked,
  usesCursorModelIds,
  workerDestroyOnStop,
  workerIsMetered,
  workerKind,
  type AgentSkill,
  type AiProvider,
  type GitForgeAccount,
  type GuestOs,
  type IntegrationAccount,
  type IntegrationKind,
  type IntegrationPlugin,
  type McpServerConfig,
  type NamedEnvironment,
  type AgentSession,
  type QemuInstallProgress,
  type VmInstance,
  type VmTemplate,
  type WorkerBackend,
} from "@locus/shared";
import { api, type HypervisorStatus } from "@/lib/api";
import { CursorModelControls } from "./ModelPicker";
import { IconChevron, IconLock } from "@/components/layout/Icons";
import { Select } from "@/components/layout/Select";
import { BusyButton, InlineError } from "@/components/layout/Skeleton";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function isBuiltinProvider(provider: AiProvider): boolean {
  return BUILTIN_PROVIDERS.some((row) => row.kind === provider.kind && row.name === provider.name);
}

export function ProviderCard({
  provider: p,
  expanded,
  busy,
  probe,
  locked,
  onToggleExpand,
  onPatch,
  onRefresh,
  onTest,
  onRemove,
}: {
  provider: AiProvider;
  expanded: boolean;
  busy: boolean;
  probe?: string;
  locked?: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<AiProvider>) => void;
  onRefresh: () => void;
  onTest: () => void;
  onRemove?: () => void;
}) {
  const custom = !isBuiltinProvider(p);
  const published = publishedRates(p, p.defaultModel);
  const localCli =
    p.kind === "cursor-cli"
      ? {
          base: CURSOR_CLI_BASE_URL,
          binary: "agent (on PATH)",
          key: "optional — uses agent login",
        }
      : p.kind === "claude-code"
        ? {
            base: CLAUDE_CODE_BASE_URL,
            binary: "claude (on PATH)",
            key: "optional — uses claude login",
          }
        : p.kind === "codex-cli"
          ? {
              base: CODEX_CLI_BASE_URL,
              binary: "codex (on PATH)",
              key: "optional — uses codex login",
            }
          : p.kind === "kiro-cli"
            ? {
                base: KIRO_CLI_BASE_URL,
                binary: "kiro-cli (on PATH)",
                key: "optional — uses kiro-cli login",
              }
            : null;
  return (
    <div
      className={`provider-card ${expanded ? "open" : ""} ${p.enabled ? "on" : ""}${locked ? " locked" : ""}`}
    >
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className={`provider-dot ${p.enabled ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{p.name}</strong>
            {p.defaultModel ? <span className="meta">{p.defaultModel}</span> : null}
          </span>
        </button>
        <button
          type="button"
          className={`settings-switch ${p.enabled ? "on" : ""}`}
          role="switch"
          aria-checked={p.enabled}
          aria-label={`${p.name} enabled`}
          disabled={locked}
          onClick={() => {
            if (locked) return;
            onPatch({ enabled: !p.enabled });
          }}
        />
        <span className="provider-card-state">{p.enabled ? "Enabled" : "Off"}</span>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>
                {providerLooksLikeAws(p) || p.accessKeyId ? "Secret access key" : "API key"}
              </label>
              <div className="field-with-icon">
                <input
                  type="password"
                  placeholder={
                    localCli
                      ? localCli.key
                      : providerLooksLikeAws(p) || p.accessKeyId
                        ? "AWS secret access key"
                        : "API key"
                  }
                  value={p.apiKey ?? ""}
                  onChange={(e) => onPatch({ apiKey: e.target.value })}
                />
                <span className="field-icon" aria-hidden>
                  <IconLock />
                </span>
              </div>
            </div>
            <div className="field">
              <label>{localCli ? "CLI binary" : "Base URL"}</label>
              <input
                value={localCli && p.baseUrl === localCli.base ? "" : p.baseUrl}
                placeholder={localCli ? localCli.binary : undefined}
                disabled={locked}
                onChange={(e) =>
                  onPatch({
                    baseUrl: localCli ? e.target.value.trim() || localCli.base : e.target.value,
                  })
                }
              />
            </div>
          </div>
          {providerLooksLikeAws(p) || p.accessKeyId ? (
            <div className="field">
              <label>Access key ID</label>
              <input
                value={p.accessKeyId ?? ""}
                spellCheck={false}
                placeholder="AKIA… required for SigV4. Leave empty to send a Bearer key."
                onChange={(e) => onPatch({ accessKeyId: e.target.value.trim() || undefined })}
              />
            </div>
          ) : null}
          {custom ? (
            <div className="field">
              <label>Name</label>
              <input value={p.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
          ) : null}
          <p className="hint">
            Use an exact model id (these catalogs are already pinned). Aliases like *-latest can
            drift. Test connection probes the adapter; Compare models A/B-tests a prompt against a
            second model.
          </p>
          {p.kind === "opencode" && (
            <p className="hint">
              OpenCode Zen free tier defaults to big-pickle and lists x-preview-f-free. Get a key at
              opencode.ai/auth, then Refresh models for the full catalog.
            </p>
          )}
          {p.kind === "openrouter" && (
            <p className="hint">
              OpenRouter is an OpenAI-compatible gateway. Model ids look like
              anthropic/claude-sonnet-4.5. Get a key at openrouter.ai/keys, then Refresh models for
              the full catalog.
            </p>
          )}
          {providerLooksLikeAws(p) ? (
            <p className="hint">
              AWS SigV4 when Access key ID is set: Bedrock OpenAI-compat
              {" (bedrock-runtime.{region}.amazonaws.com/openai/v1)"} or an API Gateway execute-api
              URL. Paste a Bearer/API key only when the gateway does not use IAM. Session tokens go
              in extra header x-amz-security-token.
            </p>
          ) : null}
          {p.kind === "cursor" && (
            <p className="hint">
              Cursor Cloud uses api.cursor.com/v1. Paste a key from cursor.com/dashboard/api, then
              Refresh models. Chat turns launch a Cloud Agent (POST /v1/agents) and stream the run
              into this thread — they do not call POST /v1/chat/completions. GitHub remotes are
              passed through; other forges are rejected. No-repo agents are allowed.
            </p>
          )}
          {p.kind === "cursor-cli" && (
            <p className="hint">
              Cursor CLI runs `agent -p` against this session's workspace. On this machine that is
              the Docker/Host folder; on a worker it is the remote bind-mount (`agent` must be on
              the worker host). Install from cursor.com/install, then `agent login` or paste a key.
              On Windows the installer writes `cursor-agent.cmd` under `%LOCALAPPDATA%\cursor-agent`
              — Test connection can use that path. VMs are not supported. Steer interrupts a running
              CLI turn and resumes with the new instruction. Chat turns do not call POST
              /v1/chat/completions. The model catalog refreshes from `agent models` when Locus
              starts.
            </p>
          )}
          {p.kind === "claude-code" && (
            <p className="hint">
              Claude Code runs `claude -p` (print / headless, stream-json) against this session's
              workspace. On this machine that is the Docker/Host folder; on a worker it is the
              remote bind-mount (`claude` must be on the worker host). Install from code.claude.com,
              then `claude auth login` or paste a key. VMs are not supported. Steer interrupts a
              running CLI turn and resumes with the new instruction. Chat turns do not call POST
              /v1/chat/completions. Test connection probes `claude --version` and `claude auth
              status`.
            </p>
          )}
          {p.kind === "codex-cli" && (
            <p className="hint">
              Codex CLI runs `codex exec --json` against this session's workspace. On this machine
              that is the Docker/Host folder; on a worker it is the remote bind-mount (`codex` must
              be on the worker host). Install Codex CLI, then `codex login` or paste an API key. VMs
              are not supported. Test connection checks the installed CLI and ChatGPT login; an API
              key is reported as configured but is not validated. Chat turns resume the same Codex
              thread with `exec resume`.
            </p>
          )}
          {p.kind === "kiro-cli" && (
            <p className="hint">
              Kiro CLI runs `kiro-cli chat --no-interactive --output-format stream-json` against
              this session's workspace. On this machine that is the Docker/Host folder; on a worker
              it is the remote bind-mount (`kiro-cli` must be on the worker host). Install from
              cli.kiro.dev, then `kiro-cli login` or paste a KIRO_API_KEY. VMs are not supported.
              Steer interrupts a running CLI turn and resumes with the new instruction. Chat turns
              do not call POST /v1/chat/completions. Test connection probes `kiro-cli --version` and
              `kiro-cli whoami`.
            </p>
          )}
          <div className="field">
            <label>Default model</label>
            {p.models.length > 0 ? (
              <Select
                ariaLabel="Default model"
                value={
                  usesCursorModelIds(p)
                    ? cursorModelSelectValue(p.models, p.defaultModel)
                    : p.defaultModel
                }
                options={(usesCursorModelIds(p)
                  ? cursorModelPickerIds([p.defaultModel, ...p.models])
                  : p.models
                ).map((model) => ({ value: model, label: model }))}
                onChange={(value) =>
                  onPatch({
                    defaultModel: usesCursorModelIds(p)
                      ? retargetCursorModel(p.defaultModel, value)
                      : value,
                  })
                }
              />
            ) : (
              <input
                value={p.defaultModel}
                placeholder="model id"
                onChange={(e) => onPatch({ defaultModel: e.target.value })}
              />
            )}
          </div>
          {usesCursorModelIds(p) ? (
            <CursorModelControls
              model={p.defaultModel}
              onChange={(model) => onPatch({ defaultModel: model })}
            />
          ) : null}
          <details className="provider-advanced">
            <summary>Prices and overrides</summary>
            <div className="grid-2">
              <div className="field">
                <label>Input $/1M</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={
                    published?.inputUsdPerMillion != null
                      ? String(published.inputUsdPerMillion)
                      : "optional"
                  }
                  value={p.inputUsdPerMillion ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = raw === "" ? undefined : Number(raw);
                    onPatch({
                      inputUsdPerMillion: n != null && Number.isFinite(n) && n >= 0 ? n : undefined,
                    });
                  }}
                />
              </div>
              <div className="field">
                <label>Output $/1M</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={
                    published?.outputUsdPerMillion != null
                      ? String(published.outputUsdPerMillion)
                      : "optional"
                  }
                  value={p.outputUsdPerMillion ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = raw === "" ? undefined : Number(raw);
                    onPatch({
                      outputUsdPerMillion:
                        n != null && Number.isFinite(n) && n >= 0 ? n : undefined,
                    });
                  }}
                />
              </div>
            </div>
            <p className="hint">
              Leave blank to use approximate published per-model rates in the picker and spend
              estimates. A value here overrides every model on this provider.
            </p>
          </details>
          <div className="provider-card-actions">
            <button type="button" className="btn small ghost" disabled={busy} onClick={onRefresh}>
              Refresh models
            </button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={onTest}>
              Test connection
            </button>
            {onRemove ? (
              <button type="button" className="btn small danger ghost" onClick={onRemove}>
                Remove
              </button>
            ) : null}
            {probe ? <span className="hint">{probe}</span> : null}
            {!hasUsableKey(p.apiKey, p.baseUrl, p.kind) ? (
              <span className="hint provider-card-help">Add a key to enable this provider</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ForgeAccountCard({
  account: f,
  expanded,
  oauthBusy,
  oauthPending,
  oauthError,
  oauthUserCode,
  oauthVerificationUri,
  oauthCallback,
  linkedCount,
  lastUsed,
  onToggleExpand,
  onPatch,
  onSignIn,
  onCancelOauth,
  onDisconnect,
  onRemove,
}: {
  account: GitForgeAccount;
  expanded: boolean;
  oauthBusy: boolean;
  oauthPending: boolean;
  oauthError?: string;
  oauthUserCode?: string;
  oauthVerificationUri?: string;
  oauthCallback: string;
  linkedCount: number;
  lastUsed?: string;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<GitForgeAccount>) => void;
  onSignIn: () => void;
  onCancelOauth: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const tokenRef = useRef<HTMLInputElement>(null);
  const status = forgeAccountStatus(f);
  const handle = forgeAccountHandle(f);
  const sso = forgeSupportsSso(f.kind);
  const scopes = forgeOauthScopes(f.kind).split(/\s+/).filter(Boolean).join(" · ");
  const signInLabel = oauthBusy
    ? "Starting…"
    : oauthPending && !oauthError
      ? "Waiting for browser…"
      : f.token
        ? "Re-authenticate"
        : `Sign in with ${forgeLabel(f.kind)}`;

  return (
    <div className={`git-account ${expanded ? "open" : ""}`}>
      <button
        type="button"
        className="git-account-summary"
        aria-expanded={expanded}
        onClick={onToggleExpand}
      >
        <span className="git-account-who">
          <span className={`git-account-avatar ${status.kind}`} aria-hidden>
            {forgeAccountInitials(f)}
          </span>
          <span className="git-account-identity">
            <strong>{handle}</strong>
            <span className="meta">{forgeAccountSubtitle(f)}</span>
          </span>
        </span>
        <span className="git-account-service">
          <strong>{forgeLabel(f.kind)}</strong>
          <span className="meta">{forgeHostLabel(f.kind, f.apiBaseUrl)}</span>
        </span>
        <span className="git-account-status">
          <span className="git-account-status-line">
            <span className={`git-account-dot ${status.kind}`} />
            {status.label}
          </span>
          {lastUsed ? <span className="meta">{lastUsed}</span> : null}
        </span>
        <span className="git-account-chevron">
          <IconChevron expanded={expanded} />
        </span>
      </button>
      {expanded ? (
        <div className="git-account-body">
          <div className="git-account-actions">
            {sso ? (
              <button type="button" className="btn primary" disabled={oauthBusy} onClick={onSignIn}>
                {signInLabel}
              </button>
            ) : null}
            {sso && oauthPending ? (
              <button type="button" className="btn" onClick={onCancelOauth}>
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={() => {
                tokenRef.current?.focus();
                tokenRef.current?.select();
              }}
            >
              Replace token
            </button>
            {sso && f.authMethod === "oauth" && f.token ? (
              <button
                type="button"
                className="btn ghost"
                disabled={oauthBusy}
                onClick={onDisconnect}
              >
                Disconnect
              </button>
            ) : null}
            <button type="button" className="btn danger git-account-remove" onClick={onRemove}>
              Remove
            </button>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Display name</label>
              <input
                value={f.name}
                onChange={(e) => {
                  onPatch({ name: e.target.value });
                }}
              />
            </div>
            <div className="field">
              <label>API URL</label>
              <input
                value={f.apiBaseUrl}
                spellCheck={false}
                onChange={(e) => {
                  onPatch({ apiBaseUrl: e.target.value });
                }}
              />
            </div>
            {sso ? (
              <>
                <div className="field">
                  <label>OAuth client ID</label>
                  <input
                    value={f.oauthClientId ?? ""}
                    spellCheck={false}
                    placeholder="Optional"
                    onChange={(e) => {
                      onPatch({ oauthClientId: e.target.value });
                    }}
                  />
                </div>
                <div className="field">
                  <label>OAuth client secret</label>
                  <input
                    type="password"
                    value={f.oauthClientSecret ?? ""}
                    placeholder="Optional"
                    onChange={(e) => {
                      onPatch({ oauthClientSecret: e.target.value });
                    }}
                  />
                </div>
              </>
            ) : null}
            <div className="field">
              <label>Token</label>
              <input
                ref={tokenRef}
                type="password"
                placeholder="Token"
                value={f.token ?? ""}
                onChange={(e) => {
                  onPatch({ token: e.target.value });
                }}
              />
            </div>
            <div className="field">
              <label>SSH key path</label>
              <input
                value={f.sshKeyPath ?? ""}
                placeholder="Not required when a token is set"
                onChange={(e) => {
                  onPatch({ sshKeyPath: e.target.value });
                }}
              />
            </div>
          </div>
          {sso ? (
            <p className="hint">
              {f.kind === "github"
                ? `Create a GitHub OAuth App with Device Flow enabled. Callback ${oauthCallback}.`
                : f.kind === "gitlab"
                  ? `Create a GitLab OAuth application (confidential) with callback ${oauthCallback} and the api scope.`
                  : `Create a Bitbucket OAuth consumer with callback ${oauthCallback}.`}
            </p>
          ) : null}
          {oauthPending && oauthUserCode && !oauthError ? (
            <p className="hint">
              Enter <span className="oauth-user-code">{oauthUserCode}</span> at{" "}
              {oauthVerificationUri ?? "the verification URL"}, then return here.
            </p>
          ) : null}
          {oauthError ? <p className="hint warn-text">{oauthError}</p> : null}
          <div className="git-account-foot">
            <span>
              Used by {linkedCount} linked repo{linkedCount === 1 ? "" : "s"}
            </span>
            <span className="git-account-scopes">{scopes}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function skillBodyText(body: unknown): string {
  return typeof body === "string" ? body : "";
}

export function SkillCard({
  skill,
  expanded,
  onToggleExpand,
  onPatch,
  onRemove,
}: {
  skill: AgentSkill;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<AgentSkill>) => void;
  onRemove: () => void;
}) {
  const body = skillBodyText(skill.body);
  const slash = `/${skill.name || "name"}`;
  const enabled = skill.enabled !== false;
  return (
    <div className={`provider-card skill-card ${expanded ? "open" : ""} ${enabled ? "on" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className={`provider-dot ${enabled ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{slash}</strong>
            {skill.hint ? <span className="meta">{skill.hint}</span> : null}
            <span className="provider-card-chars">{body.length} chars</span>
          </span>
        </button>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${slash}` : `Expand ${slash}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>Slash name</label>
              <input
                value={skill.name}
                placeholder="review-pr"
                spellCheck={false}
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Title</label>
              <input
                value={skill.title}
                placeholder="PR review"
                onChange={(e) => onPatch({ title: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Hint</label>
            <input
              value={skill.hint}
              placeholder="Load-path review via git_pr_get; JSON verdict"
              onChange={(e) => onPatch({ hint: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea
              rows={6}
              value={body}
              placeholder="Instructions the agent should follow when you type /name"
              spellCheck={false}
              onChange={(e) => onPatch({ body: e.target.value })}
            />
          </div>
          <div className="skill-card-foot">
            <div className="skill-card-enabled">
              <button
                type="button"
                className={`settings-switch ${enabled ? "on" : ""}`}
                role="switch"
                aria-checked={enabled}
                aria-label={`${slash} enabled`}
                onClick={() => onPatch({ enabled: !enabled })}
              />
              Enabled
            </div>
            <button type="button" className="btn small ghost" onClick={onRemove}>
              Delete skill
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const BUILTIN_TEMPLATE_IDS = new Set([
  "ubuntu-24.04",
  "debian-12",
  "omarchy-4",
  "windows-11",
  "windows-10",
]);

export function isBuiltinTemplate(id: string): boolean {
  return BUILTIN_TEMPLATE_IDS.has(id);
}

export function machineImageName(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
}

export function machineReady(template: { isoPath: string }): boolean {
  return Boolean(template.isoPath.trim());
}

export function machineStatusLabel(template: { os: GuestOs; isoPath: string }): string {
  if (machineReady(template)) return machineImageName(template.isoPath);
  if (isWindows(template.os)) return "licensed ISO required";
  return "no image set - won't start";
}

function machineHint(template: VmTemplate): string {
  const passwordNote = isDefaultGuestPassword(
    template.cloudInit?.password ?? template.unattend?.password,
  )
    ? "Still the shipped default. Rotate before the first boot; already-installed disks keep the old password."
    : "Password applies to the next cloud-init, not an existing disk.";
  if (template.os === "windows-11") {
    return `Windows 11 needs a licensed ISO, TPM 2.0, OVMF, and optionally VirtIO. ${passwordNote}`;
  }
  if (template.os === "windows-10") {
    return `Windows 10 needs a licensed ISO and optionally VirtIO. TPM is off by default. ${passwordNote}`;
  }
  if (template.os === "debian") {
    return `Prefer a Debian cloud image (.qcow2/.img). Cloud-init creates the user and desktop. ${passwordNote}`;
  }
  if (template.os === "omarchy") {
    return `Fetch the Omarchy 4 ISO (~6 GB). First boot is an unattended install via a cidata seed (UEFI/OVMF required). ${passwordNote}`;
  }
  return `Cloud image boots as the disk and skips the installer. ${passwordNote}`;
}

function imagePlaceholder(os: GuestOs): string {
  if (isWindows(os)) return "Path to guest ISO";
  if (os === "omarchy") return "Path to Omarchy 4 ISO";
  return "ISO or cloud image (.img, .qcow2)";
}

function DiskImageField({
  label,
  value,
  placeholder,
  fetchLabel,
  fetching,
  onChange,
  onFetch,
}: {
  label: string;
  value: string;
  placeholder: string;
  fetchLabel?: string;
  fetching?: boolean;
  onChange: (value: string) => void;
  onFetch?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<{
    path: string;
    parent: string | null;
    entries: { name: string; path: string; kind?: "dir" | "file" }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, () => setOpen(false), dialogRef);

  async function load(path?: string) {
    setBusy(true);
    setError(null);
    try {
      setListing(await api.browseDiskImages(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list images");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="machine-image-row">
        <input
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setOpen(true);
            void load(value.trim() || undefined);
          }}
        >
          Browse
        </button>
        {onFetch ? (
          <BusyButton
            className="btn small"
            busy={fetching}
            busyLabel="Downloading…"
            onClick={onFetch}
          >
            {fetchLabel}
          </BusyButton>
        ) : null}
      </div>
      {open ? (
        <div
          className="host-folder-picker"
          role="dialog"
          aria-modal="true"
          aria-label={`Choose ${label.toLowerCase()}`}
          ref={dialogRef}
        >
          <p className="host-folder-picker-path">{listing?.path ?? (busy ? "Listing…" : "")}</p>
          <div className="host-folder-picker-list">
            {listing?.parent ? (
              <button type="button" onClick={() => void load(listing.parent ?? undefined)}>
                ../
              </button>
            ) : null}
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => {
                  if (entry.kind === "file") {
                    onChange(entry.path);
                    setOpen(false);
                    return;
                  }
                  void load(entry.path);
                }}
              >
                {entry.kind === "file" ? entry.name : `${entry.name}/`}
              </button>
            ))}
          </div>
          {error ? <InlineError message={error} /> : null}
          <div className="host-folder-picker-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function patchGuestPassword(template: VmTemplate, password: string): VmTemplate {
  const next = { ...template };
  if (next.cloudInit) next.cloudInit = { ...next.cloudInit, password };
  if (next.unattend) next.unattend = { ...next.unattend, password };
  return next;
}

export function MachineCard({
  template,
  expanded,
  fetchingOs,
  fetchingVirtio,
  onToggleExpand,
  onPatch,
  onFetch,
  onFetchVirtio,
  onRemove,
}: {
  template: VmTemplate;
  expanded: boolean;
  fetchingOs: boolean;
  fetchingVirtio: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<VmTemplate> | ((row: VmTemplate) => VmTemplate)) => void;
  onFetch: () => void;
  onFetchVirtio: () => void;
  onRemove?: () => void;
}) {
  const ready = machineReady(template);
  const status = machineStatusLabel(template);
  const { cpuCores, memoryMb, diskSizeGb } = template.hardware;
  return (
    <div className={`machine-row ${expanded ? "open" : ""}`}>
      <button
        type="button"
        className="machine-row-head"
        aria-expanded={expanded}
        onClick={onToggleExpand}
      >
        <span className={`machine-dot ${ready ? "ready" : ""}`} />
        <span className="machine-row-copy">
          <strong>{template.name}</strong>
          <span
            className={`machine-row-status ${ready || isWindows(template.os) ? "" : "missing"}`}
          >
            {status}
          </span>
        </span>
        <span className="machine-row-specs">
          {cpuCores} c · {memoryMb} MB · {diskSizeGb} GB
        </span>
      </button>
      {expanded ? (
        <div className="machine-row-body">
          {!isBuiltinTemplate(template.id) ? (
            <div className="field">
              <label>Name</label>
              <input value={template.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
          ) : null}
          <DiskImageField
            label="Image"
            value={template.isoPath}
            placeholder={imagePlaceholder(template.os)}
            fetchLabel={template.os === "omarchy" ? "Fetch ISO" : "Fetch"}
            fetching={fetchingOs}
            onChange={(isoPath) => onPatch({ isoPath })}
            onFetch={isLinux(template.os) ? onFetch : undefined}
          />
          {isWindows(template.os) ? (
            <DiskImageField
              label="VirtIO driver ISO"
              value={template.virtioIsoPath ?? ""}
              placeholder="virtio-win.iso (optional)"
              fetchLabel="Fetch VirtIO ISO"
              fetching={fetchingVirtio}
              onChange={(virtioIsoPath) => onPatch({ virtioIsoPath })}
              onFetch={onFetchVirtio}
            />
          ) : null}
          <div className="machine-hw">
            <div className="field">
              <label>Cores</label>
              <input
                type="number"
                min={1}
                value={cpuCores}
                onChange={(e) =>
                  onPatch((row) => ({
                    ...row,
                    hardware: { ...row.hardware, cpuCores: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div className="field">
              <label>Memory MB</label>
              <input
                type="number"
                min={512}
                value={memoryMb}
                onChange={(e) =>
                  onPatch((row) => ({
                    ...row,
                    hardware: { ...row.hardware, memoryMb: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div className="field">
              <label>Disk GB</label>
              <input
                type="number"
                min={8}
                value={diskSizeGb}
                onChange={(e) =>
                  onPatch((row) => ({
                    ...row,
                    hardware: { ...row.hardware, diskSizeGb: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div className="field">
              <label>Guest password</label>
              <div className="field-with-action">
                <input
                  type="password"
                  value={template.cloudInit?.password ?? template.unattend?.password ?? ""}
                  autoComplete="new-password"
                  onChange={(e) => onPatch((row) => patchGuestPassword(row, e.target.value))}
                />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onPatch((row) => patchGuestPassword(row, generateGuestPassword()))}
                >
                  Rotate
                </button>
              </div>
            </div>
          </div>
          <p className="hint machine-row-hint">{machineHint(template)}</p>
          {onRemove ? (
            <button type="button" className="btn small danger ghost" onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HostStatusBar({
  hypervisor,
  pathsOpen,
  onTogglePaths,
  onAddMachine,
}: {
  hypervisor: HypervisorStatus | null;
  pathsOpen: boolean;
  onTogglePaths: () => void;
  onAddMachine: () => void;
}) {
  const caps = hypervisor?.capabilities;
  const hostOk = hypervisor?.kind === "qemu" && Boolean(caps?.qemuBinary);
  const ovmf = Boolean(caps?.ovmfCodePath);
  const swtpm = Boolean(caps?.swtpmBinary);
  const hostLabel = hostOk
    ? "Host ready"
    : hypervisor?.kind === "mock"
      ? "Host mock"
      : "Host missing";
  const pathRows = [
    {
      ok: Boolean(caps?.qemuBinary),
      label: caps?.qemuBinary ? `QEMU · ${caps.qemuBinary}` : "QEMU not found",
    },
    {
      ok: Boolean(caps?.ovmfCodePath),
      label: caps?.ovmfCodePath ? `OVMF code · ${caps.ovmfCodePath}` : "OVMF code not found",
    },
    {
      ok: Boolean(caps?.ovmfVarsPath),
      label: caps?.ovmfVarsPath ? `OVMF vars · ${caps.ovmfVarsPath}` : "OVMF vars not found",
    },
    {
      ok: Boolean(caps?.swtpmBinary),
      label: caps?.swtpmBinary ? `swtpm · ${caps.swtpmBinary}` : "swtpm not found",
    },
  ];
  return (
    <div className="machine-board-foot">
      <div className="machine-host-status">
        <span className={`machine-dot ${hostOk ? "ready" : ""}`} />
        <span>{hostLabel}</span>
        <span aria-hidden="true">·</span>
        <span className={ovmf ? "ok" : undefined}>OVMF</span>
        <span aria-hidden="true">·</span>
        <span className={swtpm ? "ok" : undefined}>swtpm</span>
        <button type="button" className="link" onClick={onTogglePaths}>
          paths
        </button>
      </div>
      <button type="button" className="btn small" onClick={onAddMachine}>
        Add machine
      </button>
      {pathsOpen ? (
        <ul className="firmware-list machine-host-paths">
          {pathRows.map((row) => (
            <li key={row.label} className={row.ok ? "ok" : "warn"}>
              {row.ok ? "Ready" : "Missing"} · {row.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FirmwareChecklist({
  hypervisor,
  os,
}: {
  hypervisor: HypervisorStatus | null;
  os: GuestOs;
}) {
  if (hypervisor?.kind !== "qemu") return null;
  const caps = hypervisor.capabilities;
  const rows = [
    {
      ok: Boolean(caps?.ovmfCodePath),
      label: caps?.ovmfCodePath ? `OVMF code · ${caps.ovmfCodePath}` : "OVMF code not found",
    },
    {
      ok: Boolean(caps?.ovmfVarsPath),
      label: caps?.ovmfVarsPath ? `OVMF vars · ${caps.ovmfVarsPath}` : "OVMF vars not found",
    },
    ...(os === "omarchy"
      ? []
      : [
          {
            ok: Boolean(caps?.swtpmBinary),
            label:
              os === "windows-11"
                ? caps?.swtpmBinary
                  ? `swtpm · ${caps.swtpmBinary}`
                  : "swtpm not found (required for Windows 11 TPM)"
                : caps?.swtpmBinary
                  ? `swtpm · ${caps.swtpmBinary}`
                  : "swtpm not found (optional for Windows 10)",
          },
        ]),
  ];
  return (
    <ul className="firmware-list">
      {rows.map((row) => (
        <li key={row.label} className={row.ok ? "ok" : "warn"}>
          {row.ok ? "Ready" : "Missing"} · {row.label}
        </li>
      ))}
    </ul>
  );
}

export function SettingsEmpty({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-empty">
      <p className="settings-empty-title">{title}</p>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </div>
  );
}

export function envLines(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
  }
  return env;
}

export function workerKindLabel(kind: ReturnType<typeof workerKind>): string {
  if (kind === "fargate") return "Fargate";
  if (kind === "cloud") return "Cloud VM";
  return "LAN";
}

export function workerWhereHint(row: WorkerBackend): string {
  if (workerKind(row) === "fargate") {
    return [row.region, row.cluster].filter(Boolean).join(" · ") || "AWS";
  }
  try {
    return new URL(row.url).host;
  } catch {
    return row.url.trim() || "no URL";
  }
}

export function mcpEndpoint(server: McpServerConfig): string {
  return (server.url || server.command).trim() || "no command";
}

export function mcpRuntimeLabel(server: McpServerConfig): string {
  if (server.url?.trim()) return "Host";
  return server.runtime === "guest" ? "Guest" : "Host";
}

export function integrationStatusLabel(row: IntegrationAccount): string {
  if (row.enabled === false) return "Off";
  if (row.kind === "slack") {
    if (slackAccountLinked(row) || row.token?.trim()) {
      if (row.userName) return `Signed in as ${row.userName}`;
      if (row.teamName) return row.teamName;
      return "Connected";
    }
    return "Not connected";
  }
  if (row.kind === "aws") {
    if (!awsCredentialReady(row)) return "Not connected";
    return row.useInstanceMetadata && !row.token?.trim() ? "Connected (IMDS)" : "Connected";
  }
  if (isGoogleIntegrationKind(row.kind)) {
    if (googleAccessToken(row) || row.refreshToken?.trim()) {
      if (row.userName) return `Signed in as ${row.userName}`;
      return "Connected";
    }
    return "Not connected";
  }
  if (row.kind === "kubernetes") {
    if (!kubernetesReady(row)) return "Not connected";
    return row.token?.trim() ? "Connected" : "Connected (proxy)";
  }
  return row.token?.trim() ? "Connected" : "Not connected";
}

export function McpServerCard({
  server,
  expanded,
  hostLocked,
  onToggleExpand,
  onPatch,
  onRemove,
}: {
  server: McpServerConfig;
  expanded: boolean;
  hostLocked?: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<McpServerConfig> | ((row: McpServerConfig) => McpServerConfig)) => void;
  onRemove: () => void;
}) {
  const endpoint = mcpEndpoint(server);
  const runtime = mcpRuntimeLabel(server);
  return (
    <div className={`provider-card ${expanded ? "open" : ""} ${server.enabled ? "on" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className={`provider-dot ${server.enabled ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{server.name || "MCP server"}</strong>
            <span className="meta">
              {server.enabled ? "Enabled" : "Off"} · {runtime} · {endpoint}
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`settings-switch ${server.enabled ? "on" : ""}`}
          role="switch"
          aria-checked={server.enabled}
          aria-label={`${server.name || "MCP server"} enabled`}
          disabled={server.managed}
          onClick={() => {
            if (server.managed) return;
            onPatch({ enabled: !server.enabled });
          }}
        />
        <span className="provider-card-state">{server.enabled ? "Enabled" : "Off"}</span>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${server.name}` : `Expand ${server.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input value={server.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>Command or URL</label>
              <input
                value={server.url || server.command}
                placeholder="/usr/bin/npx or https://mcp.example/sse"
                spellCheck={false}
                onChange={(e) => {
                  const value = e.target.value;
                  onPatch((row) =>
                    value.startsWith("http")
                      ? { ...row, url: value, command: row.command || "mcp" }
                      : { ...row, command: value, url: undefined },
                  );
                }}
              />
            </div>
          </div>
          <div className="field">
            <label>Args (space-separated)</label>
            <input
              value={server.args.join(" ")}
              placeholder="-y @modelcontextprotocol/server-github"
              spellCheck={false}
              onChange={(e) =>
                onPatch((row) => ({
                  ...row,
                  args: e.target.value.trim() ? e.target.value.split(/\s+/) : [],
                }))
              }
            />
          </div>
          <div className="field">
            <label>Environment (KEY=value, one per line)</label>
            <textarea
              rows={3}
              value={envLines(server.env)}
              placeholder={
                "GITHUB_PERSONAL_ACCESS_TOKEN=…\nAWS_ACCESS_KEY_ID=…\nAWS_SECRET_ACCESS_KEY=…\nAWS_SIGV4=execute-api"
              }
              spellCheck={false}
              onChange={(e) => onPatch({ env: parseEnvLines(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Tool allowlist (comma-separated native names)</label>
            <input
              value={(server.allowedTools ?? []).join(", ")}
              placeholder="empty = all tools"
              spellCheck={false}
              onChange={(e) => {
                const allowedTools = e.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                onPatch({ allowedTools: allowedTools.length ? allowedTools : undefined });
              }}
            />
          </div>
          <div className="field">
            <label>Runtime</label>
            <Select
              ariaLabel="Runtime"
              value={server.runtime === "guest" ? "guest" : "host"}
              disabled={Boolean(server.url) || server.managed || hostLocked}
              options={[
                { value: "host", label: "Host (security exception)" },
                { value: "guest", label: "Guest (Docker stdio)" },
              ]}
              onChange={(value) =>
                onPatch((row) => ({
                  ...row,
                  runtime: value === "guest" ? "guest" : "host",
                }))
              }
            />
          </div>
          <label className="hint check">
            <input
              type="checkbox"
              checked={server.preload === true}
              onChange={(e) => onPatch({ preload: e.target.checked })}
            />
            Preload tool schemas
          </label>
          <button
            type="button"
            className="btn small ghost"
            disabled={server.managed}
            onClick={() => {
              if (server.managed) return;
              onRemove();
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function WorkerCard({
  worker,
  expanded,
  busy,
  probe,
  onToggleExpand,
  onPatch,
  onTest,
  onRemove,
}: {
  worker: WorkerBackend;
  expanded: boolean;
  busy: boolean;
  probe?: string;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<WorkerBackend> | ((row: WorkerBackend) => WorkerBackend)) => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const kind = workerKind(worker);
  return (
    <div className={`provider-card ${expanded ? "open" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className="provider-dot on" />
          <span className="provider-card-copy">
            <strong>{worker.name || "Worker"}</strong>
            <span className="meta">
              {workerKindLabel(kind)} · {workerWhereHint(worker)}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${worker.name}` : `Expand ${worker.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input value={worker.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            {kind === "fargate" ? null : (
              <div className="field">
                <label>URL</label>
                <input
                  value={worker.url}
                  placeholder="https://192.168.1.10:7421"
                  spellCheck={false}
                  onChange={(e) => onPatch({ url: e.target.value })}
                />
              </div>
            )}
          </div>
          <div className="field">
            <label>Kind</label>
            <div className="runtime-toggle" role="tablist" aria-label="Worker kind">
              <button
                type="button"
                role="tab"
                aria-selected={kind === "lan"}
                className={kind === "lan" ? "active" : ""}
                onClick={() =>
                  onPatch((row) => {
                    const next = { ...row };
                    delete next.kind;
                    return next;
                  })
                }
              >
                LAN
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === "cloud"}
                className={kind === "cloud" ? "active" : ""}
                onClick={() =>
                  onPatch((row) => {
                    const next = { ...row, kind: "cloud" as const };
                    if (next.idleTtlMs === 0) delete next.idleTtlMs;
                    if (next.destroyOnStop === false) delete next.destroyOnStop;
                    if (!next.allowedImages?.length) {
                      next.allowedImages = [DEFAULT_DOCKER_IMAGE];
                    }
                    return next;
                  })
                }
              >
                Cloud VM
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === "fargate"}
                className={kind === "fargate" ? "active" : ""}
                onClick={() =>
                  onPatch((row) => {
                    const next = { ...row, kind: "fargate" as const };
                    if (next.idleTtlMs === 0) delete next.idleTtlMs;
                    if (next.destroyOnStop === false) delete next.destroyOnStop;
                    if (!next.allowedImages?.length) {
                      next.allowedImages = [DEFAULT_DOCKER_IMAGE];
                    }
                    if (!next.allowedSizes?.length) {
                      next.allowedSizes = [DEFAULT_FARGATE_SIZE];
                    }
                    if (!next.region) next.region = DEFAULT_FARGATE_REGION;
                    if (!next.cluster) next.cluster = DEFAULT_FARGATE_CLUSTER;
                    return next;
                  })
                }
              >
                Fargate
              </button>
            </div>
          </div>
          <div className="field">
            <label>{kind === "fargate" ? "Secret access key" : "Token"}</label>
            <input
              type="password"
              autoComplete="off"
              value={worker.token ?? ""}
              placeholder={
                kind === "fargate" ? "AWS secret access key" : "Printed once when the worker starts"
              }
              onChange={(e) => onPatch({ token: e.target.value })}
            />
          </div>
          {kind === "fargate" ? (
            <>
              <div className="field">
                <label>Access key ID</label>
                <input
                  value={worker.accessKeyId ?? ""}
                  placeholder="AKI…"
                  spellCheck={false}
                  onChange={(e) =>
                    onPatch((row) => {
                      const next = { ...row };
                      const value = e.target.value.trim();
                      if (value) next.accessKeyId = value;
                      else delete next.accessKeyId;
                      return next;
                    })
                  }
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Region</label>
                  <input
                    value={worker.region ?? ""}
                    placeholder={DEFAULT_FARGATE_REGION}
                    spellCheck={false}
                    onChange={(e) =>
                      onPatch((row) => {
                        const next = { ...row };
                        const value = e.target.value.trim();
                        if (value) next.region = value;
                        else delete next.region;
                        return next;
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Cluster</label>
                  <input
                    value={worker.cluster ?? ""}
                    placeholder={DEFAULT_FARGATE_CLUSTER}
                    spellCheck={false}
                    onChange={(e) =>
                      onPatch((row) => {
                        const next = { ...row };
                        const value = e.target.value.trim();
                        if (value) next.cluster = value;
                        else delete next.cluster;
                        return next;
                      })
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label>Task definition</label>
                <input
                  value={worker.taskDefinition ?? ""}
                  placeholder="locus-worker"
                  spellCheck={false}
                  onChange={(e) =>
                    onPatch((row) => {
                      const next = { ...row };
                      const value = e.target.value.trim();
                      if (value) next.taskDefinition = value;
                      else delete next.taskDefinition;
                      return next;
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Subnet (optional)</label>
                <input
                  value={worker.subnet ?? ""}
                  placeholder="subnet-… Locus does not create VPCs"
                  spellCheck={false}
                  onChange={(e) =>
                    onPatch((row) => {
                      const next = { ...row };
                      const value = e.target.value.trim();
                      if (value) next.subnet = value;
                      else delete next.subnet;
                      return next;
                    })
                  }
                />
              </div>
              <div className="field">
                <label>ECS endpoint</label>
                <input
                  value={worker.ecsUrl ?? ""}
                  placeholder="https://ecs.us-east-1.amazonaws.com or a VPC/API Gateway URL"
                  spellCheck={false}
                  onChange={(e) =>
                    onPatch((row) => {
                      const next = { ...row };
                      const value = e.target.value.trim();
                      if (value) next.ecsUrl = value;
                      else delete next.ecsUrl;
                      return next;
                    })
                  }
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label>TLS fingerprint</label>
              <input
                value={worker.fingerprint ?? ""}
                placeholder="sha256:… from worker printout"
                spellCheck={false}
                onChange={(e) => onPatch({ fingerprint: e.target.value })}
              />
            </div>
          )}
          <div className="grid-2">
            <div className="field">
              <label>Idle TTL (minutes)</label>
              <input
                type="number"
                min={workerIsMetered(worker) ? 1 : 0}
                value={Math.round(
                  (typeof worker.idleTtlMs === "number"
                    ? worker.idleTtlMs
                    : DEFAULT_WORKER_IDLE_TTL_MS) / 60_000,
                )}
                onChange={(e) =>
                  onPatch((row) => {
                    const next = { ...row };
                    const minutes = Number(e.target.value);
                    if (!e.target.value.trim() || !Number.isFinite(minutes)) {
                      delete next.idleTtlMs;
                    } else if (workerIsMetered(row) && Math.round(minutes) <= 0) {
                      delete next.idleTtlMs;
                    } else {
                      next.idleTtlMs = Math.max(0, Math.round(minutes)) * 60_000;
                    }
                    return next;
                  })
                }
              />
            </div>
            <div className="field">
              <label>Max concurrent guests</label>
              <input
                type="number"
                min={1}
                placeholder={workerIsMetered(worker) ? "1" : "Unlimited"}
                value={worker.maxConcurrent ?? ""}
                onChange={(e) =>
                  onPatch((row) => {
                    const next = { ...row };
                    const n = Number(e.target.value);
                    if (!e.target.value.trim() || !Number.isFinite(n)) {
                      delete next.maxConcurrent;
                    } else {
                      next.maxConcurrent = Math.max(1, Math.floor(n));
                    }
                    return next;
                  })
                }
              />
            </div>
          </div>
          {kind === "fargate" ? null : (
            <div className="field">
              <label>Hourly USD</label>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder={kind === "cloud" ? "Required" : "Optional"}
                value={worker.hourlyUsd ?? ""}
                onChange={(e) =>
                  onPatch((row) => {
                    const next = { ...row };
                    const n = Number(e.target.value);
                    if (!e.target.value.trim() || !Number.isFinite(n)) {
                      delete next.hourlyUsd;
                    } else {
                      next.hourlyUsd = n;
                    }
                    return next;
                  })
                }
              />
            </div>
          )}
          <div className="field">
            <label>Allowed images</label>
            <textarea
              value={(worker.allowedImages ?? []).join("\n")}
              placeholder={
                workerIsMetered(worker)
                  ? "Required — one image per line"
                  : "Optional — one image per line (empty = any)"
              }
              spellCheck={false}
              rows={3}
              onChange={(e) =>
                onPatch((row) => {
                  const next = { ...row };
                  const images = e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                  if (images.length) next.allowedImages = images;
                  else delete next.allowedImages;
                  return next;
                })
              }
            />
          </div>
          {kind === "fargate" ? (
            <div className="field">
              <label>Allowed sizes</label>
              <textarea
                value={(worker.allowedSizes ?? []).join("\n")}
                placeholder="Required — 0.25-0.5, 0.5-1, 1-2, or 2-4"
                spellCheck={false}
                rows={3}
                onChange={(e) =>
                  onPatch((row) => {
                    const next = { ...row };
                    const sizes = e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    if (sizes.length) next.allowedSizes = sizes;
                    else delete next.allowedSizes;
                    return next;
                  })
                }
              />
            </div>
          ) : null}
          <label className="hint check">
            <input
              type="checkbox"
              checked={workerDestroyOnStop(worker)}
              disabled={workerIsMetered(worker)}
              onChange={(e) =>
                onPatch((row) => {
                  const next = { ...row };
                  if (e.target.checked) delete next.destroyOnStop;
                  else next.destroyOnStop = false;
                  return next;
                })
              }
            />
            Destroy guest on stop
          </label>
          <div className="row-actions">
            {kind === "fargate" ? null : (
              <button type="button" className="btn small" disabled={busy} onClick={onTest}>
                Test connection
              </button>
            )}
            <button type="button" className="btn small danger ghost" onClick={onRemove}>
              Remove
            </button>
          </div>
          {probe ? <p className="hint">{probe}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function NamedEnvironmentCard({
  env,
  expanded,
  onToggleExpand,
  onRename,
  onRemove,
}: {
  env: NamedEnvironment;
  expanded: boolean;
  onToggleExpand: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const summary = namedEnvironmentSummary(env);
  return (
    <div className={`provider-card ${expanded ? "open" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className="provider-dot on" />
          <span className="provider-card-copy">
            <strong>{env.name}</strong>
            <span className="meta">{summary}</span>
          </span>
        </button>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${env.name}` : `Expand ${env.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="field">
            <label>Name</label>
            <input
              aria-label={`Environment ${env.name}`}
              value={env.name}
              maxLength={NAMED_ENV_NAME_MAX}
              onChange={(e) => onRename(e.target.value)}
            />
          </div>
          <p className="hint">{summary}</p>
          <button type="button" className="btn small ghost" onClick={onRemove}>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationCard({
  account,
  expanded,
  oauthBusy,
  oauthPending,
  oauthError,
  oauthCallback,
  onToggleExpand,
  onPatch,
  onSignInSlack,
  onDisconnectSlack,
  onSignInGoogle,
  onDisconnectGoogle,
  onRemove,
}: {
  account: IntegrationAccount;
  expanded: boolean;
  oauthBusy: boolean;
  oauthPending: boolean;
  oauthError?: string;
  oauthCallback: string;
  onToggleExpand: () => void;
  onPatch: (
    patch: Partial<IntegrationAccount> | ((row: IntegrationAccount) => IntegrationAccount),
  ) => void;
  onSignInSlack: () => void;
  onDisconnectSlack: () => void;
  onSignInGoogle: () => void;
  onDisconnectGoogle: () => void;
  onRemove: () => void;
}) {
  const status = integrationStatusLabel(account);
  const connected = status !== "Off" && status !== "Not connected";
  return (
    <div className={`provider-card ${expanded ? "open" : ""} ${connected ? "on" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className={`provider-dot ${connected ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{account.name || integrationLabel(account.kind)}</strong>
            <span className="meta">
              {integrationLabel(account.kind)} · {status}
            </span>
          </span>
        </button>
        <span className="provider-card-state">{status}</span>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${account.name}` : `Expand ${account.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input value={account.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>Service</label>
              <Select
                ariaLabel="Service"
                value={account.kind}
                options={INTEGRATION_KINDS.map((kind) => ({
                  value: kind,
                  label: integrationLabel(kind),
                }))}
                onChange={(value) => {
                  const kind = value as IntegrationKind;
                  if (!isIntegrationKind(kind)) return;
                  onPatch((row) => ({
                    ...row,
                    kind,
                    baseUrl: defaultIntegrationUrl(kind),
                    name: row.name || integrationLabel(kind),
                  }));
                }}
              />
            </div>
          </div>
          <div className="field">
            <label>
              {account.kind === "aws"
                ? "IAM endpoint"
                : account.kind === "kubernetes"
                  ? "API server"
                  : "Base URL"}
            </label>
            <input
              value={account.baseUrl}
              spellCheck={false}
              onChange={(e) => onPatch({ baseUrl: e.target.value })}
            />
          </div>
          {account.kind === "aws" ? (
            <div className="field">
              <label>Access key ID</label>
              <input
                value={account.accessKeyId ?? ""}
                spellCheck={false}
                placeholder="AKIA…"
                onChange={(e) => onPatch({ accessKeyId: e.target.value })}
              />
            </div>
          ) : null}
          <div className="field">
            <label>
              {account.kind === "slack"
                ? "Bot token (legacy)"
                : account.kind === "grafana"
                  ? "API key / service account token"
                  : account.kind === "sentry"
                    ? "Auth token"
                    : account.kind === "miro"
                      ? "REST API token"
                      : account.kind === "figma"
                        ? "Personal access token"
                        : account.kind === "linear"
                          ? "API key"
                          : account.kind === "incidentio"
                            ? "API key"
                            : account.kind === "aws"
                              ? "Secret access key"
                              : account.kind === "portainer"
                                ? "Access token"
                                : isGoogleIntegrationKind(account.kind)
                                  ? "Access token (optional)"
                                  : account.kind === "kubernetes"
                                    ? "Service account token"
                                    : "Token"}
            </label>
            <input
              type="password"
              placeholder={
                account.kind === "jira" || account.kind === "confluence"
                  ? "you@site.com:api-token"
                  : account.kind === "slack"
                    ? "xoxb- leftover webhook-era token"
                    : account.kind === "grafana"
                      ? "glsa_… or Grafana 8.5 API key"
                      : account.kind === "sentry"
                        ? "sntryu_… or organization auth token"
                        : account.kind === "miro"
                          ? "Miro REST token from developers.miro.com"
                          : account.kind === "figma"
                            ? "Figma PAT from figma.com/settings"
                            : account.kind === "linear"
                              ? "lin_api_… from Linear Settings → API"
                              : account.kind === "incidentio"
                                ? "API key from Settings → API keys"
                                : account.kind === "aws"
                                  ? "Leave empty to use IMDS"
                                  : account.kind === "portainer"
                                    ? "Portainer access token (User → My account → Access tokens)"
                                    : isGoogleIntegrationKind(account.kind)
                                      ? "ya29.… from Sign in with Google"
                                      : account.kind === "kubernetes"
                                        ? "Leave empty for kubectl proxy on loopback"
                                        : "Token"
              }
              value={account.token ?? ""}
              onChange={(e) => {
                const token = e.target.value;
                onPatch((row) => ({
                  ...row,
                  token,
                  userToken:
                    row.kind === "slack" && token.trim().startsWith("xoxp-")
                      ? token
                      : row.userToken,
                }));
              }}
            />
          </div>
          {account.tokenWarning ? (
            <p className="hint" data-testid="token-warning">
              Rotate this token: {account.tokenWarning}
            </p>
          ) : null}
          {account.kind === "jira" ? (
            <p className="hint">
              Paste you@example.com:api-token (Atlassian account email, a colon, then the token).
              Use a classic API token without scopes against https://your-site.atlassian.net. Tokens
              created with scopes (read:jira-work / write:jira-work) must use Base URL{" "}
              {`https://api.atlassian.com/ex/jira/{cloudId}`} — a raw token on *.atlassian.net is
              sent as Bearer and Atlassian returns Failed to parse Connect Session Auth Token. Data
              Center PATs are the raw token against your server URL.
            </p>
          ) : null}
          {account.kind === "confluence" ? (
            <p className="hint">
              Paste you@example.com:api-token (Atlassian account email, a colon, then the token).
              Use a classic API token without scopes against https://your-site.atlassian.net (Locus
              adds /wiki). Tokens created with scopes (read:confluence-content.all /
              write:confluence-content) must use Base URL{" "}
              {`https://api.atlassian.com/ex/confluence/{cloudId}`} — a raw token on *.atlassian.net
              is sent as Bearer and Atlassian returns Failed to parse Connect Session Auth Token.
              Data Center PATs are the raw token against your server URL. Agents get
              confluence_search, confluence_get, confluence_create, confluence_update, and
              confluence_comment after Approve on writes.
            </p>
          ) : null}
          {account.kind === "grafana" ? (
            <p className="hint">
              Grafana 8.5 API key or a later service account token with permission to query
              datasources. Agents get grafana_query (Lucene logs from the operator prompt),
              grafana_search, and grafana_get. The Grafana rail opens dashboards as a live grid and
              the log explorer — query Lucene, trace stack frames into linked repos, and Investigate
              with an Ops loop agent.
            </p>
          ) : null}
          {account.kind === "sentry" ? (
            <p className="hint">
              User or organization auth token from sentry.io → Settings → Auth Tokens (event:read,
              project:read, org:read; event:write to resolve). Base URL is https://sentry.io or a
              self-hosted origin. Agents get sentry_search, sentry_get (latest stack),
              sentry_events, sentry_projects, and sentry_update after Approve.
            </p>
          ) : null}
          {account.kind === "miro" ? (
            <p className="hint">
              Create a REST API token at developers.miro.com. Agents get miro_list, miro_get,
              miro_import (then board_upsert), and miro_export after Approve. Export can pass name
              instead of board to create a Miro board.
            </p>
          ) : null}
          {account.kind === "figma" ? (
            <p className="hint">
              Create a personal access token at figma.com → Settings → Security. Agents get
              figma_list, figma_get, figma_images, and figma_comment after Approve. Pass a file key
              or a figma.com/design URL.
            </p>
          ) : null}
          {account.kind === "linear" ? (
            <p className="hint">
              Create a personal API key at linear.app → Settings → API. Base URL is
              https://api.linear.app. Agents get linear_search, linear_get, linear_comment,
              linear_create, and linear_update. Writes wait for Approve.
            </p>
          ) : null}
          {account.kind === "incidentio" ? (
            <p className="hint">
              Create an API key at app.incident.io → Settings → API keys. Base URL is
              https://api.incident.io. Agents get incidentio_search, incidentio_get,
              incidentio_comment, incidentio_create, and incidentio_update. Writes wait for Approve.
            </p>
          ) : null}
          {account.kind === "aws" ? (
            <>
              <div className="field">
                <label>Session token</label>
                <input
                  type="password"
                  placeholder="Optional STS / IMDS session token"
                  value={account.sessionToken ?? ""}
                  onChange={(e) => onPatch({ sessionToken: e.target.value })}
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Region</label>
                  <input
                    value={account.region ?? ""}
                    spellCheck={false}
                    placeholder="us-east-1"
                    onChange={(e) => onPatch({ region: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Assume role ARN</label>
                  <input
                    value={account.roleArn ?? ""}
                    spellCheck={false}
                    placeholder="arn:aws:iam::123:role/Locus"
                    onChange={(e) => onPatch({ roleArn: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>AWS gateway URL</label>
                <input
                  value={account.gatewayUrl ?? ""}
                  spellCheck={false}
                  placeholder="https://abc.execute-api.us-east-1.amazonaws.com/prod"
                  onChange={(e) => onPatch({ gatewayUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>STS endpoint</label>
                <input
                  value={account.stsUrl ?? ""}
                  spellCheck={false}
                  placeholder="https://sts.us-east-1.amazonaws.com or a VPC/API Gateway URL"
                  onChange={(e) => onPatch({ stsUrl: e.target.value })}
                />
              </div>
              <label className="hint check">
                <input
                  type="checkbox"
                  checked={account.useInstanceMetadata === true}
                  onChange={(e) => onPatch({ useInstanceMetadata: e.target.checked })}
                />
                Use instance metadata (IMDS / ECS task role)
              </label>
              <p className="hint">
                Host-side AWS IAM access. Paste an access key, or enable IMDS when Locus itself runs
                on EC2/ECS. Optional Assume role runs STS after those credentials resolve. IAM
                endpoint and STS endpoint keep their full path (PrivateLink or API Gateway). Set AWS
                gateway URL to send both Query APIs through one proxy when the other endpoints are
                still the AWS defaults. execute-api hosts sign as execute-api; VPC endpoints keep
                iam/sts. Agents get aws_sts_identity, aws_iam_list, aws_iam_get, and
                aws_iam_simulate. Keys stay in the vault — never in the guest or the prompt.
              </p>
            </>
          ) : null}
          {account.kind === "portainer" ? (
            <p className="hint">
              Create an access token in Portainer (User → My account → Access tokens). Base URL is
              the Portainer UI origin, for example http://127.0.0.1:9000 or
              https://portainer.example.com. Agents get portainer_endpoints, portainer_containers,
              portainer_inspect, portainer_logs, and portainer_stacks. portainer_container_action
              and portainer_stack_action wait for Approve.
            </p>
          ) : null}
          {account.kind === "gmail" ? (
            <p className="hint">
              Sign in with Google (OAuth client from Google Cloud, redirect {oauthCallback}). Agents
              get gmail_search, gmail_get, and gmail_send after Approve. Scopes: gmail.readonly and
              gmail.send. See docs/google.md.
            </p>
          ) : null}
          {account.kind === "gcal" ? (
            <p className="hint">
              Sign in with Google (OAuth client from Google Cloud, redirect {oauthCallback}). Agents
              get calendar_list, calendar_get, and calendar_create after Approve. Scopes:
              calendar.readonly and calendar.events. See docs/google.md.
            </p>
          ) : null}
          {account.kind === "gdrive" ? (
            <p className="hint">
              Sign in with Google (OAuth client from Google Cloud, redirect {oauthCallback}). Agents
              get drive_list, drive_get, and drive_upload after Approve. Scopes: drive.readonly and
              drive.file. See docs/google.md.
            </p>
          ) : null}
          {account.kind === "kubernetes" ? (
            <p className="hint">
              Kubernetes API server plus a service account bearer token, or http://127.0.0.1:8001
              after kubectl proxy (token optional on loopback). Agents get k8s_list, k8s_get,
              k8s_logs, and k8s_events, plus k8s_apply / k8s_delete / k8s_scale after Approve.
              Secret data is redacted. For kind/minikube self-signed API certs, use kubectl proxy
              instead of HTTPS. Do not paste kubeconfig into chat.
            </p>
          ) : null}
          {account.kind === "slack" ? (
            <>
              <p className="hint">
                Locus reads and sends as you by default. Switch the composer to as Locus, or pass
                as="bot" on slack_post, to post as the app. Create a Slack app from
                docs/slack-app-manifest.yaml (user scopes plus bot commands, chat:write,
                chat:write.public, and files:write). Reinstall and Sign in with Slack again after
                changing scopes. Callback {oauthCallback}. Paste xoxp-mock as the user token for a
                local demo workspace.
              </p>
              {account.userName || account.teamName ? (
                <p className="hint">
                  Signed in as {account.userName || "you"}
                  {account.teamName ? ` · ${account.teamName}` : ""}
                </p>
              ) : null}
              <div className="grid-2">
                <div className="field">
                  <label>OAuth client ID</label>
                  <input
                    value={account.oauthClientId ?? ""}
                    spellCheck={false}
                    placeholder="Slack app client ID"
                    onChange={(e) => onPatch({ oauthClientId: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>OAuth client secret</label>
                  <input
                    type="password"
                    value={account.oauthClientSecret ?? ""}
                    placeholder="Slack app client secret"
                    onChange={(e) => onPatch({ oauthClientSecret: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>User token</label>
                <input
                  type="password"
                  placeholder="xoxp-… or xoxp-mock"
                  value={account.userToken ?? ""}
                  onChange={(e) => onPatch({ userToken: e.target.value })}
                />
              </div>
              <div className="field">
                <label>App token (Socket Mode)</label>
                <input
                  type="password"
                  placeholder="xapp-… for /locus"
                  value={account.appToken ?? ""}
                  onChange={(e) => onPatch({ appToken: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Channel allowlist</label>
                <input
                  value={(account.allowedSlackChannelIds ?? []).join(", ")}
                  spellCheck={false}
                  placeholder="C0123ABCD, C0456EFGH"
                  onChange={(e) =>
                    onPatch((row) => ({
                      ...row,
                      allowedSlackChannelIds: parseSlackChannelAllowlist(e.target.value),
                    }))
                  }
                />
                <p className="hint">
                  Optional. Comma or space separated channel IDs. Empty lets Locus open any
                  conversation you can.
                </p>
              </div>
              {oauthError ? <p className="hint warn-text">{oauthError}</p> : null}
              <div className="row-actions">
                <button className="btn small" disabled={oauthBusy} onClick={onSignInSlack}>
                  {oauthBusy
                    ? "Starting…"
                    : oauthPending && !oauthError
                      ? "Waiting for browser…"
                      : "Sign in with Slack"}
                </button>
                {account.userToken ? (
                  <button className="btn small" disabled={oauthBusy} onClick={onDisconnectSlack}>
                    Disconnect
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          {isGoogleIntegrationKind(account.kind) ? (
            <>
              {account.userName ? <p className="hint">Signed in as {account.userName}</p> : null}
              <div className="grid-2">
                <div className="field">
                  <label>OAuth client ID</label>
                  <input
                    value={account.oauthClientId ?? ""}
                    spellCheck={false}
                    placeholder="Google Cloud OAuth client ID"
                    onChange={(e) => onPatch({ oauthClientId: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>OAuth client secret</label>
                  <input
                    type="password"
                    value={account.oauthClientSecret ?? ""}
                    placeholder="Google Cloud OAuth client secret"
                    onChange={(e) => onPatch({ oauthClientSecret: e.target.value })}
                  />
                </div>
              </div>
              {oauthError ? <p className="hint warn-text">{oauthError}</p> : null}
              <div className="row-actions">
                <button className="btn small" disabled={oauthBusy} onClick={onSignInGoogle}>
                  {oauthBusy
                    ? "Starting…"
                    : oauthPending && !oauthError
                      ? "Waiting for browser…"
                      : "Sign in with Google"}
                </button>
                {googleAccessToken(account) || account.refreshToken ? (
                  <button className="btn small" disabled={oauthBusy} onClick={onDisconnectGoogle}>
                    Disconnect
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          <label className="hint check">
            <input
              type="checkbox"
              checked={account.enabled !== false}
              onChange={(e) => onPatch({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button className="btn small" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationPluginCard({
  plugin,
  expanded,
  onToggleExpand,
  onPatch,
  onPatchConfig,
  onRemove,
}: {
  plugin: IntegrationPlugin;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<IntegrationPlugin>) => void;
  onPatchConfig: (key: string, value: string) => void;
  onRemove: () => void;
}) {
  const enabled = plugin.enabled !== false;
  return (
    <div className={`provider-card ${expanded ? "open" : ""} ${enabled ? "on" : ""}`}>
      <div className="provider-card-head">
        <button
          type="button"
          className="provider-card-summary"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className={`provider-dot ${enabled ? "on" : ""}`} />
          <span className="provider-card-copy">
            <strong>{plugin.name}</strong>
            <span className="meta">
              {plugin.slug}
              {enabled ? " · Enabled" : " · Off"}
            </span>
          </span>
        </button>
        <span className="provider-card-state">{enabled ? "Enabled" : "Off"}</span>
        <button
          type="button"
          className="provider-card-chevron"
          aria-label={expanded ? `Collapse ${plugin.name}` : `Expand ${plugin.name}`}
          onClick={onToggleExpand}
        >
          <IconChevron expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="provider-card-body">
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input value={plugin.name} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>Slug</label>
              <input value={plugin.slug} readOnly spellCheck={false} />
            </div>
          </div>
          {plugin.description ? <p className="hint">{plugin.description}</p> : null}
          {plugin.tools.length ? (
            <p className="hint">
              Tools:{" "}
              {plugin.tools.map((tool) => pluginFunctionName(plugin.slug, tool.name)).join(", ")}
            </p>
          ) : null}
          {plugin.configFields.map((field) => (
            <div className="field" key={field.key}>
              <label>{field.label}</label>
              {field.type === "boolean" ? (
                <label className="hint check">
                  <input
                    type="checkbox"
                    checked={plugin.config?.[field.key] === "true"}
                    onChange={(e) => onPatchConfig(field.key, e.target.checked ? "true" : "")}
                  />
                  {field.help || field.label}
                </label>
              ) : (
                <input
                  type={field.type === "secret" ? "password" : "text"}
                  spellCheck={false}
                  placeholder={field.placeholder}
                  value={plugin.config?.[field.key] ?? ""}
                  onChange={(e) => onPatchConfig(field.key, e.target.value)}
                />
              )}
              {field.help && field.type !== "boolean" ? <p className="hint">{field.help}</p> : null}
            </div>
          ))}
          <label className="hint check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onPatch({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button className="btn small" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function QemuInstallStatus({ progress }: { progress: QemuInstallProgress | null }) {
  if (!progress) return null;
  const label = progress.error
    ? progress.error
    : progress.done
      ? "QEMU installed"
      : `${progress.phase}${progress.percent ? ` · ${progress.percent}%` : ""}`;
  return (
    <div className="qemu-install-progress" data-testid="qemu-install-progress">
      <p className="hint">{label}</p>
      {progress.log.trim() ? <pre className="qemu-install-log">{progress.log}</pre> : null}
    </div>
  );
}

export function MachineInventory({
  vms,
  sessions,
  busyId,
  onOpen,
  onStart,
  onStop,
}: {
  vms: VmInstance[];
  sessions: AgentSession[];
  busyId?: string | null;
  onOpen: (sessionId: string) => void;
  onStart: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
}) {
  const byId = new Map(sessions.map((row) => [row.id, row]));
  return (
    <div className="machine-inventory" data-testid="machine-inventory">
      <h3 className="auto-runs-title">Live machines</h3>
      {vms.length === 0 ? (
        <p className="hint">
          No live machines. Templates below define what new agents can boot. Start an agent to see
          it here.
        </p>
      ) : (
        vms.map((vm) => {
          const session = byId.get(vm.sessionId);
          const live = vm.status === "running" || vm.status === "ready" || vm.status === "paused";
          const starting =
            vm.status === "creating" || vm.status === "booting" || vm.status === "installing";
          const label = session ? sessionDisplayName(session) : vm.name;
          const kind =
            vm.runtime === "docker" || session?.runtime === "docker"
              ? (vm.dockerImage ?? session?.dockerImage ?? "Docker")
              : guestLabel(vm.os);
          return (
            <div key={vm.id} className="machine-inventory-row" data-vm-id={vm.id}>
              <span className={`dot ${statusDot(vm.status)}`} />
              <span className="machine-inventory-copy">
                <strong>{label}</strong>
                <span className="meta">
                  {kind} · {vm.status}
                  {session ? "" : " · no session"}
                </span>
              </span>
              <span className="machine-inventory-actions">
                <button
                  type="button"
                  className="btn small"
                  disabled={!session}
                  onClick={() => session && onOpen(session.id)}
                >
                  Open
                </button>
                {live ? (
                  <BusyButton
                    type="button"
                    className="btn small"
                    busy={busyId === session?.id}
                    busyLabel="Stopping…"
                    disabled={!session}
                    onClick={() => session && onStop(session.id)}
                  >
                    Stop
                  </BusyButton>
                ) : (
                  <BusyButton
                    type="button"
                    className="btn small primary"
                    busy={busyId === session?.id}
                    busyLabel="Starting…"
                    disabled={!session || starting}
                    onClick={() => session && onStart(session.id)}
                  >
                    Start
                  </BusyButton>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function statusDot(status: string): string {
  if (status === "running" || status === "ready") return "running";
  if (status === "error") return "error";
  if (status === "paused") return "paused";
  if (status === "stopped") return "stopped";
  return "provisioning";
}

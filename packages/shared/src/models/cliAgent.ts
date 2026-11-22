/**
 * Custom CLI agent (provider kind `cli-agent`): any coding-agent CLI described as data
 * (command + argv template + output format) instead of a hand-written adapter.
 * Presets live here so desktop (Settings) and server (validation, Turn) share one list.
 */

export type CliAgentOutput = "text" | "jsonl" | "claude-stream-json" | "acp";

export const CLI_AGENT_OUTPUTS: CliAgentOutput[] = ["text", "jsonl", "claude-stream-json", "acp"];

export interface CliAgentConfig {
  /** Executable on PATH (or an absolute path). No shell: argv is passed verbatim. */
  command: string;
  /**
   * Argv template. Placeholders: `{prompt}`, `{model}`, `{workspace}`, `{resume}`.
   * Without `{prompt}` (and for `acp`) the prompt goes to stdin / the ACP session.
   */
  args: string[];
  /** Appended when resuming. `{resume}` is the stored CLI session id. */
  resumeArgs?: string[];
  output: CliAgentOutput;
  /** Extra environment. Secret-looking names are vaulted like MCP server env. */
  env?: Record<string, string>;
  /** Env var that receives the provider API key (e.g. GEMINI_API_KEY). Optional. */
  apiKeyEnv?: string;
  /** Preset id this config started from (drives preset-only extras such as Gemini MCP). */
  preset?: CliAgentPresetId;
}

export type CliAgentPresetId =
  "gemini" | "gemini-acp" | "opencode" | "aider" | "amp" | "copilot" | "custom";

export interface CliAgentPreset {
  id: CliAgentPresetId;
  name: string;
  /** One line for the Settings picker. */
  hint: string;
  cli: CliAgentConfig;
  models: string[];
  defaultModel: string;
}

/**
 * Model id meaning "let the CLI pick". Sessions require a non-empty model, so model-less
 * presets list this; `{model}` expands to nothing (and drops its flag) for it.
 */
export const CLI_AGENT_DEFAULT_MODEL = "default";

/** The model to put in `{model}`, or undefined for the CLI's own default. */
export function cliAgentModelArg(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed && trimmed !== CLI_AGENT_DEFAULT_MODEL ? trimmed : undefined;
}

export const CLI_AGENT_PLACEHOLDERS = ["{prompt}", "{model}", "{workspace}", "{resume}"] as const;

/*
 * Flags below were written from each tool's public docs / --help at the time of writing.
 * Ones we could not run end-to-end are marked UNVERIFIED; users can edit argv in Settings.
 */
export const CLI_AGENT_PRESETS: CliAgentPreset[] = [
  {
    id: "gemini",
    name: "Gemini CLI",
    hint: "gemini -p … --output-format stream-json (headless, JSONL events)",
    cli: {
      command: "gemini",
      // `--output-format stream-json` emits init / message / tool_use / tool_result / result
      // JSONL rows (Gemini CLI headless mode). `--yolo` auto-approves tools, which headless
      // mode otherwise refuses. Resume flags vary by version, so none are set (UNVERIFIED).
      args: ["-p", "{prompt}", "-m", "{model}", "--output-format", "stream-json", "--yolo"],
      output: "jsonl",
      apiKeyEnv: "GEMINI_API_KEY",
      preset: "gemini",
    },
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-2.5-pro",
  },
  {
    id: "gemini-acp",
    name: "Gemini CLI (ACP)",
    hint: "gemini --experimental-acp (Agent Client Protocol over stdio)",
    cli: {
      command: "gemini",
      // ACP mode: Locus speaks JSON-RPC on stdin/stdout, so `{prompt}` is not in argv.
      // The flag name has been `--experimental-acp` since Zed's integration (UNVERIFIED for
      // future versions; some builds also accept `--acp`).
      args: ["--experimental-acp", "-m", "{model}"],
      output: "acp",
      apiKeyEnv: "GEMINI_API_KEY",
      preset: "gemini-acp",
    },
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-2.5-pro",
  },
  {
    id: "opencode",
    name: "OpenCode",
    hint: "opencode run … (plain text output)",
    cli: {
      command: "opencode",
      // `-m provider/model` and `--continue` are in `opencode run --help` (UNVERIFIED across
      // releases). Text output carries no session id, so resume uses `--continue`.
      args: ["run", "{prompt}", "-m", "{model}"],
      resumeArgs: ["--continue"],
      output: "text",
      preset: "opencode",
    },
    models: [CLI_AGENT_DEFAULT_MODEL],
    defaultModel: CLI_AGENT_DEFAULT_MODEL,
  },
  {
    id: "aider",
    name: "Aider",
    hint: "aider --yes-always --no-pretty --message … (plain text output)",
    cli: {
      command: "aider",
      // `--no-auto-commits` keeps commits with Locus (checkpoints, PRs). `--model` takes
      // aider's own model names (e.g. sonnet, gpt-4.1); leave empty for aider's default.
      args: [
        "--yes-always",
        "--no-pretty",
        "--no-auto-commits",
        "--model",
        "{model}",
        "--message",
        "{prompt}",
      ],
      // Aider restores its own chat history file between runs.
      resumeArgs: ["--restore-chat-history"],
      output: "text",
      preset: "aider",
    },
    models: [CLI_AGENT_DEFAULT_MODEL],
    defaultModel: CLI_AGENT_DEFAULT_MODEL,
  },
  {
    id: "amp",
    name: "Amp",
    hint: "amp -x … (execute mode, plain text output)",
    cli: {
      command: "amp",
      // Execute mode. Amp also documents `--stream-json` (Claude Code compatible) and
      // `--dangerously-allow-all`; both are UNVERIFIED here, so the preset stays on text.
      args: ["-x", "{prompt}"],
      output: "text",
      apiKeyEnv: "AMP_API_KEY",
      preset: "amp",
    },
    models: [CLI_AGENT_DEFAULT_MODEL],
    defaultModel: CLI_AGENT_DEFAULT_MODEL,
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    hint: "copilot -p … --allow-all-tools (plain text output)",
    cli: {
      command: "copilot",
      // `--model` choices depend on the Copilot plan (UNVERIFIED list below).
      args: ["-p", "{prompt}", "--allow-all-tools", "--model", "{model}"],
      output: "text",
      preset: "copilot",
    },
    models: [CLI_AGENT_DEFAULT_MODEL, "claude-sonnet-4.5", "gpt-5"],
    defaultModel: CLI_AGENT_DEFAULT_MODEL,
  },
  {
    id: "custom",
    name: "Custom CLI agent",
    hint: "Any CLI: command, argv template, and output format",
    cli: {
      command: "",
      args: ["{prompt}"],
      output: "text",
      preset: "custom",
    },
    models: [CLI_AGENT_DEFAULT_MODEL],
    defaultModel: CLI_AGENT_DEFAULT_MODEL,
  },
];

export function cliAgentPreset(id: string | undefined): CliAgentPreset | undefined {
  return CLI_AGENT_PRESETS.find((row) => row.id === id);
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER_RE = /\{([A-Za-z_]+)\}/g;
const KNOWN_PLACEHOLDERS = new Set(["prompt", "model", "workspace", "resume"]);
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

export function isCliAgentOutput(value: unknown): value is CliAgentOutput {
  return typeof value === "string" && CLI_AGENT_OUTPUTS.includes(value as CliAgentOutput);
}

/** True when the prompt travels in argv rather than stdin / ACP. */
export function cliAgentPromptInArgs(cli: Pick<CliAgentConfig, "args" | "output">): boolean {
  return cli.output !== "acp" && cli.args.some((arg) => arg.includes("{prompt}"));
}

/** Coerce a loosely-typed (JSON) value into a CliAgentConfig without validating it. */
export function normalizeCliAgentConfig(raw: unknown): CliAgentConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const env: Record<string, string> = {};
  if (row.env && typeof row.env === "object" && !Array.isArray(row.env)) {
    for (const [key, value] of Object.entries(row.env as Record<string, unknown>)) {
      const name = key.trim();
      if (!name || typeof value !== "string") continue;
      env[name] = value;
    }
  }
  const resumeArgs = strings(row.resumeArgs);
  const apiKeyEnv = typeof row.apiKeyEnv === "string" ? row.apiKeyEnv.trim() : "";
  const preset = typeof row.preset === "string" ? cliAgentPreset(row.preset)?.id : undefined;
  return {
    command: typeof row.command === "string" ? row.command.trim() : "",
    args: strings(row.args),
    ...(resumeArgs.length ? { resumeArgs } : {}),
    output: isCliAgentOutput(row.output) ? row.output : "text",
    ...(Object.keys(env).length ? { env } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(preset ? { preset } : {}),
  };
}

/** Clear Settings error for a bad Custom CLI agent config, or undefined when it is usable. */
export function cliAgentConfigError(name: string, raw: unknown): string | undefined {
  const label = name.trim() || "Custom CLI agent";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `${label}: pick a preset or set a command`;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.command !== "string" || !row.command.trim()) {
    return `${label}: command is required (e.g. gemini, aider, /usr/local/bin/my-agent)`;
  }
  const command = row.command.trim();
  if (/[\r\n\0]/.test(command)) return `${label}: command cannot contain newlines`;
  if (/\s/.test(command) && !/[\\/]/.test(command)) {
    return `${label}: command is one executable — put flags in args, not "${command}"`;
  }
  if (!isCliAgentOutput(row.output)) {
    return `${label}: output must be one of ${CLI_AGENT_OUTPUTS.join(", ")}`;
  }
  for (const key of ["args", "resumeArgs"] as const) {
    const value = row[key];
    if (value === undefined && key === "resumeArgs") continue;
    if (!Array.isArray(value) || value.some((arg) => typeof arg !== "string")) {
      return `${label}: ${key} must be a list of strings`;
    }
    if (value.length > MAX_ARGS) return `${label}: ${key} has more than ${MAX_ARGS} entries`;
    for (const arg of value as string[]) {
      if (arg.length > MAX_ARG_LENGTH) return `${label}: an argument in ${key} is too long`;
      if (arg.includes("\0")) return `${label}: ${key} cannot contain NUL bytes`;
      for (const match of arg.matchAll(PLACEHOLDER_RE)) {
        if (!KNOWN_PLACEHOLDERS.has(match[1]!)) {
          return `${label}: unknown placeholder {${match[1]}} — use {prompt}, {model}, {workspace}, or {resume}`;
        }
      }
    }
  }
  const args = row.args as string[];
  const resumeArgs = (row.resumeArgs as string[] | undefined) ?? [];
  if (row.output === "acp" && [...args, ...resumeArgs].some((arg) => arg.includes("{prompt}"))) {
    return `${label}: ACP agents receive the prompt over JSON-RPC — remove {prompt} from args`;
  }
  if (resumeArgs.some((arg) => arg.includes("{prompt}"))) {
    return `${label}: {prompt} belongs in args, not resumeArgs`;
  }
  if (row.env !== undefined) {
    if (!row.env || typeof row.env !== "object" || Array.isArray(row.env)) {
      return `${label}: env must be an object of NAME → value`;
    }
    for (const [key, value] of Object.entries(row.env as Record<string, unknown>)) {
      if (!ENV_NAME_RE.test(key.trim())) return `${label}: env name "${key}" is not valid`;
      if (typeof value !== "string") return `${label}: env ${key} must be a string`;
    }
  }
  if (row.apiKeyEnv !== undefined && row.apiKeyEnv !== "") {
    if (typeof row.apiKeyEnv !== "string" || !ENV_NAME_RE.test(row.apiKeyEnv.trim())) {
      return `${label}: API key env var must be a NAME like GEMINI_API_KEY`;
    }
  }
  return undefined;
}

/** Split a Settings argv text field into args. Whitespace-separated; quotes group. */
export function parseCliArgsText(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Inverse of parseCliArgsText for display. */
export function formatCliArgsText(args: string[]): string {
  return args
    .map((arg) => (arg === "" || /[\s"']/.test(arg) ? `"${arg.replace(/"/g, "'")}"` : arg))
    .join(" ");
}

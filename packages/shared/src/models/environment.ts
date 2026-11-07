export interface LocusEnvironment {
  packages?: string[];
  /** Idempotent repo bootstrap after checkout (`npm ci`, `pip install`, …). */
  install?: string;
  ports?: number[];
  start?: string;
  image?: string;
  env?: Record<string, string>;
}

export function parseLocusEnvironment(raw: unknown): LocusEnvironment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const packages = Array.isArray(value.packages)
    ? value.packages
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
    : undefined;
  const ports = parseEnvironmentPorts(value.ports);
  const declaredInstall =
    typeof value.install === "string" && value.install.trim() ? value.install.trim() : undefined;
  const declaredStart =
    typeof value.start === "string" && value.start.trim() ? value.start.trim() : undefined;
  const terminalStart = firstTerminalCommand(value.terminals);
  const start = terminalStart ?? declaredStart;
  const install =
    terminalStart && declaredStart
      ? [declaredInstall, declaredStart].filter(Boolean).join(" && ") || undefined
      : declaredInstall;
  const image =
    typeof value.image === "string" && value.image.trim() ? value.image.trim() : undefined;
  const env: Record<string, string> = {};
  if (value.env && typeof value.env === "object" && !Array.isArray(value.env)) {
    for (const [key, item] of Object.entries(value.env as Record<string, unknown>)) {
      if (typeof item === "string" && key.trim()) env[key.trim()] = item;
    }
  }
  if (
    !packages?.length &&
    !ports?.length &&
    !install &&
    !start &&
    !image &&
    !Object.keys(env).length
  )
    return undefined;
  return {
    packages: packages?.length ? packages : undefined,
    install,
    ports: ports?.length ? ports : undefined,
    start,
    image,
    env: Object.keys(env).length ? env : undefined,
  };
}

function parseEnvironmentPorts(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ports: number[] = [];
  for (const item of raw) {
    const n =
      typeof item === "number"
        ? item
        : item && typeof item === "object" && typeof (item as { port?: unknown }).port === "number"
          ? (item as { port: number }).port
          : undefined;
    if (typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536) ports.push(n);
  }
  return ports.length ? ports : undefined;
}

function firstTerminalCommand(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const command = (row as { command?: unknown }).command;
    if (typeof command === "string" && command.trim()) return command.trim();
  }
  return undefined;
}

export function environmentInstallCommand(env: LocusEnvironment): string | undefined {
  const parts: string[] = [];
  if (env.packages?.length) {
    const pkgs = env.packages.map((pkg) => pkg.replace(/[^A-Za-z0-9._+-]/g, "")).filter(Boolean);
    if (pkgs.length) {
      parts.push(
        `(command -v apt-get >/dev/null && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs.join(" ")}) || (command -v apk >/dev/null && apk add --no-cache ${pkgs.join(" ")}) || true`,
      );
    }
  }
  const install = env.install?.trim();
  if (install) parts.push(`(${install})`);
  return parts.length ? parts.join(" && ") : undefined;
}

export function formatSetupPrompt(input: {
  prompt: string;
  repoName: string;
  repoUrl: string;
}): string {
  return [
    input.prompt.trim(),
    "",
    `Repo: ${input.repoUrl}`,
    `${input.repoName} is already cloned at /workspace when this chat starts. Do not git_clone again unless the workspace is empty.`,
    "Write durable setup to .locus/environment.json so later agents install, start, and preview without rediscovering the repo.",
  ].join("\n");
}

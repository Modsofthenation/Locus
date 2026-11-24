import type { Automation, LocusConfig, VmInstance } from "@locus/shared";
import {
  isDefaultGuestPassword,
  isMaskedSecret,
  looksLikeSecretName,
  pluginFieldIsSecret,
  redactText,
  resolveThemeRef,
  workerKind,
  workerProvisionsCompute,
} from "@locus/shared";

function redactPassword(value: string): string {
  if (!value || isDefaultGuestPassword(value)) return value;
  return "••••••••";
}

export function redactConfig(config: LocusConfig): LocusConfig {
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? "••••••••" : "",
      ...(p.cli?.env
        ? {
            cli: {
              ...p.cli,
              env: Object.fromEntries(
                Object.entries(p.cli.env).map(([key, value]) => [
                  key,
                  looksLikeSecretName(key) && value ? "••••••••" : value,
                ]),
              ),
            },
          }
        : {}),
    })),
    forges: config.forges.map((f) => ({
      ...f,
      token: f.token ? "••••••••" : undefined,
      refreshToken: f.refreshToken ? "••••••••" : undefined,
      oauthClientSecret: f.oauthClientSecret ? "••••••••" : undefined,
    })),
    integrations: (config.integrations ?? []).map((row) => ({
      ...row,
      token: row.token ? "••••••••" : undefined,
      sessionToken: row.sessionToken ? "••••••••" : undefined,
      userToken: row.userToken ? "••••••••" : undefined,
      appToken: row.appToken ? "••••••••" : undefined,
      oauthClientSecret: row.oauthClientSecret ? "••••••••" : undefined,
      refreshToken: row.refreshToken ? "••••••••" : undefined,
    })),
    integrationPlugins: (config.integrationPlugins ?? []).map((plugin) => ({
      ...plugin,
      config: Object.fromEntries(
        Object.entries(plugin.config ?? {}).map(([key, value]) => {
          const field = plugin.configFields.find((row) => row.key === key);
          return [key, field && pluginFieldIsSecret(field) && value ? "••••••••" : value];
        }),
      ),
    })),
    templates: config.templates.map((t) => ({
      ...t,
      cloudInit: t.cloudInit
        ? {
            ...t.cloudInit,
            password:
              t.cloudInit.password === undefined ? undefined : redactPassword(t.cloudInit.password),
          }
        : t.cloudInit,
      unattend: t.unattend
        ? { ...t.unattend, password: redactPassword(t.unattend.password) }
        : t.unattend,
    })),
    mcpServers: (config.mcpServers ?? []).map((server) => ({
      ...server,
      env: Object.fromEntries(
        Object.entries(server.env ?? {}).map(([key, value]) => [
          key,
          looksLikeSecretName(key) && value ? "••••••••" : value,
        ]),
      ),
    })),
    workers: (config.workers ?? []).map((row) => ({
      ...row,
      token: row.token ? "••••••••" : undefined,
    })),
    phoneRemote: config.phoneRemote
      ? {
          enabled: config.phoneRemote.enabled,
          token: config.phoneRemote.token ? "••••••••" : undefined,
        }
      : config.phoneRemote,
    chromeExtension: config.chromeExtension
      ? {
          enabled: config.chromeExtension.enabled,
          token: config.chromeExtension.token ? "••••••••" : undefined,
        }
      : config.chromeExtension,
    advanced: {
      ...config.advanced,
      slackSigningSecret: config.advanced.slackSigningSecret
        ? "••••••••"
        : config.advanced.slackSigningSecret,
    },
    telemetry: config.telemetry?.headers
      ? {
          ...config.telemetry,
          headers: Object.fromEntries(
            Object.entries(config.telemetry.headers).map(([key, value]) => [
              key,
              value ? "••••••••" : value,
            ]),
          ),
        }
      : config.telemetry,
  };
}

export function mergeSecrets(current: LocusConfig, incoming: LocusConfig): LocusConfig {
  const keys = new Map(current.providers.map((p) => [p.id, p.apiKey]));
  const tokens = new Map(current.forges.map((f) => [f.id, f.token]));
  const refreshTokens = new Map(current.forges.map((f) => [f.id, f.refreshToken]));
  const oauthSecrets = new Map(current.forges.map((f) => [f.id, f.oauthClientSecret]));
  const integrationTokens = new Map((current.integrations ?? []).map((row) => [row.id, row.token]));
  const integrationSessionTokens = new Map(
    (current.integrations ?? []).map((row) => [row.id, row.sessionToken]),
  );
  const slackUserTokens = new Map(
    (current.integrations ?? []).map((row) => [row.id, row.userToken]),
  );
  const slackAppTokens = new Map((current.integrations ?? []).map((row) => [row.id, row.appToken]));
  const integrationOauthSecrets = new Map(
    (current.integrations ?? []).map((row) => [row.id, row.oauthClientSecret]),
  );
  const integrationRefreshTokens = new Map(
    (current.integrations ?? []).map((row) => [row.id, row.refreshToken]),
  );
  const workers = new Map((current.workers ?? []).map((row) => [row.id, row]));
  const templates = new Map(current.templates.map((t) => [t.id, t]));
  const customThemes = incoming.customThemes ?? current.customThemes ?? [];
  return {
    ...incoming,
    customThemes,
    theme: resolveThemeRef(incoming.theme ?? current.theme, customThemes),
    hardwareProfiles: incoming.hardwareProfiles ?? current.hardwareProfiles ?? [],
    providers: incoming.providers.map((p) => {
      const apiKey = isMaskedSecret(p.apiKey) ? keys.get(p.id) : p.apiKey;
      if (!p.cli?.env) return { ...p, apiKey };
      const prev = current.providers.find((row) => row.id === p.id)?.cli?.env;
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(p.cli.env)) {
        env[key] = isMaskedSecret(value) ? (prev?.[key] ?? value) : value;
      }
      return { ...p, apiKey, cli: { ...p.cli, env } };
    }),
    forges: incoming.forges.map((f) => ({
      ...f,
      token: isMaskedSecret(f.token) ? tokens.get(f.id) : f.token,
      refreshToken: isMaskedSecret(f.refreshToken) ? refreshTokens.get(f.id) : f.refreshToken,
      oauthClientSecret: isMaskedSecret(f.oauthClientSecret)
        ? oauthSecrets.get(f.id)
        : f.oauthClientSecret,
    })),
    integrations: (incoming.integrations ?? current.integrations ?? []).map((row) => ({
      ...row,
      token: isMaskedSecret(row.token) ? integrationTokens.get(row.id) : row.token,
      sessionToken: isMaskedSecret(row.sessionToken)
        ? integrationSessionTokens.get(row.id)
        : row.sessionToken,
      userToken: isMaskedSecret(row.userToken) ? slackUserTokens.get(row.id) : row.userToken,
      appToken: isMaskedSecret(row.appToken) ? slackAppTokens.get(row.id) : row.appToken,
      oauthClientSecret: isMaskedSecret(row.oauthClientSecret)
        ? integrationOauthSecrets.get(row.id)
        : row.oauthClientSecret,
      refreshToken: isMaskedSecret(row.refreshToken)
        ? integrationRefreshTokens.get(row.id)
        : row.refreshToken,
    })),
    templates: incoming.templates.map((t) => {
      const prev = templates.get(t.id);
      return {
        ...t,
        cloudInit: t.cloudInit
          ? {
              ...t.cloudInit,
              password: isMaskedSecret(t.cloudInit.password)
                ? (prev?.cloudInit?.password ?? t.cloudInit.password)
                : t.cloudInit.password,
            }
          : t.cloudInit,
        unattend: t.unattend
          ? {
              ...t.unattend,
              password: isMaskedSecret(t.unattend.password)
                ? (prev?.unattend?.password ?? t.unattend.password)
                : t.unattend.password,
            }
          : t.unattend,
      };
    }),
    skills: incoming.skills ?? current.skills ?? [],
    integrationPlugins: (incoming.integrationPlugins ?? current.integrationPlugins ?? []).map(
      (plugin) => {
        const prev = (current.integrationPlugins ?? []).find((row) => row.id === plugin.id);
        const config: Record<string, string> = {};
        for (const [key, value] of Object.entries(plugin.config ?? {})) {
          const field = plugin.configFields.find((row) => row.key === key);
          config[key] =
            field && pluginFieldIsSecret(field) && isMaskedSecret(value)
              ? (prev?.config?.[key] ?? value)
              : value;
        }
        return { ...plugin, config: Object.keys(config).length ? config : undefined };
      },
    ),
    mcpServers: (incoming.mcpServers ?? current.mcpServers ?? []).map((server) => {
      const prev = (current.mcpServers ?? []).find((s) => s.id === server.id);
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.env ?? {})) {
        env[key] = isMaskedSecret(value) ? (prev?.env?.[key] ?? value) : value;
      }
      return { ...server, env };
    }),
    workers: (incoming.workers ?? current.workers ?? []).map((row) => {
      const previous = workers.get(row.id);
      const sameTransport =
        previous &&
        (workerKind(previous) === workerKind(row) ||
          (!workerProvisionsCompute(previous) && !workerProvisionsCompute(row)));
      return {
        ...row,
        token: isMaskedSecret(row.token) ? (sameTransport ? previous.token : undefined) : row.token,
      };
    }),
    phoneRemote: isMaskedSecret(incoming.phoneRemote?.token)
      ? current.phoneRemote
      : incoming.phoneRemote
        ? {
            enabled: incoming.phoneRemote.enabled,
            token: incoming.phoneRemote.token,
          }
        : current.phoneRemote,
    chromeExtension: isMaskedSecret(incoming.chromeExtension?.token)
      ? current.chromeExtension
      : incoming.chromeExtension
        ? {
            enabled: incoming.chromeExtension.enabled,
            token: incoming.chromeExtension.token,
          }
        : current.chromeExtension,
    advanced: {
      ...incoming.advanced,
      slackSigningSecret: isMaskedSecret(incoming.advanced.slackSigningSecret)
        ? current.advanced.slackSigningSecret
        : incoming.advanced.slackSigningSecret,
    },
    telemetry: incoming.telemetry?.headers
      ? {
          ...incoming.telemetry,
          headers: Object.fromEntries(
            Object.entries(incoming.telemetry.headers).map(([key, value]) => [
              key,
              isMaskedSecret(value) ? (current.telemetry?.headers?.[key] ?? "") : value,
            ]),
          ),
        }
      : incoming.telemetry,
  };
}

export function redactAutomation(item: Automation): Automation {
  return {
    ...item,
    webhookSecret: item.webhookSecret ? "••••••••" : item.webhookSecret,
    slackSigningSecret: item.slackSigningSecret ? "••••••••" : item.slackSigningSecret,
  };
}

export function redactVm(vm: VmInstance): VmInstance {
  if (!vm.winrm?.password) return vm;
  return {
    ...vm,
    winrm: { ...vm.winrm, password: "••••••••" },
  };
}

export function redactTool(
  name: string,
  args: Record<string, unknown>,
  output: string,
  extraSecrets: string[] = [],
) {
  const secrets = [typeof args.token === "string" ? args.token : "", ...extraSecrets].filter(
    Boolean,
  );
  const nextArgs = { ...args };
  if ("token" in nextArgs) delete nextArgs.token;
  if (typeof nextArgs.url === "string") nextArgs.url = redactText(nextArgs.url, secrets);
  return {
    name,
    args: nextArgs,
    output: redactText(output, secrets),
  };
}

export function configSecretValues(config: LocusConfig): string[] {
  const out: string[] = [];
  const add = (value?: string) => {
    const secret = value?.trim();
    if (secret && secret.length >= 8 && !isMaskedSecret(secret)) out.push(secret);
  };
  for (const provider of config.providers) {
    add(provider.apiKey);
    for (const [key, value] of Object.entries(provider.cli?.env ?? {})) {
      if (looksLikeSecretName(key)) add(value);
    }
  }
  for (const forge of config.forges) {
    add(forge.token);
    add(forge.refreshToken);
    add(forge.oauthClientSecret);
  }
  for (const row of config.integrations ?? []) {
    add(row.token);
    add(row.userToken);
    add(row.appToken);
    add(row.oauthClientSecret);
    add(row.refreshToken);
  }
  for (const plugin of config.integrationPlugins ?? []) {
    for (const field of plugin.configFields) {
      if (pluginFieldIsSecret(field)) add(plugin.config?.[field.key]);
    }
  }
  for (const value of Object.values(config.telemetry?.headers ?? {})) add(value);
  for (const server of config.mcpServers ?? []) {
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (looksLikeSecretName(key)) add(value);
    }
  }
  for (const worker of config.workers ?? []) add(worker.token);
  add(config.phoneRemote?.token);
  add(config.chromeExtension?.token);
  add(config.advanced.slackSigningSecret);
  for (const template of config.templates) {
    add(template.cloudInit?.password);
    add(template.unattend?.password);
  }
  return [...new Set(out)];
}

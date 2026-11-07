import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { looksLikeSecretName, pluginFieldIsSecret, type LocusConfig } from "@locus/shared";

const KEY_FILE = "master.key";
const SALT_FILE = "master.salt";
const VAULT_FILE = "secrets.enc";
const MAGIC = "locus1";
/** Historical scrypt salt for passphrase-derived keys before master.salt existed. */
const LEGACY_SCRYPT_SALT = Buffer.from("locus-vault");

export interface SecretBundle {
  providerKeys: Record<string, string>;
  forgeTokens: Record<string, string>;
  forgeRefreshTokens: Record<string, string>;
  forgeOAuthSecrets: Record<string, string>;
  integrationTokens: Record<string, string>;
  integrationSessionTokens: Record<string, string>;
  slackUserTokens: Record<string, string>;
  slackAppTokens: Record<string, string>;
  integrationOAuthSecrets: Record<string, string>;
  integrationRefreshTokens: Record<string, string>;
  templatePasswords: Record<string, { cloudInit?: string; unattend?: string }>;
  mcpEnv: Record<string, Record<string, string>>;
  workerTokens: Record<string, string>;
  pluginSecrets: Record<string, Record<string, string>>;
  slackSigningSecret?: string;
  phoneRemoteToken?: string;
  chromeExtensionToken?: string;
}

export function emptySecrets(): SecretBundle {
  return {
    providerKeys: {},
    forgeTokens: {},
    forgeRefreshTokens: {},
    forgeOAuthSecrets: {},
    integrationTokens: {},
    integrationSessionTokens: {},
    slackUserTokens: {},
    slackAppTokens: {},
    integrationOAuthSecrets: {},
    integrationRefreshTokens: {},
    templatePasswords: {},
    mcpEnv: {},
    workerTokens: {},
    pluginSecrets: {},
  };
}

export async function loadOrCreateMasterKey(dataDir: string): Promise<Buffer> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const fromEnv = process.env.LOCUS_MASTER_KEY?.trim();
  if (fromEnv) return deriveMasterKey(dataDir, fromEnv);
  const path = join(dataDir, KEY_FILE);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) {
      const info = await stat(path).catch(() => undefined);
      if (info && (info.mode & 0o077) !== 0) await chmod(path, 0o600).catch(() => undefined);
      return deriveMasterKey(dataDir, existing);
    }
  } catch {
    /* create */
  }
  const secret = randomBytes(32).toString("hex");
  await writeSecretFile(path, `${secret}\n`);
  return keyFromMaterial(secret);
}

function isRawKeyMaterial(material: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(material.replace(/\s+/g, ""));
}

function keyFromMaterial(material: string, salt: Buffer = LEGACY_SCRYPT_SALT): Buffer {
  const hex = material.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  return scryptSync(material, salt, 32);
}

async function writeSecretFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readSaltFile(dataDir: string): Promise<Buffer | undefined> {
  try {
    const hex = (await readFile(join(dataDir, SALT_FILE), "utf8")).trim().replace(/\s+/g, "");
    if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, "hex");
  } catch {
    /* missing or unreadable */
  }
  return undefined;
}

async function writeSaltFile(dataDir: string, salt: Buffer): Promise<void> {
  await writeSecretFile(join(dataDir, SALT_FILE), `${salt.toString("hex")}\n`);
}

async function vaultFilePresent(dataDir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dataDir, VAULT_FILE), "utf8");
    return Boolean(raw.trim());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Hex keys are used as-is. Passphrases scrypt with a per-install salt in master.salt. */
async function deriveMasterKey(dataDir: string, material: string): Promise<Buffer> {
  if (isRawKeyMaterial(material)) return keyFromMaterial(material);
  const stored = await readSaltFile(dataDir);
  if (stored) return keyFromMaterial(material, stored);
  if (await vaultFilePresent(dataDir)) {
    const legacyKey = keyFromMaterial(material, LEGACY_SCRYPT_SALT);
    try {
      const secrets = await readVaultFile(dataDir, legacyKey);
      if (secrets) {
        const salt = randomBytes(16);
        const nextKey = keyFromMaterial(material, salt);
        await writeVaultFile(dataDir, nextKey, secrets);
        await writeSaltFile(dataDir, salt);
        return nextKey;
      }
    } catch {
      /* wrong passphrase or corrupt vault; keep the legacy key so the store can fail closed */
    }
    return legacyKey;
  }
  const salt = randomBytes(16);
  await writeSaltFile(dataDir, salt);
  return keyFromMaterial(material, salt);
}

export function encryptVault(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [MAGIC, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(
    ".",
  );
}

export function decryptVault(payload: string, key: Buffer): string {
  const parts = payload.trim().split(".");
  if (parts.length !== 4 || parts[0] !== MAGIC) throw new Error("Unrecognized secrets file");
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const data = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function extractSecrets(config: LocusConfig): {
  config: LocusConfig;
  secrets: SecretBundle;
} {
  const secrets = emptySecrets();
  const providers = config.providers.map((p) => {
    const key = p.apiKey?.trim();
    if (key) secrets.providerKeys[p.id] = key;
    return { ...p, apiKey: key ? "" : p.apiKey };
  });
  const forges = config.forges.map((f) => {
    const token = f.token?.trim();
    if (token) secrets.forgeTokens[f.id] = token;
    const refresh = f.refreshToken?.trim();
    if (refresh) secrets.forgeRefreshTokens[f.id] = refresh;
    const oauthSecret = f.oauthClientSecret?.trim();
    if (oauthSecret) secrets.forgeOAuthSecrets[f.id] = oauthSecret;
    return {
      ...f,
      token: token ? undefined : f.token,
      refreshToken: refresh ? undefined : f.refreshToken,
      oauthClientSecret: oauthSecret ? undefined : f.oauthClientSecret,
    };
  });
  const integrations = (config.integrations ?? []).map((row) => {
    const token = row.token?.trim();
    if (token) secrets.integrationTokens[row.id] = token;
    const sessionToken = row.sessionToken?.trim();
    if (sessionToken) secrets.integrationSessionTokens[row.id] = sessionToken;
    const userToken = row.userToken?.trim();
    if (userToken) secrets.slackUserTokens[row.id] = userToken;
    const appToken = row.appToken?.trim();
    if (appToken) secrets.slackAppTokens[row.id] = appToken;
    const oauthSecret = row.oauthClientSecret?.trim();
    if (oauthSecret) secrets.integrationOAuthSecrets[row.id] = oauthSecret;
    const refresh = row.refreshToken?.trim();
    if (refresh) secrets.integrationRefreshTokens[row.id] = refresh;
    return {
      ...row,
      token: token ? undefined : row.token,
      sessionToken: sessionToken ? undefined : row.sessionToken,
      userToken: userToken ? undefined : row.userToken,
      appToken: appToken ? undefined : row.appToken,
      oauthClientSecret: oauthSecret ? undefined : row.oauthClientSecret,
      refreshToken: refresh ? undefined : row.refreshToken,
    };
  });
  const templates = config.templates.map((t) => {
    const cloud = t.cloudInit?.password?.trim();
    const unattend = t.unattend?.password?.trim();
    if (cloud || unattend) {
      secrets.templatePasswords[t.id] = {
        cloudInit: cloud || undefined,
        unattend: unattend || undefined,
      };
    }
    return {
      ...t,
      cloudInit: t.cloudInit
        ? { ...t.cloudInit, password: cloud ? "" : t.cloudInit.password }
        : t.cloudInit,
      unattend: t.unattend
        ? { ...t.unattend, password: unattend ? "" : t.unattend.password }
        : t.unattend,
    };
  });
  const mcpServers = (config.mcpServers ?? []).map((server) => {
    const env: Record<string, string> = {};
    const stored: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (!value) continue;
      if (looksLikeSecretName(key)) stored[key] = value;
      else env[key] = value;
    }
    if (Object.keys(stored).length) secrets.mcpEnv[server.id] = stored;
    return { ...server, env };
  });
  const integrationPlugins = (config.integrationPlugins ?? []).map((plugin) => {
    const configValues: Record<string, string> = {};
    const stored: Record<string, string> = {};
    for (const field of plugin.configFields) {
      const value = plugin.config?.[field.key]?.trim();
      if (!value) continue;
      if (pluginFieldIsSecret(field)) stored[field.key] = value;
      else configValues[field.key] = value;
    }
    if (Object.keys(stored).length) secrets.pluginSecrets[plugin.id] = stored;
    return {
      ...plugin,
      config: Object.keys(configValues).length ? configValues : undefined,
    };
  });
  const slackSigningSecret = config.advanced.slackSigningSecret?.trim();
  if (slackSigningSecret) secrets.slackSigningSecret = slackSigningSecret;
  const phoneToken = config.phoneRemote?.token?.trim();
  if (phoneToken) secrets.phoneRemoteToken = phoneToken;
  const chromeToken = config.chromeExtension?.token?.trim();
  if (chromeToken) secrets.chromeExtensionToken = chromeToken;
  const workers = (config.workers ?? []).map((row) => {
    const token = row.token?.trim();
    if (token) secrets.workerTokens[row.id] = token;
    return { ...row, token: token ? undefined : row.token };
  });
  return {
    config: {
      ...config,
      providers,
      forges,
      integrations,
      integrationPlugins,
      templates,
      mcpServers,
      workers,
      advanced: {
        ...config.advanced,
        slackSigningSecret: slackSigningSecret ? "" : config.advanced.slackSigningSecret,
      },
      phoneRemote: config.phoneRemote
        ? { enabled: config.phoneRemote.enabled }
        : config.phoneRemote,
      chromeExtension: config.chromeExtension
        ? { enabled: config.chromeExtension.enabled }
        : config.chromeExtension,
    },
    secrets,
  };
}

export function applySecrets(config: LocusConfig, secrets: SecretBundle): LocusConfig {
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: secrets.providerKeys[p.id] || p.apiKey,
    })),
    forges: config.forges.map((f) => ({
      ...f,
      token: secrets.forgeTokens[f.id] || f.token,
      refreshToken: secrets.forgeRefreshTokens[f.id] || f.refreshToken,
      oauthClientSecret: secrets.forgeOAuthSecrets[f.id] || f.oauthClientSecret,
    })),
    integrations: (config.integrations ?? []).map((row) => ({
      ...row,
      token: secrets.integrationTokens[row.id] || row.token,
      sessionToken: secrets.integrationSessionTokens[row.id] || row.sessionToken,
      userToken: secrets.slackUserTokens[row.id] || row.userToken,
      appToken: secrets.slackAppTokens[row.id] || row.appToken,
      oauthClientSecret: secrets.integrationOAuthSecrets[row.id] || row.oauthClientSecret,
      refreshToken: secrets.integrationRefreshTokens[row.id] || row.refreshToken,
    })),
    templates: config.templates.map((t) => {
      const passwords = secrets.templatePasswords[t.id];
      return {
        ...t,
        cloudInit: t.cloudInit
          ? { ...t.cloudInit, password: passwords?.cloudInit || t.cloudInit.password }
          : t.cloudInit,
        unattend: t.unattend
          ? { ...t.unattend, password: passwords?.unattend || t.unattend.password }
          : t.unattend,
      };
    }),
    mcpServers: (config.mcpServers ?? []).map((server) => ({
      ...server,
      env: { ...(secrets.mcpEnv[server.id] ?? {}), ...server.env },
    })),
    integrationPlugins: (config.integrationPlugins ?? []).map((plugin) => ({
      ...plugin,
      config: { ...(secrets.pluginSecrets[plugin.id] ?? {}), ...(plugin.config ?? {}) },
    })),
    workers: (config.workers ?? []).map((row) => ({
      ...row,
      token: secrets.workerTokens[row.id] || row.token,
    })),
    advanced: {
      ...config.advanced,
      slackSigningSecret: secrets.slackSigningSecret || config.advanced.slackSigningSecret,
    },
    phoneRemote: config.phoneRemote
      ? {
          enabled: config.phoneRemote.enabled,
          token: secrets.phoneRemoteToken || config.phoneRemote.token,
        }
      : config.phoneRemote,
    chromeExtension: config.chromeExtension
      ? {
          enabled: config.chromeExtension.enabled,
          token: secrets.chromeExtensionToken || config.chromeExtension.token,
        }
      : config.chromeExtension,
  };
}

export function hasExtractableSecrets(config: LocusConfig): boolean {
  if (config.providers.some((p) => p.apiKey?.trim())) return true;
  if (
    config.forges.some(
      (f) => f.token?.trim() || f.refreshToken?.trim() || f.oauthClientSecret?.trim(),
    )
  )
    return true;
  if (
    (config.integrations ?? []).some(
      (row) =>
        row.token?.trim() ||
        row.sessionToken?.trim() ||
        row.userToken?.trim() ||
        row.appToken?.trim() ||
        row.oauthClientSecret?.trim() ||
        row.refreshToken?.trim(),
    )
  )
    return true;
  if (config.templates.some((t) => t.cloudInit?.password?.trim() || t.unattend?.password?.trim()))
    return true;
  if ((config.mcpServers ?? []).some((s) => Object.keys(s.env ?? {}).some(looksLikeSecretName)))
    return true;
  if ((config.workers ?? []).some((row) => row.token?.trim())) return true;
  if (
    (config.integrationPlugins ?? []).some((plugin) =>
      plugin.configFields.some(
        (field) => pluginFieldIsSecret(field) && plugin.config?.[field.key]?.trim(),
      ),
    )
  )
    return true;
  if (config.advanced.slackSigningSecret?.trim()) return true;
  if (config.phoneRemote?.token?.trim()) return true;
  if (config.chromeExtension?.token?.trim()) return true;
  return false;
}

export async function readVaultFile(
  dataDir: string,
  key: Buffer,
): Promise<SecretBundle | undefined> {
  try {
    const raw = await readFile(join(dataDir, VAULT_FILE), "utf8");
    if (!raw.trim()) return undefined;
    const parsed = JSON.parse(decryptVault(raw, key)) as SecretBundle;
    return {
      providerKeys: parsed.providerKeys ?? {},
      forgeTokens: parsed.forgeTokens ?? {},
      forgeRefreshTokens: parsed.forgeRefreshTokens ?? {},
      forgeOAuthSecrets: parsed.forgeOAuthSecrets ?? {},
      integrationTokens: parsed.integrationTokens ?? {},
      integrationSessionTokens: parsed.integrationSessionTokens ?? {},
      slackUserTokens: parsed.slackUserTokens ?? {},
      slackAppTokens: parsed.slackAppTokens ?? {},
      integrationOAuthSecrets: parsed.integrationOAuthSecrets ?? {},
      integrationRefreshTokens: parsed.integrationRefreshTokens ?? {},
      templatePasswords: parsed.templatePasswords ?? {},
      mcpEnv: parsed.mcpEnv ?? {},
      workerTokens: parsed.workerTokens ?? {},
      pluginSecrets: parsed.pluginSecrets ?? {},
      slackSigningSecret: parsed.slackSigningSecret,
      phoneRemoteToken: parsed.phoneRemoteToken,
      chromeExtensionToken: parsed.chromeExtensionToken,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeVaultFile(
  dataDir: string,
  key: Buffer,
  secrets: SecretBundle,
): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, VAULT_FILE);
  await writeSecretFile(path, encryptVault(JSON.stringify(secrets), key));
}

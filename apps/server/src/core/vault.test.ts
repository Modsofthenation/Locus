import { scryptSync } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../defaults.js";
import { JsonStore } from "./store.js";
import {
  applySecrets,
  decryptVault,
  emptySecrets,
  encryptVault,
  extractSecrets,
  loadOrCreateMasterKey,
  readVaultFile,
  writeVaultFile,
} from "./vault.js";

describe("secrets vault", () => {
  it("round-trips AES-GCM payloads", async () => {
    const key = await loadOrCreateMasterKey(await mkdtemp(join(tmpdir(), "locus-vault-key-")));
    const payload = encryptVault(JSON.stringify({ hello: "world" }), key);
    expect(payload.startsWith("locus1.")).toBe(true);
    expect(JSON.parse(decryptVault(payload, key))).toEqual({ hello: "world" });
  });

  it("strips keys from config.json and restores them from the vault", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.providers[0] = { ...config.providers[0]!, apiKey: "sk-live-secret", enabled: true };
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      providers: Array<{ apiKey?: string }>;
    };
    expect(onDisk.providers[0]?.apiKey).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.providers[0]?.apiKey).toBe("sk-live-secret");
  });

  it("extracts guest passwords into the secret bundle", () => {
    const config = defaultConfig("/tmp/locus");
    config.templates[0]!.cloudInit!.password = "Locus.secretpass!";
    const { config: stripped, secrets } = extractSecrets(config);
    expect(stripped.templates[0]?.cloudInit?.password).toBe("");
    expect(secrets.templatePasswords[config.templates[0]!.id]?.cloudInit).toBe("Locus.secretpass!");
    expect(applySecrets(stripped, secrets).templates[0]?.cloudInit?.password).toBe(
      "Locus.secretpass!",
    );
  });

  it("strips worker tokens from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-worker-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.workers = [
      { id: "w1", name: "Studio", url: "http://192.168.1.8:7421", token: "worker-secret" },
    ];
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      workers?: Array<{ token?: string }>;
    };
    expect(onDisk.workers?.[0]?.token).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.workers?.[0]?.token).toBe("worker-secret");
  });

  it("does not cache a vault-failure load so a later read can restore secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-nocache-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    delete process.env.LOCUS_MASTER_KEY;
    try {
      const writer = new JsonStore(dir);
      await writer.init();
      const config = await writer.loadConfig();
      config.providers[0] = { ...config.providers[0]!, apiKey: "sk-keep-me", enabled: true };
      await writer.saveConfig(config);
      process.env.LOCUS_MASTER_KEY = "wrong-key-material";
      const store = new JsonStore(dir);
      await store.init();
      const stripped = await store.loadConfig();
      expect(stripped.providers[0]?.apiKey).toBeFalsy();
      delete process.env.LOCUS_MASTER_KEY;
      const restored = await store.loadConfig();
      expect(restored.providers[0]?.apiKey).toBe("sk-keep-me");
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });

  it("refuses to overwrite an unreadable secrets vault", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-protect-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    delete process.env.LOCUS_MASTER_KEY;
    try {
      const store = new JsonStore(dir);
      await store.init();
      const config = await store.loadConfig();
      config.providers[0] = { ...config.providers[0]!, apiKey: "sk-keep-me", enabled: true };
      await store.saveConfig(config);
      const vaultPath = join(dir, "secrets.enc");
      const before = await readFile(vaultPath, "utf8");
      process.env.LOCUS_MASTER_KEY = "wrong-key-material";
      const broken = new JsonStore(dir);
      await broken.init();
      const loaded = await broken.loadConfig();
      expect(loaded.providers[0]?.apiKey).toBeFalsy();
      await expect(broken.saveConfig(loaded)).rejects.toThrow(/unreadable/);
      expect(await readFile(vaultPath, "utf8")).toBe(before);
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });

  it("migrates plaintext keys already sitting in config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-migrate-"));
    const config = defaultConfig(dir);
    config.providers[0] = { ...config.providers[0]!, apiKey: "sk-legacy-plain", enabled: true };
    await writeFile(join(dir, "config.json"), JSON.stringify(config, null, 2));
    const store = new JsonStore(dir);
    await store.init();
    const loaded = await store.loadConfig();
    expect(loaded.providers[0]?.apiKey).toBe("sk-legacy-plain");
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      providers: Array<{ apiKey?: string }>;
    };
    expect(onDisk.providers[0]?.apiKey).toBeFalsy();
  });

  it("keeps forge OAuth refresh tokens and client secrets in the vault", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-oauth-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    github.token = "gho_live";
    github.refreshToken = "ghr_live";
    github.oauthClientSecret = "gh-secret";
    github.authMethod = "oauth";
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      forges: Array<{ token?: string; refreshToken?: string; oauthClientSecret?: string }>;
    };
    const row = onDisk.forges.find((item) => item.token || item.refreshToken);
    expect(row?.token).toBeFalsy();
    expect(row?.refreshToken).toBeFalsy();
    expect(row?.oauthClientSecret).toBeFalsy();
    const loaded = await store.loadConfig();
    const restored = loaded.forges.find((item) => item.id === github.id)!;
    expect(restored.token).toBe("gho_live");
    expect(restored.refreshToken).toBe("ghr_live");
    expect(restored.oauthClientSecret).toBe("gh-secret");
  });

  it("strips Slack user and app tokens from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-slack-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "s1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        userToken: "xoxp-secret",
        appToken: "xapp-secret",
      },
    ];
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrations?: Array<{ userToken?: string; appToken?: string }>;
    };
    expect(onDisk.integrations?.[0]?.userToken).toBeFalsy();
    expect(onDisk.integrations?.[0]?.appToken).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.integrations?.[0]?.userToken).toBe("xoxp-secret");
    expect(loaded.integrations?.[0]?.appToken).toBe("xapp-secret");
  });

  it("strips AWS session tokens from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-aws-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "a1",
        kind: "aws",
        name: "AWS IAM",
        enabled: true,
        baseUrl: "https://iam.amazonaws.com",
        accessKeyId: "AKIATEST",
        token: "secret-key",
        sessionToken: "session-secret",
        region: "us-east-1",
      },
    ];
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrations?: Array<{ token?: string; sessionToken?: string; accessKeyId?: string }>;
    };
    expect(onDisk.integrations?.[0]?.token).toBeFalsy();
    expect(onDisk.integrations?.[0]?.sessionToken).toBeFalsy();
    expect(onDisk.integrations?.[0]?.accessKeyId).toBe("AKIATEST");
    const loaded = await store.loadConfig();
    expect(loaded.integrations?.[0]?.token).toBe("secret-key");
    expect(loaded.integrations?.[0]?.sessionToken).toBe("session-secret");
  });

  it("strips Google refresh tokens from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-google-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "gm1",
        kind: "gmail",
        name: "Gmail",
        enabled: true,
        baseUrl: "https://gmail.googleapis.com",
        token: "ya29.secret",
        refreshToken: "1//secret-refresh",
        oauthClientSecret: "g-secret",
      },
    ];
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrations?: Array<{ token?: string; refreshToken?: string; oauthClientSecret?: string }>;
    };
    expect(onDisk.integrations?.[0]?.token).toBeFalsy();
    expect(onDisk.integrations?.[0]?.refreshToken).toBeFalsy();
    expect(onDisk.integrations?.[0]?.oauthClientSecret).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.integrations?.[0]?.token).toBe("ya29.secret");
    expect(loaded.integrations?.[0]?.refreshToken).toBe("1//secret-refresh");
    expect(loaded.integrations?.[0]?.oauthClientSecret).toBe("g-secret");
  });

  it("strips plugin secret fields from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-plugin-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.integrationPlugins = [
      {
        id: "pl1",
        slug: "status",
        name: "Status",
        description: "",
        enabled: true,
        configFields: [
          { key: "baseUrl", label: "Base URL", type: "url" },
          { key: "token", label: "Token", type: "secret" },
        ],
        config: { baseUrl: "https://status.example.com", token: "secret-token" },
        tools: [
          {
            name: "list",
            description: "List",
            parameters: { type: "object", properties: {} },
            http: { method: "GET", url: "{{config.baseUrl}}/incidents" },
          },
        ],
      },
    ];
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrationPlugins?: Array<{ config?: Record<string, string> }>;
    };
    expect(onDisk.integrationPlugins?.[0]?.config?.baseUrl).toBe("https://status.example.com");
    expect(onDisk.integrationPlugins?.[0]?.config?.token).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.integrationPlugins?.[0]?.config?.token).toBe("secret-token");
  });

  it("strips the phone pairing token from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-phone-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.phoneRemote = { enabled: true, token: "ph_secret_token" };
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      phoneRemote?: { enabled?: boolean; token?: string };
    };
    expect(onDisk.phoneRemote?.enabled).toBe(true);
    expect(onDisk.phoneRemote?.token).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.phoneRemote?.token).toBe("ph_secret_token");
  });

  it("strips the Chrome extension pairing token from config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-chrome-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.chromeExtension = { enabled: true, token: "cx_secret_token" };
    await store.saveConfig(config);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      chromeExtension?: { enabled?: boolean; token?: string };
    };
    expect(onDisk.chromeExtension?.enabled).toBe(true);
    expect(onDisk.chromeExtension?.token).toBeFalsy();
    const loaded = await store.loadConfig();
    expect(loaded.chromeExtension?.token).toBe("cx_secret_token");
  });

  it("stores a per-install scrypt salt for passphrase-derived keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-salt-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    process.env.LOCUS_MASTER_KEY = "passphrase-not-hex";
    try {
      const key = await loadOrCreateMasterKey(dir);
      const salt = (await readFile(join(dir, "master.salt"), "utf8")).trim();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      const payload = encryptVault(JSON.stringify({ hello: "salted" }), key);
      expect(JSON.parse(decryptVault(payload, key))).toEqual({ hello: "salted" });
      const again = await loadOrCreateMasterKey(dir);
      expect(again.equals(key)).toBe(true);
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });

  it("does not write master.salt for 64-hex master keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-hex-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    delete process.env.LOCUS_MASTER_KEY;
    try {
      await loadOrCreateMasterKey(dir);
      await expect(access(join(dir, "master.salt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });

  it("migrates a legacy static-salt passphrase vault onto master.salt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-migrate-salt-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    const passphrase = "legacy-passphrase-vault";
    const legacyKey = scryptSync(passphrase, "locus-vault", 32);
    const secrets = emptySecrets();
    secrets.providerKeys.p1 = "sk-legacy-salt";
    await writeVaultFile(dir, legacyKey, secrets);
    process.env.LOCUS_MASTER_KEY = passphrase;
    try {
      const key = await loadOrCreateMasterKey(dir);
      const salt = (await readFile(join(dir, "master.salt"), "utf8")).trim();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(key.equals(legacyKey)).toBe(false);
      const loaded = await readVaultFile(dir, key);
      expect(loaded?.providerKeys.p1).toBe("sk-legacy-salt");
      const again = await loadOrCreateMasterKey(dir);
      expect(again.equals(key)).toBe(true);
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });

  it("does not rewrite a legacy vault when the passphrase is wrong", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-vault-wrong-pass-"));
    const previousKey = process.env.LOCUS_MASTER_KEY;
    const legacyKey = scryptSync("correct-passphrase", "locus-vault", 32);
    const secrets = emptySecrets();
    secrets.providerKeys.p1 = "sk-keep";
    await writeVaultFile(dir, legacyKey, secrets);
    const before = await readFile(join(dir, "secrets.enc"), "utf8");
    process.env.LOCUS_MASTER_KEY = "wrong-passphrase";
    try {
      await loadOrCreateMasterKey(dir);
      await expect(access(join(dir, "master.salt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(dir, "secrets.enc"), "utf8")).toBe(before);
    } finally {
      if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previousKey;
    }
  });
});

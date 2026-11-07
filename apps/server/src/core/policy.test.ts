import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManagedPolicy, managedPolicyPaths } from "./policy.js";

const envKeys = ["LOCUS_POLICY_PATH", "LOCUS_POLICY_KEY"] as const;
const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of envKeys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previous.clear();
});

function setEnv(key: (typeof envKeys)[number], value: string | undefined): void {
  if (!previous.has(key)) previous.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("loadManagedPolicy", () => {
  it("reads an unsigned LOCUS_POLICY_PATH file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-policy-"));
    const path = join(dir, "enterprise.json");
    await writeFile(path, JSON.stringify({ version: 1, name: "Acme", allowedProviders: [] }));
    setEnv("LOCUS_POLICY_PATH", path);
    const status = await loadManagedPolicy(dir);
    expect(status.active).toBe(true);
    expect(status.signed).toBe(false);
    expect(status.source).toBe(path);
    expect(status.policy.allowedProviders).toEqual([]);
  });

  it("ignores unsigned home policy.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-policy-"));
    setEnv("LOCUS_POLICY_PATH", undefined);
    setEnv("LOCUS_POLICY_KEY", undefined);
    await writeFile(join(dir, "policy.json"), JSON.stringify({ version: 1, name: "Home" }));
    expect(managedPolicyPaths(dir)).toEqual([join(dir, "policy.json")]);
    const status = await loadManagedPolicy(dir);
    expect(status.active).toBe(false);
  });

  it("accepts HMAC-signed home policy.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-policy-"));
    const body = `${JSON.stringify({ version: 1, name: "Home" })}\n`;
    const key = "unit-test-policy-key";
    setEnv("LOCUS_POLICY_PATH", undefined);
    setEnv("LOCUS_POLICY_KEY", key);
    await writeFile(join(dir, "policy.json"), body);
    await writeFile(
      join(dir, "policy.json.sig"),
      createHmac("sha256", key).update(body).digest("hex"),
    );
    const status = await loadManagedPolicy(dir);
    expect(status.active).toBe(true);
    expect(status.signed).toBe(true);
    expect(status.policy.name).toBe("Home");
  });

  it("ignores a self-signed home policy keyed from ~/.locus/policy.key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-policy-"));
    const body = `${JSON.stringify({ version: 1, name: "Self" })}\n`;
    const key = "operator-owned-key";
    setEnv("LOCUS_POLICY_PATH", undefined);
    setEnv("LOCUS_POLICY_KEY", undefined);
    await writeFile(join(dir, "policy.json"), body);
    await writeFile(join(dir, "policy.key"), key);
    await writeFile(
      join(dir, "policy.json.sig"),
      createHmac("sha256", key).update(body).digest("hex"),
    );
    const status = await loadManagedPolicy(dir);
    expect(status.active).toBe(false);
  });
});

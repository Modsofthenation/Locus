import { describe, expect, it } from "vitest";
import {
  environmentInstallCommand,
  formatSetupPrompt,
  parseLocusEnvironment,
} from "./environment.js";

describe("locus environment", () => {
  it("parses packages, install, ports, and start", () => {
    const env = parseLocusEnvironment({
      packages: ["git", "curl"],
      install: "npm ci",
      ports: [5173],
      start: "npm run dev",
    });
    expect(env).toEqual({
      packages: ["git", "curl"],
      install: "npm ci",
      ports: [5173],
      start: "npm run dev",
    });
    expect(environmentInstallCommand(env!)).toMatch(/apt-get install -y git curl/);
    expect(environmentInstallCommand(env!)).toMatch(/&& \(npm ci\)/);
  });

  it("maps Cursor terminals onto start when start is omitted", () => {
    const env = parseLocusEnvironment({
      install: "pnpm install --frozen-lockfile",
      terminals: [{ name: "dev", command: "pnpm dev --host 0.0.0.0" }],
    });
    expect(env?.install).toBe("pnpm install --frozen-lockfile");
    expect(env?.start).toBe("pnpm dev --host 0.0.0.0");
    expect(environmentInstallCommand(env!)).toBe("(pnpm install --frozen-lockfile)");
  });

  it("prefers terminals for start and folds Cursor start into install", () => {
    const env = parseLocusEnvironment({
      install: "npm ci",
      start: "node scripts/prepare.mjs",
      terminals: [{ name: "web", command: "npm run dev -- --host 0.0.0.0" }],
      ports: [{ name: "web", port: 5173 }, 7420],
    });
    expect(env?.install).toBe("npm ci && node scripts/prepare.mjs");
    expect(env?.start).toBe("npm run dev -- --host 0.0.0.0");
    expect(env?.ports).toEqual([5173, 7420]);
    expect(environmentInstallCommand(env!)).toBe("(npm ci && node scripts/prepare.mjs)");
  });

  it("ignores snapshot-only Cursor files", () => {
    expect(parseLocusEnvironment({ snapshot: "snap-1" })).toBeUndefined();
  });

  it("formats the Codebase setup prompt", () => {
    const text = formatSetupPrompt({
      prompt: "Set up this repository.",
      repoName: "acme/app",
      repoUrl: "https://github.com/acme/app",
    });
    expect(text).toMatch(/Set up this repository/);
    expect(text).toMatch(/https:\/\/github.com\/acme\/app/);
    expect(text).toMatch(/\.locus\/environment\.json/);
    expect(text).toMatch(/Do not git_clone again/);
  });
});

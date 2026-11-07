import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { DESKTOP_CLI_MESSAGE, isElectronHelperProcess, desktopUserArgs, desktopCliInvocation } =
  createRequire(import.meta.url)("./cli-argv.cjs") as {
    DESKTOP_CLI_MESSAGE: string;
    isElectronHelperProcess: (argv: string[]) => boolean;
    desktopUserArgs: (argv: string[], opts?: { packaged?: boolean }) => string[];
    desktopCliInvocation: (
      argv: string[],
      opts?: { packaged?: boolean },
    ) => { kind: string; message: string } | null;
  };

describe("desktop CLI argv", () => {
  it("treats packaged --help, --version, and subcommands as CLI, not a new window", () => {
    const bin = "/tmp/.mount_Locus-C1G4Tu/locus";
    expect(desktopCliInvocation([bin, "--help"], { packaged: true })?.kind).toBe("help");
    expect(desktopCliInvocation([bin, "-h"], { packaged: true })?.kind).toBe("help");
    expect(desktopCliInvocation([bin, "--version"], { packaged: true })?.kind).toBe("version");
    expect(desktopCliInvocation([bin, "secrets"], { packaged: true })?.kind).toBe("command");
    expect(desktopCliInvocation([bin, "secrets", "--help"], { packaged: true })?.kind).toBe("help");
    expect(desktopCliInvocation([bin], { packaged: true })).toBeNull();
    expect(desktopCliInvocation([bin, "--ozone-platform=wayland"], { packaged: true })).toBeNull();
  });

  it("does not treat Chromium helpers or electron --dev as CLI", () => {
    const bin = "/tmp/.mount_Locus-C1G4Tu/locus";
    expect(isElectronHelperProcess([bin, "--type=zygote"])).toBe(true);
    expect(desktopCliInvocation([bin, "--type=zygote", "--help"], { packaged: true })).toBeNull();
    expect(
      desktopCliInvocation(["/usr/bin/electron", ".", "--dev"], { packaged: false }),
    ).toBeNull();
    expect(desktopUserArgs(["/usr/bin/electron", ".", "--dev"], { packaged: false })).toEqual([]);
  });

  it("prints a GUI-vs-CLI hint", () => {
    expect(DESKTOP_CLI_MESSAGE).toMatch(/GUI, not a CLI/);
    expect(DESKTOP_CLI_MESSAGE).toMatch(/127\.0\.0\.1:7420/);
    expect(DESKTOP_CLI_MESSAGE).toMatch(/npm run locus/);
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(main).toContain('require("./cli-argv.cjs")');
    expect(main).toContain("desktopCliInvocation");
    expect(main.indexOf("desktopCliInvocation")).toBeLessThan(main.indexOf("whenReady"));
    expect(main).toContain("process.exit(0)");
  });
});

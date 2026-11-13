// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_BUNDLE_BANNER =
  "import { createRequire as __locusCreateRequire } from 'node:module'; const require = __locusCreateRequire(import.meta.url);";
const pkg = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8")) as {
  homepage?: string;
  devDependencies?: { electron?: string };
  build?: {
    productName?: string;
    electronVersion?: string;
    executableName?: string;
    icon?: string;
    directories?: { output?: string; buildResources?: string };
    linux?: { target?: string[]; executableName?: string; packageName?: string };
    deb?: { artifactName?: string; packageName?: string };
    rpm?: { artifactName?: string; packageName?: string };
    mac?: { target?: string[]; binaries?: string[] };
    win?: { target?: string[] };
    extraResources?: Array<{ from?: string; to?: string }>;
    files?: string[];
  };
};
const { resolveLaunch, spawnIo } = createRequire(import.meta.url)("../electron/launch.cjs") as {
  resolveLaunch: (opts: Record<string, unknown>) => {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    detached: boolean;
    shell: boolean;
    windowsVerbatimArguments?: boolean;
    stdio: "inherit" | Array<"ignore" | "inherit" | "pipe">;
    windowsHide: boolean;
  } | null;
  spawnIo: (platform: string) => {
    stdio: "inherit" | Array<"ignore" | "inherit" | "pipe">;
    windowsHide: boolean;
  };
};

describe("electron packaging", () => {
  it("declares AppImage, dmg, and NSIS targets", () => {
    expect(pkg.build?.productName).toBe("Locus");
    expect(pkg.build?.executableName).toBe("locus");
    expect(pkg.build?.electronVersion).toBe("45.2.2");
    expect(pkg.devDependencies?.electron).toBe(pkg.build?.electronVersion);
    expect(pkg.build?.linux?.target).toEqual(["AppImage", "deb", "rpm"]);
    expect(pkg.build?.linux?.executableName).toBe("locus");
    expect(pkg.homepage).toMatch(/^https:\/\/github\.com\/Modsofthenation\/Locus/);
    expect(pkg.build?.linux?.packageName).toBeUndefined();
    expect(pkg.build?.deb?.packageName).toBe("locus");
    expect(pkg.build?.rpm?.packageName).toBe("locus");
    expect(pkg.build?.deb?.artifactName).toBe("${productName}-${version}-${arch}.${ext}");
    expect(pkg.build?.rpm?.artifactName).toBe("${productName}-${version}-${arch}.${ext}");
    expect(pkg.build?.mac?.target).toEqual(["dmg"]);
    expect(pkg.build?.win?.target).toEqual(["nsis"]);
    expect(pkg.build?.directories?.output).toBe("dist-electron");
    expect(pkg.build?.directories?.buildResources).toBe("buildResources");
    expect(pkg.build?.icon).toBe("buildResources/icon.png");
    expect(pkg.build?.files).toEqual(expect.arrayContaining(["buildResources/icon.png"]));
    const icon = readFileSync(join(desktopRoot, "buildResources/icon.png"));
    expect(icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    expect(readFileSync(join(desktopRoot, "public/logo.svg"), "utf8")).toMatch(/#FDCB2A/);
    expect(readFileSync(join(desktopRoot, "index.html"), "utf8")).toContain('href="/logo.svg"');
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(main).toContain('require("./cli-argv.cjs")');
    expect(main).toContain("desktopCliInvocation");
    expect(main).toMatch(/setAppUserModelId\("dev\.locus\.desktop"\)/);
    expect(main).toMatch(/buildResources.*icon\.png|appIcon/);
    expect(main).toMatch(/dock\.setIcon/);
    const mascot = readFileSync(join(desktopRoot, "public/mascot.png"));
    expect(mascot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(mascot.readUInt32BE(16)).toBe(512);
    expect(mascot.readUInt32BE(20)).toBe(512);
    const mascotSvg = readFileSync(join(desktopRoot, "public/mascot.svg"), "utf8");
    expect(mascotSvg).toMatch(/width="512"/);
    expect(mascotSvg).toMatch(/height="512"/);
    expect(mascotSvg).toContain("M17 24V14.5A3.5 3.5 0 0 1 20.5 11H30v5.5H22.5V24H17Z");
    expect(mascotSvg).toContain("M59 24V14.5A3.5 3.5 0 0 0 55.5 11H46v5.5h7.5V24H59Z");
    expect(mascotSvg).toContain("M17 40v9.5A3.5 3.5 0 0 0 20.5 53H30v-5.5H22.5V40H17Z");
    expect(mascotSvg).toContain("M59 40v9.5A3.5 3.5 0 0 1 55.5 53H46v-5.5h7.5V40H59Z");
    expect(pkg.build?.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "dist", to: "ui" }),
        expect.objectContaining({ from: "build/server", to: "server" }),
        expect.objectContaining({
          from: "build/server-typescript-ls",
          to: "server/node_modules/typescript-ls",
        }),
        expect.objectContaining({ from: "../../images", to: "images" }),
        expect.objectContaining({ from: "../../apps/chrome-extension", to: "chrome-extension" }),
      ]),
    );
  });

  it("passes the electron-builder 26 configuration schema", () => {
    const requireFromTest = createRequire(import.meta.url);
    const schema = requireFromTest("app-builder-lib/scheme.json") as unknown;
    const { validateSchema } = requireFromTest(
      "app-builder-lib/out/util/config/schemaValidator.js",
    ) as {
      validateSchema: (schema: unknown, data: unknown, config?: { name?: string }) => void;
    };
    expect(() =>
      validateSchema(schema, pkg.build, { name: "electron-builder 26.18.0" }),
    ).not.toThrow();
  });

  it("spawns the bundled control plane when packaged", () => {
    const launch = resolveLaunch({
      packaged: true,
      dev: false,
      resourcesPath: "/tmp/Locus.app/Contents/Resources",
      execPath: "/tmp/Locus.app/Contents/MacOS/Locus",
      uiDist: "/unused",
      repoRoot: "/repo",
      platform: "darwin",
      home: "/tmp/locus-home-without-ui",
    });
    expect(launch?.command).toBe("/tmp/Locus.app/Contents/MacOS/Locus");
    expect(launch?.args).toEqual(["/tmp/Locus.app/Contents/Resources/server/index.mjs"]);
    expect(launch?.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      LOCUS_UI: "/tmp/Locus.app/Contents/Resources/ui",
      LOCUS_IMAGES: "/tmp/Locus.app/Contents/Resources/images/agent",
    });
    expect(launch?.shell).toBe(false);
    expect(launch?.stdio).toBe("inherit");
    expect(launch?.windowsHide).toBe(false);
  });

  it("does not inherit stdin on Windows so the GUI keeps keyboard focus", () => {
    expect(spawnIo("win32")).toEqual({
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    expect(spawnIo("linux")).toEqual({ stdio: "inherit", windowsHide: false });
    expect(spawnIo("darwin")).toEqual({ stdio: "inherit", windowsHide: false });
    const launch = resolveLaunch({
      packaged: true,
      dev: false,
      resourcesPath: "C:\\Program Files\\Locus\\resources",
      execPath: "C:\\Program Files\\Locus\\Locus.exe",
      uiDist: "/unused",
      repoRoot: "/repo",
      platform: "win32",
      home: "/tmp/locus-home-without-ui",
    });
    expect(launch?.stdio).toEqual(["ignore", "inherit", "inherit"]);
    expect(launch?.windowsHide).toBe(true);
    expect(launch?.detached).toBe(false);
    const unpackaged = resolveLaunch({
      packaged: false,
      dev: false,
      resourcesPath: "",
      execPath: "electron",
      uiDist: "C:\\repo\\apps\\desktop\\dist",
      repoRoot: "C:\\repo",
      platform: "win32",
    });
    expect(unpackaged?.command).toBe("cmd.exe");
    expect(unpackaged?.args).toEqual([
      "/d",
      "/s",
      "/c",
      "npm.cmd run start --workspace=@locus/server",
    ]);
    expect(unpackaged?.shell).toBe(false);
    expect(unpackaged?.windowsVerbatimArguments).toBe(true);
    expect(unpackaged?.stdio).toEqual(["ignore", "inherit", "inherit"]);
    expect(unpackaged?.windowsHide).toBe(true);
  });

  it("keeps Node CLI spawn helpers out of the Vite renderer barrel", () => {
    const barrel = readFileSync(join(desktopRoot, "../../packages/shared/src/index.ts"), "utf8");
    expect(barrel).not.toContain("windowsCliSpawn");
    expect(barrel).not.toContain("awsSign");
    const vite = readFileSync(join(desktopRoot, "vite.config.ts"), "utf8");
    expect(vite).toContain("../../packages/shared/src/index.ts");
  });

  it("splits heavy shared canvas and tool modules out of the main Vite chunk", () => {
    const vite = readFileSync(join(desktopRoot, "vite.config.ts"), "utf8");
    expect(vite).toContain("codeSplitting");
    expect(vite).toContain("shared-canvas");
    expect(vite).toContain("shared-tools");
    expect(vite).toContain("(?:game|asset|board|playwright)");
    expect(vite).toContain("(?:tools|toolSchemas|recipes)");
  });

  it("installs the Windows menu-bar input guard on the BrowserWindow", () => {
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(main).toContain('require("./windows-input.cjs")');
    expect(main).toContain("dropWindowsApplicationMenu(Menu)");
    expect(main).toContain("installWindowsInputGuard(win)");
    expect(main.indexOf("dropWindowsApplicationMenu(Menu)")).toBeLessThan(
      main.indexOf("new BrowserWindow"),
    );
    expect(main).not.toContain("hookWindowMessage");
    expect(main).toContain('autoHideMenuBar: process.platform !== "win32"');
    expect(main).toMatch(/taskkill[\s\S]*windowsHide:\s*true/);
  });

  it("retries transient Chromium net errors when loading the UI", () => {
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(main).toContain('require("./net-wait.cjs")');
    expect(main).toContain("waitForUrl");
    expect(main).toContain("waitForUrl(uiUrl)");
    expect(main).toContain("loadUrlWithRetry(win, uiUrl)");
    expect(main).toContain("dialog.showErrorBox");
    expect(main).toContain("syncPackagedUi");
    expect(main).toContain("controlPlaneStartAction");
    expect(main).not.toContain("waitForUrl(dev ? uiUrl : HEALTH_URL)");
    expect(main).not.toContain("shell: true");
  });

  it("respawns the control plane when the child exits", () => {
    const main = readFileSync(join(desktopRoot, "electron/main.cjs"), "utf8");
    expect(main).toContain('require("./control-plane.cjs")');
    expect(main).toContain("watchChild(child)");
    expect(main).toContain("scheduleRestart");
    expect(main).toContain("startHealthWatch");
    expect(main).toContain('proc.on("exit"');
  });

  it("keeps the npm workspace spawn for unpackaged electron", () => {
    const launch = resolveLaunch({
      packaged: false,
      dev: false,
      resourcesPath: "",
      execPath: "electron",
      uiDist: "/repo/apps/desktop/dist",
      repoRoot: "/repo",
      platform: "linux",
    });
    expect(launch?.command).toBe("npm");
    expect(launch?.args).toEqual(["run", "start", "--workspace=@locus/server"]);
    expect(launch?.cwd).toBe("/repo");
    expect(launch?.env).toEqual({ LOCUS_UI: "/repo/apps/desktop/dist" });
    expect(launch?.shell).toBe(false);
    expect(launch?.stdio).toBe("inherit");
    expect(launch?.windowsHide).toBe(false);
  });

  it("publishes GitHub Release assets when a v* tag is pushed", () => {
    const workflows = join(desktopRoot, "../../.github/workflows");
    const cases = [
      { file: "dist-linux.yml", runsOn: "ubuntu-latest", artifact: "*.AppImage" },
      { file: "dist-macos.yml", runsOn: "macos-latest", artifact: "*.dmg" },
      { file: "dist-windows.yml", runsOn: "windows-latest", artifact: "*.exe" },
    ];
    for (const { file, runsOn, artifact } of cases) {
      const yml = readFileSync(join(workflows, file), "utf8");
      expect(yml, file).toMatch(/workflow_dispatch:/);
      expect(yml, file).toMatch(/tags:\s*\n\s*-\s*"v\*"/);
      expect(yml, file).not.toMatch(/\bpull_request\b/);
      expect(yml, file).toContain(`runs-on: ${runsOn}`);
      expect(yml, file).toContain("npm run dist --workspace=@locus/desktop");
      expect(yml, file).not.toContain("ELECTRON_SKIP_BINARY_DOWNLOAD");
      expect(yml, file).toContain("actions/upload-artifact");
      expect(yml, file).toContain("action-gh-release");
      expect(yml, file).toContain("release-checksums.mjs");
      if (file === "dist-linux.yml") {
        expect(yml, file).toMatch(/generate_release_notes:\s*true/);
      } else {
        expect(yml, file).toMatch(/generate_release_notes:\s*false/);
      }
      expect(yml, file).toContain(`SHA256SUMS-${file.replace("dist-", "").replace(".yml", "")}`);
      expect(yml, file).toContain(artifact);
      if (file === "dist-linux.yml") {
        expect(yml, file).toContain("*.deb");
        expect(yml, file).toContain("*.rpm");
        expect(
          readFileSync(join(desktopRoot, "../../scripts/release-checksums.mjs"), "utf8"),
        ).toMatch(/AppImage\|deb\|rpm/);
      }
      if (file === "dist-linux.yml" || file === "dist-macos.yml") {
        expect(yml, file).toContain("if: github.ref != 'refs/tags/v0.4.1'");
      }
      if (file === "dist-macos.yml") {
        expect(yml, file).toContain("CSC_LINK_RAW");
        expect(yml, file).not.toMatch(/^\s+CSC_LINK:\s+\$\{\{\s*secrets\.CSC_LINK/m);
      }
      expect(yml, file).toMatch(/workflow_call:/);
    }
  });

  it("packages latest main from a single workflow_dispatch", () => {
    const yml = readFileSync(
      join(desktopRoot, "../../.github/workflows/package-from-main.yml"),
      "utf8",
    );
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).not.toMatch(/\bpull_request\b/);
    expect(yml).not.toMatch(/tags:/);
    expect(yml).toContain("dist-linux.yml");
    expect(yml).toContain("dist-macos.yml");
    expect(yml).toContain("dist-windows.yml");
    expect(yml).toContain("secrets: inherit");
    expect(yml).toMatch(/ref:\s*main/);
  });

  it("does not start a nested server in --dev", () => {
    expect(
      resolveLaunch({
        packaged: false,
        dev: true,
        resourcesPath: "",
        execPath: "",
        uiDist: "",
        repoRoot: "",
      }),
    ).toBeNull();
  });

  it("server bundle banner does not collide with createRequire imports", async () => {
    expect(readFileSync(join(desktopRoot, "scripts/bundle-server.mjs"), "utf8")).toContain(
      SERVER_BUNDLE_BANNER,
    );
    const result = await esbuild.build({
      stdin: {
        contents:
          'import { createRequire } from "node:module";\nexport const req = createRequire(import.meta.url);\n',
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      banner: { js: SERVER_BUNDLE_BANNER },
    });
    const dir = mkdtempSync(join(tmpdir(), "locus-bundle-"));
    const file = join(dir, "index.mjs");
    writeFileSync(file, result.outputFiles[0]!.text);
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    expect(checked.status, checked.stderr).toBe(0);
  });

  it("inlines vscode language services and ships typescript-ls beside the bundle", async () => {
    const script = readFileSync(join(desktopRoot, "scripts/bundle-server.mjs"), "utf8");
    expect(script).toMatch(/external:\s*\[["']typescript-ls["']\]/);
    expect(script).toContain("server-typescript-ls");
    expect(script).toContain('"cssLanguageService.js"');
    expect(script).toContain('"htmlLanguageService.js"');
    expect(script).toContain('"jsonLanguageService.js"');
    expect(script).toMatch(/"lib",\s*"esm"/);

    const { copyTypescriptPackage, serverEsbuildOptions } = (await import(
      pathToFileURL(join(desktopRoot, "scripts/bundle-server.mjs")).href
    )) as {
      copyTypescriptPackage: (destDir: string) => Promise<string>;
      serverEsbuildOptions: (opts: {
        entryPoints: string[];
        outfile: string;
        logLevel?: string;
      }) => esbuild.BuildOptions;
    };

    const dir = mkdtempSync(join(tmpdir(), "locus-complete-bundle-"));
    const outfile = join(dir, "index.mjs");
    try {
      await esbuild.build(
        serverEsbuildOptions({
          entryPoints: [join(desktopRoot, "../server/src/workspace/workspaceComplete.ts")],
          outfile,
          logLevel: "silent",
        }),
      );
      await copyTypescriptPackage(join(dir, "node_modules", "typescript-ls"));
      const js = readFileSync(outfile, "utf8");
      expect(js).toMatch(/from ["']typescript-ls["']/);
      expect(js).not.toMatch(/require\(["']\.\/parser\/cssParser["']\)/);
      expect(existsSync(join(dir, "node_modules", "typescript-ls", "lib", "lib.es5.d.ts"))).toBe(
        true,
      );
      const checked = spawnSync(process.execPath, ["--check", outfile], { encoding: "utf8" });
      expect(checked.status, checked.stderr).toBe(0);

      const { completeWorkspaceFile } = (await import(pathToFileURL(outfile).href)) as {
        completeWorkspaceFile: (input: {
          root: string;
          rel: string;
          content: string;
          line: number;
          character: number;
        }) => Promise<{ items: Array<{ label: string }>; source: string }>;
      };
      const css = await completeWorkspaceFile({
        root: dir,
        rel: "app.css",
        content: "body { col",
        line: 0,
        character: 10,
      });
      expect(css.source).toBe("css");
      expect(css.items.some((item) => item.label === "color")).toBe(true);

      const html = await completeWorkspaceFile({
        root: dir,
        rel: "index.html",
        content: "<sec",
        line: 0,
        character: 4,
      });
      expect(html.source).toBe("html");
      expect(html.items.some((item) => item.label.toLowerCase().includes("section"))).toBe(true);

      const tsContent = 'const msg = "hi";\nmsg.';
      const ts = await completeWorkspaceFile({
        root: dir,
        rel: "app.ts",
        content: tsContent,
        line: 1,
        character: 4,
      });
      expect(ts.source).toBe("typescript");
      expect(ts.items.map((item) => item.label)).toEqual(
        expect.arrayContaining(["toUpperCase", "slice"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("ships a platform ripgrep beside the bundled server", async () => {
    expect(pkg.build?.mac?.binaries).toContain("Contents/Resources/server/bin/rg");
    const { copyRipgrep } = (await import(
      pathToFileURL(join(desktopRoot, "scripts/bundle-server.mjs")).href
    )) as { copyRipgrep: (serverDir: string) => Promise<string> };
    const dir = mkdtempSync(join(tmpdir(), "locus-rg-bundle-"));
    try {
      const rg = await copyRipgrep(dir);
      expect(rg).toBe(join(dir, "bin", process.platform === "win32" ? "rg.exe" : "rg"));
      const probe = spawnSync(rg, ["--version"], { encoding: "utf8", timeout: 10_000 });
      expect(probe.status).toBe(0);
      expect(probe.stdout).toMatch(/^ripgrep \d+/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bundles AWS IAM tools without the AWS SDK", async () => {
    const serverPkg = JSON.parse(
      readFileSync(join(desktopRoot, "../server/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(JSON.stringify(serverPkg.dependencies ?? {})).not.toMatch(/@aws-sdk\//);

    const { serverEsbuildOptions } = (await import(
      pathToFileURL(join(desktopRoot, "scripts/bundle-server.mjs")).href
    )) as {
      serverEsbuildOptions: (opts: {
        entryPoints: string[];
        outfile: string;
        logLevel?: string;
      }) => esbuild.BuildOptions;
    };

    const dir = mkdtempSync(join(tmpdir(), "locus-aws-bundle-"));
    const outfile = join(dir, "awsIam.mjs");
    try {
      await esbuild.build(
        serverEsbuildOptions({
          entryPoints: [join(desktopRoot, "../server/src/integrations/awsIam.ts")],
          outfile,
          logLevel: "silent",
        }),
      );
      const js = readFileSync(outfile, "utf8");
      expect(js).not.toMatch(/@aws-sdk\/client-iam/);
      expect(js).not.toMatch(/@aws-sdk\/client-sts/);
      const checked = spawnSync(process.execPath, ["--check", outfile], { encoding: "utf8" });
      expect(checked.status, checked.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inlines @locus/alb from the workspace source", async () => {
    const { serverEsbuildOptions } = (await import(
      pathToFileURL(join(desktopRoot, "scripts/bundle-server.mjs")).href
    )) as {
      serverEsbuildOptions: (opts: {
        entryPoints: string[];
        outfile: string;
        logLevel?: string;
      }) => esbuild.BuildOptions;
    };

    const albAlias = serverEsbuildOptions({
      entryPoints: [],
      outfile: "unused",
      logLevel: "silent",
    }).alias?.["@locus/alb"];
    expect(albAlias?.replaceAll("\\", "/")).toMatch(/packages\/alb\/src\/index\.ts$/);
    expect(albAlias?.replaceAll("\\", "/")).not.toContain("node_modules");

    const dir = mkdtempSync(join(tmpdir(), "locus-alb-bundle-"));
    const outfile = join(dir, "templates.mjs");
    try {
      await esbuild.build(
        serverEsbuildOptions({
          entryPoints: [join(desktopRoot, "../server/src/workflows/templates.ts")],
          outfile,
          logLevel: "silent",
        }),
      );
      const js = readFileSync(outfile, "utf8");
      expect(js).toContain("research-agent");
      expect(js).not.toMatch(/from ["']@locus\/alb["']/);
      const checked = spawnSync(process.execPath, ["--check", outfile], { encoding: "utf8" });
      expect(checked.status, checked.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

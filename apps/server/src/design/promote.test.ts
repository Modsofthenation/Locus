import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePromoteScaffold,
  writePromoteScaffold,
  writePromoteBrief,
  formatPromoteBrief,
} from "./promote.js";
import { formatPromoteGameBrief } from "@locus/shared";

describe("writePromoteScaffold", () => {
  it("keeps a static canvas tree", async () => {
    expect(parsePromoteScaffold("static")).toBe("static");
    expect(parsePromoteScaffold("next")).toBe("next");
    expect(parsePromoteScaffold("astro")).toBe("astro");
    expect(parsePromoteScaffold("nope")).toBe("vite-react");
    expect(parsePromoteScaffold("nope", { game: true })).toBe("canvas-vite");
    expect(parsePromoteScaffold("nope", { assets: true })).toBe("three-vite");
    expect(parsePromoteScaffold("three-vite")).toBe("three-vite");
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-static-"));
    await writePromoteScaffold(dir, "static");
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Promoted from Design");
    expect(await readFile(join(dir, "README.md"), "utf8")).toContain("original canvas");
  });

  it("writes a Vite React app around the canvas HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-vite-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "index.html"), "<h1>Landing</h1>\n");
    await writePromoteScaffold(dir, "vite-react");
    expect(await readFile(join(dir, "public", "design.html"), "utf8")).toContain("Landing");
    expect(await readFile(join(dir, "design", "index.html"), "utf8")).toContain("Landing");
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain("vite");
    expect(await readFile(join(dir, "src", "App.tsx"), "utf8")).toContain("/design.html");
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("src/main.tsx");
  });

  it("copies linked CSS and images next to public/design.html", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-assets-"));
    await writeFile(
      join(dir, "index.html"),
      `<html><head><link rel="stylesheet" href="styles.css"></head><body><img src="assets/logo.png"></body></html>\n`,
    );
    await writeFile(join(dir, "styles.css"), "body{background:url(assets/bg.png)}\n");
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "assets", "logo.png"), "logo");
    await writeFile(join(dir, "assets", "bg.png"), "bg");
    await writePromoteScaffold(dir, "next");
    expect(await readFile(join(dir, "public", "styles.css"), "utf8")).toContain("assets/bg.png");
    expect(await readFile(join(dir, "public", "assets", "logo.png"), "utf8")).toBe("logo");
    expect(await readFile(join(dir, "public", "assets", "bg.png"), "utf8")).toBe("bg");
  });

  it("writes a Vite React placeholder that ports the kit instead of iframing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-kit-"));
    await writeFile(join(dir, "index.html"), "<h1>Landing</h1>\n");
    await writePromoteScaffold(dir, "vite-react", { kit: true });
    const app = await readFile(join(dir, "src", "App.tsx"), "utf8");
    expect(app).toContain("ui_kits/");
    expect(app).not.toContain("<iframe");
    expect(await readFile(join(dir, "README.md"), "utf8")).toMatch(/do not iframe/i);
  });

  it("writes Next.js and Astro apps around the canvas HTML", async () => {
    const nextDir = await mkdtemp(join(tmpdir(), "locus-promote-next-"));
    await writeFile(join(nextDir, "index.html"), "<h1>Landing</h1>\n");
    await writePromoteScaffold(nextDir, "next");
    expect(await readFile(join(nextDir, "public", "design.html"), "utf8")).toContain("Landing");
    expect(await readFile(join(nextDir, "package.json"), "utf8")).toContain("next");
    expect(await readFile(join(nextDir, "app", "page.tsx"), "utf8")).not.toContain("iframe");
    expect(await readFile(join(nextDir, "middleware.ts"), "utf8")).toContain("/design.html");
    expect(await readFile(join(nextDir, "app", "layout.tsx"), "utf8")).toContain("ReactNode");

    const astroDir = await mkdtemp(join(tmpdir(), "locus-promote-astro-"));
    await writeFile(join(astroDir, "index.html"), "<h1>Landing</h1>\n");
    await writePromoteScaffold(astroDir, "astro");
    expect(await readFile(join(astroDir, "package.json"), "utf8")).toContain("astro");
    const astroPage = await readFile(join(astroDir, "src", "pages", "index.astro"), "utf8");
    expect(astroPage).toContain("<h1>Landing</h1>");
    expect(astroPage).toContain("new Response");
    expect(astroPage).not.toContain("iframe");
  });

  it.skipIf(process.platform === "win32")(
    "does not follow workspace symlinks out of the image",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-promote-link-"));
      const outside = await mkdtemp(join(tmpdir(), "locus-promote-out-"));
      await writeFile(join(outside, "secret.html"), "SECRET\n");
      await symlink(join(outside, "secret.html"), join(dir, "index.html"));
      await symlink(outside, join(dir, "public"));
      await writePromoteScaffold(dir, "vite-react");
      expect(await readFile(join(outside, "secret.html"), "utf8")).toBe("SECRET\n");
      expect((await lstat(join(dir, "public"))).isSymbolicLink()).toBe(false);
      expect((await lstat(join(dir, "index.html"))).isSymbolicLink()).toBe(false);
      expect(await readFile(join(dir, "public", "design.html"), "utf8")).toContain(
        "Promoted from Design",
      );
      expect(await readFile(join(dir, "index.html"), "utf8")).toContain("src/main.tsx");
    },
  );

  it("rejects an oversized canvas instead of loading it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-huge-"));
    await writeFile(join(dir, "index.html"), "x".repeat(1_500_001));
    await expect(writePromoteScaffold(dir, "vite-react")).rejects.toThrow(
      "Canvas file is too large",
    );
  });
});

describe("formatPromoteBrief", () => {
  it("writes interview answers, pins, and palette into DESIGN.md", () => {
    const brief = formatPromoteBrief({
      title: "Landing",
      palette: {
        bg: "#111111",
        surface: "#222222",
        text: "#ffffff",
        muted: "#aaaaaa",
        primary: "#e08a4c",
        accent: "#4c8ae0",
      },
      designSystemId: "ds1",
      designPins: [{ selector: "h1", text: "Shorter headline", viewport: "desktop" }],
      messages: [
        {
          toolCalls: [{ name: "ask_user", result: "Audience: founders.\nTone: direct." }],
        },
      ],
    });
    expect(brief).toContain("# Design brief");
    expect(brief).toContain("## Interview");
    expect(brief).toContain("Audience: founders.");
    expect(brief).toContain("## Comments");
    expect(brief).toContain("`h1`: Shorter headline");
    expect(brief).toContain("## Palette");
    expect(brief).toContain("#e08a4c");
    expect(brief).toContain("Design system id: ds1");
  });

  it("writes a canvas-vite game scaffold and GAME.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-promote-game-"));
    await writeFile(join(dir, "index.html"), "<h1>Arcade</h1>\n");
    await writePromoteScaffold(dir, "canvas-vite");
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Arcade");
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain("locus-game");
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain("vite");
    expect(await readFile(join(dir, "README.md"), "utf8")).toMatch(/GAME\.md/);
    await writePromoteBrief(dir, formatPromoteGameBrief({ title: "Arcade" }), { game: true });
    expect(await readFile(join(dir, "GAME.md"), "utf8")).toContain("# Game brief");
  });

  it("adds three and phaser deps for those game scaffolds", async () => {
    const threeDir = await mkdtemp(join(tmpdir(), "locus-promote-three-"));
    await writeFile(join(threeDir, "index.html"), "<h1>Arena</h1>\n");
    await writePromoteScaffold(threeDir, "three-vite");
    expect(await readFile(join(threeDir, "package.json"), "utf8")).toContain("three");

    const phaserDir = await mkdtemp(join(tmpdir(), "locus-promote-phaser-"));
    await writeFile(join(phaserDir, "index.html"), "<h1>Arena</h1>\n");
    await writePromoteScaffold(phaserDir, "phaser");
    expect(await readFile(join(phaserDir, "package.json"), "utf8")).toContain("phaser");
  });

  it("tells a kit promote to port components instead of iframing the mock", () => {
    const brief = formatPromoteBrief({ title: "Landing", kit: true });
    expect(brief).toContain("## Brand kit");
    expect(brief).toMatch(/do not keep an iframe/i);
  });
});

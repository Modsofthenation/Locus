import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyDesignKitToWorkspace, designKitDir, saveDesignKit } from "./designKits.js";

describe("design kits", () => {
  it("saves kit files, strips a wrapper folder, and copies into a workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kit-"));
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const kit = await saveDesignKit(dir, id, [
      {
        name: "Harbor/skill/harbor-design/SKILL.md",
        data: Buffer.from("---\ntitle: Harbor\n---\nUse marketing kits.\n"),
      },
      {
        name: "Harbor/ui_kits/marketing/Hero.jsx",
        data: Buffer.from("export function Hero() { return <section /> }"),
      },
      {
        name: "Harbor/assets/logo.svg",
        data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      },
      { name: "Harbor/fonts/Inter.ttf", data: Buffer.alloc(40, 7) },
      {
        name: "Harbor/colors_and_type.css",
        data: Buffer.from(":root { --primary-600: #1F6B4A; }"),
      },
    ]);
    expect(kit?.skillName).toBe("harbor-design");
    expect(kit?.skillTitle).toBe("Harbor");
    expect(kit?.fileCount).toBe(5);
    expect(await readFile(join(dir, "design-kits", id, "assets/logo.svg"), "utf8")).toContain(
      "svg",
    );
    expect(
      await readFile(join(dir, "design-kits", id, "skill/harbor-design/SKILL.md"), "utf8"),
    ).toMatch(/marketing kits/);

    const ws = join(dir, "docker-workspaces", "s1");
    const copied = await copyDesignKitToWorkspace(dir, id, ws);
    expect(copied?.skillName).toBe("harbor-design");
    expect(await readFile(join(ws, "ui_kits/marketing/Hero.jsx"), "utf8")).toContain("Hero");
    expect(await readFile(join(ws, "fonts/Inter.ttf"))).toHaveLength(40);
    expect(await readFile(join(ws, ".locus/skills/harbor-design.md"), "utf8")).toMatch(
      /marketing kits/,
    );
  });

  it("rejects path-escape kit ids", () => {
    expect(() => designKitDir("/tmp", "../etc")).toThrow(/Invalid design system id/);
  });

  it("skips named palette systems that are not file kits", async () => {
    await expect(copyDesignKitToWorkspace("/tmp", "eval-kit", "/tmp/ws")).resolves.toBeUndefined();
    await expect(
      copyDesignKitToWorkspace("/tmp", "pixel-pack", "/tmp/ws"),
    ).resolves.toBeUndefined();
  });

  it("propagates kit write failures instead of skipping them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kit-write-"));
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await saveDesignKit(dir, id, [
      { name: "assets/logo.svg", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
    ]);
    await expect(
      copyDesignKitToWorkspace(dir, id, "", async () => {
        throw new Error("EIO");
      }),
    ).rejects.toThrow(/EIO/);
  });

  it.skipIf(process.platform === "win32")(
    "ignores non-kit paths and kit-dir symlinks when copying into a workspace",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-kit-guard-"));
      const id = "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";
      const kit = await saveDesignKit(dir, id, [
        { name: "assets/logo.svg", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") },
        { name: "index.html", data: Buffer.from("<html>nope</html>") },
      ]);
      expect(kit?.fileCount).toBe(1);
      const root = designKitDir(dir, id);
      await writeFile(
        join(root, "kit.json"),
        JSON.stringify({
          fileCount: 3,
          bytes: 20,
          files: ["assets/logo.svg", "index.html", "../secret.txt"],
        }),
      );
      await writeFile(join(root, "index.html"), "<html>nope</html>");
      await rm(join(root, "assets", "logo.svg"));
      await symlink("/etc/passwd", join(root, "assets", "logo.svg"));

      const ws = join(dir, "docker-workspaces", "s-guard");
      await copyDesignKitToWorkspace(dir, id, ws);
      await expect(readFile(join(ws, "index.html"))).rejects.toThrow();
      await expect(readFile(join(ws, "assets/logo.svg"))).rejects.toThrow();
      await expect(readFile(join(ws, "secret.txt"))).rejects.toThrow();
    },
  );
});

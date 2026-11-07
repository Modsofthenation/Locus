import { randomFillSync } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { unzipKitFiles, unzipTextFiles, zipStore } from "./unzip.js";

describe("zipStore / unzipTextFiles", () => {
  it("roundtrips nested text files and skips binaries and parent paths", () => {
    const buf = zipStore({
      "frontyard/_ds_manifest.json": '{"namespace":"Frontyard_978eb3"}',
      "frontyard/foundations/colors.html": "<html>--primary-600: #196BE6;</html>",
      "frontyard/_ds_bundle.js": "window.Frontyard_978eb3 = {};",
      "../secret.json": '{"nope":true}',
      "/tmp/evil.json": '{"nope":true}',
      "C:/Windows/evil.json": '{"nope":true}',
    });
    const files = unzipTextFiles(buf);
    const names = files.map((file) => file.name).sort();
    expect(names).toEqual(["frontyard/_ds_manifest.json", "frontyard/foundations/colors.html"]);
    expect(files.find((file) => file.name.endsWith("colors.html"))?.text).toContain("#196BE6");
  });

  it("keeps the manifest and foundations when the zip has more than 96 text files", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++)
      files[`components/c${String(i).padStart(3, "0")}.html`] = `<p>${i}</p>`;
    files["_ds_manifest.json"] = '{"namespace":"Keep_aaaaaa","cards":[],"source":"spa"}';
    files["foundations/colors.html"] = "<html>--primary-600: #196BE6;</html>";
    const names = unzipTextFiles(zipStore(files)).map((file) => file.name);
    expect(names).toContain("_ds_manifest.json");
    expect(names).toContain("foundations/colors.html");
    expect(names).toHaveLength(96);
    expect(names.indexOf("_ds_manifest.json")).toBeLessThan(names.indexOf("components/c000.html"));
  });

  it("reads a Claude Design-style kit with no directory entries and skips uploads, nested zips, and export HTML", () => {
    const tokens = `:root { --primary-600: #1F6B4A; --copy-50: #F7F4EE; --copy-800: #1C1914; }`;
    const names = unzipTextFiles(
      zipStore({
        "_ds_manifest.json": '{"namespace":"Harbor_a1b2c3","cards":[],"source":"spa"}',
        "colors_and_type.css": tokens,
        "preview/colors.html": `<style>${tokens}</style>`,
        ".design-canvas.state.json": '{"ok":true}',
        "skill/harbor-design/tokens.css": tokens,
        "uploads/source-notes.pdf": Buffer.alloc(80, 1),
        "uploads/inter.zip": Buffer.from("PK\x03\x04nested"),
        "export/index.html": `<html>${"a".repeat(4000)}</html>`,
        "hero.png": Buffer.alloc(40, 2),
      }),
    ).map((file) => file.name);
    expect(names).toContain("_ds_manifest.json");
    expect(names).toContain("colors_and_type.css");
    expect(names).toContain("preview/colors.html");
    expect(names).toContain(".design-canvas.state.json");
    expect(names).toContain("skill/harbor-design/tokens.css");
    expect(
      names.some(
        (name) =>
          name.startsWith("uploads/") || name.startsWith("export/") || name.endsWith(".png"),
      ),
    ).toBe(false);
  });

  it("accepts a zip larger than 8 MB when only small token files are extracted", () => {
    const blob = Buffer.alloc(9 * 1024 * 1024);
    randomFillSync(blob);
    const files = unzipTextFiles(
      zipStore({
        "uploads/ebook.pdf": blob,
        "colors_and_type.css":
          ":root { --primary-600: #196BE6; --copy-50: #F9FAFB; --copy-100: #EBECEE; --copy-500: #6B7280; --copy-800: #1F2A37; --navy-600: #1F2937; }",
      }),
    );
    expect(files.map((file) => file.name)).toEqual(["colors_and_type.css"]);
  });

  it("skips oversized HTML and still reads tokens.css", () => {
    const files = unzipTextFiles(
      zipStore({
        "landing.html": `<html>${"x".repeat(600 * 1024)}</html>`,
        "tokens.css":
          ":root { --primary: #196BE6; --bg: #F9FAFB; --surface: #EBECEE; --text: #1F2A37; --muted: #6B7280; --accent: #1F2937; }",
      }),
    );
    expect(files.map((file) => file.name)).toEqual(["tokens.css"]);
  });

  it("extracts a brand kit (skill, ui kits, assets, fonts) and skips uploads", () => {
    const zip = zipStore({
      "_ds_manifest.json": '{"namespace":"Harbor_a1b2c3","cards":[],"source":"spa"}',
      "colors_and_type.css": ":root { --primary-600: #1F6B4A; }",
      "skill/harbor-design/SKILL.md": "# Harbor\nUse marketing kits.\n",
      "ui_kits/marketing/Hero.jsx": "export function Hero() { return <section>Hero</section> }",
      "assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "fonts/Inter.ttf": Buffer.alloc(80, 7),
      "uploads/ebook.pdf": Buffer.alloc(200, 1),
      "export/index.html": "<html>nope</html>",
    });
    const kit = unzipKitFiles(zip)
      .map((file) => file.name)
      .sort();
    expect(kit).toEqual([
      "assets/logo.svg",
      "colors_and_type.css",
      "fonts/Inter.ttf",
      "skill/harbor-design/SKILL.md",
      "ui_kits/marketing/Hero.jsx",
    ]);
  });

  it("keeps kit fonts larger than 2 MB", () => {
    const font = Buffer.alloc(3 * 1024 * 1024, 7);
    const kit = unzipKitFiles(
      zipStore({
        "colors_and_type.css": ":root { --primary-600: #1F6B4A; }",
        "fonts/Inter.ttf": font,
      }),
    );
    expect(kit.find((file) => file.name === "fonts/Inter.ttf")?.data).toHaveLength(font.length);
  });

  it("rejects stored entries whose payload does not match the declared size", () => {
    expect(() =>
      unzipTextFiles(
        zipStored({ name: "bomb.json", data: Buffer.alloc(80, 0x61), uncompressedSize: 0 }),
      ),
    ).toThrow(/no design system files|corrupt|too large/);
    expect(() =>
      unzipTextFiles(
        zipStored({ name: "bomb.json", data: Buffer.alloc(80, 0x61), uncompressedSize: 8 }),
      ),
    ).toThrow(/corrupt|too large/);
  });

  it("caps inflated entries at the declared uncompressed size", () => {
    const raw = Buffer.alloc(200_000, 0x61);
    const compressed = deflateRawSync(raw);
    expect(() =>
      unzipTextFiles(
        zipStored({ name: "bomb.json", data: compressed, uncompressedSize: 0, method: 8 }),
      ),
    ).toThrow(/no design system files|corrupt|too large/);
    expect(() =>
      unzipTextFiles(
        zipStored({ name: "bomb.json", data: compressed, uncompressedSize: 16, method: 8 }),
      ),
    ).toThrow(/too large|corrupt/);
  });

  it("rejects junk that is not a zip", () => {
    expect(() => unzipTextFiles(Buffer.from("not a zip"))).toThrow(/Not a zip file/);
  });

  it("reads Zip64 EOCD/locator archives and explains missing Zip64 records", () => {
    const files = unzipTextFiles(
      withZip64(zipStore({ "tokens.css": ":root { --primary: #196BE6; }" })),
    );
    expect(files.map((file) => file.name)).toEqual(["tokens.css"]);
    const classic = zipStore({ "tokens.css": ":root { --primary: #196BE6; }" });
    const eocd = classic.length - 22;
    const broken = Buffer.from(classic);
    broken.writeUInt16LE(0xffff, eocd + 10);
    broken.writeUInt32LE(0xffffffff, eocd + 12);
    broken.writeUInt32LE(0xffffffff, eocd + 16);
    expect(() => unzipTextFiles(broken)).toThrow(/Zip64 archives need a Zip64 end record/);
  });
});

const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function withZip64(buf: Buffer): Buffer {
  const eocd = buf.length - 22;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const zip64 = Buffer.alloc(56);
  zip64.writeUInt32LE(ZIP64_EOCD_SIG, 0);
  zip64.writeBigUInt64LE(44n, 4);
  zip64.writeUInt16LE(45, 12);
  zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(BigInt(entries), 24);
  zip64.writeBigUInt64LE(BigInt(entries), 32);
  zip64.writeBigUInt64LE(BigInt(cdSize), 40);
  zip64.writeBigUInt64LE(BigInt(cdOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
  locator.writeBigUInt64LE(BigInt(eocd), 8);
  locator.writeUInt32LE(1, 16);
  const nextEocd = Buffer.from(buf.subarray(eocd));
  nextEocd.writeUInt16LE(0xffff, 8);
  nextEocd.writeUInt16LE(0xffff, 10);
  nextEocd.writeUInt32LE(0xffffffff, 12);
  nextEocd.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([buf.subarray(0, eocd), zip64, locator, nextEocd]);
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function zipStored(entry: {
  name: string;
  data: Buffer;
  uncompressedSize: number;
  method?: number;
}): Buffer {
  const method = entry.method ?? 0;
  const nameBuf = Buffer.from(entry.name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(LOCAL_SIG, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(entry.data.length, 18);
  local.writeUInt32LE(entry.uncompressedSize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(CENTRAL_SIG, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(entry.data.length, 20);
  central.writeUInt32LE(entry.uncompressedSize, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const cdStart = local.length + nameBuf.length + entry.data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, nameBuf, entry.data, central, nameBuf, eocd]);
}

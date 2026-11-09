import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const dir = process.argv[2] ?? "apps/desktop/dist-electron";
const outName = process.argv[3] ?? "SHA256SUMS";
if (outName.includes("/") || outName.includes("\\") || outName === "." || outName === "..") {
  throw new Error("checksum filename must be a basename");
}
const files = (await readdir(dir))
  .filter((name) => /\.(AppImage|deb|rpm|dmg|exe|zip)$/i.test(name))
  .sort();
const lines = [];
for (const file of files) {
  const buf = await readFile(join(dir, file));
  lines.push(`${createHash("sha256").update(buf).digest("hex")}  ${file}`);
}
const out = join(dir, outName);
await writeFile(out, lines.length ? `${lines.join("\n")}\n` : "");
process.stdout.write(lines.length ? `${lines.join("\n")}\n` : `no artifacts in ${basename(dir)}\n`);

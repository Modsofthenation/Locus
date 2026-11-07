import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildJolietIso, readJolietFiles, writeDirectoryIso } from "./iso.js";

describe("joliet iso", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("round-trips cloud-init filenames that are not 8.3", () => {
    const files = [
      { name: "user-data", data: Buffer.from("#cloud-config\nhostname: locus\n") },
      { name: "meta-data", data: Buffer.from("instance-id: locus-ubuntu\n") },
      { name: "vendor-data", data: Buffer.from("#cloud-config\n") },
    ];
    const image = buildJolietIso(files, "cidata");
    const read = readJolietFiles(image);
    expect(read.volumeId).toBe("cidata");
    expect(read.files.map((f) => f.name).sort()).toEqual(["meta-data", "user-data", "vendor-data"]);
    expect(read.files.find((f) => f.name === "user-data")?.data.toString()).toContain(
      "hostname: locus",
    );
  });

  it("writes a directory to a seed ISO", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-iso-"));
    dirs.push(dir);
    await writeFile(join(dir, "user-data"), "#cloud-config\n");
    await writeFile(join(dir, "meta-data"), "instance-id: x\n");
    const out = join(dir, "cidata.iso");
    await writeDirectoryIso(dir, out, "cidata");
    const image = await readFile(out);
    expect(readJolietFiles(image).files.map((f) => f.name)).toEqual(["meta-data", "user-data"]);
  });
});

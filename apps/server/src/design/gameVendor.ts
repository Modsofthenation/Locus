import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { GameVendorLib } from "@locus/shared";

const require = createRequire(import.meta.url);

const VENDOR_REL: Record<GameVendorLib, { dest: string; candidates: string[] }> = {
  three: {
    dest: "vendor/three.module.js",
    candidates: ["three/build/three.module.js", "three/build/three.core.js"],
  },
  phaser: {
    dest: "vendor/phaser.esm.js",
    candidates: ["phaser/dist/phaser.esm.js", "phaser/dist/phaser.esm.min.js"],
  },
};

export function gameVendorDest(lib: GameVendorLib): string {
  return VENDOR_REL[lib].dest;
}

export async function readGameVendorLib(lib: GameVendorLib): Promise<Buffer | undefined> {
  for (const spec of VENDOR_REL[lib].candidates) {
    try {
      const resolved = require.resolve(spec);
      return await readFile(resolved);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

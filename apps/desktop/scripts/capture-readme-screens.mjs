import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const snapshots = join(root, "../e2e/visual.spec.ts-snapshots");
const dest = join(root, "../../../docs/screenshots");

const copies = [
  ["new-agent-ember.png", "new_agent.png"],
  ["new-automation-ember.png", "new_automation.png"],
];

mkdirSync(dest, { recursive: true });
for (const [from, to] of copies) {
  const src = join(snapshots, from);
  if (!existsSync(src)) {
    console.error(`missing ${src} — run npm run test:visual:update first`);
    process.exit(1);
  }
  copyFileSync(src, join(dest, to));
  console.log(`copied ${from} -> ${to}`);
}

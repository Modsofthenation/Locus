import { randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import {
  PALETTE_ROLE_LABELS,
  PALETTE_ROLES,
  canvasRelativeAssetRefs,
  canvasRelativeCssUrls,
  type DesignComment,
  type DesignPalette,
} from "@locus/shared";

export const PROMOTE_SCAFFOLDS = [
  "vite-react",
  "static",
  "next",
  "astro",
  "canvas-vite",
  "three-vite",
  "phaser",
] as const;
export type PromoteScaffold = (typeof PROMOTE_SCAFFOLDS)[number];

export const PROMOTE_DOCKER_IMAGE = "node:22-bookworm";

export const PROMOTE_TOOLS = [
  "exec",
  "file_read",
  "file_write",
  "file_list",
  "grep",
  "glob",
  "apply_patch",
  "git_clone",
  "git_fetch",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_branch",
  "git_push",
  "git_pr",
  "start_process",
  "preview",
] as const;

export function parsePromoteScaffold(
  value: unknown,
  opts: { game?: boolean; assets?: boolean } = {},
): PromoteScaffold {
  if (
    value === "static" ||
    value === "next" ||
    value === "astro" ||
    value === "canvas-vite" ||
    value === "three-vite" ||
    value === "phaser" ||
    value === "vite-react"
  ) {
    return value;
  }
  if (opts.assets) return "three-vite";
  return opts.game ? "canvas-vite" : "vite-react";
}

export function formatPromoteBrief(session: {
  title?: string;
  palette?: DesignPalette;
  designSystemId?: string;
  designPins?: DesignComment[];
  messages?: Array<{
    toolCalls?: Array<{ name: string; result?: string }>;
  }>;
  kit?: boolean;
}): string {
  const parts = [
    "# Design brief",
    "",
    `Promoted from ${session.title?.trim() || "a Design canvas"}.`,
  ];
  const answers: string[] = [];
  for (const message of session.messages ?? []) {
    for (const call of message.toolCalls ?? []) {
      if (call.name !== "ask_user") continue;
      const result = call.result?.trim();
      if (result) answers.push(result);
    }
  }
  if (answers.length) parts.push("", "## Interview", "", answers.join("\n\n"));
  if (session.designPins?.length) {
    parts.push("", "## Comments");
    for (const pin of session.designPins) {
      parts.push(`- ${pin.viewport} \`${pin.selector}\`${pin.text ? `: ${pin.text}` : ""}`);
    }
  }
  if (session.palette) {
    parts.push("", "## Palette");
    for (const role of PALETTE_ROLES) {
      parts.push(`- ${PALETTE_ROLE_LABELS[role]}: ${session.palette[role]}`);
    }
  }
  if (session.designSystemId?.trim()) {
    parts.push("", `Design system id: ${session.designSystemId.trim()}`);
  }
  if (session.kit) {
    parts.push(
      "",
      "## Brand kit",
      "",
      "skill/, ui_kits/, assets/, fonts/, and tokens are in this workspace. Port those components into the scaffold. Do not keep an iframe of the mock.",
    );
  }
  parts.push("", "Port this canvas into the scaffold. Keep the operator comments and palette.");
  return parts.join("\n");
}

export async function writePromoteBrief(
  root: string,
  brief: string,
  opts: { game?: boolean; assets?: boolean } = {},
): Promise<void> {
  const text = brief.trim();
  if (!text) return;
  const name = opts.game ? "GAME.md" : opts.assets ? "ASSET.md" : "DESIGN.md";
  await writeInside(root, name, `${text}\n`);
}

export function promotePlaybook(
  scaffold: PromoteScaffold,
  kit = false,
  game = false,
  assets = false,
): string {
  const kitNote = kit
    ? " A brand kit is in the workspace (skill/, ui_kits/, assets/, fonts/, tokens). Port those components into the app. public/design.html is a visual reference — do not iframe it."
    : "";
  if (scaffold === "canvas-vite" || scaffold === "three-vite" || scaffold === "phaser") {
    const dep =
      scaffold === "three-vite" ? "three" : scaffold === "phaser" ? "phaser" : "the canvas loop";
    const kind = assets ? "asset" : "game";
    const brief = assets ? "ASSET.md" : "GAME.md";
    return `This workspace was promoted from a Locus ${kind} canvas. Read ${brief}. npm install && npm run dev, then preview port 5173. Keep the playable loop or studio, vendor assets under vendor/, and persist scores in localStorage. ${dep} is already in package.json when the scaffold needs it.`;
  }
  if (scaffold === "static") {
    if (assets) {
      return `This workspace was promoted from a Locus asset studio. Read ASSET.md. Serve /workspace/index.html, then call preview. Keep vendor/ and the rig.`;
    }
    return game
      ? `This workspace was promoted from a Locus game. Read GAME.md. Serve /workspace/index.html, then call preview. Keep vendor/ and the playable loop.`
      : `This workspace was promoted from Locus Design. Serve /workspace/index.html (python3 -m http.server --bind 0.0.0.0 5173 or npx serve -l tcp://0.0.0.0:5173), then call preview. Split the single HTML file when you need a real tree.${kitNote}`;
  }
  if (scaffold === "next") {
    return `This workspace was promoted from Locus Design. The Next.js app serves the original canvas at / (middleware rewrite to public/design.html). npm install && npm run dev, then preview port 5173. Delete middleware.ts when you replace app/page.tsx with real components.${kitNote}`;
  }
  if (scaffold === "astro") {
    return `This workspace was promoted from Locus Design. The Astro app serves the original canvas as src/pages/index.astro (the page response is the HTML, not an iframe). npm install && npm run dev, then preview port 5173. Replace index.astro with real components when you are ready.${kitNote}`;
  }
  return `This workspace was promoted from Locus Design. Original canvas HTML is public/design.html (also design/index.html). The Vite + React app is the repo. npm install && npm run dev, then preview port 5173. Port the markup into src/App.tsx instead of leaving the iframe forever.${kitNote}`;
}

const FALLBACK_HTML =
  '<!doctype html>\n<html><head><meta charset="utf-8"><title>Promoted design</title></head><body><h1>Promoted from Design</h1></body></html>\n';

const MAX_CANVAS_BYTES = 1_500_000;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."));
}

async function containedPath(root: string, relPath: string): Promise<string> {
  const dest = resolve(root, relPath);
  if (!isInside(resolve(root), dest)) throw new Error("Promote path escaped the workspace image");
  return dest;
}

async function assertInside(root: string, path: string): Promise<void> {
  const realRoot = await realpath(root);
  const real = await realpath(path);
  if (isInside(realRoot, real)) return;
  await unlink(path).catch(() => undefined);
  throw new Error("Promote path escaped the workspace image");
}

async function dropSymlink(path: string): Promise<void> {
  try {
    const st = await lstat(path);
    if (st.isSymbolicLink()) await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

async function readCanvasHtml(root: string): Promise<string> {
  const dest = await containedPath(root, "index.html");
  try {
    const link = await lstat(dest);
    if (link.isSymbolicLink() || !link.isFile()) return FALLBACK_HTML;
    if (link.size > MAX_CANVAS_BYTES) throw new Error("Canvas file is too large");
  } catch (err) {
    if (err instanceof Error && err.message === "Canvas file is too large") throw err;
    return FALLBACK_HTML;
  }
  try {
    await assertInside(root, dest);
  } catch {
    return FALLBACK_HTML;
  }
  const html = await readFile(dest, "utf8");
  if (html.length > MAX_CANVAS_BYTES) throw new Error("Canvas file is too large");
  return html.trim() ? html : FALLBACK_HTML;
}

async function mkdirInside(root: string, relPath: string): Promise<void> {
  const parts = relPath.split(/[/\\]/).filter((part) => part && part !== ".");
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const dest = await containedPath(root, acc);
    await dropSymlink(dest);
    await mkdir(dest, { recursive: true });
    await assertInside(root, dest);
  }
}

async function writeInside(root: string, relPath: string, content: string | Buffer): Promise<void> {
  const dest = await containedPath(root, relPath);
  const parent = dirname(relPath);
  if (parent && parent !== ".") await mkdirInside(root, parent);
  await dropSymlink(dest);
  const existing = await lstat(dest).catch(() => undefined);
  if (existing?.isDirectory()) await rm(dest, { recursive: true, force: true });
  const tmp = `${dest}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, content);
  try {
    await rename(tmp, dest);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await assertInside(root, dest);
}

const MAX_PROMOTE_ASSET_BYTES = 8_000_000;
const MAX_PROMOTE_ASSETS = 64;

async function copyInside(root: string, fromRel: string, toRel: string): Promise<boolean> {
  const src = await containedPath(root, fromRel);
  try {
    const link = await lstat(src);
    if (link.isSymbolicLink() || !link.isFile()) return false;
    if (link.size > MAX_PROMOTE_ASSET_BYTES) return false;
    await assertInside(root, src);
  } catch {
    return false;
  }
  if (fromRel === toRel) return true;
  const dest = await containedPath(root, toRel);
  const parent = dirname(toRel);
  if (parent && parent !== ".") await mkdirInside(root, parent);
  await dropSymlink(dest);
  const existing = await lstat(dest).catch(() => undefined);
  if (existing?.isDirectory()) await rm(dest, { recursive: true, force: true });
  await copyFile(src, dest);
  await assertInside(root, dest);
  return true;
}

function joinAssetRel(fromFile: string, rel: string): string | undefined {
  const dir = posix.dirname(fromFile);
  const joined = posix.normalize(dir === "." ? rel : `${dir}/${rel}`).replace(/\\/g, "/");
  if (!joined || joined.startsWith("..") || posix.isAbsolute(joined)) return undefined;
  return joined;
}

/** Copy files the canvas HTML links so they still resolve next to public/design.html. */
export async function copyPromoteCanvasAssets(
  root: string,
  html: string,
  destPrefix: string,
): Promise<void> {
  const prefix = destPrefix.replace(/\/+$/, "");
  const pending = [...canvasRelativeAssetRefs(html)];
  const seen = new Set<string>();
  let copied = 0;
  while (pending.length && copied < MAX_PROMOTE_ASSETS) {
    const rel = pending.shift();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const destRel = prefix ? `${prefix}/${rel}` : rel;
    const ok = await copyInside(root, rel, destRel);
    if (!ok) continue;
    copied += 1;
    if (!/\.css$/i.test(rel)) continue;
    try {
      const css = await readFile(await containedPath(root, rel), "utf8");
      for (const nested of canvasRelativeCssUrls(css)) {
        const joined = joinAssetRel(rel, nested);
        if (joined && !seen.has(joined)) pending.push(joined);
      }
    } catch {
      /* CSS parse is best-effort */
    }
  }
}

export async function writePromoteScaffold(
  root: string,
  scaffold: PromoteScaffold,
  opts: { kit?: boolean } = {},
): Promise<void> {
  const html = await readCanvasHtml(root);
  const kit = Boolean(opts.kit);
  if (scaffold === "canvas-vite" || scaffold === "three-vite" || scaffold === "phaser") {
    await writeGameViteScaffold(root, html, scaffold);
    return;
  }
  if (scaffold === "static") {
    await writeInside(root, "index.html", html);
    await writeInside(
      root,
      "README.md",
      "Promoted from Locus Design. This is the original canvas HTML. Serve it, then split into a real tree when you are ready.\n",
    );
    return;
  }
  if (scaffold === "next") {
    await mkdirInside(root, "app");
    await mkdirInside(root, "public");
    await writeInside(root, "public/design.html", html);
    await copyPromoteCanvasAssets(root, html, "public");
    await writeInside(root, "package.json", NEXT_PACKAGE_JSON);
    await writeInside(root, "next.config.ts", NEXT_CONFIG);
    await writeInside(root, "tsconfig.json", NEXT_TSCONFIG);
    await writeInside(root, "app/layout.tsx", NEXT_LAYOUT);
    await writeInside(root, "app/page.tsx", NEXT_PAGE);
    await writeInside(root, "middleware.ts", NEXT_MIDDLEWARE);
    await writeInside(
      root,
      "README.md",
      "Promoted from Locus Design.\n\n```bash\nnpm install\nnpm run dev\n```\n\n`/` serves `public/design.html` via `middleware.ts`. Delete the middleware when `app/page.tsx` is the real UI.\n",
    );
    return;
  }
  if (scaffold === "astro") {
    await mkdirInside(root, "src/pages");
    await mkdirInside(root, "public");
    await writeInside(root, "public/design.html", html);
    await copyPromoteCanvasAssets(root, html, "public");
    await writeInside(root, "package.json", ASTRO_PACKAGE_JSON);
    await writeInside(root, "astro.config.mjs", ASTRO_CONFIG);
    await writeInside(root, "src/pages/index.astro", astroIndexPage(html));
    await writeInside(
      root,
      "README.md",
      "Promoted from Locus Design.\n\n```bash\nnpm install\nnpm run dev\n```\n\n`src/pages/index.astro` returns the original canvas HTML (not an iframe). Replace it with real components when you are ready.\n",
    );
    return;
  }
  await mkdirInside(root, "src");
  await mkdirInside(root, "public");
  await mkdirInside(root, "design");
  await writeInside(root, "public/design.html", html);
  await writeInside(root, "design/index.html", html);
  await copyPromoteCanvasAssets(root, html, "public");
  await copyPromoteCanvasAssets(root, html, "design");
  await writeInside(root, "package.json", PACKAGE_JSON);
  await writeInside(root, "vite.config.ts", VITE_CONFIG);
  await writeInside(root, "tsconfig.json", TSCONFIG);
  await writeInside(root, "index.html", VITE_INDEX);
  await writeInside(root, "src/main.tsx", MAIN_TSX);
  await writeInside(root, "src/App.tsx", kit ? APP_TSX_KIT : APP_TSX);
  await writeInside(root, "src/vite-env.d.ts", '/// <reference types="vite/client" />\n');
  await writeInside(
    root,
    "README.md",
    kit
      ? "Promoted from Locus Design.\n\n```bash\nnpm install\nnpm run dev\n```\n\nPort `ui_kits/` into `src/App.tsx`. `public/design.html` is a visual reference — do not iframe it.\n"
      : "Promoted from Locus Design.\n\n```bash\nnpm install\nnpm run dev\n```\n\nOriginal canvas: `public/design.html`. Replace the iframe in `src/App.tsx` with real components.\n",
  );
}

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "locus-design",
    private: true,
    type: "module",
    scripts: {
      dev: "vite --host 0.0.0.0 --port 5173",
      build: "vite build",
      preview: "vite preview --host 0.0.0.0 --port 5173",
    },
    dependencies: {
      react: "^19.1.0",
      "react-dom": "^19.1.0",
    },
    devDependencies: {
      "@types/react": "^19.1.0",
      "@types/react-dom": "^19.1.0",
      "@vitejs/plugin-react": "^4.4.1",
      typescript: "^5.8.3",
      vite: "^6.3.5",
    },
  },
  null,
  2,
)}\n`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
`;

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["src"],
  },
  null,
  2,
)}\n`;

const VITE_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Promoted design</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const APP_TSX = `export default function App() {
  return (
    <iframe
      title="Promoted design"
      src="/design.html"
      style={{ border: 0, width: "100%", minHeight: "100vh" }}
    />
  );
}
`;

const APP_TSX_KIT = `export default function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <p>
        Port the kit in <code>ui_kits/</code> into this file. The original canvas is{" "}
        <code>public/design.html</code> (reference only — do not iframe it).
      </p>
    </main>
  );
}
`;

const NEXT_PACKAGE_JSON = `${JSON.stringify(
  {
    name: "locus-design",
    private: true,
    scripts: {
      dev: "next dev -H 0.0.0.0 -p 5173",
      build: "next build",
      start: "next start -H 0.0.0.0 -p 5173",
    },
    dependencies: {
      next: "^15.3.2",
      react: "^19.1.0",
      "react-dom": "^19.1.0",
    },
    devDependencies: {
      "@types/node": "^22.15.17",
      "@types/react": "^19.1.0",
      "@types/react-dom": "^19.1.0",
      typescript: "^5.8.3",
    },
  },
  null,
  2,
)}\n`;

const NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;

const NEXT_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "preserve",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      incremental: true,
      plugins: [{ name: "next" }],
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
    exclude: ["node_modules"],
  },
  null,
  2,
)}\n`;

const NEXT_LAYOUT = `import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
`;

const NEXT_PAGE = `export default function Page() {
  return (
    <p>
      Canvas is served at <code>/</code> via middleware rewrite to <code>public/design.html</code>.
      Delete <code>middleware.ts</code> when this page is the real UI.
    </p>
  );
}
`;

const NEXT_MIDDLEWARE = `import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/design.html", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
`;

const ASTRO_PACKAGE_JSON = `${JSON.stringify(
  {
    name: "locus-design",
    private: true,
    type: "module",
    scripts: {
      dev: "astro dev --host 0.0.0.0 --port 5173",
      build: "astro build",
      preview: "astro preview --host 0.0.0.0 --port 5173",
    },
    dependencies: {
      astro: "^5.7.10",
    },
  },
  null,
  2,
)}\n`;

const ASTRO_CONFIG = `import { defineConfig } from "astro/config";

export default defineConfig({
  server: { host: true, port: 5173 },
});
`;

function astroIndexPage(html: string): string {
  return `---
const html = ${JSON.stringify(html)};
return new Response(html, {
  headers: { "content-type": "text/html;charset=utf-8" },
});
---
`;
}

export function promoteScaffoldLabel(scaffold: PromoteScaffold): string {
  if (scaffold === "static") return "static HTML";
  if (scaffold === "next") return "Next.js";
  if (scaffold === "astro") return "Astro";
  if (scaffold === "canvas-vite") return "Canvas + Vite";
  if (scaffold === "three-vite") return "Three.js + Vite";
  if (scaffold === "phaser") return "Phaser + Vite";
  return "Vite + React";
}

async function writeGameViteScaffold(
  root: string,
  html: string,
  scaffold: "canvas-vite" | "three-vite" | "phaser",
): Promise<void> {
  const deps =
    scaffold === "three-vite"
      ? { three: "^0.170.0" }
      : scaffold === "phaser"
        ? { phaser: "^3.87.0" }
        : {};
  await mkdirInside(root, "vendor");
  await writeInside(root, "index.html", html);
  await writeInside(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "locus-game",
        private: true,
        type: "module",
        scripts: {
          dev: "vite --host 0.0.0.0 --port 5173",
          build: "vite build",
          preview: "vite preview --host 0.0.0.0 --port 5173",
        },
        dependencies: deps,
        devDependencies: { vite: "^6.3.5" },
      },
      null,
      2,
    )}\n`,
  );
  await writeInside(
    root,
    "vite.config.ts",
    `import { defineConfig } from "vite";\n\nexport default defineConfig({\n  server: { host: true, port: 5173 },\n});\n`,
  );
  await writeInside(
    root,
    "README.md",
    `Promoted from a Locus game canvas.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nOriginal playable is \`index.html\`. Vendor assets stay in \`vendor/\`. Read GAME.md.\n`,
  );
}

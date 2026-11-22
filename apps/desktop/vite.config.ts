import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { homedir } from "node:os";

const dir = import.meta.dirname;
const pkg = JSON.parse(readFileSync(path.resolve(dir, "package.json"), "utf8")) as {
  version: string;
};
const licenseText = readFileSync(path.resolve(dir, "../../LICENSE"), "utf8");
const copyright = licenseText.match(/^Copyright \(c\) .+$/m)?.[0] ?? "";

/**
 * Dev only: the control plane wants its operator token on /api and /ws. Electron
 * sets it as a cookie; a plain browser on the Vite port gets it from this proxy.
 * Read per request so a control plane started after Vite still works.
 */
function devOperatorToken(): string | undefined {
  const fromEnv = process.env.LOCUS_OPERATOR_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const home = process.env.LOCUS_HOME?.trim() || path.join(homedir(), ".locus");
    return readFileSync(path.join(home, "operator.token"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

type ProxyLike = {
  on(
    event: "proxyReq" | "proxyReqWs",
    listener: (req: { setHeader(name: string, value: string): void }) => void,
  ): void;
};

function withOperatorToken(proxy: ProxyLike) {
  const add = (req: { setHeader(name: string, value: string): void }) => {
    const token = devOperatorToken();
    if (token) req.setHeader("x-locus-operator", token);
  };
  proxy.on("proxyReq", add);
  proxy.on("proxyReqWs", add);
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_LICENSE_TEXT__: JSON.stringify(licenseText.trimEnd()),
    __APP_COPYRIGHT__: JSON.stringify(copyright),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dir, "src"),
      "@locus/shared": path.resolve(dir, "../../packages/shared/src/index.ts"),
    },
  },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler)\b/,
              priority: 20,
            },
            {
              name: "novnc",
              test: /node_modules[\\/]@novnc[\\/]/,
              priority: 15,
            },
            {
              name: "xterm",
              test: /node_modules[\\/]@xterm[\\/]/,
              priority: 15,
            },
            {
              name: "shared-canvas",
              test: /packages[\\/]shared[\\/]src[\\/]models[\\/](?:game|asset|board|playwright)/,
              priority: 12,
            },
            {
              name: "shared-tools",
              test: /packages[\\/]shared[\\/]src[\\/]models[\\/](?:tools|toolSchemas|recipes)\b/,
              priority: 12,
            },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    rolldownOptions: {
      transform: { target: "es2022" },
    },
  },
  server: {
    port: 5173,
    allowedHosts: ["locus-canvas.localhost", ".localhost"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7420",
        configure: (proxy) => withOperatorToken(proxy as unknown as ProxyLike),
      },
      "/ws": {
        target: "ws://127.0.0.1:7420",
        ws: true,
        configure: (proxy) => withOperatorToken(proxy as unknown as ProxyLike),
      },
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});

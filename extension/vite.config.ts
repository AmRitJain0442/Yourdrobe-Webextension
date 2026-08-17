import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

function localApiPermissionPlugin(apiBaseUrl: string): Plugin | null {
  let origin: string;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    return null;
  }
  if (origin !== "http://127.0.0.1:8001") return null;
  return {
    name: "yourdrobe-local-api-permission",
    closeBundle() {
      const manifestPath = resolve(root, "dist/manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { host_permissions: string[] };
      manifest.host_permissions.push(`${origin}/*`);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const localPermission = localApiPermissionPlugin(loadEnv(mode, root, "").VITE_API_BASE_URL || "");
  return {
    plugins: [react(), ...(localPermission ? [localPermission] : [])],
    build: {
      rollupOptions: {
        input: {
          sidepanel: resolve(root, "sidepanel.html"),
          background: resolve(root, "src/background/service-worker.ts"),
          content: resolve(root, "src/content/content-script.ts"),
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
    test: { environment: "jsdom" },
  };
});

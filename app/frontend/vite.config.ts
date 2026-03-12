import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

interface RunKitConfig {
  server?: { port?: number; host?: string };
}

function loadConfig(): RunKitConfig {
  try {
    return parse(
      readFileSync(resolve(__dirname, "../../run-kit.yaml"), "utf8"),
    ) as RunKitConfig;
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const apiPort = cfg.server?.port ?? 3000;
const apiHost = cfg.server?.host ?? "127.0.0.1";
const backendTarget = `http://${apiHost}:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    host: apiHost,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
      "/relay": {
        target: backendTarget.replace("http", "ws"),
        ws: true,
      },
    },
  },
});

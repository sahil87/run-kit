import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

function loadBackendTarget(): string {
  try {
    const doc = parse(
      readFileSync(resolve(__dirname, "../../run-kit.yaml"), "utf8"),
    );
    const port = doc?.server?.port ?? 3000;
    const host = doc?.server?.host ?? "127.0.0.1";
    return `http://${host}:${port}`;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

const backendTarget = loadBackendTarget();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
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

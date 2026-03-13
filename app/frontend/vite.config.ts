import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const backendPort = process.env.BACKEND_PORT ?? "3001";
const host = process.env.BACKEND_HOST ?? "127.0.0.1";
const backendTarget = `http://${host}:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    host,
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

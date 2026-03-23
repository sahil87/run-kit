import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@configs": resolve(__dirname, "../../configs"),
    },
  },
  server: {
    host: process.env.RK_HOST ?? "127.0.0.1",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${(parseInt(process.env.RK_PORT ?? "3000") + 1)}`,
        changeOrigin: true,
      },
      "/relay": {
        target: `ws://127.0.0.1:${(parseInt(process.env.RK_PORT ?? "3000") + 1)}`,
        ws: true,
      },
    },
  },
});

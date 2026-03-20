import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "RunKit",
        short_name: "RunKit",
        description: "Web-based agent orchestration dashboard",
        start_url: "/",
        display: "standalone",
        background_color: "#0f1117",
        theme_color: "#0f1117",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\/relay\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
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

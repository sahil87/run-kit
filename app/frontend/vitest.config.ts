import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    passWithNoTests: true,
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});

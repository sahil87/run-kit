import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RK_PORT ?? "3000");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 10_000,
  retries: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "just --justfile ../../justfile --working-directory ../.. dev",
    port,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

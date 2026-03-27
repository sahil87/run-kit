import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RK_PORT ?? "3333");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 10_000,
  retries: 1,
  fullyParallel: false,
  globalTeardown: "./tests/e2e/global-teardown.ts",
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
    command: `echo "webServer managed externally"`,
    port,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});

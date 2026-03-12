import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
  },
});

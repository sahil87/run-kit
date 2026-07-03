import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RK_PORT ?? "3333");

export default defineConfig({
  testDir: "./tests/e2e",
  // Per-test timeout. Wider on CI: the SSE-driven UI updates that most specs
  // assert on are noticeably slower on a 2-vCPU shared runner where air, Vite,
  // Chromium and tmux all contend for the box. Specs gate on real readiness
  // signals (see _ready.ts); this is the outer budget those gates live within.
  timeout: process.env.CI ? 30_000 : 10_000,
  retries: 1,
  // Serial everywhere: every spec targets one shared tmux server (rk-test-e2e)
  // and one dev server, and the SSE stream broadcasts session changes to ALL
  // connected clients. Running workers in parallel therefore lets one worker's
  // sessions appear in another's sidebar — a correctness race, not just load.
  // CI gets its speed from sharding across containers (each a fresh tmux +
  // dev server) instead, see .github/workflows/ci.yml.
  fullyParallel: false,
  workers: 1,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    // Emulate reduced motion so the window-switch slide transition
    // (260703-l4nf) is disabled via its own progressive-enhancement fallback.
    // Animations are a known Playwright flake source; the product honors
    // `prefers-reduced-motion: reduce` by short-circuiting to an instant
    // switch, so existing window-switch specs run against instant switches.
    // `reducedMotion` is not a top-level `use` fixture in this Playwright
    // version — it only reaches the browser context via `contextOptions`
    // (spread into the context options at creation), so set it there. The one
    // spec that exercises the animated path opts back in with
    // `test.use({ contextOptions: { reducedMotion: "no-preference" } })`.
    contextOptions: { reducedMotion: "reduce" },
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

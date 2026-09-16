import { defineConfig, devices } from "@playwright/test";
import { applyWorkerRig } from "./tests/e2e/_rig";

// Multi-rig lane: inside a worker process this re-points the harness env
// vars at the worker's own rig. It MUST run before the first env read below
// (and before any spec module loads) — see _rig.ts for the ordering contract.
applyWorkerRig();

// E2E_PORT is set only by the harness (scripts/test-e2e.sh, scripts/pw.sh).
// Never read the ambient RK_PORT here: direnv exports it into every shell, so
// consulting it would point a bare `playwright test` at a live dev server —
// 3333 is the fail-closed connect-to-nothing fallback.
const port = Number(process.env.E2E_PORT ?? "3333");

// Worker pool size, harness-set (RK_E2E_WORKERS). Anything but a positive
// integer means the single-rig lane: one worker.
const workersRaw = Number(process.env.RK_E2E_WORKERS ?? "1");
const workers = Number.isInteger(workersRaw) && workersRaw >= 1 ? workersRaw : 1;

export default defineConfig({
  testDir: "./tests/e2e",
  grepInvert: process.env.RK_E2E_PERF === "1" ? undefined : /@perf/,
  // Per-test timeout. Wider on CI: the SSE-driven UI updates that most specs
  // assert on are noticeably slower on a 4-vCPU shared runner where two rigs'
  // Go, Vite, Chromium and tmux all contend for the box. Specs gate on real readiness
  // signals (see _ready.ts); this is the outer budget those gates live within.
  timeout: process.env.CI ? 30_000 : 10_000,
  retries: 1,
  // Serial within a rig: every spec targets its rig's one tmux server (the
  // worktree's derived e2e primary, rk-test-e2e-<token>-0, in the single-rig
  // lane) and one dev server, and the SSE stream broadcasts session changes to
  // ALL connected clients. Two workers on ONE rig would therefore see each
  // other's sessions in their sidebars — a correctness race, not just load —
  // so the pool is only ever as wide as the number of rigs the harness
  // started (RK_E2E_WORKERS, one rig per worker; default one). Tests inside a
  // file stay serial either way (fullyParallel off): a file's beforeAll seeds
  // tmux state the file's tests share. CI adds sharding across runners on top,
  // see .github/workflows/ci.yml.
  fullyParallel: false,
  workers,
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

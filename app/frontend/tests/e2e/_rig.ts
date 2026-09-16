/**
 * Multi-rig lane: point this worker at its own rig.
 *
 * `scripts/test-e2e.sh` with RK_E2E_WORKERS=N starts N complete rigs (tmux
 * server + backend + Vite + code-server stub port + state home) and passes
 * their table as E2E_RIGS, one row per Playwright parallel index. Every spec
 * and helper reads the rig identity from the harness env vars at module load
 * (E2E_PORT, E2E_TMUX_SERVER, …), so instead of threading a fixture through
 * ~35 files this rewrites those vars inside the worker process before any
 * spec module is imported.
 *
 * Ordering contract: Playwright re-evaluates `playwright.config.ts` inside
 * each worker process AFTER setting TEST_PARALLEL_INDEX and BEFORE loading
 * test files, and the config calls this first thing — so the rewrite lands
 * ahead of every module-level env read. The main process has no parallel
 * index and keeps the harness values (rig 0): they serve the reporter, the
 * webServer probe and global teardown, whose family anchor must stay the
 * worktree-level one so it sweeps every rig.
 *
 * Single-rig lane (no E2E_RIGS) and bare `playwright test` runs are untouched.
 */

interface Rig {
  /** Vite port; backend is +1, code-server stub +2. */
  port: number;
  tmuxServer: string;
  /** This rig's socket sub-family — specs name secondaries under it and the
   *  rig's backend allowlists exactly it. */
  tmuxFamily: string;
  /** Per-rig XDG_STATE_HOME; `config/` under it is RK_CONFIG_DIR. */
  stateHome: string;
}

export function applyWorkerRig(): void {
  const raw = process.env.E2E_RIGS;
  const index = process.env.TEST_PARALLEL_INDEX;
  if (!raw || index === undefined) return;
  const rigs = JSON.parse(raw) as Rig[];
  const rig = rigs[Number(index)];
  if (!rig) {
    throw new Error(
      `E2E_RIGS lists ${rigs.length} rig(s) but this worker has parallelIndex ${index} — ` +
        `RK_E2E_WORKERS and the harness rig count disagree`,
    );
  }
  process.env.E2E_PORT = String(rig.port);
  process.env.RK_PORT = String(rig.port);
  process.env.RK_CODE_SERVER_PORT = String(rig.port + 2);
  process.env.E2E_TMUX_SERVER = rig.tmuxServer;
  process.env.E2E_TMUX_FAMILY = rig.tmuxFamily;
  process.env.XDG_STATE_HOME = rig.stateHome;
  process.env.RK_CONFIG_DIR = `${rig.stateHome}/config`;
}

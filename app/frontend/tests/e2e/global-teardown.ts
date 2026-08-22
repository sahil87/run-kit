import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

export default function globalTeardown() {
  // Family anchor when the harness provides it (per-worktree isolation —
  // trailing hyphen included so only THIS worktree's family matches); the
  // literal fallback preserves the pre-derivation behavior for direct
  // unset-env runs.
  const prefix =
    process.env.E2E_TMUX_FAMILY ??
    (process.env.E2E_TMUX_SERVER ?? "rk-test-e2e");

  // Kill the primary e2e server AND any secondary servers tests spun up
  // (…-multi-*, …-msb-*, …-scope-*, …-csw-*) by prefix-scanning the
  // socket directory.
  // Mirrors the shell trap's prefix-complete behavior so a crash/interrupt that
  // skipped a spec's afterAll does not leak sockets. Best-effort throughout:
  // a socket already removed by the shell trap (or a prior afterAll) must not
  // fail teardown.
  //
  // Always include the primary server in the kill set so it is reaped even
  // when getuid is unavailable or the socket dir can't be read — without it,
  // an enumeration failure would silently leak the primary, regressing the
  // prior unconditional `tmux -L <server> kill-server`. The primary is
  // E2E_TMUX_SERVER when set; otherwise the derived form `<family>0` (never
  // the bare anchor — it names no real socket); the literal fallback matches
  // the literal prefix. A Set dedups against the scanned entries.
  const primary =
    process.env.E2E_TMUX_SERVER ??
    (process.env.E2E_TMUX_FAMILY ? `${process.env.E2E_TMUX_FAMILY}0` : "rk-test-e2e");
  const sockets = new Set<string>([primary]);
  try {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      for (const name of readdirSync(`/tmp/tmux-${uid}`)) {
        if (name.startsWith(prefix)) sockets.add(name);
      }
    }
  } catch {
    // Socket dir missing — fall back to reaping just the primary prefix.
  }

  for (const server of sockets) {
    try {
      execSync(`tmux -L ${server} kill-server`, { stdio: "ignore" });
    } catch {
      // Server may already be gone.
    }
  }
}

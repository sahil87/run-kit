import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

export default function globalTeardown() {
  const prefix = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

  // Kill the primary e2e server AND any secondary rk-test-e2e-* servers tests
  // spun up (rk-test-e2e-multi-*, rk-test-e2e-coupling-*) by globbing the
  // socket directory.
  // Mirrors the shell trap's prefix-complete behavior so a crash/interrupt that
  // skipped a spec's afterAll does not leak sockets. Best-effort throughout:
  // a socket already removed by the shell trap (or a prior afterAll) must not
  // fail teardown.
  //
  // Always include the literal prefix (the primary server) in the kill set so
  // it is reaped even when getuid is unavailable or the socket dir can't be
  // read — without it, an enumeration failure would silently leak the primary,
  // regressing the prior unconditional `tmux -L <prefix> kill-server`. A Set
  // dedups it against the globbed entry.
  const sockets = new Set<string>([prefix]);
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

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

export default function globalTeardown() {
  const prefix = process.env.E2E_TMUX_SERVER ?? "rk-e2e";

  // Kill the primary e2e server AND any secondary rk-e2e-* servers tests spun
  // up (rk-e2e-multi-*, rk-e2e-coupling-*) by globbing the socket directory.
  // Mirrors the shell trap's prefix-complete behavior so a crash/interrupt that
  // skipped a spec's afterAll does not leak sockets. Best-effort throughout:
  // a socket already removed by the shell trap (or a prior afterAll) must not
  // fail teardown.
  let sockets: string[] = [];
  try {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      sockets = readdirSync(`/tmp/tmux-${uid}`).filter((name) =>
        name.startsWith(prefix),
      );
    }
  } catch {
    // Socket dir missing — nothing to reap.
  }

  for (const server of sockets) {
    try {
      execSync(`tmux -L ${server} kill-server`, { stdio: "ignore" });
    } catch {
      // Server may already be gone.
    }
  }
}

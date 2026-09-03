import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

export default function globalTeardown() {
  // Family anchor when the harness provides it (per-worktree isolation —
  // trailing hyphen included so only THIS worktree's family matches).
  //
  // No identity, no teardown: the harness (test-e2e.sh / pw.sh) always
  // exports both vars, so unset env means an unmanaged direct
  // `playwright test` run that owns no server of its own. A literal
  // "rk-test-e2e" fallback here would prefix-match EVERY derived family
  // (rk-test-e2e-<token>-…) and kill sibling worktrees' in-flight servers —
  // the exact cross-worktree bleed the derived naming exists to prevent.
  const family = process.env.E2E_TMUX_FAMILY;
  const server = process.env.E2E_TMUX_SERVER;
  if (!family && !server) return;
  const prefix = family ?? server!;

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
  // the bare anchor — it names no real socket). A Set dedups against the
  // scanned entries.
  const primary = server ?? `${family}0`;
  const sockets = new Set<string>([primary]);

  // A token-less anchor is never a valid single-worktree family: it is a strict
  // prefix of EVERY derived family (rk-test-e2e-<token>-…), so the scan below
  // would reap sibling worktrees' in-flight servers. It reaches here when
  // E2E_TMUX_SERVER is preset to a bare default with no family — e2e-env.sh
  // then collapses E2E_TMUX_FAMILY to the server name as-is. The primary stays
  // in the kill set: it is an exact name, not a prefix.
  const bareAnchor = prefix === "rk-test-e2e" || prefix === "rk-test-e2e-";
  if (bareAnchor) {
    console.warn(
      `[e2e teardown] refusing the family sweep: anchor "${prefix}" is a bare default ` +
        `that prefixes every worktree's family. Reaping only the primary "${primary}".`,
    );
  } else {
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
  }

  for (const server of sockets) {
    try {
      execSync(`tmux -L ${server} kill-server`, { stdio: "ignore" });
    } catch {
      // Server may already be gone.
    }
  }
}

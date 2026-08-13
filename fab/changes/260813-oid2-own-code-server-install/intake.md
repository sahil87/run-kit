# Intake: Own the code-server Install

**Change**: 260813-oid2-own-code-server-install
**Created**: 2026-08-13

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized design discussion with the user. The discussion settled the install mechanism, directory layout, acquisition flow, CLI surface, `rk update` integration (with four explicit constraints), and brew/doctor cleanup — those decisions are captured verbatim below and encoded as Certain assumptions.

> Replace the Homebrew code-server dependency with rk-owned install. code-server currently arrives via `depends_on "code-server"` in run-kit's brew formula. Homebrew's code-server formula is deprecated and pinned at 4.112.0 (it bundles non-FOSS `@github/copilot` since 4.113.0) and will be disabled on 2027-04-11 — at which point `brew install run-kit` itself starts failing because its dependency is disabled. Decision: rk-managed standalone tarball install, daemon-owned, single owner.

## Why

1. **The pain point**: run-kit's brew formula (`.github/formula-template.rb` line 11) declares `depends_on "code-server"`. Homebrew's code-server formula is **deprecated and pinned at 4.112.0** — it stopped updating because code-server bundles non-FOSS `@github/copilot` since 4.113.0 — and is scheduled to be **disabled on 2027-04-11**. Upstream code-server is at v4.132.0 (2026-08-10), 20 minor versions ahead of what brew delivers.

2. **The consequence if unfixed**: this is a ticking bomb for run-kit's **own installability**, not just staleness. When brew disables the formula, `brew install run-kit` starts failing outright because its declared dependency can no longer be installed. Users are also stuck on an ever-older editor in the `/code` lens until then.

3. **Why this approach**: download the official standalone release tarball from GitHub releases (`code-server-<ver>-{linux,macos}-{amd64,arm64}.tar.gz`) — self-contained (Node bundled), no sudo, and covers exactly run-kit's four release platforms — digest-verified via the GitHub release API's per-asset SHA-256 digests. The daemon is the **sole owner** of acquisition; brew's role shrinks to nothing. Alternatives explicitly rejected in the design discussion:
   - **Official install script** (`curl code-server.dev/install.sh | sh`) — its macOS detect mode lands on the deprecated brew formula; piping a remote script to sh clashes with Constitution I posture; rk loses version knowledge.
   - **npm global install** — needs a Node toolchain, compiles native modules; upstream only recommends it for exotic arch/glibc combinations.
   - **deb/rpm packages** — Linux-only, need sudo, no macOS.
   - **Docker image** — wrong shape; the daemon spawns code-server in a tmux session against host worktrees.
   - **Brew `post_install` pre-warm calling `rk code-server install`** — considered, then rejected by the user: no two owners. The daemon is the sole owner.

## What Changes

### Directory layout (user-decided, explicit sibling names)

- `~/.rk/code-server-bin/<version>/` + a `current` symlink — the rk-managed binary home. Updates are an **atomic symlink flip** (a running process keeps its old binary open — fine on unix).
- `~/.rk/code-server-profile` — the `--user-data-dir`. NOTE: `~/.rk/code-server` is ALREADY shipped as the profile dir (change 260812-71bv; `codeServerProfileDir` in `app/backend/internal/daemon/codeserver.go`). Requires a **one-shot migration**: at daemon start, if the old dir exists and `code-server-profile` doesn't, `os.Rename` it. This preserves existing settings + hot-exit state; the write-once seed logic (`seedCodeServerSettings`) is untouched.

### Acquisition flow (daemon start: A/B/C shape)

Daemon start runs "rk server" (A) as today. `ensureCodeServer` (`app/backend/internal/daemon/codeserver.go`) resolves the binary via a **two-rung ladder**: `~/.rk/code-server-bin/current` first, then PATH (`exec.LookPath`) — a user-managed code-server on PATH is still respected, same spirit as the existing externally-managed-port carve-out (rung 3 of today's ensureCodeServer).

- **Binary resolvable** → start the `rk-code-server` session directly (today's path, inline).
- **Binary missing** → spawn a download job (B) as a window in the `rk-jobs` sibling session (the persistent-job-windows mechanism, PR #581, `daemon.RunJob` in `app/backend/internal/daemon/jobs.go`) running `rk code-server install && rk code-server start` — the shell chain IS the B→C sequencing (daemon start is one-shot; no supervisor loop, Constitution VI). Guard against a duplicate job already running (mirror of `codeServerSessionExists`; note `RunJob` itself dedups on a live window with the same name). Then return — the daemon **never blocks** on the download (~100MB); run-kit is already resilient to a not-running code-server (the lens degrades to a not-running state), so a delayed first start is acceptable and visible in the dashboard because the job is a tmux window.
- **Job failure** stays visible in the persistent job window; `rk doctor` reports missing/failed; the next daemon start naturally retries by re-spawning the job.
- **B fires ONLY when the binary is missing** — never a "check latest" on every daemon start (no surprise upgrades, no spurious GitHub API calls). Acquisition downloads the LATEST release (resolved via the GitHub release API), which solves the staleness problem.

### New CLI surface

- `rk code-server install` — idempotent (already-current ⇒ skip). Downloads the latest standalone tarball for the host OS/arch to `~/.rk/code-server-bin/<version>/`, verifies the release digest, atomic `current` symlink flip. A plain subcommand so remote hosts and manual recovery use the same path; the daemon is just its scheduled caller.
- `rk code-server start` — today's `ensureCodeServer` logic exposed as a subcommand (idempotent: session-exists / port-in-use skips unchanged) so the job chain can trigger it.
- `rk code-server update` — explicit update: download latest, flip symlink, then kill-and-respawn the `rk-code-server` session so the new version takes effect (code-server hot exit preserves unsaved buffers; the cost is a brief lens reconnect).

### `rk update` integration (user-decided: yes)

`rk update` (`app/backend/cmd/rk/upgrade.go`) internally triggers `rk code-server update` as a post-upgrade side effect — this is exactly what the shll toolkit `update` standard blesses ("runs the tool's own post-upgrade side effects"; run-kit restarting its daemon is the standard's cited example). Four constraints agreed:

1. **Only touch what rk owns**: run only when `~/.rk/code-server-bin` exists (mirror of the standard's "self-update only when brew-installed" clause). A user-managed PATH install is never touched.
2. **Best-effort**: warn + exit 0 on download failure — deliberately NOT taking the standard's allowance for non-zero on failed post-upgrade steps. The rk upgrade itself succeeded, the daemon job retries acquisition later, and a false red row in `shll update`'s summary is worse than a warning.
3. **No tight timeout** on the ~100MB download — a generous bound, graceful termination, never a hard kill (same spirit as the standard's brew-handling clause). The versioned-dir + atomic symlink flip makes the swap corruption-proof regardless.
4. **Restart the code-server session as part of update** so it takes effect — daemon restart deliberately never touches sibling sessions (Constitution VI spirit; the session-survival design from 260811-a2bo), so the update path owns the respawn.

### Brew/doctor cleanup

- Drop `depends_on "code-server"` from `.github/formula-template.rb` (keep the comment trail honest — the comment at lines 7-10 explains code-server backs the `code` lens).
- `rk doctor`'s code-server row (`app/backend/cmd/rk/doctor.go`, `codeServerCheck`) stops saying "install code-server, e.g. brew install code-server" — instead it reports the managed version, or missing with the rk-managed install hint (e.g. `rk code-server install`).
- The daemon spawn's `--disable-update-check` comment "updates arrive via brew" (codeserver.go) becomes "updates arrive via rk".
- `ensureCodeServer`'s missing-binary warning message updates accordingly (no longer suggests brew).

## Affected Memory

- `run-kit/architecture`: (modify) daemon lifecycle — code-server acquisition ladder, the rk-jobs install job, the `rk code-server` CLI family, brew formula no longer depends on code-server
- `run-kit/toolkit-standards`: (modify) `rk update` gains the code-server post-upgrade side effect (update standard conformance); `rk code-server` is a new command surface (help-dump + Principle 9 check)

## Impact

- `app/backend/internal/daemon/codeserver.go` — `ensureCodeServer` two-rung ladder, `codeServerProfileDir` rename + one-shot migration, warning-message updates; likely a new install/download module (versioned dir, digest verify, symlink flip) either here or a sibling `internal/` package.
- `app/backend/internal/daemon/jobs.go` — consumed as-is via `daemon.RunJob` (no changes expected; the install job is a new caller).
- `app/backend/cmd/rk/` — new `code-server.go` command file (install/start/update subcommands); `doctor.go` `codeServerCheck` message/version reporting; `upgrade.go` post-upgrade leg.
- `.github/formula-template.rb` — drop `depends_on "code-server"`.
- `app/backend/internal/remote/` — precedent only (remote bootstrap via curl installer); remote hosts benefit since brew often doesn't exist there — the plain `rk code-server install` subcommand is the shared path, no remote-specific work.
- Constitution touchpoints: **I** (exec.CommandContext, argv slices — the download/extract code must follow; digest verification before use), **II** (the bin dir is an install artifact, not request-time state — but keep the derive-from-filesystem posture: resolve the binary at daemon start, no registry), **VI** (tmux layer independent of the server; the job window + sibling-session design preserves it).
- Tests: Go unit tests for the ladder resolution, migration rename, install idempotency/digest failure, and CLI wiring (the codeserver.go package-seam style — `codeServerLookPath`, `codeServerUserHomeDir` — extends naturally).

## Open Questions

- None blocking. (Promptless dispatch: no questions were asked; all decision points scored Certain/Confident from the design discussion — see Assumptions.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Install mechanism = official standalone tarball from GitHub releases, digest-verified via the release API's per-asset SHA-256; rejected install-script/npm/deb-rpm/docker/brew-post_install | Discussed — user chose tarball; rejections recorded with reasons | S:95 R:70 A:95 D:95 |
| 2 | Certain | Layout: `~/.rk/code-server-bin/<version>/` + `current` symlink; profile moves to `~/.rk/code-server-profile` with one-shot `os.Rename` migration at daemon start | Discussed — user decided explicit sibling names and the migration | S:95 R:60 A:95 D:95 |
| 3 | Certain | Acquisition: two-rung ladder (current symlink → PATH); missing binary spawns an rk-jobs window running `rk code-server install && rk code-server start`; daemon never blocks; B fires only when binary missing (no per-start latest check) | Discussed — A/B/C shape settled, incl. no-surprise-upgrades rule | S:95 R:70 A:90 D:90 |
| 4 | Certain | CLI surface: `rk code-server install` (idempotent, latest, digest, symlink flip), `start` (today's ensureCodeServer as subcommand), `update` (download + flip + kill-and-respawn session) | Discussed — three subcommands with stated semantics | S:95 R:75 A:90 D:95 |
| 5 | Certain | `rk update` triggers `rk code-server update` post-upgrade under four constraints: owned-dir gate, warn+exit-0 best-effort, generous download bound (graceful termination), session restart included | Discussed — user decided yes, with all four constraints enumerated | S:95 R:80 A:90 D:90 |
| 6 | Certain | Brew/doctor cleanup: drop `depends_on "code-server"`; doctor reports managed version or rk-managed install hint; "updates arrive via brew" comments and warnings become rk-managed wording | Discussed — enumerated in the design | S:95 R:85 A:95 D:95 |
| 7 | Confident | Digest missing or mismatched ⇒ install fails closed (no symlink flip, `current` untouched, clear error in the job window) | Constitution I security posture + atomic-flip design imply never activating an unverified binary | S:60 R:85 A:85 D:75 |
| 8 | Confident | Download/extract implemented in Go (net/http + archive/tar), not by shelling to curl/tar | Constitution I (argv-only subprocess posture) makes in-process stdlib the cleanest conforming path | S:55 R:80 A:90 D:80 |
| 9 | Confident | GitHub release API called unauthenticated (no token plumbing) | Acquisition fires only when the binary is missing or on explicit update — rate limits are irrelevant at that frequency | S:50 R:90 A:80 D:75 |
| 10 | Confident | No automatic GC of old `~/.rk/code-server-bin/<version>/` dirs in this change (manual cleanup; pruning can be added later) | Not discussed; low-stakes, trivially reversible, keeps the install path minimal | S:40 R:90 A:70 D:55 |
| 11 | Certain | `rk code-server install` takes no version-pin argument — latest only | Discussion consistently says "downloads the LATEST release"; a pin flag is an easy later addition | S:70 R:90 A:80 D:80 |
| 12 | Confident | `rk code-server start`/`install` as standalone CLI commands gate on the daemon running before touching the rk-daemon socket (mirror of RunJob's daemon gate) | Established pattern — any tmux command on a dead socket births a server (jobs.go decision 1, tmux-sessions memory) | S:55 R:85 A:85 D:70 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).

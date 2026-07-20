# Intake: Direnv Diff Reversal for User Server Environments

**Change**: 260706-6mpm-direnv-diff-reversal-server-env
**Created**: 2026-07-06

## Origin

> rk-started tmux servers inherit run-kit's direnv environment. `rk daemon start` run from a shell inside run-kit (direnv loaded) captures the full direnv-polluted environment into the rk-daemon tmux server; when the daemon is then the first client of a user tmux server, `cleanEnvForServer()` only strips `DIRENV_*` vars and resets PATH — it passes through everything direnv *exported* (`WORKTREE_INIT_SCRIPT`, `IDEAS_FILE`, `RK_PORT`, `RK_HOST`) plus rk's own `RK_DAEMON_LOG`. Fix: reverse-apply the `DIRENV_DIFF` env var at the `cleanEnvForServer` seam so user-facing servers get the env "as if the user had started tmux from `$HOME`", additionally strip rk-owned vars, fail-soft when `DIRENV_DIFF` is absent, and leave the daemon's own launch untouched.

Created via promptless dispatch (`/fab-proceed` → `_intake`, `{questioning-mode} = promptless-defer`) from a live design conversation. The conversation reached explicit decisions on the seam, mechanism, rk-var stripping, daemon-launch exclusion, and fail-soft behavior (all encoded in `## Assumptions` as Certain), and explicitly left one implementation choice open ("handle per SRAD" — row 7). The two-hop pollution chain was verified against live tmux servers (`tmux -L rk-daemon show-environment -g`, `tmux -L ext show-environment -g`) and against code during the conversation; all code references below were re-verified in this worktree at intake time.

## Why

**Problem — two-hop environment pollution chain (verified live and in code):**

1. **Hop 1 — daemon capture.** `rk daemon start`, when run from a shell inside the run-kit repo (direnv loaded), calls `daemon.startSession` (`app/backend/internal/daemon/daemon.go:293`, executing via `runTmux`, `daemon.go:91`) which runs `tmux -L rk-daemon new-session` with **no env sanitization**. The rk-daemon tmux server captures the full direnv-polluted environment. Verified live: `tmux -L rk-daemon show-environment -g` shows `DIRENV_DIFF`, `DIRENV_DIR`, `DIRENV_FILE`, `DIRENV_WATCHES`, `WORKTREE_INIT_SCRIPT=fab sync`, `IDEAS_FILE=fab/backlog.md`, `RK_PORT=3000`, `RK_HOST=0.0.0.0`, and a badly duplicated PATH. The `rk serve` pane (the daemon process) inherits all of it.
2. **Hop 2 — user-server birth.** When the daemon is the *first client* of a user tmux server — the create-server API (`app/backend/api/servers.go:102`) or session-create on a dead socket (`app/backend/api/sessions.go:50`), both via `tmux.CreateSession` (`app/backend/internal/tmux/tmux.go:780`) — `cleanEnvForServer()` (`tmux.go:819`) runs `sanitizeEnv` (`tmux.go:826`), which only strips `DIRENV_*` vars and resets PATH to a POSIX default (`cleanPATH`, `tmux.go:814`). It passes through everything direnv *exported*: `WORKTREE_INIT_SCRIPT`, `IDEAS_FILE`, `RK_PORT`, `RK_HOST` — plus rk's own `RK_DAEMON_LOG`. Verified live on the user's `ext` server: `tmux -L ext show-environment -g` shows a clean POSIX PATH and no `DIRENV_*` (the sanitizer ran) but all five leaked vars present; `RK_DAEMON_LOG` proves the daemon (not a user shell) started that server.

**Consequence if unfixed:** every pane on daemon-started servers gets a baseline `WORKTREE_INIT_SCRIPT=fab sync` (run-kit's worktree-init convention) that direnv never unsets in repos without their own `.envrc` — stale project config leaks into unrelated repos (observed in loom, prompt-pantry, planner). `RK_PORT`/`RK_HOST` leakage similarly primes unrelated shells with run-kit's server config.

**Why this approach:** the agreed target semantics is the env **"as if the user had started tmux from `$HOME`"**, which has an exact operational definition: *the invoking environment with direnv's diff undone* (a shell that cd's from run-kit to `~` is precisely a shell where direnv reverted its diff). Reverse-applying `DIRENV_DIFF` achieves this generically — it removes `WORKTREE_INIT_SCRIPT`, `IDEAS_FILE`, and the dotenv-loaded `RK_PORT`/`RK_HOST` without naming them, and *restores the user's true PATH* — strictly better than today's POSIX-minimal PATH reset, which is itself a deviation from tmux-from-home behavior. The user's real env (`SSH_AUTH_SOCK`, locale, everything else) is preserved untouched.

**Alternatives rejected (from the conversation):**

- **Whitelist a minimal login-like env** (`HOME`/`USER`/`SHELL`/`TERM`/`PATH`/…): rejected by the user as over-controlling — the user's genuine shell env must be preserved; only the project-local direnv diff removed.
- **Daemon-launch-only sanitization** (clean the env at `daemon.startSession` instead): insufficient — a foreground `rk serve` from a run-kit dev shell (`just dev`) still leaks through `CreateSession` — AND it breaks the daemon's own config: `config.Load()` (`app/backend/internal/config/config.go:29`) reads `RK_PORT`/`RK_HOST` from the process env (there is no `.env` file loading in Go — direnv's dotenv provides it), so cleaning the daemon's env would silently flip `RK_HOST` from `0.0.0.0` back to the `127.0.0.1` default and break Tailscale access.

## What Changes

### 1. `cleanEnvForServer` — direnv-diff reversal replaces the blacklist (`app/backend/internal/tmux/tmux.go`)

The single seam where rk births user-facing tmux servers is `tmux.CreateSession` → `cleanEnvForServer()` → `sanitizeEnv()`. Replace the current behavior (strip `DIRENV_*`, reset PATH to `cleanPATH`) with:

1. **Reverse-apply `DIRENV_DIFF`** (present in the daemon's env, inherited from the rk-daemon server capture). `DIRENV_DIFF` is direnv's internal env_diff format: base64url-encoded, zlib-deflate-compressed JSON `{"p":{...},"n":{...}}` where `p` is the prior value of each changed/removed var and `n` is the new/added value. Reversal semantics: for each key in `n`, remove it (or restore its `p` value if present in `p`); for each key in `p` absent from `n`, restore the `p` value. The result is the invoking env with direnv's changes undone — including the true pre-direnv PATH.
2. **Strip rk-owned vars** — all `RK_*`-prefixed vars (`RK_DAEMON_LOG` at minimum; the user approved stripping all `RK_*` at this seam). rk added those itself post-direnv, so diff reversal won't catch them.
3. **Keep stripping `DIRENV_*` vars themselves** — direnv excludes its own `DIRENV_*` state vars from the diff, so reversal alone leaves them behind; a from-home shell has none.
4. **Retire the POSIX `cleanPATH` reset on the reversal path** — the reversed env carries the user's true PATH. (Whether `cleanPATH` survives as a last-resort PATH-missing guard is a plan-level detail.)

Current code being replaced (`tmux.go:826`):

```go
// sanitizeEnv filters an environment slice: replaces PATH with a clean POSIX
// default (deduplicating if present multiple times), strips DIRENV_* vars,
// and ensures PATH is always present.
func sanitizeEnv(environ []string) []string { ... }
```

Implementation mechanism (SRAD-decided, row 7): **parse `DIRENV_DIFF` in Go** — base64url decode + zlib inflate + JSON unmarshal of `{"p":{...},"n":{...}}` using only the stdlib (`encoding/base64`, `compress/zlib`, `encoding/json`). Self-contained: no runtime direnv dependency, no subprocess, deterministic fixture-based tests. The rejected variant — shelling out to `direnv export json` with cwd outside the `.envrc` scope — avoids format coupling but adds a runtime subprocess and works only when direnv is installed. The direnv env_diff format is internal-but-stable (unchanged for years), and the fail-soft rule below bounds the blast radius of a hypothetical future format change to "behaves like today's pass-through", never a crash.

### 2. Fail-soft behavior

- **`DIRENV_DIFF` absent** from the environment: there is nothing to reverse — pass the env through unchanged **except** the rk-owned-var strip (and the `DIRENV_*` strip, vacuously). No hard dependency on direnv being installed; a daemon started from a non-direnv shell already has the from-home env, so pass-through is correct there.
- **`DIRENV_DIFF` present but unparseable** (bad base64/zlib/JSON): treat as absent — fail-soft to pass-through + strips, with a `slog` warning for diagnosability. Never fail `CreateSession` over sanitization.

### 3. Explicitly out of scope

- **Daemon launch (`daemon.startSession`) stays untouched** — the daemon legitimately depends on its inherited env for config (`config.Load()` reads `RK_PORT`/`RK_HOST` from process env; direnv's dotenv is the only thing that provides it). Optional future hygiene (clean daemon launch + `-e` re-injection of `RK_PORT`/`RK_HOST` the way `RK_DAEMON_LOG` is injected today, `daemon.go:298-300`) is explicitly OUT OF SCOPE.
- **Already-running polluted servers** keep their baked env — cleanup is operational (`tmux -L <sock> set-environment -gru VAR` per var, or a server restart), not code scope; at most a docs/memory note.
- **No UI change, no API change.** Backend-only: `app/backend/internal/tmux/` (possibly a small colocated helper file, e.g. `internal/tmux/direnv.go`).

### 4. Tests

- Unit tests for the diff-reversal helper using **fixture `DIRENV_DIFF` values** (real base64url+zlib+JSON blobs encoding known `{"p","n"}` maps): added-var removal, changed-var restoration (incl. PATH), removed-var restoration, absent/malformed-diff fail-soft.
- Update the existing `TestSanitizeEnv` (`app/backend/internal/tmux/tmux_test.go:644`) to the new semantics: `RK_*` stripped, `DIRENV_*` stripped, pass-through (not POSIX reset) when no diff, reversal when diff present.

## Affected Memory

- `run-kit/architecture`: (modify) `internal/tmux` package row — replace the "sanitized environment: PATH reset to POSIX default + DIRENV_* stripped" description of `CreateSession` with the direnv-diff-reversal semantics (reverse-apply `DIRENV_DIFF`, strip `RK_*` + `DIRENV_*`, fail-soft pass-through); note the operational-cleanup caveat for already-polluted servers.

## Impact

- **Code**: `app/backend/internal/tmux/tmux.go` (`cleanEnvForServer`, `sanitizeEnv`, `cleanPATH`), possibly a new small helper file in the same package; `app/backend/internal/tmux/tmux_test.go` (rewrite `TestSanitizeEnv`, add reversal fixtures). No other packages change — `daemon.go`, `servers.go`, `sessions.go`, `config.go` are context, not targets.
- **Behavioral**: user tmux servers born by rk (create-server API, session-create on dead socket) get the operator's true from-home env — real PATH instead of POSIX-minimal, no `WORKTREE_INIT_SCRIPT`/`IDEAS_FILE`/`RK_PORT`/`RK_HOST`/`RK_DAEMON_LOG` leakage. Servers started by the user's own shell (rk not first client) are unaffected, as always.
- **Constraints honored**: all subprocess calls remain `exec.CommandContext` with timeouts (the chosen mechanism adds **no** subprocess); no shell strings; new behavior ships with Go tests (code-quality mandate); no database; state derived at request time.
- **Risk**: coupling to direnv's internal env_diff encoding (stable for years, not a public contract) — bounded by fail-soft (a format change degrades to today's pass-through-with-strips, never a crash or a blocked server create).

## Open Questions

- None. The one genuinely open point from the conversation — parse `DIRENV_DIFF` in Go vs. shell out to `direnv export json` — was resolved via SRAD as a Confident assumption (row 7 below); no decision landed Unresolved, so nothing was deferred.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix seam is `cleanEnvForServer`/`sanitizeEnv` in `app/backend/internal/tmux/tmux.go` — the single place rk births user-facing tmux servers (`CreateSession`) | Discussed — user chose this seam; verified in code: both API birth paths (`servers.go:102`, `sessions.go:50`) funnel through `CreateSession` → `cleanEnvForServer` | S:95 R:85 A:95 D:95 |
| 2 | Certain | Target semantics: env "as if the user had started tmux from `$HOME`" = invoking env with direnv's diff undone | Discussed — user stated the exact operational definition (cd-ing from run-kit to `~` is precisely direnv reverting its diff) | S:95 R:80 A:90 D:90 |
| 3 | Certain | Mechanism: reverse-apply `DIRENV_DIFF` replacing the current blacklist + POSIX-PATH reset; restores the user's true PATH | Discussed — user chose diff reversal over the blacklist; explicitly called the POSIX PATH reset a deviation to fix, not preserve | S:90 R:75 A:85 D:90 |
| 4 | Certain | Daemon launch (`daemon.startSession`) stays untouched; daemon-side hygiene (`-e` re-injection of `RK_PORT`/`RK_HOST`) is out of scope | Discussed — user decision with verified rationale: `config.Load()` (`config.go:29`) reads `RK_PORT`/`RK_HOST` from process env; cleaning would flip `RK_HOST` to `127.0.0.1` and break Tailscale access | S:95 R:85 A:90 D:95 |
| 5 | Certain | Fail-soft: `DIRENV_DIFF` absent → pass env through (keeping the rk-owned-var strip); graceful degradation, no hard direnv dependency | Discussed — user-stated constraint, verbatim | S:90 R:85 A:90 D:90 |
| 6 | Certain | New behavior ships with Go unit tests (fixture `DIRENV_DIFF` values; existing `TestSanitizeEnv` at `tmux_test.go:644` updated); scope is backend-only, no UI/API change | Discussed — user constraint; also mandated by `code-quality.md` ("New features and bug fixes MUST include tests") | S:90 R:90 A:95 D:95 |
| 7 | Confident | Implementation mechanism: parse `DIRENV_DIFF` in Go (stdlib base64url + zlib + JSON) rather than shelling out to `direnv export json` | SRAD-decided — user left this open ("handle per SRAD"). Parsing wins on the stated constraints: fail-soft with no runtime direnv dependency, zero subprocess (Security-First posture), deterministic fixture tests (the test constraint names fixture `DIRENV_DIFF` values); format-coupling risk is bounded by fail-soft. Reversible in one helper + tests if the format ever breaks | S:50 R:80 A:65 D:60 |
| 8 | Confident | Strip **all** `RK_*`-prefixed vars at this seam (not just `RK_DAEMON_LOG`) | Discussed — user said `RK_DAEMON_LOG` at minimum, all `RK_*` acceptable; the prefix strip is simpler and future-proof. Known edge: an `RK_*` var exported from the user's own shell profile would also be stripped — a minor, user-accepted deviation from strict from-home semantics, confined to rk's own namespace | S:75 R:85 A:80 D:70 |
| 9 | Confident | Malformed/unparseable `DIRENV_DIFF` treated as absent — fail-soft to pass-through + strips, with a `slog` warning; never fail `CreateSession` over sanitization | Inferred from the user's fail-soft constraint (row 5) extended to the parse-error case; matches codebase best-effort conventions (e.g. `resolveDaemonLogPath`'s warn-and-proceed) | S:55 R:85 A:80 D:75 |
| 10 | Confident | Keep stripping `DIRENV_*` vars themselves in addition to diff reversal | direnv excludes its own `DIRENV_*` state vars from the diff, so reversal alone leaves them; a from-home shell has none — required by row 2's target semantics | S:60 R:85 A:75 D:80 |
| 11 | Confident | Reversal helper lives in `app/backend/internal/tmux/` (e.g. a colocated `direnv.go`), not a new package | User allowed "possibly a small helper package"; colocated file is the smallest footprint, matches the package's existing single-file-plus-tests shape, trivially movable later | S:55 R:90 A:75 D:70 |
| 12 | Certain | Already-running polluted servers are operational cleanup (`tmux set-environment -gru` or restart), not code scope; at most a docs/memory note | Discussed — user-stated scope boundary, verbatim | S:90 R:90 A:90 D:90 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).

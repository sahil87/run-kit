# Intake: Test-Run Phase Progress Banners

**Change**: 260904-6o28-test-progress-banners
**Created**: 2026-09-04

## Origin

Promptless dispatch (`/fab-proceed` create-new path) from a user conversation about `just test` legibility. Synthesized description:

> `just test` (backend + frontend + e2e) blocks for 20+ minutes with no phase-level progress indication. The recipe is a bare just dependency chain (`test: test-backend test-frontend test-e2e` in `justfile`), so terminal scrollback never says which phase is running, when it started, or how long it has been running. Replace the dependency chain with a new `scripts/test-all.sh` that runs the three phases in sequence and prints timestamped, append-only phase banners plus a final per-phase summary, and tee the run into a per-run log file.

Key decisions were made in the conversation (recorded in What Changes and the Assumptions table): script-over-chain with a one-liner justfile recipe, invoke existing recipes rather than duplicate bodies, preserve fail-fast semantics, leave sub-suite reporters alone, append-only output only (no spinners/`\r`/cursor control), and optionally tee to a per-run log file.

## Why

1. **The pain point**: `just test` runs three phases (Go tests, Vitest, Playwright e2e) for 20+ minutes with zero phase-level indication. The recipe is a bare dependency chain, so nothing in scrollback says which phase is running, when it started, or how long it has been going. `go test ./...`'s initial compile is a multi-minute silent stretch with nothing printed in front of it. The e2e phase is ~15 of the 20 minutes (509 tests across 85 spec files).
2. **The consequence if unfixed**: a human watching the terminal — or an agent peeking at a background run via `tmux capture-pane` — cannot tell where in the run they are, whether it is stuck, or how much is left. A peek landing mid-run shows raw sub-suite output with no phase framing.
3. **Why this approach**: the sub-suites already emit good per-unit line output (`go test` prints one `ok <pkg> <time>` line per package; `vitest run` prints per-file results; Playwright's list reporter prints a numbered line per test plus a "Running N tests using 1 worker" header; `scripts/test-e2e.sh` already echoes its setup milestones). What is missing is only the phase seam: which of the three phases is active, since when, and how each ended. A thin orchestration script that banners the seams and delegates everything else is the smallest change that fixes the gap — no new dependencies, no reporter reconfiguration.

Context note: per a standing user directive (2026-09-03), the full `just test` suite is on-demand/CI only, never an agent change gate — this change serves humans and on-demand runs; it is polish for legibility, not an agent-throughput fix.

## What Changes

### 1. New `scripts/test-all.sh` — the phase orchestrator

A new bash script (following the existing `scripts/` conventions: `#!/usr/bin/env bash`, `set -euo pipefail`, `REPO_ROOT` derivation as in `scripts/build.sh`) that runs the three test phases **in sequence** and frames each with timestamped, append-only banners:

```
Log: /tmp/rk-test-20260904-140211.log
[1/3] backend — started 14:02:11
...  (go test output passes through untouched)
[1/3] backend — ok in 1m42s
[2/3] frontend — started 14:03:53
...
[2/3] frontend — ok in 0m58s
[3/3] e2e — started 14:04:51
...
[3/3] e2e — ok in 14m37s

Summary:
  [1/3] backend   ok      1m42s
  [2/3] frontend  ok      0m58s
  [3/3] e2e       ok      14m37s
```

(Exact wording/alignment of the banner and summary lines is the implementer's choice within this shape — `[N/3] <phase>`, a wall-clock start time, a per-phase duration, and a final per-phase summary of phase, status, duration.)

- **Phases invoke the existing recipes** — `just test-backend`, `just test-frontend`, `just test-e2e` — never duplicate their bodies, so each phase's own dependencies (e.g. `_ensure-tmux-conf` before `test-backend`) are preserved and future recipe edits are inherited automatically.
- **Fail-fast, preserved failure semantics**: a failing phase stops the run (matching today's just dependency-chain behavior), the script exits non-zero, and the summary still prints, marking the failed phase (e.g. `[2/3] frontend — FAILED in 0m41s (exit 1)` and a `failed` row in the summary; phases after the failed one are not run and appear as skipped/not-run in the summary).
- **Append-only output only**: NO spinners, NO `\r`-rewriting progress bars, NO ANSI cursor control. Rationale (agent-friendliness): rewriting output garbles captured logs, and `tmux capture-pane` peeks show only the final frame — append-only timestamped lines are what makes a background-run peek informative.
- **Per-run log file**: the script tees the full run (banners + sub-suite output) into a per-run log file, e.g. `/tmp/rk-test-<timestamp>.log`, and echoes the path as the first line of the run, so a `tail -f` or an agent peek can land mid-run. The tee must not mask phase exit codes (e.g. tee via a single `exec > >(tee ...)` redirection of the whole script, or `pipefail`-guarded pipes — implementer's choice).

### 2. `justfile` — `test` recipe becomes a one-liner delegate

```just
# Run all tests (backend + frontend + e2e) with phase banners
test:
    scripts/test-all.sh
```

- Constitution VIII (Thin Justfile): the recipe MUST remain a one-liner delegating to `scripts/` — all logic lives in `scripts/test-all.sh`.
- The recipe **name stays `test`** — the `verify` recipe (`verify: check test build`) consumes it by name.
- The recipe takes no arguments today and continues to take none.

### 3. Explicitly NOT changed

- **No sub-suite reporter changes**: no `reporter` added to `app/frontend/playwright.config.ts`, no Vitest reporter flags, no gotestsum or other new dependency for the Go phase. The existing per-unit line output (verified: `go test` per-package `ok` lines, vitest per-file lines, Playwright list reporter's numbered N-of-M lines, `test-e2e.sh`'s setup-milestone echoes) is kept as-is; both vitest and Playwright already auto-degrade to non-interactive line output when non-TTY.
- **No product code paths**: this is developer-tooling/harness work — no API/UI changes, no Go/TS source changes. Note `scripts/` IS in `source_paths` in `fab/project/config.yaml`.
- **CI unaffected**: `.github/workflows/ci.yml` invokes `just test-backend` / `just test-frontend` / `just test-e2e` directly, never the aggregate `test` recipe — the new script changes only local `just test` / `just verify` runs.

### Rejected alternatives (from the conversation)

- **Spinners / live progress bars** — agent-hostile: rewriting output garbles captures and capture-pane peeks show only the final frame.
- **Custom Playwright reporter or reporter config changes** — the default list reporter already numbers tests and prints the total ("Running N tests using 1 worker").
- **gotestsum or other new dependencies for the Go phase** — per-package `ok` lines plus a phase banner in front of the silent compile stretch is enough.

## Affected Memory

- `run-kit/architecture`: (modify) § Testing — note that the aggregate `just test` entry point delegates to `scripts/test-all.sh` (sequential phases with timestamped append-only banners, fail-fast, per-run log file); sub-recipes and CI invocation are unchanged.

## Impact

- **Files**: `justfile` (the `test` recipe body — one line), `scripts/test-all.sh` (new, roughly 60–100 lines of bash). No other files.
- **Consumers of `just test`**: local human runs and on-demand agent runs; `just verify` (`check test build`) inherits the banners. CI does not call `test`.
- **No new dependencies**: bash + coreutils (`date`, `tee`) only — all already required by existing `scripts/`.
- **Testing**: no shell-test framework exists in this repo (existing `scripts/` have no automated tests); verification is a smoke run — exercise the script's phase/banner/failure paths without paying the full 20-minute suite (e.g. run with a phase forced to fail fast, or a short scoped run), consistent with the standing directive that the full suite is on-demand only.

## Open Questions

- None — the conversation resolved the design; remaining choices (exact banner wording, tee mechanics, log filename format) are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace the `test` dependency chain with new `scripts/test-all.sh`; justfile recipe stays a one-liner delegate named `test` | Discussed — decision 1; Constitution VIII mandates the thin-justfile shape; `verify` consumes the name | S:90 R:85 A:95 D:95 |
| 2 | Certain | The script invokes the existing recipes (`just test-backend/test-frontend/test-e2e`), never duplicates their bodies | Discussed — decision 2; preserves per-recipe deps like `_ensure-tmux-conf` | S:90 R:80 A:90 D:90 |
| 3 | Certain | Fail-fast preserved: failing phase stops the run, non-zero exit, summary marks the failed phase and unrun phases | Discussed — decision 3; matches today's dependency-chain behavior | S:90 R:85 A:90 D:90 |
| 4 | Certain | No sub-suite reporter changes and no new dependencies (no gotestsum, no custom Playwright reporter, no reporter config) | Discussed — decision 4 with rejected alternatives recorded | S:90 R:90 A:90 D:95 |
| 5 | Certain | Output is append-only lines only — no spinners, no `\r` rewriting, no ANSI cursor control | Discussed — decision 5 with explicit agent-friendliness rationale | S:95 R:85 A:90 D:95 |
| 6 | Confident | Include the per-run log tee, path echoed at run start | User gave a general go-ahead to a recommendation that listed this as an optional third item — strong but not explicit | S:70 R:80 A:75 D:75 |
| 7 | Confident | Log path `/tmp/rk-test-<timestamp>.log` (timestamped, unique per run) | User's own example ("e.g. /tmp/rk-test-<timestamp>.log or similar"); alternatives ($XDG_STATE_HOME/run-kit/, mktemp dir) exist but /tmp matches the transient nature and the example | S:55 R:90 A:60 D:55 |
| 8 | Confident | Banner shape `[N/3] <phase> — started HH:MM:SS` / `[N/3] <phase> — ok in XmYYs` / `FAILED in XmYYs (exit N)` + final per-phase summary block; exact wording implementer's choice within that shape | Discussed — examples given in the conversation ("e.g. [1/3] backend — started 14:02:11"); precise wording not pinned | S:75 R:90 A:80 D:65 |
| 9 | Certain | `just test` interface unchanged: recipe name `test`, no arguments, `verify: check test build` untouched | Constraint stated in the conversation; `justfile` verified | S:85 R:80 A:95 D:95 |
| 10 | Confident | Verification is a smoke run of the script's banner/failure paths, not the full 20-minute suite and no new shell-test framework | Existing `scripts/` have no automated tests; standing directive (2026-09-03) keeps the full suite on-demand only | S:60 R:85 A:80 D:70 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

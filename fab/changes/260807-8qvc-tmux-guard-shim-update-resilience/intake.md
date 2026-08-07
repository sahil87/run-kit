# Intake: tmux Guard Shim Update Resilience

**Change**: 260807-8qvc-tmux-guard-shim-update-resilience
**Created**: 2026-08-07

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a synthesized change description carrying decisions made in a driving conversation:

> During run-kit updates (`brew upgrade run-kit` / the shll update flow), Homebrew unlinks the old keg and relinks the new one non-atomically, so the stable symlink `/home/linuxbrew/.linuxbrew/bin/run-kit` dangles for a few seconds. The tmux guard shim at `~/.local/share/rk/shims/tmux` is `exec "<abs-rk>" tmux-guard "$@"` against exactly that embedded path — so during the window, EVERY PATH-resolved `tmux` invocation on the machine fails with exit 127. Make the shim self-healing: retry the embedded rk path briefly (~3s), then fail open to the real tmux via a POSIX PATH walk that skips the rk shim, optionally with a minimal bare-`kill-server` backstop.

The conversation settled the approach (retry → fail-open → optional minimal backstop) and rejected the alternatives (rk-owned binary copy with atomic rename; making brew's relink atomic). Those decisions are treated as settled and encoded in the Assumptions table.

## Why

**The pain point.** The tmux guard shim (`tmuxShimScript`, `app/backend/cmd/rk/tmux_guard.go:104`) fronts every PATH-resolved `tmux` invocation on the machine and execs a hard-coded absolute rk path — the stable Homebrew symlink resolved at install time by `resolveRkPath`. Homebrew's upgrade flow is non-atomic: it unlinks the old keg's symlinks, then relinks the new keg's. For the few seconds in between, `/home/linuxbrew/.linuxbrew/bin/run-kit` dangles, and the shim's `exec` fails with exit 127. Because the shim is machine-global, **every** `tmux` command on the host fails during that window — not just rk's own.

**The consequence, observed live.** During a routine run-kit update, a fab operator's `fab pane map` / `tmux list-panes` calls 127ed and its tick loop stopped mid-update. Any agent, script, cron job, or human shell running `tmux` during an update hits the same wall. Updates are routine, so this is a *certain* recurring machine-wide breakage window, converted from a theoretical edge into a lived incident.

**Why the existing detection is not enough.** `rk doctor`'s `tmux-guard shim` check (`doctor.go:117` via `tmuxShimExecTarget`) detects the *permanent* dangling-path shape (e.g. the recorded brew `rk`→`run-kit` rename zombie keg). It is a diagnosis surface, not runtime resilience — nothing helps a tmux invocation that fires *inside* the transient relink window.

**Why this approach.** The guard exists to stop *accidental agent* `kill-server` invocations. The probability of one firing inside a few-second update window is negligible; machine-wide tmux breakage during every update is a certainty. Availability wins: a shim that briefly retries (covering the relink) and then fails open to the real tmux converts a hard 127 into, at worst, a short stall — while keeping the guard fully intact in the steady state. The rejected alternatives either add real cost (an rk-owned binary copy at `~/.local/share/rk/bin/` with atomic rename: ~20MB duplicate binary, version skew, a refresh seam that must fire after every brew upgrade) or are out of rk's control (making brew's relink atomic).

## What Changes

### 1. Shim template: retry loop before giving up on the embedded rk path

`tmuxShimScript` (app/backend/cmd/rk/tmux_guard.go:104) is rewritten from the single-line `exec "<abs-rk>" tmux-guard "$@"` into a self-healing script. First stage: when the embedded rk path is not executable (`[ -x ... ]` fails), poll it for **~3 seconds total in 0.2s sleeps** (~15 iterations) before giving up. When the path (re)becomes executable — the normal outcome, since brew's relink completes in a few seconds — exec rk tmux-guard with the original argv exactly as today. This converts the hard 127 into a short stall for invocations that land inside the relink window.

Fractional `sleep 0.2` is supported by GNU coreutils, BSD, and macOS sleep (not POSIX-pure — degrade to coarser integer sleeps only if a target platform genuinely lacks it).

### 2. Fail-open after the retry budget

If the rk path is still not executable after the budget, the shim resolves the **real tmux itself** via a POSIX-sh PATH walk and execs it directly with the original argv. The walk mirrors the exclusions of `findRealTmux` (tmux_guard.go:271):

- skip PATH entries equal to the rk shims dir (`$HOME/.local/share/rk/shims`);
- skip any candidate whose head identifies it as the rk shim (the `managed-by: rk agent-setup (tmux guard shim)` marker or a `tmux-guard` invocation — mirroring `sniffsAsTmuxShim`), so a relocated shim copy never exec-loops;
- skip empty PATH entries (POSIX cwd semantics);
- first surviving executable regular file named `tmux` wins.

If no real tmux is found either, exit non-zero with a clear message (nothing to exec — same terminal state as today's `findRealTmux` error, now in shell). On the fail-open path a single one-line stderr notice names the dangling rk path and that the guard is bypassed for this invocation — observable but not noisy.

Rationale (settled in conversation): the guard targets accidental agent `kill-server`; a few seconds of unguarded tmux during an update is acceptable, machine-wide breakage is not.

### 3. Optional minimal fallback guard on the fail-open path

Before exec'ing the real tmux on the fail-open path, a crude conservative shell check refuses **only the literal bare `kill-server`-with-no-`-L`/`-S` shape** (a simple scan: any argv token equal to `kill-server` while no `-L*`/`-S*` token appears). Deliberately minimal — do **NOT** reimplement tmux's argv grammar (global-flag windows, `;`-chains, prefix matching) in shell. Over-blocking for a few seconds on the fallback path is acceptable; so is under-blocking — it is a best-effort backstop, not the guard.

### 4. Shim contract invariants preserved

The new script MUST remain:

- **`#!/bin/sh` POSIX** (modulo the fractional-sleep note above) — no bashisms;
- **marker-owned** — the `# managed-by: rk agent-setup (tmux guard shim)` line (`tmuxShimMarker`) is preserved verbatim so agent-setup's ownership detection, `sniffsAsTmuxShim`, and doctor's marker check keep working;
- **compatible with `tmuxShimExecTarget`** (tmux_guard.go:116) — doctor parses the **first** `exec "..."`-shaped line to extract the embedded rk path. Either the new script keeps the literal absolute rk path inside the first exec-shaped line (front-runner — e.g. `exec "<abs-rk>" tmux-guard "$@"` stays the first `exec "` line, with the retry probe referencing the same literal), or `tmuxShimExecTarget` and its dependent doctor states are updated in the same change. Note the ordering hazard: the fail-open path introduces additional `exec "..."` lines (e.g. `exec "$real" "$@"`), so the parser's first-match semantics constrain script line order — whichever resolution apply picks must be pinned by a test.
- **Constitution §I** — the only interpolated value stays the `validateHookPath`-gated rk path (rejects `' " $ ` \`); any new embedded value falls under the same discipline (the shims-dir path is composed from the `$HOME` shell variable, not Go-interpolated).
- **Constitution §II** — no new persistent state; the shim remains a single derived-content file.

### 5. Rollout and installer contract — unchanged

Rollout is via re-running `rk agent-setup`: the installer's idempotent replace-in-place already registers the new template as a content diff against the installed shim and applies it under the existing diff+consent flow. The install/uninstall contract in agent_setup.go (diff + consent, marker ownership keyed on existence, PATH block, `--dry-run`/`--yes`, per-file resilience) is **not** modified.

### 6. Tests

`tmux_guard_test.go` pins the shim script shape (`tmuxShimScript` content, `tmuxShimExecTarget` parse round-trip, `findRealTmux`/sniff behavior against `writeStub` shims) and the doctor states — update those pins and add coverage for:

- the new script still carries the marker and parses to the embedded rk path via `tmuxShimExecTarget` (or the updated parser, if that branch is taken);
- retry/fail-open/backstop shapes at the script-content level (and, where cheap, by executing the shim against stub `rk`/`tmux` executables in `t.TempDir()` PATHs — the established pattern);
- doctor behavior against the new shim content.

Established rule for this file (memory § Design Decisions): **tests must never start, attach to, or kill a live tmux server** — stub executables and injected seams only.

## Affected Memory

- `run-kit/tmux-guard-shim`: (modify) failure-mode and design-decision sections change materially — the shim is no longer a one-line exec (retry + fail-open + minimal backstop), the "dangling embedded rk path breaks every tmux command" claim gains a transient-vs-permanent split, and the availability-over-guard-during-updates decision (with the rejected atomic-copy alternative) is a new Design Decisions entry.

## Impact

- **Primary**: `app/backend/cmd/rk/tmux_guard.go` — `tmuxShimScript` rewrite; possibly `tmuxShimExecTarget` if the parser branch is taken.
- **Secondary**: `app/backend/cmd/rk/doctor.go` — only if `tmuxShimExecTarget` semantics change (doctor states at doctor.go:117–133).
- **Tests**: `app/backend/cmd/rk/tmux_guard_test.go` (shim-shape pins, parser, resolution, doctor states); possibly `agent_setup_test.go` fixtures that embed the shim content.
- **Not touched**: agent_setup.go install/uninstall machinery; the `rk tmux-guard` Go decision logic (block rule, argv grammar, exec env) is unchanged — this change is entirely about the shell shim's behavior when rk itself is unreachable.
- **Rollout**: users re-run `rk agent-setup` (idempotent content-diff replace); no migration, no new files.

## Open Questions

- None — the driving conversation settled the approach; remaining latitude is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Retry budget: ~3s total in 0.2s sleeps (~15 probes of the embedded rk path's executability) before giving up | Discussed — values stated in the driving conversation ("~3 seconds total (e.g. 0.2s sleeps)"); covers the observed brew relink window | S:90 R:90 A:90 D:90 |
| 2 | Certain | Fail-open after the retry budget: POSIX PATH walk mirroring `findRealTmux` exclusions (skip shims dir, skip shim-headed candidates, skip empty entries), then exec the real tmux with the original argv | Discussed — explicitly settled with rationale (availability wins over guard coverage during a few-second window); rejected alternative (atomic rk-owned binary copy) recorded | S:95 R:80 A:90 D:90 |
| 3 | Confident | Include the optional minimal fallback guard: refuse only the literal bare `kill-server`-with-no-`-L`/`-S` argv shape on the fail-open path; no shell reimplementation of tmux's argv grammar | Description marks it optional with a clear lean ("may... keep it minimal"); cheap, contained, easily removed; over/under-blocking on the fallback path accepted by design | S:75 R:90 A:80 D:60 |
| 4 | Confident | Keep `tmuxShimExecTarget` compatibility by keeping the literal absolute rk path in the script's first `exec "..."`-shaped line (parser + doctor unchanged); update the parser and doctor states in the same change only if the script shape demands it | Description explicitly allows either branch; keep-parseable is the smaller diff and preserves doctor's pinned states — apply may flip with a pinned test if the script reads better the other way | S:70 R:85 A:80 D:65 |
| 5 | Certain | Rollout via idempotent `rk agent-setup` replace-in-place (content diff + consent); install/uninstall contract in agent_setup.go unchanged | Discussed — stated as settled scope in the change description | S:90 R:85 A:95 D:95 |
| 6 | Confident | Fail-open emits one one-line stderr notice (dangling rk path, guard bypassed for this invocation); the retry stall itself is silent | Not explicitly discussed; matches the project's "errors are actionable detail" posture (guard/doctor messaging) while keeping the happy path quiet; trivially reversible | S:55 R:90 A:70 D:55 |
| 7 | Certain | Shim stays `#!/bin/sh` with the `tmuxShimMarker` line verbatim; only the `validateHookPath`-gated rk path is Go-interpolated (Constitution §I); no new persistent state (§II) | Constitution + existing marker-ownership contract determine this; the description restates it as a hard constraint | S:95 R:90 A:95 D:95 |
| 8 | Certain | Tests update the `tmux_guard_test.go` shim-shape/doctor pins and add retry/fail-open coverage via stub executables in `t.TempDir()` PATHs; never touch a live tmux server | Established, documented rule for this file (memory § "Tests never touch a live tmux server") + code-quality.md test requirements | S:85 R:90 A:95 D:90 |
| 9 | Confident | Fractional `sleep 0.2` is acceptable in the `#!/bin/sh` script (GNU/BSD/macOS all support it despite POSIX specifying integer seconds); degrade to coarser integer sleeps only if a target platform lacks it | Target platforms (Linux + macOS, brew-installed) all ship fraction-capable sleep; the POSIX purity gap is theoretical for this install base | S:60 R:95 A:75 D:60 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).

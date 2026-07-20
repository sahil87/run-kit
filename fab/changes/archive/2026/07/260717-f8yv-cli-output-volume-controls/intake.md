# Intake: CLI Output-Volume Controls (Toolkit Principle 9)

**Change**: 260717-f8yv-cli-output-volume-controls
**Created**: 2026-07-18

## Origin

Backlog item `[f8yv]` in `fab/backlog.md`, invoked one-shot via `/fab-new f8yv` (no prior conversation context). The item was deferred from the toolkit-standards-conformance audit (`260717-c424-toolkit-standards-conformance`, shll v0.0.23) as restructural — a global output-model change, not a single additive flag.

> Toolkit CLI Principle 9 (bounded, high-signal output) — add output-volume controls to run-kit's CLI. DEFERRED from the standards-conformance audit (change c424, shll v0.0.23) as restructural (a global output-model change, not a single additive flag). TWO gaps: (1) NO command offers `--quiet` — the principle wants a `--quiet` that suppresses progress/decoration/chatter while preserving data + errors; candidates are `run-kit update` (per-tool sections + summary tail), `run-kit doctor`, `run-kit agent-setup` (diff + status lines). (2) `run-kit reaper`'s match list is UNCAPPED — a bare `run-kit reaper` on a busy box prints every matching socket (measured ~4485 lines in the audit environment), which taxes any agent context that invokes it; the principle wants an explicit cap with a stated-in-output truncation notice ("… and N more; pass --all to list"), mirroring `shll changelog`'s 10-release cap. FIX: thread a `--quiet` bool through the shared output helpers (decide the stdout-vs-stderr + quiet-gating convention once, e.g. a small output sink type, rather than per-command ad-hoc); add a default list cap + `--all` escape hatch + truncation notice to reaper's dry-run/act paths (app/backend/cmd/rk/reaper.go). VERIFY: `--quiet` leaves data + errors intact and removes only progress/decoration; reaper caps by default and states the cap in output; `--all` restores the full list. STANDARD: https://shll.ai/shll/standards/principles (Principle 9).

The full Principle 9 text (fetched via `shll standards principles` at intake time):

> **Obligation (MUST).** Output volume has mechanisms of control: unbounded surfaces carry explicit caps, and what survives `--quiet` is the data and the errors — never progress, decoration, or chatter. Agent context windows are finite; a tool that dumps ten thousand unfiltered lines taxes every conversation that invokes it.
>
> **Enforced by.** `shll changelog` caps at 10 releases per tool with an explicit notice when truncated; `shll update` prints per-tool sections with a summary tail rather than raw brew output. Where a surface is capped, the cap is stated in the output — silent truncation reads as completeness.

## Why

1. **The pain point**: run-kit's constitution (§ Toolkit Standards, v1.6.0) binds it to the sahil87 toolkit's published standards, and Principle 9 is a MUST the c424 audit found unmet on two counts. No command offers `--quiet`, and `run-kit reaper`'s match list is unbounded — measured at ~4485 lines on the audit box. Every agent that invokes these commands pays the context tax.
2. **If we don't fix it**: run-kit stays non-conformant with a MUST-level toolkit standard, and one verbose `reaper` invocation can evict the context an agent needed to act on the result (Principle 9's named failure mode).
3. **Why this approach**: the c424 audit deliberately deferred this as restructural — the right fix is deciding the output convention *once* (a small shared sink + one flag) rather than sprinkling per-command ad-hoc gating, plus a display cap on the one unbounded list surface. This mirrors the toolkit's own enforcement precedents (`shll update`'s summary-tail shape, `shll changelog`'s capped list with a stated truncation notice).

## What Changes

All changes are in the CLI layer (`app/backend/cmd/rk/`). No API, daemon, or frontend impact.

### 1. Shared output convention: one `--quiet` flag + a small output sink

**Flag**: a single persistent `--quiet` bool registered on `rootCmd` (`root.go`), so every subcommand accepts it uniformly and future commands inherit it with zero registration work. It is a no-op on commands that have not (yet) been routed through the sink — deliberate incremental adoption; the three commands below are converted in this change because they are the ones the audit identified as carrying chatter.

**Convention, decided once** (this is the "stdout-vs-stderr + quiet-gating convention" the backlog asks for):

- **stdout carries data** — machine-consumable results (`--json` documents, explicitly-requested previews/lists, outcome lines). Never gated by `--quiet`.
- **stderr carries everything else** — progress, decoration, chatter, and errors. `--quiet` drops the progress/decoration/chatter portion; **errors always survive** (they keep flowing through `RunE` error returns and ungated stderr writes).
- Exit codes are never affected by `--quiet`.
- A successful run with nothing to report is **silent** under `--quiet`.

**Sink**: a small helper in a new `app/backend/cmd/rk/output.go` (package `main`, same as all commands — no new `internal/` package needed for a CLI-only concern). Sketch (exact shape is the plan's call):

```go
// output.go
type outputSink struct {
	data    io.Writer // cmd.OutOrStdout() — survives --quiet
	chatter io.Writer // cmd.ErrOrStderr(), or io.Discard under --quiet
}

func newSink(cmd *cobra.Command) outputSink // reads the persistent --quiet flag
func (s outputSink) Dataf(format string, a ...any)  // data channel
func (s outputSink) Notef(format string, a ...any)  // chatter channel (quiet-gated)
```

Built on `cmd.OutOrStdout()`/`cmd.ErrOrStderr()` (not bare `os.Stdout`) so quiet-gating is unit-testable — the idiom `doctor.go` and `agent_setup.go` already use.

**Consequence for non-quiet runs**: adopting the convention re-routes progress lines that today go to stdout (notably `update`'s) onto stderr, aligning with Principle 2 (stdout is data). This is an intentional part of "decide the convention once", not collateral.

### 2. `run-kit update` (`upgrade.go`) — quiet gating

Line classification under the convention:

- **Chatter (stderr, dropped by `--quiet`)**: `Current version: v…`, `Updating v… → v…...`, `Restarting run-kit daemon...`, `run-kit daemon started (…)` — and the streamed brew subprocess output. `runBrewFn`'s default impl currently wires brew's stderr (and stdout for `upgrade`) straight to the process streams; under `--quiet` those streams are suppressed (brew output is the definitional "raw brew output" chatter Principle 9's `shll update` precedent exists to avoid). The seam stays a package-level var so tests keep observing calls without a real brew.
- **Data (stdout, survives)**: outcome lines — `Already up to date (v…).`, `Updated to v….`, and the not-a-brew-install guidance block (it explains why nothing happened; silence there would misreport a no-op as success).
- **Errors**: unchanged (`RunE` returns).

### 3. `run-kit doctor` (`doctor.go`) — quiet gating

- **Dropped by `--quiet`**: the `Checking runtime dependencies...` banner, per-check `[ OK ]` rows, and the `All checks passed.` tail (all already on stderr).
- **Survives**: `[FAIL]` rows (they carry the remediation hint — actionable error detail) and the non-zero exit via the existing `RunE` error.
- **`--json` path is untouched**: its stdout document is data by definition; `--quiet --json` emits exactly the JSON.

### 4. `run-kit agent-setup` (`agent_setup.go`) — quiet gating

- **Dropped by `--quiet`**: informational status lines — `…: hooks already installed … — nothing to do.`, `…: wrote ….`, `…: skipped (no changes written).`, and the legacy-skill removal narration.
- **Never gated (consent flow is interaction, not decoration)**: the interactive prompt and its settings diff remain intact under `--quiet` — a consent prompt without the diff it asks about would be a dark pattern. The non-TTY refusal naming `--yes` also survives (it is an error).
- **`--dry-run`'s diff survives** `--quiet`: a dry-run's diff is the explicitly-requested data — the entire point of the invocation.
- Net effect: `run-kit agent-setup --yes --quiet` is fully silent on success; errors and refusals still print.

### 5. `run-kit reaper` (`reaper.go`) — default list cap + `--all`

- **Default cap: 10 entries per rendered list**, mirroring the backlog's cited precedent (`shll changelog`'s 10-release cap) for toolkit-wide consistency. Applies to **both** output paths:
  - `renderDryRun`: the candidate list caps at 10 entries.
  - `renderReapSummary`: the `killed` and `removed` lists cap at 10 entries **each** (per-list cap — simplest at the two render sites).
- **Truncation notice, stated in output** (silent truncation reads as completeness). Wording per the backlog, e.g. for dry-run:

  ```
  Dry run: 4485 candidate(s) would be reaped (nothing was touched). Pass --yes to act:
    kill   rk-test-a1b2
    remove rk-test-c3d4
    …(8 more entries)…
    … and 4475 more; pass --all to list all
  ```

- **`--all` flag**: display-only escape hatch that restores the full list on either path.
- **The cap is display-only — semantics are untouched.** Counts in header lines stay exact (computed from the full result). `--yes`/`--force` still reap **every** match regardless of what was listed; `--all` changes only what is printed, never what is reaped. The dangerous-prefix guard, `_rk-ctl`/`rk-daemon` unconditional skips, and dry-run-by-default behavior are all unchanged.
- Reaper needs **no quiet conversion**: everything it prints is data (a dry-run's candidate list is the requested result; an act summary is the record of a destructive mutation), so `--quiet` legitimately changes nothing there.

### 6. Tests

Go unit tests in `cmd/rk` covering: quiet gating per converted command (update via the existing `runBrewFn`/`restartDaemonFn`/`resolveExeFn` seams; doctor and agent-setup via `cmd.OutOrStdout()`/`ErrOrStderr()` buffers), the reaper cap (≤10 entries listed, exact counts in headers, notice wording, `--all` restores full list, per-list cap on the act summary), and that `--quiet` never suppresses errors or changes exit codes. Long help text (`reaper.go` `Long`, README command table) stays accurate — the reaper `Long` text gains a sentence about the cap/`--all`.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) flip Principle 9 from "deferred to backlog [f8yv]" to conformant — record the shipped mechanism (persistent `--quiet` + sink convention, reaper 10-entry cap + `--all`) as the P9 posture
- `run-kit/architecture`: (modify) CLI Subcommands notes — the shared output-sink convention and the new flags on update/doctor/agent-setup/reaper

## Impact

- **Files**: `app/backend/cmd/rk/root.go` (persistent flag), `output.go` (new sink), `upgrade.go`, `doctor.go`, `agent_setup.go`, `reaper.go`, plus sibling `*_test.go` files.
- **Out of scope**: `serve`/`daemon`/`status`/`riff`/etc. accept the persistent `--quiet` but are not routed through the sink in this change (no audited chatter gap there); no API/frontend/daemon changes; no `internal/` changes.
- **Toolkit surfaces**: `help-dump` output changes automatically with the new flags (no golden fixture exists — `help_dump_test.go` asserts structure dynamically); README and `docs/site/` don't enumerate per-command flags, so no doc updates are required by readme-extraction — the README command table one-liners stay accurate as-is.
- **Verification (from the backlog's VERIFY line)**: `--quiet` leaves data + errors intact and removes only progress/decoration; reaper caps by default and states the cap in output; `--all` restores the full list.

## Open Questions

None — the backlog entry carries an explicit FIX/VERIFY design, and the c424 audit already settled scope (which commands carry chatter, which surface is unbounded).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `--quiet` is a single **persistent flag on rootCmd**, not per-command flags | Backlog asks for the convention decided once; persistent registration means future commands inherit it for free; harmless no-op on unconverted commands. Alternative (per-command registration on the three candidates) rejected as the ad-hoc shape the backlog names | S:60 R:80 A:70 D:55 |
| 2 | Confident | Output convention: stdout=data, stderr=chatter+errors; `--quiet` drops chatter only; sink lives in `cmd/rk/output.go` (package main) | Principle 9's survive-rule + Principle 2 (stdout is data) pin the split; CLI-only concern needs no `internal/` package. Re-routes update's progress lines stdout→stderr on non-quiet runs — intentional per "decide the stdout-vs-stderr convention once" | S:70 R:75 A:75 D:65 |
| 3 | Confident | `update` outcome lines (`Updated to v…`, `Already up to date`, not-brew guidance) are **data** and survive `--quiet`; progress lines + streamed brew output are chatter | Outcome is the operation's result (one line); full silence would make updated vs already-current indistinguishable. Brew streams are the exact "raw brew output" the shll precedent avoids | S:55 R:85 A:70 D:55 |
| 4 | Confident | `doctor --quiet` keeps `[FAIL]` rows + non-zero exit, drops banner/`[ OK ]`/success tail; `--json` untouched | FAIL rows carry the remediation hint — actionable error detail, which Principle 9 says survives; the rest is decoration | S:70 R:85 A:80 D:75 |
| 5 | Confident | `agent-setup --quiet` drops informational status lines only; interactive consent prompt + diff and the non-TTY refusal are never gated; `--dry-run` diff survives (it is the requested data) | Consent context is interaction, not chatter — gating it would undermine the P1/P5 consent flow shipped in c424; a dry-run exists to show the diff | S:55 R:80 A:65 D:50 |
| 6 | Confident | Reaper default cap = **10 entries per list**, display-only, applied to both dry-run and act-summary paths; header counts stay exact; `--yes` reaps all matches regardless of display | Backlog cites `shll changelog`'s 10-release cap as the mirror — matching it keeps toolkit-wide consistency; a cap that changed reap semantics would be a behavior change the backlog doesn't ask for | S:60 R:90 A:75 D:60 |
| 7 | Certain | `--all` is a display-only escape hatch restoring the full list on either path | Stated verbatim in the backlog ("pass --all to list", "--all restores the full list") | S:85 R:90 A:85 D:85 |
| 8 | Confident | Quiet conversion scope = update/doctor/agent-setup only; reaper's output is all data so `--quiet` changes nothing there; other commands stay unconverted | The three candidates are the ones the audit named as carrying chatter; a dry-run list and a destructive-mutation record are data by the convention | S:60 R:85 A:75 D:65 |
| 9 | Certain | Coverage via Go unit tests in `cmd/rk` using the existing seams (`runBrewFn`, `cmd.OutOrStdout()`/`ErrOrStderr()` buffers) | code-quality.md mandates tests for changed behavior; the seams were built for exactly this in c424 | S:80 R:90 A:95 D:90 |
| 10 | Certain | No README/docs-site updates required; help-dump output regenerates automatically (no golden fixture) | Verified at intake: README/docs/site don't enumerate per-command flags; help_dump_test.go asserts structure dynamically, not bytes | S:70 R:95 A:90 D:85 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).

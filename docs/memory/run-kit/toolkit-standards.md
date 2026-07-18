---
type: memory
description: "run-kit's sahil87-toolkit-standards conformance posture — constitution binding (§ Toolkit Standards), the audit-against-HEAD-build rule (installed brew rk is stale), and the per-standard status audited @ shll v0.0.23 (help-dump: 1 envelope fix; readme-extraction: 2 closure fixes; principles: P1/P2/P4/P5 fixed — P4 exit-code convention conformant via 260717-rex1 central classification, only P9 deferred [f8yv]; skill: PASS). Deliverable = the PR-body conformance report."
---
# Toolkit Standards Conformance

**Domain**: run-kit

## Overview

run-kit is one of the sahil87 toolkit CLIs, and its constitution
(§ Toolkit Standards, added v1.6.0 by `260717-zn03-constitution-toolkit-standards`,
PR #379) binds it to the toolkit's published standards — the set enumerated at
runtime by `shll standards`, each readable with `shll standards <name>`. This
file records the **conformance posture** established when that binding was first
audited: which standards exist, how run-kit was measured against each, what was
fixed, and what was deferred. It is the baseline a future re-audit diffs against.

The audit + proportionate fixes landed in
`260717-c424-toolkit-standards-conformance`. The deliverable — a per-standard
conformance report — ships in that change's **PR body only** (lifted from
`fab/changes/260717-c424-toolkit-standards-conformance/conformance-report.md` at
ship), not as a committed doc under `docs/`; there is no named consumer for a
parallel in-repo copy, so committing one would only invite drift.

## Requirements

### Requirement: Audit against a HEAD build, never the installed brew binary
Conformance MUST be assessed against a build of the repo at HEAD
(`just build` → `bin/rk`, source `app/backend/cmd/rk/`), NOT the installed
Homebrew `rk`. The installed binary lags the tree — at the c424 audit it was
brew `rk` v3.7.2, which rejects `rk skill` (a standard adopted at HEAD by
PR #381) and would false-negative an already-conformant surface. The canonical
command name is `run-kit`; `rk` is the permanent short alias (both invoke the
same binary).

#### Scenario: A standard adopted at HEAD but absent from the installed binary
- **GIVEN** the `skill` standard, adopted at HEAD (`rk skill` + `docs/site/skill.md`)
- **WHEN** the audit runs against the stale installed brew `rk` (v3.7.2)
- **THEN** `rk skill` errors (`unknown command "skill"`) and the standard reads as unmet
- **AND** the audit-against-HEAD-build rule prevents that false negative: `bin/rk skill` passes the standard's checklist

### Requirement: The standards set is enumerated at runtime, not assumed
Each audit MUST re-run `shll standards` for the authoritative list and
`shll standards <name>` for each entry's full text — never work from memory or
the website. If `shll standards` fails, run `shll update` once; if it still
fails, STOP and report. The precondition passed at the c424 audit (exit 0, no
update needed).

## Standards Audited @ shll v0.0.23

The audit pinned **`shll v0.0.23`** (the `shll version` shll row at audit time) —
standards are versioned with the shll release, so a conformance claim is only
meaningful against a named version. `shll standards` enumerated four:

| Standard | Kind | Governs |
|----------|------|---------|
| `principles` | foundation | the ten toolkit CLI principles |
| `help-dump` | binary | the machine-readable help contract |
| `readme-extraction` | repo | README + `docs/site/` structure |
| `skill` | binary+repo | the `<tool> skill` agent-bundle contract |

**Version-drift note**: shll moved `v0.0.23` → `v0.1.0` between the audit and the
c424 review. The four cited standards were spot-checked and are **unchanged**
across that bump, so every conformance claim stays pinned at the audited
**`shll v0.0.23`**.

### help-dump — PASS (1 violation fixed)
The only violation was the envelope shape: it emitted `captured_at`, which the
standard forbids as a rule "with teeth" (the capture timestamp is owned by the
shll.ai puller — a tool cannot know its own capture time). **Fixed here**: the
envelope is now exactly `{tool, version, schema_version, root}` (see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `help-dump` row —
the `dump` struct dropped `CapturedAt` and the `nowUTC`/`time` plumbing). The
rest of the checklist already passed and still does: exit 0, stdout-only JSON,
stderr empty, no `completion`/`help`/hidden nodes, `version` from the built
binary (ldflags). Re-verified after the flag-adding principle fixes changed the
command tree (R8).

*Nuance, not a violation*: the `version` field is `v`-prefixed (`v3.8.0`); the
standard's example shows bare semver but its text mandates only "from the built
binary", and `shll version` itself renders `v`-prefixed rows — left as-is.

### readme-extraction — PASS (2 closure violations fixed)
Both violations were **closure** escapes — a relative link leaving the published
set (the README slice + `docs/site/**`) 404s on the rendered shll.ai page:
- `README.md` linked `docs/specs/agent-state.md` relatively (a path outside the
  published set) — **fixed** to the absolute
  `https://github.com/sahil87/run-kit/blob/main/docs/specs/agent-state.md`.
- `docs/site/install.md` linked `../../README.md#agent-state--run-kit-agent-setup`
  (a `..` escape out of `docs/site/`) — **fixed** to the absolute
  `https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup`.
  (This one was **missed by the audit sweep and caught at review** — hence the
  report's § readme-extraction initially over-PASSed docs/site closure.)

The two auto-rewritten relative forms are correct and stay relative: README →
`docs/site/*.md` hub links, and between-`docs/site/` links. A post-fix closure
sweep over `README.md` + `docs/site/**` showed zero remaining escapes.

### skill — PASS (fully conformant, no changes)
The standard's "deferred, not yet adopted" contingency does NOT apply — `rk skill`
+ `docs/site/skill.md` exist at HEAD (PR #381,
`260717-agst-rk-skill-agent-setup-hooks-only`), so it was audited in full and
passed: byte-identical stdout to canonical, ≤150 lines (83), static-only (no
env-derived content — that stays in `rk context`), in-genre briefing. See
[architecture](/run-kit/architecture.md) § CLI Subcommands (`skill` row) for the
embed mechanism and drift guard.

### principles — PASS with gaps (four fixed, one deferred)
Assessed each of the ten principles against `bin/rk` behavior + source. Of the
five gaps the c424 audit found, three (P1/P2/P5) were fixed in c424; **P4 was
subsequently fixed by `260717-rex1`** (below), leaving only P9 ([f8yv]) deferred.

**Fixed here (additive per-command flags — the intake's in-scope "missing flag"):**
- **P1 (Non-interactive by default)** — `agent-setup` could neither consent
  non-interactively nor refuse a non-TTY prompt. Fixed by `--yes`/`-y` + `--dry-run`
  and a non-TTY refusal naming `--yes`. See [agent-state](/run-kit/agent-state.md)
  § `rk agent-setup` for the consent flow (the material change that also updated
  that file).
- **P2 (stdout is data)** — `status` and `doctor` had no machine format. Fixed by
  `--json` on both (data to stdout; `doctor`'s human diagnostic stays on stderr).
  See [architecture](/run-kit/architecture.md) § CLI Subcommands.
- **P5 (Visible mutation boundaries)** — the `agent-setup --dry-run` above also
  satisfies P5's destructive-write preview requirement.

**Fixed by `260717-rex1` (the deferred restructural P4, now conformant):**
- **P4 (Fail fast — exit-code convention)** — usage errors now exit `2`, operational
  failures `1`, per the convention. The c424 audit deferred this to [rex1] because
  it is a cross-cutting error-model change, not a per-command missing exit code;
  `260717-rex1` implemented it. The model (all in `cmd/rk`, extending the existing
  `exitCodeError` plumbing rather than a parallel mechanism):
  - **Pure classification seam** — `execute()` (`root.go`) calls `os.Exit(exitCode(err))`
    instead of a blanket `os.Exit(1)`. `exitCode(err) int` (`exit_code.go`) is pure
    (no `os.Exit`/I/O, unit-testable in-process): `errors.As` on `*exitCodeError`
    yields its carried `.code`; else default `1`.
  - **`usageError(err)` constructor** (`exit_code.go`) wraps any error as
    `*exitCodeError{code: 2}` (named `exitUsage`), preserving the message verbatim
    so cobra's existing stderr (`Error: …` line + usage) is byte-identical — only the
    exit code changes.
  - **Flag-parse errors** — one `rootCmd.SetFlagErrorFunc(→ usageError)` in `init()`;
    cobra's own-wins inheritance covers every subcommand.
  - **Arg-count validators** — a central wrap loop in `init()` over `rootCmd.Commands()`
    re-tags each non-nil `c.Args` via `usageArgs` (inert for `ArbitraryArgs` commands),
    a one-place root-cause fix rather than editing the five declaration sites
    (`shell-init`/`help-dump`/`agent-setup`/`skill`/`notify`).
  - **Unknown command** — classified at the `execute()` seam by the stable
    `unknown command ` message prefix (`unknownCommandPrefix`) with root `Args: nil`.
    Keeping `Args: nil` lets cobra print the unknown-command line, Levenshtein
    suggestions, and the `Run '… --help' for usage.` hint natively (byte-identical);
    the prefix match fails safe (2→1, never wrong output) if cobra's wording ever
    changes. (Note the case-sensitivity: cobra's help-topic error `Unknown help topic`
    has a capital U and does NOT match, so `rk help bogus` stays exit 0.) An explicit
    `rootCmd.Args` validator was rejected in review — it relocated detection and
    regressed all three stderr behaviors.
  - **riff exit-class renumbering** — `internal/riff` constants swapped to conform:
    `ExitValidation` 1→2 (usage), `ExitPrecondition` 2→1 (operational), `ExitSubprocess`
    unchanged at 3. Numeric-value change only — the `POST /api/riff` HTTP mapping keys
    on the constant **identity** (`ExitValidation` → 400), so no api-layer change. riff's
    manual `Flags().Parse` error (`DisableFlagParsing` bypasses the root FlagErrorFunc)
    is wrapped locally as `usageError` (exit 2). See [rk-riff](rk-riff.md) § Exit Code
    Discipline and [architecture](architecture.md) § CLI Subcommands (`riff` row).
  - **agent-hook never-fail carve-out preserved** — `agent-hook` keeps its own
    `SetFlagErrorFunc(→ nil)`, which shadows the root's (cobra own-wins), plus its
    `ArbitraryArgs` + `FParseErrWhitelist.UnknownFlags`, so every malformed invocation
    still exits `0`. This is safety-critical: Claude Code treats a hook exit **2 as
    *blocking***, so agent-hook must surface neither 1 nor 2. `agent_hook.go` was NOT
    modified; a regression test asserts `exitCode == 0` on `--nope` / missing `--agent`
    value / bad arg counts. See [agent-state](agent-state.md).
  - **Docs surfaces updated in lockstep** — the exit-code contract line in the embedded
    `rk skill` bundle (`cmd/rk/skill/skill.md`) + its byte-identical mirror
    `docs/site/skill.md` now state the 0/1/2/3 convention; the `## Exit codes` table in
    `docs/site/workflows.md` and riff's `-h` `Exit codes:` block were corrected to
    `0` success / `1` precondition / `2` validation-usage / `3` subprocess. Command tree
    unchanged (no flags added/removed), so the help-dump contract is unaffected.

**Deferred to backlog (restructural — the intake's proportionality "restructure" class):**
- **P9 (Bounded, high-signal output)** → `fab/backlog.md` **[f8yv]**. No command
  offers `--quiet`, and `reaper`'s match list is uncapped (~4485 lines in the
  audit environment). Both are global output-model changes (a shared quiet-gating
  convention; a default list cap + `--all` + truncation notice), not a single
  additive flag.

Principles 3, 6, 7, 8, 10 PASS as-audited (help published; stateless/derive-from-tmux;
wraps `wt`/`fab`/`brew`; degrades gracefully; README + docs/site + `rk skill`
bundle discoverable).

## Design Decisions

### `status --json` empty-vs-error semantics (absent ≠ unreachable)
**Decision**: `status --json` splits by the **nature** of the condition, not by
a flag. A **cleanly-absent** server (no tmux server running for the `runkit`
socket) is **empty-success** — `[]` on stdout, exit 0, stderr empty — deliberate
`internal/tmux.ListSessions` behavior, matching the human path's
`No tmux sessions found` + exit 0. An **errorful unreachability** (stale socket,
permission error — a genuine tmux failure) surfaces the error on stderr with a
non-zero exit and **no partial JSON** on stdout.
**Why**: an empty result is data, not a failure, so a machine consumer must be
able to distinguish "nothing running" (parse `[]`) from "tmux broke" (non-zero
exit) — and must never parse a truncated document as complete. Both paths were
verified empirically.
**Rejected**: treating a cleanly-absent server as an error (would force callers
to special-case the common no-server case); emitting partial JSON on failure
(a machine consumer would parse it as a complete, empty result).
*Introduced by*: `260717-c424-toolkit-standards-conformance`

### Deferred gaps go to fab/backlog.md, report lives in the PR body
**Decision**: restructural principle gaps (P4, P9) are recorded as
`fab/backlog.md` entries ([rex1], [f8yv]) and referenced from the report by
backlog id; the conformance report itself is written to the change folder for
the ship stage to lift into the PR body, with no committed copy under `docs/`.
**Why**: `fab/backlog.md` is the repo's freshly-committed deferral convention
(over GitHub issues or draft changes); the report's only consumer is the PR body,
so a parallel in-repo doc would drift with no reader. Deferring the restructural
gaps (rather than a half-covered fix) honors "fix root causes, not symptoms" and
the toolkit's phased-adoption posture.
**Rejected**: GitHub issues / draft changes for the deferrals (not the repo's
visible convention); committing the report under `docs/` (drift, no consumer).
**Follow-up**: the P4 deferral [rex1] has since been implemented (see § principles
→ "Fixed by `260717-rex1`"); [f8yv] (P9) remains the only open deferral. The
backlog-then-implement path validated the deferral convention end-to-end.
*Introduced by*: `260717-c424-toolkit-standards-conformance`

### Unknown-command classification at the `execute()` seam, not an explicit validator
**Decision**: `run-kit bogus` is classified usage-class (exit 2) at the central
`execute()` seam by matching the stable `unknown command ` prefix on cobra's
error, with the root command's `Args` left `nil` — rather than by an explicit
`rootCmd.Args` validator that replicates cobra's `legacyArgs`/Find check.
**Why**: `Args: nil` keeps cobra's native Find/legacyArgs path, which prints the
`unknown command %q` line, the Levenshtein "Did you mean this?" suggestions, and
the trailing `Run 'run-kit --help' for usage.` hint, and detects `run-kit help
bogus` as an unknown help topic (exit 0). A review of the first (cycle-1)
explicit-validator implementation proved — via old-vs-new binary stderr diff —
that it relocated detection from Find-time to ValidateArgs-time and regressed all
three: it dropped the help hint, disabled suggestions (`SuggestionsMinimumDistance`
never bumped 0→2), and broke `help bogus`. Byte-identity of user-facing output
outranks string-coupling elegance; the prefix match fails safe (2→1, never wrong
output) if cobra ever changes the wording, and the capital-U `Unknown help topic`
message deliberately does not match (so `help bogus` stays exit 0).
**Rejected**: an explicit `rootCmd.Args` validator replicating `legacyArgs` (three
distinct stderr regressions); patching each regression inside the validator (would
replicate ever more cobra internals to reproduce what `Args: nil` gives for free).
*Introduced by*: `260717-rex1-unify-usage-error-exit-codes`

### riff exit-class renumbering is a value change, not a mapping change
**Decision**: swap `internal/riff`'s `ExitValidation` (1→2) and `ExitPrecondition`
(2→1) numeric values to conform to Principle 4, and touch no mapping code.
**Why**: both the CLI `os.Exit` wrapper and the HTTP `riffStatusForError` map key
on the **constant identity** (`ExitValidation` → 400), never the literal value, so
the value swap propagates to every consumer with zero mapping edits — the HTTP
`400` for an unknown preset is unchanged. A locking test (`TestRiffExitClassMapping`)
pins the new numeric values so a future accidental re-swap is caught.
**Rejected**: leaving riff's codes inverted (permanent P4 nonconformance for the
one command already using explicit codes); adding a numeric translation layer at
the boundaries (unnecessary once consumers key on identity).
*Introduced by*: `260717-rex1-unify-usage-error-exit-codes`

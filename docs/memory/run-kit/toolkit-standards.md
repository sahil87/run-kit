---
type: memory
description: "run-kit's shll-toolkit-standards conformance posture — constitution binding (§ Toolkit Standards), audit-against-HEAD-build rule, per-standard status @ shll v0.0.23. help-dump, readme-extraction, skill, and all ten principles PASS; skill has topic pages (`rk skill display`), `rk context` retired for `rk url`; Principle 9 bounded/high-signal output via `--quiet` + reaper display cap."
---
# Toolkit Standards Conformance

**Domain**: run-kit

## Overview

run-kit is one of the shll toolkit CLIs, and its constitution
(§ Toolkit Standards, v1.6.0) binds it to the toolkit's published standards — the
set enumerated at runtime by `shll standards`, each readable with
`shll standards <name>`. (`260717-zn03-constitution-toolkit-standards`, PR #379.)
This file records the **conformance posture**: which standards exist, how run-kit
is measured against each, what was fixed, and what was deferred. It is the
baseline a future re-audit diffs against.

The per-standard conformance report is **not** a committed doc under `docs/`: it
lives in the change folder
(`fab/changes/260717-c424-toolkit-standards-conformance/conformance-report.md`)
and is lifted into the **PR body only** at ship. There is no named consumer for a
parallel in-repo copy, so committing one would only invite drift.
(`260717-c424-toolkit-standards-conformance`.)

## Requirements

### Requirement: Audit against a HEAD build, never the installed brew binary
Conformance MUST be assessed against a build of the repo at HEAD
(`just build` → `bin/rk`, source `app/backend/cmd/rk/`), NOT the installed
Homebrew `rk`. The installed binary lags the tree — at the audit it was
brew `rk` v3.7.2, which rejects `rk skill` (a standard adopted at HEAD by
PR #381) and would false-negative an already-conformant surface. The canonical
command name is `run-kit`; `rk` is the permanent short alias (both invoke the
same binary). (`260717-c424-toolkit-standards-conformance`.)

#### Scenario: A standard adopted at HEAD but absent from the installed binary
- **GIVEN** the `skill` standard, adopted at HEAD (`rk skill` + `docs/site/skill.md`)
- **WHEN** the audit runs against the stale installed brew `rk` (v3.7.2)
- **THEN** `rk skill` errors (`unknown command "skill"`) and the standard reads as unmet
- **AND** the audit-against-HEAD-build rule prevents that false negative: `bin/rk skill` passes the standard's checklist

### Requirement: Bounded, high-signal output (Principle 9)
run-kit's CLI SHALL conform to toolkit Principle 9 (bounded, high-signal output):
unbounded surfaces carry explicit caps stated in the output, and what survives
`--quiet` is the data and the errors — never progress, decoration, or chatter.
(`260717-f8yv-cli-output-volume-controls`.)

The shipped posture (mechanism lives in
[architecture](/run-kit/architecture.md) § CLI Subcommands — the `outputSink`
convention plus the per-command rows):

- **A single persistent `--quiet` bool on `rootCmd`** (`root.go`), so every present
  and future subcommand accepts it uniformly and inherits it with zero registration
  work. It is a deliberate no-op on any command not yet routed through the sink
  (incremental adoption).
- **A shared `outputSink` convention, decided once** (`cmd/rk/output.go`, package
  `main`): **stdout carries data** (machine-consumable results — outcome lines,
  `--json` documents, requested previews/lists — never gated by `--quiet`);
  **stderr carries chatter** (progress/decoration) which `--quiet` routes to
  `io.Discard`. **Errors always survive** (they flow through `RunE` returns and
  ungated stderr writes); exit codes are never affected by `--quiet`; a successful
  run with nothing to report is silent under `--quiet`. Built on
  `cmd.OutOrStdout()`/`cmd.ErrOrStderr()` (never bare `os.Stdout`/`os.Stderr`) so
  gating is unit-testable — the idiom `doctor.go`/`agent_setup.go` already used.
- **Three commands adopt the sink** (the audit-named chatter carriers): `update`
  (`upgrade.go`), `doctor` (`doctor.go`), `agent-setup` (`agent_setup.go`).
  `update`'s progress lines route to stderr on non-quiet runs — a consequence of
  "decide the convention once", aligning with Principle 2 (stdout is data).
- **A consent-mode diff-routing nuance in `agent-setup`**: the
  settings diff routes **per consent mode** via `consent.diffWriter` — on the
  interactive-prompt and `--dry-run` paths it is **data** (never gated: a consent
  prompt without the diff it asks about is a dark pattern, and a dry-run's diff is
  the requested output), while on the **`--yes`** path (write already authorized)
  it is **chatter**, so `--yes --quiet` is fully silent on success while `--yes`
  non-quiet still shows the diff on stderr. The interactive prompt itself and the
  non-TTY refusal are never gated (the refusal is an error).
- **A brew-stderr-in-error nuance in `update`**: under `--quiet`
  the suppressed brew subprocess stderr is **buffered** (not discarded) and, on a
  non-zero exit, wrapped into the returned error, so a failing `rk update --quiet`
  keeps its diagnostic detail rather than surfacing a bare `exit status 1`.
- **`reaper` gets a display cap, not a quiet conversion** (`reaper.go`): everything
  reaper prints is data (a dry-run's candidate list is the requested result; an act
  summary is the record of a destructive mutation), so `--quiet` legitimately
  changes nothing. Instead each rendered list caps at **10 entries per list**
  (mirroring `shll changelog`'s 10-release cap) with a **stated truncation notice**
  (`… and N more; pass --all to list all`) — silent truncation reads as
  completeness — applied to **both** paths (`renderDryRun`'s candidate list;
  `renderReapSummary`'s `killed` and `removed` lists, each capped independently). A
  **`--all`** display-only escape hatch restores the full list. The cap is
  **display-only**: header counts stay exact (computed from the full result),
  `--yes`/`--force` still reap every match regardless of what was listed, and the
  dangerous-prefix guard, `_rk-ctl`/`rk-daemon` unconditional skips, and
  dry-run-by-default behavior are all unchanged.

#### Scenario: `--quiet` preserves data and errors, drops chatter
- **GIVEN** `run-kit doctor --quiet` with all dependencies present
- **WHEN** the checks pass
- **THEN** stderr is empty (banner / `[ OK ]` rows / success tail dropped) and the exit code is 0
- **AND GIVEN** a failing check, the `[FAIL]` row (carrying the remediation hint) survives on stderr and the exit is non-zero
- **AND GIVEN** `--quiet --json`, stdout carries exactly the JSON report

#### Scenario: Reaper caps a large list and states the cap
- **GIVEN** a dry-run with 4485 candidates
- **WHEN** `renderDryRun` renders under the default cap
- **THEN** at most 10 candidate rows print, the header count is the exact `4485`, and the notice states `… and 4475 more; pass --all to list all`
- **AND GIVEN** `--all`, every candidate row prints with no truncation notice and reap semantics are identical

### Requirement: The standards set is enumerated at runtime, not assumed
Each audit MUST re-run `shll standards` for the authoritative list and
`shll standards <name>` for each entry's full text — never work from memory or
the website. If `shll standards` fails, run `shll update` once; if it still
fails, STOP and report.

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

**Version-drift note**: shll has since moved `v0.0.23` → `v0.1.0`. The four cited
standards are **unchanged** across that bump, so every conformance claim stays
pinned at the audited **`shll v0.0.23`**.

### help-dump — PASS (1 violation fixed)
The envelope is exactly `{tool, version, schema_version, root}` (see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `help-dump` row). It
carries **no** `captured_at` — the standard forbids it as a rule "with teeth" (the
capture timestamp is owned by the shll.ai puller; a tool cannot know its own
capture time). The rest of the checklist passes: exit 0, stdout-only JSON, stderr
empty, no `completion`/`help`/hidden nodes, `version` from the built binary
(ldflags), re-verified against the flag-added command tree (R8).
(`260717-c424-toolkit-standards-conformance`.)

*Nuance, not a violation*: the `version` field is `v`-prefixed (`v3.8.0`); the
standard's example shows bare semver but its text mandates only "from the built
binary", and `shll version` itself renders `v`-prefixed rows — left as-is.

### readme-extraction — PASS (2 closure violations fixed)
Closure holds: every relative link stays inside the published set (the README
slice + `docs/site/**`), so none 404s on the rendered shll.ai page. The two links
that would have escaped are absolute:
- `README.md`'s link to `docs/specs/agent-state.md` (outside the published set) is
  the absolute
  `https://github.com/sahil87/run-kit/blob/main/docs/specs/agent-state.md`.
- `docs/site/install.md`'s link to the README anchor (a `..` escape out of
  `docs/site/`) is the absolute
  `https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup`.

The remaining relative forms are correct and stay relative: README →
`docs/site/*.md` hub links, and between-`docs/site/` links. A closure sweep over
`README.md` + `docs/site/**` shows zero escapes.
(`260717-c424-toolkit-standards-conformance`.)

**Toolkit "shll toolkit" naming.** The toolkit's name is **"shll toolkit"**
(sahil87/shll#56), and the readme-extraction standard's canonical README
blockquote is
`> Part of the [shll toolkit](https://shll.ai) — see all projects there.`
run-kit's `README.md` line 3 is that blockquote **byte-exact** (mandated head
order H1 → blockquote → badges), and the constitution § Toolkit Standards clause
reads "part of the shll toolkit". Identifiers stay by design: `sahil87/tap`
formula names, `github.com/sahil87/…` / `raw.githubusercontent.com/sahil87/…`
URLs, and the constitution's `sahil87/shll` canonical-source reference are all
untouched. (`260718-oa9b-shll-toolkit-rename`.)

### skill — PASS (fully conformant; topic pages adopted)
`rk skill` + `docs/site/skill.md` exist at HEAD (PR #381), so the standard's
"deferred, not yet adopted" contingency does NOT apply — it passes in full:
byte-identical stdout to canonical, ≤150 lines, static-only, in-genre briefing.
See [architecture](/run-kit/architecture.md) § CLI Subcommands (`skill` row) for
the embed mechanism and drift guard.
(`260717-agst-rk-skill-agent-setup-hooks-only`.)

**Topic pages.** The shll skill standard has **topic pages** (`<tool> skill
<topic>`, each canonical at `docs/site/skill/<topic>.md`, ≤150 lines, static-only,
byte-identical, drift-guarded, rendered at `/<tool>/skill/<topic>` on shll.ai —
shll PR #47). `rk skill display` serves `docs/site/skill/display.md` (81 lines)
via the **per-topic** embed + drift-guard extension of the existing mechanism (a
`map[string][]byte` topic table, one `//go:embed`/`bytes.Equal`/line-budget test
per topic file). The standard's fail-fast rule holds: an **unknown topic** exits
usage-class (2) via the `usageError` helper with the valid topics named on stderr
and **empty stdout** — never a silent empty document; bare `rk skill` **never
inlines** a topic page. No new standard is introduced (the four @ `shll v0.0.23`
are unchanged) — this is a revised clause of the already-passing `skill` standard.
See § Design Decisions → "Static derivation recipes replace `rk context`
(a recipe is static content)". (`260718-icxz-skill-display-topic-url-retire-context`.)

### principles — PASS (all gaps closed)
Each of the ten principles is assessed against `bin/rk` behavior + source, and all
PASS — no principle gaps remain open. The conformance mechanisms:

**P1/P2/P5 — additive per-command flags:**
- **P1 (Non-interactive by default)** — `agent-setup` consents non-interactively
  via `--yes`/`-y` + `--dry-run`, and refuses a non-TTY prompt naming `--yes`. See
  [agent-state](/run-kit/agent-state.md) § `rk agent-setup` for the consent flow.
- **P2 (stdout is data)** — `status` and `doctor` carry a machine format via
  `--json` (data to stdout; `doctor`'s human diagnostic stays on stderr). See
  [architecture](/run-kit/architecture.md) § CLI Subcommands.
- **P5 (Visible mutation boundaries)** — the `agent-setup --dry-run` above also
  satisfies P5's destructive-write preview requirement.

(`260717-c424-toolkit-standards-conformance`.)

**P4 (Fail fast — exit-code convention):** usage errors exit `2`, operational
failures `1`. The model (all in `cmd/rk`, extending the existing `exitCodeError`
plumbing rather than a parallel mechanism):
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
    has a capital U and does NOT match, so `rk help bogus` stays exit 0.) See
    § Design Decisions → "Unknown-command classification at the `execute()` seam".
  - **riff exit-class renumbering** — `internal/riff` constants conform:
    `ExitValidation` 2 (usage), `ExitPrecondition` 1 (operational), `ExitSubprocess`
    3. The `POST /api/riff` HTTP mapping keys on the constant **identity**
    (`ExitValidation` → 400), so no api-layer change. riff's manual `Flags().Parse`
    error (`DisableFlagParsing` bypasses the root FlagErrorFunc) is wrapped locally
    as `usageError` (exit 2). See [rk-riff](rk-riff.md) § Exit Code Discipline and
    [architecture](architecture.md) § CLI Subcommands (`riff` row), and § Design
    Decisions → "riff exit-class renumbering is a value change, not a mapping change".
  - **agent-hook never-fail carve-out** — `agent-hook` keeps its own
    `SetFlagErrorFunc(→ nil)`, which shadows the root's (cobra own-wins), plus its
    `ArbitraryArgs` + `FParseErrWhitelist.UnknownFlags`, so every malformed invocation
    exits `0`. This is safety-critical: Claude Code treats a hook exit **2 as
    *blocking***, so agent-hook must surface neither 1 nor 2. A regression test
    asserts `exitCode == 0` on `--nope` / missing `--agent` value / bad arg counts.
    See [agent-state](agent-state.md).
  - **Docs surfaces in lockstep** — the exit-code contract line in the embedded
    `rk skill` bundle (`cmd/rk/skill/skill.md`) + its byte-identical mirror
    `docs/site/skill.md` state the 0/1/2/3 convention; the `## Exit codes` table in
    `docs/site/workflows.md` and riff's `-h` `Exit codes:` block state
    `0` success / `1` precondition / `2` validation-usage / `3` subprocess. Command
    tree unchanged (no flags added/removed), so the help-dump contract is unaffected.

(`260717-rex1-unify-usage-error-exit-codes`.)

**P9 (Bounded, high-signal output)** — see § Requirement: Bounded, high-signal
output (Principle 9) for the shipped mechanism.
(`260717-f8yv-cli-output-volume-controls`.)

Principles 3, 6, 7, 8, 10 PASS (help published; stateless/derive-from-tmux;
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
*Introduced by*: `260717-c424-toolkit-standards-conformance`

### Unknown-command classification at the `execute()` seam, not an explicit validator
**Decision**: `run-kit bogus` is classified usage-class (exit 2) at the central
`execute()` seam by matching the stable `unknown command ` prefix on cobra's
error, with the root command's `Args` left `nil` — rather than by an explicit
`rootCmd.Args` validator that replicates cobra's `legacyArgs`/Find check.
**Why**: `Args: nil` keeps cobra's native Find/legacyArgs path, which prints the
`unknown command %q` line, the Levenshtein "Did you mean this?" suggestions, and
the trailing `Run 'run-kit --help' for usage.` hint, and detects `run-kit help
bogus` as an unknown help topic (exit 0). An explicit `rootCmd.Args` validator
relocates detection from Find-time to ValidateArgs-time and regresses all three:
it drops the help hint, disables suggestions (`SuggestionsMinimumDistance` never
bumped 0→2), and breaks `help bogus`. Byte-identity of user-facing output outranks
string-coupling elegance; the prefix match fails safe (2→1, never wrong output) if
cobra ever changes the wording, and the capital-U `Unknown help topic` message
deliberately does not match (so `help bogus` stays exit 0).
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

### Static derivation recipes replace `rk context` (a recipe is static content)
**Decision**: **delete `rk context` outright** (no stub/alias) and absorb its two
halves into the skill standard's static surface: (1) its ~100 lines of static
capability prose (terminal/iframe windows, proxy, Visual Display Recipe,
conventions) move to the new **`rk skill display`** topic page; (2) its genuinely
**dynamic** residue — the ~4-line "where am I" Environment block (pane id, session,
window, window type, server URL) — is taught to agents as a **static derivation
recipe** in the core `rk skill` bundle: a fixed `$TMUX_PANE` / `tmux
display-message -p '#S'`/`'#W'` / `tmux show-option -w @rk_type` / **`rk url`**
snippet. A **derivation recipe is static content even though its result is
dynamic** — the recipe text never varies by where/when it runs, so the bundle can
teach it without violating the standard's static-only rule.
**Why**: `rk context` duplicated the bundle-owned static prose (drift risk — no
guard pinned the two copies) and cost an extra CLI subcommand (Constitution §IV
minimal surface). The standard's own static/dynamic split, plus Constitution §X's
"when a fact is available both ways, derivation wins", applied to rk's own CLI:
every Environment value is derivable by the agent directly (`$TMUX_PANE`, `tmux
display-message`, env-backed config), so the command was pure duplication once the
topic page existed. The one derivation that earns a stable command seam is the
server URL → **`rk url`** (a `config.Load()` heuristic; ecosystem precedent
`gh browse --no-browser` / `docker port` / `minikube service --url`), which also
keeps a natural home for smarter port-owner discovery later without freezing a
heuristic into prose. Net CLI surface: −1 `context`, +1 `url`, +topic arg on
`skill` — zero growth, less duplication. Env-derived content is reached via
`rk url` + the taught tmux derivations; the bundle carries no `rk context`
reference.
**Rejected**: a deprecation stub/alias for `rk context` ("completely get rid of";
the version-locked binary embed makes removal atomic per-install — a binary lacking
the command also ships the bundle that no longer references it, and external callers
follow the fail-silent rk discipline and degrade to no-op); merging context INTO
`rk skill` as a `context` subcommand (topic pages are static-only, and the dynamic
Environment block has no place there — the recipe belongs in the bundle, the URL in
its own command); keeping the static prose in BOTH `rk context` and the topic page
(the exact drift the deletion removes). The fab-kit `_cli-external.md` § rk update
(it documents `rk context` as carrying the recipes) is a **sibling change** in the
fab-kit repo, out of scope here.
*Introduced by*: `260718-icxz-skill-display-topic-url-retire-context`

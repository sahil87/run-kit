---
type: memory
description: "run-kit's shll-toolkit-standards conformance posture — constitution binding, audit-against-HEAD-build rule, per-standard status. help-dump, readme-extraction, skill, ten principles, update, version PASS. Covers skill topic pages, Principle 9 `--quiet`/reaper caps, SIGTERM-with-grace brew mutations, the help-dump + Principle 9 new-surface check (`rk desktop`/`remote`/`daemon run`/`role`/`code-server`/`present`), `rk update`'s best-effort code-server leg, install-composition Policy A+B PASS."
---
# Toolkit Standards Conformance

**Domain**: run-kit

## Overview

run-kit is one of the shll toolkit CLIs, and its constitution
(§ Toolkit Standards, v1.6.0) binds it to the toolkit's published standards — the
set enumerated at runtime by `shll standards`, each readable with
`shll standards <name>`. (`260717-zn03-constitution-toolkit-standards`, PR #379.)
This file records the **conformance posture**: which standards exist, how run-kit
is measured against each, and where conformance is deferred. It is the
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
- **A consent-mode diff-routing nuance in `agent-setup`**: the consent context
  (a semantic summary on the interactive and `--yes` paths; the full body diff
  under `--dry-run` — see [agent-state](/run-kit/agent-state.md) § the hooks
  merge) routes **per consent mode** via `consent.diffWriter` — on the
  interactive-prompt and `--dry-run` paths it is **data** (never gated: a consent
  prompt without the context it asks about is a dark pattern, and a dry-run's diff
  is the requested output), while on the **`--yes`** path (write already
  authorized) it is **chatter**, so `--yes --quiet` is fully silent on success
  while `--yes` non-quiet still shows the context on stderr. The interactive
  prompt itself and the non-TTY refusal are never gated (the refusal is an error).
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
  dry-run-by-default behavior are independent of the cap.

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

### Requirement: A new command surface is checked against help-dump and Principle 9
Any change adding or altering the CLI command tree MUST be checked against the
standards governing that surface (constitution § Toolkit Standards) — in
practice the `help-dump` contract and Principle 9's data-vs-chatter split.
(`260730-pl4v-rk-desktop-install`.)

The `rk desktop` group (`install`/`update`/`status` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `desktop` row) is the
first worked example of what conformance costs on a new surface:

- **help-dump: the command tree is platform-stable.** The three children are
  **registered on every platform**; only *running* them is gated (a parent
  `PersistentPreRunE` on the `desktopGOOS` seam var returns `rk desktop is
  macOS-only (the shell is packaged as a macOS .app)`, an operational exit 1).
  Registering conditionally would make the dump's `root` differ by build
  platform, and the dump is a contract surface shll.ai pulls on a schedule —
  it must not depend on where it ran. The dump needs no code change: the cobra
  tree walk picks the subtree up automatically, and every node carries a `Long:`
  block since help-dump publishes `UsageString`.
- **Principle 9: outcome lines are data, narration is chatter.** Every command
  routes through the shared `outputSink` (`newSink(cmd)`): outcome lines
  (already-installed, installed-to, already-up-to-date, updated-to) are `Dataf`
  on stdout and survive `--quiet` — silence there would misreport a no-op as
  success — while resolution/progress narration is `Notef`, with the installer's
  `Progress` writer bound to `sink.chatter` so download and verification
  progress vanishes under `--quiet`. **`rk desktop status` is entirely data**
  (a read-only report is the requested result), so `--quiet` legitimately
  changes nothing — the same posture `rk status` and `reaper` take, rather than a
  sink conversion.
- **Exit-code convention (P4)** — usage errors 2, operational failures 1:
  flag-parse errors inherit root's `FlagErrorFunc`; the children re-wrap their
  own `Args` validators with `usageArgs` in `desktop.go`'s `init()` because
  root's central wrap loop covers only `rootCmd`'s **direct** children; an
  explicitly-empty `--path ""` is a `usageError` (exit 2) rather than a silent
  fallback to `/Applications`; the platform gate, the not-installed refusal, and
  a quit-timeout abort are operational (1).
- **The `rk skill` bundle and topic pages stay untouched.** The bundle is a
  capability briefing, not a command enumeration — help-dump already covers the
  new tree via the cobra walk, and editing the bundle would trip its
  byte-equality drift guard for no standard-mandated gain.

The `rk remote` group (`add`/`connect`/`list`/`status`/`disconnect`/`remove` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `remote` row, and
[remote-hosts](/run-kit/remote-hosts.md) for the subsystem) is the second surface
measured against the same two checks:

- **help-dump: nothing platform-conditional, nothing hidden.** All six children
  are registered unconditionally on `rootCmd`'s `remoteCmd`, every node carries a
  `Long:` block (help-dump publishes `UsageString`), and the cobra tree walk picks
  the subtree up with no help-dump code change. There is deliberately **no
  `update` verb** — update folds into `connect` — so the dumped tree states the
  surface exactly as designed rather than carrying a seventh node that only
  duplicates a step connect must take anyway.
- **Principle 9: the machine-consumable result is data, the narration is not.**
  Every verb routes through `newSink(cmd)`. `Dataf` on stdout, surviving
  `--quiet`: `add`'s `Name:`/`Target:`/`Local:` lines (the desktop shell parses
  them, so gating them would break a consumer), `connect`'s final origin line
  (the whole point of running it), the `list` tabwriter table and `status`'s
  labeled report (read-only reports are the requested result, the `rk status` /
  `reaper` posture), and `disconnect`/`remove`'s outcome lines — silence there
  would misreport a mutation. `Notef` on stderr, dropped by `--quiet`: connect's
  progress chain, `add`'s `Already registered.` and `Next: rk remote connect …`
  hints, and the installed/updated notes.
- **Exit-code convention (P4)**: the six children re-wrap their own `Args`
  validators with `usageArgs` in `remote.go`'s `init()` — the same reason as
  `desktop`, root's central wrap loop covers only `rootCmd`'s **direct**
  children — so an arg-count violation is a usage error (exit 2) while an
  unknown remote, an ssh failure, or a squatted port is operational (1).
- **The `rk skill` bundle stays untouched**, for the same reason as `desktop`:
  the bundle is a capability briefing, not a command enumeration, and editing it
  would trip its byte-equality drift guard for no standard-mandated gain.

The `rk daemon run` verb (`--window <name> -- <cmd> [args…]` — see
[architecture](/run-kit/architecture.md) § Daemon Lifecycle, the `rk-jobs`
sibling session) is the third surface measured against the same two checks
(`260812-z1ya-update-daemon-tmux-window`):

- **help-dump: platform-stable registration.** `daemonRunCmd` is registered
  unconditionally on `daemonCmd` (alongside start/stop/restart/status) and
  carries a `Long:` block, so the cobra tree walk picks it up with no help-dump
  code change and the dumped contract is identical on every platform — nothing
  about the command is build- or host-conditional (the daemon-running gate is an
  operational error at run time, not a registration condition).
- **Principle 9: one bounded line, no narration.** Success prints exactly one
  data line naming the target — `spawned rk-daemon:rk-jobs:<name> (@N)`, or
  `already running: rk-daemon:rk-jobs:<name> (@N)` (exit 0) when a live job
  window exists — and there is no progress chatter to drop under `--quiet`.
  Errors are operational (down daemon names the fix, `rk serve -d`); a missing
  `--window` or a missing `--` command is a usage error.

The `rk role <operator|clear>` verb (`role.go` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `role` row) is the
fourth surface measured against the same two checks
(`260813-ifya-operator-role-pinned-row`):

- **help-dump: platform-stable registration.** `roleCmd` is registered
  unconditionally on `rootCmd` in `root.go`'s `init()` and carries a `Long:`
  block, so the cobra tree walk picks it up with no help-dump code change and
  the dumped contract is identical on every platform — the `$TMUX_PANE` guard
  is an operational error at run time (a user typed the command outside tmux),
  not a registration condition.
- **Principle 9: the confirmation is data; there is no chatter.** Success
  prints exactly one `Dataf` line on stdout — `@N role=operator` or
  `@N role cleared` — surviving `--quiet` (silence would misreport the
  mutation); there is no progress narration to drop. Errors (unknown action,
  not inside tmux, tmux failure) flow through `RunE` to stderr with a non-zero
  exit.

The `rk code-server` group (`install`/`start`/`update` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `code-server` row)
is the fifth surface measured against the same two checks
(`260813-oid2-own-code-server-install`):

- **help-dump: platform-stable registration.** The parent and all three
  children are registered unconditionally on `rootCmd` (`root.go`'s `init()`)
  and every node carries a `Long:` block, so the cobra tree walk picks the
  subtree up with no help-dump code change and the dumped contract is
  identical on every platform — the `start` verb's daemon-running gate and the
  `update` verb's managed-install gate are operational outcomes at run time,
  not registration conditions. The help-dump goldens were re-checked on the
  change.
- **Principle 9: outcome lines are data, acquisition narration is chatter.**
  Every verb routes through `newSink(cmd)`, and the `internal/codeserver`
  installer's `Progress` writer is bound to `sink.chatter`, so
  resolve/download/extract progress vanishes under `--quiet` while the outcome
  lines — `install`'s already-current / installed lines, `start`'s
  already-running / externally-managed / started lines, `update`'s
  not-managed skip and `Updated code-server vX -> vY` line — are `Dataf` on
  stdout and survive: silence there would misreport a no-op as success or hide
  a mutation. The respawn additions (`260813-2s4u-respawn-aware-code-server-install`)
  follow the same split: `install`'s migration-respawn line (`Respawned
  code-server onto the managed v… (was running a non-managed binary).`) and
  both verbs' daemon-down recovery lines are `Dataf` (each reports a mutation
  or explains why one did not happen), the shared `Restarting the code-server
  session on v…` progress and the uncertain-evidence / externally-managed
  notes are `Notef`. No tree change — no new commands or flags, only `Long:`
  prose on `install`/`update` — so the help-dump contract stays shape-stable.
- **Exit-code convention (P4)**: the children re-wrap their own `Args`
  validators with `usageArgs` in `code_server.go`'s `init()` — root's central
  wrap loop covers only `rootCmd`'s **direct** children (the `desktop` /
  `remote` reason) — so an arg-count violation is a usage error (exit 2),
  while a down daemon (`start` names `rk serve -d`), a missing binary on
  `start` (names `rk code-server install`), and download/verify failures are
  operational (1).
- **The `rk skill` bundle stays untouched**, for the same reason as
  `desktop`/`remote`/`daemon run`/`role`: the bundle is a capability briefing,
  not a command enumeration, and editing it would trip its byte-equality
  drift guard for no standard-mandated gain.

The `rk present` verb (`present.go` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `present` row) is
the sixth surface measured against the same checks
(`260813-becu-rk-present-attach-verb`):

- **help-dump: platform-stable registration.** `presentCmd` is registered
  unconditionally on `rootCmd` with a `Long:` block, so the cobra tree walk
  picks it up with no help-dump code change; the `$TMUX_PANE` guard is an
  operational exit 1 at run time, not a registration condition.
- **Principle 9: the resolved URL is the only stdout line — data.** stdout
  carries exactly the resolved `@rk_url` value (relative for `/present`/
  `/proxy` targets, absolute for external URLs) and prints it even
  under `--quiet` (silence would hide the command's one result); diagnostics
  go to stderr. `--notify`'s send failure is the documented fail-silent
  exception (the `rk notify` contract), not a Principle 9 violation.
- **Exit-code convention (P4)** — 0 success, 1 operational (no `$TMUX_PANE`
  without `--window`, missing file, unreachable port, tmux failure), 2 usage
  (no target, unknown flag).
- **readme-extraction: the README command table gained the `run-kit present`
  row**, keeping the published command documentation closed over the tree.
- **The `skill` standard is load-bearing on this surface** — the canonical
  `docs/site/skill.md` and `docs/site/skill/display.md` (synced to the
  embedded copies by `scripts/sync-skill.sh`) teach `rk present` as the
  primary Visual Display Recipe, with the manual `@rk_url` attach path kept
  as a short appendix for older rk versions. Both files stay within the
  ≤150-line budget and under the byte-equality drift guards
  (`TestSkillEmbedMatchesCanonical`, `TestSkillDisplayEmbedMatchesCanonical`),
  so the skill standard keeps passing. No version-skew machinery is needed:
  the bundle ships inside the binary, so an rk that has `present` is the same
  rk whose pages teach it.

#### Scenario: A new subcommand group keeps the help tree platform-stable
- **GIVEN** the `rk desktop` group on a Linux host
- **WHEN** `rk desktop install` runs
- **THEN** it exits 1 with the macOS-only message on stderr
- **AND** `rk help-dump` still lists the whole `desktop` subtree, so the dumped
  contract is identical to the one a macOS build produces

#### Scenario: `--quiet` keeps a new surface's machine-consumable lines
- **GIVEN** `rk remote add sahil@buildbox --quiet`
- **WHEN** the registration succeeds
- **THEN** stdout carries exactly the `Name:`/`Target:`/`Local:` lines and stderr
  is empty (the `Next: rk remote connect …` hint dropped)
- **AND GIVEN** `rk remote connect <name> --quiet`, the progress chain is dropped
  while the final origin line still prints — the desktop shell parses both
  contracts, so gating either would break a consumer

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

**Version pin**: the four cited standards are **unchanged** at shll `v0.1.0`, so
every conformance claim stays valid at the audited **`shll v0.0.23`**.

### help-dump — PASS
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

### readme-extraction — PASS
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
URLs, and the constitution's `sahil87/shll` canonical-source reference.
(`260718-oa9b-shll-toolkit-rename`.)

### skill — PASS
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
inlines** a topic page. Topic pages are a clause of the already-passing `skill` standard, not a new
standard — the four @ `shll v0.0.23` are unchanged.
See § Design Decisions → "Static derivation recipes replace `rk context`
(a recipe is static content)". (`260718-icxz-skill-display-topic-url-retire-context`.)

### principles — PASS
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
  - **riff exit classes** — `internal/riff` constants conform:
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

## `update` + `version` Standards

The `update` and `version` standards (`shll standards update` / `shll standards
version`) are separate binary standards from the four above. run-kit conforms to
both. The audit measures against the **current** update-standard text, which
carries a **brew-handling safety clause** (incident "Observed 2026-07-19": a
`SIGKILL` landing mid keg-swap).
(`260719-er5k-update-version-standards-conformance`.)

### update — PASS
The subcommand contract passes throughout: `update` (alias `upgrade`) runs
in-place with post-upgrade side effects (daemon restart), works standalone,
advertises + honors `--skip-brew-update`, exits 0 on success (incl.
already-up-to-date) and non-zero only on genuine failure, self-updates via brew
only when brew-installed (the `/Cellar/` gate with a clear non-brew degrade
message), and satisfies the naming/release clauses (`run-kit` is one string
across repo / roster / formula leaf / binary; `v{semver}` tags; the tap carries a
`formula_renames.json` entry mapping the `rk` leaf to `run-kit` — the standard's
own cited precedent). See [architecture](/run-kit/architecture.md) § CLI Subcommands
(`update` row) for the mechanism.

**The umbrella holds the same conformance across all three legs** — `rk
update` updates the CLI, the macOS desktop app, and the rk-managed code-server
install, and every clause the standard cares about holds across them
(`260731-3byh-umbrella-update-auto-restart`; the code-server third leg
`260813-oid2-own-code-server-install`). The brew
leg is governed by the mutation bounds and graceful-cancel discipline below. `--skip-brew-update` is a literal substring of
`rk update --help`. Exit 0 covers success, already-up-to-date, **and every
skip** (not brew-installed, non-darwin, no desktop app, no managed
code-server), with non-zero reserved for a genuine leg failure — the
code-server leg is **best-effort** and never contributes to the exit code at
all (its failures warn only — see the dedicated paragraph below). The non-brew
guidance is a clear degradation and a
*leg* skip: it prints and execution continues to the desktop leg, so a
Homebrew-less CLI still gets its app updated. The **command tree carries the
`code-server` group** (registered unconditionally — see §
Requirement: A new command surface is checked against help-dump and Principle
9), and the help-dump goldens cover it.

**The code-server third leg is best-effort by design**
(`260813-oid2-own-code-server-install`; mechanism in
[architecture](/run-kit/architecture.md) § CLI Subcommands, `update` row). It
runs **only when `~/.rk/code-server-bin` exists** — the ownership gate, the
mirror of the standard's "self-update only when brew-installed" clause; a
user-managed PATH install is never touched, and no managed dir is a silent
skip. It shares `runCodeServerUpdateFlow` with `rk code-server update`
in-process (no subprocess self-call): install the latest digest-verified
release, then kill and respawn the `rk-code-server` session on a version
change so the flipped `current` symlink takes effect (the daemon restart
deliberately never touches sibling sessions, so this leg owns the respawn).
**Any failure is a warning on the chatter surface and NEVER joins the
command's exit code** — deliberately NOT taking the standard's allowance for
non-zero on a failed post-upgrade step: the rk upgrade itself succeeded, the
daemon's install job retries acquisition later, and a false red row in
`shll update`'s summary is worse than a warning. The download is in-process
HTTP under a generous ~15m context bound — no package-manager subprocess, so
the SIGTERM-with-grace brew discipline does not apply, and the atomic symlink
flip makes the swap corruption-proof regardless.

Updating additional artifacts beyond the CLI is what the standard's own "the tool's own
post-upgrade side effects" clause contemplates — the same clause the daemon
restart sits under. The **composition consequence is worth stating plainly**:
`shll update` delegates run-kit's leg to `rk update`, so a composed toolkit
update on a Mac also updates and restarts the desktop app. That is conformant
(a tool owns its own post-upgrade side effects), and it costs the
`install-composition` Policy A posture nothing — no sibling tool is probed or
assumed. A custom-`--path` desktop install stays outside the umbrella's reach
(Constitution II bars an install-path state store), documented in `update`'s
help rather than papered over by path scanning.

Both update entry points share the brew seam: the web one-click upgrade
(`POST /api/update` → `rk update` in the managed `update` job window, via
`daemon.RunJob`) routes through the same `updateCmd`, so the brew discipline
below governs both.

### Brew invocation discipline — the read-only vs mutating split
run-kit splits brew calls by whether they mutate the install, and treats the two
classes differently (the mechanism lives in `newBrewCmd` — see
[architecture](/run-kit/architecture.md) § CLI Subcommands, `update` row):

- **Mutating brew subcommands (`brew update`, `brew upgrade`)** — keg
  transactions that must never be `SIGKILL`ed mid-swap. They run under
  **generous, network-sized bounds** (`brewUpgradeTimeout = 30m`,
  `brewUpdateTimeout = 10m`) with **graceful termination**: `newBrewCmd` sets
  `cmd.Cancel` to deliver **`SIGTERM`** and `cmd.WaitDelay = brewCancelGrace`
  (**30s**), so on context expiry brew gets a trappable signal plus a 30s grace
  window to unwind the keg swap before the runtime's final kill. `brew update`
  is included (not just `brew upgrade`) because the MUST-NOT-`SIGKILL` clause
  covers "a package-manager subprocess mid-transaction" generally and `brew
  update` is network-bound with the same stall profile.
- **Read-only brew queries (`brew info --json=v2`; `internal/updatecheck`'s
  `brew list --versions`)** keep their **short 10s bounds and Go's default
  cancel** (immediate kill). A killed query corrupts nothing, so fast-fail is
  correct. `newBrewCmd` keys the graceful-cancel config on `args[0]`, so an
  unmatched brew subcommand inherits the safe read-only default.

`exec.CommandContext` with a timeout bounds **every** brew call
(Constitution § Process Execution) — the bounds are simply generous with
graceful cancel for mutations, satisfying both the constitution and the
standard's "if any bound exists, it SHOULD be generous and terminate gracefully".
The constitution's 5–10s / 30s figures name tmux / build operations; brew is
neither. `HOMEBREW_NO_GITHUB_API=1` is deliberately **not** set — the standard
only says a bounded caller "should also consider" it, and the generous bound +
`SIGTERM` already satisfies the SHOULD (trivially addable later if wanted).

#### Scenario: A mid-transaction stall terminates gracefully, never mid-swap
- **GIVEN** a `brew upgrade sahil87/tap/run-kit` that stalls past its bound on an
  un-timed `api.github.com` call
- **WHEN** the (30-minute) context finally expires
- **THEN** brew receives a trappable `SIGTERM` (not `SIGKILL`) and a 30s grace
  window to finish or roll back the keg swap
- **AND** a read-only `brew info` in the same run keeps immediate-kill fast-fail,
  since killing a query corrupts nothing

### version — PASS
`--version` exits 0 with the version token on the first non-empty line
(`run-kit version vX.Y.Z`, cobra's default template — the RECOMMENDED canonical
shape, satisfying `versionPrefixRE`), responds within 2s with no network I/O
(pure local ldflags string), and the on-PATH binary name equals the tool name.
The release-shape path is unit-pinned: `TestDisplayVersion` in `root_test.go`
covers `displayVersion`'s three input shapes — `"1.2.3" → "v1.2.3"` (the release
shape shll actually parses), `"v1.2.3"` passthrough, and the `"dev"` sentinel
passthrough (no `"vdev"`) — so the release-shape path (the one shll parses in
production) is pinned, not just the `dev` sentinel. See
[architecture](/run-kit/architecture.md) § Version Management.

## `install-composition` Standard

The `install-composition` standard (`shll standards install-composition`,
authoritative at `sahil87/shll` `docs/site/standards/install-composition.md`,
rendered on https://shll.ai) is a separate **binary+repo** standard from the six
above. It has two halves, each audited and passing: **Policy A** (no
inter-tool Homebrew dependencies; a sibling invoked at runtime is *probed*, never
assumed, and degrades with an actionable install hint) audited @ **`shll
v0.1.18`** (`260814-mx8e-install-policy-a-binary-audit`), and **Policy B**
(install *documentation* is centralized on shll.ai — per-tool READMEs and doc
pages MUST NOT carry per-formula `brew install sahil87/tap/<tool>` install
*instructions*; they point at the curl bootstrap
`curl -fsSL https://shll.ai/install | sh` and `shll install <tool>` for subsets)
audited @ **`shll v0.1.12`** (`260720-ec6i-install-docs-policy-b`). Policy A
binds all seven tap formulas + every sibling-invoking binary; Policy B binds the
six roster-tool repos + the tap README. Individual formula installs remain
*supported* — only *documenting* them per-repo is prohibited.

### Requirement: Install documentation carries no per-formula brew instructions (Policy B)
run-kit's install *documentation* — `README.md` and `docs/site/`, the pages the
shll.ai site extracts — MUST NOT carry per-formula `brew install sahil87/tap/…`
install instructions, and MUST NOT reference the retired `sahil87/tap/all`
meta-formula. Install guidance points to the centralized shll.ai bootstrap
(`curl -fsSL https://shll.ai/install | sh`, subset `sh -s -- run-kit`) and, for
sibling-tool prerequisites, `shll install <tool>` + a https://shll.ai link.
(`260720-ec6i-install-docs-policy-b`.)

### install-composition — Policy B (docs half) PASS
The docs half passes: `README.md` and `docs/site/` carry **no per-formula
`brew install sahil87/tap/…` install instruction**. The audit grep
(`grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/`) is a screen, not
a zero-hit assertion — it also matches the README's
**`rk`→`run-kit` formula-rename note** (`README.md:40`), which explains how to
clear a keg stranded under the old formula name. That is migration
troubleshooting, not install guidance, and it is deliberately kept; every hit the
grep produces must be classified, and today the rename note is the only one. The
install guidance matches the wording in the conformant sibling READMEs
(wt/hop/idea/tu):

- **`README.md`** — the Install section carries both curl bootstrap blocks and no
  per-formula escape hatch; the Quick-start `wt`-prereq fragment and the
  Troubleshooting *"wt not found"* entry both point at `shll install wt` + a
  https://shll.ai link. The Troubleshooting entry earns its place: it is
  doc-carried install guidance, not the Policy-A binary hint.
- **`docs/site/install.md`** — the Install lead-in names the shll.ai bootstrap and
  carries the curl block plus the PATH sentence; the Prerequisites `wt` bullet
  points at the full-toolkit shll.ai link + `shll install wt`. The heading
  structure is load-bearing — shll.ai extraction anchors key on it.
- **No `sahil87/tap/all` reference** in `README.md` or `docs/site/` — the
  standard's Precedent states the meta-formula "is retired in favor of
  `shll install`".

**Explicitly out of scope (KEPT).** The curl bootstrap blocks are the
centralized pointer, not per-formula instructions — kept inline. Upgrade/update
prose (`run-kit update` Homebrew behavior), the README toolkit banner +
command-reference links, `docs/site/skill.md`'s gating instruction, and
historical references in `fab/changes/` / `docs/memory/` / changelogs are
behavior/pointer/history, not install instructions — outside Policy B's reach.

#### Scenario: An audit grep over the install docs finds no per-formula brew instruction
- **GIVEN** `README.md` + `docs/site/`
- **WHEN** `grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/` runs
- **THEN** its only hit is the `README.md` formula-rename troubleshooting note
  (migration guidance, deliberately kept) — no per-formula install instruction and
  no `sahil87/tap/all` reference; install guidance points to the shll.ai bootstrap
  + `shll install <tool>`
- **AND** the desktop-app install section introduces no new hit — it leads with
  `run-kit desktop install` and its manual fallback is a GitHub Releases download,
  never a brew formula (`260730-pl4v-rk-desktop-install`)
- **AND** the Policy-A binary hint in `app/backend/cmd/rk/upgrade.go` still prints
  `brew install sahil87/tap/run-kit` on a non-brew install — conformant binary
  output (Policy A mandates the hint there; Policy B binds docs only)

### install-composition — Policy A (binary half) PASS
Audited @ **`shll v0.1.18`** against a HEAD `bin/rk`
(`260814-mx8e-install-policy-a-binary-audit`; full evidence in that change
folder's `conformance-report.md`, lifted into the PR body per the
report-lives-in-PR-body convention). All three checklist items of the standard's
"Verifying conformance" section hold:

- **Formula**: `sahil87/tap/run-kit` declares zero `depends_on` of any class
  (`brew info --json=v2` + tap source). The formula's only `depends_on` text is
  a comment explaining two deliberate non-declarations — code-server (rk manages
  its own digest-verified install; brew's formula is deprecated/pinned) and tmux
  (host-provided) — neither a toolkit sibling.
- **Probe coverage**: the siblings run-kit's binary invokes are exactly `wt`,
  `fab`, and `shll` (`idea`/`hop`/`tu` never; `scripts/*.sh` and the shipped
  skill pages invoke no sibling — the skill pages carry only the `command -v rk`
  consumer self-gate). Literal `exec.LookPath` probes sit at the user-facing
  entry seams: `cmd/rk/riff.go` `checkPreconditions` (wt),
  `internal/updatecheck` `defaultCheck` (shll), and `api/update.go` `lookShllFn`
  (shll — absent routes fail-silent to the run-kit-self update path). The six
  internal exec sites (`internal/riff` fab launcher + wt create/delete,
  `internal/wt` list/open, `internal/sessions` fab pane map) degrade gracefully
  by handled exec error — silent feature skips (default launcher, `[]` app
  registry, enrichment-less sessions) or surfaced HTTP errors. **No
  crash-capable sibling path exists**; the standard's failure mode (one tool's
  absence crashing another) occurs nowhere.
- **Hints**: the non-brew self-install hint (`cmd/rk/upgrade.go`,
  `brew install sahil87/tap/run-kit`; HTTP twin in `api/update.go`'s 409 body)
  is live-verified conformant. Two hint strings fall short of the standard's
  actionable shape (`<tool> is not installed. Install it: brew install
  sahil87/tap/<tool>`) and are deferred as backlog `[gq7f]`: riff's wt-absent
  message (repo URL, no install command) and updatecheck's bare
  `shll not found on PATH`. Wording only — never-crash conformance holds.

#### Scenario: A missing sibling degrades gracefully with a hint, never a crash
- **GIVEN** a host without `wt` on PATH (scratch-PATH simulation)
- **WHEN** `bin/rk riff echo hi` runs inside tmux
- **THEN** it fast-fails pre-spawn with operational exit 1 and the message
  `run-kit riff: wt not found on PATH (required companion tool — see
  https://github.com/sahil87/wt)` (hint-shape alignment deferred to `[gq7f]`)
- **AND GIVEN** a non-Homebrew `bin/rk`, `rk update` prints the manual-update
  guidance ending `brew install sahil87/tap/run-kit` and exits 0 (a leg skip,
  not a failure)

## Design Decisions

### Handled exec errors satisfy Policy A's probe clause at internal Go seams
**Decision**: internal sibling exec sites (wt/fab in `internal/riff`,
`internal/wt`, `internal/sessions`) rely on handled `exec.CommandContext` errors
rather than a preceding `exec.LookPath`; literal probes live at the user-facing
entry seams (CLI riff precondition, both shll consumers).
**Why**: a handled exec error is authoritative and TOCTOU-free — it never
*assumes* presence, which is the clause's substance (principle №8's
skip-don't-crash); a LookPath at each internal seam would duplicate the check
without changing any observable behavior.
**Rejected**: sprinkling `exec.LookPath` before every internal exec (redundant,
and it races the exec it guards); grading the missing literal probes as
nonconformance (the standard's failure mode — crash on sibling absence — is
structurally absent at every site).
*Introduced by*: `260814-mx8e-install-policy-a-binary-audit`

### Brew mutations run under generous bounds, never a short hard timeout
**Decision**: `brew upgrade` and `brew update` run under network-sized bounds
(`brewUpgradeTimeout` 30m, `brewUpdateTimeout` 10m) with `SIGTERM` plus a 30s
`WaitDelay` grace — never a short hard timeout under `exec.CommandContext`'s
default `SIGKILL` cancel.
**Why**: Homebrew 6 makes an un-timed `api.github.com` call inside every
tap-formula upgrade, so a short bound stalls and then `SIGKILL`s brew between
`brew unlink` and `brew link`, leaving a corrupted keg and a dead binary. That is
precisely what the update standard's safety clause prohibits ("MUST NOT send
`SIGKILL` to a package-manager subprocess mid-transaction" / "MUST NOT impose a
short hard timeout on `brew upgrade`"). Both update entry points — the CLI and
the web one-click upgrade via `daemon.RunJob` — route through the same
`updateCmd`, so the discipline has exactly one place to hold.
**Rejected**: a short hard timeout (e.g. `120s`) on the brew mutation seam — it
produces the corrupted-keg, dead-binary failure above.
*Introduced by*: `260719-er5k-update-version-standards-conformance`

### Graceful brew-mutation cancel lives in an extracted `newBrewCmd` helper
**Decision**: extract `exec.Cmd` construction into `newBrewCmd(ctx, args...)
*exec.Cmd`; the default `runBrewFn` calls it, and mutating subcommands
(`update`, `upgrade`) get `cmd.Cancel` = `SIGTERM` + `cmd.WaitDelay` = 30s grace,
keyed on `args[0]`. Read-only subcommands inherit Go's default cancel.
**Why**: makes the cancel configuration unit-testable without spawning a real
brew (tests assert on the returned `*exec.Cmd` fields), and keeps the single
`runBrewFn` seam that all brew calls and all existing stubbed-`runBrewFn` tests
route through — so the fix is invisible to those tests. Keying on `args[0]` (the
same idiom as `runBrewFn`'s per-subcommand stream wiring) means a future brew
subcommand fails safe to the read-only default rather than silently getting
graceful-cancel it may not want.
**Rejected**: configuring the cmd inline in `runBrewFn` (untestable without a
real brew, or forces duplicating the wiring); a separate mutating-vs-readonly
seam pair (splits the single seam existing tests stub); setting
`HOMEBREW_NO_GITHUB_API=1` (the standard makes it optional — "should also
consider" — and it alters brew behavior beyond this path; the generous bound +
`SIGTERM` already satisfies the SHOULD).
*Introduced by*: `260719-er5k-update-version-standards-conformance`

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
server URL → **`rk url`** (a resolver over explicit `RK_HOST`/`RK_PORT` env →
the pane server's `@rk_origin` tmux option → the `127.0.0.1:3000` default, so
it stays accurate on non-default deployments where panes carry no `RK_*` env;
ecosystem precedent
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

# Plan: Build-time help-dump — emit rk CLI help tree as help/run-kit.json

**Change**: 260602-a36m-help-dump-shll-ai
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Producer: `rk help-dump` subcommand

#### R1: Hidden Cobra subcommand registered on root
The CLI SHALL expose a hidden `help-dump [output-path]` subcommand (`Hidden: true`, `Args: cobra.MaximumNArgs(1)`, `RunE: runHelpDump`) defined in `app/backend/cmd/rk/help_dump.go` (package `main`) and registered in `root.go`'s `init()` alongside the other `rootCmd.AddCommand(...)` calls.

- **GIVEN** a built `rk` binary
- **WHEN** the user runs `rk --help`
- **THEN** `help-dump` does NOT appear in the user-facing command list (it is hidden)
- **AND** `rk help-dump` is still invocable and produces output

#### R2: Output target — stdout or file
The command SHALL write the JSON dump to stdout when no argument is given, and write it to the named file when an optional output-path argument is supplied.

- **GIVEN** the `help-dump` command
- **WHEN** invoked as `rk help-dump` (no arg)
- **THEN** the JSON is written to stdout
- **WHEN** invoked as `rk help-dump out.json`
- **THEN** the JSON is written to file `out.json` using stdlib file I/O with the explicit path (no subprocess, no shell string)

#### R3: Recursive tree walk with filtering
The producer SHALL walk `rootCmd.Commands()` recursively to full depth, capturing children of children. At every recursion level it SHALL exclude: (a) the node named `completion`, (b) the node named `help`, and (c) any node with `cmd.Hidden == true`. A hidden parent's entire subtree is dropped; hidden children of a visible parent are dropped individually. This rule self-excludes `help-dump`.

- **GIVEN** a Cobra command tree containing a `completion` child, a `help` child, a `Hidden` child with its own subtree, and a visible nested parent (e.g. `daemon` with `start`/`stop`/...)
- **WHEN** the walker runs
- **THEN** `completion`, `help`, and the hidden child (with its whole subtree) are absent from the output
- **AND** the visible nested parent appears with its visible children captured to full depth

#### R4: Per-node capture shape
Each captured node SHALL be a struct with JSON tags: `name` ← `cmd.Name()`, `path` ← `cmd.CommandPath()`, `short` ← `cmd.Short`, `usage` ← `cmd.UseLine()`, `text` ← `cmd.UsageString()` (raw, byte-for-byte, newlines preserved — no trimming or reflow), and `commands` ← the recursively captured visible children. `commands` SHALL serialize as an empty JSON array `[]` for a leaf, never `null`.

- **GIVEN** a leaf command (no visible children)
- **WHEN** captured and marshaled
- **THEN** the marshaled JSON contains `"commands":[]`, not `"commands":null`

#### R5: Root node and frozen top-level contract
The top-level object SHALL be `{ "tool": "rk", "version": <string>, "captured_at": <ISO-8601 UTC string>, "schema_version": 1, "root": <Node> }`. `tool` is the literal `"rk"` (invoked binary name). `schema_version` is the integer `1`. `root` is the Node built from `rootCmd` itself (name `"rk"`, path `"rk"`, its visible children under `commands`). The shape is frozen — no added, renamed, or reordered fields beyond this contract (mirrors `sahil87/shll.ai` `help/wt.json`).

- **GIVEN** the dump output
- **WHEN** parsed as JSON
- **THEN** `tool == "rk"`, `schema_version == 1`, `version` is present, and `root.name == "rk"` with `root.path == "rk"`

#### R6: Version from binary, never hardcoded
`version` SHALL be read from the existing `version` package var via `displayVersion()` in `root.go`. Under `-ldflags -X main.version=<v>` it is the real release version; in a plain build/test it is the `dev`/`vdev` sentinel. It SHALL NOT be a hardcoded literal.

- **GIVEN** a binary built with `-ldflags "-X main.version=1.2.3"`
- **WHEN** `rk help-dump` runs
- **THEN** the emitted `version` reflects that ldflags value (i.e. equals `displayVersion()`)

#### R7: Non-deterministic `captured_at`, injectable for tests
`captured_at` SHALL be an ISO-8601 UTC (RFC3339) timestamp at dump time. The timestamp source SHALL be injectable so tests do not assert an exact value: a package-level `var nowUTC = func() time.Time { return time.Now().UTC() }` (overridable in tests) and a pure builder function that takes the version + timestamp as parameters.

- **GIVEN** the producer
- **WHEN** the tree is built with an injected fixed clock
- **THEN** `captured_at` equals the injected value; with the default clock it parses as RFC3339

### CI: release.yml shll.ai PR step

#### R8: Dump + JSON validation against the versioned linux/amd64 binary
`.github/workflows/release.yml` SHALL add a step AFTER the existing `Cross-compile` step that runs `dist/rk-linux-amd64/rk help-dump help/run-kit.json` (the versioned artifact on the `ubuntu-latest` runner) and validates that `help/run-kit.json` parses as JSON, failing the job if it does not (e.g. `jq empty help/run-kit.json`).

- **GIVEN** a release run (triggered by a `v*` tag or `workflow_dispatch`) after Cross-compile produced `dist/rk-linux-amd64/rk`
- **WHEN** the new step runs
- **THEN** `help/run-kit.json` is produced with the real release version and validated as parseable JSON
- **AND** the job fails if the file is not valid JSON

#### R9: Open auto-merge PR into sahil87/shll.ai (not a direct push)
The CI step SHALL commit `help/run-kit.json` into `sahil87/shll.ai` by opening a PR (not a direct push) using the existing `SHLLAI_TOKEN` secret, mirroring the Homebrew-tap step's token-clone pattern: `git clone https://x-access-token:${SHLLAI_TOKEN}@github.com/sahil87/shll.ai.git`, create a fresh head branch off `main`, copy/commit the file with git user `github-actions[bot]`, push, `gh pr create`, then `gh pr merge --auto`. Arguments SHALL be explicit (no shell-string interpolation of untrusted data).

- **GIVEN** the dump produced and validated, with `SHLLAI_TOKEN` configured
- **WHEN** the step runs on a real tag release
- **THEN** a PR is opened against `sahil87/shll.ai` `main` from a fresh head branch with auto-merge enabled, committing `help/run-kit.json`

### Tests

#### R10: Unit tests for the walker
`app/backend/cmd/rk/help_dump_test.go` (package `main`) SHALL unit-test the pure walker, asserting: top-level shape (`tool=="rk"`, `schema_version==1`, version present, root present, Node fields present); filtering (`completion`, `help`, any Hidden node excluded incl. help-dump self-excluding, hidden subtree dropped entirely) — using a synthetic cobra tree AND the real `rootCmd`; recursion to full depth with a leaf marshaling `"commands":[]` not `null`; version equals `displayVersion()` (not a hardcoded literal); `captured_at` parses as RFC3339 (or a fixed injected clock asserted).

- **GIVEN** the test suite
- **WHEN** `just test-backend` runs
- **THEN** all walker assertions pass

### Non-Goals

- The shll.ai-side Astro loader / "Command reference" UI — separate repo, separately tracked (intake §Origin, assumption 13).
- Actually pushing to / opening a PR against `sahil87/shll.ai` during apply — the workflow YAML is authored but NOT executed here (requires `SHLLAI_TOKEN` at CI-run time).

### Design Decisions

1. **`captured_at` injection via package-level `nowUTC` var + pure builder**: `buildDump(version string, now time.Time)` returns the top-level struct; `runHelpDump` supplies `displayVersion()` and `nowUTC()`. — *Why*: keeps the walk a pure, deterministic function of its inputs (testable without process spawn or global time freeze); idiomatic Go seam. — *Rejected*: a `clock` interface (heavier than needed for one call site); freezing global time (test-infra-driven, violates Test Integrity).
2. **Filtering by `Name() == "completion"/"help"` + `Hidden`**: deterministic name + flag checks, applied at every recursion level. — *Why*: matches the intake's exact rule; cobra's auto-generated `completion`/`help` are not `Hidden` so they need explicit name exclusion. — *Rejected*: relying on `IsAvailableCommand()` alone (would not drop `completion`/`help`, which are available).
3. **`commands` initialized as `[]Node{}` (non-nil) for leaves**: guarantees `[]` not `null` in JSON without custom marshaling. — *Why*: frozen contract requires `[]` for leaves; a nil slice marshals to `null`. — *Rejected*: custom `MarshalJSON` (unnecessary complexity).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Create `app/backend/cmd/rk/help_dump.go` (package `main`): define the `Node` struct (`name`/`path`/`short`/`usage`/`text` string tags, `commands []Node` tag) and the top-level `dump` struct (`tool`/`version`/`captured_at` strings, `schema_version` int, `root Node`); add package var `nowUTC = func() time.Time { return time.Now().UTC() }`; implement a pure recursive walker `captureNode(cmd *cobra.Command) Node` that filters `completion`/`help`/`Hidden` children at every level and initializes `commands` as a non-nil `[]Node{}`; implement a pure `buildDump(root *cobra.Command, version string, now time.Time) dump`. <!-- R3 R4 R5 R6 R7 -->
- [x] T002 In `app/backend/cmd/rk/help_dump.go`, define `helpDumpCmd` (`Use: "help-dump [output-path]"`, `Short: "Emit the CLI help tree as JSON (build tooling)"`, `Hidden: true`, `Args: cobra.MaximumNArgs(1)`, `RunE: runHelpDump`) and implement `runHelpDump`: build via `buildDump(rootCmd, displayVersion(), nowUTC())`, marshal with `encoding/json` (indented, following daemon_status.go's encoder style), write to the file at `args[0]` via stdlib `os.WriteFile` when an arg is present, else to `cmd.OutOrStdout()`. <!-- R1 R2 R5 R6 -->
- [x] T003 Register `helpDumpCmd` in `app/backend/cmd/rk/root.go`'s `init()` alongside the existing `rootCmd.AddCommand(...)` calls. <!-- R1 -->

### Phase 2: Tests

- [x] T004 Create `app/backend/cmd/rk/help_dump_test.go` (package `main`): assert top-level shape against the real `rootCmd` (tool=="rk", schema_version==1, version present & equals `displayVersion()`, root.name=="rk"/path=="rk"); build a synthetic cobra tree (with a `completion`-named child, a `help`-named child, a `Hidden` child carrying its own subtree, and a visible nested parent with nested children) and assert filtering + full-depth recursion; assert a leaf's marshaled JSON contains `"commands":[]` and not `"commands":null`; assert help-dump self-excludes from the real tree; inject a fixed `nowUTC` and assert `captured_at` equals it, plus assert default output parses as RFC3339. <!-- R10 R3 R4 R6 R7 -->

### Phase 3: CI

- [x] T005 In `.github/workflows/release.yml`, add a step after `Cross-compile`: run `dist/rk-linux-amd64/rk help-dump help/run-kit.json`, validate with `jq empty help/run-kit.json` (fail otherwise), then clone `sahil87/shll.ai` via `https://x-access-token:${SHLLAI_TOKEN}@github.com/...`, create a fresh head branch off `main` (e.g. `rk-help-dump-<version>`), copy `help/run-kit.json` in, commit as `github-actions[bot]`, push, `gh pr create`, and `gh pr merge --auto` — all with explicit arguments, no untrusted shell-string interpolation. <!-- R8 R9 -->

### Phase 4: Verification

- [x] T006 Run `just test-backend`, then `just build`, then smoke-check the built binary (`./dist/rk help-dump | jq .`) confirming tool=="rk", schema_version==1, root.name=="rk", completion/help absent, and a nested command (`daemon`) present with children. <!-- R1 R2 R3 R5 R8 -->

## Execution Order

- T001 → T002 → T003 (T002 depends on T001's structs/funcs; T003 registers the command from T002)
- T004 depends on T001/T002 (tests the walker + command)
- T005 (CI) is independent of the Go code's internals but assumes the `help-dump` command exists (T002)
- T006 runs last (gates the whole change)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `help_dump.go` defines a hidden `help-dump [output-path]` subcommand and `root.go init()` registers it; `rk --help` omits it while `rk help-dump` works.
- [x] A-002 R2: `rk help-dump` writes JSON to stdout with no arg, and to the named file (via stdlib file I/O, explicit path) when an output-path arg is given.
- [x] A-003 R3: The walker recurses to full depth and excludes `completion`, `help`, and every `Hidden` node (subtree dropped for hidden parents) at every level.
- [x] A-004 R4: Each node carries `name`/`path`/`short`/`usage`/`text` (raw UsageString) and a recursive `commands`.
- [x] A-005 R5: Top-level is `{tool:"rk", version, captured_at, schema_version:1, root}` with `root.name=="rk"`/`root.path=="rk"`; no extra/renamed fields.
- [x] A-006 R6: `version` is sourced from `displayVersion()` (the `version` package var), not hardcoded.
- [x] A-007 R7: `captured_at` is an RFC3339 UTC timestamp produced via the injectable `nowUTC`/pure builder seam.
- [x] A-008 R8: release.yml has a post-Cross-compile step running the dump against `dist/rk-linux-amd64/rk` and validating the JSON, failing the job on invalid JSON.
- [x] A-009 R9: The CI step opens an auto-merge PR (not a direct push) into `sahil87/shll.ai` via `SHLLAI_TOKEN`, mirroring the tap step's token-clone pattern with explicit args.
- [x] A-010 R10: `help_dump_test.go` covers shape, filtering (synthetic + real tree, self-exclusion), full-depth recursion, leaf `"commands":[]` (not null), version-from-binary, and parseable/injected `captured_at`.

### Behavioral Correctness

- [x] A-011 R4: A leaf node marshals to `"commands":[]`, never `"commands":null` (asserted in a test).
- [x] A-012 R3: A synthetic hidden parent's entire subtree is absent from output; a visible parent's hidden child is individually dropped.

### Scenario Coverage

- [x] A-013 R5: The real built binary emits contract-shaped JSON validated by the smoke check (`./dist/rk help-dump | jq .`) — tool/schema_version/root correct, completion/help absent, nested `daemon` present with children.

### Edge Cases & Error Handling

- [x] A-014 R2: A file-write failure (bad path) surfaces as a wrapped error from `RunE` rather than a panic.

### Code Quality

- [x] A-015 Pattern consistency: New Go code follows `cmd/rk/` conventions — `cobra.Command` var + `RunE`, `encoding/json` encoder style as in `daemon_status.go`, struct JSON tags, `init()` registration.
- [x] A-016 No unnecessary duplication: Reuses `displayVersion()` and `rootCmd` rather than reimplementing version/tree logic.
- [x] A-017 Security First (constitution I): The walker is pure in-process Cobra introspection — no `exec`, no subprocess, no shell-string construction; file write uses stdlib `os` with an explicit path. The CI step uses explicit arguments with no untrusted shell-string interpolation.
- [x] A-018 Thin Justfile (constitution VIII): No new justfile logic added (CI-only step; gates use existing `test-backend`/`build` recipes).

## Notes

- **Post-review hardening (review PASS, should-fix applied)**: The shll.ai publish step in `release.yml` was made best-effort after review flagged that `gh pr merge --auto` would hard-fail an otherwise-successful release if shll.ai lacks repo-level auto-merge (should-fix #1), plus same-version re-run and unchanged-help-tree edge cases (should-fix #2). The dump + `jq empty` validation still fail the job (real in-repo defects), but the cross-repo PR/clone/push/merge — which runs *after* the release artifacts, GitHub Release, and Homebrew tap are already produced — now logs a `::warning::` and leaves any PR open for manual merge rather than failing the release. YAML + `bash -n` validated.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `captured_at` injected via package-level `var nowUTC = func() time.Time { return time.Now().UTC() }` + a pure `buildDump(root, version, now)` builder; tests override `nowUTC` | Intake assumption 9 explicitly endorses an injectable clock as the idiomatic, single-obvious-interpretation answer; tests stay deterministic without freezing global time (honors Test Integrity) | S:92 R:85 A:92 D:88 |
| 2 | Confident | shll.ai PR head branch named `rk-help-dump-<version>` off base `main`, mirroring the Homebrew-tap token-clone pattern | Intake assumption 11 (Confident); the tap step is the in-repo precedent and the branch name is a reversible CI detail | S:78 R:80 A:82 D:80 |
| 3 | Certain | JSON encoded indented via `encoding/json` mirroring `daemon_status.go`'s `enc.SetIndent("", "  ")` style | Existing in-repo pattern for JSON-emitting commands; readability + consistency, no contract impact (whitespace-insensitive) | S:88 R:90 A:90 D:85 |
| 4 | Certain | File output uses `os.WriteFile(path, data, 0o644)` with the explicit arg path | Stdlib, matches constitution Security First (no subprocess); 0644 is the conventional non-executable file mode | S:90 R:88 A:90 D:88 |
| 5 | Confident | Smoke check verifies the `daemon` nested command (riff is a leaf — no `AddCommand` calls), per the spec's "riff or daemon" choice | Confirmed by reading riff.go (no subcommands) vs daemon.go (4 children); `daemon` is the genuine nested case | S:85 R:85 A:90 D:82 |

5 assumptions (3 certain, 2 confident, 0 tentative).

# Plan: `rk mux await --ready` narrow-pane verdict + box-drawing-tolerant sentinel match

**Change**: 260906-dm30-await-ready-narrow-pane-verdict
**Intake**: `intake.md`

## Requirements

### Readiness: geometry floor

#### R1: A fixed readiness floor gates the sentinel probe
`internal/inject` MUST export `ReadyMinCols = 80` and `ReadyMinRows = 20`. A pane is **below the floor** when `width < ReadyMinCols || height < ReadyMinRows` (either dimension). The floor MUST NOT be configurable: no settings-registry key, no `RK_*` env var, no flag.

- **GIVEN** a pane reporting 80×20
- **WHEN** the floor decision runs
- **THEN** it is at/above the floor (probe permitted)
- **AND** 79×20, 80×19, and 54×14 are below the floor; 190×44 is above

#### R2: `AwaitReady` classifies a settled below-floor pane as narrow instead of probing
When the capture has settled (non-blank, byte-identical across two consecutive polls) and no agent state is present, `AwaitReady` MUST read the pane geometry via `Tmux.PaneSize` BEFORE `probeReadiness`. Below the floor it MUST return immediately with `*NarrowError{Width, Height}` (wrapping the sentinel `ErrNarrow`) and MUST NOT call `ClearPaneMode`, `SetBuffer`, `PasteBuffer`, or `SendKeys` on that settle. At/above the floor the probe runs exactly as today.

- **GIVEN** a hook-less pane whose screen settles and `PaneSize` returns 54×14
- **WHEN** `AwaitReady` runs
- **THEN** it returns an error satisfying `errors.Is(err, ErrNarrow)` and `errors.As(err, &*NarrowError)` yielding 54/14, before the deadline
- **AND** the fake records no clear-pane-mode / set-buffer / paste-buffer / send-keys calls

#### R3: Agent state wins regardless of geometry
The state signal (`ReadyOpts.State` non-empty, error-free) MUST still return `ReadyByState` first on every poll; the floor gates only the sentinel-probe arm.

- **GIVEN** a pane with agent state present and `PaneSize` returning 54×14
- **WHEN** `AwaitReady` runs
- **THEN** it returns `ReadyByState, nil` and `PaneSize` is never consulted for a verdict

#### R4: A geometry read failure is "not yet", never a classification
A `PaneSize` error at a settle MUST skip the probe for that settle and re-enter polling (bounded by the deadline like every infrastructure failure), unless `opts.IsGone(err)` holds, in which case `AwaitReady` MUST return `ErrGone` promptly.

- **GIVEN** `PaneSize` errors on the first settle and returns 120×40 on a later settle
- **WHEN** `AwaitReady` runs
- **THEN** no probe runs on the first settle and the probe runs on the later one
- **AND GIVEN** the `PaneSize` error matches `IsGone` **THEN** `AwaitReady` returns an error wrapping `ErrGone`

#### R5: Delivery fails closed on narrow
`DeliverWhenReady` MUST NOT call `Engine.Send` when `AwaitReady` returns a narrow classification (an `AwaitReady` error already short-circuits; this requirement pins it with a test and doc comment).

- **GIVEN** a narrow pane
- **WHEN** `DeliverWhenReady` runs
- **THEN** the returned error wraps `ErrNarrow`, the Readiness is the zero value, and the fake records no set-buffer / paste / Enter

### Substrate: pane geometry

#### R6: `tmux.PaneSizeCtx` reads pane geometry with one bounded round trip
`internal/tmux` MUST provide `PaneSizeCtx(ctx, paneID, server) (width, height int, err error)` implemented as `display-message -pt <pane> '#{pane_width}\t#{pane_height}'` through the existing raw-exec seam (argv slice, caller-bounded ctx — Constitution I). A tmux failure passes through untouched (so the "can't find pane" text still satisfies the CLI's gone predicate); unparseable or non-positive dimensions are errors. Geometry MUST NOT be folded into the per-poll `PaneFacts` read.

- **GIVEN** the raw seam returns `54\t14\n`
- **WHEN** `PaneSizeCtx` runs
- **THEN** it returns (54, 14, nil)
- **AND** `0\t14`, `x\t14`, and a tmux error each return a non-nil error (the tmux error verbatim)

#### R7: `PaneSize` is a method of the `inject.Tmux` substrate interface
`inject.Tmux` MUST gain `PaneSize(ctx, paneID, server) (width, height int, err error)`. Every adapter MUST implement it: `cliInjectTmux` (→ `tmux.PaneSizeCtx`), `awaitReadyTmux` (wrapping under `awaitCmdTimeout` like its other reads), `riffInjectTmux` (→ `tmux.PaneSizeCtx`), `agentSendTmux` (→ `tmux.PaneSizeCtx` directly — the daemon never awaits readiness, so no `TmuxOps` seam method is added), and the inject test fake (`sizeW`, `sizeH`, `sizeErr` fields; zero fields MUST read as at/above the floor so existing readiness tests keep their verdicts unchanged).

- **GIVEN** the change compiles
- **WHEN** `go vet ./...` and `go test ./...` run in `app/backend`
- **THEN** every `inject.Tmux` implementer satisfies the interface and every pre-existing readiness/send test passes without edits to its expectations

### CLI: the `narrow` report

#### R8: `rk mux await --ready` reports `narrow %N (WxH)`
On an `ErrNarrow` classification `runMuxAwaitReady` MUST print exactly `narrow %N (WxH)\n` to stdout, exit 0, and write a stderr hint naming the observed geometry and the `80x20` floor with the remedy (resize or relocate the pane and re-run) that survives `--quiet`. `--notify` MUST fire with the default message `agent %N is narrow`. Narrow MUST return immediately and MUST break the `--timeout 0` re-arm loop (like `parked`/`gone`).

- **GIVEN** the readiness seam returns `&inject.NarrowError{Width: 54, Height: 14}`
- **WHEN** `rk mux await %5 --ready --notify` runs
- **THEN** stdout is `narrow %5 (54x14)\n`, exit 0, stderr contains `54x14` and `80x20`, and one notification `agent %5 is narrow` is recorded
- **AND GIVEN** `--quiet` **THEN** the stderr hint is still present
- **AND GIVEN** `--timeout 0` **THEN** the command returns on narrow instead of re-arming

#### R9: Help and header text enumerate the new verdict
The `mux_await.go` file header, `Long` text, and `--ready` flag usage MUST list `narrow %N (WxH)` alongside `ready`/`parked`, state it exits 0, and extend the composition warning to "`parked` and `narrow` also exit 0, so `&&`-composers must branch on the report word".

- **GIVEN** `rk mux await --help`
- **WHEN** the output is read
- **THEN** it names `narrow %N (WxH)`, the 80×20 floor, and the extended composition warning

### Normalization: frame-glyph-tolerant probe

#### R10: `stripForProbe` also drops box-drawing and block-element runes
`stripForProbe` MUST remove every rune in U+2500–U+259F in addition to ANSI escapes and all whitespace. Because `Needle`, `CountOccurrences`, `verifySubmit`, `clearToBaseline`, and `probeReadiness` share this one normalization, needle and capture stay under one rule automatically. The sentinel text `#rk-ready-probe` is unchanged.

- **GIVEN** the capture `│ > #rk-ready-   │\n│ probe          │`
- **WHEN** `CountOccurrences(capture, "#rk-ready-probe", false, false)` runs
- **THEN** it returns 1
- **AND GIVEN** a stale `#rk-ready-probe` line above the wrapped echo **THEN** it returns 2 (novelty counting intact)
- **AND** runes outside the ranges — `>`, `#`, CJK, emoji — are retained

#### R11: Chip matching is unaffected and a frame-only message fails closed
`pasteCollapseRe` and `imageCollapseRe` contain no rune in U+2500–U+259F, so a chip rendered inside a bordered composer MUST still match. `Needle` MUST skip a last line that strips to empty (a pure frame row such as `└────┘`) and take the previous non-empty line; a message consisting only of frame glyphs yields an empty needle and `Engine.Send` MUST fail closed with `ProbeFailure` before touching the buffer.

- **GIVEN** the message `hello\n└────┘`
- **WHEN** `Needle` runs
- **THEN** the needle derives from `hello`
- **AND GIVEN** the message `└────┘` **THEN** `Engine.Send` returns `ProbeFailure` with no set-buffer call

### Docs: skill pages and help surfaces

#### R12: Skill pages teach `narrow`
`docs/site/skill/messaging.md` (report table row, the "`booting` never returns" sentence, the `&&` warning), `docs/site/skill/mux.md` (`--ready` example and paragraph), and `docs/site/skill.md` (the `--ready` report-word list) MUST name `narrow %N (WxH)`, the 80×20 floor, and the exit-0 posture; `scripts/sync-skill.sh` MUST be run so `app/backend/cmd/rk/skill/` matches the source, and both are committed.

- **GIVEN** `rk skill messaging` after the change
- **WHEN** the report table is read
- **THEN** it has a `narrow %N (WxH)` row whose "Your move" is resize/relocate then re-run

### Non-Goals

- fab-kit's dispatch geometry (not carving a worker column below a floor, opening a manually sized window instead) — in flight in parallel in fab-kit; rk supplies only the mechanical word
- Any resize performed by rk, any change to tmux `window-size` handling, any change to the relay's client sizing
- A `TmuxOps.PaneSize` seam method on the daemon — the daemon never awaits readiness (see Design Decisions)
- Changing the sentinel text or probe pacing

### Design Decisions

#### Narrow is a geometry verdict, not a wall
**Decision**: a settled below-floor pane returns `NarrowError`/`ErrNarrow` — a third typed verdict beside `ParkedError`/`ErrParked` — and the CLI prints a distinct first token `narrow`.
**Why**: the probe cannot be trusted at that geometry (a bordered composer reflows or is not drawn), so "no echo" carries no information about walls. A caller branching on `parked` would answer a wall that does not exist; the true remedy (resize/relocate) is only actionable if named.
**Rejected**: folding the geometry into the `parked` snippet — the frozen first-token contract is what scripts branch on, and `parked` already means "judge the wall".
*Introduced by*: 260906-dm30-await-ready-narrow-pane-verdict

#### The floor is a fixed constant gating only the probe arm
**Decision**: `ReadyMinCols`/`ReadyMinRows` are exported Go constants (80×20), checked only at the settle-triggered probe entry; the state signal is unaffected.
**Why**: 80×20 is the conventional minimum agent TUIs assume; hooks firing prove the TUI is up regardless of size; constitution IV/settings-home forbids a new env var and a settings key would be a knob nobody should turn.
**Rejected**: a `ReadyOpts` field or config key — surface area with no caller.
*Introduced by*: 260906-dm30-await-ready-narrow-pane-verdict

#### `PaneSize` lives on the `Tmux` interface, not an optional reader
**Decision**: `inject.Tmux` gains `PaneSize`; every adapter implements it.
**Why**: fail-closed by construction — an optional `ReadyOpts` reader that a consumer forgets to wire would silently fall open to the old false-`parked` behavior.
**Rejected**: `ReadyOpts.Size func(...)` (the `State`/`IsGone` pattern) — those are optional by design; the floor is not.
*Introduced by*: 260906-dm30-await-ready-narrow-pane-verdict

#### The daemon adapter calls `tmux.PaneSizeCtx` directly
**Decision**: `agentSendTmux.PaneSize` calls `tmux.PaneSizeCtx` rather than a new `TmuxOps.PaneSize` seam method.
**Why**: the daemon never reaches `AwaitReady`; the method exists for interface satisfaction only. A seam method would touch `router.go`, the `TmuxOps` interface, and every api test fake for a path no daemon route executes.
**Rejected**: `TmuxOps.PaneSize` — seam consistency for dead code is not worth the churn; if a daemon route ever awaits readiness, lift it to the seam then.
*Introduced by*: 260906-dm30-await-ready-narrow-pane-verdict

## Tasks

### Phase 1: Setup

- [x] T001 Add `PaneSizeCtx(ctx, paneID, server) (int, int, error)` to `app/backend/internal/tmux/pane_target.go` next to `PanePIDCtx` (one `display-message -pt <pane> '#{pane_width}\t#{pane_height}'` via `tmuxExecRawServer`; tmux error verbatim; non-positive/unparseable → error), with a parse test in `app/backend/internal/tmux/pane_target_test.go` through the existing raw-exec test seam (valid `54\t14`, `0\t14`, garbage, tmux-error passthrough) <!-- R6 -->

### Phase 2: Core Implementation

- [x] T002 In `app/backend/internal/inject/ready.go` add the exported `ReadyMinCols`/`ReadyMinRows` constants, unexported `belowReadyFloor(w, h int) bool`, `ErrNarrow`, and `NarrowError{Width, Height}` (Error/Unwrap mirroring `ParkedError`); in `app/backend/internal/inject/inject.go` add `PaneSize` to the `Tmux` interface; in `app/backend/internal/inject/inject_test.go` give `fakeTmux` `sizeW`, `sizeH`, `sizeErr` fields and a `PaneSize` method that records `pane-size` and returns a size at/above the floor when both fields are zero <!-- R1, R7 -->
- [x] T003 In `AwaitReady` (`app/backend/internal/inject/ready.go`) insert the geometry read at the settle trigger, after the state check and before `probeReadiness`: `PaneSize` error → `IsGone` ⇒ wrap `ErrGone`, else skip the probe this settle; below floor ⇒ return `&NarrowError`; otherwise probe as today. Update the `ready.go` header, `AwaitReady`, and `DeliverWhenReady` doc comments to list the third verdict <!-- R2, R3, R4, R5 -->
- [x] T004 [P] Widen `stripForProbe` in `app/backend/internal/inject/inject.go` to drop runes in U+2500–U+259F and update its doc comment (wrap-safe including TUI-reflowed borders); confirm `pasteCollapseRe`/`imageCollapseRe` contain no rune in that range and that `Needle`'s empty-line skip plus `Engine.Send`'s empty-needle guard cover the frame-only message <!-- R10, R11 -->
- [x] T005 [P] Implement `PaneSize` on every adapter: `cliInjectTmux` in `app/backend/cmd/rk/mux_send.go` (→ `tmux.PaneSizeCtx`), `awaitReadyTmux` in `app/backend/cmd/rk/mux_await.go` (wrap under `awaitCmdTimeout` like `CapturePane`), `riffInjectTmux` in `app/backend/internal/riff/deliver.go` (→ `tmux.PaneSizeCtx`), `agentSendTmux` in `app/backend/api/send.go` (→ `tmux.PaneSizeCtx` directly, with a comment stating the daemon never awaits readiness) <!-- R7 -->
- [x] T006 In `app/backend/cmd/rk/mux_await.go` add the `errors.Is(err, inject.ErrNarrow)` case to `runMuxAwaitReady` between parked and gone (stdout `narrow %N (WxH)`, exit 0, stderr hint with geometry + `80x20` floor + remedy, ungated by `--quiet`); update the file header comment, `Long` text, and `--ready` flag usage per R9 <!-- R8, R9 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Add readiness tests in `app/backend/internal/inject/ready_test.go`: `TestBelowReadyFloor` (80×20 ok, 79×20, 80×19, 54×14 narrow, 190×44 ok), `TestAwaitReadyNarrowSkipsProbe` (settled + 54×14 → `ErrNarrow`, `errors.As` 54/14, no clear/set-buffer/paste/send-keys calls, returns before deadline), `TestAwaitReadyStateBeatsNarrow`, `TestAwaitReadySizeErrorRePolls` (size error first settle → no probe; later settle probes), `TestAwaitReadySizeErrorGone`, `TestDeliverWhenReadyNarrowSkipsSend`; and normalization tests in `app/backend/internal/inject/inject_test.go`: `TestStripForProbeDropsFrameGlyphs`, `TestCountOccurrencesWrappedInBorder` (both R10 fixtures), `TestNeedleFrameOnlyLineSkipped`, `TestSendFrameOnlyMessageFailsClosed`, and a chip-inside-border regression pin for `pasteCollapseRe`/`imageCollapseRe` <!-- R1, R2, R3, R4, R5, R10, R11 -->
- [x] T008 Add CLI tests in `app/backend/cmd/rk/mux_await_test.go` following `TestMuxAwaitReadyParked`: `TestMuxAwaitReadyNarrow` (stdout `narrow %5 (54x14)\n`, exit 0, stderr contains `54x14` and `80x20`, notify `agent %5 is narrow`), `TestMuxAwaitReadyNarrowQuiet`, `TestMuxAwaitReadyNarrowBreaksIndefiniteLoop` (`--timeout 0`); run the package with `env -u TMUX -u TMUX_PANE go test ./cmd/rk/...`; check `help_dump_test.go` for any pinned `--ready` help text and update the golden if one exists <!-- R8, R9 -->

### Phase 4: Polish

- [x] T009 Update `docs/site/skill/messaging.md` (report-table row, "`booting` never returns" sentence, `&&` warning), `docs/site/skill/mux.md` (`--ready` example + paragraph), and `docs/site/skill.md` (`--ready` report-word list) to name `narrow %N (WxH)`, the 80×20 floor, and exit 0; run `scripts/sync-skill.sh` and verify `app/backend/cmd/rk/skill/` matches <!-- R12 -->
- [x] T010 Run the gates from `app/backend`: `go vet ./...`, `go test ./...` (with `env -u TMUX -u TMUX_PANE` for `./cmd/rk/...`), and `rk mux await --help` from a fresh `go build` to eyeball the Long text; sweep the diff for change-ID / R# / T# comments in src and tests (provenance belongs to git) <!-- R7, R9 -->

## Execution Order

- T001 and T002 block T003 and T005 (they define `PaneSizeCtx` and the interface method)
- T004 is independent of T001–T003
- T006 depends on T002 (`ErrNarrow`/`NarrowError`)
- T007/T008 follow their implementation tasks; T009/T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `inject.ReadyMinCols == 80` and `inject.ReadyMinRows == 20` are exported; `belowReadyFloor` treats either dimension below its floor as narrow, with no config key, env var, or flag
- [x] A-002 R2: `AwaitReady` returns `*NarrowError` wrapping `ErrNarrow` for a settled 54×14 hook-less pane without any probe-side tmux calls on that settle
- [x] A-003 R6: `tmux.PaneSizeCtx` exists, uses one `display-message -pt` argv-slice round trip under the caller's ctx, and rejects non-positive/unparseable dimensions while passing tmux errors through verbatim
- [x] A-004 R7: `inject.Tmux` declares `PaneSize`, and `cliInjectTmux`, `awaitReadyTmux`, `riffInjectTmux`, `agentSendTmux`, and the inject test fake all implement it
- [x] A-005 R8: `rk mux await %5 --ready` prints exactly `narrow %5 (54x14)\n` on stdout with exit 0 when the seam returns `NarrowError{54, 14}`
- [x] A-006 R10: `stripForProbe` removes every rune in U+2500–U+259F and retains all other non-whitespace runes
- [x] A-007 R12: the three skill-page sources name `narrow %N (WxH)`, the 80×20 floor, and the exit-0 posture, and `app/backend/cmd/rk/skill/` is byte-identical to the synced output

### Behavioral Correctness

- [x] A-008 R3: with agent state present and a 54×14 pane, `AwaitReady` returns `ReadyByState`
- [x] A-009 R4: a `PaneSize` error skips the probe for that settle and a later at/above-floor settle probes normally; a `PaneSize` error matching `IsGone` returns an error wrapping `ErrGone`
- [x] A-010 R5: `DeliverWhenReady` on a narrow pane returns the zero Readiness with an error wrapping `ErrNarrow` and never calls `Engine.Send`
- [x] A-011 R8: the narrow stderr hint (geometry, `80x20`, remedy) is present under `--quiet`, `--notify` records `agent %5 is narrow`, and `--timeout 0` returns on narrow instead of re-arming
- [x] A-012 R9: `rk mux await --help` names `narrow %N (WxH)`, states it exits 0, and carries the extended "`parked` and `narrow` also exit 0" composition warning; the file header comment enumerates the verdict

### Scenario Coverage

- [x] A-013 R10: `CountOccurrences` returns 1 for the wrapped-in-border fixture and 2 when a stale sentinel line precedes it
- [x] A-014 R11: `pasteCollapseRe`/`imageCollapseRe` still match a chip rendered inside a bordered composer; `Needle("hello\n└────┘")` derives from `hello`; `Engine.Send` of a frame-glyph-only message returns `ProbeFailure` with no set-buffer call
- [x] A-015 R7: every pre-existing `internal/inject`, `cmd/rk`, `internal/riff`, and `api` test passes with unchanged expectations (the fake's zero size reads as above the floor)

### Edge Cases & Error Handling

- [x] A-016 R1: boundaries 79×20 and 80×19 are narrow; 80×20 is not
- [x] A-017 R6: `PaneSizeCtx` returns an error for `0\t14` and for non-numeric output, and returns the tmux "can't find pane" error text unchanged
- [x] A-018 R2: a narrow verdict returns before the `AwaitReady` deadline (it is wake-worthy, not a spin-to-timeout)

### Code Quality

- [x] A-019 Pattern consistency: new code follows the `PanePIDCtx`, `ParkedError`, and `awaitReadyTmux` wrapping patterns of the surrounding files
- [x] A-020 No unnecessary duplication: geometry parsing lives only in `tmux.PaneSizeCtx`; normalization lives only in `stripForProbe`
- [x] A-021 Subprocess discipline: all new tmux calls go through `internal/tmux` with `exec.CommandContext`-backed helpers and caller-bounded contexts (no shell strings, no inline tmux construction)
- [x] A-022 Tests cover the added behavior (R1–R11) with colocated `*_test.go`; `cmd/rk` tests verified under `env -u TMUX -u TMUX_PANE`
- [x] A-023 No comment narration or provenance markers: no change IDs, R#/T#/A-# references, or PR numbers in src or test comments; comments state invariants only
- [x] A-024 Magic numbers named: the floor appears only as the two exported constants; the Unicode range bounds are named or commented at their single use

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is additive (a third readiness verdict, one substrate read, wider probe normalization) and makes no existing file, function, branch, or config redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `agentSendTmux.PaneSize` calls `tmux.PaneSizeCtx` directly instead of adding `TmuxOps.PaneSize` (the intake's alternative, chosen over its primary) | The daemon never awaits readiness; a seam method would churn `router.go` and every api fake for dead code. `api/send.go` already imports `internal/tmux` | S:80 R:90 A:85 D:75 |
| 2 | Certain | The geometry read happens once per settle (not per poll), immediately before `probeReadiness` | Intake §1/§2 and the settle-is-a-trigger design; keeps `PaneFacts` lean | S:90 R:90 A:95 D:90 |
| 3 | Certain | The fake's zero `sizeW`/`sizeH` reads as above the floor | Preserves every existing readiness test verdict without edits (intake §2) | S:90 R:95 A:95 D:90 |
| 4 | Confident | The Unicode range is one contiguous check `0x2500 <= r && r <= 0x259F` covering Box Drawing and Block Elements together | The two blocks are adjacent; one comparison is clearer than two named ranges | S:80 R:90 A:90 D:85 |
| 5 | Confident | No help-dump golden regeneration is needed unless `help_dump_test.go` pins the exact `--ready` help text (checked during T008) | `help-dump` publishes `UsageString`; intake §5 defers the check to apply | S:70 R:85 A:80 D:75 |
| 6 | Confident | `PaneSizeCtx` factors its parse into a pure `parsePaneSize` (the `parsePaneFacts` pattern) unit-tested by table, plus a real-server round-trip test — the "existing raw-exec test seam" the plan names does not exist as a stub; `internal/tmux` tests run against real isolated servers | There is no exec-stub seam in `internal/tmux`; the pure-parser split is the package's own testability idiom | S:80 R:90 A:85 D:80 |
| 7 | Confident | The `--timeout 0` re-arm loop's inner await call gets a package-var seam (`muxAwaitReadyOnceFn`) so the narrow-breaks-the-loop pin runs tmux-free | `muxAwaitReadyFn` calls `inject.AwaitReady` directly (not stubbable); the var-seam is the file's own testability idiom (`muxAwaitDepsFn`, `muxReadyBufferNameFn`) | S:75 R:85 A:80 D:75 |

7 assumptions (2 certain, 5 confident, 0 tentative).

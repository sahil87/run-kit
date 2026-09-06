# Intake: `rk mux await --ready` narrow-pane verdict + box-drawing-tolerant sentinel match

**Change**: 260906-dm30-await-ready-narrow-pane-verdict
**Created**: 2026-09-06

## Origin

Promptless dispatch from `/fab-proceed` (create-new path, `{questioning-mode} = promptless-defer`). The description was synthesized from an operator conversation on 2026-09-06 and is the sole source; no other change folder was consulted.

> **Title:** `rk mux await --ready` narrow-pane verdict + box-drawing-tolerant sentinel match
>
> **Problem observed (2026-09-06).** A fab pane-mode dispatch carved a kimi worker into a 54×14 pane (the window was 127×16 because tmux sizes a window to its most recent viewing client, and the user was viewing from a phone). The kimi TUI's bordered composer reflowed to ~17 columns. `rk mux await --ready %N` reported `parked %N`. The orchestrator spent three diagnostic round trips before guessing geometry, moving the worker to a manually sized 190×44 window, after which it went `ready`.
>
> **Root cause in rk.** `stripForProbe` in `app/backend/internal/inject/inject.go` normalizes captures by stripping ANSI escapes and ALL whitespace, which is wrap-safe for tmux soft-wrap but not for a TUI that reflows its bordered composer: `│ #rk-ready- │` / `│ probe │` strips to `│#rk-ready-│││probe│`, so `CountOccurrences(capture, readySentinel)` never exceeds the baseline. No echo on a settled screen is classified `parked` by `probeReadiness` in `app/backend/internal/inject/ready.go` (see ParkedError / ErrParked). At 14 rows the TUI may also not draw the composer at all, giving the same verdict. Either way the report word is wrong: the pane is not behind a wall, it is too small.
>
> **What changes (two parts, both in rk):** (1) a geometry-aware readiness verdict — read `#{pane_width}`/`#{pane_height}` before the sentinel probe, classify below 80×20 as **narrow** (new report word `narrow %N (WxH)`, exit 0, stderr hint; `ErrNarrow` wrapping `NarrowError{Width, Height}`; `ReadyByState` still wins first; geometry read failures are "not yet"; help text + `rk skill messaging`/`rk skill mux` report-word tables + `rk mux send --await` composition guidance document `narrow`; the `inject.Tmux` interface gains a `PaneSize` accessor implemented in the existing CLI adapter); (2) a frame-glyph-tolerant sentinel match — `stripForProbe` also drops Unicode box-drawing (U+2500–U+257F) and block elements (U+2580–U+259F), uniformly for the readiness probe and the engine's echo probe / verifySubmit / clearToBaseline; confirm `pasteCollapseRe` / `imageCollapseRe` do not depend on those runes; sentinel text `#rk-ready-probe` unchanged.
>
> **Explicitly out of scope.** The dispatch-side fix (not splitting a worker column below a floor, opening a manually sized window instead) lives in fab-kit and is being done in parallel by another agent; rk only supplies the mechanical `narrow` classification. No change to tmux `window-size` handling, no resize performed by rk, no change to the relay's client sizing.
>
> **Constraints / conventions.** Go backend; all tmux calls through `internal/tmux` with `exec.CommandContext`; tests colocated (`*_test.go`) — cover the pure geometry decision, the `narrow` verdict path in `AwaitReady`/`DeliverWhenReady` (fail-closed), the CLI report word and exit code in `cmd/rk/mux_await_test.go`, and the `stripForProbe` box-drawing case with a wrapped-in-border fixture. Verify new cmd/rk tests with `env -u TMUX -u TMUX_PANE`. Affected memory: `docs/memory/run-kit/agent-messaging.md`, `docs/memory/run-kit/agent-send.md`, and `docs/specs/agent-messaging.md` if it enumerates report words. Change type `feat`.

Key decisions carried from the description (all treated as settled): the 80×20 floor values; `narrow` exits 0 with the same posture as `parked`; state-present wins over geometry; the floor gates only the sentinel-probe arm; no new config key and no new `RK_*` env var; the dispatch-side fix is fab-kit's and out of scope here.

## Why

**The pain point.** `rk mux await --ready` is the mechanical half of the spawn-then-deliver readiness standard (`docs/specs/agent-messaging.md` § Spawn and trust walls): rk classifies, the caller judges. Its vocabulary today is `ready` / `parked` / `running` / `gone`. A pane that is too small for its TUI to draw a usable composer produces exactly the evidence `parked` is defined by — a settled, non-blank screen that does not echo the sentinel — so the classifier emits `parked`, and the caller's judgment loop (`fab dispatch ready`'s judgment rounds, a human reading the snippet) goes looking for a trust dialog that is not there. On 2026-09-06 that cost three diagnostic round trips and a manual window relocation before the orchestrator guessed geometry. The report word was not merely unhelpful, it was **wrong**: `parked` means "behind a wall, answer it with a keystroke", and no keystroke fixes a 54×14 pane.

**Two independent mechanisms produce the false `parked`.** (a) At a legal-but-tight width the TUI's bordered composer wraps the sentinel across rows, and each wrapped row carries frame glyphs (`│`), so after `stripForProbe` the capture reads `│#rk-ready-│││probe│` and `strings.Count` for `#rk-ready-probe` never rises above the pre-probe baseline. (b) Below some height the TUI may not draw the composer at all, so nothing echoes regardless of matching. Mechanism (a) is a normalization bug the probe can fix by ignoring frame glyphs. Mechanism (b) is a geometry fact the probe cannot see through — the honest answer is a distinct verdict, not a better guess.

**What happens if we do nothing.** Every caller of the readiness gate (fab's pane-mode dispatch, `rk operator` / `rk tutorial` kickoffs, riff's typed task delivery) keeps misreading small panes as walls. fab-kit is fixing its dispatch geometry in parallel, but the gate is a public standard used by hand-composed `rk mux await --ready %5 && rk mux send --force %5 …` pipelines too, and phone-sized viewing clients shrink windows on every remote-use session — the exact use case rk exists for. Any Go consumer of `DeliverWhenReady` that receives `parked` today would receive a wrong wall diagnosis with no hint that resizing is the remedy.

**Why this approach.** A `narrow` verdict keeps the spec's layering intact: classification stays mechanical and rk-owned (pane geometry is a substrate fact read from tmux at request time — Constitution II), judgment stays caller-side (rk never resizes or relocates anything — the caller decides where the worker should live). Expressing it as a typed error (`ErrNarrow` / `NarrowError`, the `ParkedError` shape) means every existing consumer fails closed with zero signature churn — the memory's "Parked is a typed error, not a Readiness value" decision applies verbatim. Making `stripForProbe` frame-glyph-tolerant fixes mechanism (a) at its single normalization site, which the readiness probe and the engine's echo probe / `verifySubmit` / `clearToBaseline` all share, so baseline and verification captures keep one normalization. Fixed constants (80×20) rather than a setting honor Constitution IV / VII (no new config key, no new `RK_*` env var; the value is the conventional minimum agent TUIs assume and has no per-instance reason to vary).

**Rejected alternatives.** Reporting `parked` with a geometry hint on stderr (an automated composer like `DeliverWhenReady` never reads stderr; `&&`-composers branch on the report word). Having rk resize the pane or open a bigger window (that is dispatch policy — fab-kit's, and out of scope). A `Narrow` `Readiness` value (a naive consumer would deliver into the pane). Making the floor configurable (no per-instance reason to vary; settings-home rule forbids a new env var and the registry carve-out is for preferences, not probe internals). Stripping frame glyphs only in the readiness probe (the engine's echo probe suffers the same wrapped-in-border miss on a tight pane and every capture must share one normalization).

## What Changes

### 1. `internal/tmux`: pane geometry read

Add to `app/backend/internal/tmux/pane_target.go` (the `PanePIDCtx` pattern — one `display-message -pt` round trip, argv slice, caller-bounded context):

```go
// PaneSizeCtx reads the pane's current geometry (#{pane_width} x #{pane_height})
// on the given server, bounded by the caller's context. A tmux failure (e.g.
// the pane does not exist) is returned as the error; an unparseable or
// zero dimension is an error too (tmux always reports positive sizes for a
// live pane).
func PaneSizeCtx(ctx context.Context, paneID, server string) (width, height int, err error)
```

Implementation: `tmuxExecRawServer(ctx, server, "display-message", "-pt", paneID, "#{pane_width}\t#{pane_height}")`, trim the trailing newline only, split on the tab, `strconv.Atoi` both; `w <= 0 || h <= 0` → error. The "can't find pane" error text passes through untouched so the CLI's `IsGone` predicate (substring match) keeps working. Do **not** fold the fields into `PaneFacts` — that read runs every 600 ms poll for the state signal; geometry is read once per settle, immediately before a probe would run.

### 2. `internal/inject`: geometry floor, `narrow` verdict, `PaneSize` on the substrate interface

**Constants** (exported so callers and tests reference the same floor; `ready.go`):

```go
// ReadyMinCols / ReadyMinRows are the readiness floor: the conventional
// minimum geometry agent TUIs assume. Below either, a bordered composer
// reflows or is not drawn at all, so the sentinel echo probe cannot be
// trusted — the pane is classified narrow instead of probed.
const (
	ReadyMinCols = 80
	ReadyMinRows = 20
)
```

Pure decision helper: `func belowReadyFloor(width, height int) bool { return width < ReadyMinCols || height < ReadyMinRows }` (unexported; unit-tested at the boundaries 79/80 and 19/20, and with zero/negative values treated as narrow only if they ever reach it — the tmux layer already rejects them).

**Sentinel error + typed carrier** (mirroring `ErrParked` / `ParkedError`):

```go
// ErrNarrow is the sentinel NarrowError wraps: the pane is below the readiness
// floor, so the sentinel probe cannot be trusted and delivery must not proceed.
// An error (not a Readiness) so every consumer fails closed — no delivery into
// a pane whose composer may not exist.
var ErrNarrow = errors.New("pane below readiness floor")

// NarrowError carries the observed geometry so the caller can report and act
// (resize/relocate); rk classifies mechanically, never resizes.
type NarrowError struct{ Width, Height int }

func (e *NarrowError) Error() string {
	return fmt.Sprintf("%s: %dx%d (floor %dx%d)", ErrNarrow, e.Width, e.Height, ReadyMinCols, ReadyMinRows)
}
func (e *NarrowError) Unwrap() error { return ErrNarrow }
```

**Substrate interface.** `Tmux` gains one method, implemented by every adapter (the daemon's `agentSendTmux`, `cliInjectTmux` / `awaitReadyTmux`, `riffInjectTmux`, and the test `fakeTmux`):

```go
// PaneSize reports the pane's current width and height in cells. Only the
// readiness path calls it (the engine never does); a failure is "not yet",
// never fatal — see AwaitReady.
PaneSize(ctx context.Context, paneID, server string) (width, height int, err error)
```

Placing it on the interface (rather than an injected `ReadyOpts` reader like `State`/`IsGone`) is deliberate: the floor must be **fail-closed by construction** for every present and future `AwaitReady` / `DeliverWhenReady` consumer; an optional reader that a consumer forgets to wire would silently fall open. Adapter implementations: `cliInjectTmux.PaneSize` → `tmux.PaneSizeCtx`; `awaitReadyTmux.PaneSize` wraps it under `awaitCmdTimeout` like its other reads; `riffInjectTmux.PaneSize` → `tmux.PaneSizeCtx`; `agentSendTmux.PaneSize` delegates to a new `TmuxOps.PaneSize(ctx, paneID, server)` on the daemon seam (`api/router.go`), whose production implementation is `tmux.PaneSizeCtx` — the daemon never reaches `AwaitReady`, so this is interface satisfaction plus seam consistency, and the api test fakes gain a stub. `fakeTmux` gains `sizeW, sizeH int` and `sizeErr error` fields (default 0×0 → the test helper returns a size at/above the floor unless a test sets one below it, so every existing readiness test keeps its verdict without edits).

**`AwaitReady` control flow** — the geometry check sits exactly at the probe trigger, after the state check, and nowhere else:

```
every poll:
  ctx cancelled → ctx.Err()
  opts.State present (non-empty, no error) → ReadyByState        (unchanged: state wins regardless of size)
  capture; if settled (non-blank, byte-identical to previous poll):
      w, h, err := t.PaneSize(ctx, paneID, server)
      err != nil: isGone(err) → ErrGone; otherwise "not yet" — re-enter polling (no probe this settle)
      belowReadyFloor(w, h) → return 0, &NarrowError{w, h}      (immediate, wake-worthy — like parked)
      else → probeReadiness(...) exactly as today
  deadline → ErrNotReady
```

A geometry read failure never classifies and never runs the probe on that settle (the probe's trustworthiness is unknown) — the next settle re-reads, bounded by the deadline like every other infrastructure failure. `narrow` is returned immediately: it does not spin to the deadline, and the `--timeout 0` re-arm loop in `cmd/rk/mux_await.go` breaks on it exactly as on `parked`/`gone`. `DeliverWhenReady` needs no code change beyond its doc comment — an `AwaitReady` error already short-circuits before `Engine.Send` — but a dedicated test proves a narrow pane is never delivered into. Update the `AwaitReady` / `DeliverWhenReady` doc comments and the `ready.go` header to list the third verdict.

### 3. `internal/inject`: frame-glyph-tolerant `stripForProbe`

Extend the single normalization site so it drops, in addition to ANSI escapes and all whitespace, every rune in the Unicode **Box Drawing** block (U+2500–U+257F) and **Block Elements** block (U+2580–U+259F):

```go
// stripForProbe normalizes a string for echo matching: strip ANSI escapes, then
// remove ALL whitespace (spaces, tabs, newlines) and every box-drawing /
// block-element rune (U+2500–U+259F). Wrap-safe by construction — including a
// TUI composer that reflows its own border around the wrapped text, whose
// frame glyphs would otherwise interleave the needle.
func stripForProbe(s string) string {
	s = ansiEscapeRe.ReplaceAllString(s, "")
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' {
			continue
		}
		if r >= 0x2500 && r <= 0x259F {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
```

Because `Needle`, `CountOccurrences`, `verifySubmit`'s frame comparison, `clearToBaseline`, and `probeReadiness`'s settled-vs-after-guard comparisons all route through this one function, needle and capture stay under one normalization automatically — a user message whose last line contains `├──` gets the same glyphs removed from both sides. Verified consequences to pin in tests: `pasteCollapseRe` (`\[Pastedtext#\d+(?:\+\d+lines?)?\]`) and `imageCollapseRe` (`\[Image#\d+\]`) contain no rune in the stripped ranges, so chip matching is unaffected; `Needle` already skips lines that strip to empty, so a message whose last line is a pure frame row (`└────┘`) takes the previous non-empty line; a message consisting **only** of frame glyphs now yields an empty needle and `Engine.Send`'s existing empty-needle guard fails closed with `ProbeFailure` before touching the buffer (previously such a message could "echo" — the new behavior is the safe one and is documented, not special-cased). The sentinel `#rk-ready-probe` is unchanged.

Fixture for the wrapped-in-border case (a 17-column composer as observed):

```
│ > #rk-ready-   │
│ probe          │
```

`CountOccurrences(fixture, "#rk-ready-probe", false, false)` must return 1 after the change (0 before). A second fixture with a stale `#rk-ready-probe` already on screen plus the wrapped echo must return 2 (novelty counting intact).

### 4. `cmd/rk/mux_await.go`: the `narrow` report

`runMuxAwaitReady` gains a case between `parked` and `gone`:

```go
case errors.Is(err, inject.ErrNarrow):
	// Narrow is wake-worthy and returns immediately: the pane is below the
	// readiness floor, so the probe cannot be trusted. Classification
	// succeeded, so this is a report (exit 0), not a failure; the geometry
	// and the remedy ride stderr ungated (--quiet drops chatter, never
	// actionable diagnostics — the parked-snippet rule).
	var narrow *inject.NarrowError
	size := ""
	if errors.As(err, &narrow) {
		size = fmt.Sprintf(" (%dx%d)", narrow.Width, narrow.Height)
		fmt.Fprintf(cmd.ErrOrStderr(), "pane %s is %dx%d, below the %dx%d readiness floor — resize or relocate the pane and re-run\n",
			paneID, narrow.Width, narrow.Height, inject.ReadyMinCols, inject.ReadyMinRows)
	}
	line = fmt.Sprintf("narrow %s%s", paneID, size)
```

Contract: stdout is exactly `narrow %5 (54x14)\n` (report word first — the frozen first-token contract; the geometry parenthetical mirrors `ready %N (state|echo)`), exit 0, the hint on stderr surviving `--quiet`. `--notify` fires with the default message `agent %5 is narrow` (the existing first-token derivation needs no change). The `muxAwaitReadyFn` re-arm loop (`--timeout 0`) already returns on any non-`ErrNotReady` error, so `narrow` breaks it without code change — pin with a test. The `Long` help text and the `--ready` flag usage list `narrow %N (WxH)` alongside `ready`/`parked`, state that it exits 0 like `parked`, and extend the composition warning: "`parked` and `narrow` also exit 0, so `&&`-composers must branch on the report word." Update the file header comment's report enumeration.

### 5. Skill pages and help surfaces

Source of truth is `docs/site/skill/` (synced into `app/backend/cmd/rk/skill/` by `scripts/sync-skill.sh`; edit the source, run the sync, commit both):

- `docs/site/skill/messaging.md` § Spawn and trust walls — add a row to the report table: `narrow %N (WxH)` | The pane is below the 80×20 readiness floor (either dimension), so the probe cannot be trusted; nothing was typed. Exit 0 — classification succeeded; the geometry and remedy are on stderr | Resize or relocate the pane (a bigger window or column), then re-run `await --ready`. Update the "`booting` never returns" sentence to end on `ready`, `parked`, `narrow`, `gone`, or timeout, and the `&&`-branching warning to name `narrow`.
- `docs/site/skill/mux.md` — the `--ready` example line and the `--ready` paragraph gain `narrow %5 (54x14)`, the floor, the exit-0 posture, and the branching note.
- `docs/site/skill.md` line listing the `--ready` report words — add `narrow %N (WxH)`.
- `rk mux send --await` composition guidance wherever it enumerates `parked` (the `mux_await.go` Long text and the two skill pages above) names `narrow` in the same breath.

The `help-dump` surface publishes `UsageString`, so the Long text edit is the help-dump change; no separate golden needs regenerating unless a test pins the exact `--ready` help text (check `cmd/rk/help_dump_test.go` and `mux_await_test.go` during apply).

### 6. Consumers (no behavior change required, verified by tests)

`rk operator` / `rk tutorial` kickoffs (`agent_kickoff.go` → `DeliverWhenReady`) and riff's typed task delivery (`internal/riff/deliver.go`) already treat any readiness error as a degrade (stderr paste-it-yourself note carrying `err.Error()`); `NarrowError.Error()` carries `WxH (floor 80x20)`, so their notes become geometry-explicit for free. Their adapters gain `PaneSize` (Section 2). No new branching.

### 7. Tests

- `internal/inject/ready_test.go`: `TestBelowReadyFloor` (table: 80×20 ok, 79×20 narrow, 80×19 narrow, 54×14 narrow, 190×44 ok); `TestAwaitReadyNarrowSkipsProbe` (settled frame + fake size 54×14 → `errors.Is(err, ErrNarrow)`, `errors.As` yields 54/14, **no** `SetBuffer`/`PasteBuffer`/`ClearPaneMode` calls recorded, returns before the deadline); `TestAwaitReadyStateBeatsNarrow` (state present + 54×14 → `ReadyByState`); `TestAwaitReadySizeErrorRePolls` (size read error on the first settle → no probe that poll, probe runs on a later settle once size reads ≥ floor); `TestAwaitReadySizeErrorGone` (size error matching `IsGone` → `ErrGone`); `TestDeliverWhenReadyNarrowSkipsSend` (mirrors `TestDeliverWhenReadyParkedSkipsSend`).
- `internal/inject/inject_test.go`: `TestStripForProbeDropsFrameGlyphs` (box-drawing + block elements removed, other symbols such as `│`-adjacent `>` and `#` retained, CJK/emoji untouched); `TestCountOccurrencesWrappedInBorder` (the two fixtures in Section 3); `TestNeedleFrameOnlyLineSkipped`; a regression pin that `pasteCollapseRe`/`imageCollapseRe` matching is unchanged for a chip rendered inside a bordered composer.
- `cmd/rk/mux_await_test.go`: `TestMuxAwaitReadyNarrow` (stub `muxAwaitReadyFn` returning `&inject.NarrowError{54, 14}` → stdout `narrow %5 (54x14)\n`, exit 0, stderr contains `54x14` and `80x20`, `--notify` message `agent %5 is narrow`); `TestMuxAwaitReadyNarrowQuiet` (hint survives `--quiet`); `TestMuxAwaitReadyNarrowBreaksIndefiniteLoop` (`--timeout 0` returns on narrow rather than re-arming). Run the package under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/...` (ambient tmux env has produced false greens).
- `internal/tmux/pane_target_test.go`: `PaneSizeCtx` parse test through the existing raw-exec seam (valid `54\t14`, zero/garbage → error, "can't find pane" passthrough).
- `api/` fakes: `TmuxOps.PaneSize` stub so the package compiles; no behavior test (the daemon never awaits readiness).

## Affected Memory

- `run-kit/agent-messaging`: (modify) `rk mux await --ready` gains the `narrow %N (WxH)` report word (exit 0, stderr geometry hint, immediate return, breaks the `--timeout 0` re-arm, `--notify` default `agent %N is narrow`); the readiness section's control flow (state → settle → geometry floor → probe); the composition warning ("`parked` and `narrow` also exit 0"); new Design Decision entries — "Narrow is a geometry verdict, not a wall" and "The readiness floor is a fixed constant (80×20), gating only the probe arm"; update the frontmatter `description` (`ready %N (state|echo)` / `parked %N` / `narrow %N (WxH)`).
- `run-kit/agent-send`: (modify) § Send Path probe normalization — `stripForProbe` now also drops U+2500–U+259F, applied uniformly to needle, capture, `verifySubmit`, and `clearToBaseline`; the frame-only-message fail-closed consequence; the `inject.Tmux` interface is now seven methods (`PaneSize` added — readiness-only, engine never calls it).
- `run-kit/agent-state`: (modify) § Boot-Ready Signal — one sentence adding the geometry floor between the state signal and the sentinel probe (the section cross-references `AwaitReady`).
- `run-kit/architecture`: (modify) the `internal/inject` row ("six-method interface" → seven; `ready.go` verdict list gains `NarrowError`/`ErrNarrow` and the `ReadyMinCols`/`ReadyMinRows` floor) and the `mux` row's `--ready` report enumeration.
- `docs/specs/agent-messaging.md` (spec, human-curated — hydrate proposes, does not silently edit): § Spawn and trust walls report list and the frozen report-word contract list both enumerate `parked`; `narrow` belongs in both.

## Impact

- **Code**: `app/backend/internal/inject/ready.go` (floor consts, `ErrNarrow`/`NarrowError`, geometry check at the probe trigger, doc comments), `app/backend/internal/inject/inject.go` (`Tmux.PaneSize`, `stripForProbe` ranges + doc), `app/backend/internal/tmux/pane_target.go` (`PaneSizeCtx`), `app/backend/cmd/rk/mux_send.go` (`cliInjectTmux.PaneSize`), `app/backend/cmd/rk/mux_await.go` (`awaitReadyTmux.PaneSize`, the `narrow` case, help text, header comment), `app/backend/internal/riff/deliver.go` (`riffInjectTmux.PaneSize`), `app/backend/api/send.go` + `app/backend/api/router.go` (`agentSendTmux.PaneSize`, `TmuxOps.PaneSize`) plus the api and inject test fakes.
- **Docs/help**: `docs/site/skill/messaging.md`, `docs/site/skill/mux.md`, `docs/site/skill.md` → synced to `app/backend/cmd/rk/skill/` via `scripts/sync-skill.sh`; `rk mux await` Long/flag help (help-dump surface).
- **Behavior contract**: one new first-token report word on a frozen-contract surface (`narrow`), additive — existing words keep their meaning and exit codes. Callers that branch on `parked` today will start seeing `narrow` for small panes; that is the point, and fab-kit's parallel dispatch change is the primary consumer.
- **Cross-repo**: fab-kit's `fab dispatch ready` delegates classification to `rk mux await --ready` when a sentinel-capable rk is on PATH; it will need a `narrow` row in its report table (fab-kit's change, in flight in parallel — this intake only guarantees the mechanical word and exit code). Older fab versions that do not know `narrow` see an unfamiliar exit-0 word; their existing "unknown report" handling applies. Not blocking.
- **Performance**: one extra `display-message` per settle (not per poll) on the `--ready` path only; `Engine.Send` is untouched apart from the pure normalization change (a range check per rune — negligible).
- **Risk**: the wider `stripForProbe` slightly increases the chance that two distinct captures normalize equal (frames differing only in box-drawing glyphs are now "unchanged" to `verifySubmit`/`clearToBaseline`); a redraw that changes only the border is not a submit signal, so this is acceptable, but the apply agent must keep the whitespace-only semantics for everything outside U+2500–U+259F.

## Open Questions

- None blocking. The apply agent should confirm during implementation whether any existing test pins the exact `--ready` help text or the `inject.Tmux` method count (memory says "six-method interface"; the architecture row is in Affected Memory).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Readiness floor is fixed at 80 columns × 20 rows, exposed as `inject.ReadyMinCols` / `inject.ReadyMinRows`; either dimension below the floor is narrow; no config key, no `RK_*` env var | Description states the values, the "either" rule, and the constitution IV / settings-home constraint verbatim | S:95 R:90 A:90 D:90 |
| 2 | Certain | The geometry check runs only at the probe trigger (after the state check, when the capture has settled), so `ReadyByState` always wins regardless of size and a churning narrow pane times out `running` rather than reporting `narrow` | Description: "the floor gates only the sentinel-probe arm"; matches the existing settle-is-a-trigger design | S:90 R:85 A:90 D:85 |
| 3 | Certain | `narrow` surfaces as a typed error `NarrowError{Width, Height}` wrapping sentinel `ErrNarrow`, mirroring `ParkedError`/`ErrParked`, so `DeliverWhenReady` and every Go consumer fail closed with no signature change | Description names the shape; memory DD "Parked is a typed error, not a Readiness value" supplies the precedent | S:95 R:90 A:95 D:95 |
| 4 | Certain | CLI report is `narrow %N (WxH)` on stdout, exit 0, geometry + remedy hint on stderr ungated by `--quiet`; `--notify` default `agent %N is narrow`; returns immediately and breaks the `--timeout 0` re-arm loop like `parked`/`gone` | Description fixes the word, format, and exit posture; the stderr-ungated and re-arm behaviors are the existing `parked` rules applied unchanged | S:90 R:90 A:90 D:90 |
| 5 | Confident | `PaneSize` is added to the `inject.Tmux` interface (implemented by `cliInjectTmux`/`awaitReadyTmux`, `riffInjectTmux`, `agentSendTmux`, `fakeTmux`) rather than as an optional `ReadyOpts` reader | Description says the interface "gains whatever accessor is needed"; an optional reader a consumer forgets to wire would silently fall open, defeating "every consumer fails closed"; cost is one stub per adapter | S:75 R:85 A:85 D:65 |
| 6 | Confident | The daemon adapter `agentSendTmux` satisfies `PaneSize` via a new `TmuxOps.PaneSize` seam method (production → `tmux.PaneSizeCtx`), keeping the daemon's single-seam discipline even though the daemon never awaits readiness | Follows the adapter's existing "everything through TmuxOps" shape; direct `internal/tmux` call would be a one-line alternative if the seam churn is judged excessive | S:50 R:90 A:75 D:60 |
| 7 | Certain | Geometry is read by a new `tmux.PaneSizeCtx` (one `display-message -pt %N '#{pane_width}\t#{pane_height}'` round trip, argv slice, caller-bounded ctx), not folded into `PaneFacts` | `PanePIDCtx` is the exact precedent; `PaneFacts` is the per-poll state read and must stay lean; Constitution I (argv slices, context timeouts) | S:85 R:90 A:95 D:85 |
| 8 | Confident | A geometry read failure at a settle is "not yet": no probe that settle, re-enter polling (an `IsGone` match returns `ErrGone`); the probe is not run on unknown geometry | Description: "geometry read failures are 'not yet' (never fatal)"; running the probe blind would reintroduce the false `parked`; persistent size-read failure with working captures is practically impossible (same tmux mechanism) | S:70 R:90 A:80 D:65 |
| 9 | Certain | `stripForProbe` drops U+2500–U+257F and U+2580–U+259F in addition to ANSI + whitespace, at the single normalization site shared by `Needle`, `CountOccurrences`, `verifySubmit`, `clearToBaseline`, and `probeReadiness`; sentinel text unchanged | Description specifies the ranges and the uniform application; code reading confirms one call site normalizes both needle and capture | S:95 R:85 A:95 D:95 |
| 10 | Certain | `pasteCollapseRe` / `imageCollapseRe` are unaffected (no rune in the stripped ranges), and a frame-glyph-only message now yields an empty needle that `Engine.Send`'s existing guard fails closed as `ProbeFailure` — documented, not special-cased | Verified by reading both regexes and the `needle == ""` guard at `Engine.Send` entry | S:85 R:90 A:95 D:90 |
| 11 | Certain | Skill-page edits go to `docs/site/skill/{messaging,mux}.md` and `docs/site/skill.md` (source), then `scripts/sync-skill.sh` regenerates `app/backend/cmd/rk/skill/`; both are committed | `skill.go` and `sync-skill.sh` document the source→embed direction | S:80 R:95 A:95 D:95 |
| 12 | Confident | `rk operator` / `rk tutorial` / riff consumers need no new branching: their degrade paths print `err.Error()`, which now carries `WxH (floor 80x20)` | Code reading of `deliverAgentKickoff` callers and `deliverCliTask`; the description asks only that they fail closed | S:70 R:90 A:75 D:80 |
| 13 | Certain | Change type is `feat` (new report word = new behavior contract), pinned explicitly if inference disagrees | Description states it; `_intake` Step 6 procedure | S:90 R:95 A:95 D:95 |
| 14 | Certain | Out of scope: fab-kit dispatch geometry, tmux `window-size`, any resize by rk, relay client sizing | Description's explicit exclusions | S:95 R:90 A:95 D:95 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).

# Intake: Operator Omnibox Focus Height Jitter

**Change**: 260908-qgfk-operator-omnibox-focus-height-jitter
**Created**: 2026-09-08

## Origin

> Operator dispatch (bug report): "Whenever you try to press Command-J and focus the Quake
> terminal input box on the top navbar, the top navbar jumps in height. This is because the
> height of the input box in focus and non-focus mode is different. That should not be the
> case. There should be no jitter on the UI. Either we match the size of focus and non-focus
> mode or let the navbar accommodate the higher size, whatever looks like the correct UX."

Iterative UX feedback on the operator console top-bar surfaces (qa85/PR #839, #866, #868;
memory: `docs/memory/run-kit/ui/operator-console.md`, `operator-console-quake-feedback.md`).

## Why

1. **Problem**: `OperatorOmnibox`'s standing box (`components/operator-omnibox.tsx`) had no
   fixed height — its vertical size was purely content-derived (`py-0.5` + children). At rest
   the tallest child is the 16px-line-height input/icon row. Once the box engages (⌘J or focus)
   *and* a chat-subject context is attached, `OperatorContextChip` (`compact`) mounts inside it
   for the first time — and its dismiss button carried a `min-h-[24px] min-w-[24px]` fine-pointer
   floor, taller than the box's own ~22px content height. That forced the whole box (and with it
   the shared top-bar row, since nothing else in the row was tall enough to set an independent
   floor above the box) to grow only while the console was open, then shrink back on blur/close —
   the reported jitter.
2. **Consequence if unfixed**: every ⌘J open/close (or any focus/blur on the box) reflows the top
   bar, a visible layout shift on a control the user reaches for constantly.
3. **Why this approach**: the codebase already has a shared bar control height convention
   (`--ctl-h-bar`, 28px fine / 40px coarse — `src/globals.css`, `components/control.tsx`), used by
   the top-bar crumbs and icon buttons. Pinning the omnibox box to that same fixed height in both
   states (rather than leaving it content-derived, or inflating the *rest* state to match the
   occasional chip-attached case) keeps the fix consistent with the existing design system and
   avoids permanently taller idle chrome for the common case where no chip is attached. The only
   other change needed to make the fixed height hold without visual overflow is narrowing the
   *compact*-only dismiss button back down to its natural (line-height-driven) size — its 24px
   fine floor was already an outlier discovered while tracing this bug: no other element inside
   the box carries an explicit min-height, and the button never actually needed one on a
   fine-pointer device once it renders inside a fixed-height row (the `coarse:` 40px touch floor is
   untouched, so real touch/coarse-pointer accessibility is unaffected).

## What Changes

### `app/frontend/src/components/operator-omnibox.tsx`

- The standing box wrapper's className: `py-0.5` → `h-[28px]` (matching `--ctl-h-bar`). Height is
  now identical between `rest` and `engaged` — the box literally cannot resize on focus/blur.
  Doc comment updated to state the invariant explicitly (mounting the context chip must never
  jitter the bar).

### `app/frontend/src/components/operator-context-chip.tsx`

- The dismiss (`✕`) button's className: the fine-pointer `min-w-[24px] min-h-[24px]` floor is now
  conditional — applied only when `compact` is false (the full-size compose-strip mount keeps the
  existing floor unchanged). The `compact` (omnibox) mount drops it, so the button sizes to its
  content (matching the icon/input's own 16px line-height) and fits inside the box's fixed 28px
  height with room to spare. The `coarse:min-w-[40px] coarse:min-h-[40px]` touch floor is
  unchanged in both cases.

### Verification performed

- Existing suites all pass unchanged: `operator-omnibox.test.tsx` (19), `compose-strip.test.tsx`
  (127 — the compose-strip's non-compact chip mount), `top-bar.test.tsx` (120).
- Box-model math confirmed empirically with a throwaway Playwright harness reproducing the exact
  Tailwind classes (rest and engaged-with-attached-subject states): row/box height held constant
  at 28px across both states after the fix, chip content (22px) and dismiss button (16px) fit
  comfortably inside the box's interior budget with no overflow. Harness was scratch-only, not
  committed.

## Affected Memory

- `run-kit/ui/visual-design` (modify) — the Touch Targets § stray-tappables list named the
  operator context-chip ✕ as unconditionally carrying the 24px fine / 40px coarse floor; that's
  now only true for its non-`compact` (compose-strip) mount. Flagged by review; corrected inline
  (`docs/memory/run-kit/ui/visual-design.md` § Touch Targets).

## Impact

- `app/frontend/src/components/operator-omnibox.tsx`, `app/frontend/src/components/operator-context-chip.tsx`.
- No test files needed changes (existing assertions target className *substrings* like
  `w-[12ch]`/`w-[34ch]`/`border-border`, none of which this touches).
- No API, state-machine, or session-lifecycle changes — purely a CSS sizing fix.
- No new dependencies.

## Open Questions

(none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin the omnibox box to the existing `--ctl-h-bar` fixed height (28px fine / matching the top-bar's own control-height convention) rather than inventing a new size | The top bar already has an established fixed-height vocabulary (`components/control.tsx`, `src/globals.css`) used by crumbs and icon buttons; reusing it is the "match the sizes" branch of the user's own framing and keeps the box visually consistent with its row neighbors | S:80 R:95 A:100 D:95 |
| 2 | Certain | Fix at the `h-[28px]` fine-pointer size only; do not add a `coarse:h-[40px]` companion | The box currently has no coarse-specific sizing at all (a pre-existing, separate gap for coarse/touch desktop pointers unrelated to the reported bug); adding full coarse support here would be scope creep beyond the reported jitter, which reproduces on the common fine-pointer desktop case | S:65 R:85 A:90 D:80 |
| 3 | Certain | Narrow `OperatorContextChip`'s dismiss-button fine floor only for its `compact` (omnibox) mount, leaving the full-size compose-strip mount's 24px floor untouched | `compact` is already the prop this exact call site uses to distinguish the slim omnibox mount from the roomier compose-strip mount; scoping the floor removal to `compact` avoids touching the non-omnibox usage's accessibility floor at all | S:75 R:90 A:95 D:90 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).

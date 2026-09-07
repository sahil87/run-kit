# Intake: Operator Console Collapse Fixes

**Change**: 260907-jp91-operator-console-collapse-icon
**Created**: 2026-09-07

## Origin

> Operator dispatch (bug report, desktop dashboard, screenshot attached): "the x on the top right of the operator is misleading. It's actually collapse, not close. Need better icon."

One-shot dispatch, expanded mid-session as two follow-up bug reports on the same component (user chose to fold both into this change rather than open separate ones):

1. "does clicking outside the quake terminal collapse the terminal? (It should)" — confirmed it does not (a deliberate `open` state ignores blur, but nothing else dismisses it either); user asked for it.
2. "the opacity setting of the quake terminal isn't working - I see it as fully opaque right now. In the opacity setting, allow changing from 0.5 to 1" (later clarified: "or 50% to 100%") — the setting works, but its clamp range (0.75–1.0) is narrow enough that the visible effect is subtle; user wants the floor lowered to 0.5.

## Why

1. **Problem**:
   - The header `✕` button implies the button destroys/terminates the console session. It doesn't — `onClick` (`setConsoleMachineState("rest")`) only slides the drawer shut and unmounts the React panel; the underlying agent/tmux session lives server-side and keeps running regardless.
   - The open drawer is a "peek" that survives blur by design, but nothing else dismisses it either — there's no outside-click affordance, which breaks the "quake terminal" mental model most users bring to a pull-down drawer (click away to dismiss).
   - The opacity slider's clamp (0.75–1.0) leaves too little visible range for the effect to read as working — a user moving it can reasonably perceive "full opacity" regardless of where the slider sits.
2. **Consequence if unfixed**: the console's affordances keep misleading users about what they do (or fail to do), undermining trust in the operator console's UI.
3. **Why this approach**:
   - Icon: reuse the existing `CollapsiblePanel` chevron convention (`▼`) rather than inventing a new icon or pulling in an icon library — this codebase deliberately has no icon-library dependency, and bare Unicode glyphs are the established pattern for both dismiss (`✕`) and collapse (`▼`) affordances.
   - Outside-click: reuse the existing `isOperatorConsoleTarget`/`OPERATOR_CONSOLE_ROOT_ATTR` marker (already applied to both the drawer and the top-bar omnibox for an analogous purpose — recognizing console-owned paste/drop events) rather than inventing a new "is this inside the console" mechanism.
   - Opacity: a pure constant change (`CONSOLE_OPACITY_MIN`), no new mechanism needed.

## What Changes

### `app/frontend/src/components/operator-console.tsx`

- Header button: `✕` → `▼` (matches `CollapsiblePanel`'s collapse-indicator convention); `aria-label` `"Close operator console"` → `"Collapse operator console"`. `onClick` (`() => setConsoleMachineState("rest")`) is unchanged — it was already non-destructive, only the label/icon were misleading.
- New effect: while `machine === "open"`, a **capture-phase** `click` listener on `document` collapses the console (`setConsoleMachineState("rest")`) whenever the click target is not `isOperatorConsoleTarget` (i.e., outside both the drawer and the top-bar omnibox).
  - **Capture phase is load-bearing, not a style choice**: it runs this check *before* any entry-point trigger's own `onClick` (the top-bar ◉ button's open⇄rest toggle, a sidebar pinned row's retarget-to-another-server). Those triggers live outside the console's own DOM and would otherwise be misread as "outside clicks." Because capture-then-bubble for one native `click` event is fully synchronous (no React re-render can land in between), those triggers' own handlers still run afterward within the same dispatch and unconditionally re-assert the correct state (the button recomputes its toggle off the pre-collapse `machineRef`, a retarget unconditionally sets `"open"` with the new server) — so the outside-collapse never outlives a legitimate trigger's own intent. Verified with a test that simulates a real DOM click on an external retarget trigger.
- Doc-comment updates describing the new outside-click behavior and renaming "close affordance" → "collapse affordance" in the anatomy paragraph.

### `app/frontend/src/lib/operator-console.ts`

- `CONSOLE_OPACITY_MIN`: `0.75` → `0.5`. `clampConsoleOpacity`'s doc comment updated to match. No other logic changes — `CONSOLE_OPACITY_DEFAULT` (0.9) and `CONSOLE_OPACITY_MAX` (1.0) are untouched.

### `app/frontend/src/components/settings-dialog.tsx`

- `ConsoleOpacityControl`'s doc comment updated (0.75–1.0 → 0.5–1.0); the slider's `min`/`max` already derive from the shared constants, so no JSX change is needed.

### Tests updated to match

- `app/frontend/src/lib/operator-console.test.ts`: `clampConsoleOpacity` test's expected clamp floor (0.75 → 0.5) and its probe values.
- `app/frontend/src/components/settings-dialog.test.tsx`: slider `min` attribute assertion (0.75 → 0.5).
- `app/frontend/src/components/operator-console.test.tsx`: three new tests — outside click collapses the open drawer, a click inside the drawer does not, and a real DOM click on an external retarget trigger wins over the outside-collapse (validates the capture-phase ordering claim above).

Full frontend unit suite passing (3823 tests) after all edits.

## Affected Memory

(none — implementation-only UI fixes; no spec-level behavior change)

## Impact

- `app/frontend/src/components/operator-console.tsx`, `app/frontend/src/lib/operator-console.ts`, `app/frontend/src/components/settings-dialog.tsx`, plus their three test files.
- No API, session-lifecycle, or registry changes. The console machine's state-transition semantics are extended (a new dismiss path into `"rest"`) but not altered for existing paths (Esc, the ◉ button, chord, palette/pinned-row triggers all behave exactly as before).
- No new dependencies.

## Open Questions

(none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse the `▼` (U+25BC) glyph from `CollapsiblePanel`'s existing collapse-indicator convention rather than introducing a new icon or icon library | Codebase has zero icon-library dependencies; every existing collapse/dismiss affordance is a bare Unicode glyph; `CollapsiblePanel` is the only existing "collapse" (non-destructive hide) precedent in the codebase | S:70 R:95 A:100 D:100 |
| 2 | Certain | Leave the header button's `onClick` handler unchanged — only the glyph and aria-label change | Confirmed via code trace: the handler already only hides/unmounts the drawer UI, never touches the underlying session; behavior already matched "collapse" semantics, only the label was wrong | S:80 R:100 A:100 D:95 |
| 3 | Certain | Outside-click collapses straight to `"rest"` (same destination as the header button), not a partial step to `"focused"` | Matches the user's stated expectation ("clicking outside... should [collapse]") and the header button's own destination — a partial step would leave the omnibox focused with no visible drawer, an inconsistent halfway state | S:75 R:90 A:95 D:90 |
| 4 | Certain | Use a capture-phase `document` `click` listener gated on `isOperatorConsoleTarget`, reusing the existing `OPERATOR_CONSOLE_ROOT_ATTR` marker, rather than inventing a new containment check or tagging every entry-point trigger element | The marker already spans exactly the console's own interactive DOM (drawer + omnibox); capture phase is the specific mechanism that lets external triggers (top-bar button, pinned row) safely re-assert their own intent within the same synchronous click dispatch — verified by a real-DOM-click test | S:60 R:85 A:90 D:85 |
| 5 | Certain | Widen `CONSOLE_OPACITY_MIN` from 0.75 to 0.5; leave default (0.9) and max (1.0) untouched | Directly specified by the user ("0.5 to 1" / "50% to 100%"); the slider's min/max already derive from the shared constant so no JSX change is needed beyond the doc-comment corrections | S:90 R:100 A:100 D:100 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).

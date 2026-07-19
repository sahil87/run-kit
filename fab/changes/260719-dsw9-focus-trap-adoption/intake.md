# Intake: Dialog and CommandPalette Adopt useFocusTrap

**Change**: 260719-dsw9-focus-trap-adoption
**Created**: 2026-07-20

## Origin

Backlog item `[dsw9]` (fab/backlog.md), processed by an autonomous backlog-sweep agent:

> Refactor dialog.tsx and command-palette.tsx to consume the shared useFocusTrap hook — it was extracted from their focus-cycle logic but is currently adopted only by the mobile sidebar drawer.

Validity verified against current code: `useFocusTrap` (`app/frontend/src/hooks/use-focus-trap.ts`) is consumed only by `shell.tsx:94` (mobile drawer). `dialog.tsx:17-50` hand-rolls the identical trap; `command-palette.tsx` has its own partial focus handling.

## Why

1. **Pain point**: three implementations of the same modal focus contract. `dialog.tsx` duplicates the hook byte-for-byte in spirit (same FOCUSABLE selector string, Escape→close, Tab wrap with first/last + preventDefault, focus-first-on-mount, stable callback ref). `command-palette.tsx` implements a *weaker* variant: Escape only fires from the input's own `onKeyDown` (misses Escape when focus is on an option button), and there is no Tab wrap at all — Tab can walk focus out of the `role="dialog" aria-modal="true"` palette, violating the aria-modal contract the hook exists to enforce.
2. **Consequence of not fixing**: fixes to the trap (like the `hasNestedDialog` stand-down added for nested modals) land in the hook but not in the hand-rolled copies, so the three surfaces drift.
3. **Approach**: consume the hook. Dialog is a mechanical swap. CommandPalette adds a container ref and lets the hook own Escape + Tab + initial focus, keeping its list-navigation keys (ArrowUp/ArrowDown/Enter) on the input.

## What Changes

### 1. `Dialog` (`app/frontend/src/components/dialog.tsx`)

- Delete the hand-rolled `handleKeyDown` callback, the `onCloseRef` plumbing, and the mount effect (lines ~13-50).
- Replace with: `useFocusTrap(dialogRef, true, onClose)` — Dialog only mounts while open, so `active` is the constant `true`. The hook reproduces all current behavior: focus first focusable on mount, Escape → `onClose` (latest closure via the hook's internal ref), Tab/Shift+Tab wrap using the identical FOCUSABLE selector.
- `dialogRef` stays on the same `role="dialog"` div (the hook needs `RefObject<HTMLElement | null>`; the existing `useRef<HTMLDivElement>(null)` satisfies it).
- Behavior delta (accepted): while a *nested* `aria-modal` dialog is open inside a Dialog, the outer Dialog's trap stands down (`hasNestedDialog`) — Dialogs are leaf modals today, so this is unreachable; it's the hook's correct semantics if one ever nests.

### 2. `CommandPalette` (`app/frontend/src/components/command-palette.tsx`)

- Add `const paletteRef = useRef<HTMLDivElement>(null)` attached to the modal div (`role="dialog" aria-modal="true"`, line ~102).
- Call `useFocusTrap(paletteRef, open, () => setOpen(false))`.
- Remove the `Escape` branch from the input's `handleKeyDown` (the hook now owns Escape at document level — works even when focus is on an option row). Keep ArrowDown/ArrowUp/Enter on the input unchanged.
- Remove the `useEffect(() => { if (open) inputRef.current?.focus(); }, [open])` effect — the hook focuses the first focusable in the container on activation, and the `<input>` is the container's first focusable (it precedes the option buttons in the DOM). Keep `inputRef` itself (used elsewhere? verify — if only used by that effect, remove it too).
- Behavior deltas (intended improvements): Escape now closes the palette regardless of which element inside it has focus; Tab/Shift+Tab now wrap within the palette instead of escaping the modal.
- The `Cmd+K` open/toggle listener and `palette:open` event listener are untouched.

### 3. Hook doc comment (`app/frontend/src/hooks/use-focus-trap.ts`)

- Update the stale line "Mirrors the focus-cycle contract proven in `dialog.tsx` / `command-palette.tsx`" — after this change those components *consume* the hook; rephrase to name current consumers (Shell drawer, Dialog, CommandPalette).

### 4. Tests

- `command-palette.test.tsx` exists — its "closes on Escape" test (line ~109) fires Escape on the input; must keep passing (hook listens on `document`, keydown bubbles — verify in jsdom). Add a case: Escape closes when focus is on an option button, and Tab wraps from last option back to the input.
- `dialog.tsx` has no dedicated test file. Add `dialog.test.tsx` covering: renders title/children, Escape calls onClose, Tab wraps at boundaries, first focusable receives focus on mount (this locks the migrated behavior).
- Existing consumers of Dialog (kill-dialog, create-session-dialog, tmux-commands-dialog, spawn-agent-dialog) have their own tests exercising Escape/close paths — run the frontend suite to confirm no regression.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Mobile drawer focus trap — the "adopted by the drawer" / "(matches Dialog/CommandPalette)" wording updates to: the hook is the single trap consumed by Shell drawer, Dialog, and CommandPalette; palette gains document-level Escape + Tab wrap.

## Impact

- `app/frontend/src/components/dialog.tsx` (−~35 lines), `command-palette.tsx` (net small), `hooks/use-focus-trap.ts` (comment only), new `dialog.test.tsx`, extended `command-palette.test.tsx`.
- Runtime deltas are strictly a11y improvements on the palette (documented above); Dialog behavior is preserved.

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Dialog swap is `useFocusTrap(dialogRef, true, onClose)` with the hand-rolled logic deleted | Hook logic is line-for-line the same contract (verified by reading both) | S:80 R:90 A:95 D:90 |
| 2 | Confident | Palette lets the hook own Escape + initial focus; keeps Arrow/Enter keys on the input; input remains first focusable so hook's focus-first lands on it | DOM order verified (input precedes options); hook comment says it mirrors the palette's contract | S:70 R:85 A:85 D:75 |
| 3 | Confident | Palette Tab-wrap + document-level Escape are accepted behavior *changes* (a11y fixes), not regressions to avoid | aria-modal="true" already promises modality; the hook enforces what the markup claims | S:65 R:80 A:80 D:70 |
| 4 | Confident | Add dialog.test.tsx (none exists); extend command-palette.test.tsx | code-quality.md requires tests for changed behavior; locking the migrated trap prevents silent drift | S:60 R:90 A:85 D:80 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved).

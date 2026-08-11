# Intake: Split-Menu Keycaps + Compose Chip Placement & Hint

**Change**: 260811-0f3d-split-menu-keycaps-compose-hint
**Created**: 2026-08-11

## Origin

> merged. Small micro suggestions - send a follow on PR for these. 1) Show the keyboard shortcuts here [screenshot: Open button hover tip "Open in VS Code"] and here [screenshot: Split chevron menu with "Split horizontal" / "Split vertical" rows]. 2) Make compose text the right most button (Swap cmd-K and compose text). Give a hint about the compose text button on the free space on the right. [screenshot: bottom bar with `>_` then `⌘K`, large empty space to the right]

Follow-on to the just-merged `260811-ke2s-hidden-feature-education-microcopy` (PR #551). Conversational; three screenshots anchored the requests. Verified against merged main before drafting:

- **Screenshot 1 (Open tip) is ALREADY DONE on main**: `open-button.tsx:123` carries `kbd={openLastUsedChord}` on the primary Tip (shipped in #551). The user's screenshot came from a stale running build — this item is explicitly OUT of scope; the user will see it after restarting/updating their instance.
- **Screenshot 2 (Split cluster) is genuinely missing**: in `top-bar.tsx` the SplitButton's hover Tips (`Split horizontally`, `Split… (choose direction)`) carry no `kbd`, and the two menu rows (`Split horizontal`, `Split vertical`) render no keycaps — despite registry bindings existing (`split-horizontal`: ⇧\ default / ⌘D on mac; `split-vertical`: ⇧- default / ⇧⌘D on mac, per `lib/keybindings.ts:176-177`).
- **Screenshot 3 (bottom bar)**: the right chip pair renders `>_` (compose) THEN `⌘K` (palette) — user wants them swapped so compose is rightmost — and the free space right of the pair (fine pointers, wide viewports) is unused education space.

## Why

Direct continuation of the education-micro-copy program: the split-pane chords and the compose strip are exactly the "almost nobody knows" features that motivated #551. The Split menu is a discovery surface (people open it to find the action) — showing the chord on the rows/tips converts every menu open into a shortcut lesson at zero cost. The bottom-bar swap puts the higher-touch control (compose) at the end-of-row position the user reaches for, and the dead space beside it becomes a one-line pointer to the compose feature itself — the single feature the user called out as unknown ("About the Compose text box"). Without this, the pattern #551 established stays inconsistently applied and the two surfaces the user personally hunted for stay silent.

## What Changes

All in `app/frontend/src/components/`. Follow the established § Education micro-copy convention (now documented in `docs/memory/run-kit/ui-patterns.md` after #551): chords for rebindable actions derived from `useKeybindings().byAction` + `formatCombo`, hint omitted when the binding is unbound/disabled; keycap hints never render on coarse pointers; copy strings below are proposals — apply may tune phrasing but must keep the named facts.

### 1. Split-button keycaps (`top-bar.tsx`, SplitButton ~:1970-2050)

- Primary segment Tip `Split horizontally` gains `kbd` = the effective `split-horizontal` chord (registry-derived, omitted when unbound) — mirroring the Open button's primary tip (open-button.tsx:101-109, the `260811-ke2s` pattern).
- The two menu rows gain a right-aligned keycap: `Split horizontal` row shows the `split-horizontal` chord, `Split vertical` row shows `split-vertical`. Render as a trailing `<kbd>` (muted, right-aligned via `ml-auto`) inside the existing `POPOVER_ROW_CLASS` buttons — match the visual weight of the palette rows' kbd chips (`command-palette.tsx:191-193`). Menu min-width (`min-w-[170px]`) may need a bump so rows don't wrap with keycaps present — verify visually.
- The chevron Tip (`Split… (choose direction)`) stays keycap-free (it opens a menu, no chord).

### 2. Chevron-menu keycap audit (`top-bar-overflow-menu.tsx`)

Audit the top-bar overflow chevron menu's rows (View / Window / App sections — includes menuOnly rows like close-pane and Kill) for rows whose actions have registry bindings; add the same right-aligned keycap treatment where a binding exists and is enabled. Rows without bindings are untouched. If the overflow rows already render shortcuts, this task is a no-op — verify first.

### 3. Bottom-bar chip swap (`bottom-bar.tsx` ~:403-428)

Reorder the pair so the palette chip (`⌘K`) renders FIRST and the compose chip (`>_`) renders LAST (rightmost of the fine-pointer chip run; the `ml-auto` far-right cluster holds only the coarse-only ⌨/🔒 toggle and is untouched). Preserve everything else about both chips (tips, kbd slots, aria, active styling, `onOpenCompose` gating).

### 4. Compose hint in the free space (`bottom-bar.tsx`)

A dimmed, non-interactive education line in the dead space right of the chip pair (before the `ml-auto` cluster), pointing at the compose feature. Proposed copy: `>_ compose — type to the pane with autocorrect` with the effective compose chord appended as a keycap (reuse the existing `composeChord` derivation already in bottom-bar.tsx). Constraints:

- **Hard**: the bottom bar MUST keep its single-row 375px budget (context.md § Mobile Responsive Design) — hide the hint on narrow viewports (e.g. `hidden lg:flex`, breakpoint at apply's judgment) AND on coarse pointers (chords are noise on touch, per convention).
- Render only when the compose button itself renders (`onOpenCompose` present).
- Show only while the compose strip is OFF (`composeStripEnabled === false`): once the strip is open the hint is redundant — the feature has been found. <!-- assumed: hint hides once strip is enabled — educate-toward, not label; trivially reversible -->
- Non-interactive text (no button semantics; `aria-hidden` is acceptable since the adjacent chip carries the accessible name).

### Tests

- Update/extend `bottom-bar.test.tsx`: chip order (palette before compose in DOM), hint visibility branches (renders on fine+wide with strip off; absent when strip on, when coarse, when no compose target).
- Unit assertions for the split menu row keycaps (chord text present; absent when binding unbound) — colocated with the existing top-bar/split tests.
- Constitution § Test Companion Docs: if any Playwright `.spec.ts` changes, update its sibling `.spec.md` in the same commit. (The `shortcut-registry` e2e spec may assert split tip labels — check.)

## Affected Memory

- `run-kit/ui-patterns`: (modify) — bottom bar section (chip order, new compose hint line), SplitButton/top-bar chrome section (menu-row keycap treatment), § Education micro-copy convention (menu rows join the keycap surfaces list).

## Impact

Frontend only: `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `bottom-bar.tsx` + colocated tests. No backend, no routes, no state. Verification: `just test-frontend` + `npx tsc --noEmit`; e2e only if existing specs assert touched strings/order.

## Open Questions

None — both items were user-specified with screenshots; the two soft spots (overflow-menu audit outcome, hint copy/breakpoint) are graded assumptions delegated to apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Screenshot 1 (Open tip keycap) is out of scope — already shipped in #551; user's build is stale | Verified on merged main (open-button.tsx:123) | S:85 R:90 A:95 D:90 |
| 2 | Certain | Scope: split tips + split menu row keycaps; bottom-bar chip swap (palette first, compose rightmost); compose hint in the free space | User enumerated with screenshots | S:90 R:90 A:90 D:90 |
| 3 | Confident | Extend keycaps to overflow-menu rows with bound actions (audit; no-op if already present) | Same discovery-surface logic as the split menu the user pointed at; bounded and reversible | S:50 R:85 A:70 D:60 |
| 4 | Confident | Hint renders only while the compose strip is off | Educate-toward reading of "hint about the compose text button"; redundant once found; trivially reversible | S:50 R:90 A:75 D:65 |
| 5 | Certain | Hint hidden on coarse pointers and below a wide breakpoint — 375px single-row budget is a hard constraint | context.md documents the budget; convention documents coarse hiding | S:75 R:90 A:95 D:90 |
| 6 | Certain | All chords registry-derived with unbound omission, keycap style matching palette-row kbd chips | § Education micro-copy convention established by #551 | S:80 R:90 A:95 D:90 |
| 7 | Confident | Copy strings and exact breakpoint are proposals; apply tunes phrasing, keeps the named facts | Same contract as #551's intake; copy is trivially reversible | S:65 R:95 A:75 D:70 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).

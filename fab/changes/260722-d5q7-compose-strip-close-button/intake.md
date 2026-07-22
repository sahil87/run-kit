# Intake: Compose Strip Close Button

**Change**: 260722-d5q7-compose-strip-close-button
**Created**: 2026-07-22

## Origin

Promptless dispatch (created via the `_intake` Create-Intake Procedure with `{questioning-mode} = promptless-defer`), synthesized from a live discussion. The discussion resolved placement, wiring, draft safety, focus discipline, touch-target sizing, Escape semantics, and test obligations before this intake was created — those decisions are encoded verbatim below and in the Assumptions table.

> Add a small × close button to the top-right of the compose strip — the docked text-input surface at the bottom of the terminal area (`app/frontend/src/components/compose-strip.tsx`), rendered when the `composeStripEnabled` chrome preference is on. Today the only ways to close the strip are the `>_` chip in the bottom bar and the command palette; the user wants a close affordance on the strip itself.

## Why

1. **Pain point**: The docked compose strip (260718-dhdj) can only be dismissed from *outside* itself — the `>_` chip in the bottom bar or the `View: Text Input` command-palette entry. A user looking at the strip who wants it gone has no affordance on the surface they are looking at; discoverability of the close path is poor, especially for pointer/touch users.
2. **Consequence of not fixing**: The strip stays a "sticky" surface users don't know how to dismiss in place — friction on small screens where the strip consumes meaningful vertical space above the bottom bar.
3. **Why this approach**: A × in the strip's own header row is the minimal, conventional close affordance. It reuses the exact existing toggle action (`toggleComposeStrip()` from ChromeContext) — no new state, no new preference, no new route work. Closing is already lossless because the draft (text + attachments) lives in a module store (`app/frontend/src/lib/compose-draft-store.ts`) that survives toggle-off/on, so no confirmation flow is needed. Alternatives rejected: a new per-route close prop threaded from each mount (unnecessary — the strip is one shared component and can consume ChromeContext directly), and any Escape-closes behavior (explicitly rejected — see Escape semantics below).

## What Changes

### 1. Close button in the strip's header row (`app/frontend/src/components/compose-strip.tsx`)

The strip's existing header row is the `→ {target}` label row (currently):

```tsx
<div className="flex items-center gap-2 text-xs text-text-secondary">
  <span aria-hidden="true">{"→"}</span>
  <span data-testid="compose-strip-target" className={hasTarget ? "text-text-primary" : "italic"}>
    {hasTarget ? targetName : "no target"}
  </span>
  {uploading && (
    <span role="status" className="ml-auto text-accent" data-testid="compose-strip-uploading">
      Uploading…
    </span>
  )}
</div>
```

Add a small × close button at the **far right** of this row:

- **Slot order**: the × takes the far-right slot; the conditional "Uploading…" status sits immediately *before* (left of) it. The right-alignment currently rides `ml-auto` on the uploading span; rework so the × is always right-aligned whether or not the uploading status is rendered (e.g., group uploading + × in a single `ml-auto` flex container, or move `ml-auto` appropriately).
- **Wiring**: `onClick` calls `toggleComposeStrip()` from ChromeContext (`useChromeDispatch()` in `app/frontend/src/contexts/chrome-context.tsx`) — the *exact same action* the bottom-bar `>_` chip fires (`onOpenCompose={toggleComposeStrip}`). The component consumes the context itself, so **both mounts** — the terminal-route footer (`app/frontend/src/app.tsx` ~line 2755, `{composeStripEnabled && <ComposeStrip />}`) and the board-route footer (`app/frontend/src/components/board/board-page.tsx` ~line 1151) — get the button automatically. No per-route work.
- **Focus discipline**: the × MUST carry `onMouseDown={preventFocusSteal}` like every other button in the strip (📎 / Insert / Send / attachment-remove ×), so clicking it never steals focus from the terminal.
- **Touch target**: give the × the `coarse:min-h-[36px]`-style coarse-pointer treatment consistent with the strip's other buttons (per the project's mobile conventions in `fab/project/context.md`). Do NOT copy the tiny 16px attachment-remove × pattern (`w-4 h-4`) — that is explicitly the wrong template here.
- **Accessibility/testability**: an accessible name (e.g., `aria-label="Close compose strip"`) and a `data-testid` following the existing `compose-strip-*` pattern (e.g., `compose-strip-close`).
- **Visual form**: consistent with the strip's secondary-button vocabulary and the toolbar button color convention (`text-text-secondary` default, hover border highlight, `rk-glint` where the strip's other buttons use it), sized to fit the compact `text-xs` header row.

### 2. Behaviors explicitly NOT changing

- **Draft safety — no confirmation**: closing is already lossless; the draft text and pending attachments live in the module store (`compose-draft-store.ts`) and survive toggle-off/on. The × needs no confirmation or warning dialog.
- **Escape semantics unchanged**: Escape in the textarea continues to blur back to the terminal and NEVER closes the strip — that is an intentional, documented design decision (see the component's header comment: "no Escape-closes") the × must not alter.
- **No new keyboard shortcut**: the toggle is already keyboard-reachable via the command palette (`View: Text Input`) and the bottom-bar `>_` chip, satisfying Constitution V (Keyboard-First). The × is a pointer convenience only.
- **No change to the toggle mechanism itself**: `composeStripEnabled` persistence, the chip, and the palette entry are untouched.

### 3. Tests

- **Playwright e2e**: `app/frontend/tests/e2e/compose-strip.spec.ts` covers the strip (4 tests; the first covers toggle via `>_` chip and palette with reload persistence). Add coverage that clicking the × closes the strip (and that the draft survives close→reopen, if practical in the existing test structure).
- **Companion doc (constitution requirement)**: any `.spec.ts` modification MUST update the sibling `app/frontend/tests/e2e/compose-strip.spec.md` in the same commit (Constitution § Test Companion Docs).
- **Vitest unit tests**: `app/frontend/src/components/compose-strip.test.tsx` exists — add unit coverage that the × renders in the header row and clicking it invokes `toggleComposeStrip` (mock/provide ChromeContext as the existing tests do for other contexts).

## Affected Memory

- `run-kit/ui-patterns`: (modify) The § Docked Compose Strip section gains the on-strip close affordance (far-right of the header row, same `toggleComposeStrip` action as the `>_` chip, preventFocusSteal, coarse touch target, Escape-never-closes unchanged).

## Impact

- `app/frontend/src/components/compose-strip.tsx` — the only production-code file expected to change (add the × button to the header row; consume `useChromeDispatch`).
- `app/frontend/src/components/compose-strip.test.tsx` — unit coverage for the new button.
- `app/frontend/tests/e2e/compose-strip.spec.ts` + `compose-strip.spec.md` — e2e coverage + companion doc (same commit).
- No backend, API, routing, or ChromeContext changes. Both route mounts (`app.tsx`, `board-page.tsx`) inherit the button with zero edits.
- Small blast radius; e2e specs are known to assert chrome details (see memory note on e2e-assertions-on-ui-chrome), so running `just test-e2e` (or at minimum the compose-strip spec via `just pw test compose-strip`) is part of verification.

## Open Questions

- None — all decision points were resolved in the originating discussion (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | × wired to `toggleComposeStrip()` from ChromeContext, consumed inside `ComposeStrip` itself so both mounts inherit it with no per-route work | Discussed — explicitly chosen over per-route props; same action as the `>_` chip | S:95 R:90 A:95 D:95 |
| 2 | Certain | Placement: far right of the existing `→ {target}` header row, with the "Uploading…" status immediately before it | Discussed — placement decided verbatim | S:90 R:95 A:90 D:90 |
| 3 | Certain | No confirmation/warning on close — draft is lossless via the module store (`compose-draft-store.ts`) | Discussed and verified in code: draft + attachments survive toggle-off/on | S:90 R:95 A:100 D:95 |
| 4 | Certain | × carries `onMouseDown={preventFocusSteal}` | Discussed — matches every other button in the strip; the strip's no-focus-steal invariant | S:95 R:95 A:100 D:100 |
| 5 | Certain | Coarse-pointer touch treatment (`coarse:min-h-[36px]`-style) consistent with the strip's other buttons; NOT the 16px attachment-remove pattern | Discussed — explicit instruction, backed by context.md mobile conventions | S:90 R:90 A:95 D:90 |
| 6 | Certain | Escape semantics unchanged — Escape blurs to terminal, never closes the strip | Discussed — intentional documented design decision the × must not alter | S:95 R:90 A:100 D:100 |
| 7 | Certain | No new keyboard shortcut — palette + `>_` chip already satisfy Constitution V; × is pointer convenience | Discussed — keyboard-first note resolved in discussion | S:90 R:95 A:95 D:95 |
| 8 | Certain | Test scope: extend `compose-strip.spec.ts` e2e + update sibling `.spec.md` in the same commit + add Vitest unit coverage | Discussed — constitution § Test Companion Docs mandates the `.spec.md`; code-quality.md mandates tests for new behavior | S:75 R:90 A:85 D:80 |
| 9 | Confident | Accessible name `aria-label="Close compose strip"` and `data-testid="compose-strip-close"` | Not discussed verbatim; follows the existing `compose-strip-*` testid pattern and the strip's aria-label conventions <!-- assumed: exact aria-label/testid strings follow existing compose-strip-* conventions --> | S:60 R:90 A:80 D:70 |
| 10 | Confident | Visual form: small secondary-style button per the toolbar button color convention (`text-text-secondary`, hover border highlight), sized to the compact header row | "Small × close button" was the only visual spec; the toolbar convention in memory/ui-patterns gives the obvious default | S:55 R:85 A:75 D:60 |
| 11 | Confident | Right-alignment mechanics: group the conditional uploading status + × so the × stays far-right whether or not "Uploading…" renders (rework of the current `ml-auto` on the uploading span) | Implementation detail implied by the decided slot order; trivially reversible | S:55 R:90 A:80 D:70 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).

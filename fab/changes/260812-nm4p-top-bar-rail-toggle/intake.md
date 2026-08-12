# Intake: Top-Bar Right-Rail Toggle

**Change**: 260812-nm4p-top-bar-rail-toggle
**Created**: 2026-08-12

## Origin

Backlog item `[nm4p]` (added 2026-08-11), invoked one-shot via `/fab-new nm4p`. The entry encodes a settled design discussion from 2026-08-11 — including a visibility model chosen to avoid effect races, a known gotcha that cost an e2e failure in an abandoned first attempt, and a reference commit with reusable plumbing. Raw backlog input:

> Top-bar right-RAIL toggle on the terminal route — the sidebar toggle's far-right mirror. SEMANTICS (the load-bearing part): the button toggles the RAIL STRIP ITSELF (the 38px right-panel icon rail from 260811-2r1w), NOT a panel surface — clicking collapses everything right of the terminal (rail AND any open panel) so xterm runs edge-to-edge with nothing to its right; clicking again restores the rail. PLACEMENT: outermost right element of the top bar, inside the trailing exempt block AFTER the overflow chevron in top-bar.tsx's right cluster (the trailingRef block is width-measured by the fit, so the button never overflows — exactly like the chevron); same fixed-size chip as the sidebar toggle (rk-glint + TOP_BAR_BUTTON_BASE + border-border + text-text-primary), aria-label 'Toggle panel'. ICON: HamburgerIcon mirrored via a side='right' prop (fill rect x=11.5, divider x=11.5 vs the left icon's 2.5/6.5) — right column fills when the right area is visible, one icon language on both edges. STATE: railOpen boolean in ChromeContext persisted to localStorage key runkit-rail-open (mirror sidebarOpen's setter pattern; default true; desktop-only feature so no mobile-aware default needed), exposed via useChromeState/useChromeDispatch. VISIBILITY MODEL (settled in design discussion 2026-08-11, avoids effect races): derived rightAreaVisible = railOpen OR resolvedPanel != null — an OPEN panel always forces the right area visible, so ?panel= deep links, the shift-cmd-period chord, and the 'Panel: Web' palette entry are never dead while the rail is collapsed; COLLAPSING WHILE A PANEL IS OPEN CLOSES THE PANEL TOO (removeStoredPanel + drop the ?panel= param, same as togglePanel's close path) because collapsed means NOTHING right of the terminal and a hidden-but-open panel would contradict its own URL. Icon fill tracks rightAreaVisible. WIRING: railOpen/onToggleRail ride the top-bar-slot-context (AppShell registers, RootTopBar passes through); gate = windowParam && !isMobile only — the toggle renders on EVERY desktop terminal route even with zero available surfaces (the rail renders regardless, plan A2 landing-pad). CRITICAL GOTCHA (cost an e2e failure in the abandoned first attempt): do NOT hide the right area with a display:contents wrapper div around RightPanel — RightPanel measures railRef.current.parentElement.clientWidth (right-panel.tsx ~:88/:101) for its width floor/cap math, and a contents element generates no box, so clientWidth reads 0 and drag-resize silently dies (panel width never changes; deterministic e2e fail). Correct shape = a visible prop ON RightPanel that hides its own two root elements (panel div + rail div) with the hidden class at display level, keeping the real flex row as parentElement and preserving P3 hide-never-unmount (terminal refit rides its existing ResizeObserver). TESTS: top-bar.test.tsx — no button when onToggleRail absent, click calls it, mirrored geometry (fill x=11.5, fill-opacity tracks railOpen); e2e right-panel.spec.ts — toggle present on a PLAIN window too, collapse hides the rail and the terminal boundingBox width GROWS (poll), collapse-with-open-panel hides both and drops ?panel=, chord after collapse re-shows rail+panel; RESET the persisted runkit-rail-open pref inside each test (it leaks across tests otherwise) and update the .spec.md companion. DOC TOUCHES: docs/specs/right-panel.md § The Model says rail 'always visible on desktop' — amend to 'rendered on every desktop terminal route, collapsible from the top bar'; hydrate docs/memory/run-kit/ui-patterns.md § Right Panel to match. REFERENCE: abandoned commit b20a8020 (removed from PR #552 by force-push 2026-08-11) has the reusable button/icon/slot plumbing but with WRONG first-draft semantics (it toggled the web surface open/closed instead of collapsing the rail) — reuse the plumbing, not the handler.

**Scope extension (2026-08-12, conversational)**: reviewing a live screenshot, the user directed that the code editor and the rail should run all the way to the bottom of the viewport — the master layout becomes one full-width top bar over three full-height sections (left panel | main section | right panel), with the bottom bar + compose strip scoped to the main section only. The user explicitly confirmed folding this full-height layout restructure into this change (over sequencing it as a separate change), because the toggle's hide mechanism is trivially different in the new layout and building it against the old structure would mean implementing it twice. **The layout restructure supersedes the backlog's `visible`-prop hide shape** — see What Changes; the backlog's `display:contents` gotcha is preserved as a binding lesson (never a box-less wrapper around the measured container) but the wrapper-vs-prop question dissolves.

## Why

1. **The pain point**: Since `260811-2r1w` landed the right-panel shell, every desktop terminal route permanently gives up 38px of horizontal space to the icon rail — even for users who never open a panel. The sidebar has a collapse toggle on the far left; the right rail has no mirror. Terminal real estate is the product's core surface, and there is currently no way to run xterm edge-to-edge on the right.

2. **The layout asymmetry**: the rail + panel currently live *inside* the content area, so the footer (compose strip + bottom bar) spans beneath the code editor. That's a false scope claim — those controls act on the focused terminal pane, not the editor — and it stacks two status bars (code-server's own status bar floats above rk's footer instead of sitting at the true bottom edge). The sidebar already runs full height on the left; the right side should mirror it.

3. **The consequence of not fixing**: The rail's 38px tax is unavoidable on every desktop terminal window, and as more surfaces land on the rail (code, agents — per the right-panel spec's phasing) both the rail and the footer-spans-under-editor asymmetry become more entrenched.

4. **Why this approach**: A first attempt (commit `b20a8020`, removed from PR #552 by force-push on 2026-08-11) got the toggle semantics wrong — it toggled the *web surface* open/closed, duplicating what the rail buttons and `⇧⌘.` chord already do. The redesign (settled 2026-08-11) toggles the **rail strip itself**: collapsed means *nothing* right of the terminal. The derived-visibility model (`rightAreaVisible = railOpen || resolvedPanel != null`) was chosen over effect-based synchronization specifically to avoid effect races. The full-height column shape (settled 2026-08-12) makes the toggle a *literal* mirror of the sidebar toggle — `railOpen` collapses the third grid column exactly like `sidebarOpen` collapses the first — and reuses the proven `sidebarChildren` slot pattern (260719-rwqf).

## What Changes

### Layout restructure: full-height right column (prerequisite step)

The shell grid (`components/shell/shell.tsx:119-129`) grows an optional third column:

- Grid becomes `"sidebar content rightpanel" / "sidebar bottombar rightpanel"`, columns `${sidebarWidth}px 1fr auto`, rows `1fr auto` (today: `"sidebar content" / "sidebar bottombar"`). The right column spans both rows — full height, exactly like the sidebar.
- Shell gains an optional `rightPanelChildren` slot prop mirroring the existing `sidebarChildren` pattern (260719-rwqf). Only the terminal route passes it; board/host shell consumers pass nothing and render the two-column grid unchanged.
- AppShell moves the `<RightPanel>` block out of `<main gridArea:"content">` (today it sits in the content flex row at `app.tsx:3262-3403`) into the new slot.
- **The bottom bar needs NO code change for scoping**: the `bottombar` grid area (`app.tsx:3413`) already spans only the content column — adding the third column automatically excludes the footer from under the panel. Compose strip + bottom bar end up under the terminal only, and code-server's own status bar lands at the true bottom edge.
- **P3 divergence from the sidebar pattern (load-bearing)**: the sidebar aside *unmounts* when collapsed (Shell gates `!isMobile && sidebarOpen`). The right column MUST NOT copy that — collapse hides at width/display level, never unmounts, so the web/code iframes keep their in-memory state (right-panel spec P3 hide-never-unmount).
- **Width-math refactor** in `right-panel.tsx`: today the panel measures `railRef.current.parentElement.clientWidth` (`:90`/`:103` — the content row: terminal + panel + rail) for its 280px floor / 65% cap and sets `width: N%` of that row. Once the panel is its own grid column, percentage-of-parent is circular (the parent *is* the panel+rail). New shape: the panel sizes its column in pixels; the floor/cap resolve against the shell container width (terminal column + panel — the equivalent of today's row basis) via a measurement seam that is NOT the panel's own parent (e.g. observe the shell grid element). Drag-resize must keep working — the existing e2e resize coverage is the regression proof.
- The first attempt's `display:contents` gotcha dissolves in this shape (there is no wrapper div — collapse is grid-column gating), but its lesson stays binding: never introduce a box-less element between the measured container and the panel.
- `viewTransitionName: "terminal-surface"` (`app.tsx:3216`): the panel leaves the window-switch animated region — acceptable and arguably better (the panel is per-window keyed and remounts on window switch anyway; the slide should scope to the terminal).

### Toggle semantics (the load-bearing part)

The new top-bar button toggles the **rail strip itself** (the 38px right-panel icon rail from `260811-2r1w`), NOT a panel surface:

- **Collapse**: hides the entire full-height right column — the rail AND any open panel — so xterm runs edge-to-edge with nothing to its right.
- **Restore**: brings the rail back (and only the rail; a panel closed by collapse stays closed).
- **Collapsing while a panel is open closes the panel too**: run the same close path as `togglePanel`'s close branch — `removeStoredPanel(server, windowParam)` + drop the `?panel=` search param (`app.tsx:694-710` is the existing toggle; `lib/right-panel.ts:117` is `removeStoredPanel`). Rationale: collapsed means NOTHING right of the terminal; a hidden-but-open panel would contradict its own URL.
- With the layout restructure in place, the collapse mechanism is the Shell right column gating on the derived visibility (below) — hidden at width/display level, never unmounted.

### State: `railOpen` in ChromeContext

- New boolean `railOpen` in `contexts/chrome-context.tsx`, persisted to localStorage key `runkit-rail-open`, default `true`.
- Mirror the existing `sidebarOpen` setter pattern (`SIDEBAR_OPEN_STORAGE_KEY = "runkit-sidebar-open"` at `chrome-context.tsx:13`, lazy read at `:78`).
- Exposed via `useChromeState` / `useChromeDispatch`.
- Desktop-only feature, so no mobile-aware default is needed (mobile has no rail — the right panel degrades to a bottom sheet per right-panel spec P5).

### Visibility model (settled in design discussion 2026-08-11 — avoids effect races)

- **Derived, not synchronized**: `rightAreaVisible = railOpen || resolvedPanel != null` (`resolvedPanel` lives at `app.tsx:684`). This gates the Shell right column.
- An OPEN panel always forces the right area visible — so `?panel=` deep links, the `⇧⌘.` chord, and the `Panel: Web` palette entry (`app.tsx:2432`) are never dead while the rail is collapsed. Opening a panel by any of those paths shows the rail+panel even when `railOpen` is false.
- Icon fill tracks `rightAreaVisible` (not raw `railOpen`).

### Placement: trailing exempt block in the top bar

- Outermost right element of the top bar, inside the trailing exempt block AFTER the overflow chevron in `top-bar.tsx`'s right cluster (the `trailingRef` block at `top-bar.tsx:1156`; measured by the fit at `:739`, so the button never overflows — exactly like the chevron).
- Same fixed-size chip as the sidebar toggle: `rk-glint` + `TOP_BAR_BUTTON_BASE` + `border-border` + `text-text-primary`.
- `aria-label="Toggle panel"`.

### Icon: mirrored HamburgerIcon

- Extend `HamburgerIcon` (`top-bar.tsx:174`) with a `side='right'` prop: fill rect `x=11.5`, divider `x=11.5` (vs the left icon's `2.5`/`6.5`).
- Right column fills when the right area is visible — one icon language on both edges.

### Wiring: top-bar-slot-context

- `railOpen`/`onToggleRail` ride the existing `top-bar-slot-context` (`contexts/top-bar-slot-context.tsx`): AppShell registers, RootTopBar passes through (both live in `app.tsx` — RootTopBar mounts at `app.tsx:316`).
- Gate = `windowParam && !isMobile` only — the toggle renders on EVERY desktop terminal route, even with zero available surfaces (the rail renders regardless — plan A2 landing-pad behavior).

### Keyboard path

Add a command-palette entry for the rail toggle (e.g. `Panel: Toggle rail` alongside the existing `Panel: Web` entry at `app.tsx:2432`) so the new action is keyboard-reachable per Constitution V. <!-- assumed: palette entry for the toggle — backlog is silent, but Constitution V requires every user-facing action be keyboard-reachable and the palette is the discovery mechanism -->

### Tests

- **`top-bar.test.tsx`** (unit): no button when `onToggleRail` absent; click calls it; mirrored geometry (fill `x=11.5`, `fill-opacity` tracks `railOpen`).
- **`tests/e2e/right-panel.spec.ts`** (e2e):
  - toggle present on a PLAIN window too (zero surfaces);
  - collapse hides the rail and the terminal `boundingBox` width GROWS (poll);
  - collapse-with-open-panel hides both and drops `?panel=`;
  - chord (`⇧⌘.`) after collapse re-shows rail+panel;
  - **full-height layout**: with a panel open, the panel/rail `boundingBox` extends below the bottom bar's top edge (to the shell's bottom), and the bottom bar's width equals the terminal column — not the full viewport;
  - existing panel drag-resize coverage must still pass (regression proof for the width-math refactor);
  - RESET the persisted `runkit-rail-open` pref inside each test — it leaks across tests otherwise.
  - Update the `right-panel.spec.md` companion in the same commit (Constitution § Test Companion Docs).

### Doc touches

- `docs/specs/right-panel.md`: (a) the model text says the rail is "always-visible" (line 4; § 2 line 48) — amend to "rendered on every desktop terminal route, collapsible from the top bar"; (b) document the full-height column layout — the rail+panel are a full-height Shell grid column beside the content column, with the bottom bar scoped to the content column.
- Hydrate `docs/memory/run-kit/ui-patterns.md` § Right Panel to match (collapsible rail, full-height column, derived `rightAreaVisible`, collapse-closes-panel).

### Reference: abandoned commit b20a8020

`b20a8020` ("feat: top-bar right-panel toggle — the sidebar toggle's far-right mirror", removed from PR #552 by force-push 2026-08-11, still reachable in this repo) has the reusable button/icon/slot plumbing but with WRONG first-draft semantics (it toggled the web surface open/closed instead of collapsing the rail). **Reuse the plumbing, not the handler.**

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Right Panel — full-height Shell grid column (rail+panel beside the content column, footer scoped to terminal), collapsible from the top bar (`railOpen`/`runkit-rail-open`, derived `rightAreaVisible`, collapse-closes-panel semantics); § top-bar chrome — new trailing rail-toggle chip after the overflow chevron

## Impact

- **Frontend only** — no backend, API, or route changes.
- `app/frontend/src/components/shell/shell.tsx` — third grid column + optional `rightPanelChildren` slot (board/host consumers unchanged).
- `app/frontend/src/app.tsx` — move `<RightPanel>` out of `<main>` into the slot; AppShell registers slot fields; derived `rightAreaVisible`; collapse-closes-panel handler; palette entry.
- `app/frontend/src/components/right-panel.tsx` — width-math refactor (px column, floor/cap against the shell container, measurement seam off the panel's parent), preserving hide-never-unmount.
- `app/frontend/src/components/top-bar.tsx` — mirrored `HamburgerIcon` `side` prop, new trailing chip in the `trailingRef` exempt block, `onToggleRail`/`railOpen` props.
- `app/frontend/src/contexts/chrome-context.tsx` — `railOpen` state + `runkit-rail-open` persistence.
- `app/frontend/src/contexts/top-bar-slot-context.tsx` — carry `railOpen`/`onToggleRail` through the slot.
- Tests: `top-bar.test.tsx`, `tests/e2e/right-panel.spec.ts` + `.spec.md`, `shell.tsx` unit coverage if present.
- Docs: `docs/specs/right-panel.md`, `docs/memory/run-kit/ui-patterns.md` (hydrate).

## Open Questions

- None — the backlog entry encodes a settled design (2026-08-11 discussion), and the 2026-08-12 conversation settled the layout restructure and its fold-in explicitly.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Toggle collapses the RAIL STRIP itself (rail + any open panel), never a panel surface | Backlog marks this "the load-bearing part"; settled 2026-08-11 after the first attempt got it wrong | S:95 R:70 A:95 D:95 |
| 2 | Certain | Derived visibility `rightAreaVisible = railOpen OR resolvedPanel != null`; collapse-with-open-panel also closes the panel (removeStoredPanel + drop `?panel=`) | Explicitly settled in the 2026-08-11 design discussion to avoid effect races; keeps deep links/chord/palette alive | S:95 R:70 A:90 D:90 |
| 3 | Certain | Full-height layout restructure folded into THIS change: Shell grid third column (`"sidebar content rightpanel" / "sidebar bottombar rightpanel"`), optional `rightPanelChildren` slot mirroring `sidebarChildren` | User directed the full-height layout from a screenshot (2026-08-12) and explicitly confirmed fold-in over a separate change; slot pattern proven by 260719-rwqf | S:90 R:60 A:90 D:90 |
| 4 | Certain | Right column hides at width/display level on collapse, NEVER unmounts — deliberate divergence from the sidebar aside's unmount-on-collapse | Right-panel spec P3 hide-never-unmount: web/code iframes must keep in-memory state | S:85 R:75 A:95 D:90 |
| 5 | Confident | Width-math refactor: panel sizes its grid column in pixels; 280px floor / 65% cap re-based against the shell container width via a measurement seam off the panel's own parent | Old percent-of-parent basis is circular once the panel is its own column; the exact measurement seam is a design choice within discussed constraints (drag-resize e2e is the proof) | S:70 R:70 A:75 D:65 |
| 6 | Certain | Bottom bar/compose scoping needs no code change — the `bottombar` grid area already spans only the content column, so the third column automatically excludes the footer | Verified shell.tsx:119-129 grid areas + app.tsx:3413 footer placement | S:75 R:85 A:90 D:80 |
| 7 | Certain | `railOpen` boolean in ChromeContext, localStorage `runkit-rail-open`, default true, desktop-only | Backlog specifies key, default, and the `sidebarOpen` pattern to mirror (chrome-context.tsx:13/:78 verified) | S:95 R:80 A:95 D:90 |
| 8 | Certain | Placement: trailing exempt block after the overflow chevron; sidebar-toggle chip styling; aria-label 'Toggle panel'; gate `windowParam && !isMobile` | Backlog specifies exact block (trailingRef, top-bar.tsx:1156 verified), tokens, and gate | S:95 R:85 A:95 D:95 |
| 9 | Certain | Mirrored HamburgerIcon via `side='right'` (fill/divider x=11.5 vs 2.5/6.5); fill tracks rightAreaVisible; reuse b20a8020 plumbing, not its handler | Backlog gives exact geometry and the reference commit (verified reachable) | S:90 R:85 A:85 D:85 |
| 10 | Confident | Add a command-palette entry (e.g. `Panel: Toggle rail`) for the new toggle | Backlog is silent on a keyboard path, but Constitution V mandates keyboard reachability and the palette is the discovery mechanism; trivially reversible | S:40 R:85 A:80 D:70 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).

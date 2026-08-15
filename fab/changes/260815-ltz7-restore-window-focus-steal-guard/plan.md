# Plan: Restore Window Focus with Code-Server Steal Guard

**Change**: 260815-ltz7-restore-window-focus-steal-guard
**Intake**: `intake.md`

## Requirements

### Focus Memory: per-window focus recall

#### R1: Focus-memory module
A new pure module `app/frontend/src/lib/focus-memory.ts` SHALL hold a module-level `Map` keyed `` `${server}:${windowId}` `` whose value is `"tty" | "compose" | "code"`, plus a per-key steal-guard armed flag. It MUST export `recordFocus(key, kind)`, `recallFocus(key)` (returns the recorded kind or `undefined`), and `armGuard(key)` / `disarmGuard(key)` / `isGuardArmed(key)`. State is in-memory only — no localStorage, no persistence (precedent: `lib/code-folder-latch.ts` is the storage-shaped sibling; this one deliberately is NOT stored). The module MUST be DOM-free and unit-testable in jsdom.

- **GIVEN** a fresh page load
- **WHEN** `recallFocus` is called for any key
- **THEN** it returns `undefined` (callers apply the `tty` default)

- **GIVEN** `recordFocus("s:@1", "compose")` was called
- **WHEN** `recallFocus("s:@1")` is called
- **THEN** it returns `"compose"`, and `recallFocus("s:@2")` still returns `undefined`

#### R2: Recording seams — real focus only
Focus memory SHALL be written only from genuine user focus of the three candidates; navigation clicks and programmatic grabs MUST never write it:

- `tty`: recorded in `focusSlot` (`app/frontend/src/components/surface-layout.tsx`) when the focused tile kind is `tty` — the wrapper's `onPointerDownCapture`/`onFocus` seams already route there, and xterm focus is what those events mean on a tty tile.
- `compose`: recorded from the compose textarea's `onFocus` in `app/frontend/src/components/compose-strip.tsx` (beside the existing `setComposeStripFocused(true)` publish), keyed by the current `${server}:${windowId}` route target.
- `code`: recorded ONLY when `CodeSurface`'s `onInteract` seam fires (contentDocument keydown/pointerdown — `code-surface.tsx`), wired at the `onInteract` call site in `surface-layout.tsx`. The tile wrapper's `onFocus` (mere focusin of the iframe element) MUST NOT record `code` — this asymmetry is the load-bearing anti-steal property.

- **GIVEN** the user clicks a sidebar row to navigate away
- **WHEN** the click focuses the sidebar row
- **THEN** no `recordFocus` call fires (only the three candidate surfaces record)

- **GIVEN** the code-server workbench programmatically focuses its editor at load
- **WHEN** the iframe element gains focus with no in-frame keydown/pointerdown
- **THEN** focus memory is not written (`onInteract` did not fire)

#### R3: Restore router
`app/frontend/src/app.tsx` SHALL run a restore effect keyed `[server, windowParam]` on the terminal route, desktop only (skip when `isMobile` — auto-focus pops the mobile keyboard; precedent chat-view.tsx:202). It resolves `recallFocus(key) ?? "tty"` and routes:

- `tty` → `focusTerminalRef.current?.()` with retry-until-ready: the ref registers late in TerminalClient init, so retry in a rAF loop bounded by a ~2s deadline, abandoned early on first user interaction.
- `compose` → `focusComposeStrip()` (`lib/compose-strip-events.ts`); the registered focuser returns `false` when declined (disabled/unmounted) — on decline, fall back to the `tty` route.
- `code` → no-op: the workbench's own load-time grab restores editor focus. (Recorded fallback if the degenerate no-restored-editors case bites: explicit `contentWindow.focus()` after load.)

The effect SHALL also `armGuard(key)` for the new window, and install capture-phase `pointerdown`/`keydown` listeners on the parent document that `disarmGuard(key)` on first genuine user interaction (torn down on cleanup).

- **GIVEN** the user had the compose textarea focused in window A, then switched to window B and back to A
- **WHEN** the restore effect runs for A on desktop
- **THEN** the compose textarea receives focus

- **GIVEN** a window never visited before (no memory entry)
- **WHEN** the restore effect runs on desktop
- **THEN** the terminal (xterm textarea) receives focus once the focus ref registers

- **GIVEN** a coarse-pointer/mobile viewport
- **WHEN** a window switch occurs
- **THEN** the restore effect does nothing (no keyboard pop)

#### R4: Steal guard
`CodeSurface` SHALL accept a new optional prop (e.g. `onProgrammaticFocus?: () => boolean`) and attach a `focus` listener to the iframe ELEMENT (parent-document side). When it fires while the guard is armed and the remembered kind ≠ `code`, the handler invokes the revert (the restore router's target focus) — returning `true` to mean "handled/reverted". The guard disarms on first genuine user interaction: the in-frame `onInteract` seam and the parent-document capture listeners from R3. A reverted grab MUST NOT flip `focusedSlot`/`focusedTileKind` to `code`: preferred mechanism is the tile wrapper's `onFocus` (surface-layout.tsx:908) consulting the guard before calling `focusSlot`; the accepted fallback is a one-tick flip immediately corrected by the revert (border flicker only). After disarm, editor focus behaves exactly as today (click-in focuses, `focusSlot` fires, `code` records via `onInteract`).

- **GIVEN** the remembered kind for the window is `tty` and the guard is armed
- **WHEN** the code-server workbench grabs focus at editor-restore time (~post-load)
- **THEN** focus is reverted to the terminal, `focusedTileKind` does not settle on `code`, and `ttyOnly` chords keep working

- **GIVEN** the remembered kind is `code`
- **WHEN** the workbench grab fires
- **THEN** no revert occurs (the grab IS the restore)

- **GIVEN** the guard was disarmed by a user click anywhere
- **WHEN** the user clicks into the editor
- **THEN** focus moves into the iframe normally and `code` is recorded

#### R5: Test coverage
The focus-memory module SHALL have colocated Vitest unit tests (`focus-memory.test.ts`). The end-to-end behavior SHALL be proven in Playwright (jsdom cannot prove iframe focus): a stub `/code/` route that calls `focus()` on an element after ~300ms simulates the workbench grab, with the code-server reachability probe mocked `true` (route globs MUST carry a trailing `*` — `withServer` appends `?server=`). Three specs: (a) terminal focused → switch away/back → focus reverts to the xterm textarea and typing lands there; (b) same for the compose strip; (c) user clicked into the editor before leaving → returning lets the grab through (no revert). A `.spec.md` companion MUST ship in the same commit (constitutional — Test Companion Docs).

- **GIVEN** the stub `/code/` page grabs focus 300ms after load
- **WHEN** spec (a) switches back to a window remembered as `tty`
- **THEN** `document.activeElement` ends inside the xterm textarea and typed keys reach the pane

### Non-Goals

- Board route — it has its own focused-pane model (`FocusedPaneProvider`, `registerFocus={false}` panes)
- Mobile behavior changes — restore and guard are desktop-only
- Upstream VS Code patch (`window.top !== window` guard in `restoreEditors`) — plausible but not blocked on
- Persistence of focus memory across reloads

### Design Decisions

#### Recording asymmetry defeats the steal structurally
**Decision**: `code` is recorded only from the in-frame interaction seam (`onInteract`), never from iframe-element focusin; `tty`/`compose` record from their normal focus events.
**Why**: The workbench's programmatic grab produces focusin without interaction, so it can never write memory — the guard then only ever reverts *toward* a user choice, making the design correct independent of grab timing.
**Rejected**: Timing heuristics (suppress focus for N ms after mount) — fragile against slow loads and fights legitimate user clicks.
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

#### Guard state lives in the focus-memory module, wired through app.tsx
**Decision**: `armGuard`/`disarmGuard`/`isGuardArmed` are module-level per-key flags beside the memory Map; app.tsx arms on window switch and disarms via parent-document capture listeners; surface-layout and code-surface consume via props/imports.
**Why**: One source of truth for "are we in the post-switch protected window", readable synchronously from any seam without prop-drilling render state; matches the module-slot pattern of `compose-strip-events.ts`.
**Rejected**: React state in SurfaceLayout (resets are per-window for free, but compose strip and app.tsx would need context plumbing for a transient flag).
*Introduced by*: 260815-ltz7-restore-window-focus-steal-guard

## Tasks

### Phase 1: Setup

- [x] T001 [P] Create `app/frontend/src/lib/focus-memory.ts`: `FocusKind` union, module Map + guard-flag Set keyed `${server}:${windowId}`, `recordFocus`/`recallFocus`/`armGuard`/`disarmGuard`/`isGuardArmed`, plus a test-reset export (the `hydrateComposeDrafts()` seam pattern) <!-- R1 -->
- [x] T002 [P] Colocated unit tests `app/frontend/src/lib/focus-memory.test.ts`: empty recall, record/recall round-trip, per-key isolation, guard arm/disarm lifecycle, reset seam <!-- R1, R5 -->

### Phase 2: Core Implementation

- [x] T003 Recording seams in `app/frontend/src/components/surface-layout.tsx`: `focusSlot` records `tty` when the slot kind is tty; the `onInteract` wiring records `code` + disarms the guard; the tile wrapper's `onFocus` consults `isGuardArmed` before `focusSlot` for the code tile (R4's preferred no-flip mechanism). Component gains the window key (or a `focusMemoryKey` prop) from its existing `server`/`windowId` props <!-- R2 -->
- [x] T004 [P] Recording seam in `app/frontend/src/components/compose-strip.tsx`: textarea `onFocus` records `compose` for the current route target (only when the strip's target is the route window — the in-tile/footer terminal-target mode, not selection-broadcast) <!-- R2 -->
- [x] T005 Steal-guard listener in `app/frontend/src/components/code-surface.tsx`: new `onProgrammaticFocus?: () => boolean` prop; attach/detach a `focus` listener on the iframe element (same lifecycle as the existing load/attach effect); handler calls the prop and stops there when it returns true (reverted) <!-- R4 -->
- [x] T006 Restore router + guard wiring in `app/frontend/src/app.tsx`: effect keyed `[server, windowParam]` (desktop-only) resolving `recallFocus ?? "tty"` → tty rAF-retry via `focusTerminalRef` (~2s deadline) / `focusComposeStrip()` with tty fallback / code no-op; arms guard; capture-phase parent-document `pointerdown`/`keydown` disarm listeners; pass the revert callback down through `SurfaceLayout` to `CodeSurface.onProgrammaticFocus` <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Playwright e2e `app/frontend/tests/focus-restore.spec.ts` + `focus-restore.spec.md`: stub `/code/` route (delayed `focus()` grab, reachability mocked true, trailing-`*` globs); specs (a) tty revert, (b) compose revert, (c) code passthrough after in-editor click; reuse the `code-surface.spec.ts` stub harness patterns <!-- R5 -->

### Phase 4: Polish

- [x] T008 Note in `docs/specs/right-panel.md` § code lens: the load-time workbench focus grab and the parent-side steal guard (one short paragraph) <!-- R4 -->

## Execution Order

- T001 blocks T002–T006 (all consume the module API)
- T003 and T005 block T006 (app.tsx wires their props)
- T007 runs after T006 (tests the integrated behavior)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/focus-memory.ts` exists with the specified API, in-memory only, DOM-free
- [x] A-002 R2: all three recording seams write memory; no other call site writes it
- [x] A-003 R3: restore effect routes tty/compose/code as specified, desktop-only, and arms the guard
- [x] A-004 R4: iframe-element focus listener reverts an armed non-`code` grab and disarms on first user interaction

### Behavioral Correctness

- [x] A-005 R3: first visit to a window focuses the terminal (replaces the accidental code-wins behavior)
- [x] A-006 R4: a reverted grab leaves `focusedTileKind` off `code` — `ttyOnly` chords remain live after a window switch with a code tile present

### Scenario Coverage

- [x] A-007 R5: e2e specs (a), (b), (c) exist and pass via `just test-e2e`
- [x] A-008 R5: `focus-restore.spec.md` companion documents each test (what it proves + steps) in the same commit

### Edge Cases & Error Handling

- [x] A-009 R3: compose restore falls back to tty when the focuser declines (strip disabled/unmounted)
- [x] A-010 R3: mobile/coarse viewport performs no restore and no revert (guard paths inert)
- [x] A-011 R4: after disarm, clicking into the editor focuses it normally and records `code` (no permanent revert loop)

### Code Quality

- [x] A-012 Pattern consistency: module-slot pattern matches `compose-strip-events.ts`/`code-folder-latch.ts` conventions; no `as` casts (type narrowing)
- [x] A-013 No unnecessary duplication: reuses existing seams (`onInteract`, `focusSlot`, `focusComposeStrip`, `focusTerminalRef`) rather than new event plumbing
- [x] A-014 Tests included: unit tests for the module, e2e for the integrated behavior (code-quality baseline — new behavior MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The extended seams (wrapper `onFocus`/`onPointerDownCapture`, compose `onFocus`, `CodeSurface` attach effect) are modifications in place, not replacements; nothing previously shipped becomes unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The no-flip mechanism is guard consultation in the wrapper `onFocus` (fallback: accept a one-tick flip the revert corrects) | Intake row 10's stated preference; apply verifies event ordering and falls back if consultation proves unreliable | S:60 R:80 A:60 D:50 |
| 2 | Confident | `code` restore stays a no-op (workbench grab restores it); explicit `contentWindow.focus()` only if the degenerate case bites in e2e | Intake row 8's front-runner; trivially revisited | S:70 R:85 A:70 D:60 |
| 3 | Confident | The `code` recording hook lives at the `onInteract` wiring in surface-layout.tsx (not inside CodeSurface) | Keeps CodeSurface free of memory imports (it stays lean per its design contract); surface-layout already owns the slot→kind mapping | S:65 R:85 A:75 D:70 |
| 4 | Confident | The e2e stub reuses the existing `code-surface.spec.ts` code-server stub harness patterns | Memory records that harness and `code-folder-latch.spec.ts` already reusing it | S:70 R:90 A:80 D:75 |
| 5 | Certain | Memory keys use `${server}:${windowId}` matching the storage-key convention (`rk-layout:`, `runkit-code-folder:`) | Uniform with every per-window key in the codebase | S:90 R:90 A:95 D:95 |
| 6 | Confident | Compose recording only fires in terminal-target mode (not selection-broadcast — its draft key is not a window) | Broadcast has no window identity to record against; matches the store's `selection:` key carve-out | S:70 R:85 A:80 D:75 |
| 7 | Confident | The key shape `${server}:${windowId}` is spelled out once as an exported `focusMemoryKey(server, windowId)` in focus-memory.ts; all seams call it | Keeps the magic string out of three call sites (code-quality: no magic strings); mirrors `codeFolderStorageKey` | S:80 R:90 A:85 D:80 |
| 8 | Certain | The no-flip mechanism landed as guard consultation in the wrapper `onFocus` (plan row 1's preferred path — no fallback needed): armed + remembered ≠ `code` skips `focusSlot` | Verified against the event flow: a genuine click-in reaches `onPointerDownCapture` (unguarded) and `onInteract` disarms, so only the bare programmatic grab is ever blocked | S:80 R:85 A:80 D:75 |
| 9 | Confident | The revert callback does NOT disarm the guard; disarm happens only on genuine interaction (parent-document capture listeners + `onInteract`) | R4's stated lifecycle; the consult also checks `recallFocus`, so a lingering armed flag is inert once the user has interacted | S:70 R:80 A:70 D:65 |
| 10 | Confident | The e2e stub is a real HTTP server bound to `RK_CODE_SERVER_PORT` (the code-surface/code-folder-latch harness) serving a page whose script focuses a button ~300ms after load — the reachability probe is genuinely true, not mocked | Reuses the proven harness verbatim; a real bind beats mocking a server-side probe the frontend never sees; `workers: 1` keeps port sharing safe | S:80 R:90 A:80 D:80 |
| 11 | Confident | The e2e files live at `app/frontend/tests/e2e/focus-restore.spec.{ts,md}` (the plan's `app/frontend/tests/` path is shorthand — `playwright.config.ts` sets `testDir: ./tests/e2e`) | Every existing spec + companion lives there; outside testDir the spec would never run | S:85 R:95 A:90 D:85 |
| 12 | Confident | Specs switch windows via sidebar-row clicks, never `page.goto` | Focus memory is in-memory by design (intake row 1) — a reload would wipe the state under test | S:85 R:90 A:85 D:85 |
| 13 | Certain | The steal-grab detector is a capture-phase `focusin` on the frame's contentDocument (the existing `attach()` seam), NOT the planned iframe-element `focus` listener | Verified empirically in the e2e env (Chromium): an in-frame script `focus()` re-points the focus chain (`document.activeElement` → iframe) but fires NO parent-side event on the iframe element — no `focus`, no `focusin`, no window `blur`. The in-frame `focusin` is the only observable; a genuine click-in produces `pointerdown` (→ `onInteract`, disarms) first, so real editor focus is never reverted. The wrapper-`onFocus` consultation stays as the cross-engine no-flip guard | S:85 R:80 A:80 D:80 |
| 14 | Confident | The e2e stub's grab is one-shot per load (a `didFocus` flag), matching the real workbench's single editor-restore grab | Without the flag the revert's own focus churn retriggered the grab loop, making the stub fight the guard | S:80 R:85 A:80 D:75 |
| 15 | Certain | The `tty` memory write lives on the wrapper's `onPointerDownCapture` (and the palette focus seam), NOT in `focusSlot`/the wrapper `onFocus` | Verified empirically: the in-tile compose strip docks inside the tty tile, and a focusin bubbles target-first — the textarea's `onFocus` (recording `compose`) runs BEFORE the wrapper's, so a tty write in `focusSlot` clobbered every compose record (probe read back `tty` after a strip click). Pointerdown capture precedes the focus event, so the compose write lands last | S:85 R:85 A:80 D:80 |
| 16 | Confident | The e2e opens the code tile via the `Code tile` rail toggle, not a `?layout=` URL param | Verified empirically: a URL `?layout=` is never persisted, and sidebar navigation drops the search string, so the code tile vanished on switch-back; a rail click is a user mutation persisted to `rk-layout:{server}:{@N}` and survives. Side effect (accepted, matches the design): the rail click's pointerdown disarms that visit's guard, so the tile-opening grab stands — the revert is exercised on the away-and-back return | S:80 R:85 A:80 D:75 |
| 17 | Certain | The e2e environment shows a PRE-EXISTING "Maximum update depth exceeded" render loop (~8 console errors over ~3s) whenever the xterm textarea gains focus — reproduced on the baseline tree (changes stashed) with a plain terminal click | Not introduced by this change (baseline reproduction), though the restore effect now triggers it on every desktop window mount; recorded for review visibility, fixing it is out of scope | S:75 R:90 A:70 D:70 |
| 18 | Certain | The tty pointerdown write skips presses landing inside the docked compose strip (new production marker `data-compose-strip` on the strip root); the compose `onFocus` write is gated on `focused` matching a new `focusMemoryWindow` prop from app.tsx | Both verified empirically via module-state probes: the strip's focus-on-open means a follow-up click on the already-focused textarea fires NO focus event, so its tile pointerdown clobbered `compose` with `tty`; and the focused-terminal context lags a window switch by a commit, so a restore-driven focus cross-wrote the PREVIOUS window's key. The gate lives in a prop (not `useMatches`) because the strip's unit tests mount it without a router | S:85 R:85 A:80 D:80 |
| 19 | Confident | `FOCUS_RESTORE_RETRY_MS` landed at 5000 (not the ~2s placeholder) and the spec's `beforeAll` sets an explicit 90s hook timeout | The plan marked the deadline tunable; under e2e-box load (API calls observed at 4s+) TerminalClient init outlasted 2s and the tty restore never landed | S:75 R:80 A:75 D:70 |

19 assumptions (6 certain, 13 confident, 0 tentative).

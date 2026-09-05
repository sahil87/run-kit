# Plan: Quake Console v2 — Slide, Resize, Affordances, Glass, Image Paste

**Change**: 260905-sh7y-console-slide-resize-glass-paste
**Intake**: `intake.md`

## Requirements

### Console: slide

#### R1: True quake slide, both directions, mounted through exit
The desktop drawer SHALL enter via `translateY(-102%) → 0` and exit back up, ~240ms ease-out, replacing the current `rk-console-drop` nudge. The component MUST stay mounted through the exit transition — an internal closing state drives the exit class and the unmount fires on `transitionend` with a timeout fallback — so the terminal stream tears down after the slide, not mid-animation. Esc, the chord, the ✕, the top-bar button, and the tongue all close through this path. `prefers-reduced-motion` SHALL zero both directions including the mounted-through-exit delay (immediate unmount). The mobile sheet keeps a simple fast transition (or none) — the quake slide is the desktop drawer's.

- **GIVEN** a closed console on desktop
- **WHEN** the chord fires
- **THEN** the drawer slides down from fully above the top-bar seam in ~240ms
- **AND WHEN** Esc is pressed, **THEN** it slides back up and unmounts only after the transition ends
- **AND GIVEN** reduced motion, **THEN** open/close are instant

### Console: resize

#### R2: Height and width grips, clamped, transition-suspended
The desktop drawer SHALL be resizable with the mouse: height via the bottom tongue-grip (clamp 25–85% of viewport height), width via side grips on both edges resizing symmetrically about the center line (clamp 420px–96vw). Drags use pointer capture and suspend the slide transition while active. The mobile sheet is not resizable.

- **GIVEN** an open desktop drawer
- **WHEN** the bottom grip is dragged down
- **THEN** the height follows the pointer within the clamp and no transition animates the frames
- **AND WHEN** a side grip is dragged, **THEN** width changes symmetrically and the drawer stays centered

#### R3: Geometry persists per-viewer
The resized geometry SHALL persist in one localStorage JSON key (`runkit-operator-console-geometry`, `{heightVh, widthPx}`), read on mount with try/catch and defaults (55vh, 760px) when absent/invalid/out-of-clamp. No tmux, URL, or server state (Constitution IV).

- **GIVEN** a viewer who resized to 70vh × 900px
- **WHEN** the page reloads and the console reopens
- **THEN** it opens at 70vh × 900px
- **AND GIVEN** a corrupted stored value, **THEN** defaults apply without error

### Affordances

#### R4: Top-bar operator button (desktop standing affordance)
The top bar's right cluster SHALL gain a fixed-size operator button (the shared `TOP_BAR_BUTTON*` size token): the ◉ glyph plus a small live agent-state dot for the console's resolved server's operator window (grey `idle` / green `active` / amber `waiting`; no dot when no operator resolves). Click toggles the console through the existing `OPERATOR_CONSOLE_EVENT` seam. The button renders on fine-pointer top bars on every route and is hidden on mobile; it renders even on operator-less servers (the console hint is the answer). Tooltip/aria name it with the chord. The palette remains the action registry of record (the existing `Operator: Open console` entry is unchanged).

- **GIVEN** a desktop top bar on any route
- **WHEN** it renders with a waiting operator on the resolved server
- **THEN** the ◉ button shows an amber dot and a click opens the console
- **AND GIVEN** a mobile viewport, **THEN** the button is absent

#### R5: Drawer tongue — drag grip on desktop, standing affordance on mobile
A centered pull tab SHALL hang from the drawer's bottom edge: ~64×12px visual on fine pointers with a ≥36px effective coarse hit area. On **desktop** it renders only while the console is open and is the R2 height grip. On **mobile** (`isMobileViewport()`) the tongue is instead the STANDING affordance: always visible under the top bar on every route, tap opens the sheet, and it carries an amber dot when the resolved server's operator is `waiting`. No bottom-bar chip is added anywhere (the 375px single-row budget is untouched). The existing overflow-menu row stays.

- **GIVEN** a closed console on mobile
- **WHEN** any route renders
- **THEN** the tongue is visible under the top bar and a tap opens the sheet
- **AND GIVEN** desktop at rest, **THEN** no tongue renders (the ◉ button is the standing affordance)

### Glass

#### R6: Opacity setting — default 0.90, clamp 0.75–1.0, fixed 6px blur
The desktop drawer's background SHALL be `rgba(bg-primary, α)` with a fixed `backdrop-filter: blur(6px)` (+ webkit prefix). α is per-viewer: default **0.90**, clamped 0.75–1.0, stored in localStorage (`runkit-operator-console-opacity`), applied live. α = 1.0 SHALL disable the backdrop-filter entirely. Blur is not configurable. The mobile sheet stays opaque. The embedded terminal becomes see-through via an opt-in transparency prop on `TerminalClient` (xterm `allowTransparency: true` + transparent theme background) used ONLY by the console instance — route/board terminals are untouched.

- **GIVEN** default settings
- **WHEN** the drawer opens over busy terminal output
- **THEN** the background shows through at α 0.90 with 6px blur and the xterm cells are transparent
- **AND GIVEN** α set to 1.0, **THEN** no backdrop-filter is applied
- **AND GIVEN** a route terminal, **THEN** its xterm has no transparency enabled

#### R7: Settings-dialog row, localStorage-backed
The settings dialog SHALL gain an "Operator console opacity" row (slider or stepper honoring the clamp) backed by the localStorage key — a per-viewer client-side resident of the one settings surface, NOT an `internal/settings` registry key and NOT any backend change.

- **GIVEN** the settings dialog
- **WHEN** the opacity row changes to 0.8
- **THEN** an open console reflects it live and the value survives reload
- **AND** no request to `/api/settings` is made

### Image paste

#### R8: Route-terminal paste guard
The document-level file-paste interception in `terminal-client.tsx` SHALL NOT forward to the compose strip when the paste originates inside the console dialog (target-containment check against the console root; verify at apply what `e.target` is when the console's xterm helper textarea or compose textarea is focused, and widen to a console-open check only if containment proves unreliable). Text paste behavior is unchanged everywhere.

- **GIVEN** the console open over a terminal route with an image on the clipboard
- **WHEN** ⌘V fires with focus inside the console
- **THEN** the route terminal's listener does not forward to the compose strip (nothing lands on the tab below)
- **AND GIVEN** focus in the route terminal (console closed), **THEN** the strip forward behaves exactly as today

#### R9: Console file paste — upload to the operator's worktree, stage as insert
The console SHALL bind its own `paste` and `drop` handlers on its root: clipboard/dropped files upload via the existing `uploadFile` client (`POST /api/sessions/{session}/upload`) scoped to the OPERATOR window's session (mirror the compose strip's `useFileUpload` composition), and each returned path is delivered to the operator pane through the send lane as an **insert** (staged into the TUI composer where the `[Image #N]` chip renders), never auto-submitted; the user's typed message then submits normally. In-flight state shows a minimal uploading indicator; failures reuse the inline error line. With no operator window resolved, file paste is a no-op (the hint line is the answer).

- **GIVEN** an open console with a resolvable operator and an image on the clipboard
- **WHEN** ⌘V fires in the console
- **THEN** exactly one upload posts to the operator window's session and one insert-mode send delivers the returned path
- **AND** no submit fires until the user sends their message
- **AND GIVEN** an upload failure, **THEN** the inline error line shows it and nothing is delivered

### Parked review debt (qa85)

#### R10: Shared route-server hook + button idiom
`useCurrentServerFromRoute` SHALL be exported from `contexts/session-context.tsx` and reused by `operator-console.tsx` and `app.tsx`'s `LayoutCommandPalette` (both inlined param walks deleted). The console's Send/✕ buttons SHALL adopt the compose strip's idiom: `coarse:` touch-target sizing (≥36px) and the `rk-glint` hover treatment.

- **GIVEN** the change is applied
- **WHEN** grepping for the deepest-first `server`-param walk
- **THEN** exactly one implementation exists (the exported hook) with three consumers
- **AND** the console buttons carry `coarse:` sizing + `rk-glint`

### Non-Goals

- No bottom-bar chip; no blur setting; no registry/settings-API key; no backend diff
- No mobile-sheet glass or resize; sheet stays full-height and opaque
- qa85's nice-to-haves (render-phase ref write, pendingSend race) only if touched lines overlap

### Design Decisions

#### Tongue serves mobile instead of a bottom-bar chip
**Decision**: on mobile the tongue under the top bar is the standing affordance; no bottom-bar button.
**Why**: the bottom bar exists only on terminal tty views and its 375px single-row budget is fixed; the tongue costs no bar space and works on every route.
**Rejected**: a bottom-bar chip (budget + route-scope); hover-reveal (invisible — contradicts the "visual indication" goal).
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste

#### Opacity is a localStorage-backed settings-dialog row
**Decision**: per-viewer localStorage key surfaced in the settings dialog; blur fixed at 6px.
**Why**: Constitution IV layering (per-viewer → localStorage) while honoring "exposed in settings" — the dialog is the one settings surface and already hosts client-side residents (shortcuts). α=1 disables the filter for a zero-cost opaque path.
**Rejected**: an `internal/settings` registry key (per-instance daemon config — wrong layer); a console-strip-only control (user asked for settings).
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste

#### Attachments deliver as insert, not submit
**Decision**: console file paste uploads then delivers the path as a send-lane insert; the user's Enter submits.
**Why**: mirrors the TUI-composer staging behavior (the `[Image #N]` chip) the injection engine's echo probe already recognizes (#821); auto-submitting an image without its message would be wrong.
**Rejected**: append-path-to-console-textarea (the path would ride the API submit as plain text — same result but the user sees raw paths and can mangle them); auto-submit per file.
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste

## Tasks

### Phase 1: Setup

- [x] T001 Export `useCurrentServerFromRoute` from `app/frontend/src/contexts/session-context.tsx`; consume it in `app/frontend/src/components/operator-console.tsx` and `app.tsx`'s `LayoutCommandPalette`, deleting both inline param walks; adjust colocated tests <!-- R10 -->
- [x] T002 [P] Add per-viewer stores in `app/frontend/src/lib/operator-console.ts`: geometry (`runkit-operator-console-geometry`, `{heightVh, widthPx}`, clamps + try/catch defaults) and opacity (`runkit-operator-console-opacity`, clamp 0.75–1.0, default 0.90) with subscribe/notify (the `use-local-storage-enum.ts` pub/sub pattern); unit tests <!-- R3 -->

### Phase 2: Core Implementation

- [x] T003 Slide transition in `operator-console.tsx` + `globals.css`: closing-state machinery (exit class, `transitionend` unmount + timeout fallback), replace `rk-console-drop` keyframe with the transform transition, extend the reduced-motion rule to zero both directions and skip the exit delay <!-- R1 -->
- [x] T004 Resize grips in `operator-console.tsx`: bottom tongue-grip (height) + symmetric side grips (width), pointer capture, transition suspension during drag, clamps, persist via T002's geometry store <!-- R2 -->
- [x] T005 Glass: rgba background driven by the opacity store, fixed 6px backdrop-filter (+webkit) disabled at α=1; add an opt-in transparency prop to `app/frontend/src/components/terminal-client.tsx` (xterm `allowTransparency` + transparent theme background) consumed only by the console's instance <!-- R6 -->
- [x] T006 Top-bar ◉ button: add to the right cluster with the `TOP_BAR_BUTTON*` token (fine-pointer only), live agent-state dot from the resolved server's operator window, `OPERATOR_CONSOLE_EVENT` toggle dispatch, aria/tooltip with chord; colocated tests <!-- R4 -->
- [x] T007 Tongue component in `operator-console.tsx` (+ a standing mobile mount beside the console in the root layout): desktop = drag grip while open (T004's height grip); mobile = always-visible opener under the top bar with the waiting amber dot and ≥36px coarse hit area <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Settings dialog row "Operator console opacity" (slider/stepper honoring the clamp) in `app/frontend/src/components/settings-dialog.tsx` (or its panel component), backed by T002's opacity store; colocated tests assert no `/api/settings` call <!-- R7 -->
- [x] T009 Paste guard in `terminal-client.tsx`: skip the compose-strip forward when the paste event originates inside the console dialog (target containment against the console root; verify targets at apply and widen to console-open only if needed); unit-test the predicate <!-- R8 -->
- [x] T010 Console file paste/drop: root-level handlers uploading via `uploadFile` scoped to the operator window's session (mirror `useFileUpload` composition), insert-mode delivery of returned paths, uploading indicator + inline-error reuse, operator-less no-op <!-- R9 -->
- [x] T011 Console Send/✕ buttons: `coarse:` touch targets + `rk-glint` per the compose strip idiom <!-- R10 -->
- [x] T012 E2E: extend `app/frontend/tests/e2e/operator-console.spec.ts` (intent comments per constitution) — slide open/close (class/visibility semantics incl. mounted-through-exit), resize drag persists geometry across reload, opacity setting live-applies (computed style) and survives reload, top-bar button + state dot, mobile tongue opens the sheet, console image paste routes to the operator upload (mocked route with trailing-`*` glob) while the tab below receives nothing, route-terminal paste still reaches the strip when the console is closed <!-- R1 -->

### Phase 4: Polish

- [x] T013 Gates: `cd app/frontend && npx tsc --noEmit`; targeted Vitest for touched suites; changed-surface e2e via `just test-e2e "operator-console"` plus sibling sweeps (`top-bar-overflow`, `top-bar-overlap`, `settings`, `compose-strip`-touching specs, `mobile-layout`); `cd app/backend && go test ./...` expected untouched <!-- R1 -->

## Execution Order

- T001, T002 first (T002 blocks T004/T005/T008)
- T003 → T004 → T005 (same file, sequential); T006, T007 after T003
- T009 → T010 (guard before feature); T012 after all features; T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Drawer slides translateY(-102%)↔0 ~240ms both directions; unmount waits for the exit transition; reduced-motion is instant
- [x] A-002 R2: Height grip clamps 25–85vh; width grips resize symmetrically, clamp 420px–96vw; transition suspended during drag
- [x] A-003 R3: Geometry persists in `runkit-operator-console-geometry` with safe fallbacks
- [x] A-004 R4: Top-bar ◉ button (TOP_BAR_BUTTON token, fine-pointer only) with live state dot toggles the console; renders on operator-less servers; absent on mobile
- [x] A-005 R5: Tongue = desktop drag grip while open; mobile standing opener with waiting dot and ≥36px coarse hit area; no bottom-bar chip anywhere
- [x] A-006 R6: α default 0.90 clamp 0.75–1.0 live-applied; blur fixed 6px, off at α=1; only the console's TerminalClient enables transparency
- [x] A-007 R7: Settings-dialog opacity row is localStorage-backed; no settings API call
- [x] A-008 R8: Console-origin file pastes never reach the compose strip; closed-console behavior byte-identical
- [x] A-009 R9: Console file paste uploads to the operator window's session and insert-delivers the path; no auto-submit; failures inline; operator-less no-op

### Behavioral Correctness

- [x] A-010 R1: No stream teardown mid-exit (WS close fires after transitionend/unmount)
- [x] A-011 R8/R9: With the console open, ⌘V of an image lands in the operator composer — and nothing lands on the underlying tab

### Scenario Coverage

- [x] A-012 R1/R2/R6: E2E covers slide semantics, resize-persist-reload, opacity live-apply (mocked/computed style)
- [x] A-013 R9: E2E covers the paste routing split (console open vs closed) with mutating routes mocked (trailing-`*` glob)
- [x] A-014 R5: E2E covers the mobile tongue at 375px (visible, opens sheet, no horizontal overflow)

### Edge Cases & Error Handling

- [x] A-015 R3/R6: Corrupt/out-of-clamp stored values degrade to defaults without error (localStorage try/catch)
- [x] A-016 R9: Upload failure surfaces inline and delivers nothing; multi-file paste uploads each and inserts each path once

### Code Quality

- [x] A-017 Pattern consistency: token sizes (TOP_BAR_BUTTON), `coarse:` variants, `rk-glint`, the localStorage pub/sub pattern, reduced-motion audit entries updated
- [x] A-018 No unnecessary duplication: one route-server hook (three consumers), reuse `uploadFile`/`useFileUpload` composition and the send lane — no new upload or delivery paths
- [x] A-019 No client polling; no new `as` casts beyond existing patterns
- [x] A-020 E2E intent comments (Proves/Steps) on every new/changed test; no change-ID citations in code comments
- [x] A-021 No backend diff (git status confirms app/backend untouched)

### Security

- [x] A-022 R9: Uploads go only through the existing `POST /api/sessions/{session}/upload` client; no new endpoints, no path construction from user text

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the two inlined route-server param walks were planned removals executed under T001, not discovered candidates; `rk-console-drop` remains in use by the mobile sheet)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Standing mobile tongue mounts beside the console at the root layout (it must render while the console is closed) | Follows the single-mount pattern; the console itself returns null when closed | S:60 R:85 A:80 D:75 |
| 2 | Confident | Geometry/opacity stores use the module pub/sub localStorage pattern (`use-local-storage-enum.ts` precedent) | Existing idiom for reactive per-viewer prefs | S:65 R:90 A:85 D:80 |
| 3 | Confident | Paste guard = target-containment against the console root, widened only if apply finds focus targets outside it | Narrowest correct rule; apply verifies empirically | S:55 R:80 A:70 D:65 |
| 4 | Confident | Settings row lives in the existing dialog's Appearance panel, This-device section, beside the terminal-font control | One settings surface; per-viewer localStorage residents group under This device (the font stepper precedent) | S:55 R:90 A:75 D:70 |
| 5 | Confident | The ◉ button hides on the shared narrow-OR-coarse `useIsMobile()` rule (not fine-pointer-only), making it exactly complementary to the tongue | R4 says "fine-pointer"; R5 gates the tongue on `isMobileViewport()` — one standing affordance per form factor, no overlap or gap | S:60 R:85 A:80 D:75 |
| 6 | Confident | Insert delivery sends each path with a trailing space (`mode: "raw"`, `target: "agent"`) | Consecutive inserts would otherwise concatenate into one broken token; the trailing space is harmless in a TUI composer | S:55 R:80 A:75 D:65 |
| 7 | Confident | The slide's seam clip rides a dedicated `overflow-clip` wrapper around the console only — the main-area container keeps `overflow: visible` | Clipping the shared main area risks breaking in-page overlays; the wrapper confines the trade-off to the console itself | S:65 R:85 A:85 D:80 |
| 8 | Confident | The mobile tongue's tap dispatches `toggle` (not `open`) | R5 says "tap opens"; toggle matches every other entry point and lets the tongue also close a half-open slide | S:50 R:75 A:70 D:65 |
| 9 | Confident | The mobile sheet keeps the existing 160ms `rk-console-drop` settle-in; the quake slide is desktop-only | R1: "The mobile sheet keeps a simple fast transition (or none)" | S:70 R:90 A:85 D:80 |
| 10 | Confident | The ◉ registry entry overflows with `menuRender: null`, merging into the existing `OperatorConsoleMenuRow` | The UpdateChip precedent — bar/menu can never duplicate; the labeled menu row stays the backup on every route | S:60 R:85 A:80 D:75 |
| 11 | Certain | xterm's textarea/element paste handler calls `stopPropagation()` unconditionally, so the console's file-paste handler is CAPTURE-phase (`onPasteCapture`) and the route terminals' document-level strip forward only ever sees non-xterm-targeted pastes (pre-existing behavior, unchanged) | Verified in `@xterm/xterm` source (`handlePasteEvent`) and empirically in e2e (bubble-phase document listener never fires for xterm-targeted pastes); the R8 containment guard covers the reachable bubble path (console compose textarea) | S:85 R:85 A:85 D:80 |

4 assumptions (0 certain, 4 confident, 0 tentative).

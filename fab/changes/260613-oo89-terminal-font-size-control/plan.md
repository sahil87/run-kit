# Plan: Terminal Font Size Control

**Change**: 260613-oo89-terminal-font-size-control
**Intake**: `intake.md`

## Requirements

### ChromeContext: Persisted terminal font preference

#### R1: Persisted font-size preference with bounds and device default
ChromeContext SHALL own a global terminal font-size preference, stored as a clamped
`number | null` in localStorage under key `runkit-terminal-font-size` (null/absent = unset).
The context SHALL expose an **effective** `terminalFontSize: number` = stored preference if
present, else the device default (11 mobile / 13 desktop). The context SHALL export a
`TERMINAL_FONT_BOUNDS` const (`{ min: 8, max: 24, step: 1 }`) and clamp all stored values into
`[8, 24]`.

- **GIVEN** no `runkit-terminal-font-size` key in localStorage on a desktop viewport
- **WHEN** the provider initializes
- **THEN** `terminalFontSize` resolves to 13 (the desktop device default)
- **AND** on a mobile viewport (narrow width OR coarse pointer) it resolves to 11

#### R2: Increase / decrease mutators (clamped, persisted, unset-aware)
ChromeDispatch SHALL expose `increaseTerminalFont()` and `decreaseTerminalFont()`. Each SHALL
compute `effective ± step`, clamp into `TERMINAL_FONT_BOUNDS`, write the result to localStorage
(try/catch noop on failure), and update React state. The first step from the unset (`null`) state
SHALL operate on the device default and persist a concrete adjacent value.

- **GIVEN** an unset preference on desktop (effective = 13)
- **WHEN** `increaseTerminalFont()` is called
- **THEN** the stored preference becomes 14, persisted to localStorage, and effective = 14
- **AND** repeated increase past 24 stays clamped at 24; repeated decrease past 8 stays clamped at 8

#### R3: Reset = forget preference
ChromeDispatch SHALL expose `resetTerminalFont()` that removes the `runkit-terminal-font-size`
key (`localStorage.removeItem`), returning the internal preference to `null` so effective falls
back to the device default.

- **GIVEN** a stored preference of 18
- **WHEN** `resetTerminalFont()` is called on desktop
- **THEN** the localStorage key is removed and effective reverts to 13 (device default)

### TerminalClient: Apply effective font size

#### R4: Read effective size from context on create
TerminalClient SHALL read `terminalFontSize` from `useChromeState()` and pass it as the xterm
`fontSize` option (and to the `document.fonts.load` preload calls), replacing the local
`isMobile ? 11 : 13` computation.

- **GIVEN** an effective `terminalFontSize` of 16
- **WHEN** a TerminalClient mounts
- **THEN** the xterm Terminal is constructed with `fontSize: 16` and the font preload uses 16px

#### R5: Re-apply on change and refit the PTY
TerminalClient SHALL run an effect that, when `terminalFontSize` changes, sets
`xtermRef.current.options.fontSize = terminalFontSize` and calls `fitAddonRef.current?.fit()`
to recompute rows×cols (resizing the PTY). The effect SHALL guard against a not-yet-initialized
terminal (`xtermRef.current` null). The touch-scroll `LINE_HEIGHT` fallback (which reads
`options.fontSize`) SHALL continue to resolve to the live font size.

- **GIVEN** a mounted, initialized terminal
- **WHEN** `terminalFontSize` changes from 13 to 15
- **THEN** the terminal's `options.fontSize` is set to 15 and `fitAddon.fit()` is invoked
- **AND** if the terminal has not yet initialized, the effect is a no-op (no throw)

### Top-bar: Font-size combo control

#### R6: Combo control with bounds-disabled buttons and reset
TopBar SHALL render a compact combo control near `FixedWidthToggle`: a decrease button, the
effective size label, an increase button, and a reset button. The decrease button SHALL be
disabled when effective ≤ `TERMINAL_FONT_BOUNDS.min`; the increase button SHALL be disabled when
effective ≥ `TERMINAL_FONT_BOUNDS.max`. Buttons SHALL carry aria-labels `Decrease terminal font`,
`Increase terminal font`, `Reset terminal font`, and SHALL use the established top-bar touch sizing
(`coarse:36px` square family).

- **GIVEN** effective font size 13
- **WHEN** the top-bar renders
- **THEN** the label shows `13`, both ± buttons are enabled, and clicking − calls
  `decreaseTerminalFont`, + calls `increaseTerminalFont`, reset calls `resetTerminalFont`
- **AND** at effective 8 the decrease button is disabled; at effective 24 the increase button is disabled

### Command palette: Font-size actions

#### R7: Three palette actions wired to the dispatch fns
The command-palette action lists SHALL include three actions — `terminal-font-increase`
("Increase terminal font"), `terminal-font-decrease` ("Decrease terminal font"),
`terminal-font-reset` ("Reset terminal font") — each wired to the matching dispatch fn, with no
`shortcut` set (Cmd+/- is deliberately not intercepted). They SHALL be present on both the AppShell
palette (`app.tsx`) and the board-route palette (`board-page.tsx`), since the setting is global and
Constitution V requires the palette reachable on every route.

- **GIVEN** the command palette is open on the terminal route
- **WHEN** the user selects "Increase terminal font"
- **THEN** `increaseTerminalFont` is invoked and the palette closes
- **AND** the same three actions are present and wired on the board route palette

### Non-Goals

- UI/HTML-zone scaling (`:root { font-size }`) — deferred.
- Intercepting `Cmd +/-` — browser-native zoom retained as-is; no global keybinding registered.
- Per-pane / per-window font size — global only for v1.
- Cross-restart persistence via tmux `@rk_font_size` — localStorage only for v1.
- Iframe windows — unaffected (separate document owns its own zoom).

### Design Decisions

1. **Preference stored as `number | null`, effective exposed to consumers**: null distinguishes
   "unset" from "happens to equal the default", which is required to implement reset = forget.
   — *Why*: reset semantics demand the unset/default distinction. — *Rejected*: an `isDefault`
   boolean flag (encodes the same bit more clumsily).
2. **Apply via `options.fontSize` + `fitAddon.fit()`**: the correct xterm resize path — recomputes
   rows×cols and resizes the PTY rather than bitmap-scaling the canvas. — *Why*: tmux must render at
   the right grid. — *Rejected*: CSS transform / browser zoom (couples both zones, blurry canvas).
3. **Palette actions on both AppShell and board palettes**: the board route mounts its own palette
   (does not render AppShell), so the actions must be added in both places to stay reachable
   route-wide. — *Why*: Constitution V (keyboard-first, palette on every route). — *Rejected*:
   AppShell-only (board route would lack the keyboard path for a global setting).

## Tasks

### Phase 1: Core State (ChromeContext)

- [x] T001 Add terminal-font constants, helpers, and `TERMINAL_FONT_BOUNDS` export to `app/frontend/src/contexts/chrome-context.tsx` — `TERMINAL_FONT_STORAGE_KEY`, min/max/step/default consts, `clampTerminalFont`, `deviceDefaultFontSize` (reuse `isMobileViewport`), `readTerminalFontSize` (returns `number | null`) <!-- R1 -->
- [x] T002 Add `terminalFontSize: number` (effective) to `ChromeState`; add `increaseTerminalFont`/`decreaseTerminalFont`/`resetTerminalFont` to `ChromeDispatch`; implement the three mutators (preference stored as `number | null`, effective derived via `?? deviceDefaultFontSize()`); wire into the `useMemo` state value + deps and the dispatch object <!-- R1 --> <!-- R2 --> <!-- R3 -->

### Phase 2: Terminal application

- [x] T003 In `app/frontend/src/components/terminal-client.tsx`, read `terminalFontSize` via `useChromeState()` and replace the `isMobile ? 11 : 13` local computation (use it for `Terminal({ fontSize })` and the `document.fonts.load` preload sizes) <!-- R4 -->
- [x] T004 Add a font-apply effect in `terminal-client.tsx` keyed on `terminalFontSize`: guard `xtermRef.current`, set `options.fontSize`, call `fitAddonRef.current?.fit()`; verify the touch-scroll `LINE_HEIGHT` fallback still reads the live `options.fontSize` <!-- R5 -->

### Phase 3: Control surfaces

- [x] T005 [P] Add a `TerminalFontControl` combo to `app/frontend/src/components/top-bar.tsx` near `FixedWidthToggle` — `[−] {size} [+]` + reset; bounds-disabled ± buttons; aria-labels; `coarse:36px` square sizing; uses `useChromeState`/`useChromeDispatch` and `TERMINAL_FONT_BOUNDS` <!-- R6 -->
- [x] T006 [P] Add three palette actions (`terminal-font-increase/decrease/reset`, no shortcut) wired to the dispatch fns in `app/frontend/src/app.tsx` (new `terminalFontActions` group folded into `paletteActions`) <!-- R7 -->
- [x] T007 [P] Add the same three palette actions to `boardRouteActions` in `app/frontend/src/components/board/board-page.tsx` (reuse `useChromeDispatch`) <!-- R7 -->

### Phase 4: Tests

- [x] T008 Add `app/frontend/src/contexts/chrome-context.test.tsx` covering read/clamp/increase/decrease/reset and unset→first-step (null on desktop → 14, persisted), bounds clamping, and reset = removeItem → device default <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T009 Extend `app/frontend/src/components/top-bar.test.tsx` for the combo control: renders label + buttons, ± disabled at bounds, reset reverts to default, ± dispatch persists <!-- R6 -->

## Execution Order

- T001 → T002 (T002 consumes T001's helpers/consts)
- T002 blocks T003/T004 (terminal reads context), T005 (top-bar reads bounds), T006/T007 (palette reads dispatch)
- T003 → T004 (effect builds on the create-path wiring)
- T008 depends on T001/T002; T009 depends on T002/T005
- T005/T006/T007 are mutually independent ([P])

## Acceptance

### Functional Completeness

- [x] A-001 R1: `terminalFontSize` resolves to the stored preference (clamped 8–24) when present, else the device default (11 mobile / 13 desktop); `TERMINAL_FONT_BOUNDS` exported
- [x] A-002 R2: `increaseTerminalFont`/`decreaseTerminalFont` step ±1 from effective, clamp into bounds, and persist to localStorage
- [x] A-003 R3: `resetTerminalFont` removes the localStorage key and effective reverts to the device default
- [x] A-004 R4: TerminalClient constructs xterm with the effective `fontSize` from context (font preload uses the same size)
- [x] A-005 R5: a change to `terminalFontSize` sets `options.fontSize` and calls `fitAddon.fit()`, guarded against an uninitialized terminal
- [x] A-006 R6: top-bar combo renders effective size, ± dispatch correctly, reset dispatches, and ± buttons disable at min/max
- [x] A-007 R7: three palette actions ("Increase/Decrease/Reset terminal font", no shortcut) exist on both AppShell and board palettes wired to the dispatch fns

### Behavioral Correctness

- [x] A-008 R2: the first increase/decrease from the unset (`null`) state operates on the device default and persists a concrete adjacent value (desktop 13 → 14)

### Edge Cases & Error Handling

- [x] A-009 R1: a malformed / out-of-range stored value is clamped on read (e.g., `"999"` → 24, `"3"` → 8); a localStorage read/write throw is swallowed (try/catch noop) without breaking the provider
- [x] A-010 R5: when `terminalFontSize` changes before the terminal initializes, the apply effect is a no-op (no throw)

### Scenario Coverage

- [x] A-011 R1,R2,R3: `chrome-context.test.tsx` exercises read/clamp/increase/decrease/reset and unset→first-step
- [x] A-012 R6: `top-bar.test.tsx` exercises render, bounds-disable, and reset/step dispatch

### Code Quality

- [x] A-013 Pattern consistency: new code follows the `fixedWidth`/`SIDEBAR_WIDTH_BOUNDS` shape (split contexts, `readX` initializer, try/catch localStorage write, exported bounds) and surrounding top-bar button styling
- [x] A-014 No unnecessary duplication: reuses the existing `isMobileViewport()` helper and the already-wired `FitAddon`; no new dependencies
- [x] A-015 Type narrowing over assertions: no `as` casts introduced; `number | null` handled via guards/`??` (code-quality § Frontend)
- [x] A-016 No magic numbers: bounds/defaults live in named consts (code-quality § Anti-Patterns)
- [x] A-017 No polling / no backend change: control is pure client state through ChromeContext; no API, no SSE, no Go touched (frontend-only per intake)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mirror the `fixedWidth`/`SIDEBAR_WIDTH_BOUNDS` ChromeContext shape (split contexts, `readX` initializer, try/catch localStorage write, exported bounds, reuse `isMobileViewport`) | The intake names this pattern explicitly and the code confirms it; the constitution/code-quality mandate "follow existing patterns" | S:95 R:85 A:95 D:95 |
| 2 | Certain | Internal preference is `number \| null` (null = unset); expose effective = preference ?? device default | Intake Assumption 7; reset = forget REQUIRES the unset/default distinction — one faithful representation | S:90 R:80 A:90 D:90 |
| 3 | Confident | Add the three palette actions to the board-route palette (`board-page.tsx`) in addition to AppShell (`app.tsx`) | Setting is global and board panes are live terminals; Constitution V requires the palette reachable on every route, and the board route mounts its own palette (does not render AppShell) — AppShell-only would leave the board route without the keyboard path. Low blast radius (additive array entries) | S:70 R:90 A:85 D:75 |
| 4 | Confident | Reset affordance is a dedicated icon button within the combo (not "click the value to reset") | Intake Assumption 8 + the user's explicit "+,-,reset"; a dedicated control is the conventional, discoverable shape and matches the existing icon-button styling | S:80 R:90 A:80 D:75 |
| 5 | Confident | Extract a `TerminalFontControl` sub-component in top-bar.tsx (mirrors the `FixedWidthToggle` function-component shape) rather than inlining the combo in `TopBar` | The file already factors each control into its own function component (`FixedWidthToggle`, `SplitButton`, `ClosePaneButton`); matching that keeps `TopBar` readable | S:80 R:90 A:90 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative).

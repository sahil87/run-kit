# Intake: True Zen Mode

**Change**: 260820-o8cr-true-zen-mode
**Created**: 2026-08-20

## Origin

Promptless dispatch from a design discussion with the user (decisions below marked as user-decided are final — do not reopen them). Synthesized description:

> **Feature: true zen mode on the terminal route** (supersedes 260819-qwr7's "plain zoom only" scoping, per explicit user request).
>
> **User-reported gap (verified on latest main):** ⇧⌘⏎ ("Toggle zen mode" in the shortcuts overlay) does nothing in the most common state — the `zen-toggle` handler mounts only when `windowParam && !isMobile && renderLayout.order.length > 1` (`app/frontend/src/app.tsx:3585`), i.e. it is just a focused-tile zoom, a deliberate no-op at arity 1. And the command palette has NO entry findable by "zen": the entries are `Layout: Zoom`/`Layout: Unzoom` (`app/frontend/src/lib/palette-layout.ts:147-152`), gated by the same `!isMobile && order.length > 1` (`app.tsx:2904`).
>
> Entering zen HIDES the top bar, the left sidebar, and — at arity > 1 — every tile except the focused one (reuse the focused-tile zoom via the `zoomToggleRef` seam). Zen KEEPS VISIBLE the compose strip and the bottom/status bar. Exit: ⇧⌘⏎ toggles out, plus an always-visible-in-zen "exit zen" button at the bottom-right of the status bar. Esc was considered and REJECTED as a global exit binding. Zen state is TRANSIENT: no URL param, no localStorage. The `zen-toggle` handler mounts at ANY arity on the desktop terminal route. Palette: zen must be findable by searching "zen". Update the `keybindings.test.ts` palette parity invariant to the new mapping.

All code references were re-verified against the tree at intake time (see What Changes for exact current text).

## Why

1. **The pain point**: the shortcuts overlay advertises ⇧⌘⏎ as "Toggle zen mode" (`DEFAULT_BINDINGS` label in `lib/keybindings.ts:252`), but in the most common state — a single-tile `single:tty` layout — the chord does nothing: the handler is gated on `renderLayout.order.length > 1` (`app.tsx:3585`), so no handler mounts and the chord falls through. A user who reads the overlay and presses the chord gets silence. Worse, the palette — the constitution's primary discovery mechanism (Constitution V) — has no entry matching "zen" at all: the only bodies on the zoom seam are `Layout: Zoom`/`Layout: Unzoom`, and even those vanish at arity 1.
2. **The consequence of not acting**: run-kit has no distraction-free mode. The label "zen mode" over a plain zoom is actively misleading (a labeled feature that doesn't exist), and terminal-focused work always carries the top bar + sidebar chrome.
3. **Why this approach**: 260819-qwr7 deliberately rejected compound zen — its DD ("Zen rides the zoom ref seam as a shifted-tier Enter chord", `docs/memory/run-kit/ui/keyboard-and-palette.md`) rejected "a compound zoom + sidebar-collapse gesture" because it *couples transient zoom state with persisted sidebar state*. The user explicitly supersedes that scoping — and the objection is answered on its own terms: zen is a **render-time transient override** that never writes the persisted sidebar preference (`localStorage["runkit-sidebar-open"]` via ChromeContext), never writes `?layout=`/`rk-layout:` state, and never survives a reload. The coupling the DD rejected does not occur.

## What Changes

### 1. Zen state — a transient, app-level override (user-decided semantics)

A new transient zen flag for the desktop terminal route. **User-decided contract (final)**:

- **Entering zen hides**: the top bar (the persistent `RootTopBar` mount in the root layout, `app.tsx:337`), the left sidebar (Shell's `sidebar` stage column, `components/shell/shell.tsx:255` area), and — at arity > 1 — every tile except the focused one (reuse the existing focused-tile zoom via the `zoomToggleRef` seam, `components/surface-layout.tsx:922-931`).
- **Zen keeps visible**: the compose strip (explicitly do NOT hide it) and the bottom/status bar (`components/status-bar.tsx`, the Shell `statusbar` row; the coarse-pointer bottom bar is out of scope — zen is desktop-only and the fine-pointer BottomBar renders nothing).
- **Exit affordances**: ⇧⌘⏎ toggles out, PLUS a small "exit zen" button rendered only while zen is active, at the bottom-right of the status bar (the right host cluster, `data-testid="status-bar-host"`, which already carries the ⌘K and compose hints). **Esc is REJECTED as a global exit binding** (user decision, record permanently): Esc must keep flowing to the terminal pane — vim/menus/readline consume it — so binding it globally would break terminal use; the chord + visible button cover exit.
- **Zen state is TRANSIENT**: no URL param, no localStorage. Persisted sidebar preference (`runkit-sidebar-open`), layout state (`rk-layout:` keys, `?layout=`), and every other chrome preference stay untouched — zen is a render-time override on top of them. Exiting zen (or reloading) restores exactly what the persisted state says. This is what answers 260819-qwr7's original objection to compound zen.
- **Mobile stays excluded** (`isMobileViewport()` — the whole stateful-chord family is desktop-only).

Mechanism sketch (plan decides the exact seam; constraints below are binding): zen state lives with the terminal route's other transient chrome state (AppShell/`app.tsx`). The top bar renders in the ROOT layout, outside AppShell, so the hide must cross that boundary — a context field (the ChromeContext shape, but deliberately NOT persisted) or an equivalent seam. The sidebar hide must be a render-time override in the Shell composition (e.g. Shell taking a transient `zenActive`-style input that collapses the sidebar column to `0 1fr` for the render), NEVER a `setSidebarOpen(false)` call — that setter persists to localStorage. Navigating off the terminal route (board/host/server routes, or `windowParam` gone) must deactivate/render-ignore zen — chrome comes back; those routes never see zen.

### 2. `zen-toggle` chord — mounts at any arity, compound behavior

`app.tsx:3585` currently:

```tsx
"zen-toggle":
  windowParam && !isMobile && renderLayout.order.length > 1
    ? () => layoutZoomToggleRef.current?.()
    : undefined,
```

Drop the `renderLayout.order.length > 1` term — the handler mounts whenever `windowParam && !isMobile`. New behavior:

- **Enter zen** (zen off → on): set the zen flag; at arity > 1, additionally zoom the focused tile via `layoutZoomToggleRef` if not already zoomed, and remember whether zen initiated that zoom.
- **Exit zen** (zen on → off): clear the flag; unzoom ONLY if zen zoomed it — a zoom the user made before entering zen survives exit (decide-and-record: the tracking is one boolean beside the zen flag; the "materially simpler" alternative of always-unzoom was not needed).
- The binding row itself (`lib/keybindings.ts:252` — `Enter`, shifted tier both platforms, `scope: "terminal"`, `ignoreInputs: true`, label "Toggle zen mode") is unchanged; the ⌘Enter/Ctrl+Enter compose-submit disjointness (`classifyComposeEnter`, 260820-ecl4) is untouched.

The plain zoom verb keeps existing on its own: the tile-header ⛶ verb and the `Layout: Zoom`/`Unzoom` palette bodies still drive `layoutZoomToggleRef` directly (zoom without zen). Zooming/unzooming via ⛶ or the palette while zen is active only changes the tile zoom — it does not exit zen.

### 3. Palette — zen findable by "zen" at any arity

New palette entries `View: Enter Zen Mode` / `View: Exit Zen Mode` — exactly one form rendered, keyed on live zen state (the `Layout: Zoom`/`Unzoom` one-form pattern at `lib/palette-layout.ts:147-152`), available at any arity on the desktop terminal route, invoking the same enter/exit body as the chord. Entry ids (e.g. `view-zen-enter`/`view-zen-exit`) are plan's choice; neither id equals the `zen-toggle` actionId, so the shortcut hint is attached explicitly or via the parity map's documented-equivalence route (follow the existing `Layout: Zoom` precedent, which renders no hint — but zen entries SHOULD carry the ⇧⌘⏎ hint if the existing hint plumbing allows it without a new mechanism; decide at plan).

`Layout: Zoom`/`Layout: Unzoom` REMAIN as separate zoom-only entries with their existing `zoomEnabled` gate (`app.tsx:2904` — `!isMobile && renderLayout.order.length > 1`): zoom stays an independent arrangement verb at arity > 1, and removing it would regress multi-tile zoom-only workflows plus its ⛶ header-verb parity.

### 4. Parity invariant — update, not delete

`keybindings.test.ts` "palette parity invariant" (line ~554/582) currently maps `"zen-toggle": ["layout-zoom", "layout-unzoom"]` in its static `PALETTE_RESOLUTIONS` map. Update the row to the new zen entry ids (e.g. `"zen-toggle": ["view-zen-enter", "view-zen-exit"]`). The test itself must be kept and pass.

### 5. Exit-zen status-bar button

In `components/status-bar.tsx`, right host cluster (`status-bar-host`), bottom-right: a small button (e.g. `data-testid="status-bar-exit-zen"`, `aria-label` naming zen exit) rendered ONLY while zen is active, invoking the exit body. Follows the cluster's existing hint-button vocabulary (the ⌘K/compose-hint idiom). The status bar needs access to the zen state + exit callback — a props extension on `StatusBar` (AppShell already composes it, `app.tsx:3868-3874`) or the same context seam as the top bar; plan decides.

### 6. Tests

- **Unit**: zen enter/exit state machine (incl. the zen-initiated-zoom tracking and the arity-1 path), palette entry gating/one-form rendering (the `palette-layout.test.ts`/`palette-view.test.ts` precedent if a pure builder is extracted — extraction into a pure `lib/` module with colocated tests is the established convention), keybindings default-row expectations, and the updated parity invariant.
- **e2e**: a new Playwright spec (UI change — code-quality.md SHOULD) proving: enter via ⇧⌘⏎ → top bar and sidebar hidden, status bar still present with the exit button; exit via the chord AND via the button → chrome restored; persisted sidebar preference unchanged after a zen round-trip (e.g. localStorage `runkit-sidebar-open` untouched / sidebar returns); zen works at arity 1. Sibling `.spec.md` companion doc required (constitution § Test Companion Docs). Run through `just test-e2e`/`just pw` on the port-3020 rig only.

### Out of scope

- Mobile zen (excluded by decision).
- Hiding the compose strip or status bar (explicitly kept visible).
- Any persistence of zen (URL param, localStorage) — explicitly rejected.
- Esc as an exit binding — explicitly rejected (record as a design decision at hydrate).
- Backend/API changes — none; this is frontend-only view state.

## Affected Memory

Verified against the tree (the discussion's provisional list adjusted: the status bar is documented in `status-signals`, not `compose-and-bottom-bar`):

- `run-kit/ui/keyboard-and-palette`: (modify) `zen-toggle` semantics + gate (any arity, compound), the superseded 260819-qwr7 DD ("Zen rides the zoom ref seam…" — rejected compound zen; new DD records the transient-override answer and the Esc rejection), new palette entries, updated parity-map equivalence
- `run-kit/ui/lenses-and-layout`: (modify) zen/zoom relationship (§ Surface Layout → Zoom, § ▦ Layout chip + palette + chords, the "Layout verbs are palette-reachable" DD's zen sentence)
- `run-kit/ui/routes-and-shell`: (modify) Shell grid transient zen override (sidebar column collapse without touching persisted state)
- `run-kit/ui/top-bar`: (modify) persistent root mount gains the zen transient hide
- `run-kit/ui/sidebar`: (modify) transient hide override vs the persisted `runkit-sidebar-open` preference
- `run-kit/ui/status-signals`: (modify) exit-zen button in the status bar's right host cluster
- `run-kit/ui/compose-and-bottom-bar`: (modify) note that the compose strip is deliberately kept visible in zen (may reduce to a cross-reference if hydrate finds the zen section elsewhere covers it)

## Impact

- **Frontend only** (`app/frontend/src/`): `app.tsx` (zen state, chord handler, palette wiring, StatusBar/Shell/TopBar composition), `components/shell/shell.tsx` (sidebar column transient collapse), the top-bar render path (root layout hide seam — `RootTopBar` or a wrapper), `components/status-bar.tsx` (exit button), `lib/palette-layout.ts` or a sibling pure module (zen palette entries), `lib/keybindings.test.ts` (parity map), plus new unit tests and one new e2e spec + `.spec.md`.
- **No backend, no API, no routes** (Constitution IV untouched — no new page), no persistence (Constitution II posture: no new state store; zen is ephemeral view state).
- **Risk areas**: the top bar mounts in the root layout OUTSIDE AppShell — the hide seam crosses that boundary and must not flash on route transitions; Shell's sidebar column transition (150ms ease-out) will animate the zen collapse for free but must not leave the 6px column-gap seam; xterm refit (ResizeObserver → fit → PTY resize) fires on the geometry change — the existing reflow class, no new handling expected.

## Open Questions

- None blocking. Decide-and-record points (exact seam for the cross-boundary hide, palette entry ids, hint rendering on the zen entries, chrome-toggle interplay while in zen) are graded in Assumptions and resolved at plan.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Zen hides top bar + sidebar + (arity > 1) non-focused tiles via the existing zoom seam; keeps compose strip + status bar visible | User-decided, verbatim from the design discussion — final | S:95 R:70 A:95 D:95 |
| 2 | Certain | Esc is NOT a zen exit binding; exit = ⇧⌘⏎ + the status-bar exit button | User-decided with rationale (Esc must reach the pane — vim/menus/readline); record as DD | S:95 R:80 A:95 D:95 |
| 3 | Certain | Zen is transient — no URL param, no localStorage; a render-time override that never writes persisted sidebar/layout state | User-decided; also the precise answer to 260819-qwr7's rejected-coupling objection | S:95 R:75 A:90 D:90 |
| 4 | Certain | `zen-toggle` handler mounts at any arity on `windowParam && !isMobile`; mobile stays excluded | User-decided; the arity term at app.tsx:3585 is dropped | S:95 R:80 A:95 D:95 |
| 5 | Certain | Palette gains zen entries findable by "zen", one form rendered keyed on live zen state, any arity on desktop terminal route | User-decided; one-form pattern verified at palette-layout.ts:147-152 | S:90 R:85 A:90 D:90 |
| 6 | Certain | The parity invariant in `keybindings.test.ts` is updated (not deleted) to map `zen-toggle` to the new zen entry ids | User-decided; map verified at keybindings.test.ts:582 | S:90 R:90 A:95 D:90 |
| 7 | Certain | New e2e spec + sibling `.spec.md` companion; unit tests for the state machine and palette entries | code-quality.md (tests MUST cover changed behavior; UI SHOULD have e2e) + constitution § Test Companion Docs | S:85 R:90 A:95 D:90 |
| 8 | Confident | Exit unzooms only a zen-initiated zoom (one tracked boolean); a zoom the user made before entering zen survives exit | User preferred this unless always-unzoom is materially simpler; tracking is trivial, so the preferred form wins | S:75 R:85 A:75 D:70 |
| 9 | Confident | `Layout: Zoom`/`Unzoom` remain separate zoom-only entries with their existing arity>1 gate; zen entries are added alongside | Removing them would regress multi-tile zoom-only workflows and the ⛶ verb's palette parity; user left this open | S:70 R:90 A:70 D:65 |
| 10 | Confident | Zen state lives in the terminal route (app.tsx) and reaches the root-layout top bar + Shell via a context/prop seam that is never persisted; sidebar hide is a render-time column collapse, never `setSidebarOpen` | `setSidebarOpen` persists to `runkit-sidebar-open` — forbidden by the transient contract; exact seam is plan's choice | S:65 R:80 A:80 D:70 |
| 11 | Confident | Zen persists across window switches within the terminal route; leaving the terminal route (board/host/server) deactivates it | Transient app-level chrome state naturally spans window switches; off-route the gate unmounts and those routes must render normal chrome | S:45 R:80 A:65 D:60 |
| 12 | Confident | Chrome-affecting actions while in zen (⌘B sidebar chord, palette `Sidebar:` entries) are not suppressed; showing the sidebar via ⌘B while in zen overrides the hide for that surface without exiting zen (persisted pref still untouched while zen is active is NOT required — ⌘B keeps its normal persisting semantics; zen simply stops overriding once the user explicitly toggles) | Multiple defensible options; front-runner keeps ⌘B semantics untouched and zen a pure overlay; easily revisited at plan/clarify | S:35 R:80 A:55 D:45 |
| 13 | Certain | Exit-zen button renders only while zen is active, in the status bar's right host cluster (bottom-right), following the cluster's existing button vocabulary | User-decided placement; cluster verified (`status-bar-host`, app.tsx:3868 composition) | S:90 R:85 A:85 D:85 |
| 14 | Confident | Palette entry labels `View: Enter Zen Mode` / `View: Exit Zen Mode` as suggested; ids `view-zen-enter`/`view-zen-exit` | User's suggested form ("e.g.") adopted; trivially renameable | S:80 R:95 A:80 D:80 |
| 15 | Confident | Change scope is frontend-only; no backend/API/route surface | Every touched seam verified frontend-side; Constitution II/IV posture | S:80 R:85 A:90 D:85 |

15 assumptions (8 certain, 7 confident, 0 tentative, 0 unresolved).

# Plan: GUI Desktop — Tile Strip and Launch Palette Rows (G2)

**Change**: 260910-vu4p-gui-desktop-tile-strip-and-palette
**Intake**: `intake.md`

## Requirements

All work is in `app/frontend/`. The backend contract consumed here shipped in G1 (`260910-2jl3`): `event: gui` entries carry `wm` (`""` when bare); `GET /api/gui/{id}` carries `wm` and `wm_hint` (present only when enabled ∧ reachable ∧ bare); `POST /api/gui/{id}/launch {"app":"terminal"|"browser"}` answers `200 {"ok":true,"app","argv0","pid"}` or `200 {"ok":false,"app","hint"}` (a ladder miss is a 200 by design), 400 on a bad body/app, 409 `gui disabled` / `gui is on but not running — see 'rk gui status'`, 500 on a start failure. Every user-visible string below is exact copy from `fab/plans/sahil/26-09-10-gui-desktop.md` § UX.

### Frontend: the host signal and the API client

#### R1: The stream signal carries the window manager
`GuiSignal` (`src/contexts/session-context.tsx`) SHALL gain `wm: string`, narrowed from the payload entry with the existing `guiString` helper so a missing or non-string key reads as `""`.

- **GIVEN** an `event: gui` payload entry `{ id: "host", …, wm: "icewm-session" }`
- **WHEN** the context narrows it
- **THEN** `gui.wm === "icewm-session"`; an entry without a `wm` key narrows to `wm === ""`

#### R2: The status document and the launcher client
`GuiStatus` (`src/api/client.ts`) SHALL gain `wm: string` and `wm_hint?: string`. A new `launchGuiApp(app: GuiLaunchApp, id = "host")` SHALL POST `/api/gui/{id}/launch` with JSON body `{"app": app}` and resolve the parsed body as `GuiLaunchResult` (`{ ok: true; app; argv0; pid } | { ok: false; app; hint }`) on any 2xx, and throw via the existing `throwOnError` path on a non-2xx response.

- **GIVEN** the server answers `200 {"ok":false,"app":"browser","hint":"no browser on the GUI host — sudo apt install chromium-browser"}`
- **WHEN** `launchGuiApp("browser")` is awaited
- **THEN** it resolves `{ ok: false, app: "browser", hint: "no browser on the GUI host — sudo apt install chromium-browser" }` and does not throw
- **GIVEN** the server answers 409 `gui disabled`
- **WHEN** `launchGuiApp("terminal")` is awaited
- **THEN** it rejects with the error the shared `throwOnError` produces

### Frontend: the gui tile's bare-WM strip

#### R3: Render condition and placement
`GuiSurface` (`src/components/gui-surface.tsx`) MUST render a strip with `data-testid="gui-wm-strip"` iff `enabled && reachable && gui.wm === "" && gui.backend !== "screen-sharing"` and the viewer has not dismissed it (R6). The strip MUST be a flex-row child of the existing `data-testid="gui-surface-canvas"` wrapper (already `flex flex-col`), placed **before** the noVNC host `<div ref={hostRef} className="flex-1 min-h-0" />`, so the host div — and therefore noVNC's fit and the SetDesktopSize the focused fine-pointer viewer drives — shrinks by the strip's height with no explicit height math. The strip MUST NOT be an absolute overlay. It MUST NOT render in the unreachable empty state or when `!enabled`.

- **GIVEN** `gui = { enabled: true, reachable: true, backend: "Xtigervnc", wm: "" }` and no stored dismissal
- **WHEN** the tile renders
- **THEN** `gui-wm-strip` is present as the first child of `gui-surface-canvas`, followed by the noVNC host div
- **GIVEN** the same signal with `wm: "icewm-session"`
- **THEN** no `gui-wm-strip` element exists
- **GIVEN** `backend: "screen-sharing"` with `wm: ""`
- **THEN** no `gui-wm-strip` element exists (the macOS mirror has no window manager by construction and no display to install one into)

#### R4: Strip content and actions
The strip SHALL be monospace (`font-mono text-xs`), `role="status"`, and wrap to two lines at phone width. Its content, in order: the text `No window manager on the GUI host`; when the install line (R5) is known, ` — <install line>`; then ` · then ` followed by an inline text button **Restart supervisor** that calls the existing `onRestart` prop (its resolved value is ignored); then, when the install line is known, a **Copy** button (`aria-label="Copy install line"`) that calls `copyToClipboard(<install line>)` from `src/lib/clipboard.ts` with **only the install line** and shows `Copied` for 1.5 s on `true`; then the dismiss button **×** (`aria-label="Dismiss"`). Copy and × SHALL be built with the shared `Control` primitive (`src/components/control.tsx`) or its `controlClass` so coarse-pointer minimum sizes ride the shared token; both are reachable by Tab. No palette rows exist for Copy or Dismiss (the plan's § Constitution mapping row V).

- **GIVEN** the strip is shown with install line `sudo apt install --no-install-recommends icewm`
- **WHEN** the user reads it
- **THEN** its text content is `No window manager on the GUI host — sudo apt install --no-install-recommends icewm · then Restart supervisor` plus the `Copy` and `×` buttons
- **WHEN** the user activates **Copy**
- **THEN** `copyToClipboard` is called exactly once with `sudo apt install --no-install-recommends icewm` and the button reads `Copied` for 1.5 s
- **WHEN** the user activates **Restart supervisor**
- **THEN** `onRestart` is called once

#### R5: The install line comes from the status document, once per bare transition
When the R3 condition (ignoring dismissal) becomes true, the tile SHALL call `fetchGuiStatus()` **once** for that transition and store `wm_hint ?? ""` as the install line — the same once-per-transition, never-polled grammar as the existing reason fetch (a `*FetchedRef` guard, re-armed by the StrictMode-replay cleanup, a `cancelled` flag on late resolution). A failed GET leaves the install line unknown; the strip still renders with the install-line segment and the Copy button omitted. The frontend MUST NOT hardcode any package-manager wording. `wm` becoming non-empty or `reachable` becoming false re-arms the transition and clears the stored line.

- **GIVEN** the bare condition becomes true and `GET /api/gui/host` answers `{ …, wm: "", wm_hint: "sudo apt install --no-install-recommends icewm" }`
- **WHEN** the component re-renders several times
- **THEN** the GET fired exactly once and the strip shows the install line
- **GIVEN** the GET rejects
- **THEN** the strip renders `No window manager on the GUI host · then Restart supervisor` with `×` and no `Copy`

#### R6: Per-viewer dismissal
`src/lib/gui-posture.ts` SHALL gain `readGuiWmStripDismissed(): boolean` and `writeGuiWmStripDismissed(dismissed: boolean): void` over the localStorage key `runkit-gui-wm-strip-dismissed` (value `"1"` when dismissed; the key is removed otherwise), both try/catch-guarded like the sibling view/lock helpers. The tile reads the flag on mount; **×** sets it and hides the strip; an effect observing `gui.wm` MUST clear the flag (state and storage) whenever `wm !== ""`. A `reachable` flip MUST NOT clear it.

- **GIVEN** the strip is shown
- **WHEN** the user activates **×**
- **THEN** the strip is gone and `localStorage["runkit-gui-wm-strip-dismissed"] === "1"`; a remount with that key set renders no strip while the host stays bare
- **GIVEN** the flag is set
- **WHEN** the signal flips to `wm: "icewm-session"`
- **THEN** the key is removed, so a later bare state shows the strip again

### Frontend: the launch palette rows

#### R7: `GUI: Open terminal` / `GUI: Open browser`
`GuiPaletteInput` (`src/lib/palette/gui.ts`) SHALL gain `reachable: boolean`, `backend: string`, and `onLaunch: (app: GuiLaunchApp) => void`. `buildGuiActions` SHALL push `{ id: "gui-open-terminal", label: "GUI: Open terminal" }` and `{ id: "gui-open-browser", label: "GUI: Open browser" }` — in that order, immediately after `GUI: Turn off` and before the tile-open verbs — iff `enabled && reachable && backend !== "screen-sharing"`, independent of `tileOpen`; their `onSelect` calls `onLaunch("terminal")` / `onLaunch("browser")`. `app.tsx` SHALL supply `reachable`/`backend` from the host signal and an `onLaunch` that calls `launchGuiApp(app)`; on `ok:false` it toasts the server's `hint` verbatim as an error toast via the existing `useToast().addToast`; on success it shows no toast; on a thrown error it toasts `err.message` (fallback `Failed to open <app>`). The file-header comment of `gui.ts` SHALL list the two rows with their gate.

- **GIVEN** `enabled: true, reachable: true, backend: "Xtigervnc"`
- **WHEN** `buildGuiActions` runs with `tileOpen: false`
- **THEN** the result contains `gui-open-terminal` then `gui-open-browser`, right after `gui-turn-off`
- **GIVEN** `reachable: false`, or `backend: "screen-sharing"`, or `enabled: false`
- **THEN** neither row is present
- **GIVEN** the user selects `GUI: Open browser` and the server answers `{"ok":false,"hint":"no browser on the GUI host — sudo apt install chromium-browser"}`
- **THEN** an error toast containing that hint appears and nothing else changes

### Docs: the spec

#### R8: `docs/specs/gui.md` documents the tile
The spec SHALL gain a `## The tile` section (after `## Availability vs reachability`) carrying the three tile states — reachable + WM present (the canvas; the IceWM taskbar is the affordance), reachable + bare (the strip: its exact copy, Copy, ×, the `runkit-gui-wm-strip-dismissed` key and its `wm`-non-empty clearing rule, the macOS exclusion, the flex placement that subtracts it from the fit), unreachable (the existing empty state) — and the two palette rows with their gate and `ok:false` toast. The `## The switch` entry-point table's Palette row SHALL mention the launch rows.

- **GIVEN** a reader of `docs/specs/gui.md`
- **WHEN** they look for what the tile shows on a host without a window manager
- **THEN** `## The tile` answers it with the exact strip copy and the dismiss rule

### Non-Goals

- Backend changes of any kind — the `wm`/`wm_hint`/`launch` contract is G1's and is consumed as shipped.
- Auto-installing a window manager or a browser; a theme editor; a "no apps yet" overlay (G-D9).
- Launch support on the macOS mirror backend (the rows are hidden there; the display is view-only and has no WM).
- Palette rows for the strip's Copy/Dismiss (Tab-reachability suffices per the plan's Constitution mapping).
- Extending the Xvnc-gated real-rig Playwright test — a rig-level bare state needs a `PATH` without every ladder rung and is the plan's manual acceptance on this VM.
- Memory edits — hydrate owns `docs/memory/` (the intake's Affected Memory lists the four files).

### Design Decisions

#### The strip and the launch rows are hidden on the screen-sharing backend
**Decision**: both the bare-WM strip and the `GUI: Open …` rows require `backend !== "screen-sharing"` in addition to `enabled && reachable` (and `wm === ""` for the strip).
**Why**: the macOS mirror backend stamps no window manager, so `wm` is `""` there by construction and every macOS viewer would otherwise see a false "no window manager" strip; the mirror is view-only with no X display, so a launch can only miss. G-D9 keeps the macOS branch untouched on the backend, so the frontend carries the guard.
**Rejected**: keying on `wm_hint` presence alone (the backend also fills it on darwin, so it does not discriminate); a backend change to stamp a sentinel (out of G2's scope and G-D9's).
*Introduced by*: 260910-vu4p-gui-desktop-tile-strip-and-palette

#### The install line rides the status document, fetched once per bare transition
**Decision**: the tile fetches `GET /api/gui/host` once when the bare condition becomes true and reads `wm_hint`; the strip renders without the line (and without Copy) while it is unknown.
**Why**: the stream entry carries `wm` but not the hint; the hint is package-manager-aware wording built server-side (G-D2), so the frontend must not hardcode `sudo apt …`; the once-per-transition never-poll rule is the tile's existing grammar for the unreachable reason.
**Rejected**: adding `wm_hint` to the stream entry (a backend change, and per-tick repetition of a static string); hardcoding the apt line in the frontend (wrong on dnf/pacman hosts).
*Introduced by*: 260910-vu4p-gui-desktop-tile-strip-and-palette

#### The strip is a flex sibling above the noVNC host, never an overlay
**Decision**: the strip is rendered as a flex-row child before the `flex-1 min-h-0` host div inside the existing `flex-col` canvas wrapper.
**Why**: noVNC observes the host div for `scaleViewport`/`resizeSession`, so the flex layout subtracts the strip from the fit and SetDesktopSize (parent D7) sees the reduced height without any measurement code; an overlay would hide desktop pixels behind text.
**Rejected**: an absolute-positioned banner (covers the taskbar area of the desktop); measuring the strip and passing an offset to noVNC (unnecessary — the layout already does it).
*Introduced by*: 260910-vu4p-gui-desktop-tile-strip-and-palette

## Tasks

### Phase 1: Setup

- [x] T001 `src/api/client.ts`: add `wm: string` and `wm_hint?: string` to `GuiStatus`; add `GuiLaunchApp`, `GuiLaunchResult`, and `launchGuiApp(app, id = "host")` (POST `/api/gui/{id}/launch`, JSON body `{"app": app}`, parsed body on 2xx, `throwOnError` on non-2xx). Add vitest cases in `src/api/client.test.ts` (or a colocated gui block) for the `ok:false` resolve and the 409 throw. <!-- R2 -->
- [x] T002 [P] `src/contexts/session-context.tsx`: add `wm: string` to `GuiSignal`; fill it in `narrowGuiEntry` with `guiString(e.wm)`. Extend the existing session-context gui narrowing test with the present/absent `wm` cases. <!-- R1 -->
- [x] T003 [P] `src/lib/gui-posture.ts`: add `readGuiWmStripDismissed`/`writeGuiWmStripDismissed` over `runkit-gui-wm-strip-dismissed` (`"1"` / removed), try/catch-guarded; update the module header comment; add cases to `src/lib/gui-posture.test.ts`. <!-- R6 -->

### Phase 2: Core Implementation

- [x] T004 `src/components/gui-surface.tsx`: render the bare-WM strip (`data-testid="gui-wm-strip"`, `role="status"`) as the first child of the `gui-surface-canvas` wrapper before the host div when `enabled && reachable && gui.wm === "" && gui.backend !== "screen-sharing" && !dismissed`; the once-per-bare-transition `fetchGuiStatus()` for `wm_hint` mirroring the reason-fetch ref/cleanup grammar; the segments and exact copy; the inline `Restart supervisor` text button on `onRestart`; `Copy` via `copyToClipboard` with the `Copied` 1.5 s flip; `×` dismiss through the T003 helpers; the `wm !== ""` effect that clears the dismissal. Update the component's header doc comment with the new content state. <!-- R3 R4 R5 R6 -->
- [x] T005 `src/components/gui-surface.test.tsx`: add the strip cases — WM present ⇒ no strip; bare ⇒ strip with the exact text, install line from the mocked `wm_hint`, one status GET per transition; bare + `screen-sharing` ⇒ no strip; failed GET ⇒ strip without the install segment and without Copy; Copy calls the mocked `copyToClipboard` with exactly the install line and flips the label; Restart supervisor calls `onRestart`; × hides the strip and writes the key; remount with the key set ⇒ no strip; a `wm` flip to non-empty removes the key; the strip precedes the host div in DOM order. <!-- R3 R4 R5 R6 -->
- [x] T006 [P] `src/lib/palette/gui.ts`: add `reachable`, `backend`, `onLaunch` to `GuiPaletteInput`; push `gui-open-terminal` / `gui-open-browser` after `gui-turn-off` iff `enabled && reachable && backend !== "screen-sharing"`; update the header comment. Extend `src/lib/palette/gui.test.ts`: the four gating cases, `tileOpen` independence, ordering, and `onSelect` routing to `onLaunch`. <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 `src/app.tsx`: pass `reachable: gui?.reachable === true`, `backend: gui?.backend ?? ""`, and `onLaunch` (calls `launchGuiApp(app)`; `ok:false` ⇒ `addToast(r.hint, "error")`; success ⇒ no toast; rejection ⇒ `addToast(err.message || \`Failed to open ${app}\`, "error")`) into the `buildGuiActions` call; import `launchGuiApp`. Update the `useMemo` deps if new values are read. <!-- R7 -->
- [x] T008 `tests/e2e/gui-surface.spec.ts` (ungated mocked half only; file-header and per-test Proves/Steps intent comments, no change IDs): add `wm: ""` to `GUI_OFF`/`GUI_ON_UNREACHABLE`; add `GUI_ON_BARE` (reachable, `wm: ""`) and `GUI_ON_ICEWM` (`wm: "icewm-session"`); let `mockGuiBackend` take the `/api/gui/host` document (the bare one carries `wm: ""` and `wm_hint: "sudo apt install --no-install-recommends icewm"`); update `GUI_REASON` to `no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm`. New tests — desktop: strip visible with the exact text, Copy puts exactly the install line on the clipboard (`context.grantPermissions(["clipboard-read","clipboard-write"])`), `emitGui(GUI_ON_ICEWM)` removes it; desktop: × hides it, `page.reload()` keeps it hidden, `emitGui(GUI_ON_ICEWM)` then `emitGui(GUI_ON_BARE)` brings it back; mobile 375 px: strip and both buttons visible and tappable, × hides it; desktop palette: rows present with `GUI_ON_BARE`, absent with `GUI_ON_UNREACHABLE`, selecting `GUI: Open browser` against a `POST /api/gui/host/launch` stub answering `{"ok":false,"app":"browser","hint":"no browser on the GUI host — sudo apt install chromium-browser"}` toasts the hint and sent body `{"app":"browser"}`. <!-- R3 R4 R5 R6 R7 -->

### Phase 4: Polish

- [x] T009 `docs/specs/gui.md`: add `## The tile` after `## Availability vs reachability` with the three states, the exact strip copy, Copy/×, the dismiss key and clearing rule, the macOS exclusion, the flex placement, and the two palette rows with their gate and `ok:false` toast; extend the `## The switch` table's Palette row with the launch rows. <!-- R8 -->
- [x] T010 Run the verification gates from `app/frontend`: `npx tsc --noEmit`; from the repo root `just test-frontend`, `just test-e2e "gui-surface"`, then `just test` and `just build`; fix anything red. <!-- R1 R2 R3 R4 R5 R6 R7 -->

## Execution Order

- T001–T003 are independent and precede T004 (the strip uses T003's helpers and T001's `GuiStatus.wm_hint`) and T006/T007 (which use T001's `launchGuiApp`).
- T004 blocks T005; T006 blocks T007; T008 follows T004 and T007 (it drives both the strip and the palette rows).
- T009 is independent of code; T010 is last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GuiSignal.wm` exists and `narrowGuiEntry` fills it (`""` when absent).
- [x] A-002 R2: `GuiStatus` carries `wm` and optional `wm_hint`; `launchGuiApp(app, id = "host")` POSTs the right URL and body, resolves the parsed `ok:true`/`ok:false` body on 2xx, throws on non-2xx.
- [x] A-003 R3: the strip renders iff `enabled && reachable && wm === "" && backend !== "screen-sharing" && !dismissed`, as the first child of `gui-surface-canvas` before the noVNC host div; never in the empty state.
- [x] A-004 R4: the strip's text is exactly `No window manager on the GUI host — <install line> · then Restart supervisor` with an inline `Restart supervisor` button on `onRestart`, `Copy` (`aria-label="Copy install line"`, copies only the install line via `copyToClipboard`, `Copied` for 1.5 s) and `×` (`aria-label="Dismiss"`), monospace, wrapping allowed.
- [x] A-005 R5: `fetchGuiStatus()` fires once per bare transition and its `wm_hint` becomes the install line; a failed GET leaves the strip without the install segment and without Copy; no package-manager wording is hardcoded in `src/`.
- [x] A-006 R6: `readGuiWmStripDismissed`/`writeGuiWmStripDismissed` exist over `runkit-gui-wm-strip-dismissed`; × persists `"1"`; a remount honors it; `wm !== ""` removes it; a `reachable` flip leaves it.
- [x] A-007 R7: `buildGuiActions` emits `gui-open-terminal` then `gui-open-browser` right after `gui-turn-off` iff `enabled && reachable && backend !== "screen-sharing"`, regardless of `tileOpen`; `onSelect` routes to `onLaunch`.
- [x] A-008 R7: `app.tsx` wires `reachable`/`backend`/`onLaunch`; `ok:false` toasts the hint as an error; success toasts nothing; a rejection toasts `err.message`.
- [x] A-009 R8: `docs/specs/gui.md` has `## The tile` with the three states, the exact strip copy, the dismiss rule, the macOS exclusion, and the palette rows; the switch table's Palette row names the launch rows.

### Behavioral Correctness

- [x] A-010 R3: with `wm: "icewm-session"` the canvas renders exactly as before this change (no strip, no extra fetch).
- [x] A-011 R5: the status GET is not polled — it fires on the transition only, and re-arms only after `wm` becomes non-empty or `reachable` becomes false.

### Scenario Coverage

- [x] A-012 R3 R4 R5 R6: vitest in `gui-surface.test.tsx` covers WM present / bare / bare+dismissed / screen-sharing / failed GET / Copy / Restart / dismiss persistence and clearing / DOM order.
- [x] A-013 R7: vitest in `palette/gui.test.ts` covers the gating cases, ordering, `tileOpen` independence, and `onLaunch` routing; `client.test.ts` covers `launchGuiApp`; the session-context test covers `wm` narrowing.
- [x] A-014 R3 R4 R5 R6 R7: Playwright `gui-surface.spec.ts` ungated half — strip text and clipboard on desktop, dismiss-survives-reload and clearing, mobile 375 px strip, palette rows gating and the `ok:false` toast — each `test()` with a Proves/Steps intent comment and no change IDs; the real-rig test is unchanged.

### Edge Cases & Error Handling

- [x] A-015 R5: a rejected `fetchGuiStatus` never throws out of the component and leaves no stale install line from an earlier transition.
- [x] A-016 R6: a throwing `localStorage` reads as not dismissed and writes are silent noops.
- [x] A-017 R7: `onLaunch`'s promise is `void`-ed with both `then` and `catch` handled — no unhandled rejection on a 409/500.
- [x] A-018 R4: `copyToClipboard` resolving `false` leaves the strip unchanged (no error state, no throw).

### Code Quality

- [x] A-019 Pattern consistency: new code follows the tile's existing ref/effect grammar, the palette builder's omit-not-disable style, and the posture module's try/catch discipline.
- [x] A-020 No unnecessary duplication: `copyToClipboard`, `fetchGuiStatus`, `deduplicatedFetch`/`throwOnError`, `guiString`, the `Control` primitive, and `useToast` are reused; no new clipboard, storage, or fetch helpers.
- [x] A-021 Type narrowing over assertions: payload fields narrow through `guiString`; `launchGuiApp`'s result is a discriminated union on `ok`; no `as` casts added.
- [x] A-022 Tests accompany the change: every new behavior has a vitest or Playwright case; UI changes carry Playwright coverage with intent comments.
- [x] A-023 No magic strings: the storage key, the strip copy fragments, the palette ids/labels, and the `Copied` timeout live in named constants or the existing constant homes.
- [x] A-024 No polling from the client: the strip rides the SSE `wm` field; the status GET is transition-driven only.
- [x] A-025 Comment discipline: comments state constraints (why the macOS guard, why the fetch is once-per-transition), never narrate the next line or cite change IDs.
- [x] A-026 Verification gates green: `npx tsc --noEmit`, `just test-frontend`, `just test-e2e "gui-surface"`, `just test`, `just build`.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Manual acceptance on this VM (not automated — the plan's G2 § Acceptance): hide `icewm-session` and every other ladder rung from the supervisor's `PATH`, `rk gui restart` ⇒ the strip on desktop and at 375 px, Copy yields the apt line, × survives reload; restore `PATH`, `rk gui restart` ⇒ strip gone; `GUI: Open terminal` opens a terminal; `GUI: Open browser` toasts the chromium hint.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. Every touched seam (`onRestart`, `fetchGuiStatus`, `copyToClipboard`, `guiString`, `buildGuiActions`, the posture helpers, the `Control` primitive) is reused, not replaced, and no existing file, function, branch, or config becomes unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Copy and × use the `Control` primitive's chip-class shape (or `controlClass` on a plain button) — the exact `variant`/`size` is chosen at apply against `control.tsx`'s grammar | The intake fixes "the shared button token"; the primitive is that token's home | S:60 R:90 A:75 D:65 |
| 2 | Confident | The Playwright clipboard assertion grants `clipboard-read`/`clipboard-write` on the context and reads back with `navigator.clipboard.readText()` | localhost is a secure context; Chromium honors the permission grant; the ungated half already runs on Chromium | S:65 R:95 A:85 D:80 |
| 3 | Confident | The `Copied` flip uses a 1.5 s timer cleared on unmount | The `tmux-commands-dialog` precedent | S:65 R:95 A:90 D:85 |
| 4 | Confident | The noVNC host div carries a stable `key="novnc-host"` | The strip (a new first child of the canvas wrapper) shifts the host div's sibling index, so a canvas⇄empty-state branch switch lets React reuse its DOM node for a same-position sibling — and the connect effect's cleanup (`hostEl.replaceChildren()`) then wipes THAT element's text (pre-change the same hazard silently wiped the empty state's title line, which no test asserted). The key pins the node's identity so a branch switch unmounts it instead | S:70 R:85 A:80 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).

# Plan: Web Tile Keyboard Capture

**Change**: 260925-xs9b-web-tile-keyboard-capture
**Intake**: `intake.md`

## Requirements

### Posture: Per-viewer web capture latch

#### R1: The `rk-web-capture` latch
The web tile SHALL have its own per-viewer keyboard-capture posture, `rk-web-capture` in localStorage: `"1"` = captured, absent/other = released. It MUST follow the `rk-gui-capture` storage discipline (validated reads, try/catch-noop writes — untrusted-localStorage discipline), be sticky and viewer-global (latching in one window latches in every window for that viewer), and MUST NOT live in `lib/gui-posture.ts` (that module is gui-scoped). The latch MUST never auto-engage and MUST NOT interact with fullscreen or engine flips.

- **GIVEN** a fresh viewer (no stored value)
- **WHEN** the app boots
- **THEN** the web capture latch reads released
- **AND** no interaction ever sets it without an explicit user action (chord, URL-bar button, or palette row)

- **GIVEN** `rk-web-capture` holds a garbage value (e.g. `"yes"`)
- **WHEN** the posture is read
- **THEN** it reads released and no throw escapes

### Keyboard: The shared capture-toggle chord

#### R2: One chord toggles the focused tile kind's latch
The capture-toggle chord (default `KeyG` shifted tier — ⇧⌘G / ⇧Ctrl+G) SHALL toggle the capture latch of whichever tile kind owns focus: gui focus → the gui latch, web focus → the web latch. Its dispatcher handler MUST be present when the focused tile kind is gui OR web and MUST be absent under tty/code focus (the chord falls through untouched there). The registry actionId SHALL remain `gui-capture-toggle` (zero override migration); label/description become surface-neutral.

- **GIVEN** a window with a web tile focused and the web latch released
- **WHEN** the user presses ⇧⌘G (or their rebound toggle chord)
- **THEN** the web latch engages and the gui latch is untouched

- **GIVEN** a gui tile focused with the gui latch released
- **WHEN** the user presses the toggle chord
- **THEN** the gui latch engages and the web latch is untouched

- **GIVEN** the tty (or code) tile owns focus
- **WHEN** the user presses the toggle chord
- **THEN** no handler fires and the chord is never refused to the pane by the terminal seam

#### R3: Gating stays registry data
The toggle binding's "gui or web" surface membership SHALL be expressed as a data flag on the binding (`captureSurface`), consulted by every gate site — `hasReclaimableMatch`, `shouldRefuseTerminalChord`, `buildWebChordTable`, the app.tsx handler-presence gate, and `findConflicts`'s surface-gate disjointness — never as a hardcoded actionId list at those sites. `shouldRefuseTerminalChord` MUST keep filtering the toggle out (its chord stays with the pane under terminal focus). Stored user overrides under `gui-capture-toggle` MUST keep working unchanged.

- **GIVEN** the default registry
- **WHEN** `findConflicts` runs on the resolved defaults
- **THEN** it stays clean (no new conflict from the re-gated toggle)

- **GIVEN** a stored override rebinding `gui-capture-toggle` to another combo
- **WHEN** bindings resolve
- **THEN** the override applies exactly as before this change

### Web tile: Reclaim under capture

#### R4: Iframe engine reclaim narrows to the toggle
While the web latch is engaged, the iframe engine's reclaim path (`hasReclaimableMatch` with kind `"web"` and `captured` set) SHALL reclaim ONLY the capture-toggle binding's chord — every other rk chord (⌘K, ⌘1–4, ⌘B, the `webOnly` ⌘F/⌘L) falls through to the embedded page. Escape is never reclaimed by this engine (it is not a registry binding), so the page's own palette closes with Esc. Cross-origin iframe pages already receive every key; capture is a no-op there.

- **GIVEN** web capture latched and focus inside a same-origin iframe-engine page
- **WHEN** the user presses ⌘K
- **THEN** the keydown reaches the page and rk's palette does NOT open

- **GIVEN** web capture latched in the same posture
- **WHEN** the user presses the toggle chord
- **THEN** it is reclaimed, re-dispatched to the parent document, and the latch releases

#### R5: Native engine chord table under capture
`buildWebChordTable(bindings, { captured })` SHALL emit: released (default) — byte-identical to today's shape, every enabled non-`ttyOnly`/non-`guiOnly` binding expanded per tier, deduped, Escape last (the toggle binding's specs are now included, since it is web-reclaimable); captured — ONLY the toggle binding's effective specs (user rebound combos included) and NO Escape spec, so the embedded app's own ⌘K palette can close with Esc (iframe-engine parity). A disabled/unbound toggle binding yields an empty table under capture. Latching/releasing MUST re-derive and re-upload the table via the existing `web:chords` path; desktop main needs no change.

- **GIVEN** the default registry and capture latched
- **WHEN** the chord table builds
- **THEN** it contains exactly `{KeyG, ctrl, shift}` and `{KeyG, meta, shift}` and no Escape spec

- **GIVEN** the toggle rebound by the user and capture latched
- **WHEN** the chord table builds
- **THEN** it contains exactly the rebound combo's specs

- **GIVEN** capture latched on the native engine
- **WHEN** the user presses Escape inside the guest
- **THEN** main's focus hop does not fire (Escape reaches the guest page)

### Web tile: Chrome

#### R6: URL-bar capture toggle button
The web tile's URL bar SHALL carry a keyboard-capture button immediately after Inspect (`<>`) and before Open-in-browser (`↗`): `… − % + <> ⌨ ↗`. It renders on BOTH engines (not capability-gated), is hidden on the onboarding (empty) tile, and is omitted (not disabled) on coarse pointers. Pressed state uses the gui capture verb's latch-well treatment (`controlClass({ variant: "toggle", …, ringed: true, pressed })`, `aria-pressed`, `KeyboardGlyph`) adapted to the URL bar's 28×28 button box, wrapped in `<Tip label="Keyboard capture" kbd={toggle chord hint} placement="top">`, with `data-testid="web-capture-toggle"` and `aria-label="Keyboard capture"`.

- **GIVEN** a non-onboarding web tile on a fine pointer
- **WHEN** the user clicks the button
- **THEN** the web latch flips and `aria-pressed` reflects the new state

- **GIVEN** an onboarding web tile, or a coarse pointer
- **WHEN** the URL bar renders
- **THEN** the button is absent

#### R7: Header meta swaps to `keys → page`
While the web latch is engaged and the web tile is not onboarding, the web tile header's meta SHALL show the consequence label `keys → page` with the same treatment as the gui latch's `keys → desktop` (green wash + ink, no ring — a label, not a control). The onboarding tile renders no meta chip (unchanged).

- **GIVEN** a web tile with content and the latch engaged
- **WHEN** the tile header renders
- **THEN** the meta chip reads `keys → page` in the green-wash treatment

- **GIVEN** the latch released
- **WHEN** the header renders
- **THEN** the normal meta (address display form) shows

#### R8: Palette row
A pointer-reachable palette row for the web latch SHALL be present when a non-onboarding web tile is open in the rendered layout (`leaves(layout).includes("web")` + `hasWebUrl`) and the pointer is fine (omitted on coarse). The row is state-labelled — `Web: Capture keyboard` / `Web: Release keyboard` (the gui row's pattern) — with description "hand every chord to the page". Its palette id (`web-capture-toggle`) MUST stay unique when a gui tile and a web tile are both open (the gui row carries the shared actionId); the row carries an explicit `shortcut` hint rendering the toggle's effective chord (hand-set hints survive `withShortcutHints`).

- **GIVEN** a window with both a gui tile and a content-bearing web tile open
- **WHEN** the palette renders
- **THEN** both capture rows appear with distinct ids and both show the toggle chord hint

- **GIVEN** an onboarding web tile or a coarse pointer
- **WHEN** the palette renders
- **THEN** the web capture row is absent

#### R9: Three exits, never auto-engaged
The web latch SHALL have exactly three exits — the release chord (both engines, same-origin iframe pages), the URL-bar button, and the palette row — and SHALL never engage by itself. The mouse is never captured.

- **GIVEN** the web latch engaged
- **WHEN** the user activates any of the three exits
- **THEN** the latch releases and rk chords reclaim again (⌘K opens rk's palette)

### Non-Goals

- Code (code-server) iframe capture — the code kind's reclaim is never captured.
- Browser-reserved chords (⌘W/⌘T/⌘N/⌘Q in a browser tab; the desktop shell's menu accelerators) reaching the page — documented known limits, not fixable from the page.
- Cross-origin iframe pages — capture is already a no-op there (rk cannot listen inside them).

### Design Decisions

#### Keep `gui-capture-toggle` as the shared actionId
**Decision**: The shared toggle chord keeps the existing `gui-capture-toggle` actionId; label/description become surface-neutral; no retired-id override mapping is added.
**Why**: Zero override migration — stored user rebinds keep working with no `parseOverrides` change; the id is an internal key, and the surface-neutral copy carries the meaning.
**Rejected**: Renaming to a generic id (e.g. `capture-toggle`) with a retired-id mapping (the `operator-console` → `quake-terminal` precedent) — strictly more machinery for a purely cosmetic gain.
*Introduced by*: 260925-xs9b-web-tile-keyboard-capture

#### The "gui or web" gate is a `captureSurface` data flag
**Decision**: A new optional `captureSurface?: boolean` on `KeyBinding` replaces `guiOnly` on the toggle binding; every gate site (handler presence, reclaim predicate, terminal-seam refusal filter, chord-table filter, conflict disjointness, captured-mode narrowing) consults the flag.
**Why**: The established rule is gating as registry DATA, never actionId lists (`ttyOnly`/`webOnly`/`guiOnly` precedent); one flag keeps all six sites coherent and makes the captured-mode narrowing data-driven too.
**Rejected**: Reusing `webOnly` + `guiOnly` together (a binding is one or the other at every site — the pair would need special-casing everywhere, the opposite of data-driven); an actionId list at the gate sites (the banned pattern).
*Introduced by*: 260925-xs9b-web-tile-keyboard-capture

#### The web palette row carries its own id plus a hand-set hint
**Decision**: The web row's palette id is `web-capture-toggle` (no registry binding by that id); its keycap hint is set explicitly from the `gui-capture-toggle` binding's effective combo at build time.
**Why**: Palette ids must be unique when both tiles are open, and `withShortcutHints` preserves hand-set hints on actions without a registered binding — no registry alias machinery needed.
**Rejected**: An `aliasOf` registry binding for the web row — a keyless alias resolves disabled, so the hint would not render, defeating the purpose.
*Introduced by*: 260925-xs9b-web-tile-keyboard-capture

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/web-posture.ts` — `readWebCapture()` / `writeWebCapture(on)` over the `rk-web-capture` key with the gui-posture storage discipline (validated read, setItem/removeItem write, try/catch-noop) — plus colocated `web-posture.test.ts` mirroring the `rk-gui-capture` tests <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 `app/frontend/src/lib/keybindings.ts`: add `captureSurface?: boolean` to `KeyBinding`; swap `guiOnly: true` → `captureSurface: true` on `gui-capture-toggle` with surface-neutral description ("hand every chord to the focused tile's app"); `hasReclaimableMatch` — captured narrowing matches the `captureSurface` flag, and a `captureSurface` match is reclaimable for kinds `"gui"` and `"web"`; `shouldRefuseTerminalChord` filters `captureSurface` alongside `guiOnly`; `findConflicts` treats `captureSurface` as surface-disjoint with `ttyOnly`; update the flag/predicate doc comments. Extend `keybindings.test.ts`: toggle reclaimable under gui AND web when released, narrowing under captured for kind `"web"` (⌘K/web-find/web-address false, toggle true), never reclaimed for code/tty, never terminal-refused, defaults conflict-free, `gui-capture-toggle` override still applies <!-- R2, R3, R4 -->
- [x] T003 `app/frontend/src/lib/web-chord-table.ts`: `buildWebChordTable(bindings, opts?: { captured?: boolean })` — released keeps today's shape (now including the toggle's specs); captured emits only the `captureSurface` binding's expanded specs and appends no Escape (empty table when the toggle is disabled/unbound). Extend `web-chord-table.test.ts` for both modes and the rebound-toggle case <!-- R5 -->
- [x] T004 `app/frontend/src/app.tsx`: add `webCapture` state + `handleWebCaptureChange` (seed-from-storage + write-through, beside `guiCapture` ~line 1433); `reclaimChordForKind` passes `captured` for kind `"web"` too (`(kind === "gui" && guiCapture) || (kind === "web" && webCapture)`); replace the toggle's `guiGated` handler with a `captureSurface`-gated handler that dispatches by `focusedTileKind` (gui → gui latch, web → web latch) <!-- R1, R2, R4 --> <!-- rework: A-013 unmet — add an app.test.tsx unit test (ServerShell harness) asserting ⇧⌘G/⇧Ctrl+G flips ONLY the focused kind's latch: web focus → rk-web-capture only, gui focus → rk-gui-capture only, handler absent (chord falls through, no latch change) under tty/code focus. Also dedupe the release-chord hint: extract one shared helper (e.g. captureToggleHint(byAction, platform) in lib/keybindings.ts, with a unit test) used by both app.tsx webCaptureActions and iframe-window.tsx captureKbd. Then re-run just test-frontend + tsc and mark A-013 [x]. -->

### Phase 3: Integration & Edge Cases

- [x] T005 `app/frontend/src/components/iframe-window.tsx`: accept `capture` + `onCaptureChange` props; render the URL-bar capture button after Inspect and before ↗ (both engines, `!onboarding && !coarsePointer`, latch-well pressed treatment in the 28×28 box, `Tip` placement top with the toggle's kbd hint, `data-testid="web-capture-toggle"`, `aria-pressed`); feed `{ captured: capture }` into the `buildWebChordTable` memo and its deps. Component tests: button renders/hides per gate, `aria-pressed` reflects the latch, click toggles, chord-table input follows the latch <!-- R5, R6 -->
- [x] T006 `app/frontend/src/components/surface-layout.tsx` + `app/frontend/src/app.tsx` mount: thread `webCapture` / `onWebCaptureChange` from app.tsx through `SurfaceLayout` into the single `IframeWindow` mount; swap the web header meta to `keys → page` with the green-wash treatment while `kind === "web" && webCapture` and the tile is non-onboarding (both badge and non-badge branches). Component test for the meta swap <!-- R6, R7 -->
- [x] T007 `app/frontend/src/lib/palette/web-engine.ts`: add `buildWebCaptureActions({ available, captured, shortcut, onToggle })` → one state-labelled row (`Web: Capture keyboard` / `Web: Release keyboard`, id `web-capture-toggle`, description "hand every chord to the page", hand-set `shortcut`); register in `app/frontend/src/app.tsx` gated on `windowParam && leaves(layout).includes("web") && hasWebUrl(effectiveWindow) && !coarsePointer`, with the hint from the effective `gui-capture-toggle` binding. Unit tests for the builder + a component-level assertion the hint renders alongside the gui row <!-- R8 -->

### Phase 4: Polish

- [x] T008 New e2e spec `app/frontend/tests/e2e/web-tile-capture.spec.ts` (constitution JSDoc intent comments; regex `page.route` stubs for the `?server=` suffix): on a same-origin iframe-engine web tile, latch capture via the button → ⌘K/Ctrl+K inside the page does NOT open rk's palette and the page receives the keydown → release chord → latch releases and ⌘K opens rk's palette again <!-- R4, R9 -->
- [x] T009 Run the gates: `just test-frontend` (full Vitest), `cd app/frontend && npx tsc --noEmit`, `just test-e2e web-tile-capture.spec`, `just test-e2e operator-compose.spec` (palette-count guard) <!-- R9 -->

## Execution Order

- T001 blocks T004 (the posture reader/writer).
- T002 blocks T003 (the chord table's captured mode selects on the new flag), T004 (handler gate + reclaim), and T007 (hint reads the re-gated binding).
- T003 blocks T005 (the memo feeds the button's engine table).
- T004 blocks T006 (the props threaded originate in app.tsx).
- T005 and T007 are independent of each other; T006 depends on T005's props.
- T008, T009 run last, in order.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk-web-capture` persists per-viewer with validated reads and try/catch-noop writes, seeds app state at boot, and never self-engages
- [x] A-002 R2: The toggle chord flips the gui latch under gui focus and the web latch under web focus; no handler exists under tty/code focus
- [x] A-003 R3: Every gate site consults the `captureSurface` flag; no gate site hardcodes the toggle's actionId; existing `gui-capture-toggle` overrides apply unchanged
- [x] A-004 R4: Under web capture on the iframe engine, only the toggle chord is reclaimed; ⌘K, ⌘F, ⌘L, ⌘B, ⌘1–4 reach the page
- [x] A-005 R5: Under capture the native chord table carries only the toggle's specs and no Escape; released it matches the pre-change table plus the toggle's specs
- [x] A-006 R6: The URL-bar button renders on both engines off onboarding on fine pointers, toggles the latch, and shows pressed state
- [x] A-007 R7: The web header meta reads `keys → page` (green wash) while latched and reverts on release; onboarding shows no chip
- [x] A-008 R8: The palette row appears under its gates with a unique id, state label, and rendered chord hint

### Behavioral Correctness

- [x] A-009 R2: `gui-capture-toggle` remains the actionId; a stored override for it resolves exactly as before the change
- [x] A-010 R4: With the latch released, the iframe-engine reclaim predicate is byte-identical to its pre-change behavior on every kind (the toggle's new reclaimability under kind `"web"` is the change's own R2 intent, verified by the kind-parameterized tests; the 2637 test pins default ≡ explicit `false`)
- [x] A-011 R5: Latch flips re-derive and re-upload the native chord table through the existing `web:chords` path with no desktop-main change

### Scenario Coverage

- [x] A-012 R4/R9: e2e — latch via button, ⌘K reaches the page (rk palette stays closed), release chord restores reclaim (⌘K opens rk's palette)
- [x] A-013 R2: Unit — the app.tsx handler dispatch flips only the focused kind's latch (app.test.tsx "gui-capture-toggle chord" suite: web focus → `rk-web-capture` only incl. toggle-off, gui focus → `rk-gui-capture` only, tty/code focus → no handler, no latch change)

### Edge Cases & Error Handling

- [x] A-014 R1: Garbage/unreadable localStorage degrades to released without throwing
- [x] A-015 R5: A disabled/unbound toggle binding yields an empty captured chord table (button and palette row remain the exits)
- [x] A-016 R6/R8: Onboarding tile and coarse pointers render neither the button nor the palette row
- [x] A-017 R4: Cross-origin iframe pages are unaffected (capture is a no-op; no listener attaches) — unchanged attach path; rk cannot listen inside cross-origin frames, by construction

### Code Quality

- [x] A-018 Pattern consistency: New code follows naming and structural patterns of surrounding code (gui-posture discipline, palette builder convention, latch-well control treatment)
- [x] A-019 No unnecessary duplication: `hasReclaimableMatch`, `buildWebChordTable`, `controlClass`, `KeyboardGlyph`, and the `Tip` chrome are reused, not reimplemented
- [x] A-020 Type narrowing over type assertions in the new frontend code
- [x] A-021 New behavior carries unit tests colocated with the source, and the UI change carries Playwright e2e coverage
- [x] A-022 No magic strings: the storage key and palette ids are named constants; comments state constraints/why only and cite no change IDs

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (`guiOnly` stays in use by the gui-zoom trio; `guiGated` still gates those rows in `app.tsx`; every touched seam keeps its prior callers).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep `gui-capture-toggle` as the shared actionId; surface-neutral copy; no retired-id mapping | Simplest option that keeps existing user overrides working — zero migration machinery | S:70 R:90 A:80 D:75 |
| 2 | Confident | The "gui or web" gate is a new `captureSurface?: boolean` flag replacing `guiOnly` on the toggle | Intake's preferred mechanism (gates as registry data); naming is internal and easily revised | S:65 R:85 A:75 D:60 |
| 3 | Confident | The captured-mode narrowing matches the `captureSurface` flag rather than the actionId | Same gates-as-data rule; the flag IS the narrowing target's identity | S:75 R:85 A:85 D:75 |
| 4 | Confident | The web palette row is state-labelled (`Web: Capture keyboard` / `Web: Release keyboard`), not the static `Web: Keyboard capture` | Mirrors the gui row's ONE-state-labelled-row pattern; the label then communicates latch state, which a static label cannot | S:55 R:90 A:60 D:45 |
| 5 | Confident | The web row uses id `web-capture-toggle` with a hand-set `shortcut` hint from the toggle binding's effective combo | `withShortcutHints` preserves hand-set hints on unregistered ids; an `aliasOf` binding would resolve disabled and kill the hint | S:60 R:85 A:75 D:60 |
| 6 | Confident | The posture pair lives in a new `lib/web-posture.ts` module | Intake offered it or `web-engine-pref.ts`; a dedicated module mirrors `gui-posture.ts`'s shape and leaves the engine-pref module single-purpose | S:70 R:90 A:75 D:65 |
| 7 | Confident | The `keys → page` chip renders in both web header branches (badge and non-badge) while latched | The gui treatment is the non-badge chip; badge-kind tabs (present/proxy/external) must show the consequence label too | S:50 R:90 A:60 D:50 |
| 8 | Certain | e2e covers the iframe engine only; the native engine is covered by unit tests over `buildWebChordTable` | The native engine needs the desktop shell's `web` bridge, absent from the Playwright rig; the table logic is pure and fully unit-testable | S:80 R:90 A:85 D:85 |

8 assumptions (2 certain, 6 confident, 0 tentative).

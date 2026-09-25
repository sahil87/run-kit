# Intake: Web Tile Keyboard Capture

**Change**: 260925-xs9b-web-tile-keyboard-capture
**Created**: 2026-09-25

## Origin

Conversational — synthesized from a discussion with the user, then dispatched promptless (`/fab-proceed` create-intake, `promptless-defer`). The user's words:

> Just like on the desktop surface, we have a button that prevents RunKit from eating up all the shortcuts. We need a similar button on the web surface also. This is so that I can type shortcuts into websites or apps that I try out using the inbuilt browser. Right now, I want to press Command K in one of the apps, but what happens is RunKit's own Command K opens up.

("desktop surface" = the GUI tile; its keyboard-capture latch shipped in change 260912-31eg-gui-keyboard-capture.)

Decisions the user made in the conversation:

1. **Separate latch** — the web tile gets its own per-viewer latch `rk-web-capture`, independent of the gui latch `rk-gui-capture`. Rejected: one shared latch — latching capture to type into a website would silently change gui tile behavior (and vice versa).
2. **Reuse the toggle shortcut** — the same Ctrl+Shift+G / ⌘⇧G chord toggles capture for whichever tile kind is focused (gui focus → gui latch, web focus → web latch). Rejected: a separate web-only chord (two chords to remember for one concept).
3. Proceed with the fab pipeline.

## Why

1. **Pain point**: the web tile (rk's inbuilt browser — iframe engine in a browser tab, native Electron `WebContentsView` engine in rk-desktop) reclaims every enabled rk registry chord from the embedded page so rk's chords survive tile focus. That is the right default, but it makes it impossible to use the page's own shortcuts when they collide with rk's — the concrete case: an app under test binds ⌘K to its own command palette, and pressing ⌘K inside the web tile opens rk's palette instead.
2. **Consequence if unfixed**: the web tile cannot be used to try out or develop keyboard-driven web apps (anything with ⌘K palettes, ⌘B, ⌘1–4, ⌘F, ⌘L, …); the user has to leave rk and open a separate browser, defeating the point of the inbuilt browser.
3. **Why this approach**: the gui tile already solved the identical problem with a deliberate, visible, full-pass latch with three exits (memory `gui.md` § Design Decisions → "Keyboard capture is a full-pass latch with three exits, never auto-engaged"). Reusing that exact model keeps one mental model across both "embedded foreign app" surfaces. A reserved-chord allowlist was rejected for gui (no principled line) and the same reasoning applies here. A separate latch (not shared) keeps the two surfaces' postures independent; the shared chord keeps the muscle memory single.

## What Changes

### 1. Per-viewer web capture latch (`rk-web-capture`)

- New per-viewer localStorage posture `rk-web-capture`: `"1"` = captured, absent/other = released — the exact storage + validation discipline of `rk-gui-capture` (`app/frontend/src/lib/gui-posture.ts`: validated reads, try/catch-noop writes, untrusted-localStorage discipline). Sticky and viewer-global (latching in one window latches in every window for that viewer), like its gui sibling.
- Reader/writer pair `readWebCapture()` / `writeWebCapture(on)` — placement is apply's choice: a small web-posture module (e.g. `lib/web-posture.ts`) or alongside existing web prefs (`lib/web-engine-pref.ts` holds `runkit-web-native-engine`). It must NOT go into `gui-posture.ts` (that module is gui-scoped).
- Owned in `app/frontend/src/app.tsx` next to `guiCapture` (~line 1430): `const [webCapture, setWebCapture] = useState(() => readWebCapture())` + `handleWebCaptureChange(on)` writing through — the same seed-from-storage + write-through grammar as `handleGuiCaptureChange`.
- Never auto-engages. No interaction with fullscreen or engine flips.

### 2. Reclaim predicate narrows under web capture (iframe engine)

- `app.tsx:2078` `reclaimChordForKind` today passes `captured` only for kind `"gui"`:
  ```ts
  hasReclaimableMatch(e, keybindings.bindings, kind, kind === "gui" && guiCapture)
  ```
  It becomes kind-aware for web too — `(kind === "gui" && guiCapture) || (kind === "web" && webCapture)` (code kind never captured). Deps gain `webCapture`.
- `hasReclaimableMatch` (`lib/keybindings.ts:617`) already narrows to the single capture-toggle actionId when `captured` is set; that narrowing is kind-agnostic and is reused as-is (the actionId it matches follows the §4 decision). Its doc comment updates: callers pass `captured` for kinds `"gui"` and `"web"`.
- Result: in the iframe engine (`components/web-frame-iframe.tsx` ~line 225, capture-phase keydown on the same-origin contentDocument → `reclaimRef` → `shouldReclaimChord("web")` threaded via `surface-layout.tsx:2320` → `iframe-window.tsx`), every rk chord — ⌘K, ⌘1–4, ⌘B, the `webOnly` ⌘F web-find and ⌘L web-address — falls through to the page; only Ctrl+Shift+G / ⌘⇧G is reclaimed and re-dispatched to the parent. Escape is already never reclaimed by this engine (not a registry binding), so the page's own palette closes with Esc.
- Cross-origin iframe pages already receive every key (rk cannot listen inside them) — capture is a no-op there; the release chord cannot be reclaimed from inside a cross-origin page either, so the button and palette row are the exits there (the mouse is never captured).

### 3. Native engine chord table under capture

- `buildWebChordTable(bindings)` (`lib/web-chord-table.ts:55`, memoized in `components/iframe-window.tsx:266`) gains a capture input, e.g. `buildWebChordTable(bindings, { captured })`:
  - **released** (default): byte-identical to today — every enabled non-`ttyOnly`, non-`guiOnly` binding (the gating now per §4), expanded per tier, deduped, Escape appended last.
  - **captured**: ONLY the capture-toggle binding's specs (its effective, possibly user-rebound combo expanded per tier — for the default `shifted` KeyG: `{KeyG, ctrl, shift}` and `{KeyG, meta, shift}`), and **no Escape spec** — so the embedded app's own ⌘K palette can be closed with Esc (parity with the iframe engine, which never reclaims Escape). A disabled/unbound toggle binding yields an empty table under capture (the button and palette row remain the exits).
- `iframe-window.tsx` receives the web capture state as a prop (threaded from `app.tsx` → `SurfaceLayout` → the single `IframeWindow` mount at `surface-layout.tsx` ~2320) and includes it in the `useMemo` deps, so latching/releasing re-derives and re-uploads the table via the existing `web:chords` path (`setShellWebViewChords`). Main (`app/desktop/src/main.ts` `before-input-event`, `chords.ts` matcher) needs NO change — it matches whatever table it is given.
- Consequence while latched on the native engine: Escape no longer triggers main's focus hop back to the SPA; focus returns via the release chord, a click on the chrome, or the palette (opened by mouse from the top bar).

### 4. The shared toggle chord (Ctrl+Shift+G / ⌘⇧G)

Registry binding today (`lib/keybindings.ts:415`):
```ts
{ actionId: "gui-capture-toggle", code: "KeyG", tier: "shifted", scope: "terminal", kind: "builtin", label: "Keyboard capture", description: "hand every chord to the guest desktop", mapLabel: "capture", ignoreInputs: true, guiOnly: true },
```
- It can no longer be `guiOnly`-gated: the chord must be reclaimable under both kind `"gui"` and kind `"web"`, its handler must be present when the focused tile is gui OR web (absent under tty/code focus, so the chord falls through untouched there), and it must still never be refused by the terminal seam (`shouldRefuseTerminalChord`, `lib/keybindings.ts:669`, filters `guiOnly` today precisely so Ctrl+Shift+G stays with the pane — the replacement gate must keep that filter's effect) and never be `ttyOnly`-reclaimed.
- The gate mechanism is apply's choice; options, in order of preference:
  - a data flag expressing "gui or web" (e.g. a `captureSurface`-style flag, or generalizing the gate to a surface set) consulted by `hasReclaimableMatch`, `shouldRefuseTerminalChord`, `buildWebChordTable`, the app.tsx handler-presence gates (`guiGated` / `webGated` ~line 5115), and `findConflicts`'s surface-gate disjointness — keeping gating as registry DATA, never an actionId list (the established rule).
- The action dispatches by focused tile kind: `focusedTileKind === "gui"` → `handleGuiCaptureChange(!guiCapture)`; `focusedTileKind === "web"` → `handleWebCaptureChange(!webCapture)`.
- ActionId: keep `gui-capture-toggle` (zero override migration) or rename to a generic id (e.g. `capture-toggle`); if renamed, stored user overrides under the old id MUST keep working — follow the `parseOverrides` retired-id mapping precedent (`operator-console` → `quake-terminal`). Label/description become surface-neutral (e.g. description "hand every chord to the focused tile's app"). The Shortcuts panel and `mapLabel` update accordingly.

### 5. Capture toggle button in the web tile URL bar

- In `components/iframe-window.tsx` URL bar (design order today: ◀ ▶ ↻ [address] ⌕ − % + <> ↗; Inspect `<>` ~line 1304), add a keyboard-capture button next to Inspect `<>` — proposed order `… − % + <> ⌨ ↗` (immediately after Inspect, before Open-in-browser). It renders on BOTH engines (it is not capability-gated like Inspect).
- Pressed/latched state uses the existing latch-well treatment of the gui capture verb (`components/gui-toolbar.tsx` ~line 589: `controlClass({ variant: "toggle", …, ringed: true, pressed: capture })`, `aria-pressed`, the `KeyboardGlyph`), adapted to the URL bar's 28×28 (`w-7 h-7`) button box. `data-testid="web-capture-toggle"`, `aria-label="Keyboard capture"`.
- Wrapped in `<Tip label="Keyboard capture" kbd={…the toggle's kbd hint…} placement="top">` — `placement="top"` is mandatory in this chrome (a bottom tip would render under the native guest's composited layer).
- Hidden on the onboarding (empty) web tile, like the other page verbs gated on `!onboarding` (default chosen; a no-page tile has nothing to capture for).
- Omitted (not disabled) on coarse pointers, like the gui control.

### 6. Header meta swaps to "keys → page"

- `components/surface-layout.tsx` ~2520 swaps the gui meta chip to `keys → desktop` while latched. Mirror it for web: while `rk-web-capture` is latched and the web tile is not onboarding, the web tile header's meta shows the consequence label **`keys → page`** with the same treatment (green wash + ink, no ring — a label, not a control). The onboarding tile renders no meta chip today and stays that way.

### 7. Palette row

- A pointer-reachable palette row for the web latch, present when a non-onboarding web tile is open and the pointer is fine (omitted on coarse). Label per the user: `Web: Keyboard capture`; following the gui row's pattern (`lib/palette/gui.ts` ~377: ONE state-labelled row whose id IS the registry actionId so `withShortcutHints` decorates the chord), the row may instead read `Web: Capture keyboard` / `Web: Release keyboard` — see Assumptions. Description e.g. "hand every chord to the page".
- Palette ids must stay unique when a gui tile and a web tile are both open in a window (both rows present). If the two rows cannot both carry the shared actionId, the web row needs its own id and its keycap hint must still render (apply's choice of mechanism — e.g. an explicit hint, or an alias binding id per the registry `aliasOf` concept).
- Lives with the web palette sources (e.g. `lib/palette/web-engine.ts` neighbors, which already hold `Web: Inspect page`).
- If palette entry counts change, update the exact-count assertion in `app/frontend/tests/e2e/operator-compose.spec.ts` and add it to the test gate.

### 8. Three exits, never auto-engaged

Exits: the release chord (both engines, same-origin iframe pages), the URL-bar button, the palette row. The mouse is never captured. The latch never engages by itself.

### Known limits (document, do not fix)

- In a browser tab, ⌘W/⌘T/⌘N/⌘Q can never reach the page regardless of capture (the browser takes them above the page). No `keyboard.lock()` equivalent here (the web tile has no fullscreen mode).
- In rk-desktop, the shell's menu accelerators still win under capture — verified in `app/desktop/src/menu.ts`: ⌘R reload, ⇧⌘R force-reload, ⌥⌘I devtools, ⌘0 / ⌘+ / ⌘− zoom, ⌘Q quit, ⌘H hide (plus Edit roles). Unshifted `CmdOrCtrl+<letter>` page-tier keys like ⌘K are never shell-bound, so ⌘K DOES reach the guest under capture. Don't promise ⌘W/⌘T/⌘N reach the guest in rk-desktop (unverified).
- Cross-origin iframe pages: capture is a no-op (they already get all keys).

### Tests

- Unit (Vitest):
  - `lib/keybindings.test.ts`: `hasReclaimableMatch` with `captured` under kind `"web"` — ⌘K / web-find / web-address return false, the toggle chord returns true; the toggle chord is reclaimable under kinds gui AND web when released; not reclaimed for code/tty; `shouldRefuseTerminalChord` never refuses the toggle chord; `findConflicts` stays clean on defaults; retired-id override mapping if the id is renamed.
  - `lib/web-chord-table.test.ts`: under capture → only the toggle binding's two specs, no Escape; a rebound toggle → its rebound specs; released → unchanged table (now including the toggle chord's specs, since it is web-reclaimable).
  - Posture read/write for `rk-web-capture` (validation, try/catch-noop), mirroring the `rk-gui-capture` tests.
  - Component: `iframe-window` button renders (non-onboarding, fine pointer), `aria-pressed` reflects the latch, click toggles, hidden on onboarding/coarse; `surface-layout` web header meta shows `keys → page` while latched; palette source row present/absent + label/state.
  - `app.tsx` dispatch: toggle chord with web focus flips the web latch only; with gui focus flips the gui latch only.
- e2e (Playwright, `just test-e2e <name>.spec`): with a same-origin iframe-engine web tile, latch capture (button), press ⌘K/Ctrl+K inside the page → rk's palette does NOT open and the page receives the keydown; press the release chord → latch releases and ⌘K opens rk's palette again. New `test()` blocks carry the constitution's JSDoc intent comments. Use regex `page.route` stubs (memory: `?server=` suffix).
- Gate: `just test-frontend` (full Vitest) + the relevant e2e specs; `operator-compose.spec` if palette counts changed.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) Web Tile — the URL-bar capture button, `keys → page` header meta, the iframe engine's narrowed reclaim under `rk-web-capture`, and `buildWebChordTable`'s captured mode (toggle specs only, no Escape)
- `run-kit/ui/keyboard-and-palette`: (modify) the shared capture-toggle binding's new gate (gui or web, never terminal-refused), per-focused-kind dispatch, any actionId rename + override mapping, and the `Web:` capture palette row
- `run-kit/ui/dialogs-and-state`: (modify) per-viewer postures — add `rk-web-capture`
- `run-kit/gui`: (modify) the keyboard-capture requirement/design decision — the toggle chord is now shared with the web tile (separate latches)
- `run-kit/desktop-shell`: (modify) chord reclaim note — the uploaded table can omit Escape while web capture is latched, so main's Escape focus hop does not fire then

## Impact

- **Frontend** (`app/frontend/src/`): `lib/keybindings.ts` (binding gate, predicate docs, terminal seam, conflicts), `lib/web-chord-table.ts`, a web-posture read/write (new or existing module), `app.tsx` (state, reclaim wiring, handler dispatch, palette input), `components/surface-layout.tsx` (thread `webCapture`, header meta), `components/iframe-window.tsx` (button, chord-table memo), `lib/palette/*` (web row), possibly `components/settings-shortcuts-panel.tsx` labels. Colocated tests for each.
- **Desktop** (`app/desktop/src/`): no code change expected (main matches whatever table it receives).
- **e2e**: new/extended web-tile spec; possibly `operator-compose.spec.ts` count.
- No backend, API, or tmux changes. No new routes (Constitution IV). Constitution V satisfied: the new button's action is palette-registered and keyboard-reachable.

## Open Questions

- Should the web palette row be state-labelled (`Web: Capture keyboard` / `Web: Release keyboard`, mirroring gui) or the single static `Web: Keyboard capture` the user named?
- Keep `gui-capture-toggle` as the shared actionId, or rename to a surface-neutral id with a retired-id override mapping?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Web gets its own per-viewer latch `rk-web-capture`, independent of `rk-gui-capture`, same storage/validation discipline, sticky + viewer-global | Discussed — user chose a separate latch over one shared latch | S:95 R:80 A:90 D:95 |
| 2 | Certain | The same Ctrl+Shift+G / ⌘⇧G chord toggles whichever tile kind is focused (gui latch or web latch) | Discussed — user chose reusing the chord over a separate web-only chord | S:95 R:75 A:85 D:90 |
| 3 | Certain | While latched, the web reclaim narrows to the toggle binding alone in both engines — ⌘K and all other rk chords (webOnly ⌘F/⌘L included) pass to the page | Discussed — agreed behavior; mirrors the shipped gui full-pass latch | S:95 R:80 A:90 D:90 |
| 4 | Certain | Native chord table under capture emits only the toggle's specs and drops Escape | Discussed — agreed, for iframe-engine parity so the page's own palette closes with Esc | S:90 R:85 A:85 D:90 |
| 5 | Certain | Three exits (chord, URL-bar button, palette row); never auto-engages; mouse never captured | Discussed — agreed, mirrors gui design decision | S:90 R:85 A:90 D:90 |
| 6 | Certain | Header meta swaps to `keys → page` while latched, same treatment as `keys → desktop` | Discussed — agreed label, verbatim | S:95 R:90 A:90 D:90 |
| 7 | Certain | Button sits in the URL bar immediately after Inspect `<>` (before ↗), renders on both engines, latch-well pressed treatment, Tip `Keyboard capture` + kbd with placement top | Discussed — "next to Inspect"; placement-top is a chrome rule from memory | S:80 R:90 A:80 D:70 |
| 8 | Certain | Button and palette row omitted (not disabled) on coarse pointers | Discussed — "like gui" | S:85 R:90 A:85 D:85 |
| 9 | Certain | Button, row, and meta swap hidden on the onboarding (empty) web tile | Discussed — user named this the reasonable default | S:75 R:90 A:80 D:75 |
| 10 | Confident | The toggle binding loses `guiOnly`; a data-flag gate (gui or web) keeps handler presence, reclaim, terminal-seam non-refusal, and conflict disjointness as registry data, not an actionId list | Required by decision 2; the codebase rule is gates-as-data (`ttyOnly`/`webOnly`/`guiOnly`) | S:70 R:75 A:75 D:60 |
| 11 | Confident | ActionId kept as `gui-capture-toggle` or renamed to a surface-neutral id with a retired-id override mapping (the `operator-console` precedent) — apply decides | User left it to apply; either works if overrides keep working | S:60 R:70 A:60 D:45 |
| 12 | Confident | Web palette row label follows the gui state-labelled pattern (`Web: Capture keyboard` / `Web: Release keyboard`) unless apply finds the static `Web: Keyboard capture` fits better | User named `Web: Keyboard capture`; the gui row is state-labelled for keycap-hint reasons | S:55 R:90 A:55 D:40 |
| 13 | Confident | When gui and web tiles coexist, the web palette row needs a unique id with its keycap hint still rendered (explicit hint or alias id) | Palette ids must be unique; mechanism not discussed | S:45 R:85 A:60 D:45 |
| 14 | Certain | Desktop main needs no change — it matches whatever table the SPA uploads | Verified in `main.ts` / `chords.ts`; table is SPA-derived | S:70 R:85 A:85 D:85 |
| 15 | Certain | Shell menu accelerators (⌘R, ⌘0/⌘+/⌘−, ⌥⌘I, ⌘Q, ⌘H) still win under capture in rk-desktop; ⌘K reaches the guest — documented, not fixed | Verified in `app/desktop/src/menu.ts`; page-tier unshifted keys are never shell-bound | S:70 R:90 A:85 D:85 |
| 16 | Certain | Code (code-server) iframe is out of scope — its reclaim is never captured | Request is about the web tile only; code kind is not mentioned | S:70 R:90 A:80 D:80 |
| 17 | Certain | Test plan: Vitest for predicate, chord table, posture, components, dispatch; one Playwright iframe-engine e2e for latched ⌘K pass-through and release; operator-compose count if palette counts change | Discussed constraints + code-quality rule that UI changes carry e2e | S:80 R:85 A:80 D:75 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).

# Spec: Static xterm imports

**Change**: 260531-m3pl-static-xterm-imports
**Created**: 2026-05-31
**Affected memory**: None — implementation-only; no spec-level behavior change.

<!--
  change_type: fix. Implementation-only refactor of module-load timing in
  app/frontend/src/components/terminal-client.tsx. The 6 runtime `await import()`
  calls for the xterm family are hoisted to static top-of-file imports so the
  modules load once with the already-route-lazy terminal chunk instead of as
  per-pane runtime chunk fetches that compete for the browser's HTTP/1.1
  6-per-origin connection budget (the confirmed board-route E2E hang mechanism).
  No user-visible behavior changes — every scenario below asserts post-change
  parity, not new behavior.
-->

## Non-Goals

- Vite `optimizeDeps.include` pre-bundling — pre-bundles the dep but does not take the chunk fetch off the per-pane runtime path; the static import does.
- `Promise.all` parallelization of the existing 6 awaits — collapses 6 serial round-trips to one burst but still puts chunk fetches on the runtime connection budget.
- Bounding the persistent per-pane relay WebSockets on the desktop board row — that is the *second* drafted fix for the same root cause and is out of scope for this change.
- Any change to relay WS, SSE, tmux, backend, or API behavior — untouched.
- Resetting or changing the WebGL → canvas fallback behavior — only the timing of the `WebglAddon` module load moves; the runtime fallback contract is preserved.

## Frontend Terminal Init: Module Load Timing

### Requirement: All six xterm-family modules SHALL be statically imported

The `Terminal`, `FitAddon`, `ClipboardAddon`, `WebLinksAddon`, `UnicodeGraphemesAddon`, and `WebglAddon` symbols MUST be imported via static top-of-file `import` statements in `app/frontend/src/components/terminal-client.tsx`. The six runtime `await import()` calls inside the mount effect's `init()` function (currently at lines 147, 148, 195, 200, 209, 216) SHALL be removed, and the `init()` body SHALL reference the statically-imported symbols directly.

No runtime `await import()` of any xterm module SHALL remain in the file after the change.

#### Scenario: Single-pane terminal still initializes and renders
- **GIVEN** the `/$session/$window` route is loaded and a single `TerminalClient` mounts
- **WHEN** the mount effect's `init()` runs to completion
- **THEN** a `Terminal` instance is constructed, `FitAddon`, `ClipboardAddon`, `WebLinksAddon`, `UnicodeGraphemesAddon`, and (GPU permitting) `WebglAddon` are loaded as addons
- **AND** `terminal.open()` is called against the container so `.xterm-rows` appears in the DOM
- **AND** `setTerminalReady(true)` runs, gating the relay WebSocket effect exactly as before

#### Scenario: No per-pane xterm chunk fetches on a multi-pane board
- **GIVEN** a board route mounts N `BoardPane` components, each with a `TerminalClient`, simultaneously
- **WHEN** each pane's `init()` runs
- **THEN** no `init()` issues a runtime module-graph fetch for any xterm module (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-clipboard`, `@xterm/addon-web-links`, `@xterm/addon-unicode-graphemes`, `@xterm/addon-webgl`)
- **AND** the xterm family resolves from the already-loaded route chunk, loaded once when the route's code-split chunk loaded
- **AND** terminal init no longer contributes a chunk fetch to the browser's per-origin connection budget at pane-mount time

#### Scenario: Unicode-before-WebGL load order is preserved
- **GIVEN** the static imports are in place
- **WHEN** `init()` loads the addons
- **THEN** `UnicodeGraphemesAddon` is instantiated and `terminal.unicode.activeVersion` is set to `"15-graphemes"` before `WebglAddon` is instantiated, so the renderer measures cells against the Unicode 15 width table on first paint

### Requirement: WebGL fallback to canvas SHALL remain a runtime concern

Only the `WebglAddon` *module load* moves to a static import. The `try/catch` around `new WebglAddon()` / `terminal.loadAddon(...)` (currently lines 215–220) MUST stay, because GPU/WebGL context creation can still throw at runtime even when the module is resolved. On such a throw, the canvas renderer MUST continue working and no error is surfaced to the user.

#### Scenario: WebGL context creation throws → silent canvas fallback
- **GIVEN** the `WebglAddon` module is statically imported (resolved at chunk load, cannot fail at `init()` time)
- **WHEN** `new WebglAddon()` or `terminal.loadAddon(new WebglAddon())` throws because GPU context creation fails
- **THEN** the throw is caught, swallowed silently, and the terminal continues with the canvas renderer
- **AND** `init()` proceeds to wire input handlers, the resize observer, and `setTerminalReady(true)` as before

### Requirement: Teardown correctness SHALL be preserved across the remaining await boundary

The font-load `await Promise.race([...])` (currently lines 162–173) remains an asynchronous boundary inside `init()`. Therefore the unmount-during-init guards around it MUST stay: the `cancelled || !terminalRef.current` re-check that follows the font-load await (currently line 177) and the pre-`open()` entry guard (line 146) SHALL be retained. The `cancelled`/`terminalRef.current` re-checks that existed SOLELY to guard the now-removed `await import()` boundaries (lines 151, 196, 201, 210, 221) MAY be simplified or removed, but only to the extent that no surviving await boundary is left unguarded.

The existing `terminal.dispose()`-on-cancel teardown behavior MUST be preserved: if the component unmounts (`cancelled` becomes true) after `terminal` is constructed but before `setTerminalReady(true)`, the in-progress `terminal` instance MUST be disposed (wrapped in `try/catch`, since teardown of a partially-loaded WebGL addon may throw), and `init()` MUST return early without opening a relay or marking the terminal ready. The effect cleanup function's `terminal?.dispose()` on true unmount MUST remain unchanged.

#### Scenario: Unmount during font load disposes cleanly
- **GIVEN** `init()` is awaiting the font-load race (the one remaining await before terminal construction)
- **WHEN** the component unmounts (effect cleanup sets `cancelled = true`)
- **THEN** the post-font-load guard short-circuits `init()` before constructing the `Terminal`
- **AND** no terminal is opened, no relay effect is armed, and no error is thrown

#### Scenario: Unmount after terminal construction disposes the instance
- **GIVEN** `init()` has constructed `terminal` and is wiring addons / observers (synchronous now that imports are static)
- **WHEN** the component unmounts during this window and a post-construction cancel guard is reached
- **THEN** `terminal.dispose()` is invoked inside a `try/catch` (swallowing any WebGL-teardown throw)
- **AND** `init()` returns early without marking the terminal ready

#### Scenario: Effect-cleanup teardown on true unmount is unchanged
- **GIVEN** a fully-initialized terminal (`terminalReady === true`)
- **WHEN** the `TerminalClient` unmounts
- **THEN** the effect cleanup sets `cancelled = true`, disconnects the resize observer, closes any active WS, clears refs, and calls `terminal?.dispose()` inside `try/catch`, identical to pre-change behavior

### Requirement: CSS side-effect and type-only references SHALL remain unchanged

The CSS side-effect import `import "@xterm/xterm/css/xterm.css";` (line 1) and the type-only references `import("@xterm/xterm").Terminal` / `import("@xterm/addon-fit").FitAddon` (lines 60, 141) MUST be left as-is. Type-only references are erased at compile time and carry no runtime cost; the CSS import is already a static side-effect import.

#### Scenario: CSS and type references untouched
- **GIVEN** the change converts only the six runtime value imports to static value imports
- **WHEN** the file is reviewed post-change
- **THEN** line 1's CSS import is unchanged
- **AND** the `import("@xterm/...")` type annotations remain as type-only references (or are freely re-expressed against the now-statically-imported types without runtime effect)

### Requirement: Existing unit test SHALL pass unchanged with no new mocks

The change MUST NOT require new `vi.mock` stubs in `app/frontend/src/components/terminal-client.test.tsx`. The test already mocks all six xterm modules (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-clipboard`, `@xterm/addon-web-links`, `@xterm/addon-webgl`, `@xterm/addon-unicode-graphemes`) and the CSS module, and already statically imports `Terminal`, `UnicodeGraphemesAddon`, and `WebglAddon`. Converting the source to static imports aligns the source with how the test already mocks at module-eval time. The test file SHALL NOT be modified by this change.

#### Scenario: Unicode-width init test passes after the change
- **GIVEN** `terminal-client.test.tsx`'s existing `vi.mock` stubs for all six xterm modules
- **WHEN** `TerminalClient` is rendered under jsdom and the static source imports resolve to the mocked modules at module-eval time
- **THEN** the "loads UnicodeGraphemesAddon and activates 15-graphemes before WebGL" test still observes `UnicodeGraphemesAddon` and `WebglAddon` constructed, the Unicode-before-WebGL invocation order, `allowProposedApi: true`, and `activeVersion === "15-graphemes"`
- **AND** the scroll-lock focus-prevention tests still pass

#### Scenario: Static import resolves to mock under jsdom without touching real WebGL
- **GIVEN** the source statically imports `WebglAddon` from `@xterm/addon-webgl`
- **WHEN** the test module-evals `terminal-client.tsx` with `vi.mock("@xterm/addon-webgl", ...)` active
- **THEN** the static import binds to the mocked constructor, so no real WebGL API is touched at import time and the test environment stays jsdom-safe

## Design Decisions

1. **Convert all six xterm imports to static, including WebGL**: Every pane needs the identical modules, and the file is already router-lazy, so the modules belong in the route chunk loaded once — not as per-pane runtime fetches.
   - *Why*: Removes all six chunk fetches from the runtime per-origin connection budget, fully eliminating the HTTP/1.1 6-per-origin starvation that hangs the board-route E2E on the plaintext dev/test origin.
   - *Rejected*: Keeping `WebglAddon` dynamic (the one-fetch middle ground) — leaves a single chunk fetch on the connection budget, partially undercutting the fix for no benefit, since the module is needed on every pane regardless.

2. **Keep the WebGL `try/catch` around construction, not the import**: The static import resolves at chunk load and cannot fail at `init()` time, but GPU/WebGL context creation can still throw at runtime.
   - *Why*: Preserves the silent canvas-fallback contract that protects users on machines without a usable GPU context.
   - *Rejected*: Removing the `try/catch` entirely — would surface a runtime GPU error as an unhandled throw, regressing the fallback behavior.

3. **Retain unmount guards only around the surviving await (font load)**: The font-load `await` remains, so guards around it stay; guards that existed solely for the removed `await import()` boundaries may be simplified.
   - *Why*: Keeps teardown correct (no opened-but-orphaned terminal, no relay armed after unmount) while removing now-dead re-checks.
   - *Rejected*: Stripping all cancel guards — would leave the font-load await boundary unguarded, risking a `dispose()`-less leak or a post-unmount `setTerminalReady(true)`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All 6 xterm-family imports in `terminal-client.tsx` are genuine runtime `await import()` (lines 147,148,195,200,209,216); only the CSS import (:1) and type-only refs (:60,:141) are already static | Confirmed by reading the file this session; carried forward from intake #2 unchanged | S:95 R:90 A:95 D:95 |
| 2 | Certain | All six imports (including `WebglAddon`) go static; none stay dynamic | Resolved open question — user chose full removal of chunk fetches from the runtime connection budget over the one-WebGL-fetch middle ground; carried forward from intake #5 as Certain | S:95 R:80 A:90 D:95 |
| 3 | Certain | The WebGL `try/catch` stays around `new WebglAddon()` / `loadAddon`; only the module load moves to static | Static import resolves at chunk load and cannot fail at init() time, but GPU context creation can still throw at runtime — the fallback contract requires the runtime guard; verified against source lines 215–220 | S:95 R:80 A:90 D:90 |
| 4 | Certain | No new `vi.mock` stubs are needed in `terminal-client.test.tsx`; the test passes unchanged | Resolved open question — verified all six modules already mocked (test :10,31,37,43,49,55) and three already statically imported (:4-6); static source imports align with existing mocks. The lone intake risk is closed | S:95 R:90 A:95 D:95 |
| 5 | Certain | The font-load `await` (:162-173) remains, so its unmount guards (:146 entry, :177 post-await) stay; the `terminal.dispose()`-on-cancel teardown is preserved | Reading the source confirms exactly one async boundary survives (font load); the `await import()` boundaries that prompted guards at :151,196,201,210,221 are the only ones eligible for simplification | S:90 R:85 A:90 D:85 |
| 6 | Certain | CSS side-effect import (:1) and type-only refs (:60,:141) stay unchanged | Type refs are compile-erased (no runtime cost); CSS is already a static side-effect import — neither is part of the runtime connection-budget problem; carried forward from intake | S:95 R:95 A:95 D:95 |
| 7 | Confident | This is the right fix because `terminal-client.tsx` is already router-lazy, so the xterm family bundles into an already-deferred chunk loaded once per route | Router lazy-loads the terminal route; every pane needs identical modules so per-pane dynamic import has no upside; carried forward from intake #3 | S:85 R:75 A:85 D:85 |
| 8 | Confident | change_type = fix (implementation-only, no behavior change) | Repairs a confirmed defect (deterministic board-route E2E hang) by relocating import timing; no spec-level behavior change, so no memory hydration needed; carried forward from intake #4 | S:85 R:90 A:90 D:85 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).

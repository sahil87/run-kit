# Plan: Top-Bar Button Pyramid

**Change**: 260704-9o7k-top-bar-button-pyramid
**Intake**: `intake.md`

## Requirements

### Cluster: 3-Level Button Pyramid (`top-bar.tsx`)

The top-bar right cluster (`justify-self-end` div) is regrouped into a strict cumulative pyramid so no shared button ever changes screen position between pages. Levels grow leftward from a stable always-block pinned to the right; the connection dot is the right-most status terminator (not a button). `TopBarMode` is `terminal | board | root | cockpit`.

- **R1** — The always block (L3) MUST render in all four modes in the exact left→right order NotificationControl → ThemeToggle → RefreshButton → HelpLink, followed by the connection dot as the right-most element.
  - GIVEN any mode (`terminal`/`board`/`root`/`cockpit`), WHEN the top bar renders at ≥ `sm`, THEN the bell, theme, refresh, and help chips appear in that order, then the dot last.
  - GIVEN the always block, WHEN inspecting the DOM order of the right cluster, THEN the dot's `role="status"` wrapper is the last child of the cluster.

- **R2** — `RefreshButton` MUST move out of the `currentWindow` (terminal-only) block into the L3 always block, between `ThemeToggle` and `HelpLink`, with behavior unchanged (plain click `window.location.reload()`; Shift+click `forceReload()`).
  - GIVEN mode `root`/`board`/`cockpit`, WHEN the top bar renders at ≥ `sm`, THEN a "Refresh page" control is present.
  - GIVEN a Shift+click on the refresh control, WHEN handled, THEN `forceReload()` runs (cache-busting fetch then reload); a plain click runs `window.location.reload()`.

- **R3** — `FixedWidthToggle` MUST become an L1 terminal-only button (rendered only when `mode === "terminal"`, equivalently inside the `currentWindow` block), placed as the last L1 button after the two SplitButtons. Its runtime behavior (the 900px `maxWidth` wrapper in AppShell + the `View: Fixed Width`/`toggle-fixed-width` palette action) MUST remain untouched, so Server Cabin keeps the constraint and palette access; only the Cabin/Cockpit/Board *button* is removed.
  - GIVEN mode `terminal`, WHEN the top bar renders at ≥ `sm`, THEN the FixedWidth toggle button is present after the split buttons.
  - GIVEN mode `root`/`board`/`cockpit`, WHEN the top bar renders, THEN no FixedWidth toggle button is present.
  - GIVEN the AppShell `viewActions`, WHEN inspected, THEN the `toggle-fixed-width` palette action still exists unchanged.

- **R4** — The L2 pair TerminalFontControl (Aa) + ClosePaneButton (✕) MUST render in `terminal` and `board` modes only, to the left of the L3 always block (Aa left of ✕). TerminalFontControl gating simplifies to the L2 gate (`mode === "terminal" || mode === "board"`), same effective result as today's `mode !== "root" && mode !== "cockpit"`.
  - GIVEN mode `terminal` or `board`, WHEN the top bar renders at ≥ `sm`, THEN both the Aa control and the ✕ close/unpin control are present.
  - GIVEN mode `root` or `cockpit`, WHEN the top bar renders, THEN neither the Aa control nor the ✕ control is present.

- **R5** — The L1 terminal-only trio (SplitButton vertical · SplitButton horizontal · FixedWidthToggle) MUST render only when `currentWindow` is set (terminal mode), leftmost in the cluster.
  - GIVEN mode `terminal` with a `currentWindow`, WHEN rendered, THEN both split buttons and the FixedWidth toggle appear.
  - GIVEN any non-terminal mode, WHEN rendered, THEN no split buttons and no FixedWidth toggle appear.

- **R6** — The cluster-ordering comment MUST be rewritten to describe the pyramid (L1/L2/L3), and the stale `FixedWidthToggle` comment claiming fixed-width "constrains the max-width of any surface including the server list" MUST be corrected (Cockpit `server-list-page.tsx` and Board never read `fixedWidth`).
  - GIVEN a reader of `top-bar.tsx`, WHEN reading the right-cluster comment, THEN it documents the three-level pyramid and no longer asserts fixed-width affects the server list.

- **R7** — Every cluster item MUST keep its `hidden sm:flex` wrapper span (whole cluster stays desktop-only) and the shared `rk-glint` 24px/`coarse:30px` chip styling.
  - GIVEN a viewport `< sm`, WHEN the top bar renders, THEN no cluster control is visible.

#### Non-Goals

- No repurpose of the Aa font control to act on Cockpit/Server Cabin (page zoom) — explicitly rejected in the intake (conflicts with the px-fixed design system, duplicates browser zoom).
- No backend changes to unpin (reuse the existing `POST /api/boards/{name}/unpin`).
- No change to the AppShell 900px fixed-width wrapper logic, `viewActions`, or the `terminal-font-*` palette actions.

### Connection Dot: "this page's live data is flowing" (`top-bar.tsx`, `session-context.tsx`, `server-list-page.tsx`, `board-page.tsx`)

- **R8** — The connection dot MUST render in all four modes (drop the `mode !== "board" && mode !== "cockpit"` gate). Existing rendering is kept: green `bg-accent-green` when connected / gray `bg-text-secondary` otherwise, `role="status"`, `aria-live="polite"`, `aria-label` Connected/Disconnected.
  - GIVEN mode `board` or `cockpit`, WHEN the top bar renders at ≥ `sm`, THEN the connection dot is present as the right-most element.
  - GIVEN `isConnected === true`, WHEN the dot renders, THEN it carries `bg-accent-green` and `aria-label="Connected"`; otherwise gray + `aria-label="Disconnected"`.

- **R9** — Cockpit's dot MUST reflect host-metrics stream health. `session-context.tsx` MUST track a `hostMetricsConnected` boolean: set true on the dedicated `?metrics=1` stream open/first metrics event, cleared on error using the existing disconnect-debounce (3s) pattern; when the dedicated stream is closed (a per-server stream carries the fan-out), derive connectedness from whether any attached server's slice `isConnected` is true. `server-list-page.tsx` MUST pass this instead of `isConnected={false}`.
  - GIVEN `/` with no attached server and the dedicated `?metrics=1` stream receiving metrics, WHEN the cockpit dot renders, THEN it is green.
  - GIVEN the dedicated stream errors and 3s elapse with no recovery, WHEN the dot renders, THEN it is gray.
  - GIVEN a per-server stream is attached (dedicated stream closed) and that stream is connected, WHEN the cockpit dot renders, THEN it is green (fan-out fallback).

- **R10** — Board's dot MUST aggregate over the servers the board attaches: green only when the board has at least one entry AND every distinct attached server's `isConnectedByServer` slice is connected. `board-page.tsx` MUST derive and pass this instead of `isConnected={false}`.
  - GIVEN a board with entries across servers S1, S2 both connected, WHEN the board dot renders, THEN it is green.
  - GIVEN any one attached server disconnected, WHEN the board dot renders, THEN it is gray.
  - GIVEN a board with zero entries, WHEN the dot renders, THEN it is gray.

### Board ✕ = Unpin Focused Pane (`top-bar.tsx`, `board-page.tsx`)

- **R11** — In `board` mode the L2 ✕ (ClosePaneButton) MUST unpin the board's focused entry (non-destructive; NOT kill the tmux pane). `board-page.tsx` MUST pass a focus-derived `onCloseFocused` callback (or the focused entry) to `TopBar`; on terminal routes ✕ keeps its existing kill-pane behavior (`closePane(server, windowId)`).
  - GIVEN board mode with a focused entry, WHEN the ✕ is clicked, THEN `unpin(server, windowId, board)` runs for the focused entry and no `closePane`/kill call is made.
  - GIVEN terminal mode, WHEN the ✕ is clicked, THEN `closePane(server, windowId)` runs (unchanged).

- **R12** — The board ✕ MUST be disabled when the board has zero panes, and MUST carry a board-specific `title`/`aria-label` ("Unpin pane from board") distinct from the terminal label ("Close pane").
  - GIVEN board mode with zero entries, WHEN rendered, THEN the ✕ is disabled.
  - GIVEN board mode, WHEN inspecting the ✕, THEN its accessible name is the unpin label; in terminal mode it is "Close pane".

- **R13** — A `Board: Unpin Focused Pane` action MUST be added to `boardRouteActions` in `board-page.tsx` (keyboard parity, Constitution V), following the `refresh-page`/`help-documentation` dual-mount precedent, present only when the board has entries and unpinning the focused entry.
  - GIVEN the board palette with entries, WHEN opened, THEN a `Board: Unpin Focused Pane` action exists that unpins the focused entry.

#### Design Decisions

- **DD-1 — ClosePaneButton gains a mode-aware behavior via props, not a second component.** `ClosePaneButton` accepts an optional `onUnpin` callback + `disabled` + label overrides. When `onUnpin` is provided (board mode) it calls that instead of `closePane`; otherwise it keeps the terminal kill path. Rationale: keeps one button component (avoids duplicating the chip styling/spinner), mirrors how other cluster buttons stay self-contained. Rejected: a separate `UnpinFocusedButton` component (duplicates styling and the optimistic-action pattern for no benefit).
- **DD-2 — Board dot is AND-over-attached-servers, binary, no partial state.** Matches the intake's approved aggregate rule. Zero-entry board = gray (nothing flowing).
- **DD-3 — `hostMetricsConnected` derives from the dedicated-stream health when it is open, else from per-server slice connectedness.** Mirrors the existing dedicated-stream ↔ per-server fan-out switch already in `session-context.tsx` (the metrics fan-out), reusing the 3s `disconnectTimer` debounce so the dot doesn't flicker on transient socket blips.

## Tasks

### Phase 1: Cluster regrouping (`top-bar.tsx`)

- [x] T001 Rework the right-cluster JSX in `app/frontend/src/components/top-bar.tsx`: (a) inside the `currentWindow &&` block, keep the two SplitButtons and ADD `FixedWidthToggle` as the last L1 item; REMOVE `RefreshButton` from this block. (b) Keep the L2 pair (TerminalFontControl, then ClosePaneButton) gated `mode === "terminal" || mode === "board"` — move ClosePaneButton out of the `currentWindow` block into this L2 gate. (c) In the always block render Notification → Theme → RefreshButton → Help (insert RefreshButton between ThemeToggle and HelpLink); REMOVE the standalone FixedWidthToggle from the always block. Preserve every `hidden sm:flex` wrapper and the shared chip classes. <!-- R2 R3 R4 R5 R7 -->
- [x] T002 In `app/frontend/src/components/top-bar.tsx` rewrite the right-cluster ordering comment to describe the L1/L2/L3 pyramid, and correct the stale `FixedWidthToggle` comment (drop the "constrains … including the server list" claim — Cockpit/Board never read `fixedWidth`). <!-- R6 -->

### Phase 2: Connection dot everywhere (`top-bar.tsx`)

- [x] T003 In `app/frontend/src/components/top-bar.tsx` drop the `mode !== "board" && mode !== "cockpit"` gate on the connection-dot span so the dot renders in all four modes (keep the existing green/gray + `role="status"` + `aria-live` + aria-label rendering). <!-- R8 -->

### Phase 3: ClosePaneButton mode-aware + board unpin wiring

- [x] T004 In `app/frontend/src/components/top-bar.tsx` extend `ClosePaneButton` (DD-1): add optional props `onUnpin?: () => void`, `disabled?: boolean`, and label overrides (`label`, defaulting to "Close pane"). When `onUnpin` is set, the button's action calls `onUnpin` (no `closePane`); otherwise it keeps the `closePane(server, windowId)` optimistic path. Apply `disabled` (OR with `isPending`) and use the label for `aria-label`/`title`. <!-- R11 R12 -->
- [x] T005 In `app/frontend/src/components/top-bar.tsx` add board-mode wiring to `TopBarProps` and the L2 render: new optional prop `onCloseFocused?: () => void` and `closeDisabled?: boolean`. In the L2 gate, when `mode === "board"` render `ClosePaneButton` with `onUnpin={onCloseFocused}`, `disabled={closeDisabled}`, and label "Unpin pane from board"; when `mode === "terminal"` render it with the existing `server`/`windowId` (kill) path and default "Close pane" label. Guard the terminal branch on `currentWindow`. <!-- R11 R12 -->
- [x] T006 In `app/frontend/src/components/board/board-page.tsx` pass `onCloseFocused={() => { const e = entries[focusedIndex]; if (e) unpin(e.server, e.windowId, name); }}` and `closeDisabled={entries.length === 0}` to the board-mode `<TopBar>`. <!-- R11 R12 -->
- [x] T007 In `app/frontend/src/components/board/board-page.tsx` add a `Board: Unpin Focused Pane` entry to `boardRouteActions` (only when `entries.length > 0`), unpinning `entries[focusedIndex]` via `unpin`; add `focusedIndex`/`entries`/`unpin`/`name` to the memo deps as needed. <!-- R13 -->

### Phase 4: Host-metrics stream health + dot sources

- [x] T008 In `app/frontend/src/contexts/session-context.tsx` add tracked host-metrics connectedness: a `hostMetricsConnected` state, set true on the dedicated `?metrics=1` stream's first metrics event, cleared via a 3s `disconnectTimer` on `onerror` (mirroring the per-server debounce). Expose a derived `hostMetricsConnected` value on `SessionContextType` that is: the dedicated-stream health when `hostMetricsWanted` (attached set empty), else `true` iff any attached server slice `isConnected`. Add the field to the context type, provider `value` memo (+ deps), and `StandaloneSessionContextProvider` defaults (`false`). <!-- R9 -->
- [x] T009 In `app/frontend/src/components/server-list-page.tsx` read the new value (via `useSessionContext()`) and pass it as `isConnected={hostMetricsConnected}` to the cockpit `<TopBar>` (replace `isConnected={false}`). <!-- R9 -->
- [x] T010 In `app/frontend/src/components/board/board-page.tsx` derive board connectedness from `useSessionContext().isConnectedByServer` over the distinct attached servers (green iff `entries.length > 0` && every distinct server's slice is connected) and pass it as `isConnected={...}` to the board `<TopBar>` (replace `isConnected={false}`). <!-- R10 -->

### Phase 5: Tests

- [x] T011 [P] Update `app/frontend/src/components/top-bar.test.tsx` to the pyramid: dot present in all four modes (board + cockpit now render it, right-most); L3 order Notification → Theme → Refresh → Help → dot; RefreshButton present in root/board/cockpit (moved to always block); FixedWidthToggle only in terminal mode (absent in root/board/cockpit); Aa + ✕ present in terminal + board, absent in root/cockpit. Fix the now-stale assertions ("connection dot hidden on board and cockpit", "renders FixedWidthToggle" in default/cockpit render, RefreshButton "does not render on dashboard"). <!-- R1 R2 R3 R4 R8 -->
- [x] T012 [P] Add board-unpin unit coverage to `app/frontend/src/components/top-bar.test.tsx`: board-mode ✕ carries the unpin label and calls `onCloseFocused` (not `closePane`); disabled when `closeDisabled`; terminal-mode ✕ still calls `closePane`. <!-- R11 R12 -->
- [x] T013 [P] Add a `board-page` unit test (`app/frontend/src/components/board/board-page.test.tsx`, or extend an existing board test) that the top-bar unpin path unpins the focused entry (not kill) and that the `Board: Unpin Focused Pane` palette action exists and unpins the focused entry. If a full BoardPage render is impractical, cover the callback wiring at the smallest testable seam. <!-- R11 R13 -->
- [x] T014 [P] Add session-context unit coverage (`app/frontend/src/contexts/session-context.test.tsx` or a colocated test) for `hostMetricsConnected`: dedicated-stream open/first-event → true; error + 3s → false; fan-out fallback derives from per-server `isConnected` when a server is attached. <!-- R9 -->
- [x] T015 Add a Playwright e2e for the board unpin-focused flow: `app/frontend/tests/e2e/board-unpin-focused.spec.ts` + sibling `.spec.md` (Test Companion Docs), modeled on `boards-pin-flow.spec.ts` — pin two windows, navigate to the board, click the top-bar ✕ (unpin focused), assert via the listing endpoint. <!-- R11 -->

### Phase 6: Type check

- [x] T016 Run `cd app/frontend && npx tsc --noEmit` and fix any type errors introduced by the new props / context field.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The L3 always block renders Notification → Theme → Refresh → Help → dot in all four modes, dot right-most.
- [x] A-002 R2: RefreshButton renders in the always block (present in root/board/cockpit); plain click reloads, Shift+click force-reloads.
- [x] A-003 R3: FixedWidthToggle renders only in terminal mode; the AppShell `toggle-fixed-width` palette action and the 900px wrapper are unchanged.
- [x] A-004 R4: TerminalFontControl (Aa) + ClosePaneButton (✕) render in terminal + board only, Aa left of ✕.
- [x] A-005 R5: SplitButtons + FixedWidthToggle render only when `currentWindow` is set (terminal).
- [x] A-006 R8: The connection dot renders in all four modes as the right-most cluster element.
- [x] A-007 R9: Cockpit passes real host-metrics stream health (green when the metrics stream is flowing, gray on sustained error), via the fan-out fallback when a per-server stream is attached.
- [x] A-008 R10: Board passes AND-over-attached-servers connectedness (green iff all attached servers connected and ≥1 entry).
- [x] A-009 R11: Board ✕ unpins the focused entry (non-destructive); terminal ✕ still kills the pane.
- [x] A-010 R12: Board ✕ is disabled at zero panes and carries the distinct unpin `title`/`aria-label`.
- [x] A-011 R13: `Board: Unpin Focused Pane` palette action exists and unpins the focused entry.

### Behavioral Correctness

- [x] A-012 R2: RefreshButton behavior (reload / Shift=force) is byte-for-byte the same as before the move.
- [x] A-013 R3: Server Cabin retains the 900px constraint and `View: Fixed Width` palette access after the button is removed from `root`.

### Removal Verification

- [x] A-014 R6: The right-cluster comment describes the pyramid, and the stale "fixed-width … server list" claim is gone.

### Scenario Coverage

- [x] A-015 R9: With no attached server, the dedicated `?metrics=1` stream health drives the cockpit dot (open→green, sustained error→gray).
- [x] A-016 R10: A single disconnected attached server flips the board dot gray.

### Edge Cases & Error Handling

- [x] A-017 R12: A zero-pane board disables the ✕ and the palette unpin action is absent.
- [x] A-018 R9: The 3s disconnect debounce prevents dot flicker on a transient dedicated-stream blip.

### Code Quality

- [x] A-019 Pattern consistency: new props/context field follow existing self-contained-control and per-server-slice conventions; type narrowing over `as` casts (code-quality.md).
- [x] A-020 No unnecessary duplication: ClosePaneButton stays one component (mode via props); board dot reuses `isConnectedByServer`; host-metrics reuses the existing `disconnectTimer` debounce (no new polling).
- [x] A-021 Test companion docs: the new `board-unpin-focused.spec.ts` ships its sibling `.spec.md` in the same change (constitution Test Companion Docs).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ClosePaneButton becomes mode-aware via optional props (`onUnpin`/`disabled`/`label`) rather than a new component | Reuses the single chip/spinner component; matches self-contained-control convention; low blast radius, trivially reversible | S:80 R:90 A:85 D:80 |
| 2 | Confident | Board dot = `entries.length > 0 && every distinct attached server connected` (binary, zero-entry = gray) | Intake A4 approved the all-connected aggregate; zero-entry gray is the natural "nothing flowing" reading | S:70 R:85 A:80 D:70 |
| 3 | Confident | `hostMetricsConnected` uses the dedicated-stream health when the attached set is empty, else derives from per-server `isConnected` | Mirrors the existing dedicated↔fan-out switch and the 3s `disconnectTimer` debounce already in session-context; intake A7 | S:65 R:85 A:80 D:70 |
| 4 | Confident | Board ✕ acts on `entries[focusedIndex]`, disabled at zero panes; distinct unpin aria-label | Intake §3 + A3; `focusedIndex` already tracked in board-page; unpin is non-destructive per the approved legend | S:70 R:85 A:80 D:70 |
| 5 | Confident | `Board: Unpin Focused Pane` palette action added only when entries exist | Constitution V + palette-registration review rule; mirrors the conditional board-cycle entries already gated on `entries.length` | S:55 R:90 A:85 D:70 |
| 6 | Confident | Board unpin e2e models `boards-pin-flow.spec.ts` (API pin → navigate → click ✕ → assert listing), with a `.spec.md` companion | Existing board e2e pattern is the proven template; e2e env WS timing is non-deterministic so listing-endpoint assertion is the reliable contract | S:60 R:85 A:80 D:70 |
| 7 | Confident | Host-metrics-connected unit tests may stub EventSource / drive the applied state at the smallest seam if a full provider render is impractical | session-context opens real EventSources; existing tests use standalone providers — mirror that to keep tests hermetic | S:55 R:85 A:75 D:65 |

7 assumptions (1 certain, 6 confident, 0 tentative).

## Deletion Candidates

- `app/frontend/src/components/board/board-page.tsx:~327` (the `refreshEntry` rationale comment) — its "no top-bar RefreshButton since `currentWindow` is null on a board route" clause is made false by this change (RefreshButton now rides the L3 always-block and renders in board mode); the dual-mount rationale should be restated as palette parity, or the stale clause deleted. The `refresh-page` palette entry itself stays (Constitution V keyboard parity).
- No code deletions found — the change moves/regates existing buttons and adds new wiring; nothing became zero-call-site (`FixedWidthToggle`, `RefreshButton`, `ClosePaneButton`, the AppShell 900px wrapper, and the `toggle-fixed-width` palette action all retain live call sites by design).

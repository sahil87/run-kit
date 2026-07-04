# Intake: Top-Bar Button Pyramid

**Change**: 260704-9o7k-top-bar-button-pyramid
**Created**: 2026-07-04

## Origin

Conversational design session (2026-07-04, in the `hmd0-help-icon` worktree, immediately after shipping the help icon — PR #307). The user reviewed the top-bar right-cluster icon inventory and its per-page subsets, then iterated to a final 3-level grouping. Raw prompts, in sequence:

> These are the set of always show icons: notification, theme, refresh, help - keep these to the right, in this same order.
> The groupings - you can reduce to three: Terminal, Board, Server Cabin / Cockpit. Is there a reason to not show the connection dot on Cockpit? Can we repurpose it so we can show it over there also?

> By the way - maybe 3 groups. If we don't try to force fit the Font size button, there are two buttons that belong in boards - font size and close. Close can be wired into the board page also.
> So the extra buttons in terminal become: Splits, Fixed Width.

The user then approved this pyramid rendering (right-aligned, matching how the cluster behaves — always block pinned right, extras grow leftward):

```
L3  Server Cabin · Cockpit                             🔔   ◐   ⟳   ?   ●
L2  Board                                Aa    ✕       🔔   ◐   ⟳   ?   ●
L1  Terminal          ⎹    ⎯    ↔        Aa    ✕       🔔   ◐   ⟳   ?   ●
```

An earlier idea (2 groups: make the Aa font control work on Cockpit/Server Cabin too) was **rejected** — Cockpit has no terminal text for it to act on; forcing it would turn "terminal font size" into page zoom, which conflicts with the px-fixed design system and duplicates browser zoom.

## Why

1. **Problem**: the right cluster's per-page subsets are ad-hoc (4 distinct subsets across the 4 pages) and some placements are historical accidents: Refresh is terminal-only despite being pure `window.location.reload()`; the connection dot is hidden on Cockpit/Board even though those pages have live streams worth reflecting; Board has no close affordance in the bar; Cockpit has no refresh affordance at all (no button, and it mounts no command palette).
2. **Consequence if unchanged**: users learn different bars per page, useful affordances are missing where they'd help most (dot on the host console, refresh on Cockpit), and the cluster comment documenting the ordering rationale has drifted from reality.
3. **Approach**: a strict 3-level cumulative pyramid — a stable always block pinned right, board extras to its left, terminal extras leftmost — so no icon ever changes position between pages; plus two semantic repurposes (dot = "this page's live data is flowing"; ✕ on board = unpin focused pane) that make the shared buttons meaningful on every page they appear.

## What Changes

All in `app/frontend/` (frontend-only). Primary file: `src/components/top-bar.tsx` (the right cluster is the `justify-self-end` div, currently ~line 322 — line refs below are against the post-PR-#307 tree and are approximate; anchor on symbols).

### 1. Cluster regrouping (`top-bar.tsx`)

Target bar contents, left → right, per page (`TopBarMode`: `terminal` | `board` | `root` (Server Cabin) | `cockpit`):

| Level | Gate | Buttons (left → right) |
|---|---|---|
| L1 — `terminal` only | `mode === "terminal"` (equivalently `currentWindow` set) | SplitButton (vertical) · SplitButton (horizontal) · FixedWidthToggle |
| L2 — `terminal` + `board` | `mode === "terminal" \|\| mode === "board"` | TerminalFontControl (Aa) · ClosePaneButton (✕) |
| L3 — always (all 4 modes) | none | NotificationControl (🔔) · ThemeToggle (◐) · RefreshButton (⟳) · HelpLink (?) · connection dot (●) |

Exact L3 order is user-specified: **notification → theme → refresh → help**, with the **dot remaining the right-most element** (status terminator, not a button). Deltas from today:

- **RefreshButton** moves out of the `currentWindow` block into the always block (behavior unchanged: `window.location.reload()`, Shift-click = `forceReload()`).
- **FixedWidthToggle** moves from always → L1 (terminal-only button). Its *behavior* is untouched: the 900px `maxWidth` wrapper lives in AppShell (`app.tsx`, the `fixedWidth ? { maxWidth: 900, ... }` style) which renders both `terminal` and `root` modes, so Server Cabin keeps the constraint and keeps palette access (`View: Fixed Width` in AppShell `viewActions`). Only the Cabin *button* goes away. It was already a no-op on Board/Cockpit (their pages never read `fixedWidth`).
- **ClosePaneButton** additionally renders on `board` (see §3).
- **TerminalFontControl** gating simplifies from `mode !== "root" && mode !== "cockpit"` to the L2 gate (same result, clearer intent).
- Update the cluster-ordering comment (currently ~`top-bar.tsx:323`) to describe the pyramid, and **correct the stale FixedWidthToggle comment** claiming fixed-width "constrains the max-width of any surface including the server list" — Cockpit (`server-list-page.tsx`) and Board never consume `fixedWidth`.
- All items keep their `hidden sm:flex` wrapper spans (whole cluster stays desktop-only) and the shared 24px/`coarse:30px` `rk-glint` chip styling.

### 2. Connection dot repurpose — "this page's live data is flowing"

Render the dot in **all four modes** (drop the `mode !== "board" && mode !== "cockpit"` gate). New per-page semantics:

- **Terminal / Server Cabin**: unchanged — the current server's SSE stream (`isConnectedByServer.get(server)`).
- **Cockpit**: health of the host-metrics source. Cockpit's live data arrives via a dedicated server-neutral `?metrics=1` EventSource (`session-context.tsx`, the "Dedicated server-independent host-metrics stream" effect, ~line 529) when no per-server stream is attached, or via per-server `event: metrics` fan-out otherwise. This stream's health is currently **untracked** — `server-list-page.tsx` hardcodes `isConnected={false}` (~line 180). Add tracked state (e.g. `hostMetricsConnected`) to session-context: set on the dedicated stream's open/first-event, cleared on error, using the same disconnect-debounce pattern the per-server slices use (`disconnectTimer`); when the dedicated stream is closed because per-server streams carry the fan-out, derive from those streams' connectedness instead.
- **Board**: aggregate over the servers the board attaches — green only when **all** attached servers' streams are connected. `board-page.tsx` hardcodes `isConnected={false}` (~line 464) today; derive from `isConnectedByServer` over the board's server set.

Keep the existing rendering (green `bg-accent-green` / gray dot, `role="status"`, `aria-live="polite"`, aria-label Connected/Disconnected). Tooltip/aria text MAY be refined per mode (e.g. "Live" / "Stream disconnected") but binary green/gray stays.

### 3. Close on Board = unpin focused pane

Board tracks a focused pane (`board-page.tsx` `focusedIndex` over `entries`; each entry knows its server + pane identity). Wire the L2 ✕ button in board mode to **remove the focused pane from the board (unpin)** — the non-destructive action — NOT to kill the underlying tmux pane. Rationale (user-approved): board pins are move-based (`_rk-pin-*` sessions); a top-bar button that kills whatever agent happens to be focused is an expensive misclick. Kill remains available in the pane's own UI.

- TopBar in board mode needs the focused entry (or an `onCloseFocused` callback) passed from `board-page.tsx` — mirror how board already passes its mode-specific props.
- On terminal routes ✕ keeps its current kill-pane behavior. Distinguish the two visually only via `title`/`aria-label` (e.g. terminal: "Close pane"; board: "Unpin pane from board").
- **Keyboard parity** (Constitution V + the review rule that new actions register in the palette): add a matching action to `boardRouteActions` (e.g. `Board: Unpin Focused Pane`), following the existing dual-mount precedent (`refresh-page`, `help-documentation`).
- Disable (or hide) the ✕ when the board has zero panes.

### 4. Tests

- `top-bar.test.tsx`: update per-mode subset assertions to the pyramid (each mode renders exactly its level's buttons; L3 order notification → theme → refresh → help → dot; dot present in all four modes).
- Session-context unit coverage for the new host-metrics connected state (dedicated-stream open/error, fan-out fallback path).
- Board: unit test that ✕ triggers unpin (not kill) for the focused entry, and the palette action exists.
- Playwright e2e where proportionate (UI change — project standard SHOULD): the board unpin flow is the best e2e candidate; remember every new/modified `*.spec.ts` requires its sibling `*.spec.md` companion update (constitution: Test Companion Docs).

### Dependency

**Requires the help icon change (`hmd0`, PR #307 — open draft at intake time) merged or rebased onto**: the L3 always block includes HelpLink, which does not exist on `main` yet. If #307 lands first (expected), branch from updated `main`; otherwise branch from `260704-hmd0-help-icon-top-bar`.

## Affected Memory

- `run-kit/ui-patterns`: (modify) chrome section — right-cluster pyramid (levels, gating, L3 order, dot-everywhere semantics, board ✕ = unpin, fixed-width button now terminal-only while the 900px effect stays AppShell-wide)
- `run-kit/architecture`: (modify) SSE section — host-metrics stream health now tracked/exposed (dedicated `?metrics=1` stream + fan-out fallback) for the Cockpit connection dot

## Impact

- `app/frontend/src/components/top-bar.tsx` — cluster regroup, dot gate removal, ✕ board wiring, comment corrections
- `app/frontend/src/contexts/session-context.tsx` — host-metrics connected state
- `app/frontend/src/components/server-list-page.tsx` — pass real host-metrics health instead of `isConnected={false}`
- `app/frontend/src/components/board/board-page.tsx` — pass aggregate connectedness + focused-pane unpin callback; `boardRouteActions` palette entry
- `app/frontend/src/app.tsx` — possibly only the stale-comment/ordering fallout; `viewActions` unchanged
- Tests as in §4. No backend changes anticipated (unpin should reuse the existing board unpin API the pane UI uses).

## Open Questions

None — the grouping, order, dot semantics, and unpin choice were settled in the design session (see Assumptions for confidence grades).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pyramid grouping and L3 order (notification → theme → refresh → help) exactly as rendered above | User specified the always set + order verbatim and approved the pyramid rendering | S:95 R:85 A:90 D:90 |
| 2 | Certain | Connection dot stays the right-most element (after Help) | Shown in the approved pyramid; consistent with its status-terminator role | S:70 R:95 A:80 D:75 |
| 3 | Confident | Board ✕ = unpin focused pane, never kill; kill stays in pane UI | Recommended twice in the session and present in the approved pyramid legend, but never explicitly confirmed in words — the one decision an implementer should re-read | S:55 R:80 A:70 D:55 |
| 4 | Confident | Dot semantics: Cockpit = host-metrics stream health (dedicated stream or fan-out), Board = AND over attached servers | User asked for the repurpose; the concrete aggregate rule (all-connected = green, binary, no partial state) was the assistant's proposal the user proceeded with | S:65 R:80 A:80 D:65 |
| 5 | Confident | Fixed-width 900px behavior stays on Server Cabin (AppShell wrapper untouched); only the button becomes terminal-only, Cabin keeps palette access | User's premise ("does nothing on cabin") was corrected in-session; user then approved the pyramid with ↔ in L1 knowing the correction | S:70 R:85 A:80 D:70 |
| 6 | Certain | RefreshButton promoted with behavior unchanged (reload / Shift = force) | Pure `window.location.reload()` today; user listed refresh in the always set | S:85 R:90 A:90 D:85 |
| 7 | Confident | Host-metrics health tracked in session-context with the existing slice debounce pattern; derived from fan-out when the dedicated stream is closed | Implementation approach inferred from session-context's documented stream lifecycle — clear codebase signal, easily adjusted at apply | S:55 R:85 A:75 D:65 |
| 8 | Confident | `Board: Unpin Focused Pane` palette action added to `boardRouteActions` | Not user-requested, but Constitution V (palette = primary discovery) + the palette-registration review rule; mirrors the help-documentation dual-mount precedent | S:45 R:90 A:85 D:70 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

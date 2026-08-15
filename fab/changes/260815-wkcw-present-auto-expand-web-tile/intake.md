# Intake: Present Auto-Expand Web Tile

**Change**: 260815-wkcw-present-auto-expand-web-tile
**Created**: 2026-08-15

## Origin

Promptless dispatch (`/fab-proceed`-style Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a synthesized `/fab-discuss` conversation description dated 2026-08-15. No questions were asked; every would-be question is recorded as a deferred Unresolved row in `## Assumptions`.

> **Feature**: When an agent runs `rk present` (default arm — attaching content to the caller's own tmux window by setting `@rk_url`), the RunKit frontend should auto-expand the web tile for a viewer currently viewing that window's route. Today the user must notice rail availability and open the tile manually, which defeats the "show this to the user" intent of the verb.
>
> **Chosen approach — pure frontend, zero backend changes ("the simpler approach")**: the frontend already receives each window's `rkUrl` on the state stream; a viewer currently on a window's route observes that window's `rkUrl` newly set or CHANGED → transiently open/focus the `web` tile in the surface layout. Transient client-side reaction, not a layout mutation — same state class as zoom and `mobileActiveTile`. Dismissal latch on the presented value. Spec/doc amendment carving out the auto-open from the "NEVER opens the viewer's tile" language.

Key decisions were settled in the conversation (encoded as Certain rows below): pure-frontend v1, transient state class, latency accepted, `--window` arm out of scope, dismissal latch, spec/doc amendments.

## Why

1. **The pain point**: `rk present <target>` (default arm) is the toolkit's one-verb "show this to the user" — but today it only sets `@rk_url` on the caller's window. A viewer already looking at that window's route (`/$server/$window`) sees nothing change except the right-rail `://` toggle lighting up. They must notice the rail and click it (or use `⇧⌘.` / `Layout: Add Web`) before the presented content appears. The verb's intent — attention — is not delivered to the one viewer best positioned to receive it.

2. **Consequence of not fixing**: agents presenting artifacts (mocks, reports, served dirs) rely on the human noticing a subtle rail-availability signal, or agents over-use `--notify` (a push notification) or `--window` (a whole new tmux window) for content that belongs on the current window. The default arm stays the weakest arm of the verb.

3. **Why this approach**: a pure-frontend transient reaction is the smallest change that closes the loop, and it is the only shape that preserves the surface-layout model's substrate-vs-view-state split (spec R7): the auto-open is a per-viewer, client-side, non-persisted reaction — the shared substrate fact (`@rk_url`) stays the only thing the CLI writes. The rejected alternative (a fail-silent HTTP wake nudge from `rk present` to the daemon, to beat the 12s worst-case SSE pickup) is additive later and was explicitly deferred; the frontend design MUST NOT depend on it.

## What Changes

### 1. Frontend auto-expand reaction (the `app.tsx` layout seam)

A viewer mounted on window W's terminal route observes W's `rkUrl` transition on the state stream — from empty/absent to set, or from one value to another — and reacts by transiently opening (or focusing) the `web` tile in the resolved surface layout.

- **Where**: `app/frontend/src/app.tsx` owns the one layout-state block (`resolveLayout` ladder, `applyLayout` mutation path) and already receives `WindowInfo.rkUrl` per SSE/state-socket tick (`types.ts:127`). The reaction logic (transition detection + dismissal latch) should live in a pure, DOM-free helper module with colocated tests (the `lib/window-view.ts` / `lib/surface-layout.ts` pattern), wired from `app.tsx`.
- **Transient, never a mutation**: the reaction MUST NOT call `applyLayout` (which writes `rk-layout:` localStorage and mirrors `?layout=` into the URL). It is the same state class as zoom and `mobileActiveTile` (see `docs/memory/run-kit/ui/lenses-and-layout.md` § Surface Layout → Zoom, § Mobile slot-A + sheet tabs): NO localStorage write, NO `?layout=` URL mirror. Leaving the route and returning resolves via the normal ladder (URL > localStorage > hint > `single:tty`). If the user then touches the layout (verbs, rail toggles, ▦ chip, divider drag), it becomes theirs per L3 — the ordinary `applyLayout` path persists as usual.
- **Transition-observed only**: the trigger is a CHANGE observed while mounted — cold route entry never auto-opens (the ladder alone decides what a fresh arrival sees), so a reload or window switch after a present shows the viewer's own resolved layout.
- **Front-runner mechanism** (deferred decision #14 — apply must confirm or revise): a render-time transient override — when the auto-open is active and the resolved layout lacks `web`, render as if `web` were added per the existing growth conventions (1→2 `split-h`, 2→3 `main-left`, matching `addSurface` in `lib/surface-layout.ts`). At arity 3 without `web` (e.g. `main-left:tty,code,chat`) no fourth tile is possible (Constitution IV, max 3) — fall back to no-op. <!-- assumed: transient render-time layout override reusing addSurface growth shapes; arity-3-without-web = no-op — mechanism deferred to apply, see Assumptions #14 -->
- **Already-open web tile**: no layout action — `IframeWindow`'s existing SSE sync already navigates the iframe when `rkUrl` changes (`useEffect` on `rkUrl` + `currentSrcRef`); at most the reaction marks the web tile as the focused tile.
- **Cleared `@rk_url`**: no reaction — availability degradation (`degradeLayout`) already drops an unavailable `web` tile.
- **Not on the route**: viewers elsewhere get NO layout theft — the rail availability signal and `rk present --notify` remain the nudge for them.

### 2. Dismissal latch

If the viewer closes the auto-opened tile (tile ✕, rail toggle, `Layout: Close Web`), remember that `@rk_url` value and do not re-auto-expand for the same value — this prevents an agent's re-present loop from fighting the user.

- **Retrigger is compatible**: present URLs embed a timestamp (`target.URL(..., presentNowFn)` in `app/backend/cmd/rk/present.go` — `presentNowFn = time.Now().Unix`), so re-presenting even the same file changes the `@rk_url` value and correctly retriggers past the latch.
- **Storage** (front-runner): in-memory app state keyed per `(server, windowId)` → last-dismissed `@rk_url` value; resets on reload. No sessionStorage/localStorage — consistent with the transient-state class and L3's "no persistence writes on auto-open" discipline (the latch is bookkeeping for the transient reaction, not a layout preference). <!-- assumed: in-memory dismissal latch, resets on reload — graded Confident, see Assumptions #12 -->

### 3. Latency posture (accepted, no backend work)

`tmux set-option @rk_url` from the CLI is invisible to the tmux control-mode parser, and `rk present` never hits the HTTP option handlers that call the SSE hub's `wake()` (`app/backend/api/sse.go` — `wake` at ~line 1690, with the explanatory comment at ~1681). On a covered quiet server the guaranteed pickup is the 12s safety ticker (`safetyPollInterval = 12 * time.Second`, sse.go:77); typically much faster because other tmux events trigger snapshot passes. Uncovered servers poll at 2.5s (`legacyPollInterval`, sse.go:83). This is ACCEPTED for v1. REJECTED for v1: a fail-silent HTTP wake nudge from `rk present` to the daemon — additive later if the quiet-server worst case grates. The frontend design must not depend on it.

### 4. Spec and doc-comment amendments (part of this change)

Both of these currently assert the opposite of the new behavior and MUST be amended in the same change:

- **`docs/specs/surface-layout.md`** — the R7 commentary / L3 area: carve out transient auto-open for the actively-viewing viewer ("a fresh present is an implicit request for attention"). The carve-out keeps R7's substrate-vs-view-state split intact because the auto-open is a per-viewer client-side reaction with no persistence — L3 ("write on user mutation only") is untouched because nothing is written.
- **`app/backend/cmd/rk/present.go` doc comment (lines 21–23)** — currently: "It NEVER opens the viewer's tile — layout is per-viewer client state (docs/specs/surface-layout.md R7/L3)". Amend to state the transient auto-open carve-out for viewers actively on the window's route. The `Long` help text's "The tile is never opened for the viewer — availability appears on the rail." (present.go:54) needs the same touch. These are comment/help-text edits only — zero Go behavior changes.

### 5. Out of scope

- The `--window` arm: a new window with `@rk_type=iframe` already auto-surfaces (defaults to a single `web` tile via layout-ladder rung 3 / `HINT_ORDER`). No change.
- Any backend change (Go code paths, API surface, SSE hub) — v1 is comment/help-text edits only on the backend side.
- The HTTP wake nudge (rejected for v1, see § 3).

### 6. Tests (constitution-bound)

- **Unit**: the new pure helper (transition detection, dismissal latch, arity edge) gets colocated `.test.ts` coverage (the `surface-layout.ts` module pattern).
- **e2e**: Playwright spec with sibling `.spec.md` (constitution § Test Companion Docs) driving real tmux on the isolated port-3020 rig — the `web-view-lens.spec.ts` pattern already sets `@rk_url` via `tmux set-option -w`, which is exactly the present-default-arm write path. Cases: rkUrl set while viewing → web tile appears transiently (no `?layout=` in URL, no `rk-layout:` localStorage write); close → same value does not re-open; changed value (re-present) → re-opens; cold arrival with rkUrl already set → no auto-open (ladder only). Respect the e2e connection-pool budget (≤2 tiles per flow where possible). Run only via `just test-e2e` / `just pw`.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) add the present auto-expand transient reaction to § Surface Layout (trigger semantics, dismissal latch, its membership in the zoom/`mobileActiveTile` transient state class) and a Design Decisions entry for the R7 carve-out.

## Impact

- `app/frontend/src/app.tsx` — wire the reaction beside the existing layout-state block (render path, no `applyLayout` call).
- New pure helper module under `app/frontend/src/lib/` (+ colocated `.test.ts`) — transition detection + dismissal latch.
- Possibly `app/frontend/src/components/surface-layout.tsx` — only if the transient override or focus handoff needs a prop seam; prefer composing in `app.tsx`.
- `docs/specs/surface-layout.md` — R7/L3 commentary carve-out.
- `app/backend/cmd/rk/present.go` — doc comment (21–23) + `Long` help-text amendment; no behavior change. (Toolkit Standards note: help-text wording changes should be checked against `shll standards` for the help-dump surface.)
- New Playwright spec + `.spec.md` under `app/frontend/tests/`.
- No API, SSE, tmux, or route changes. No new params, no new localStorage keys (the dismissal latch is in-memory).

## Open Questions

- Exact transient composition mechanism: render-time layout override reusing `addSurface` growth shapes (front-runner) vs slot-A swap vs a zoom-like overlay — and what the arity-3-without-web case does (front-runner: no-op). (Deferred — promptless dispatch; Assumptions #14.)
- Mobile: should the reaction transiently set `mobileActiveTile` to `web` on phones, or is v1 desktop-only? (Deferred — promptless dispatch; Assumptions #15.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Zero backend changes in v1; the fail-silent HTTP wake nudge from `rk present` is rejected (additive later) and the frontend design must not depend on it | Discussed — user explicitly chose "the simpler approach" and rejected the wake nudge for v1 | S:95 R:70 A:90 D:95 |
| 2 | Certain | Auto-open is a transient client-side reaction — no localStorage write, no `?layout=` mirror; same state class as zoom/`mobileActiveTile`; leaving+returning resolves via the normal ladder; user layout touch takes ownership per L3 | Discussed — explicitly settled; preserves surface-layout L3 by writing nothing | S:95 R:75 A:90 D:90 |
| 3 | Certain | Latency accepted as-is: covered quiet server worst case = 12s safety ticker, uncovered = 2.5s legacy poll, typically faster via other tmux events | Discussed — verified against sse.go (wake comment ~1681–1690, safetyPollInterval:77, legacyPollInterval:83) | S:90 R:85 A:90 D:90 |
| 4 | Certain | `--window` arm out of scope — a new `@rk_type=iframe` window already auto-surfaces via layout-ladder rung 3 | Discussed — explicitly settled; verified against `hintLayout`/`defaultView` in memory | S:95 R:90 A:95 D:95 |
| 5 | Certain | Dismissal latch: closing the auto-opened tile remembers that `@rk_url` value and suppresses re-auto-expand for the same value | Discussed — explicitly settled to stop re-present loops fighting the user | S:90 R:80 A:85 D:85 |
| 6 | Certain | Re-present retrigger rides timestamped present URLs — `target.URL(..., presentNowFn)` changes the value even for the same file, passing the latch | Verified in app/backend/cmd/rk/present.go (presentNowFn = time.Now().Unix) | S:85 R:80 A:95 D:90 |
| 7 | Certain | Spec/doc amendments are in scope: surface-layout.md R7 commentary + present.go:21–23 doc comment (and the Long help text) carve out transient auto-open for the actively-viewing viewer | Discussed — explicitly required as part of the change; both currently assert "never opens the viewer's tile" | S:90 R:85 A:90 D:90 |
| 8 | Certain | No layout theft for viewers not on the window's route — rail availability and `rk present --notify` remain their nudge | Discussed — explicitly settled | S:90 R:85 A:90 D:90 |
| 9 | Certain | Tests: Playwright e2e with sibling `.spec.md` on the real-tmux port-3020 rig (web-view-lens.spec.ts pattern, `tmux set-option -w @rk_url`) plus unit tests for the pure reaction/latch helper; run only via `just test-e2e`/`just pw` | Constitution (Test Companion Docs) + code-quality.md determine this; the exact rig pattern already exists | S:75 R:90 A:95 D:90 |
| 10 | Confident | Trigger is transition-observed only: a mounted viewer observing rkUrl go empty→set or value→new-value; cold route entry never auto-opens (ladder alone decides) | Description says "observes that window's rkUrl newly set or CHANGED" — transition semantics is the coherent reading, and it protects reload/window-switch UX | S:70 R:75 A:75 D:70 |
| 11 | Confident | Already-open web tile: no layout action on rkUrl change (IframeWindow's SSE sync already navigates); at most mark the web tile focused | Existing SSE sync covers content; "open/focus" reads as open-when-closed, focus-when-open; trivially reversible | S:55 R:80 A:65 D:60 |
| 12 | Confident | Dismissal latch is in-memory per (server, windowId) → dismissed value; resets on reload; never sessionStorage/localStorage | Consistent with the transient state class and the no-persistence discipline; a reload re-running the ladder shows no auto-open anyway (transition-observed) | S:55 R:80 A:70 D:65 |
| 13 | Confident | Clearing/unsetting `@rk_url` triggers no reaction — availability degradation (`degradeLayout`) already removes an unavailable web tile | Existing machinery handles it; adding behavior would be new scope | S:60 R:85 A:80 D:75 |
| 14 | Unresolved | Exact transient composition mechanism: render-time override reusing `addSurface` growth shapes (front-runner) vs slot-A swap vs zoom-like overlay; arity-3-without-web edge = no-op (front-runner) | Deferred — promptless dispatch | S:45 R:70 A:45 D:30 |
| 15 | Unresolved | Mobile behavior: transiently set `mobileActiveTile` to `web` on phones vs desktop-only v1 (mobile never discussed; auto-swapping a phone's single visible tile mid-interaction is a real UX tradeoff) | Deferred — promptless dispatch | S:25 R:75 A:45 D:30 |

15 assumptions (9 certain, 4 confident, 0 tentative, 2 unresolved).

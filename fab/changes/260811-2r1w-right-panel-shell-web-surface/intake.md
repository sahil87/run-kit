# Intake: Right Panel Phase 1 — Rail, Panel Shell & Web Surface

**Change**: 260811-2r1w-right-panel-shell-web-surface
**Created**: 2026-08-11

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a synthesized design-conversation description, executing phase 1 of 3 defined in `docs/specs/right-panel.md` § Phasing (spec written 2026-08-11, authoritative for this feature). Phases 2 (code lens, backlog `[k3vp]`) and 3 (`@rk_owner` companions + agents surface, backlog `[w7qc]`) are explicitly OUT OF SCOPE.

> Right panel phase 1: collapsible right panel shell + rail + WEB surface, on the terminal route (`/$server/$window`). The terminal route gains a second render slot beside the terminal — a (substrate, lens) pair per the spec's model. A ~38px icon rail on the right edge, always visible on desktop, collapsed panel by default. One rail button per available surface; phase 1 ships exactly one surface: `web` — rendering the current window's `web` lens (iframe of `@rk_url` via the relative proxy path) BESIDE the tty instead of instead of it. The panel opens between terminal and rail (~35–40% width, drag-to-resize with xterm FitAddon refit), one surface at a time.
>
> Decisions already made (in the spec — settled, cite right-panel.md): availability derived server-side riding the SSE window payload (Constitution II/X; web available when `@rk_url` set); P1 per-viewer URL-addressable `?panel=<surface>` search param on the existing route + last state per window in localStorage as a value-bearing key + per-viewer width; P2 additive (never changes the main slot's lens); P3 hide never unmount; P4 rail buttons carry availability dots (attention dots become meaningful in phase 3); P5 desktop rail / mobile sheet (mobile-in-v1 is spec Open Question 3, recommendation desktop-only first); P6 one surface at a time; P7 keyboard-first (⌘. toggle, palette `Panel: Web`, focusable rail buttons). Reuse the existing iframe-window rendering component. Known bug class to avoid: IntersectionObserver-based suspension unmounting terminal clients mid-interaction (board-page pane-resize history) — panel open/resize must refit the xterm, not unmount it.
>
> Testing: Playwright e2e on the isolated port-3020 tmux server (set `@rk_url` via tmux set-option; rail button appears; panel opens with iframe; layout/resize; `?panel=` deep link; persistence across reload), companion `.spec.md`, `just test-e2e`/`just pw` only; frontend unit tests for the panel state hook/persistence; mutating-route Playwright mocks need a trailing `*`.

**Correction discovered during intake** (supersedes one line of the dispatch description): change `260714-t97o-web-view-lens` **has shipped** — PR #352 (commit `9c006403`, "Web View Lens — Iframe Viewing Retrofit"), plus the keyboard-shortcut registry PR #475. The lens model is live code: `app/frontend/src/lib/window-view.ts` (`hasWebUrl`, `availableViews`, `resolveView`, value-bearing localStorage keys), `view-switcher.tsx`, and `IframeWindow` already render the `web` lens in the main slot via `?view=web`. This change therefore reuses the *shipped* lens renderer and mirrors its shipped state model — it does not need to hedge against an unshipped draft. Consequence: `⌘.` is already bound (`view-cycle`, `keybindings.ts:193`), which collides with spec P7's chord — see Assumptions #10 and Open Questions.

## Why

1. **Lenses are exclusive** (right-panel.md § The Problem): the main slot renders one lens at a time — choosing `web` hides the tty. The highest-value projections are naturally *beside* the work, not instead of it: the page the pane serves next to the agent producing it. Today an operator watching an agent build a web page must flip `?view=` back and forth or open a second browser tab/board.
2. **If we don't build it**: every "second output" need keeps resolving into worse shapes — synthetic iframe windows (row-less surfaces wearing a window costume, window-views.md § Two Species), extra browser tabs, or board detours — and phases 2/3 (code lens, companion agents) have no placement to land on.
3. **Why this approach**: the spec's (substrate, lens) pair model generalizes the shipped window-views lens registry to a second *placement* with minimal new machinery — no new routes (Constitution IV), no backend changes in phase 1 (availability = the existing `rkUrl` SSE field), and the smallest slice that proves the layout/resize/persistence mechanics (P1–P7) that phases 2 and 3 then inherit.

## What Changes

All frontend (`app/frontend/`). No backend, API, or route changes.

### 1. Pure panel-state helpers — `src/lib/right-panel.ts` (new) + colocated unit tests

Mirror the shipped `window-view.ts` pure/DOM-free pattern exactly:

- `type SurfaceName = "web"` — the phase-1 surface registry; open-ended the way `ViewName` is (`code`/`agents` add members later, no new code path).
- `availableSurfaces(win: ViewWindow): SurfaceName[]` — `web` available exactly when `hasWebUrl(win)` (reuse the shipped helper from `window-view.ts`; single source of truth, no duplicate URL-trim logic). Availability thus derives server-side from the existing `@rk_url` → `rkUrl` SSE window-payload field (Constitution II/X) — **zero backend work in phase 1**.
- `resolvePanel(searchPanel: string | undefined, stored: string | undefined, win): SurfaceName | null` — precedence `?panel=` (when available) → localStorage (when available) → `null` (closed). Unknown or unavailable values fall through, mirroring `resolveView`; `null` means collapsed. Absent localStorage key = closed (value-bearing key, spec P1).
- Storage keys, mirroring `windowViewStorageKey`:
  - `panelStorageKey(server, windowId)` → `runkit-window-panel:${server}:${windowId}` — stores the surface name; opening writes it, closing removes it (absent = closed).
  - Panel width: a single per-viewer key `runkit-panel-width` (not per-window — spec P1: "panel width is a per-viewer localStorage value"), stored as a percentage of the main area.
- Width clamp helper: default **38%** of the main content area, clamped to min **280px** / max **65%** on drag and on restore.
- Read/write wrappers use the try/catch-noop localStorage pattern from `window-view.ts`/`chrome-context.tsx`.

### 2. Rail + panel shell components — `src/components/right-panel.tsx` (new)

- **Rail**: a fixed ~38px vertical strip on the right edge of the terminal-route main area, desktop only, always rendered there (spec § The Model: "always visible on desktop"). One focusable button per *available* surface — phase 1: the `web` button, rendered only when `availableSurfaces` includes it. The button carries the **availability dot** (spec P4; the amber attention semantics arrive in phase 3 — phase 1 ships the dot in its availability state). Active surface shown inverse-video, consistent with the view-switcher's active-segment treatment. Click toggles the surface open/closed.
- **Panel**: opens between the main lens slot and the rail. Contains the surface content; header not required in phase 1 (one surface). A drag handle on the panel's left edge resizes it; during drag the terminal pane MUST stay mounted and live — resize-induced refit rides `TerminalClient`'s existing container `ResizeObserver` (`terminal-client.tsx:396`), which already calls `FitAddon.fit()`. Do **not** introduce IntersectionObserver-based suspension for the panel or the terminal (the board-page pane-resize bug class: suspension unmounting a dragged neighbor mid-interaction).
- **Hide, never unmount (P3)**: collapsing the panel hides the surface subtree at `display` level (e.g. `hidden` class), preserving iframe in-memory state. The panel subtree mounts on first open (lazy), then never unmounts while the route lives.
- **Web surface content**: reuse the shipped `IframeWindow` component (`src/components/iframe-window.tsx`) — same renderer as the main-slot `web` lens, per right-panel.md § Interaction with Existing Plans. Add a panel-context prop that suppresses the `>_` "Switch to terminal" affordance (meaningless in the panel — the tty is already beside it); the URL bar and refresh stay (editing `@rk_url` there is substrate state, shared per window-views R7, and behaves identically from either slot).

### 3. Layout + URL integration — `src/app.tsx` (and the router search-param seam)

- The terminal-route content area becomes a horizontal flex row: `[ main lens slot | panel (when open) | rail ]`. Main slot keeps the existing lens model unchanged (window-views R2–R5). The `.app-shell`/terminal-column `overflow: hidden` guards stay intact.
- New optional `?panel=<surface>` search param on the existing `/$server/$window` route (Constitution IV — no new routes), handled exactly like `?view=`: read raw, validated by `resolvePanel`, written on open/switch, dropped when closed (closed is the clean-URL default). Opening via param or click persists to the per-window localStorage key; closing removes the key.
- `?view=web` and `?panel=web` may be active simultaneously — two independent slots rendering two `IframeWindow` instances (P2: the panel never changes the main slot's lens; no special-casing).
- **Desktop-only in phase 1**: below `isMobileViewport()` (width OR coarse pointer) neither rail nor panel renders and `?panel=` is ignored (falls through to closed). The mobile sheet (spec P5) is a deferred follow-up per spec Open Question 3's recommendation.

### 4. Keyboard + palette (Constitution V)

- New registry action in `src/lib/keybindings.ts`: `panel-toggle` — toggles the last-used surface (phase 1: `web`) open/closed, terminal scope. **Chord: `⇧⌘.` (shifted tier, code `Period`)** — spec P7 names `⌘.`, but `⌘.` is already shipped as `view-cycle` (`keybindings.ts:193`, lens cycle tty→web→chat, PR #475); the panel toggle takes the shifted tier of the same key, leaving the shipped lens cycle untouched. <!-- assumed: ⇧⌘. instead of spec P7's ⌘. — ⌘. is already bound to view-cycle in shipped code; shifted tier of the same key is the least-surprise free chord. User may instead want ⌘. reassigned to the panel and view-cycle moved; confirm via /fab-clarify and amend spec P7 accordingly -->
- Command palette gains `Panel: Web` (opens/toggles the web surface), registered alongside the existing `View: …` entries; the new shortcut is documented in the palette registration (code-review rule) and appears in the shortcuts overlay automatically via the registry.
- Rail buttons are focusable with visible focus treatment.

### 5. Tests

- **Unit** (Vitest, colocated): `src/lib/right-panel.test.ts` — surface availability, `resolvePanel` precedence/fall-through, storage key read/write/remove, width clamp. Component-level tests for rail render gating and toggle behavior where practical.
- **E2E** (Playwright, `app/frontend/tests/right-panel.spec.ts` + sibling `right-panel.spec.md` per constitution Test Companion Docs), on the isolated port-3020 tmux server via `just test-e2e` / `just pw` only:
  - `tmux set-option` `@rk_url` on a test window → rail web button appears (and absent without it);
  - clicking opens the panel with the proxied iframe; terminal remains visible and functional beside it;
  - drag-resize changes panel width; terminal refits (no unmount — assert the xterm instance survives);
  - `?panel=web` deep link opens the panel on load; invalid/unavailable value renders closed;
  - persistence: open → reload → still open; close → reload → closed;
  - collapse hides but does not unmount the iframe (display-level assertion).
  - Any mutating-route mocks use a trailing `*` glob (withServer appends `?server=`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — add the right-panel pattern: rail + panel second render slot on the terminal route, `?panel=` search param + value-bearing per-window localStorage key + per-viewer width, hide-never-unmount, panel reuse of the `IframeWindow` lens renderer, `panel-toggle` shifted-tier chord + `Panel: Web` palette entry.

## Impact

- **Frontend only.** New: `src/lib/right-panel.ts` (+ test), `src/components/right-panel.tsx` (+ test), `tests/right-panel.spec.ts` (+ `.spec.md`). Modified: `src/app.tsx` (terminal-route layout row, `?panel=` handling), `src/lib/keybindings.ts` (one action), `src/components/command-palette.tsx` (one entry), possibly `src/components/iframe-window.tsx` (panel-context prop).
- **No backend changes** — web-surface availability rides the existing `rkUrl` SSE window field. No new routes, no API surface, no tmux interaction beyond what tests set up.
- `app.tsx` is large and load-bearing (lens resolution, transitions); the layout change must not disturb the main-slot lens model or the window-switch transition classification.
- Foundation risk: phases 2/3 inherit these mechanics — the surface registry and panel-state helpers should stay as open-ended as `window-view.ts`'s registry.

## Open Questions

- Spec P7 assigns `⌘.` to the panel toggle, but `⌘.` shipped as the lens cycle (`view-cycle`, PR #475/#352). This intake assumes `⇧⌘.` for the panel and leaves the lens cycle alone — confirm, or decide to reassign `⌘.` to the panel (and rebind the lens cycle), then amend `docs/specs/right-panel.md` P7 to match.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Panel choice via optional `?panel=<surface>` search param on the existing `/$server/$window` route; no new routes | Spec P1 verbatim + Constitution IV; mirrors shipped `?view=` handling | S:95 R:85 A:95 D:95 |
| 2 | Certain | Phase 1 ships only rail + panel shell + `web` surface; `code` lens ([k3vp]) and `@rk_owner`/`agents` ([w7qc]) out of scope | Spec § Phasing row 1 + dispatch description; explicit backlog items exist for 2/3 | S:95 R:90 A:95 D:95 |
| 3 | Certain | Web-surface availability = existing `rkUrl` SSE window field via shipped `hasWebUrl()`; zero backend changes in phase 1 | Spec: "same capability signal as the view registry row"; `window-view.ts` already derives it; Constitution II/X | S:90 R:85 A:90 D:90 |
| 4 | Confident | Reuse shipped `IframeWindow` in the panel slot behind a panel-context prop (suppress `>_` switch-to-tty; keep URL bar + refresh) | 260714-t97o shipped (PR #352) — renderer exists; spec § Interaction says renderer is shared; the `>_` affordance is meaningless beside a visible tty | S:75 R:75 A:80 D:70 |
| 5 | Certain | Hide-never-unmount at `display` level; terminal stays mounted and live during panel drag; refit rides TerminalClient's existing ResizeObserver (no IntersectionObserver suspension) | Spec P3 verbatim; board-page pane-resize bug class documented; `terminal-client.tsx:396` already refits on container resize | S:90 R:80 A:90 D:90 |
| 6 | Certain | Panel is additive (never changes main-slot lens) and renders one surface at a time | Spec P2/P6 verbatim | S:95 R:85 A:95 D:95 |
| 7 | Certain | Persistence mirrors the window-view pattern: value-bearing `runkit-window-panel:{server}:{windowId}` (surface name; absent = closed; open/close writes/removes) + per-viewer `runkit-panel-width`; `?panel=` wins over localStorage; unknown/unavailable falls through to closed | Spec P1 (value-bearing key, per-viewer width) + shipped `windowViewStorageKey`/`resolveView` precedence as the established pattern | S:80 R:85 A:85 D:80 |
| 8 | Confident | Geometry defaults: rail ~38px fixed; panel default 38% of main area, drag-clamped min 280px / max 65% | Spec gives ~38px rail and ~35–40% width; exact default and clamps are implementation picks, trivially tunable | S:65 R:90 A:75 D:65 |
| 9 | Confident | Desktop-only phase 1: below `isMobileViewport()` no rail, no sheet, `?panel=` ignored; mobile sheet (P5) is a follow-up | Spec Open Question 3's own recommendation ("desktop-only first; the sheet is additive"); sheet is purely additive later | S:70 R:85 A:75 D:70 |
| 10 | Tentative | Panel toggle chord is `⇧⌘.` (shifted tier, terminal scope), NOT spec P7's `⌘.` — which is already shipped as `view-cycle` (`keybindings.ts:193`) | Spec contradicts shipped code; shifted tier of the same key is the least-surprise free chord, but reassigning `⌘.` to the panel is also defensible — user preference | S:35 R:70 A:25 D:20 |
| 11 | Certain | Keyboard/palette surface: `panel-toggle` registered in the keybindings registry, `Panel: Web` palette entry, focusable rail buttons | Spec P7 + Constitution V + code-review rule (shortcuts documented in palette registration); registry pattern shipped in #475 | S:85 R:85 A:90 D:90 |
| 12 | Confident | Rail strip always rendered on desktop terminal route; the web button rendered only when the surface is available, carrying the availability dot (attention semantics deferred to phase 3) | Spec: rail "always visible on desktop" + "one button per available surface" + P4 dot; matches view-switcher's render-when-capable precedent | S:70 R:85 A:70 D:60 |
| 13 | Confident | `?view=web` + `?panel=web` simultaneously is allowed — two independent slots, two iframe instances, no special-casing | Spec P2 independence; forbidding it would couple the slots the model keeps separate | S:65 R:85 A:75 D:70 |
| 14 | Certain | Testing: Playwright e2e on isolated :3020 (`@rk_url` via tmux set-option) + companion `.spec.md` + Vitest unit tests for the pure helpers; `just` recipes only; mutating mocks with trailing `*` | Constitution Test Companion Docs + project testing norms in context.md + documented Playwright glob gotcha | S:90 R:90 A:95 D:95 |

14 assumptions (8 certain, 5 confident, 1 tentative, 0 unresolved).

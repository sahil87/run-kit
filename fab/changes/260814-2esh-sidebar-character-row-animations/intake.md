# Intake: Sidebar Character Row Animations (Nyan Cat, Naruto, One Piece)

**Change**: 260814-2esh-sidebar-character-row-animations
**Created**: 2026-08-14

## Origin

One-shot `/fab-new` invocation, natural-language input:

> Add nyan cat, naruto, and one piece animations alongside the existing left-panel row animations for window rows, session rows, and server rows

No prior conversation context existed; all design decisions below were made cold via SRAD and are recorded in `## Assumptions`.

## Why

1. **The pain point**: the sidebar's row-animation repertoire is small and window-only. Today the only animated row treatments are the marker-paired textures on WINDOW rows — the always-on dashed data rain (`.rk-dash-rain`), the double-marker scanlines with selection-gated crawl (`.rk-scanlines` / `.rk-scanlines-crawl`), and the static hazard wedge (`.rk-hazard`). Session rows and server rows have color tints only — no animated treatment at all. Users who label many rows want more distinguishable (and more fun) visual identities per row.
2. **If we don't do it**: rows stay visually homogeneous beyond the 5-marker × color vocabulary; there is no playful/personal channel, and session/server rows remain excluded from the row-decoration system entirely.
3. **Why this approach**: three themed character animations — **nyan cat**, **naruto (ninja runner)**, and **one piece (pirate ship)** — added as a new per-row **flair** channel alongside (not replacing) the existing marker textures, available on all three left-panel row types (window rows, session rows, server group headers). A separate flair channel is chosen over new marker states because markers are a semantic border-style vocabulary (`dotted/dashed/solid/double/thick`) with a paired-grid picker invariant (`GRID_ROWS === MARKER_CELLS.length`, asserted in `swatch-popover.test.tsx`), markers exist only on window rows today, and character sprites are not border styles.

## What Changes

### 1. New per-row `flair` channel (data model + persistence)

A row can carry at most one flair: `"" | "nyan" | "naruto" | "onepiece"` (empty = unset, mirroring the `@rk_marker` "empty = no marker" contract).

- **Storage** (Constitution II — derived from tmux at request time; Constitution X — labels are user-set decoration, already the established pattern for `@rk_color`/`@rk_marker`):
  - Window rows: new tmux **window** user option `@rk_flair` (registered alongside `optKeyMarker = "@rk_marker"` in `app/backend/api/windows.go`, enumerated in `internal/tmux` — add `#{@rk_flair}` to the layout format string in `internal/tmux/layout.go` and the window-list format in `tmux.go`).
  - Session rows: new tmux **session** user option `@rk_flair`, persisted through the same endpoint family as session colors (`setSessionColor` in `src/api/client.ts` → its backend handler).
  - Server rows: server-scoped flair stored the same way server colors are (`getAllServerColors`/`setServerColor` client functions and their backend mechanism).
- **API**: extend the existing options POST endpoints (uniform-POST per Constitution IX) — the window options handler already accepts an `options` map (`{"@rk_marker": "solid"}` → 200); `@rk_flair` becomes an accepted key with an allowlist validation (`nyan|naruto|onepiece|""`), rejecting anything else (Constitution I — validate user input before subprocess). Session and server equivalents mirror their color-setter endpoints. New client functions: `setWindowFlair`, `setSessionFlair`, `setServerFlair` in `src/api/client.ts`, mirroring `setWindowMarker`.
- **State flow**: flair values ride the existing SSE/window-list derivation (`win.flair`, session flair, server flair on their respective state payloads) — no new streams, no client polling.

### 2. Three CSS-only animation overlays (`globals.css`)

Each flair renders as a full-row, always-on ambient overlay following the established `.rk-dash-rain` discipline: a dedicated absolutely-positioned, `pointer-events-none`, `overflow-hidden` overlay element (clipping on the overlay, NEVER the row root — the `.rk-scanlines` rule), `background-position`/`transform`-only animation (no layout thrash; honors the drag-ghost rule where applicable), fixed-period tiles so loops are seamless, low alpha so rows stay readable:

- **`.rk-flair-nyan`** — a small pixel cat sprite (original CSS pixel art via box-shadow stacks or an inline SVG data URI — a stylized rainbow-trailing cat, not copyrighted sprite art) flying left→right across the row, trailing 6 thin rainbow bands (repeating linear-gradient stripes at ~20% alpha). One sprite per row, slow traversal (~8–12s period).
- **`.rk-flair-naruto`** — a small ninja-runner silhouette (leaning forward, arms swept back — the "naruto run" pose, original silhouette art) dashing left→right with a brief speed-line/dust trail (short horizontal dash gradients fading behind the sprite). Slightly faster traversal (~6–8s period).
- **`.rk-flair-onepiece`** — a tiny pirate ship (original art: hull + sail + straw-hat pennant) sailing left→right along a subtle 1px wave baseline near the row bottom (a sine-ish repeating gradient like the rain lanes), gentle bob via a second keyframe on the sprite. Slow traversal (~10–14s period).

All three animate ambiently in every row state (rest/hover/selected), matching the data-rain precedent ("proved quiet enough to run ambiently"); the flair is per-row opt-in, so ambient motion is a deliberate user choice.

**Reduced motion**: motion-only decorations — under `prefers-reduced-motion` all three overlays are hidden entirely (added to the existing reduced-motion gate block in `globals.css`, mirroring `.rk-dash-rain`'s "hidden entirely" handling; source-order rule: base rules precede the gate). No static fallback is needed because flair carries no semantic meaning (unlike marker stripes, which remain).

### 3. Row rendering (three row components)

- **Window rows** (`src/components/sidebar/window-row.tsx`): mount the flair overlay as a sibling of the existing `.rk-scanlines`/`.rk-hazard` overlay spans (same `absolute inset-0 z-[5] overflow-hidden pointer-events-none` slot), gated on `win.flair`. Flair composes with markers/colors — a row can have a color, a marker texture, and a flair simultaneously.
- **Session rows** (`src/components/sidebar/session-row.tsx`): same overlay pattern added to the row root (which is already `relative`).
- **Server rows** (server group headers in `src/components/sidebar/index.tsx` `ServerGroup`): same overlay on the group header row.
- **Render-performance constraint** (sidebar memory § render performance): CSS-only animation, no JS timers, no per-second ticks, no new props that defeat the `ServerGroup`/`SessionRow`/`WindowRow` memoization — flair is a stable string on the existing row data objects.

### 4. Picker surface (`src/components/swatch-popover.tsx` + call sites)

Extend the Label picker with a **flair section**: four cells — ∅ / nyan / naruto / onepiece — following the marker column's live-preview pattern (each non-∅ cell is a miniature row preview carrying its animated flair overlay, like the dashed cell's live rain preview; selection calls a new `onSelectFlair` directly with the exact state, `""` clears; keyboard nav extended to reach the section). The section renders only when an `onSelectFlair` callback is supplied.

- Window rows already open the combined Label picker (color + marker) — they gain the flair section.
- Session rows and server rows open color-only pickers today (`SwatchPopover` without `onSelectMarker`) — they gain the flair section but still no marker column (markers stay window-only; this change does not extend markers).

### 5. Tests

Per code-quality (tests MUST cover added behavior):

- Vitest: `themes.ts`/flair helper unit tests (allowlist normalization), `swatch-popover.test.tsx` extension (flair section render, selection callback, keyboard nav, the existing `GRID_ROWS === MARKER_CELLS.length` invariant untouched), `window-row.test.tsx`/`session-row.test.tsx` overlay mount gating.
- Go: backend option-allowlist validation tests beside the handlers (`windows_test.go` etc.).
- Playwright e2e where feasible (set flair via picker → overlay class present), with the mandatory sibling `.spec.md` companion if a new spec file is added.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) row anatomy gains the flair overlay channel on window/session/server rows; picker entry points
- `run-kit/ui/visual-design`: (modify) row-texture/animation vocabulary gains the three character flairs, their CSS discipline, and the picker flair section; reduced-motion gate additions
- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry gains `@rk_flair` (window + session + server scopes)
- `run-kit/architecture`: (modify) API surface — flair accepted on the options endpoints; new client functions

## Impact

- **Frontend**: `src/components/sidebar/window-row.tsx`, `session-row.tsx`, `index.tsx` (ServerGroup), `src/components/swatch-popover.tsx`, `src/themes.ts` (flair constants/types), `src/globals.css` (three overlay treatments + reduced-motion gate), `src/api/client.ts` (three setters), colocated tests.
- **Backend**: `app/backend/api/windows.go` (accept `@rk_flair`), session/server option handlers, `internal/tmux/tmux.go` + `layout.go` (enumerate the new option), validation in `internal/validate`, Go tests.
- **No new routes/pages** (Constitution IV), **no database** (Constitution II), **POST-only mutations** (Constitution IX).
- Scale: medium — ~10–14 files touched across frontend and backend, no structural changes.

## Open Questions

*None — the three design questions below were asked and resolved in the 2026-08-14 clarification session (see `## Clarifications`).*

## Clarifications

### Session 2026-08-14

| Q | Question | Answer |
|---|----------|--------|
| 1 | Mechanism: separate flair channel vs new marker states? | Separate flair channel — independent of markers, composes with color + marker, extends to session/server rows |
| 2 | Assignment: user-pickable per row vs fixed per row type? | User-pickable per row — all three animations available on every row type via the Label picker |
| 3 | Trigger: always-on ambient vs hover-only vs selected-only? | Always-on ambient — continuous in every row state, low alpha, slow cadence (data-rain precedent) |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New independent per-row **flair** channel (`nyan`/`naruto`/`onepiece`/unset), not new marker states | Clarified — user confirmed. <!-- clarified: flair is a new channel alongside markers, not new marker states — user confirmed 2026-08-14 --> | S:95 R:50 A:50 D:35 |
| 2 | Confident | All three flairs user-pickable per row on all three row types (no positional hardcoding) | Clarified — user confirmed. <!-- clarified: user-pickable per row, all three available everywhere — user confirmed 2026-08-14 --> | S:95 R:55 A:55 D:50 |
| 3 | Confident | Always-on ambient animation in every row state, low alpha, slow cadence | Clarified — user confirmed. <!-- clarified: always-on ambient like the data rain, not hover/selection-gated — user confirmed 2026-08-14 --> | S:95 R:70 A:45 D:35 |
| 4 | Confident | Visuals are original stylized CSS/SVG approximations (pixel cat + rainbow trail, ninja-run silhouette + speed lines, pirate ship + straw-hat pennant on waves) — no copyrighted sprite assets | Only defensible asset posture; agent-drawable with CSS pixel art / inline SVG data URIs; easily iterated later. | S:60 R:80 A:75 D:60 |
| 5 | Confident | Persistence via tmux user option `@rk_flair` (window/session scopes; server flair stored like server colors), POST-only endpoints, allowlist validation, SSE-derived state | Constitution II/IX/X and the existing `@rk_color`/`@rk_marker` pattern determine this almost entirely. | S:55 R:70 A:85 D:75 |
| 6 | Confident | Picker surface = flair section appended to the existing SwatchPopover across all three row entry points (session/server pickers still get no marker column) | The Label picker is the established home for row decoration selection; live-preview cell pattern already exists for markers. | S:45 R:65 A:70 D:60 |
| 7 | Certain | CSS-only overlays (dedicated `pointer-events-none` overlay element, fixed-period seamless tiles, no JS timers, memoization untouched) hidden entirely under `prefers-reduced-motion` | Determined by the documented overlay/rain discipline, the sidebar render-performance constraints, and the project-wide reduced-motion convention. | S:80 R:90 A:100 D:95 |
| 8 | Certain | Tests: Vitest for picker/row/helpers, Go tests for option validation, e2e + `.spec.md` companion where a new spec file is added | code-quality.md and the constitution's Test Companion Docs rule determine this. | S:80 R:90 A:100 D:95 |

8 assumptions (2 certain, 6 confident, 0 tentative, 0 unresolved).

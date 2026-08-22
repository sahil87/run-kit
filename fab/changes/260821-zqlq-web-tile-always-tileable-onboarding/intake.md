# Intake: Web Tile Always-Tileable with Onboarding Empty State

**Change**: 260821-zqlq-web-tile-always-tileable-onboarding
**Created**: 2026-08-21

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized user conversation. The user reported that the web tile cannot be summoned before it is initialized, discussed the fix, **viewed a rendered two-theme mock of the onboarding state and approved it**. The approved reference mock lives at `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-wintry-oryx/5d762600-6927-47ad-8f43-95f7c5f1308b/scratchpad/web-empty-state-mock.html` (session scratchpad, not part of the repo — the copy below is the durable record).

> Web tile always-tileable with an onboarding empty state (feat). Web becomes always-tileable like tty; an empty/whitespace `@rk_url` selects an ONBOARDING content state inside the web tile instead of the iframe. The model is the CODE-SURFACE PRECEDENT: availability = "the lens exists" (stable), the CONTENT says what it needs (code splits availability from reachability and renders "code-server not running — check rk doctor" when unreachable).

## Why

1. **The pain point (user-reported, verified in code)**: web availability derives from a single predicate — `hasWebUrl` in `app/frontend/src/lib/window-view.ts:63` (`rkUrl` non-empty after `.trim()`) — and that predicate gates *everything*: the ⌘3 `web-toggle` chord mounts NO handler on a URL-less window (`app/frontend/src/app.tsx` ~3663-3667 — "a window without the surface (`availableTiles`) mounts no handler and the chord falls through untouched"), the top-bar web toggle button does not render (`SurfaceToggleGroup` renders one button per available surface), the palette `View: Web` / `Tile: Show Web` entries are absent, the mobile switch group omits web, and a `?layout=…web…` deep link silently drops the web tile at `resolveLayout`'s degradation ladder (`degradeLayout`). A user who doesn't know about `rk present` / `@rk_url` has **no discoverable path into the tile at all**.
2. **Consequence of not fixing**: the web tile — one of the product's four lenses — is invisible until an agent or a tmux-literate user happens to set `@rk_url`. Discovery of `rk present`, the proxy pattern, and external-URL embedding all depend on stumbling into documentation.
3. **Why this approach**: the codebase already has the exact precedent — the `code` surface splits AVAILABILITY (stable capability: "the lens exists") from REACHABILITY (content selector: live iframe vs the "code-server not running — check rk doctor" empty state; see `docs/specs/window-views.md` line 66 and `code-surface.tsx`). Web adopts the same split: always tileable, with `hasWebUrl` demoted from availability gate to CONTENT selector. The onboarding state doubles as an init path (live address bar) and as discoverability copy for the three fill mechanisms.

## What Changes

### 1. Availability: web becomes always-tileable (like tty)

- `app/frontend/src/lib/window-view.ts` — `availableViews` includes `"web"` **unconditionally** (registry order via `HINT_ORDER` unchanged). `hasWebUrl` **STAYS exported** — it becomes the content selector (onboarding vs iframe) and the toggle-dot signal.
- `app/frontend/src/lib/surface-layout.ts` — `availableTiles` follows (it keys off `hasWebUrl` at line 205 today; that clause becomes unconditional). Consequence: `resolveLayout`'s degradation ladder (`degradeLayout`) no longer drops web — a `?layout=…web…` deep link keeps its web tile. No ladder-code special-case: the change is purely in the availability predicate.
- `app/frontend/src/lib/right-panel.ts` — `availableSurfaces` delegates to `availableTiles`, so it follows automatically (no edit expected).
- **`defaultView` semantics unchanged**: `"web"` only when `rkType === "iframe"` AND `rkUrl` set; a URL-less window still defaults to `tty`. Only availability changes, never the default.

Accepted consequences (user-approved): ⌘3 always toggles the web tile; the top-bar web toggle button always renders; palette `View: Web` / `Tile: Show Web` / mobile `Tile: Switch to Web` entries always present on the terminal route; web deep links never degrade away.

### 2. Toggle dot semantics repurposed for web

Today `SurfaceToggleGroup` (`app/frontend/src/components/top-bar.tsx:370`) renders an **unconditional** green corner availability dot on every shown button — availability implies shown, so the dot never varies. For web the button is now always there (discoverability); the dot must signal **"has content"** (`hasWebUrl`), not "exists". Implementation direction: a per-surface dot predicate flows from `app.tsx` into the toggle group (both toggle and switch modes, and the overflow-menu Tiles rows if they carry the dot) — web's dot = `hasWebUrl(win)`, every other surface's dot stays always-on (semantics untouched: for them shown still equals available). The mobile switch group shares the same dot derivation (it's the same component forked by the `mode` discriminant).

### 3. The onboarding content state (inside `IframeWindow`)

Rendered by `IframeWindow` (`app/frontend/src/components/iframe-window.tsx`) — or a sibling branch inside it — when `rkUrl` is empty/whitespace. Per the approved mock:

**URL bar** (kept, reduced): the REFRESH button and the ADDRESS INPUT only —
- back/forward hidden (nothing to navigate), find ⌕ button hidden (nothing to search), ↗ open-in-browser hidden (nothing to open).
- The address input is **FULLY LIVE** with placeholder `localhost:3000 · /present/… · https://…` — typing an address and pressing Enter runs the existing pipeline (`normalizeAddressInput` → `isAllowedUrl` → `updateWindowUrl(server, windowId, url)` → `POST /options` partial-merge on `@rk_url`) and boots the tile for real. **This is itself an init path** — no new API, the write path exists.

**Body** (replacing the iframe): centered monospace onboarding panel on `bg-bg-primary` —
- a large dimmed `://` glyph,
- heading **"Nothing to show yet"**,
- subhead *"this tile follows the window's web address (@rk_url) — three ways to fill it:"*,
- three instruction rows (accent-green lead glyph, bold lead-in, `bg-bg-inset` bordered code chips):
  1. `❯` **Ask your agent to show something.** "Present this as a page" — the agent runs `rk present ./report.html` and it appears here. Works for HTML files, diagrams, mocks, directories.
  2. `⇄` **Preview a dev server.** Type `localhost:3000` in the address bar above (proxied through run-kit, works from any device) — or have the agent run `rk present :3000`.
  3. `↗` **Open any URL.** Type an address above — external sites embed when they allow it; find-in-page (⌘F) and back/forward work on same-origin pages.

**Footer** (dimmed, small): *"the tile goes live automatically when an address lands ● no reload needed"* (green dot).

Copy above is user-approved from the mock — reproduce it; minor typographic adaptation to codebase conventions is fine.

**Tile header in onboarding**: plain `://  Web` label, no kind badge, no page title — `classifyAddress` on empty input must not throw and the badge derivation must yield the plain-label form (verify; guard if needed in `surface-layout.tsx`'s `tileMeta`/header derivation).

**No error-state probing in onboarding**: the frame-check / dead-port probes key off an address; with no address there is nothing to probe (the onboarding branch replaces the iframe+error machinery entirely).

### 4. The live-flip is the existing SSE seam

`IframeWindow` already syncs on `rkUrl` (the `useEffect` at iframe-window.tsx:343). When an agent sets `@rk_url` (e.g. `rk present`), the tile transitions onboarding → live iframe automatically: the onboarding branch simply yields to the iframe branch when `rkUrl` becomes non-empty. **No new wiring.** `present-auto-expand` (`lib/present-auto-expand.ts`) is untouched — its transition-observed trigger still auto-opens a not-yet-open web tile on empty→set; if the onboarding tile is already open, the flip happens in place (the `withAutoWeb` identity arm).

### 5. Ripple surfaces (each availability consumer, enumerated)

| Surface | Change |
|---------|--------|
| `lib/window-view.ts` | `availableViews` adds web unconditionally; `hasWebUrl` stays (content selector + dot); `defaultView` unchanged |
| `lib/surface-layout.ts` | `availableTiles` follows; degradation ladder no longer drops web (via the predicate, no ladder edit) |
| `lib/right-panel.ts` | `availableSurfaces` follows automatically (delegates) |
| Top-bar `SurfaceToggleGroup` + overflow Tiles rows (`top-bar.tsx`) | web button always renders; per-surface dot predicate — web dot = `hasWebUrl`, others untouched |
| Palette builders (`lib/palette-view.ts` `buildViewActions`, `lib/palette-layout.ts` `buildLayoutActions`/`buildTileSwitchActions`) | web entries follow availability — now always present on the terminal route (builders are availability-driven; likely no code change, tests change) |
| Mobile switch group | web button always present (radio semantics unchanged). Consequence: tty+web ≥ 2 surfaces always survive the hidden filter, so the switch group now renders on EVERY window at mobile width (previously absent on single-surface windows) — accepted |
| ⌘3 `web-toggle` chord (`app.tsx` tile-chord gating) | handler now always mounts on desktop window routes (availability-driven; follows automatically) |
| Window-switch transition (`ungatedIds`) | an onboarding-web-led layout is non-tty-led → already correct via the resolved layout; **verify only**, no change expected |
| `IframeWindow` render guard in `surface-layout.tsx` tile renderer | web tile render must not assume non-empty `rkUrl`; header renders the plain onboarding form (§3) |
| `webOnly` ⌘F find chord + `Web: Find in page` palette entry | find entry points render only when content exists; the chord must no-op sanely on an onboarding tile (no crash, find state can't open) |

### 6. Spec edits (human-curated, edited alongside)

- `docs/specs/window-views.md` — the R1/R3 derived-availability rules and the lens table's `web` row gain the carve-out: web is always available; `@rk_url` selects CONTENT (onboarding vs live iframe) — worded to mirror the `code` row's existing availability-vs-reachability split (line 66: "reachability governs the renderer's CONTENT … never availability").
- `docs/specs/surface-layout.md` — restates web availability in several places (capability signal at line ~79, switch-group availability at ~213-226); align those statements with the carve-out.

### 7. Tests

**Unit** (colocated, Vitest):
- `window-view.test.ts` — web always in `availableViews`; `hasWebUrl` unchanged; `defaultView` still tty for URL-less windows.
- `surface-layout.test.ts` — web always in `availableTiles`; degradation no longer drops web.
- `palette-view.test.ts` / `palette-layout.test.ts` — web entries present without a URL.
- `iframe-window.test.tsx` — onboarding render: heading, three rows, footer; hidden back/forward/find/↗; refresh + address input present; live address input writes `@rk_url` on Enter (existing `updateWindowUrl` mock pattern); flip to iframe when `rkUrl` arrives.
- `top-bar.test.tsx` — web button always rendered; web dot follows `hasWebUrl`, other surfaces' dots unchanged.
- **Existing assertions that flip**: any unit case asserting web is unavailable without a URL now asserts the new behavior.

**E2E** (real-tmux port-3020 rig, the `web-view-lens.spec.ts` `_tmux.ts` pattern): extend `web-view-lens.spec.ts` or add a sibling spec proving — ⌘3 on a URL-less real-tmux window opens the onboarding tile; typing `localhost:{port}` in the address bar boots the iframe; an `rk present`-style `@rk_url` set (via `tmux set-option -w`) flips it live. **Existing e2e cases asserting the old gating must be updated**: `web-view-lens.spec.ts`'s "palette `View: Web` appears only on web-capable windows" and "`?view=web` on a URL-less window falls back to the terminal" now assert the onboarding tile instead. Constitution: any new/modified `.spec.ts` ships its `.spec.md` sibling in the same commit. Perf budget: ≤2 tiles per test (only one 3-tile test repo-wide; plaintext-origin h1 6-slot pool).

### Out of Scope

- `chat`/`code` availability untouched; `SURFACE_RAIL_HIDDEN` untouched.
- No `@rk_type` semantics change (`iframe` stays a creation-time default-view hint).
- No backend/API change (the `@rk_url` write path exists; Constitution IX/X untouched).
- Desktop lens and board pages untouched.
- `present-auto-expand` semantics untouched.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Window Views availability predicates (`hasWebUrl` role change — content selector, not availability gate; `availableViews` web-unconditional), § Iframe Window (the onboarding state joins the error states / URL-bar docs), § Surface Layout / § Surface Toggles (tile availability, degradation, toggles, ⌘3 gating note).
- `run-kit/ui/top-bar`: (modify) surface-toggle corner dot semantics for web (has-content, per-surface predicate).
- `run-kit/ui/keyboard-and-palette`: (modify) ⌘3 `web-toggle` no longer capability-gated (always mounts on desktop window routes); palette `View: Web` / `Tile:` web entries always present on the terminal route; `webOnly` ⌘F onboarding no-op note.

## Impact

- **Frontend only**: `app/frontend/src/lib/window-view.ts`, `lib/surface-layout.ts`, `components/iframe-window.tsx`, `components/top-bar.tsx`, `components/surface-layout.tsx` (header/onboarding guard), `app.tsx` (dot predicate plumbing; chord/palette follow availability automatically), possibly `lib/web-url.ts` (empty-input guard). `lib/right-panel.ts` follows with no edit.
- **Tests**: colocated unit suites above + `app/frontend/tests/` e2e (extend `web-view-lens.spec.ts` and/or new spec + `.spec.md`).
- **Specs**: `docs/specs/window-views.md`, `docs/specs/surface-layout.md`.
- **No backend, no API, no routes** (Constitution IV/IX): the one POST the web lens fires (`@rk_url` via `updateWindowUrl`) already exists.
- **Verification**: scoped Vitest suites then full `just test-frontend`, `tsc --noEmit`, `just test-e2e` for the touched web specs; both-theme visual check via the dev rig if warranted.

## Open Questions

*(none — the design was resolved in conversation; the user approved the rendered two-theme mock)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Web is always-tileable (availability unconditional in `availableViews`/`availableTiles`); `hasWebUrl` demoted to content selector + dot signal; all availability consumers (⌘3, toggles, palette, mobile switch, deep links) follow | Discussed — user explicitly chose the code-surface availability-vs-content precedent and accepted every enumerated consequence | S:95 R:70 A:95 D:95 |
| 2 | Certain | Onboarding copy, layout, and reduced URL bar (refresh + live address input only) reproduced verbatim from the approved mock; minor typographic adaptation allowed | User viewed and approved a rendered two-theme mock; copy is transcribed in § What Changes | S:95 R:90 A:95 D:95 |
| 3 | Certain | `defaultView` unchanged — a URL-less window still defaults tty; `@rk_type=iframe` + URL still hints web | Explicitly stated in the discussion; preserves 260714-r7rq terminal-default | S:90 R:85 A:95 D:95 |
| 4 | Confident | Dot mechanism: a per-surface dot predicate passed into `SurfaceToggleGroup` (web = `hasWebUrl`, others constant-true), since today's dot is unconditional on every shown button | Direction (dot = has-content for web, others untouched) is user-decided; the prop shape is an apply-time implementation detail, easily revised | S:80 R:85 A:85 D:75 |
| 5 | Confident | Find gating: the ⌕ URL-bar button and `Web: Find in page` entry points render only when content exists; the `webOnly` ⌘F chord no-ops on an onboarding tile (find bar can't open) | Description names this the simplest handling; entry-point gating is the established pattern (cross-origin disables the bar similarly) | S:75 R:90 A:85 D:80 |
| 6 | Confident | Onboarding tile header renders plain `://  Web` label — no badge, no page title; guard `classifyAddress`/header meta against empty input | Follows from the mock + the header's existing badge derivation; needs a small verify/guard at apply | S:70 R:90 A:80 D:80 |
| 7 | Confident | Mobile switch group now renders on EVERY window at mobile width (tty+web always ≥2 surviving surfaces) | Direct consequence of always-available web + the group's ≥2 render gate; user accepted "mobile switch entries always present" | S:75 R:80 A:80 D:70 |
| 8 | Confident | `ungatedIds` window-switch classification needs no code change (onboarding-web-led resolves non-tty-led via the resolved layout); verify with a test or manual check | The classification keys on the resolved layout order, not on `hasWebUrl`; verification task, not a design fork | S:70 R:90 A:80 D:80 |
| 9 | Confident | `present-auto-expand` untouched: transition-observed trigger unchanged; an already-open onboarding tile flips in place via the `withAutoWeb` identity arm | Module semantics are orthogonal to availability; reviewed against memory § Present auto-expand | S:70 R:85 A:85 D:80 |
| 10 | Certain | Spec edits scoped to `window-views.md` (R1/R3 + lens-table web row) and `surface-layout.md` (availability restatements), worded on the code row's availability-vs-reachability model | Both specs verified to restate web availability; the code row's wording is the named model | S:85 R:90 A:90 D:85 |
| 11 | Confident | E2E: extend `web-view-lens.spec.ts` (and/or one sibling spec) for the three onboarding flows; existing URL-less-fallback assertions flip to assert onboarding; ≤2 tiles per test | Test plan named in the discussion; extend-vs-new-file is an apply-time choice within the stated budget/constitution rules | S:70 R:90 A:80 D:70 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).

# Plan: Per-Instance Accent Color (Host Color)

**Change**: 260721-1etw-instance-accent-host-color
**Intake**: `intake.md`

## Requirements

### Backend: Instance-color setting storage

#### R1: `instance_color` field in `~/.rk/settings.yaml`
The settings package (`app/backend/internal/settings/settings.go`) SHALL persist a new scalar field `InstanceColor` under the top-level key `instance_color`, using the ServerColors color-value descriptor format (`"4"` = single ANSI index, `"1+3"` = two-hue blend). Reads MUST be tolerant (a legacy bare integer normalizes via `validate.NormalizeColorValue`; malformed values are dropped). Serialization MUST quote the value and MUST emit the key only when non-empty, so a settings file without an instance color serializes byte-identically to today's output (the exact-string `TestSaveAndLoad`/`TestSerialize` constraint). `GetInstanceColor() *string` / `SetInstanceColor(color *string) error` MUST mirror `GetServerColor`/`SetServerColor` (load-then-save; nil clears).

- **GIVEN** a settings file containing `instance_color: "1+3"`
- **WHEN** `Load()` runs
- **THEN** `Settings.InstanceColor == "1+3"` and a subsequent `Save` round-trips the same value

- **GIVEN** a settings file with no `instance_color` key (legacy file)
- **WHEN** `Load()` then `Save()` runs
- **THEN** the serialized output is byte-identical to the pre-change output

#### R2: `GET/POST /api/settings/instance-color` endpoint pair
`app/backend/api/settings.go` SHALL add `handleGetInstanceColor` / `handleSetInstanceColor`, registered in `app/backend/api/router.go` next to the server-color pair (router.go:566-567). GET returns `{"color": "4"}` or `{"color": null}` (the explicit setting only — the hash fallback is client-side). POST accepts `{"color": "4"|"1+3"|null}`; a non-null value MUST pass `validate.ValidateColorValue` (400 on malformed); null clears the setting. Mutation is POST-only (constitution §IX). There is no `server` key (scalar setting).

- **GIVEN** no instance color set
- **WHEN** `GET /api/settings/instance-color`
- **THEN** the response is `200 {"color": null}`

- **GIVEN** `POST /api/settings/instance-color` with body `{"color":"99"}`
- **WHEN** the handler validates the descriptor
- **THEN** the response is `400` and nothing is persisted

- **GIVEN** a stored instance color
- **WHEN** `POST /api/settings/instance-color` with body `{"color":null}`
- **THEN** the setting is cleared and GET returns `{"color": null}`

### Frontend: Accent resolution

#### R3: Fallback chain — settings → paint-cache echo → hostname hash
The frontend SHALL resolve the instance accent in this order: (1) `instance_color` from the GET endpoint (authoritative); (2) the localStorage echo, used only as a paint cache before the fetch resolves (never authoritative); (3) a deterministic hash of the hostname (from the existing `/api/health` fetch, `getHealth()` in `src/api/client.ts`) mapped onto the six standard ANSI hues — legacy descriptors `"1"`…`"6"` (which resolve to owned families via `resolveFamily`: red/green/amber/blue/magenta/teal). The hash MUST be stable across loads and devices (pure function of hostname). When the hostname is not yet known and no explicit color or echo exists, no accent renders (no crash, no flicker of a wrong color).

- **GIVEN** `instance_color` unset and hostname `"gcp-box"`
- **WHEN** the accent resolves
- **THEN** the accent is `ansi[1 + (hash("gcp-box") % 6)]`'s legacy descriptor, identical on every load and every viewing device

- **GIVEN** `instance_color: "5"` stored on the instance
- **WHEN** any device loads the app
- **THEN** the resolved accent is `"5"` regardless of localStorage contents

#### R4: localStorage echo (`runkit-instance-color`)
On every successful resolution (and on every accent or theme change), the frontend SHALL echo the resolved accent to localStorage key `runkit-instance-color` as JSON `{"value": "<descriptor>", "hex": "#rrggbb"}` — `value` is the resolved descriptor, `hex` is the computed meta-tag content (R8). The echo is a paint cache only: it seeds the pre-paint script and the first-frame accent, and is overwritten by the authoritative resolution on every load. Malformed/missing echo JSON MUST be ignored silently. localStorage access MUST be try/catch-guarded (existing convention).

- **GIVEN** a corrupted `runkit-instance-color` value in localStorage
- **WHEN** the app boots
- **THEN** the pre-paint script falls back to the theme-default theme-color and the runtime resolution proceeds normally, rewriting the echo

#### R5: Instance-accent provider + API client functions
`src/api/client.ts` SHALL add `getInstanceColor(): Promise<string | null>` and `setInstanceColor(color: string | null): Promise<void>` mirroring the server-color client pair. A new `InstanceAccentProvider` (`src/contexts/instance-accent-context.tsx`), mounted once in `RootWrapper` inside `ThemeProvider`, SHALL own the resolution (R3), the echo (R4), and the meta bridge (R8), and expose via `useInstanceAccent()`: the resolved descriptor, theme-derived hexes for the rendering surfaces, the explicit-color flag (whether a manual color is set), and a `setColor(color | null)` writer that updates state optimistically and POSTs through `setInstanceColor` (toast on failure).

- **GIVEN** the provider is mounted at the root
- **WHEN** both `RootTopBar` and `HostPanel` consume `useInstanceAccent()`
- **THEN** they observe the same resolved accent from a single fetch, and a pick in the HOST panel repaints the top-bar stripe without a reload

### Frontend: Rendering surfaces

#### R6: Top-bar stripe + wash
The persistent top bar SHALL carry a 2px accent stripe across its full width (rendered in `AppLayout`/`RootTopBar` territory in `src/app.tsx`, above the `TopBar` header) plus a subtle tinted wash (~6.5% blend of the accent into the theme background) behind the top-bar region. Both MUST derive from the active theme via existing `themes.ts` machinery — the stripe uses the contrast-guarded family hex (`computeRowBorders`, which applies `adjustBorderForContrast` vs `BORDER_MIN_CONTRAST`), the wash uses `blendHex(accentSrc, palette.background, ratio)` — never hardcoded hexes. Blend descriptors (`"1+3"`) render through the same `resolveFamily`-based derivation as single indices (the owned-family mapping — no new blend scheme). When no accent is resolved yet, neither stripe nor wash renders.

- **GIVEN** a resolved accent and the active theme
- **WHEN** the user switches theme (dark ↔ light or any palette)
- **THEN** the stripe and wash recompute from the new palette (contrast-guarded), with no hardcoded color surviving the switch

#### R7: HOST panel — accent-tinted hostname + swatch picker
`src/components/sidebar/host-panel.tsx` SHALL render the hostname in the panel's `headerRight` slot in the accent color (contrast-guarded hex, same derivation as R6's stripe) and add a palette swatch button beside it opening a **color-only** `SwatchPopover` (no `onSelectMarker`), portalled to `document.body` at fixed coordinates with the flip-above heuristic — the exact ServerGroup-header precedent (`sidebar/index.tsx` x4sf, PR #432). A pick writes through `useInstanceAccent().setColor` (which POSTs `/api/settings/instance-color`); `Clear color` sends null, restoring the hash default (R3). The palette button follows the header-affordance reveal convention (`opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100`) and carries an aria-label.

- **GIVEN** the HOST panel with a resolved accent
- **WHEN** the user picks a swatch
- **THEN** the hostname tint, top-bar stripe, and PWA titlebar update immediately and the value persists in `~/.rk/settings.yaml` on the instance's host

- **GIVEN** an explicit instance color
- **WHEN** the user picks `Clear color`
- **THEN** the setting clears (POST null) and the accent falls back to the hostname-hash default

#### R8: PWA titlebar bridge — single theme-color meta writer
The `<meta name="theme-color">` tag SHALL become accent-aware through one shared writer module (`src/instance-accent.ts`): (a) the blocking pre-paint script in `index.html` reads the echoed `hex` from `runkit-instance-color` and applies it as the initial theme-color (falling back to the existing per-mode defaults) so an installed PWA window opens already tinted; (b) at runtime the meta content is the contrast-guarded accent hex (the same hex as R6's stripe), updated whenever the accent or theme changes; (c) `theme-context.tsx`'s `applyThemeToDOM` MUST delegate its meta write to the shared writer so a theme switch cannot clobber the accent tint (today it writes `theme.palette.background` directly). With no accent resolved, the meta content is the theme background (current behavior).

- **GIVEN** an accent-tinted meta tag and a running PWA window
- **WHEN** the user switches theme
- **THEN** `applyThemeToDOM` runs and the meta tag still carries the (recomputed) accent hex, not the bare background

- **GIVEN** a previous session echoed `{"hex":"#8a3d2f"}`
- **WHEN** an installed PWA window opens
- **THEN** the titlebar paints `#8a3d2f` before any fetch resolves (no flash of the untinted default)

### Non-Goals

- Dynamically-served `manifest.json` (per-host `name`/`short_name`) — follow-up change
- Tinted manifest/dock icons and the Badging API — follow-up change (dock-icon staleness at PWA install time is an accepted, documented limitation)
- Per-viewer (per-browser) accent — the accent is a property of the instance, stored on its host

### Design Decisions

#### Single theme-color meta writer module
**Decision**: Centralize all `meta[name="theme-color"]` writes in `src/instance-accent.ts` (module-level current-accent + last-background state); `theme-context.tsx` and the accent provider both funnel through it.
**Why**: React passive effects run child-first — `ThemeProvider`'s `applyThemeToDOM` effect fires after any child accent effect on a theme switch and would clobber an accent-tinted meta tag with the bare background. One writer with shared state removes the ordering race at its root.
**Rejected**: Having the accent provider re-write the meta after theme changes in its own effect — loses deterministically to the parent effect's ordering; fixing symptom, not cause.
*Introduced by*: 260721-1etw-instance-accent-host-color

#### Echo carries the precomputed meta hex, not just the descriptor
**Decision**: `runkit-instance-color` stores `{"value","hex"}` where `hex` is the final computed meta-tag content; the blocking script applies `hex` verbatim.
**Why**: Deriving a hex from a descriptor requires the OKLCH/palette machinery (`colorValueToHex`), far too heavy to inline in a blocking script. Precomputing at echo time keeps the script a 3-line read-and-apply.
**Rejected**: Inlining a blend/derivation in `index.html` — duplicates themes.ts logic in unlintable inline JS; echoing only the descriptor — leaves the script unable to tint.
*Introduced by*: 260721-1etw-instance-accent-host-color

## Tasks

### Phase 1: Backend storage + API

- [x] T001 Add `InstanceColor string` to `Settings` in `app/backend/internal/settings/settings.go`: parse top-level `instance_color` key (quote-stripped, tolerant via `validate.NormalizeColorValue`, malformed dropped), serialize quoted after `theme_light` only when non-empty, add `GetInstanceColor() *string` / `SetInstanceColor(color *string) error` mirroring the server-color pair; extend `app/backend/internal/settings/settings_test.go` with round-trip, legacy-bare-int, malformed-drop, and empty-is-byte-identical serialization tests <!-- R1 -->
- [x] T002 Add `handleGetInstanceColor` / `handleSetInstanceColor` to `app/backend/api/settings.go` (GET → `{"color": descriptor|null}`; POST `{"color": string|null}` with `validate.ValidateColorValue` on non-null, null clears) and register both routes in `app/backend/api/router.go` next to the server-color pair; extend `app/backend/api/settings_test.go` (persist, persist-blend, clear-on-null, reject-malformed, GET round-trip) <!-- R2 -->

### Phase 2: Frontend accent core

- [x] T003 [P] Add `getInstanceColor()` / `setInstanceColor(color)` to `app/frontend/src/api/client.ts` next to the server-color client functions <!-- R5 -->
- [x] T004 [P] Create `app/frontend/src/instance-accent.ts`: `hashHostnameColor(hostname)` (FNV-1a 32-bit mod 6 → descriptors "1"–"6"), echo read/write helpers for `runkit-instance-color` (`{value, hex}` JSON, try/catch, malformed → null), and the single theme-color meta writer (`applyThemeColorMeta(background)` + `setAccentThemeColor(hex | null)` over module state); add `app/frontend/src/instance-accent.test.ts` covering hash determinism/range, echo round-trip + malformed tolerance, and writer last-wins semantics <!-- R3 R4 R8 -->
- [x] T005 Rewire `applyThemeToDOM` in `app/frontend/src/contexts/theme-context.tsx` to delegate its meta `theme-color` write to `applyThemeColorMeta` from `src/instance-accent.ts` (drop the direct `tc.setAttribute` line) <!-- R8 -->
- [x] T006 Create `app/frontend/src/contexts/instance-accent-context.tsx` (`InstanceAccentProvider` + `useInstanceAccent()`): fetch `getInstanceColor()` + `getHealth()` hostname on mount (StrictMode-guarded), seed first paint from the echo, resolve per the R3 chain, derive `{stripeHex, washHex}` from the active theme (`computeRowBorders` / `blendHex` via `useTheme()`), echo + meta-update on accent/theme change, expose optimistic `setColor` (POST, toast on failure); mount in `RootWrapper` in `app/frontend/src/app.tsx` inside `ThemeProvider`; add `instance-accent-context.test.tsx` (fallback chain, explicit color wins, clear restores hash) <!-- R5 R3 R4 R8 -->

### Phase 3: Rendering surfaces

- [x] T007 [P] Render the 2px accent stripe + ~6.5% wash on the persistent top bar in `app/frontend/src/app.tsx` (`AppLayout`'s `shrink-0` wrapper around `RootTopBar`), from `useInstanceAccent()`; nothing renders when no accent is resolved <!-- R6 -->
- [x] T008 [P] Extend `app/frontend/src/components/sidebar/host-panel.tsx`: hostname span tinted with the contrast-guarded accent hex, palette swatch button in `headerRight` (hover-reveal + coarse fallback, aria-label) opening a color-only `SwatchPopover` portalled with the x4sf fixed-position flip heuristic; picks/clears go through `useInstanceAccent().setColor`; extend `app/frontend/src/components/sidebar/host-panel.test.tsx` (tint applied, picker opens, pick writes, clear sends null) <!-- R7 -->
- [x] T009 [P] Extend the blocking pre-paint script in `app/frontend/index.html`: parse `runkit-instance-color`, validate the `hex` shape (`#rrggbb`), and use it as the initial theme-color content; fall back to the existing per-mode defaults when absent/malformed <!-- R8 R4 -->

### Phase 4: Verification

- [x] T010 Run the verification gates in order: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build`; fix any failures <!-- R1 R2 R3 R4 R5 R6 R7 R8 -->

## Execution Order

- T001 blocks T002 (handlers call the new settings functions)
- T003 and T004 are independent [P]
- T005 depends on T004 (the writer module must exist)
- T006 depends on T003, T004, T005
- T007, T008 depend on T006; T009 depends on T004's echo format — all three [P] against each other
- T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `InstanceColor` round-trips through `~/.rk/settings.yaml` (string descriptor and blend), tolerates a legacy bare integer, and drops malformed values on read
- [x] A-002 R2: `GET /api/settings/instance-color` returns the explicit setting or null; `POST` validates descriptors (400 on malformed), persists, and clears on null; both routes registered via GET/POST only
- [x] A-003 R3: the resolution chain is settings → echo (paint only) → deterministic hostname hash over descriptors "1"–"6"; explicit setting always wins over localStorage
- [x] A-004 R6: the persistent top bar shows a 2px accent stripe and a subtle wash, both derived from the active theme (contrast-guarded / blended), absent when no accent is resolved
- [x] A-005 R7: the HOST panel hostname renders in the accent color with a swatch button opening a color-only SwatchPopover; a pick persists via the POST endpoint
- [x] A-006 R8: the theme-color meta tag carries the accent hex at runtime and the pre-paint script applies the echoed hex before first paint

### Behavioral Correctness

- [x] A-007 R8: switching themes after an accent is applied does not clobber the meta tag back to the bare background (single-writer delegation verified)
- [x] A-008 R1: a settings file without `instance_color` serializes byte-identically to the pre-change output (exact-string test)

### Scenario Coverage

- [x] A-009 R3: a test proves the hostname hash is deterministic and lands in descriptors "1"–"6"
- [x] A-010 R7: clearing the color (Clear color → POST null) restores the hash-default accent without reload

### Edge Cases & Error Handling

- [x] A-011 R2: malformed color descriptors ("99", "1+", "x", "1+2+3") are rejected with 400 and nothing persists
- [x] A-012 R4: corrupted/missing echo JSON is ignored silently (pre-paint falls back to theme defaults; runtime rewrites the echo)
- [x] A-013 R3: empty/unknown hostname (health fetch failed) yields no accent and no crash — surfaces render without stripe/tint

### Code Quality

- [x] A-014 Pattern consistency: new code follows the surrounding conventions (settings parse/serialize style, handler shape, popover portal precedent, `runkit-*` storage keys)
- [x] A-015 No unnecessary duplication: reuses `validate.ValidateColorValue`/`NormalizeColorValue`, `SwatchPopover`, and `themes.ts` derivation (`resolveFamily`, `computeRowBorders`, `blendHex`) — no new color scheme
- [x] A-016 Tests included: Go settings + API tests and frontend Vitest tests cover the added behavior (code-quality.md mandate)
- [x] A-017 No client polling: accent resolution is a one-shot fetch (no `setInterval`); no in-memory backend caches (state derived from the filesystem at request time)
- [x] A-018 Type narrowing over assertions: new TS uses guards/discriminated shapes, no `as` casts beyond existing-pattern JSON parses

### Security

- [x] A-019 R2: the color descriptor is validated server-side (`validate.ValidateColorValue`) before touching the settings file; no user input reaches a subprocess

## Notes

- **Verification-gate findings (apply run, 2026-07-22)**: `just test` — backend and frontend suites fully green (Go all packages; Vitest 1650/1650). Playwright e2e: 159 passed; `status-dot-tip` failures were flaky (green on rerun); `sidebar-window-sync.spec.ts:254` ("kill-then-create at same index") and `sync-latency.spec.ts:237` ("Kill window via Ctrl+click") fail identically on the clean pre-change baseline (verified via `git stash` + rerun) — pre-existing, not introduced by this change. `just build`: frontend `tsc + vite build` green; the Go build step fails on `cat VERSION` (file removed by the tag-driven release flow, PR #193; absent on baseline and the main checkout) — pre-existing; `go build ./...` + `go vet` on the backend pass directly.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is purely additive (new settings field, endpoint pair, provider, and rendering surfaces). The one non-additive edit (`theme-context.tsx` delegating its `meta[name="theme-color"]` write to `applyThemeColorMeta`) *moved* the write into the shared single-writer module rather than making any code redundant; no leftover direct `setAttribute` writer remains.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Hash = FNV-1a 32-bit over the hostname, `1 + (h % 6)` → legacy descriptors "1"–"6" | Intake fixed the target set (`ansi[1..6]`) but left the function open (intake #10); FNV-1a is tiny, dependency-free, and trivially swappable | S:70 R:90 A:80 D:65 |
| 2 | Confident | Echo payload is JSON `{value, hex}` with `hex` = final meta content; the blocking script applies `hex` verbatim (theme-mode mismatch on a cross-mode load is an accepted transient that self-corrects post-fetch) | The script cannot run the OKLCH derivation; precomputing keeps it a read-and-apply; intake fixed the key convention (`runkit-instance-color`) but not the payload shape | S:65 R:85 A:75 D:60 |
| 3 | Confident | Meta theme-color content = the contrast-guarded accent hex (same hex as the stripe), full strength — not a background blend | Intake §6 says "update the meta tag with the contrast-adjusted accent hex"; using the stripe's guarded hex keeps titlebar and stripe coherent | S:75 R:90 A:80 D:70 |
| 4 | Confident | Wash implemented at 6.5% `blendHex` into the theme background on the top-bar wrapper; stripe uses `computeRowBorders` guarded hex | Intake #9 grants explicit latitude (6-7% band, stripe-only sanctioned fallback); one CSS constant, trivially tunable at review | S:60 R:95 A:70 D:55 |
| 5 | Certain | `GET /api/settings/instance-color` returns the explicit setting only (`null` when unset); the hash fallback lives client-side | Intake §3 places the whole fallback chain "on the frontend"; keeps the endpoint a pure mirror of the settings field | S:85 R:90 A:90 D:85 |
| 6 | Confident | `instance_color` serializes after `theme_light`, before `server_colors`, emitted only when non-empty | Serialization order is unspecified; scalar-with-scalars grouping matches the file's existing shape and preserves the byte-identical constraint for legacy files | S:60 R:95 A:85 D:75 |
| 7 | Confident | No new Playwright spec: coverage via Go + Vitest unit tests; the existing e2e suite runs as the regression gate (`just test`) | An e2e POST would mutate the developer's real `~/.rk/settings.yaml` (settings are HOME-scoped, not isolated by the e2e tmux/port isolation); code-quality's e2e clause is SHOULD-grade | S:55 R:80 A:75 D:60 |
| 8 | Certain | `InstanceAccentProvider` mounts once in `RootWrapper` inside `ThemeProvider`; both surfaces consume `useInstanceAccent()` | Matches the established root-provider pattern (Theme/Chrome/Session); the two consumers (top bar, HOST panel) share one fetch and one state | S:80 R:85 A:90 D:85 |
| 9 | Confident | Baseline-failing verification steps treated as out of scope: 2 e2e specs (`sidebar-window-sync:254`, `sync-latency:237`) and `just build`'s `cat VERSION` step fail identically on the pre-change baseline (stash-verified) | Test-integrity rule: fixes must trace to this change's spec; these failures predate it and are independent of every touched file | S:75 R:85 A:80 D:75 |

9 assumptions (2 certain, 7 confident, 0 tentative).

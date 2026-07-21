# Intake: Per-Instance Accent Color (Host Color)

**Change**: 260721-1etw-instance-accent-host-color
**Created**: 2026-07-21

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent, `{questioning-mode} = promptless-defer`) from a feature description synthesized from a prior design conversation. The conversation resolved storage, fallback, picker placement, rendering surfaces, and the PWA titlebar bridge; those decisions are captured below verbatim, not re-derived.

> Per-instance accent color ("host color") so multiple run-kit instances are visually distinguishable. The user runs several run-kit instances (laptop, Mac mini, a GCP server) and views them all as Chrome PWA windows on one laptop. The windows are visually identical — only the document-title hostname suffix (already shipped via `use-browser-title.ts` + `/api/health` hostname) distinguishes them. A color channel is missing.

## Why

1. **Pain point**: Multiple run-kit instances viewed as installed Chrome PWA windows on one laptop are visually identical. The only differentiator today is the document-title hostname suffix (`use-browser-title.ts` reading `/api/health` `hostname`), which is easy to miss when windows are stacked or in the dock/task switcher. Acting on the wrong instance (killing sessions, sending keystrokes) is a real risk.
2. **Consequence of not fixing**: As the user's instance count grows (laptop, Mac mini, GCP server today), misdirected actions and constant title-squinting get worse. The title channel is already saturated; no color channel exists.
3. **Why this approach**: The accent is a property of the *instance*, not the viewer — so it is stored authoritatively on the instance's host in `~/.rk/settings.yaml`, and every device viewing that instance sees the same accent. This also keeps the color visible to the backend for a future dynamic-manifest / tinted-dock-icon follow-up. It is constitution-compatible (Principle II: filesystem state, no database). **Alternative rejected**: localStorage as the authoritative store — it is per-browser-per-device, so a pick on the laptop wouldn't show on the phone.

## What Changes

### 1. Settings storage — `instance_color` in `~/.rk/settings.yaml`

New field `InstanceColor` in `app/backend/internal/settings/settings.go` (persisted key `instance_color`), following the existing `ServerColors` pattern exactly:

- Same color-value descriptor format: `"4"` = single ANSI index, `"1+3"` = two-hue blend. Stored as a string so a blend can round-trips; reads tolerate a legacy bare integer if the parser normalizes (mirror `ServerColors` normalization).
- A scalar field (one color per instance), unlike the `ServerColors` map — so persistence is a single top-level key, simpler than the map serialization at `settings.go:167-178`.
- Empty/absent means "no explicit color set" — the fallback chain (§3) applies.

### 2. API — `GET/POST /api/settings/instance-color`

New endpoint pair in `app/backend/api/settings.go`, routes registered in `app/backend/api/router.go` next to the existing pair (`router.go:566-567`):

```go
r.Get("/api/settings/instance-color", s.handleGetInstanceColor)
r.Post("/api/settings/instance-color", s.handleSetInstanceColor)
```

Mirror `handleGetServerColor` / `handleSetServerColor` (settings.go:88, :105) for request/response shape, validation of the color descriptor, and clear-on-null semantics — minus the `server` key (instance color is scalar). POST-only mutation per constitution Principle IX.

### 3. Fallback chain (resolution order on the frontend)

1. `instance_color` from settings.yaml (via the GET endpoint) — authoritative.
2. localStorage echo — paint cache only, never authoritative (see §5): the last resolved value echoed to localStorage on every load so the pre-paint script can tint without a fetch.
3. `hash(hostname)` mapped to one of the six standard ANSI hues (`ansi[1..6]`) — zero-config identity default (constitution Principle VII). Hostname comes from the existing `/api/health` fetch (`app.tsx:551-557`). Note: with 6 hues and 3 hosts, collision odds are ~45%, which is why the manual override (§4) matters.

### 4. Picker — swatch button on the HOST panel header

- File: `app/frontend/src/components/sidebar/host-panel.tsx` (bottom of sidebar). The panel header already has a `headerRight` slot rendering the hostname (`host-panel.tsx:21-34`).
- Reuse the existing `SwatchPopover` component (`app/frontend/src/components/swatch-popover.tsx`) exactly as the server-group header color picker does (PR #432 precedent, change `260721-x4sf-sessions-header-color-close-actions`).
- A pick writes through `POST /api/settings/instance-color`; clearing restores the hash default.
- Tests follow the `server-panel.test.tsx` pattern; Go tests cover the settings field round-trip.

### 5. Rendering surfaces (instance accent owns surfaces server colors never touch)

Server colors already saturate the sidebar (tiles, group headers, row stripes) and mean "which tmux server"; the instance accent means "which run-kit instance". Its surfaces:

- **Top bar**: a 2px accent stripe across the top of the persistent top bar (`RootTopBar` in `app/frontend/src/app.tsx`, ~line 222), plus a subtle tinted wash (~6-7% blend) on the top-bar background. Exact wash intensity is a taste decision — stripe-only is acceptable.
- **HOST panel header**: the hostname text rendered in the accent color, next to the swatch.
- All tints MUST be theme-aware via the existing `app/frontend/src/themes.ts` derivation (contrast-adjusted tints/borders from the active theme's `ansi[1..6]` — `blendHex`, `adjustBorderForContrast`, `HUE_FAMILIES`, `resolveFamily`/`parseColorValue`), never hardcoded hexes.

### 6. PWA titlebar bridge — `<meta name="theme-color">`

- `app/frontend/index.html` already has a blocking pre-paint script that sets theme-color from `localStorage["runkit-theme"]` (index.html:8-23). Extend the same pattern:
  - Echo the resolved instance color into localStorage on every load (the §3 paint cache).
  - Have the blocking script blend the echoed instance color into the initial theme-color so an installed PWA window opens already tinted (no flash).
  - After the runtime settings fetch resolves, update the meta tag with the contrast-adjusted accent hex. Desktop Chrome retints installed-PWA titlebars live on meta changes.

### 7. Explicitly out of scope (follow-up change)

- Dynamically-served `manifest.json` (per-host `name`/`short_name`).
- Tinted manifest/dock icons and the Badging API.
- This change only lays the storage groundwork (settings.yaml) those need. Note: dock icons are snapshotted at PWA install time and only refresh on Chrome's lazy manifest-update cycle — accepted limitation, documented, not worked around.

### Existing plumbing to reuse (verified in this repo)

- `/api/health` returns `hostname`; `app.tsx:551` fetches it on mount.
- `use-browser-title.ts` already suffixes titles with the hostname.
- `SwatchPopover` + `themes.ts` tint derivation + the settings.yaml read/write path (`internal/settings`) all exist.

## Affected Memory

- `run-kit/architecture`: (modify) new `instance_color` settings field and the `GET/POST /api/settings/instance-color` endpoint pair in the REST API layer
- `run-kit/ui-patterns`: (modify) instance-accent surfaces — top-bar stripe/wash, HOST-panel hostname tint + swatch picker, theme-color pre-paint bridge, fallback chain

## Impact

- **Backend (Go)**: `app/backend/internal/settings/settings.go` (+ `settings_test.go` round-trip), `app/backend/api/settings.go` (+ test), `app/backend/api/router.go` (2 routes).
- **Frontend (TS/React)**: `app/frontend/src/components/sidebar/host-panel.tsx` (+ test), `app/frontend/src/app.tsx` (`RootTopBar` stripe/wash, resolution + localStorage echo + meta update), `app/frontend/src/themes.ts` (only if a small helper is needed — prefer reusing existing derivation), `app/frontend/index.html` (blocking script extension), `app/frontend/src/api/client.ts` (client calls for the new endpoints).
- **No new routes/pages** (constitution Principle IV untouched — this is chrome, not a page). No database (Principle II). Mutation via POST (Principle IX).
- **Risk**: low — additive; the hash fallback means zero-config behavior changes only by gaining a colored stripe.

## Open Questions

- None — the design conversation resolved all blocking decisions; remaining latitude is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Authoritative storage is `instance_color` in `~/.rk/settings.yaml` (`internal/settings`), ServerColors descriptor format ("4" / "1+3") | Discussed — user chose settings.yaml over localStorage (rejected: per-browser-per-device); constitution II compatible | S:95 R:70 A:90 D:95 |
| 2 | Certain | Endpoint pair `GET/POST /api/settings/instance-color` mirroring `/api/settings/server-color`, minus the `server` key | Discussed; constitution IX mandates POST mutation; direct precedent at router.go:566 | S:95 R:85 A:95 D:95 |
| 3 | Certain | Fallback chain: settings.yaml → localStorage echo (paint cache only) → `hash(hostname)` over `ansi[1..6]` | Discussed explicitly, incl. ~45% collision odds rationale for the manual override | S:90 R:80 A:85 D:90 |
| 4 | Certain | Picker is a SwatchPopover swatch on the HOST panel header, exactly per the PR #432 server-group header precedent | Discussed; component and headerRight slot verified in host-panel.tsx | S:95 R:85 A:90 D:90 |
| 5 | Certain | Surfaces: 2px stripe on RootTopBar + accent-colored hostname text in HOST panel header; theme-aware via themes.ts derivation, no hardcoded hexes | Discussed with explicit surface-ownership rationale (server colors own the sidebar) | S:90 R:85 A:85 D:85 |
| 6 | Certain | PWA bridge: extend the index.html blocking pre-paint script + localStorage echo + live meta update after settings fetch | Discussed with mechanism; existing script verified at index.html:8-23 | S:90 R:80 A:80 D:85 |
| 7 | Certain | Out of scope: dynamic manifest.json, tinted manifest/dock icons, Badging API — follow-up change; dock-icon staleness accepted | Explicit in discussion | S:95 R:90 A:95 D:95 |
| 8 | Certain | Tests: Go settings round-trip test + frontend tests per `server-panel.test.tsx` pattern | Discussed; also mandated by code-quality.md ("new features MUST include tests") | S:80 R:90 A:90 D:80 |
| 9 | Confident | Top-bar tinted wash at ~6-7% blend alongside the 2px stripe; exact intensity tunable at review, stripe-only sanctioned as fallback | Taste decision per discussion, but user granted explicit latitude and it is one trivially-reversible CSS constant | S:60 R:90 A:30 D:50 |
| 10 | Confident | Hash default uses a simple deterministic hostname hash (e.g., FNV-1a or char-code sum) mod 6 → `ansi[1..6]`; exact function unspecified in discussion | Any stable hash satisfies the zero-config-identity intent; trivially swappable | S:70 R:85 A:80 D:60 |
| 11 | Confident | Two-hue blend descriptors ("1+3") render on instance surfaces by reusing the existing server-color blend rendering (themes.ts `blendHex` / blend handling), not a new scheme | Discussion fixed the descriptor format but not blend rendering on the new surfaces; reuse is the obvious project-pattern answer | S:65 R:80 A:70 D:60 |
| 12 | Certain | localStorage echo key follows the existing `runkit-*` convention (e.g., `runkit-instance-color`) | Naming convention is uniform across the codebase (`runkit-theme`, `runkit-panel-host`, `runkit-terminal-font-size`) | S:60 R:90 A:85 D:80 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).

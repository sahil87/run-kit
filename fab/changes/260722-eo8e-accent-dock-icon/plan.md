# Plan: Accent-Tinted PWA Dock Icon

**Change**: 260722-eo8e-accent-dock-icon
**Intake**: `intake.md`

## Requirements

### Backend: Dynamic Manifest

#### R1: Dynamic `GET /manifest.json`
The Go backend MUST serve `GET /manifest.json` from an explicit route registered before the SPA catch-all. When `settings.GetInstanceColor()` resolves to no owned family (unset, or a valid-but-unowned descriptor), the response body MUST be byte-identical to the stock `manifest.json`. When it resolves to an owned family, each icon `src` MUST carry a cache-busting query `?c=<descriptor>` with the descriptor percent-encoded (`+` → `%2B`, e.g. `/generated-icons/icon-512.png?c=1%2B3`). The color is read per request (Constitution §II — no cached settings read).

- **GIVEN** no `instance_color` in `~/.rk/settings.yaml`
- **WHEN** `GET /manifest.json`
- **THEN** the body equals the stock manifest bytes exactly

- **GIVEN** `instance_color: "1+3"`
- **WHEN** `GET /manifest.json`
- **THEN** all three icon `src` values end with `?c=1%2B3` and the rest of the manifest is unchanged

### Backend: Tinted Icon Serving

#### R2: `?c=`-keyed tinted PNG routes
The backend MUST serve the three `generated-icons/*.png` paths (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`) from explicit routes registered before the SPA catch-all. Without `?c=`, or with a `?c=` that is malformed or maps to no owned family, the stock bytes MUST be served (treat-as-absent — no 400). With a valid owned-family `?c=<descriptor>`, the response MUST be the stock PNG colorized per R3, and the encoded result MUST be cached in memory keyed by (icon name, normalized descriptor) — a memoized pure function of stock bytes + descriptor, never persisted.

- **GIVEN** `GET /generated-icons/icon-192.png` (no query)
- **WHEN** the handler runs
- **THEN** the body is byte-identical to the stock PNG

- **GIVEN** `GET /generated-icons/icon-192.png?c=1%2B3`
- **WHEN** the handler runs
- **THEN** the body is a valid PNG whose logo pixels carry the orange family tint, and a repeat request is served from the in-memory cache

- **GIVEN** `GET /generated-icons/icon-192.png?c=zzz` (or `?c=7`, valid index but no owned family)
- **WHEN** the handler runs
- **THEN** the stock bytes are served

#### R3: Luminance→hue colorize treatment
The tint MUST be treatment "A — colorized logo" using Go stdlib only (`image`, `image/png`, `image/color`): a per-pixel luminance→accent ramp where pixels at/below a background-luma ceiling (the `#0f1117` background, luma ≈ 17) are left untouched, and brighter pixels render as the accent hex scaled by `luma / 180` (so the logo's brightest gray `#b4b4b4` maps to the accent itself and darker grays to proportionally darker accent). Alpha is preserved. No new Go dependencies; sharp stays build-time-only.

- **GIVEN** the stock `icon-192.png` and the blue family hex
- **WHEN** the colorize runs
- **THEN** a background pixel (e.g. corner `(0,0)` = `#0f1117`) is unchanged, a `#b4b4b4` logo pixel becomes exactly the accent hex, and a mid-gray pixel becomes the accent scaled toward black

#### R4: Fixed descriptor→hex map mirroring the owned families
Go MUST carry a fixed map from the 10 owned-family legacy descriptors to their default-dark hexes, exactly as the frontend computes them (`colorValueToHex(family, DEFAULT_DARK_THEME.palette)` in `themes.ts`): red `1`→`#ee7871`, orange `1+3`→`#e58439`, amber `3`→`#c19b22`, olive `1+2`→`#95ad33`, green `2`→`#51b96d`, teal `6`→`#00b9aa`, blue `4`→`#4fa5f8`, purple `1+4`→`#a08ef5`, magenta `5`→`#d37ccb`, slate `3+4`→`#95a2b0`. Lookup MUST normalize input via `validate.NormalizeColorValue` first (so `" 1 + 3 "`, `"04"` resolve), and a descriptor that normalizes to no owned key MUST report not-found (mirroring `resolveFamily` returning null — the frontend renders no accent for such values, so the icon stays stock).

- **GIVEN** descriptor `"04"`
- **WHEN** resolved
- **THEN** it normalizes to `"4"` and yields `#4fa5f8`

- **GIVEN** descriptor `"2+5"` (valid per `ValidateColorValue` but not an owned legacy key)
- **WHEN** resolved
- **THEN** the lookup reports not-found and callers serve stock

### Backend: Tinted Favicon

#### R5: Dynamic tinted `favicon.svg`
The backend MUST serve `GET /generated-icons/favicon.svg` from an explicit route that resolves the tint from `settings.GetInstanceColor()` per request (no `?c=` required — `index.html`'s href is static). With an owned accent, the five grayscale fills (`#b4b4b4`, `#2a2a2a`, `#888888`, `#737373`, `#545454`) MUST be string-substituted with the same colorize-ramp hexes R3 produces for those luma values; otherwise the stock SVG bytes are served. The response SHOULD carry `Cache-Control: no-cache` so an accent change propagates on the next tab load.

- **GIVEN** `instance_color: "4"`
- **WHEN** `GET /generated-icons/favicon.svg`
- **THEN** the SVG contains no grayscale fills and its brightest fill equals the blue family hex

### Backend: Stock-Byte Source Seam

#### R6: Embedded-vs-filesystem stock source
Stock manifest/icon bytes MUST come from the same seam `mountSPA` branches on: when `useEmbeddedSPA`, read from the embedded frontend FS (`fs.Sub(build.Frontend, "frontend")`); otherwise read from the filesystem, trying `spaDir` (built dist) first and falling back to the frontend `public/` source dir (`app/frontend/public` from the repo root, `../frontend/public` from the `app/backend` dev cwd that `air` uses) so `just dev` serves these routes without a built dist. A missing asset MUST return 404, never panic.

- **GIVEN** filesystem mode with no `dist/` built and cwd `app/backend` (air)
- **WHEN** `GET /manifest.json`
- **THEN** the stock bytes are read from `../frontend/public/manifest.json` and served

### Frontend: Dev Parity

#### R7: Vite dev proxy entries
`app/frontend/vite.config.ts` MUST proxy `/manifest.json` and `/generated-icons` to the backend port (same `RK_PORT + 1` target shape as the existing `/api` entry) so dev serves the dynamic versions. Vite's `server.proxy` middleware runs before public-dir static serving, so the entries shadow the static copies — no conflict, no static fallback needed.

- **GIVEN** `just dev` (Vite on `RK_PORT`, Go on `RK_PORT + 1`)
- **WHEN** the browser fetches `/manifest.json` or `/generated-icons/icon-192.png`
- **THEN** the request is forwarded to the Go backend's dynamic handlers

### Tests: E2E Proxy Coverage

#### R8: Playwright coverage of the proxied PWA assets
An e2e spec MUST verify, against the `just test-e2e` dev server, that `/manifest.json` returns 200 with `Content-Type: application/manifest+json` (proving the request traversed the proxy to the Go handler — Vite's static serving would answer `application/json`) and parses as the RunKit manifest, and that `/generated-icons/icon-192.png` and `/generated-icons/favicon.svg` return 200 with PNG magic bytes / SVG content respectively. Assertions MUST be tint-agnostic (the dev box's real `~/.rk/settings.yaml` may or may not carry an accent). The spec MUST ship with its sibling `.spec.md` companion (constitution § Test Companion Docs).

- **GIVEN** the e2e dev server on port 3020
- **WHEN** the spec issues `request.get("/manifest.json")`
- **THEN** it gets 200, `application/manifest+json`, and `name: "RunKit"` with 3 icons

### Non-Goals

- Per-host manifest `name`/`short_name` — raised in design, not confirmed; out of scope per intake.
- Badging API.
- Any change to the picker UI or the accent settings/API (shipped in `1etw`).
- Working around Chrome's install-time icon snapshot / ~daily manifest re-check — documented limitation, not engineered around.

### Design Decisions

#### Blend descriptors resolve via the owned-family map, not hex blending
**Decision**: A blend descriptor (`"1+3"`) resolves through the fixed legacy-descriptor→family map (orange), exactly like `resolveFamily` in `themes.ts`; descriptors that map to no owned family (e.g. `"2+5"`) yield no tint (stock assets).
**Why**: This is what the shipped frontend actually does — `colorValueToHex` resolves `FAMILY_BY_LEGACY` and returns null for unowned values, so the top-bar/titlebar show no accent for them. Blending two arbitrary family hexes in Go would make the Dock icon disagree with every other accent surface.
**Rejected**: Arithmetic blending of the two indices' hexes (the intake's parenthetical) — it describes the pre-owned-palette swatch semantics, which no longer exist in the frontend.
*Introduced by*: 260722-eo8e-accent-dock-icon

#### Manifest rewrite by string substitution, not JSON round-trip
**Decision**: The set-accent manifest is produced by `strings.ReplaceAll` of the three known icon `src` literals with their `?c=`-suffixed forms.
**Why**: Keeps the unset path trivially byte-identical and the set path byte-identical everywhere except the three srcs; a JSON unmarshal/remarshal would reorder/reformat.
**Rejected**: `encoding/json` round-trip — formatting churn for no robustness gain on a file this repo owns.
*Introduced by*: 260722-eo8e-accent-dock-icon

## Tasks

### Phase 1: Core tint package

- [x] T001 Create `app/backend/internal/icontint/icontint.go`: fixed descriptor→hex map (10 owned legacy keys → default-dark hexes per R4), `HexForDescriptor(descriptor) (string, bool)` normalizing via `validate.NormalizeColorValue`; unit tests in `icontint_test.go` covering normalization, owned keys, unowned/malformed inputs <!-- R4 -->
- [x] T002 Add colorize to `internal/icontint`: shared luma→accent ramp, `TintPNG(stock []byte, hex string) ([]byte, error)` (stdlib image/png, alpha preserved, bg-luma ceiling untouched, `#b4b4b4`→accent) and `TintSVG(stock []byte, hex string) []byte` (five-fill string substitution); unit tests with synthetic-PNG golden pixels and SVG fill assertions <!-- R3 -->

### Phase 2: API handlers + routing

- [x] T003 Add `app/backend/api/pwa.go`: `readSPAAsset(relPath)` seam (embedded FS when `useEmbeddedSPA`, else `spaDir` then `app/frontend/public` / `../frontend/public` fallbacks) <!-- R6 -->
- [x] T004 In `api/pwa.go`: `handleManifest` (per-request `settings.GetInstanceColor()`, unset/unowned → stock bytes verbatim, owned → `?c=<url.QueryEscape(descriptor)>` src substitution, `Content-Type: application/manifest+json`); tests in `api/pwa_test.go` (byte-identical unset, `%2B` encoding set, isolateSettings pattern) <!-- R1 -->
- [x] T005 In `api/pwa.go`: `handleTintedIcon` for the three PNG paths (`?c=` parse → normalize → family lookup; absent/invalid/unowned → stock; owned → `icontint.TintPNG` with in-memory cache on `Server` keyed `name|descriptor`, mutex-guarded, bounded by 10 families × 3 icons); tests: stock passthrough byte-identical, golden-pixel tint against the real `app/frontend/public` assets (scan stock for `#b4b4b4` and corner `#0f1117`), invalid-`?c=` fallback, cache-hit repeat <!-- R2 -->
- [x] T006 In `api/pwa.go`: `handleFavicon` (per-request settings resolve, owned → `icontint.TintSVG` cached by descriptor, else stock; `Cache-Control: no-cache`, `Content-Type: image/svg+xml`); tests for tinted/stock paths <!-- R5 -->
- [x] T007 Register the five explicit routes in `app/backend/api/router.go` immediately before `s.mountSPA(r)`; run `cd app/backend && go test ./...` <!-- R1 -->

### Phase 3: Dev parity + e2e

- [x] T008 [P] Add `/manifest.json` and `/generated-icons` proxy entries to `app/frontend/vite.config.ts` (same target shape as `/api`) <!-- R7 -->
- [x] T009 Add `app/frontend/tests/e2e/pwa-assets.spec.ts` + sibling `pwa-assets.spec.md` (tint-agnostic: manifest 200 + `application/manifest+json` + name/icons shape; icon-192 200 + PNG magic; favicon 200 + `<svg`); grep existing e2e specs for assertions invalidated by the proxy change (none found at plan time — verify) <!-- R8 -->

### Phase 4: Verification

- [x] T010 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test` (backend + frontend + e2e), `just build`; ensure ports 3020/3021 are free afterwards <!-- R1 --> <!-- note: `just build` fails at `cat VERSION` on this branch — pre-existing (VERSION deleted in #193, scripts/build.sh not updated); prod build verified instead via frontend build + embed copy + `go build ./cmd/rk` + embedded-mode smoke test of all five routes. 2 e2e failures (sidebar-window-sync kill-then-create, sync-latency kill-window) reproduce on the clean baseline with this change stashed — pre-existing, not regressions -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /manifest.json` is served by an explicit Go route before the SPA catch-all; unset accent → byte-identical stock body; owned accent → all three icon srcs carry `?c=<descriptor>` with `+` encoded as `%2B`
- [x] A-002 R2: The three `generated-icons/*.png` routes serve stock bytes without/with-invalid `?c=` and a tinted PNG for an owned `?c=`, memoized in memory keyed (icon, descriptor)
- [x] A-003 R3: The colorize is stdlib-only, leaves `#0f1117` background pixels untouched, maps `#b4b4b4` to the accent hex, scales darker grays proportionally, and preserves alpha
- [x] A-004 R4: The Go descriptor→hex map carries exactly the 10 owned legacy descriptors with the default-dark hexes listed in R4, normalizes input via `validate.NormalizeColorValue`, and reports not-found for unowned descriptors
- [x] A-005 R5: `favicon.svg` is served dynamically — tinted via five-fill substitution when an owned accent is set, stock otherwise — resolving settings per request
- [x] A-006 R6: Stock bytes come from the embedded FS in prod and from `spaDir`-then-`public/` fallbacks in filesystem mode; a missing asset 404s
- [x] A-007 R7: Vite dev proxies `/manifest.json` and `/generated-icons` to the backend port

### Behavioral Correctness

- [x] A-008 R1: With no accent configured, every new route's response body is byte-identical to what the static pipeline served before this change (zero-config behavior unchanged)
- [x] A-009 R2: Tint responses are a pure function of stock bytes + descriptor — no persisted generated assets, no settings-read caching (Constitution §II)

### Scenario Coverage

- [x] A-010 R2: Go tests golden-pixel the tinted output against the real committed PNGs (background pixel unchanged, `#b4b4b4` pixel → family hex)
- [x] A-011 R8: `pwa-assets.spec.ts` passes against `just test-e2e` and ships with an up-to-date `pwa-assets.spec.md` companion

### Edge Cases & Error Handling

- [x] A-012 R2: Malformed (`?c=zzz`), empty (`?c=`), and valid-but-unowned (`?c=7`, `?c=2+5`) descriptors all serve stock bytes with 200 — never 400/500
- [x] A-013 R6: Filesystem mode with no built dist serves the routes from the frontend `public/` dir; when no source is found the route 404s without panicking

### Code Quality

- [x] A-014 Pattern consistency: New handlers follow the `Server`-method + `writeJSON`/explicit-header house style; tests follow the `isolateSettings` / `spaDir`-override patterns
- [x] A-015 No unnecessary duplication: Descriptor validation/normalization reuses `internal/validate`; no reimplementation of color parsing
- [x] A-016 No new dependencies: tint uses Go stdlib image codecs only; sharp remains build-time-only
- [x] A-017 Tests included: new behavior is covered by Go unit tests (icontint), Go handler tests (api), and a Playwright e2e spec

### Security

- [x] A-018 R2: The `?c=` query value never reaches a subprocess or filesystem path — it is normalized by `validate.NormalizeColorValue` and used only as a map key; icon filenames come from a fixed route whitelist, not user input

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new dynamic asset routes; the static `public/manifest.json` and `public/generated-icons/*` files remain the stock-byte source (read by `readSPAAsset`), so no existing code, file, or config is made redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Invalid/malformed/unowned `?c=` is treated as absent (serve stock, 200) — not 400 | Intake assumption 8 delegated this to plan and named treat-as-absent the robust front-runner; icons are fetched by browsers/OS surfaces where a 400 breaks the install for no user-fixable reason | S:65 R:90 A:85 D:75 |
| 2 | Confident | Blend descriptors resolve via the owned-family legacy map (`"1+3"`→orange hex), and unowned-but-valid descriptors (e.g. `"2+5"`) tint nothing | Verified in `themes.ts`: `resolveFamily`/`colorValueToHex` resolve `FAMILY_BY_LEGACY` and return null otherwise — the intake's "blend the two family hexes" parenthetical describes retired semantics; matching the live frontend keeps the Dock consistent with every other accent surface | S:80 R:85 A:90 D:85 |
| 3 | Confident | The 10 default-dark family hexes are computed once from `colorValueToHex(family, default-dark palette)` (OKLCH L/C stats over ansi[1..6]) and frozen as Go constants: `#ee7871 #e58439 #c19b22 #95ad33 #51b96d #00b9aa #4fa5f8 #a08ef5 #d37ccb #95a2b0` | Computed by porting the pure themes.ts math verbatim against `configs/themes.json` default-dark; a fixed map is exactly what the intake specifies (Dock icon is theme-independent) | S:75 R:80 A:85 D:80 |
| 4 | Confident | Ramp shape: pixels ≤ luma 24 untouched; above, `accent × (luma/180)` per channel (clamped), so `#b4b4b4` = accent, grays darker proportionally | Intake grants ramp latitude; this keeps the background exactly unchanged (bg luma ≈ 17), maps the brightest logo gray to the accent itself for maximum small-size legibility, and is trivially golden-pixel testable | S:70 R:85 A:85 D:70 |
| 5 | Confident | `?c=` is written `url.QueryEscape`d (`%2B`) into the manifest and read via Go's standard query decoding; normalization on read also tolerates a literal space (`"1 3"` never arises since `NormalizeColorValue` trims parts around `+`) | Intake assumption 10 delegated the `+`-encoding choice; Go owns both sides, and QueryEscape/ParseQuery round-trips the descriptor exactly | S:70 R:90 A:90 D:80 |
| 6 | Confident | Dev parity: proxy both `/manifest.json` and `/generated-icons` (no static fallback needed); the backend's filesystem asset source falls back from `spaDir` to `app/frontend/public` / `../frontend/public` so the air-run backend (cwd `app/backend`) can serve stock bytes without a built dist | Vite applies `server.proxy` before public-dir middleware so proxying shadows the static copies cleanly; the `../frontend/public` fallback covers the only dev cwd in use (`scripts/dev.sh` runs air from `app/backend`) | S:70 R:85 A:75 D:70 |
| 7 | Confident | Favicon responses carry `Cache-Control: no-cache`; tinted PNG/manifest responses add no special cache headers | Favicon URL carries no cache-buster, so revalidation is what propagates an accent change to tabs; the manifest/icon URLs change with the descriptor, so extra headers buy nothing | S:60 R:90 A:80 D:70 |
| 8 | Confident | E2E proxy proof uses the Content-Type discriminator (`application/manifest+json` from Go vs `application/json` from Vite static) and keeps all assertions tint-agnostic | The e2e box's real `~/.rk/settings.yaml` may hold any accent; content-type is the only cheap signal that distinguishes the proxied dynamic handler from Vite's static fallback | S:65 R:85 A:80 D:75 |
| 9 | Confident | The `just build` gate's failure (`cat: VERSION: No such file or directory`) is pre-existing breakage (VERSION deleted in #193's tag-driven release port, `scripts/build.sh:19` not updated) and is NOT fixed in this change; the production build is verified instead by frontend build + embed copy + `go build ./cmd/rk` + an embedded-mode smoke test of all five new routes | Out of scope (release tooling, unrelated to PWA assets); fixing build.sh here would smuggle an unreviewed release-flow decision into an asset change. Likewise the 2 kill-window e2e failures reproduce with this change stashed — pre-existing, left untouched | S:75 R:85 A:80 D:80 |

9 assumptions (0 certain, 9 confident, 0 tentative).

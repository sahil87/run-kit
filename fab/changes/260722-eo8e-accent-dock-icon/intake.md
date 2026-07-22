# Intake: Accent-Tinted PWA Dock Icon

**Change**: 260722-eo8e-accent-dock-icon
**Created**: 2026-07-22

## Origin

Promptless dispatch (synthesized from a design conversation; captured, not fabricated). Follow-up to merged change `260721-1etw-instance-accent-host-color` (PR #435), which shipped the per-instance accent (`instance_color` in `~/.rk/settings.yaml`, `GET/POST /api/settings/instance-color`, top-bar stripe/wash, HOST-panel hostname tint + SwatchPopover picker, PWA titlebar via theme-color meta) and explicitly scoped dynamic manifest/icons out.

> Apply the instance accent color to the PWA app icon (Dock / Cmd-Tab) so run-kit instances are visually distinguishable.

Interaction mode: one-shot promptless dispatch. All design decisions below were made in the preceding design conversation; the icon treatment was chosen from a 4-option visual mockup.

## Why

1. **Problem**: Each run-kit instance is its own origin, so each is its own PWA install — but all installs share identical static icons and a static manifest. With multiple instances installed, Dock and Cmd-Tab entries are indistinguishable; the user cannot tell which instance a Dock icon belongs to.
2. **Consequence if unfixed**: The per-instance accent shipped in `1etw` distinguishes instances only *inside* the window (top-bar stripe/wash, titlebar theme-color). The primary OS-level switching surfaces (Dock, Cmd-Tab) remain ambiguous, undermining the whole "visually distinguishable instances" goal for multi-instance users.
3. **Why this approach**: Serve `/manifest.json` and the `generated-icons/*` assets dynamically from Go, tinting the (grayscale) logo per-request from `settings.GetInstanceColor()`. This derives everything at request time (Constitution §II — no persisted generated assets), adds zero dependencies (Go stdlib image codecs; sharp stays build-time-only), and requires no frontend component changes. The colorize treatment ("A — colorized logo") won a 4-option mockup comparison against a tinted background plate, an accent ring, and a badge dot — colorize stays legible at small Dock sizes.

## What Changes

### Current pipeline (verified in repo)

- `app/frontend/public/icon.svg` is the canonical logo — a **grayscale** flat-top hexagon-cube (fills `#b4b4b4` / `#2a2a2a` / `#888888` / `#737373` / `#545454`), no color anywhere.
- `scripts/generate-icons.sh` (build-time, sharp via node) renders it onto a `#0f1117` background into `public/generated-icons/`: `icon-192.png`, `icon-512.png` (20% padding), `icon-512-maskable.png` (40% padding), plus a `favicon.svg` copy. Outputs are committed.
- `public/manifest.json` is static: fixed name "RunKit", `theme_color #0f1117`, icon list pointing at `/generated-icons/*.png`.
- Prod serving: the Go backend embeds the frontend dist (`app/backend/build/embed.go`, `//go:embed all:frontend`) and serves it via the SPA catch-all `r.Get("/*")` registered LAST in `router.go` (`mountSPA` in `app/backend/api/spa.go`; embedded FS in prod, filesystem mode in dev via `useEmbeddedSPA`). Any explicit route registered before the catch-all wins.
- Dev serving: Vite serves `public/` directly; its proxy forwards only `/api`, `/ws`, `/proxy` to the Go backend (`app/frontend/vite.config.ts:28-45`).
- `index.html` references the affected assets statically: `<link rel="manifest" href="/manifest.json">`, `<link rel="icon" type="image/svg+xml" href="/generated-icons/favicon.svg">`, `<link rel="apple-touch-icon" href="/generated-icons/icon-192.png">`.

### 1. Dynamic `GET /manifest.json` route in Go

New explicit route registered in `router.go` **before** the SPA catch-all. Reads `settings.GetInstanceColor()` per request (no cache of the settings read — Constitution §II, state derived at request time):

- **Unset** → serve the stock manifest bytes **byte-identical** to today's static file.
- **Set** → the same JSON with each icon `src` carrying a cache-busting query `?c=<descriptor>` (e.g. `/generated-icons/icon-512.png?c=2`). The changed `src` URLs are also what makes Chrome detect a manifest change and refresh the installed icon.

### 2. Tinted icon serving in Go

Explicit routes (registered before the SPA catch-all) for the three `generated-icons/*.png` paths:

- **Without `?c=`** (or with an invalid/malformed descriptor — treat as absent or 400, decide in plan): serve the stock bytes.
- **With a valid `?c=<descriptor>`**: decode the stock PNG, apply a per-pixel **luminance→hue colorize** (treatment "A — colorized logo"), encode, and cache the result **in memory** keyed by (icon name, descriptor). The memory cache is a pure function of embedded bytes + the descriptor — not persistent state — so it is constitution-compatible (§II).
- **Go stdlib only** (`image`, `image/png`, `image/color`) — the logo being grayscale makes colorize a pure luminance-to-hue-ramp mapping. **No new dependencies; sharp stays build-time-only.**
- The `#0f1117` background pixels stay dark: the tint applies to the logo's gray range, background essentially unchanged. Exact ramp shape is implementation latitude.
- **Source of stock PNG bytes**: prod reads them from the embedded frontend FS; dev (filesystem SPA mode) from the on-disk frontend path — the same seam `mountSPA` already branches on (`useEmbeddedSPA`).

### 3. Descriptor→hex map in Go

The frontend's `themes.ts` derives family hexes per ACTIVE THEME, but a Dock icon is theme-independent — so Go carries a small fixed map of the color-value descriptors to hexes taken from the **default-dark palette** (the ~10 owned families; blend descriptors like `"1+3"` blend the two family hexes, mirroring the swatch blend semantics). Reuse `validate.ValidateColorValue` / `validate.NormalizeColorValue` (`app/backend/internal/validate/validate.go`) for input validation of `?c=` — these are the same functions that already validate `instance_color` writes (single index `0–15` or a two-index blend `a+b`).

### 4. Dev parity (Vite proxy)

Add `/manifest.json` and `/generated-icons` to the Vite dev proxy (`app/frontend/vite.config.ts`) so dev serves the dynamic versions too — one proxy entry each, targeting the backend port like the existing `/api` entry. Static fallback in dev is acceptable if the plan finds proxying `/generated-icons` conflicts with Vite's public-dir serving — decide in plan, note the tradeoff.

### 5. Tinted favicon

Also tint `favicon.svg`, served dynamically the same way (explicit Go route before the catch-all). The SVG is text: replace the grayscale fills with the same colorize-ramp hexes via string substitution — so browser TABS match the Dock. Cheap, in scope. (`index.html`'s `rel=icon` href is static, so the favicon route resolves the tint from current settings per request rather than requiring a `?c=` query; caching details are plan latitude.)

### 6. Accepted limitation (document, don't work around)

Chrome snapshots PWA icons at install and re-checks the manifest only on app launch with ~daily throttling. A color picked BEFORE installing is immediate; changing it after install updates the Dock icon eventually (reinstall forces it). The titlebar/top-bar accent stays live regardless.

### 7. Out of scope

- Per-host manifest `name`/`short_name` (raised as an option in the discussion, not confirmed by the user).
- Badging API.
- Any change to the picker UI or the accent settings/API (all shipped in `1etw`).

### Constitution notes

- No database — reads `settings.yaml` per request (§II).
- New routes are GET read operations — mutations stay POST-only (§IX untouched).
- No new pages (§IV — these are asset routes, not UI routes).
- State derived at request time (§II); the in-memory tinted-PNG cache is a memoized pure function, not state.

## Affected Memory

- `run-kit/architecture`: (modify) dynamic `/manifest.json` + `/generated-icons/*` asset routes in the REST/SPA serving layer (registered before the SPA catch-all), the tint pipeline (stdlib colorize, embedded-vs-filesystem stock-byte source), and the PWA pipeline note (icons no longer purely static in prod)
- `run-kit/ui-patterns`: (modify) instance accent surface extended to the PWA install identity — Dock/Cmd-Tab icon + tab favicon tinting, cache-bust descriptor contract, Chrome icon-refresh limitation

## Impact

- **Backend (Go), the bulk of the change**: new manifest/icon handlers in `app/backend/api/` (+ tests), route registration in `app/backend/api/router.go` before `s.mountSPA(r)` (currently line ~590), possibly a small `internal/` helper package for the colorize + descriptor→hex map with unit tests (golden-pixel assertions: decode output, sample known logo pixels, assert hue applied and background unchanged).
- **Frontend**: `app/frontend/vite.config.ts` proxy lines only; **no frontend component changes**.
- **Risk**: low — additive asset routes; unset accent serves byte-identical stock assets, so zero-config behavior is unchanged.

## Open Questions

- None — the design conversation resolved all blocking decisions; remaining latitude is recorded as graded assumptions below (invalid-`?c=` handling, dev-proxy conflict fallback, ramp shape, `+`-encoding in the cache-bust query are explicitly delegated to plan).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Icon treatment is "A — colorized logo" (per-pixel luminance→hue colorize of the grayscale logo; background `#0f1117` stays dark) | Discussed — chosen from a 4-option mockup over tinted plate, accent ring, and badge dot for small-size Dock legibility | S:90 R:70 A:85 D:95 |
| 2 | Certain | Dynamic `GET /manifest.json` in Go registered before the SPA catch-all; unset accent → byte-identical stock manifest; set → icon `src` URLs carry `?c=<descriptor>` cache-buster | Discussed with exact values; route-before-catch-all mechanism verified in `router.go`/`spa.go` | S:95 R:80 A:90 D:90 |
| 3 | Certain | Go stdlib only (`image`, `image/png`, `image/color`) for the tint; no new dependencies, sharp stays build-time-only | Discussed — grayscale source makes colorize a pure luminance ramp; matches project no-new-deps posture | S:90 R:75 A:95 D:90 |
| 4 | Certain | Chrome install-time icon snapshot / ~daily manifest re-check is documented as an accepted limitation, not worked around | Discussed explicitly — pre-install color immediate, post-install eventual, reinstall forces | S:90 R:90 A:85 D:90 |
| 5 | Certain | `favicon.svg` is tinted too (string substitution of the five grayscale fills with colorize-ramp hexes), served dynamically so tabs match the Dock | Discussed — "cheap, in scope"; SVG fills verified in `icon.svg` | S:85 R:80 A:85 D:80 |
| 6 | Confident | In-memory tinted-PNG cache keyed (icon name, descriptor) is constitution-compatible | Discussed — memoized pure function of embedded bytes + descriptor, not persistent state; justifies code-quality's no-cache-unless-justified rule via per-request PNG decode/encode cost | S:80 R:70 A:75 D:70 |
| 7 | Confident | Go carries a fixed descriptor→hex map from the default-dark palette (~10 owned families); blends (`"1+3"`) blend the two family hexes mirroring swatch semantics; `validate.ValidateColorValue`/`NormalizeColorValue` validate `?c=` | Discussed — Dock icon is theme-independent so per-theme derivation in `themes.ts` deliberately not mirrored; validate functions verified present | S:85 R:70 A:85 D:80 |
| 8 | Confident | Invalid/malformed `?c=` handling (treat as absent vs 400) is plan latitude | Discussed — explicitly delegated to plan; trivially reversible, robust front-runner is treat-as-absent | S:60 R:85 A:70 D:50 |
| 9 | Confident | Dev parity via Vite proxy entries for `/manifest.json` and `/generated-icons`; if `/generated-icons` proxying conflicts with Vite public-dir serving, static dev fallback is acceptable (decide in plan, note tradeoff) | Discussed — explicitly delegated to plan with named fallback | S:60 R:85 A:55 D:45 |
| 10 | Confident | Blend descriptors contain `+` (`?c=1+3`), which query parsing decodes as space — Go controls both sides (writes the manifest `src` URLs and parses them), so the plan picks the encoding (e.g. `%2B`-encode, or normalize on read) | Noticed during intake verification; small, fully reversible, both sides owned by the same handler pair | S:60 R:85 A:80 D:70 |
| 11 | Confident | Per-host manifest `name`/`short_name` excluded from scope | Discussed — raised as an option, not confirmed by the user; explicitly listed out of scope in the dispatch | S:75 R:80 A:70 D:75 |
| 12 | Confident | Exact luminance→hue ramp shape is implementation latitude; all three PNG variants (192, 512, 512-maskable) get the same treatment | Discussed — "exact ramp shape is implementation latitude"; golden-pixel tests pin the contract (hue applied to logo grays, background unchanged) | S:75 R:80 A:80 D:65 |

12 assumptions (5 certain, 7 confident, 0 tentative, 0 unresolved).

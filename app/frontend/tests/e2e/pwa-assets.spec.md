# pwa-assets.spec.ts

Verifies the PWA identity assets (`/manifest.json`, `/generated-icons/*`) are
served by the Go backend's dynamic handlers through the Vite dev proxy
(260722-eo8e accent-tinted Dock icon). All assertions are deliberately
tint-agnostic — the e2e box's real `~/.rk/settings.yaml` may or may not carry
an `instance_color` — so the spec pins the serving pipeline, not the tint
state (the tint itself is golden-pixel tested in Go: `api/pwa_test.go`,
`internal/icontint`).

## Shared setup

- None beyond the standard externally-managed e2e dev server (Vite on
  `RK_PORT` 3020 proxying to the Go backend on 3021). The tests use
  Playwright's `request` fixture against `baseURL` — no page or tmux state.

## Tests

### `manifest is served by the Go handler through the dev proxy`

**What it proves:** `/manifest.json` reaches the Go dynamic handler (not
Vite's public-dir static copy) and still parses as the RunKit manifest. The
discriminator is the `application/manifest+json` content-type — only the Go
handler sets it; Vite would serve the static file as `application/json`.

**Steps:**
1. `request.get("/manifest.json")`.
2. Assert status 200 and content-type contains `application/manifest+json`.
3. Parse the JSON; assert `name` is `RunKit` and there are exactly 3 icons.
4. Assert each icon `src` matches `/generated-icons/icon-*.png` with an
   optional `?c=<descriptor>` cache-buster (present only when the box has an
   accent configured — tint-agnostic).

### `dock icon PNG is served intact`

**What it proves:** The proxied `/generated-icons/icon-192.png` route returns
a real PNG (magic-byte check) with the right content-type, tinted or not.

**Steps:**
1. `request.get("/generated-icons/icon-192.png")`.
2. Assert status 200 and content-type contains `image/png`.
3. Assert the first 8 body bytes are the PNG signature
   `89 50 4E 47 0D 0A 1A 0A`.

### `favicon SVG is served with revalidation caching`

**What it proves:** The proxied `/generated-icons/favicon.svg` route is
answered by the Go favicon handler — it returns SVG content and the
`Cache-Control: no-cache` header that handler sets (the favicon tint resolves
from settings per request, so tabs must revalidate to pick up accent changes).

**Steps:**
1. `request.get("/generated-icons/favicon.svg")`.
2. Assert status 200 and content-type contains `image/svg+xml`.
3. Assert `cache-control` contains `no-cache`.
4. Assert the body contains `<svg`.

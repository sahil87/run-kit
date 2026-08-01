# Intake: SPA Asset Cache Headers

**Change**: 260801-ujuk-spa-asset-cache-headers
**Created**: 2026-08-01

## Origin

Conversational — a `/fab-discuss` session exploring instant host switching in the Electron desktop shell. Investigating "why so many network calls for the bundle" surfaced that the production SPA server sends **zero cache headers**, so every navigation re-downloads the full bundle. The user then asked to draft this as its own change:

> Create 2 intakes - for 1 and 2. Using fab-draft.

(Item 1 of the discussion's recommendation: "Cache headers in `spa.go` — small backend change, eliminates the bundle re-downloads for every client".)

Verified live against a running `rk serve` (embedded mode) during the discussion:

```
GET /assets/index-fjkrY6nh.js
HTTP/1.1 200 OK
Accept-Ranges: bytes
Content-Length: 714301
Content-Type: text/javascript; charset=utf-8
(no Cache-Control, no Last-Modified, no ETag)
```

## Why

1. **Pain point**: `mountEmbeddedSPA` (`app/backend/api/spa.go`) serves the built SPA via a bare `http.FileServer` over the `embed.FS`. Embedded files carry a **zero modtime**, so `net/http` emits no `Last-Modified`; `net/http` never generates `ETag`s; and nothing sets `Cache-Control`. A response with no validator and no freshness lifetime gives Chromium nothing to cache against — every page load (browser tab, PWA, desktop-shell host switch) re-downloads ~700KB of JS plus CSS/fonts as full 200s.
2. **Consequence if unfixed**: every desktop-shell host switch, every browser reload, and every PWA launch pays the full bundle transfer — noticeable latency on remote (Tailscale/WAN) hosts, and it makes the planned instant-host-switching work look network-bound when it isn't.
3. **Why this approach**: Vite already content-hashes everything under `/assets/` (e.g. `index-fjkrY6nh.js`), which is the textbook case for `Cache-Control: public, max-age=31536000, immutable` — the URL changes whenever content changes, so infinite caching is safe by construction. The HTML entry point gets `no-cache` + an `ETag` so clients revalidate cheaply (a ~3KB conditional fetch, 304 on match) and pick up new deploys immediately. The alternative — bundling the SPA into the desktop app — was explicitly considered and rejected in the discussion (breaks version-match-by-construction between a host's UI and its API; the shell never auto-updates; the SPA is 100% origin-relative). Ironically, dev/filesystem mode already caches *better* than production because `http.ServeFile` gets a real mtime and serves 304s.

## What Changes

### `app/backend/api/spa.go` — cache headers on both SPA mounts

Add a header layer to SPA serving with two policies:

1. **Hashed assets** — any request path under `/assets/` gets:

   ```
   Cache-Control: public, max-age=31536000, immutable
   ```

   Safe because Vite fingerprints these filenames; a rebuild changes the URL.

2. **`index.html` and every other non-`/assets/` path** (the SPA fallback, root-level files like favicons served by this handler) gets:

   ```
   Cache-Control: no-cache
   ETag: "<content-derived>"
   ```

   with `If-None-Match` handled → `304 Not Modified`. `no-cache` means "revalidate every time", which keeps deploys instant while making revalidation nearly free.

**ETag mechanics (embedded mode)**: `embed.FS` has no mtime, so the validator must be content-derived — compute a hash (e.g. FNV-1a or sha256, truncated) of the served file's bytes, computed once at startup (or lazily per path, memoized) since the embedded FS is immutable for the process lifetime. `http.ServeContent`/`http.FileServer` handle `If-None-Match` automatically once the `ETag` header is set before serving.

**Filesystem (dev) mode**: apply the same `/assets/` immutable rule and `no-cache` on HTML for parity. `http.ServeFile` already provides mtime-based `Last-Modified`/304s there, so the ETag computation may be embedded-mode-only if simpler — behavior parity (assets cached, HTML revalidated) is the requirement, not implementation symmetry.

**Scope guard**: the PWA-tinted asset routes (`app/backend/api/pwa.go`) already set `Cache-Control: no-cache` explicitly (pwa.go:162) and manage their own `?c=` cache-buster — those handlers are registered before the SPA catch-all and are **not touched** by this change.

### Tests

Extend `app/backend/api` tests (Go, alongside existing spa tests): assert `/assets/*` responses carry the immutable `Cache-Control`; assert index/fallback responses carry `no-cache` + a non-empty `ETag`; assert a request with matching `If-None-Match` returns 304 with an empty body; assert both embedded and filesystem modes (the existing `useEmbeddedSPA` test override covers mode switching).

## Affected Memory

- `run-kit/architecture`: (modify) SPA serving section — document the two-tier cache policy (immutable hashed assets, no-cache + content-ETag HTML) and the embed.FS zero-modtime rationale

## Impact

- `app/backend/api/spa.go` — the only production code file expected to change (plus its test file)
- All SPA clients benefit: browser tabs, installed PWA, Electron desktop shell (host switches drop from ~700KB+ transfers to one conditional ~3KB index fetch)
- No frontend changes, no API changes, no desktop-shell changes
- Complements (but is independent of) `260801-3cag-desktop-persistent-host-renderers`

## Open Questions

- None — all decisions resolved during the discussion or graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Immutable caching keyed on the `/assets/` path prefix only | Vite content-hashes exactly these filenames; discussed and verified against live build output | S:90 R:90 A:95 D:95 |
| 2 | Certain | `index.html` + SPA fallback + other non-`/assets/` paths get `no-cache` + `ETag`, with `If-None-Match` → 304 | Discussed — keeps deploys instant while making revalidation ~free; standard SPA pattern | S:80 R:85 A:85 D:80 |
| 3 | Confident | ETag is content-derived (hash of served bytes, memoized), not rk-version-derived | embed.FS has zero modtime so content is the only honest validator; version would alias distinct dev builds | S:60 R:85 A:80 D:70 |
| 4 | Confident | Both embedded and filesystem mounts get the header policy (parity), but the filesystem mount may rely on its existing mtime validators instead of ETags | Dev mode already 304s via mtime; requirement is behavior parity, not implementation symmetry | S:55 R:90 A:75 D:70 |
| 5 | Certain | `pwa.go` tinted-asset routes are out of scope | They already set `no-cache` (pwa.go:162) and own a `?c=` cache-buster; registered before the SPA catch-all | S:85 R:95 A:95 D:90 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).

# Plan: SPA Asset Cache Headers

**Change**: 260801-ujuk-spa-asset-cache-headers
**Intake**: `intake.md`

## Requirements

### Backend: SPA Cache Policy

#### R1: Immutable caching for hashed assets
Any request whose path is under `/assets/` SHALL be served with `Cache-Control: public, max-age=31536000, immutable`, in both embedded (production) and filesystem (dev) SPA modes. Vite content-hashes every filename under `/assets/`, so the URL changes whenever content changes and infinite caching is safe by construction.

- **GIVEN** a built SPA served by `rk serve` (either mount mode)
- **WHEN** a client requests `GET /assets/index-fjkrY6nh.js`
- **THEN** the 200 response carries `Cache-Control: public, max-age=31536000, immutable`

#### R2: Revalidate-always policy for index.html and other non-asset paths
`index.html` (including every SPA-fallback route) and any other non-`/assets/` path served by the SPA handler (e.g. root-level favicons) SHALL be served with `Cache-Control: no-cache`, in both mount modes, so clients revalidate on every load and pick up new deploys immediately.

- **GIVEN** a built SPA served by `rk serve` (either mount mode)
- **WHEN** a client requests `GET /` or a client-side route such as `GET /p/run-kit/0`
- **THEN** the response carries `Cache-Control: no-cache`

#### R3: Content-derived ETag with 304 revalidation (embedded mode)
In embedded mode, non-`/assets/` responses SHALL carry a content-derived `ETag` (hash of the served file's bytes, memoized per path — the `embed.FS` is immutable for the process lifetime, so `net/http` sees a zero modtime and emits no `Last-Modified`; content is the only honest validator). A request with a matching `If-None-Match` SHALL receive `304 Not Modified` with an empty body.

- **GIVEN** embedded-mode SPA serving
- **WHEN** a client requests `GET /`
- **THEN** the 200 response carries `Cache-Control: no-cache` and a non-empty `ETag`
- **AND WHEN** the client re-requests with `If-None-Match` set to that ETag
- **THEN** the response is `304 Not Modified` with an empty body

#### R4: Filesystem-mode revalidation parity via existing mtime validators
Filesystem (dev) mode SHALL apply the same two-tier `Cache-Control` policy (R1/R2) but MAY rely on `http.ServeFile`'s existing mtime-based `Last-Modified`/`If-Modified-Since` 304 handling instead of computing ETags. The requirement is behavior parity (assets cached, HTML revalidated cheaply), not implementation symmetry.

- **GIVEN** filesystem-mode SPA serving
- **WHEN** a client requests `GET /`
- **THEN** the response carries `Cache-Control: no-cache` and a `Last-Modified` validator (from file mtime)

#### R5: PWA tinted-asset routes unaffected
The PWA-tinted asset routes (`app/backend/api/pwa.go`) SHALL NOT be modified. They already set `Cache-Control: no-cache` explicitly and manage their own `?c=` cache-buster, and they are registered before the SPA catch-all so they never reach the SPA handler.

- **GIVEN** this change is applied
- **WHEN** the diff and PWA tests are inspected
- **THEN** `pwa.go` is unchanged and all existing PWA tests pass unchanged

### Non-Goals

- Bundling the SPA into the desktop app — explicitly rejected in the discussion (breaks version-match-by-construction between a host's UI and its API)
- Frontend, API, or desktop-shell changes — this is a `spa.go`-only change (plus tests)
- Cache headers on `/api/*` or `/ws/*` responses

### Design Decisions

#### Content-derived memoized ETag over version-derived
**Decision**: The embedded-mode ETag is a truncated SHA-256 of the served file's bytes, computed lazily per path and memoized for the process lifetime.
**Why**: `embed.FS` has a zero modtime, so content is the only honest validator; memoization is safe because the embedded FS is immutable for the process lifetime. Setting the `ETag` header before delegating to `http.FileServer` lets `net/http`'s `serveContent` handle `If-None-Match` → 304 automatically.
**Rejected**: An rk-version-derived ETag — would alias distinct dev builds carrying the same version string.
*Introduced by*: 260801-ujuk-spa-asset-cache-headers

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add named cache-policy constants and a `setSPACacheControl(w, urlPath)` helper in `app/backend/api/spa.go`: `/assets/`-prefixed paths → `public, max-age=31536000, immutable`; everything else → `no-cache` <!-- R1 -->
- [x] T002 Wire the embedded mount (`mountEmbeddedSPA`): apply `setSPACacheControl` on every response; for non-`/assets/` paths compute a memoized content-derived `ETag` for the file about to be served (direct file or the `index.html` fallback) and set it before delegating to `http.FileServer`, so `If-None-Match` → 304 is handled by `net/http`. Introduce a small test seam (`embeddedSPASub` package var returning the embedded sub-FS) so embedded mode is unit-testable with `fstest.MapFS` <!-- R3 -->
- [x] T003 Wire the filesystem mount (`mountFilesystemSPA`): apply `setSPACacheControl` on direct-file, fallback, and index responses; keep `http.ServeFile`'s mtime `Last-Modified`/304 behavior as the validator <!-- R4 -->

### Phase 2: Tests

- [x] T004 [P] Filesystem-mode tests in `app/backend/api/spa_test.go`: `/assets/main.js` carries the immutable `Cache-Control`; `/` and an SPA-fallback route carry `no-cache`; `Last-Modified` is present and `If-Modified-Since` yields 304 <!-- R1 -->
- [x] T005 [P] Embedded-mode tests in `app/backend/api/spa_test.go` using a `fstest.MapFS` via the `embeddedSPASub` seam: `/assets/*` carries the immutable `Cache-Control`; `/` and a fallback route carry `no-cache` + a non-empty `ETag`; a request with matching `If-None-Match` returns 304 with an empty body; the ETag is stable across requests <!-- R3 -->
- [x] T006 Run `cd app/backend && go test ./api/...` — all SPA and PWA tests green, `pwa.go` untouched by the diff <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `/assets/*` responses carry `Cache-Control: public, max-age=31536000, immutable` in both embedded and filesystem modes, with tests asserting it
- [x] A-002 R2: `index.html`, SPA-fallback routes, and other non-`/assets/` paths carry `Cache-Control: no-cache` in both modes, with tests asserting it
- [x] A-003 R3: Embedded-mode non-asset responses carry a non-empty content-derived `ETag`, and a matching `If-None-Match` returns `304 Not Modified` with an empty body

### Behavioral Correctness

- [x] A-004 R3: The embedded-mode ETag is memoized and stable — repeated requests for the same path return the identical ETag value
- [x] A-005 R4: Filesystem mode still serves mtime-based `Last-Modified` and answers `If-Modified-Since` with 304 (dev revalidation parity preserved)

### Scenario Coverage

- [x] A-006 R5: `app/backend/api/pwa.go` is unchanged by the diff and all existing PWA tests pass unchanged

### Edge Cases & Error Handling

- [x] A-007 R2: The SPA fallback for a deep client-side route (e.g. `/p/run-kit/0`) serves `index.html` with the `no-cache` policy (never the immutable policy), and path-traversal / not-built behavior is unchanged (existing tests still pass)

### Code Quality

- [x] A-008 Pattern consistency: New code follows the existing `spa.go` style (package-level test-override vars, defensive route guards, comment conventions)
- [x] A-009 No unnecessary duplication: One shared cache-policy helper serves both mounts; no per-mount copies of header strings
- [x] A-010 No magic strings: Cache-Control values are named constants, not inline literals repeated across call sites
- [x] A-011 Tests cover added behavior: every new header behavior (immutable CC, no-cache CC, ETag, 304) has a direct test

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/api/pwa.go:42` — the inline `fs.Sub(build.Frontend, "frontend")` inside `readSPAAsset` is now a redundant second copy of the embedded-sub-FS lookup that `embeddedSPASub` (spa.go:28) owns; deleting it in favour of a call to the seam removes the duplication and makes `readSPAAsset`'s own comment ("the same seam mountSPA branches on") true again.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Add an `embeddedSPASub` package-var seam (function returning the embedded sub-FS) so embedded-mode behavior is unit-testable with `fstest.MapFS` | The test-build embed.FS contains only `.gitkeep`, so embedded mode is otherwise untestable; mirrors the existing `useEmbeddedSPA`/`spaDir` test-override pattern in the same file | S:60 R:85 A:85 D:75 |
| 2 | Confident | ETag = quoted truncated SHA-256 (first 8 bytes, hex) of the served bytes, memoized in a per-mount map | Intake specifies content-derived + memoized but leaves hash choice open; sha256 is stdlib, collision-safe at this truncation for a handful of files, and the per-mount map gives tests a fresh cache per router | S:55 R:90 A:85 D:70 |
| 3 | Certain | Filesystem mode computes no ETag — it keeps `http.ServeFile`'s mtime `Last-Modified`/304 as its validator | Intake assumption 4 explicitly permits this; dev mode already revalidates correctly via mtime | S:80 R:90 A:90 D:85 |
| 4 | Certain | Cache policy keys on the original request path's `/assets/` prefix; every SPA-fallback response gets `no-cache` regardless of the fallback URL | Direct restatement of intake assumptions 1–2; the fallback always serves index.html, which must always revalidate | S:85 R:90 A:90 D:85 |
| 5 | Certain | The memoized ETag map is an acceptable in-memory cache despite the "no in-memory caches" convention | The embedded FS is immutable for the process lifetime (nothing to derive freshness from), and the intake explicitly calls for memoization; this mirrors pwa.go's existing `tintCached` memoization | S:75 R:85 A:90 D:85 |

5 assumptions (3 certain, 2 confident, 0 tentative).

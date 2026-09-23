# Plan: Own-origin present (`--app`)

**Change**: 260923-hx13-own-origin-present
**Intake**: `intake.md`

## Requirements

### R1: `--app` is an opt-in that leaves the default byte-identical
`rk present` SHALL accept a boolean `--app` flag, valid ONLY for a port / localhost-URL primary (a file/dir/external primary with `--app` is a usage error, exit 2, nothing created). With NO `--app`, the stored tile URL, served bytes, headers, and tile behavior SHALL be byte-identical to today's `/proxy/{port}/`.

- **GIVEN** `rk present :5173` (no `--app`)
- **THEN** the tile URL is `/proxy/5173/` and behavior is unchanged
- **AND** `rk present ./x.html --app` exits non-zero naming the port-primary constraint

### R2: Subdomain host routing serves the app at root
A request whose Host is `{port}.{base}[:N]` (base ∈ {`localhost`, configured `base_domain`}) SHALL be reverse-proxied to `127.0.0.1:{port}` at ROOT (path forwarded as-is), with `Host` rewritten to `127.0.0.1:{port}` (so a Host-allowlisting dev server accepts it), `X-Frame-Options` + CSP `frame-ancestors` stripped, and the host-generic sibling shim injected into HTML (gzip-aware, Content-Length re-synced). The bare dashboard host SHALL be untouched. The `base_domain` disk read SHALL occur only for a genuine non-localhost subdomain shape (shape-first parse).

- **GIVEN** a request with Host `4295.localhost:3000`
- **THEN** it is proxied to `127.0.0.1:4295/` at root and the app's root-absolute assets + deep routes resolve
- **AND** Host `localhost:3000` falls through to the dashboard

### R3: Tailscale host-URL port-authority routing (UI-safe)
A request whose Host is `{base_domain}:{port}` (the port in the authority, not a subdomain label — the tailnet shape) SHALL be reverse-proxied to `127.0.0.1:{port}` through the same core, gated on `base_domain` being configured AND equal to the host, with ports 80 and 443 excluded. A bare host (no explicit port) and a non-matching host SHALL fall through — the run-kit dashboard UI served over the same host URL SHALL never be routed to a loopback app.

- **GIVEN** `base_domain = dev-ws-x.ts.net` and Host `dev-ws-x.ts.net:4295`
- **THEN** it is proxied to `127.0.0.1:4295/` at root
- **AND** Host `dev-ws-x.ts.net` (bare) and `dev-ws-x.ts.net:443` fall through to the dashboard UI
- **AND** Host `other.ts.net:4295` (base mismatch) falls through

### R4: Render-time per-viewer minting + first-class embed
When `--app` is set, the CLI SHALL store the universal `/proxy/{port}/` fallback and set `@rk_win_web_<n>_app=1`; the FRONTEND SHALL mint the own-origin src per-viewer at render time via a pure `mintAppSrc(port, path, host)` (host = `location.host`): `localhost`/`*.localhost` → `{scheme}//{port}.{host}{path}` (subdomain), IP-literal/other → `/proxy/{port}{path}`. A minted own-origin URL SHALL classify as a new `app` address kind that the tile embeds directly (skipping the frame-check refusal), leaving `/proxy` + external kinds unchanged. The app bool SHALL thread tmux → `WindowInfo.WebApp` (json `webApp`) → sessions payload → the tile.

- **GIVEN** an app-flagged tile and viewer host `localhost:3000`
- **THEN** the iframe src is `http://5173.localhost:3000/…` and the tile embeds it without a "refused" state

### R5: Backend mint resolver
A pure, tested `MintAppURL(appPort, dashboardHost, baseDomain) (url, mode)` SHALL resolve the mode (subdomain / wildcard / tailscale / proxy) for a given host shape. Every branch unit-tested.

### R6: `base_domain` config key (no env)
A `base_domain` settings-registry key (default empty → only `.localhost`) SHALL exist with `GetBaseDomain()` and a `validateBaseDomain` (empty, or a dotted hostname). It SHALL be a config-registry key only — NO new environment variable (Constitution §IV).

### R7: Documented fallback limits
`docs/specs/api.md` SHALL document the `--app` contract, the two host-routing shapes, the byte-identical no-`--app` invariant, and the documented limits (Safari / bare-IP / hosted-without-wildcard fall back to `/proxy`, which is degraded for full SPAs).

## Tasks

### Phase 1: Backend routing
- [x] T001 Create `app/backend/api/host_routing.go`: `subdomainRoutingMiddleware`, `splitSubdomainCandidate` (shape-first, excludes IP/bare/non-numeric), `splitPortAuthority` (tailnet shape, excludes localhost/IP/no-port), `subdomainProxy` (per-port cached ReverseProxy: SetURL 127.0.0.1:{port}, Host-rewrite, frame-header strip, HTML shim inject with gzip re-sync), `stripFrameAncestors`; embed `proxy_hostswap.js`. Port from the verified reference at `/home/ashish_kumar_noon_design/development/shll/run-kit.worktrees/racing-treefrog/app/backend/api/host_routing.go` + `proxy_hostswap.js`; adapt to current main (parseCSP/serializeCSP, injectHeadScript helpers). <!-- R2 R3 -->
- [x] T002 Mount `subdomainRoutingMiddleware` in `app/backend/api/router.go` (as an `r.Use` early middleware, before the SPA/proxy routes). <!-- R2 R3 -->
- [x] T003 Add `base_domain` to `app/backend/internal/settings/settings.go`: registry key (default ""), `BaseDomain` field, `GetBaseDomain()`, `validateBaseDomain`. Port from the reference; adapt to current settings registry. <!-- R6 -->
- [~] T004 `MintAppURL` resolver — IMPLEMENTED then REMOVED in review rework (SF2): it was dead code (own-origin minting is frontend-only via `mintAppSrc`), and a duplicate backend resolver risks divergence. Dropped `mint.go`/`mint_test.go`. R5 is descoped from this PR; a backend mode resolver can return with the tailscale pane-orchestration follow-up. <!-- R5 -->

### Phase 2: CLI + tmux
- [x] T005 Add `--app` to `app/backend/cmd/rk/present.go`: parse/validate (port/localhost-URL primary only; else usage error); no `--app` → unchanged; with `--app` store `/proxy/{port}/` + call `SetWebTabApp`. Port ONLY the `--app` logic (NOT `--with`) from the reference. <!-- R1 -->
- [x] T006 (design change: app-ness rides the `app:{port}` web-tab value string — no new tmux family array, correct under shift/move/remove/snapshot for free) Thread the per-tab app bool through `app/backend/internal/tmux/*`: `@rk_win_web_<n>_app` option (parallel to `_root`, moves under shift/move), `WebTabFamily.App`, `WindowInfo.WebApp` (json `webApp`), `SetWebTabApp`/`GetWebTabApp` seam. Port from the reference; adapt to current tmux/webtabs code. <!-- R1 R4 -->

### Phase 3: Frontend
- [x] T007 `app/frontend/src/lib/web-url.ts`: add `mintAppSrc(port, path, host)` + the `app` address kind in `classifyAddress`. Port from the reference. <!-- R4 -->
- [x] T008 `app/frontend/src/components/iframe-window.tsx`: mint app-flagged tiles via `mintAppSrc` at render, skip the frame-check refusal for the `app` kind; thread `appUrls`/`webApp` from the surface layout. Port from the reference; adapt to current iframe-window. <!-- R4 -->

### Phase 4: Tests + docs
- [x] T009 Go unit tests `app/backend/api/host_routing_test.go` (subdomain match at root, base_domain subdomain, port-authority match, UI-safety fall-through for bare host / :443 / mismatch, shape parsers, gzip re-sync, no-config-read common path) + `internal/present/mint_test.go` (all branches) + settings base_domain validation. Port from the reference. <!-- R2 R3 R5 R6 -->
- [x] T010 Frontend tests: `web-url.test.ts` (mintAppSrc branches, app classification) + `iframe-window.test.tsx` (app kind embeds, no refusal). Port from the reference. <!-- R4 -->
- [x] T011 Docs: `docs/specs/api.md` — `--app` contract, both host-routing shapes, byte-identical no-`--app` invariant, documented fallback limits; `rk present --help` long text for `--app`. <!-- R1 R7 -->
- [x] T012 Byte-identical guard test: a no-`--app` `/proxy` present's response is unchanged (no host-routing side effects on the bare host). <!-- R7 -->

## Execution Order
- T001–T004 independent (backend); T002 depends on T001.
- T005 depends on T006 (tmux seam); T007/T008 depend on T006's payload field.
- Tests (T009/T010/T012) follow their targets; T011 independent.

## Acceptance

### Functional Completeness
- [x] A-001 R1: `rk present :P --app` stores `/proxy/P/` + sets `@rk_win_web_<n>_app=1`; a file/dir/external primary with `--app` exits non-zero with nothing created.
- [x] A-002 R2: Host `{P}.localhost` is proxied to `127.0.0.1:P` at root; assets + deep routes resolve; bare host falls through.
- [x] A-003 R3: Host `{base_domain}:P` is proxied to `127.0.0.1:P`; bare host, `:443`, and a mismatched host fall through (UI-safe).
- [x] A-004 R4: an app-flagged tile mints `{P}.{location.host}` per viewer and embeds without a "refused" state; `webApp` threads through the payload.
- [~] A-005 R5: DESCOPED — `MintAppURL` removed as dead code (SF2); frontend `mintAppSrc` is the live resolver (covered by web-url.test.ts).
- [x] A-006 R6: `base_domain` is a config-registry key with validation; no new env var.

### Behavioral Correctness
- [x] A-007 R1/R7: with no `--app`, the `/proxy` response and the bare-host dashboard response are byte-identical to pre-change.

### Edge Cases
- [x] A-008 R2: the `base_domain` disk read is skipped for bare hosts / IPs / `/proxy` / API / WS (shape-first).
- [x] A-009 R3: the port-authority rule never routes a bare host or `:443` to a loopback app (verified live 2026-09-23).
- [x] A-010 R2/R3: gzip'd HTML still injects the shim with Content-Length re-synced.

### Code Quality
- [x] A-011 New Go follows `exec.CommandContext`/no-shell, `internal/tmux` option-seam, and handler-file conventions; the shim is a single embedded asset.
- [x] A-012 Reuses existing `parseCSP`/`serializeCSP`/`injectHeadScript` helpers; does not fork a second proxy path or modify the `/proxy` default.

### Security
- [x] A-013 R3: UI-safety — the run-kit dashboard mapping cannot be hijacked by an app request; port-authority gated on `base_domain` match + 80/443 exclusion.
- [x] A-014 R1: `--app` validated before any tmux write or subprocess (§I).

## Review Rework (independent review — VERDICT: PASS, 0 must-fix)

The critical UI-safety property was verified sound (no Host can wrongly route to a loopback app). Four should-fixes were applied:
- SF1: `host_routing.go` ModifyResponse now skips shim injection for non-identity/non-gzip Content-Encoding (br/deflate) — prevents corrupting a precompressed HTML body from a non-Vite app server.
- SF2: removed dead `MintAppURL` (`mint.go`/`mint_test.go`) — minting is frontend-only.
- SF3: corrected `docs/specs/api.md` — frontend auto-minting covers `*.localhost` (subdomain) and `*.ts.net` (port-authority); a wildcard `base_domain` tile is backend-routable but not yet tile-minted (documented follow-up).
- SF4: added a `web-frame-iframe.test.tsx` case asserting an `app:` tile mints `{port}.localhost` and embeds without a refusal state (A-004 at the component level).
Nice-to-haves (subdomain-only hostswap shim in tailscale mode; app→/proxy dead-port probe gap; frontend/backend `*.localhost` multi-label eligibility) noted, deferred as harmless.

## Assumptions

| # | Grade | Decision | Rationale | Scores | Artifact |
|---|-------|----------|-----------|--------|----------|
| 1 | Confident | Port the verified reference files from racing-treefrog and adapt to current main, rather than re-derive | Already built + live-verified; re-derivation risks divergence | S:80 R:75 A:85 D:80 | plan |
| 2 | Confident | `--app` and Family B only; `/proxy` sibling-shim/rescue/CSP/`--with` NOT included | Superseded by own-origin; user-chosen scope | S:85 R:85 A:85 D:85 | plan |
| 3 | Confident | tailscale foreground-serve pane orchestration is a follow-up, not in this change | This change delivers the routing (verified by manual serve); pane lifecycle is separable | S:80 R:80 A:80 D:80 | plan |

3 assumptions (0 certain, 3 confident, 0 tentative, 0 unresolved).

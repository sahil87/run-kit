# Intake: Own-origin present (`--app`)

**Change**: 260923-hx13-own-origin-present
**Created**: 2026-09-23

## Origin

Goal (developed across an extended design+prototype conversation): `rk present` should open a **running dev app** — including a full SPA like the "loom" design tool — in run-kit's web tile, for a viewer who may be local, on an SSH tunnel, or reaching run-kit by its tailnet hostname, with (almost) no app changes.

The research established that serving an app under a **path prefix** (`/proxy/{port}/`) cannot host a full SPA: root-absolute assets, client-side routing, and sibling-port calls all break because the app assumes it owns an origin root, and a router basename fix was ruled out by the loom team. The working answer is **own-origin**: serve the app at its own origin ROOT, reachable by the viewer. Two reachability modes were prototyped and **verified**:

- **`*.localhost` subdomain** (viewer reaches run-kit via loopback / SSH tunnel) — verified end-to-end with loom over a tunnel (app rendered, deep routes worked, assets resolved).
- **tailscale host-URL port-authority** (viewer opens run-kit by its tailnet hostname) — verified **live** on 2026-09-23: `tailscale serve --https=4295 → run-kit main`, then `https://{tailnet-host}:4295/` served a test app at root through run-kit, with the Host rewritten so a Vite-style Host-allowlist accepted it, and the run-kit UI provably not hijacked.

This change lands that own-origin path as a `--app` opt-in. The default `/proxy` behavior is unchanged.

Interaction mode: conversational; decisions below were made and validated live during the conversation.

## Why

1. **Problem**: `rk present` today serves ports via `/proxy/{port}/` (a path prefix). Full SPAs break under a prefix — root-absolute assets resolve to run-kit's root, `location.pathname` doesn't match the app's routes, and a reload 404s. There is no blind fix (base-path virtualization measured 0/3 under latency; a router basename is a loom no-go).
2. **Consequence if unfixed**: apps like loom simply cannot be opened in `rk present` for a remote viewer — the core use case ("see the dev server in RK Present") is unmet for any client-routed app.
3. **Why own-origin over alternatives**: serving the app at its own origin ROOT makes assets + client-side routing work *natively* — no shim, no rescue, no base-path race. The only requirement is minting a viewer-reachable origin per app, which `*.localhost` (free, loopback/tunnel) and `tailscale serve` (tailnet) both provide. Rejected: `/proxy` path-prefix patching (unfixable for routing); GUI/CDP pixel streaming (interaction broken — user-tested); base-path virtualization (racy).

## What Changes

Opt-in via a new `--app` flag on `rk present`. **No `--app` → byte-identical to today** (`/proxy/{port}/`). A verified reference implementation exists and SHOULD be ported (not re-derived) from the worktree at `/home/ashish_kumar_noon_design/development/shll/run-kit.worktrees/racing-treefrog` — port ONLY the files named below (that worktree also contains unrelated `/proxy` sibling-shim work that is explicitly OUT of scope here).

### 1. Shared own-origin reverse proxy — `app/backend/api/host_routing.go` (new)
A `subdomainRoutingMiddleware` mounted in `router.go` that short-circuits an own-origin Host to a ROOT reverse proxy for that port; every other Host passes through untouched (the bare dashboard host is never affected). It reads the app port from the Host in two shapes:

- **Subdomain label** `{port}.{base}[:N]` where base ∈ {`localhost`, configured `base_domain`} — `splitSubdomainCandidate` (shape-first: no config read for bare hosts / IPs / non-numeric labels; `base_domain` consulted only for a genuine non-localhost subdomain).
- **Host authority** `{base_domain}:{port}` — `splitPortAuthority` (the tailscale/own-host shape, because MagicDNS has no wildcard for a subdomain; `tailscale serve` preserves the app port in the `Host`, verified). Gated on `base_domain` configured AND equal to the host; default web ports (80/443) excluded defensively so the bare-host UI request (no explicit port) can never be hijacked.

The proxy: `SetURL` to `127.0.0.1:{port}` forwarding the path AS-IS (app at root); **rewrites `Host` to `127.0.0.1:{port}`** so a dev server with a strict Host allowlist (Vite) accepts it; strips `X-Frame-Options` and CSP `frame-ancestors` so the cross-origin dashboard tile can embed it; injects a host-generic sibling shim (`proxy_hostswap.js`) into HTML (gzip-aware, Content-Length re-synced). Per-port `httputil.ReverseProxy` cached in a `sync.Map`.

### 2. `--app` flag + render-time per-viewer minting — `app/backend/cmd/rk/present.go`, `internal/tmux`
`rk present` accepts `--app` (boolean), valid ONLY for a port / localhost-URL primary (else usage error). With `--app`, the STORED tile URL is the universal `/proxy/{port}/` fallback AND the slot is app-flagged (`@rk_win_web_<n>_app=1`, `SetWebTabApp`). The own-origin URL is minted at FRONTEND RENDER TIME, per-viewer, because the viewer's host is known only in the browser (the CLI's bind host is not the viewer's). The per-tab app bool threads through `internal/tmux` (`@rk_win_web_<n>_app`, parallel to `_root`, moving under shift/move) → `WindowInfo.WebApp` (json `webApp`) → sessions payload.

### 3. Minting resolvers — `internal/present/mint.go` (new) + `app/frontend/src/lib/web-url.ts`
- Frontend (per-viewer): `mintAppSrc(port, path, host)` where host = `location.host` → `localhost`/`*.localhost` → `{scheme}//{port}.{host}{path}` (subdomain); IP-literal or other → `/proxy/{port}{path}` (universal fallback). Minted subdomains classify as a new `app` address kind.
- Backend: `MintAppURL(appPort, dashboardHost, baseDomain) (url, mode)` pure resolver (subdomain/wildcard/tailscale/proxy ladder) — used to classify the mode; unit-tested on all branches.

### 4. Frontend embeds own-origin as first-class — `app/frontend/src/components/iframe-window.tsx`, `web-url.ts`
`web-url.ts` classifies a minted own-origin URL as the `app` kind; `iframe-window.tsx` skips the frame-check refusal for `app` (run-kit strips the app's frame headers server-side, so embedding is safe), leaving `/proxy` + external kinds unchanged.

### 5. `base_domain` config — `app/backend/internal/settings/settings.go`
A `base_domain` settings-registry key (default empty → only `.localhost`) + `GetBaseDomain()`, stored in `~/.config/run-kit/config.yaml`. Used by host_routing (subdomain + port-authority gate) and MintAppURL (wildcard mode). Registry key only — NO new env var (Constitution §IV). For tailscale, `base_domain` is set to the machine's tailnet FQDN; run-kit already knows this via `LiveTailnetIdentity` (a future enhancement can auto-detect it — out of scope, config is sufficient here).

### Explicitly OUT of scope (do NOT port / build)
- The `/proxy` sibling-port shim, `--with`, root-absolute rescue, CSP relaxation, group storage (`@rk_srv_present_group`) — a superseded approach; own-origin needs none of it. The `/proxy` default stays byte-identical (do not modify it).
- The loom engine URL change (a separate loom-repo change: loom deriving its engine WS from `location`). Not a run-kit change.
- The tailscale foreground-serve **pane orchestration** (run/stop wiring that launches `tailscale serve` in a pane). This change delivers the run-kit **routing** that makes the tailnet host-URL path work (verified by manually running `tailscale serve`); the automated pane lifecycle is a follow-up.

## Affected Memory

- `run-kit/present`: (modify) document `rk present --app` own-origin mode (subdomain + tailscale host-URL), alongside the existing `/proxy` default.
- `run-kit/architecture/proxy` (or the host-routing area): (new/modify) the `host_routing.go` shared reverse proxy — the two Host shapes, Host-rewrite, frame-header strip, own-origin-root rationale.
- `run-kit/settings` (or config registry doc): (modify) the `base_domain` key.
- `run-kit/tmux-sessions`: (modify) the `@rk_win_web_<n>_app` window option row.
- `docs/specs/api.md`: (modify) `--app` contract + host-routing behavior + the byte-identical no-`--app` invariant + documented limits (Safari / bare-IP / hosted-no-wildcard fall back to `/proxy`, degraded for full SPAs).

## Impact

- New: `app/backend/api/host_routing.go` (+ `proxy_hostswap.js` embed + test), `app/backend/internal/present/mint.go` (+ test).
- Modified: `app/backend/api/router.go` (mount middleware), `app/backend/cmd/rk/present.go` (`--app`), `app/backend/internal/tmux/*` (webtab app option + WindowInfo), `app/backend/internal/settings/settings.go` (`base_domain`), `app/frontend/src/lib/web-url.ts`, `app/frontend/src/components/iframe-window.tsx` (+ their tests).
- No new env keys (§IV). No shell strings (§I). tmux/filesystem stays source of truth (§II). Default `/proxy` path untouched.

## Open Questions

- Should `base_domain` auto-detect the tailnet FQDN from run-kit's existing `LiveTailnetIdentity` instead of requiring config? (Deferred — config is sufficient for v1; noted as a follow-up enhancement.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Own-origin (serve app at ROOT) is the mechanism; `/proxy` stays the untouched default and `--app` is opt-in | Verified end-to-end with loom (tunnel) and a test app (tailscale); path-prefix routing is provably unfixable | S:95 R:90 A:95 D:90 |
| 2 | Certain | One shared reverse proxy in `host_routing.go` reads the port from the Host — subdomain label OR host authority | Verified live: `tailscale serve` preserves the app port in `Host`/`X-Forwarded-Host`, so no per-app listener is needed | S:95 R:85 A:95 D:90 |
| 3 | Certain | The proxy MUST rewrite `Host` to `127.0.0.1:{port}` | A Vite-style Host allowlist 403s a foreign Host; verified the app 403s directly but 200s through run-kit | S:95 R:90 A:95 D:90 |
| 4 | Certain | Port-authority rule gated on `base_domain` match + 80/443 excluded, so the bare-host run-kit UI is never hijacked | Verified: bare host and `:443` serve the UI; only `{base}:{app-port}` proxies; UI-safety is load-bearing (user insisted on 1000% certainty) | S:95 R:90 A:95 D:95 |
| 5 | Certain | Own-origin URL is minted at FRONTEND render time, per-viewer (not CLI time) | The viewer host is unknown at CLI time (bind host ≠ viewer host); verified the app-loom tile minting per viewer | S:90 R:85 A:90 D:85 |
| 6 | Confident | Port the verified reference files from the racing-treefrog worktree rather than re-derive | Already built + live-verified; re-derivation risks divergence from what was tested | S:80 R:75 A:85 D:80 |
| 7 | Confident | `base_domain` is a config-registry key, no env var | Constitution §IV forbids new env keys beyond RK_PORT/RK_HOST/RK_CODE_SERVER_PORT | S:85 R:80 A:85 D:85 |
| 8 | Confident | Exclude the `/proxy` sibling-shim/rescue/CSP/group work, the loom engine change, and the tailscale pane orchestration from this change | User chose scope "subdomain + tailscale rule"; the excluded items are superseded, in another repo, or a follow-up | S:85 R:85 A:85 D:85 |
| 9 | Confident | tailscale mode uses `base_domain` = tailnet FQDN for the port-authority gate | Config is sufficient; run-kit already knows the FQDN (LiveTailnetIdentity) for a later auto-detect | S:75 R:70 A:80 D:75 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).

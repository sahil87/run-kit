# Intake: MCP streamable-HTTP route — `/mcp` on the daemon (W4 of the rk MCP plan)

**Change**: 260911-cl9j-mcp-http-route
**Created**: 2026-09-11

## Origin

One-shot `/fab-new` invocation executing row **W4 (`mcp-http-route`)** of the plan doc
`fab/plans/sahil/26-09-10-rk-mcp.md`. Raw input:

> MCP streamable-HTTP route — mount the official Go SDK's streamable-HTTP handler at `/mcp` in
> the daemon, sharing internal/mcp's existing policy table and executor; tailnet-only stance
> (D10: no auth of its own, an explicit Constitution IX exception for the transport's
> POST+GET+DELETE requirement); doctor row; `rk url --mcp`.
>
> Read fab/plans/sahil/26-09-10-rk-mcp.md in full first, then follow its § Pickup protocol
> exactly (D1-D13 closed, docs/specs/mcp.md is design authority on conflicts, policy table in
> app/backend/internal/mcp/policy.go with doctor drift-guard, never expose a verb without a
> policy row). Base this change on § Change breakdown → "W4" row. D10 is already Confirmed as
> "build" — do not re-litigate it. This change needs only W1 (already merged); it does not need
> to wait for W2/W3 to merge first. Update the plan's Status line and the W4 row when you
> create/merge this change.

**Design authority**: `docs/specs/mcp.md` § Transports → `/mcp` (streamable HTTP) and
`docs/specs/api.md` § MCP + § Design Principles item 1 (both merged in W0, PR #913). Every
normative statement below cites one of them. The plan doc owns only sequencing and the pickup
protocol; D10 (`/mcp` is built, tailnet-only, no auth of its own) is **Confirmed** and is not
re-opened here. The plan's Status line and W4 row are updated in this change (pickup protocol
item 5) — first at intake (in progress), again at merge.

**Dependency**: W1 (`260910-nuf6`, PR #924) only. `internal/mcp` was built transport-agnostic
for exactly this change — its package doc and `Server` comment both say "the daemon's `/mcp`
route reuses `New`". W2a/b/c and W3a/b append policy rows; this change adds **no** policy row
and touches no verb's output, so it is independent of them (no shared file beyond a possible
`go.mod` tidy).

**Worktree state**: branch `arctic-narwhal` (a disposable `wt create` name) fast-forwarded to
`origin/main` at `c703a254` at intake; tree clean.

**Code fact-checks performed at intake** (verified in `app/backend/`):

| Fact | Where | Consequence |
|---|---|---|
| `internal/mcp.New(Config{Root, Exe, Version, Instructions, Table, Logger}) (*Server, error)` builds one `*mcpsdk.Server` with every policy row registered; `Server` holds `sdk *mcpsdk.Server`, `executor Executor`, `resolved []Resolved`; the only transport method is `RunStdio` | `internal/mcp/server.go` | The HTTP handler is a **second method on the same `Server`** — no second construction path, no second table |
| go-sdk **v1.7.0** (pinned) ships `mcpsdk.NewStreamableHTTPHandler(getServer func(*http.Request) *mcpsdk.Server, opts *mcpsdk.StreamableHTTPOptions) *StreamableHTTPHandler` (an `http.Handler`). Options: `Stateless bool` (stateless ⇒ GET/DELETE answer 405), `JSONResponse bool`, `Logger *slog.Logger`, `EventStore`, `SessionTimeout time.Duration` (0 ⇒ idle sessions never close), `DisableLocalhostProtection bool` (default false: a request arriving on a loopback local address with a non-loopback `Host` is 403), `CrossOriginProtection *http.CrossOriginProtection` (**deprecated**; nil ⇒ none), `MaxRequestBodyBytes` | `$(go list -m -f '{{.Dir}}' github.com/modelcontextprotocol/go-sdk)/mcp/streamable.go:128-232` | Stateful mode is required (the spec's `GET` SSE stream and `DELETE` termination exist only there). The SDK's own origin protection is not used (next row). Client side for tests: `mcpsdk.StreamableClientTransport{Endpoint, HTTPClient}` |
| Go 1.26's `http.CrossOriginProtection.Check` exempts `GET`/`HEAD`/`OPTIONS` entirely and, for other methods, **passes when `Origin` host == request `Host`** | `$(go env GOROOT)/src/net/http/csrf.go:134-176` | This is precisely the `Origin == Host` reference `mcp.md` forbids ("under DNS rebinding both headers carry the attacker's name"), and it would leave the SSE `GET` unguarded. The route gets its **own** allowlist middleware; the SDK option stays nil |
| The SDK's stateful handler answers a bare `GET /mcp` (no `Mcp-Session-Id`) with `400 Bad Request: GET requires an Mcp-Session-Id header`; `DELETE` likewise 400; a non-`POST/GET/DELETE` method is 405 | `streamable.go:551-604` | A liveness probe needs no MCP session: 400 with that body **is** the "route is mounted" signature the doctor row keys on |
| The daemon router is built once in `api.NewRouterAndServer` → `(*Server).buildRouter()`; root-level (non-`/api`) routes already exist (`/present/*`, `/code/*`, `/ws/state`, `/ws/terminals`, `/ws/gui/{id}`, PWA assets) and the SPA catch-all is mounted last. Post-construction wiring from `rk serve` goes through setters (`SetVersion`, `SetUpdateChecker`, `SetWindowChangeSubscriber`, `SetActiveWindowProvider`) before `ListenAndServe` | `api/router.go:701-1030`, `cmd/rk/serve.go:175-270` | `/mcp` is registered in `buildRouter` for all methods; the handler arrives via a new `SetMCPHandler` setter (the `api` package cannot import `cmd/rk`'s `rootCmd`, so the MCP server must be built in `serve.go`) |
| CORS is a **root** middleware: `cors.Options{AllowedOrigins:["*"], AllowedMethods:["GET","POST","OPTIONS"], …}`. rs/cors's `Handler` calls `next.ServeHTTP` for every non-preflight request even when the method is not in the allowlist (it merely omits the CORS headers); only a preflight `OPTIONS` short-circuits | `api/router.go:843-849`; `go-chi/cors/cors.go:211-233, 291-316` | A non-browser `DELETE /mcp` reaches the handler untouched with the CORS list **unchanged** — exactly the spec's stance ("MCP clients are not browsers; CORS governs only browser preflights") |
| `resolveOrigin(ctx)` (env → `@rk_srv_origin` → default) is the shared CLI origin seam; `rk url` prints it newline-terminated with `Args: cobra.NoArgs`, no flags | `cmd/rk/origin.go`, `cmd/rk/url.go`, `url_test.go` (drives the real `rootCmd.Execute()`) | `--mcp` is a bool flag on `urlCmd` printing `resolveOrigin(ctx) + "/mcp"` |
| `config.Load()` yields `Host` (default `127.0.0.1`, env `RK_HOST`) and `Port` (default 3000, env `RK_PORT`); the daemon already derives `os.Hostname()` at router construction for `/api/health` | `internal/config/config.go:49-73`, `api/router.go:710` | The origin allowlist derives from these plus the interface addresses — no new config key (Constitution VII) |
| No Tailscale integration exists in Go code (`tailscale` appears only in `rk remote`'s help prose); no `net.InterfaceAddrs` call exists yet | grep over `app/backend` | The tailnet hostname/IP the spec names are derived best-effort (§ 2.2) |
| `rk doctor` rows are `doctorCheck{Name, OK, Hint, Note, failLabel}` from `runDoctorChecks()`; state rows (`code-server`, `code bridge`, `gui`, `ephemeral servers`) are **always OK-shaped with a Note**; only defect rows (`mcp`, `tmux-guard shim`, `agent hooks`) flip the verdict. The W1 `mcp` row is the drift guard (`mcpDoctorCheck` → `mcp.Resolve(rootCmd, mcp.Table)`). Pure check functions take injected probes (`codeServerCheck(home, lookPath, dial)`; `dialTCP` is a 400 ms `net.DialTimeout`) | `cmd/rk/doctor.go:60-130, 478-528, 674-693` | The route row is a **state** row (`mcp route`, always OK) built by a pure `mcpRouteCheck(origin, get)` over an injected HTTP probe |
| `cmd/rk/mcp.go`'s `runMCP` builds the server from `rootCmd`, `os.Executable()`, `displayVersion()`, `string(skillBundle)`, and a stderr `slog` text handler | `cmd/rk/mcp.go` | `serve.go` builds the same `mcp.Config` with the daemon's `slog.Default()` logger (stdout is not the wire on the HTTP transport) |
| `internal/mcp` tests: `server_test.go` connects an SDK client over the in-memory transport (`connectInMemory`); `exec_test.go`/`result_test.go` run the executor against shell stubs; `cmd/rk/mcp_e2e_test.go` `go build`s a real `rk` into `t.TempDir()` and drives it over `CommandTransport` against an isolated `rk-test-mcp-<pid>-<ns>` tmux server | `internal/mcp/*_test.go`, `cmd/rk/mcp_e2e_test.go` | The HTTP tests reuse the stub-executor pattern under `httptest.NewServer` with the SDK's `StreamableClientTransport`; no full-daemon E2E (§ 2.8) |
| `api.md` § Routes already lists `POST GET DELETE /mcp → mcp.go` and § MCP already records the stance, the Origin rule, and the CORS-unchanged rule; `mcp.md` § Transports names `rk url --mcp` and the doctor row | `docs/specs/api.md:11, 501-534, 634`; `docs/specs/mcp.md:321-348` | No spec text needs to change unless implementation forces a fix-up row |
| Constitution IX: "`PUT`, `PATCH`, and `DELETE` SHALL NOT be used … The CORS `AllowedMethods` allowlist MUST be `[GET, POST, OPTIONS]`" — carries **no** exception clause today; the exception lives only in the specs. Constitution IV already models a scoped carve-out ("exactly ONE carve-out") | `fab/project/constitution.md:31-32`, v1.11.0 amended 2026-08-28 | The user's words ("an explicit Constitution IX exception") are honoured by a one-sentence scoped carve-out in IX (§ 2.7), version 1.11.0 → 1.12.0 |
| README `## Command reference` has one row per root verb, including `rk url` and `rk mcp`; the skill bundle (`cmd/rk/skill/skill.md` ≡ `docs/site/skill.md`, byte-identical, ≤150 lines) mentions `rk url` for pane agents | `README.md:207-209`, `cmd/rk/skill/skill.md:40,82,101,110` | README `rk url` row gains the `--mcp` mention; the skill bundle is **not** edited (pane agents do not consume `/mcp`) |

## Why

**The problem.** After W1 the only door onto the rk MCP server is `rk mcp` over stdio, which
needs a shell on the box (Claude Desktop reaches it as `ssh <box> rk mcp`). An MCP client that
is already on the tailnet but is not a shell — Claude Code pointed at a remote run-kit host,
any streamable-HTTP MCP client on the laptop — has no way in. `mcp.md` § Roles names exactly
this client set for the `/mcp` route, and D10 closed the decision to build it with the same
tailnet-only, no-auth posture as every other daemon route.

**Why this shape.** Everything protocol-level already exists: `internal/mcp.New` builds one
`*mcpsdk.Server` from the compiled-in policy table, and the pinned go-sdk ships the
streamable-HTTP handler. The change is therefore a **mount**, not a second server: one method
on `internal/mcp.Server` returning an `http.Handler`, one route on the daemon router, one
setter to carry the handler across the `cmd/rk` → `api` package boundary, one flag on `rk url`,
one doctor row. The only new logic is the **Origin allowlist** the spec mandates as the
transport's DNS-rebinding guard — and it must be our own because both the SDK's deprecated
option and Go's `http.CrossOriginProtection` fall open on `Origin == Host`, the exact reference
`mcp.md` rules out.

**Constitution.** I (Security First): tailnet-only, no public exposure, Origin allowlist
derived from the daemon's own identity, `Host` never the reference, and every tool call is still
the W1 argv exec. II (No Database): SDK session state lives in the handler's memory for the
session's life; nothing persists. III (Wrap, Don't Reinvent): the SDK owns the transport. IV
(Minimal Surface Area): one route the spec already justifies (`api.md` § MCP) — the
`code-quality.md` anti-pattern "routes without explicit spec justification" is satisfied. IX
(Uniform HTTP Verb): the transport binds `POST`+`GET`+`DELETE` to one path; the specs record
this as the single scoped exception, and this change makes the exception explicit in the
constitution itself so a literal reading of IX no longer contradicts the merged specs. The CORS
allowlist is untouched.

**What happens without it.** The plan stays at seven changes and the "any MCP client on the
tailnet" half of the goal statement never ships; Claude Code on a laptop can only reach run-kit
by wrapping `ssh <box> rk mcp` as a stdio server, which works but re-spawns the server per
client and gives the daemon no visibility.

## What Changes

### 1. `internal/mcp` — the HTTP transport on the existing `Server` (`internal/mcp/http.go`)

Add, on the existing `Server`:

```go
// HTTPRoutePath is the daemon path the streamable-HTTP transport is mounted at.
const HTTPRoutePath = "/mcp"

// HTTPSessionIdleTimeout closes an SDK session that has received no HTTP
// request for this long — a client that vanished without DELETE must not hold
// its session forever (Constitution II: the handler's memory is the only state).
const HTTPSessionIdleTimeout = 30 * time.Minute

// HTTPHandler returns the streamable-HTTP transport for this server, wrapped
// in the Origin allowlist guard. Every session shares the one SDK server (and
// so the one policy table and executor); per-session state lives inside the
// SDK handler for the session's life only.
func (s *Server) HTTPHandler(policy OriginPolicy, logger *slog.Logger) http.Handler
```

- Built as `mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return s.sdk },
  &mcpsdk.StreamableHTTPOptions{SessionTimeout: HTTPSessionIdleTimeout, Logger: logger})`.
  **Stateful** (`Stateless` false — `GET` SSE and `DELETE` require sessions), `JSONResponse`
  false (SSE responses, the SDK default), `EventStore` nil (no resumption in v1),
  `CrossOriginProtection` **nil** (deprecated, and its `Origin == Host` fail-open is the
  reference the spec forbids — § 2.2 replaces it), `DisableLocalhostProtection` **false**
  (the SDK's loopback-arrival/non-loopback-`Host` 403 is an additive guard; a tailnet request
  arrives on the tailnet address, not loopback, so it never trips for legitimate clients).
- The guard (§ 2.2) wraps the SDK handler and applies to **every** method, including the `GET`
  SSE stream (Go's `Check` exempting `GET` is one of the two reasons it is not reused).
- Nothing in `server.go` changes except that the `Server` comment's "the daemon's /mcp route
  reuses New" becomes true. `RunStdio`, `Tools`, the executor, and the table are untouched.

### 2. Origin allowlist — the DNS-rebinding guard (`internal/mcp/origin.go`)

`mcp.md` § Transports: "When a request carries an `Origin` header, the handler MUST reject it
unless the origin's scheme, host, and port match an entry in an allowlist derived from the
daemon's own bind configuration — the configured `RK_HOST`:`RK_PORT` origin and the host's
tailnet hostname and IP at that port — with an explicit loopback exception. The request's
`Host` header is never the reference."

```go
// OriginPolicy is the /mcp allowlist: exact scheme://host:port entries plus
// the loopback exception. A request with no Origin header is not a browser
// request and always passes; the Host header is never consulted.
type OriginPolicy struct{ allowed map[string]struct{} }

func NewOriginPolicy(origins []string) OriginPolicy   // normalizes each entry (lowercase host, explicit port)
func (p OriginPolicy) Allows(origin string) bool       // parse → normalize → loopback exception → exact match
func (p OriginPolicy) Origins() []string               // sorted, for logging and the doctor/test surface
```

- **Normalization**: `url.Parse`; scheme lowercased; host lowercased; a missing port is filled
  with the scheme default (`80`/`443`) so `http://box` and `http://box:80` compare equal;
  IPv6 hosts stay bracketed. Anything with a path, query, fragment, userinfo, or a scheme other
  than `http`/`https` is rejected (the `validOrigin` posture from `cmd/rk/origin.go`).
- **Loopback exception**: an origin whose host is `localhost`, any `127.0.0.0/8` address, or
  `[::1]` passes **at any port and either scheme** — DNS rebinding cannot manufacture a loopback
  origin (the attacker's `Origin` carries the attacker's *name*), and same-box clients
  legitimately run on other ports (the Vite dev rig, an `rk remote` tunnel client).
- **Match rule**: otherwise `scheme://host:port` must be an exact entry.
- **Derivation** (pure, unit-tested; the live wrapper gathers inputs):

```go
// TailnetIdentity is the best-effort Tailscale self-identity: DNSName is the
// MagicDNS FQDN without its trailing dot; IPs are the node's tailnet addresses.
// Zero when tailscale is absent or the probe failed.
type TailnetIdentity struct{ DNSName string; IPs []string }

// DeriveAllowedOrigins builds the allowlist for one daemon: http://<bindHost>:<port>
// (skipped when bindHost is unspecified — 0.0.0.0 / ::), http://<hostname>:<port>
// (and its first DNS label when hostname is qualified), http://<ip>:<port> for
// every non-loopback unicast interface address (IPv6 bracketed), and the
// tailnet DNSName / IPs at the same port. Scheme is http: the daemon serves
// plain HTTP.
func DeriveAllowedOrigins(bindHost string, port int, hostname string, addrs []net.Addr, tailnet TailnetIdentity) []string

// LiveTailnetIdentity runs `tailscale status --json` under a 3 s
// exec.CommandContext and reads Self.DNSName + Self.TailscaleIPs. A missing
// binary, non-zero exit, or unparseable output yields the zero identity — the
// route never depends on tailscale being installed.
func LiveTailnetIdentity(ctx context.Context) TailnetIdentity
```

  Interface addresses come from `net.InterfaceAddrs()` at daemon start (the tailnet IP is one
  of them whether or not the `tailscale` binary is on PATH); the MagicDNS FQDN is the one entry
  that needs the probe. The set is computed **once at daemon start** — the daemon's own
  addresses are startup facts, and a restart is the way they change.
- **Rejection**: `403` with body `{"error":"origin not allowed"}` (the API error shape) and one
  `WARN` log line naming the rejected origin. **Absent `Origin` passes** (the spec's "when a
  request carries an `Origin` header"): MCP clients are not browsers.
- **What is explicitly not done**: no `https` entries for a TLS-terminating proxy in front of
  the daemon (e.g. `tailscale serve`) — the spec's "scheme, host, and port match" is applied
  literally and the daemon serves plain HTTP; adding such an entry would need a config key the
  spec does not define (non-goal, noted for a future spec fix-up if usage asks).

### 3. `api` — mount `/mcp` on the daemon router (`api/mcp.go`, `api/router.go`)

- New `Server` field `mcpHandler http.Handler` and setter
  `func (s *Server) SetMCPHandler(h http.Handler)` (the `SetVersion`/`SetUpdateChecker`
  precedent — called by `rk serve` before `ListenAndServe`).
- `buildRouter` registers, next to the `/ws/*` routes and **before** the SPA catch-all:

```go
// MCP streamable-HTTP transport — POST (client→server), GET (SSE stream),
// DELETE (session end) on ONE path, the single recorded Constitution IX
// exception (docs/specs/api.md § MCP). chi's Handle matches every method;
// the SDK handler answers 405 for anything else. CORS stays [GET POST OPTIONS]:
// MCP clients are not browsers, and rs/cors passes a non-preflight DELETE
// through without headers. See api/mcp.go.
r.Handle(mcp.HTTPRoutePath, http.HandlerFunc(s.handleMCP))
```

- `handleMCP` delegates to `s.mcpHandler`; when unset it answers
  `503 {"error":"mcp transport not configured"}` via `writeError` — the route is always
  registered so a mis-wired daemon reports a clear state rather than the SPA fallback (a `404`
  from the catch-all would be indistinguishable from a pre-W4 daemon; the doctor row relies on
  that distinction).
- The root CORS middleware, `middleware.Logger`, and `middleware.Recoverer` apply unchanged;
  chi's wrapped `ResponseWriter` implements `http.Flusher`, which the SSE `GET` needs (the
  existing `/ws/*` and SSE paths already prove this stack streams).
- `api.md` § Routes already carries the row (`POST GET DELETE /mcp → mcp.go`); the file name
  matches.

### 4. `rk serve` wiring (`cmd/rk/serve.go`)

After `api.NewRouterAndServer(ctx, logger)` and before the `http.Server` is built:

```go
// /mcp — the streamable-HTTP transport over the same policy table and
// executor `rk mcp` serves on stdio. Fail-soft: a table that cannot resolve is
// a defect `rk doctor`'s mcp row already reports, and the daemon must still
// come up (Constitution VI posture — availability first); the route then
// answers 503 until a fixed binary is restarted.
exe, _ := os.Executable()
if mcpServer, err := mcp.New(mcp.Config{Root: rootCmd, Exe: exe, Version: version, Instructions: string(skillBundle), Logger: logger}); err != nil {
    slog.Warn("mcp: /mcp disabled — policy table did not resolve", "err", err)
} else {
    hostname, _ := os.Hostname()
    addrs, _ := net.InterfaceAddrs()
    tailnet := mcp.LiveTailnetIdentity(ctx)
    policy := mcp.NewOriginPolicy(mcp.DeriveAllowedOrigins(cfg.Host, cfg.Port, hostname, addrs, tailnet))
    slog.Info("mcp: /mcp mounted", "tools", len(mcpServer.Tools()), "origins", policy.Origins())
    apiServer.SetMCPHandler(mcpServer.HTTPHandler(policy, logger))
}
```

- `Exe` is `os.Executable()` for parity with `rk mcp`: the daemon is restarted by every
  upgrade path (`rk update`, `POST /api/update`), so the running binary's own path is the
  right verb executable for its lifetime.
- `version` is the same value `SetVersion` receives (the serve-time display version).
- The `tailscale` probe is the only subprocess added to daemon start; it is bounded (3 s,
  `exec.CommandContext`, argv slice — Constitution I / Process Execution) and its failure is
  silent at `DEBUG`.

### 5. `rk url --mcp` (`cmd/rk/url.go`)

- New local bool flag `--mcp`: "Print the MCP streamable-HTTP endpoint (`<url>/mcp`) instead of
  the server root." Output is `resolveOrigin(ctx) + "/mcp"`, newline-terminated, stdout, exit 0,
  empty stderr — the same heuristic caveat as the bare form (not a liveness probe).
- `Long` gains one sentence naming the flag and its consumer ("the endpoint an MCP client on the
  tailnet — Claude Code and kin — is pointed at; the Claude desktop app uses
  `ssh <box> rk mcp` instead"). `Args: cobra.NoArgs` unchanged.
- `help-dump` publishes the new flag automatically (the tree walk emits `UsageString`); no
  golden fixture exists. The skill bundle is **not** edited.
- README `rk url` row: append "`--mcp` prints the `/mcp` MCP endpoint".

### 6. `rk doctor` — the `mcp route` row (`cmd/rk/doctor.go`)

`mcp.md` § Transports: "`rk doctor` gains a row for the route." Added directly after the W1
`mcp` (drift-guard) row and shaped like the `code-server` **state** row — always `OK: true`
with a `Note`; it never flips the verdict (a daemon that is not running, or an older one, is a
state, not a dependency failure):

```go
// mcpRouteCheck classifies a bounded GET <origin>/mcp. The SDK's stateful
// handler answers a session-less GET with 400 ("GET requires an
// Mcp-Session-Id header"), which is the positive signature — no MCP session
// is opened by the probe. Pure over the injected probe so tests never dial.
func mcpRouteCheck(origin string, get func(url string) (status int, body string, err error)) doctorCheck
```

| Probe outcome | Note |
|---|---|
| dial/transport error | `not reachable at <origin>/mcp — is the daemon running? (rk daemon start)` |
| `404` | `daemon at <origin> answers 404 for /mcp — it predates the route; restart it (rk daemon restart)` |
| `503` | `route present but the transport is not configured — the daemon logged why at start (see the mcp row above)` |
| `400` / `405` / `2xx` | `mounted at <origin>/mcp (<n> tools)` — `<n>` from the same `mcp.Resolve` result the drift-guard row already computed; omitted when that row failed |
| any other status | `unexpected <status> from <origin>/mcp` |

- The live probe: `resolveOrigin(ctx)` for the origin, `http.Client{Timeout: 2 * time.Second}`
  `GET` with `Accept: text/event-stream`, no session header, body read capped at 1 KiB. Seam:
  a package-level `doctorHTTPGet` var (the `dialTCP` idiom) so `runDoctorChecks` is stubbable.
- Appears in `--json` like every check (`{"name":"mcp route","ok":true,"note":"…"}`).

### 7. Constitution IX — make the exception explicit (`fab/project/constitution.md`)

Append to IX (the scoped carve-out shape IV already uses), and bump the governance line:

> One documented exception: the MCP streamable-HTTP transport binds `/mcp` — and only `/mcp` —
> to `POST` + `GET` + `DELETE` on a single path because the protocol mandates all three
> (`docs/specs/mcp.md` § Transports, `docs/specs/api.md` § MCP). The exception is
> transport-scoped, grants nothing to `/api/*`, and leaves the CORS allowlist at
> `[GET, POST, OPTIONS]`.

`**Version**: 1.12.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-09-11`. No other
principle changes.

### 8. Tests

- `internal/mcp/http_test.go`: `httptest.NewServer(server.HTTPHandler(policy, logger))` with
  the executor pointed at the existing shell-stub pattern; connect
  `mcpsdk.NewClient(...).Connect(ctx, &mcpsdk.StreamableClientTransport{Endpoint: ts.URL + "/mcp"}, nil)`;
  assert `ListTools` names equal `server.Tools()` and a `CallTool` round-trips through argv;
  `session.Close()` issues the `DELETE`. Origin cases via raw `http.NewRequest`: allowed entry
  → passes to the SDK (400 session error, **not** 403); disallowed → 403 with the JSON body;
  absent → passes; loopback at an arbitrary port → passes; `Host`-only match (Origin equals a
  crafted `Host`, not in the allowlist) → 403 — the rebinding case. Table test for
  `DeriveAllowedOrigins` (unspecified bind host skipped, qualified hostname yields FQDN + label,
  IPv6 bracketed, loopback interface addresses excluded, tailnet identity folded in, zero
  identity adds nothing) and for `Allows` normalization (default-port fill, case folding,
  path/query rejection).
- `internal/mcp/origin_test.go` may hold the pure-policy cases if `http_test.go` grows past
  the god-file line.
- `api/mcp_test.go`: `/mcp` without a handler → 503 JSON; with a recording stub handler →
  `POST`, `GET`, and `DELETE` all delegated (method and path observed), `PUT` reaches the stub
  too (chi `Handle` is method-agnostic — the SDK answers 405 in production, asserted in the
  `internal/mcp` test); CORS preflight for `DELETE` still yields no `Access-Control-Allow-Methods: DELETE`
  (the allowlist is unchanged).
- `cmd/rk/url_test.go`: `rk url --mcp` prints `<origin>/mcp` with empty stderr; the bare form is
  byte-identical to before.
- `cmd/rk/doctor_test.go`: `mcpRouteCheck` table over the five outcomes; `runDoctorChecks`
  under the stubbed `doctorHTTPGet` contains the `mcp route` row with `OK: true` in every case.
- `cmd/rk/mcp_test.go`: unchanged; `TestMCPTableResolves` still guards the table. No new
  full-daemon E2E (§ Assumptions #12): the `httptest` + real SDK HTTP client test exercises the
  exact handler the daemon mounts, and starting `rk serve` in a test would drag in the
  collectors, the tmuxctl supervisor, and a port.

### 9. Docs and the plan

- `fab/plans/sahil/26-09-10-rk-mcp.md`: Status line notes W4 in progress as `260911-cl9j`;
  the W4 row (both tables) reads `In progress — 260911-cl9j` at intake, `Done — PR #N merged`
  at merge; the "Plan is eight changes" sentence in D10 stays true.
- `docs/specs/mcp.md` / `docs/specs/api.md`: no change expected. If implementation finds a
  conflict, the spec wins and the plan gets a fix-up row (pickup protocol item 1).
- `README.md`: the `rk url` row (§ 5).
- Memory: via hydrate (see Affected Memory).

## Affected Memory

- `run-kit/mcp`: (modify) add the `/mcp` transport — `HTTPHandler`, stateful SDK options,
  `HTTPSessionIdleTimeout`, the `OriginPolicy` allowlist (derivation inputs, loopback exception,
  403 shape, absent-Origin pass), the `mcp route` doctor row, `rk url --mcp`; rewrite the
  "Scope: what the surface does not ship" paragraph (the route now exists); Design Decisions for
  own-guard-over-SDK/Go origin protection, stateful-not-stateless, and no-daemon-E2E
- `run-kit/api-and-sockets`: (modify) new `## MCP Transport (`/mcp`)` section — the mount,
  `SetMCPHandler`, the 503-when-unset state, CORS/IX posture, the Origin guard's relation to the
  root middleware
- `run-kit/architecture/cli`: (modify) `url` row gains `--mcp`; `doctor` row gains `mcp route`;
  `serve` row notes the `/mcp` wiring and the one bounded `tailscale status --json` probe at
  start
- `run-kit/daemon-lifecycle`: (modify) the serve-start sequence gains the MCP mount step and its
  fail-soft rule
- `run-kit/toolkit-standards`: (modify) the help-dump + P9 new-surface check extended to
  `url --mcp` (a flag, so a one-line note)

## Impact

- **Go backend** (`app/backend/`): `internal/mcp/http.go` + `origin.go` (new, ~200 lines with
  the derivation), `internal/mcp/server.go` (comment only), `api/mcp.go` (new, small),
  `api/router.go` (one field, one setter, one route), `cmd/rk/serve.go` (wiring block),
  `cmd/rk/url.go` (flag), `cmd/rk/doctor.go` (row + probe seam), tests alongside each. No
  `go.mod` change (the SDK is already pinned; `net`, `net/http`, `os/exec` are stdlib).
- **Frontend**: none. **Desktop**: none. **tmux**: none — no option, no subprocess beyond the
  bounded tailscale probe at start.
- **API surface**: one route, `/mcp`, all three transport methods; no `/api/*` change; CORS
  unchanged.
- **CLI surface**: one flag (`rk url --mcp`), one doctor row (`mcp route`). No verb output
  changes (D5 untouched); no policy row added (the table is W2/W3's).
- **Governance**: Constitution IX gains its scoped exception; version 1.12.0.
- **Security posture**: tailnet-only by inheritance (the daemon binds where `RK_HOST` says);
  no auth; Origin allowlist rejects foreign browser origins; `Host` is never consulted; the SDK's
  loopback-arrival guard stays on.
- **Runtime**: one `*mcpsdk.Server` shared across sessions; per-session memory bounded by
  `HTTPSessionIdleTimeout`; each tool call is still a ≤45 s argv child.

## Open Questions

None. Every design point has a spec answer or a graded assumption below; `/fab-clarify` can
revisit any Confident row.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Stateful SDK handler (`Stateless: false`), one shared `*mcpsdk.Server` returned by `getServer` for every request | `mcp.md` requires `GET` SSE + `DELETE` termination, which the SDK offers only in stateful mode (stateless answers 405); the SDK's `getServer` factory is the documented way to share one server | S:85 R:85 A:90 D:90 |
| 2 | Certain | Write our own Origin allowlist middleware; leave the SDK's deprecated `CrossOriginProtection` nil and do not reuse Go's `http.CrossOriginProtection` | Both pass on `Origin == Host` and Go's exempts `GET` — the spec names `Origin == Host` as defending nothing under rebinding, and the SSE stream is a `GET` | S:80 R:85 A:90 D:80 |
| 3 | Confident | Allowlist derivation = bind host (unless unspecified) + `os.Hostname()` (+ first label) + every non-loopback unicast interface IP + best-effort `tailscale status --json` `Self.DNSName`/`TailscaleIPs`, all at `RK_PORT`, computed once at daemon start | The spec names "tailnet hostname and IP at that port" but not how to derive them; no tailscale integration exists, so interface enumeration covers the IP without the binary and the MagicDNS FQDN needs the bounded probe; startup facts, restart to change | S:60 R:80 A:65 D:55 |
| 4 | Confident | The loopback exception admits `localhost` / `127.0.0.0/8` / `[::1]` origins at **any** port and either scheme | Rebinding cannot yield a loopback origin; same-box clients (Vite dev rig, `rk remote` tunnel clients) legitimately use other ports | S:55 R:85 A:70 D:60 |
| 5 | Confident | Allowlist entries are `http` only; a TLS-terminating proxy in front of the daemon (`tailscale serve`) is a non-goal | The daemon serves plain HTTP; the spec says scheme must match; an `https` entry would need a config key the spec does not define | S:50 R:85 A:60 D:55 |
| 6 | Confident | Handler crosses the `cmd/rk` → `api` boundary via a `SetMCPHandler` setter; `/mcp` is always registered and answers 503 when unset | `api` cannot import `rootCmd`; the setter mirrors `SetVersion`/`SetUpdateChecker`; a 404 from the SPA catch-all would be indistinguishable from a pre-W4 daemon | S:65 R:85 A:85 D:75 |
| 7 | Confident | `rk serve` is fail-soft on `mcp.New` error — `WARN` + route left unset (503), never a start failure | Availability-first (Constitution VI posture, the `ensureCodeServer` precedent); `rk doctor`'s `mcp` row and `go test` already report a non-resolving table | S:60 R:85 A:85 D:75 |
| 8 | Confident | `HTTPSessionIdleTimeout = 30 * time.Minute` as a named constant; no `EventStore` | SDK default never closes idle sessions (a memory leak for vanished clients); 30 min is a first guess like the 45 s cap — one constant to revisit | S:40 R:95 A:75 D:60 |
| 9 | Confident | Doctor `mcp route` is an always-OK **state** row keyed on a session-less `GET` (400 = mounted, 404 = predates, 503 = unconfigured, dial error = not running) | The `code-server`/`gui` rows set the state-row posture; the SDK's 400 body is a stable, session-free signature; the W1 `mcp` row remains the verdict flipper | S:60 R:90 A:80 D:65 |
| 10 | Confident | Amend Constitution IX with the one-sentence scoped exception and bump to 1.12.0 | The user's words are "an explicit Constitution IX exception"; W0 recorded it in specs only, leaving IX's literal text contradicting the merged design; IV models the carve-out shape | S:70 R:90 A:60 D:55 |
| 11 | Certain | `rk url --mcp` prints `resolveOrigin(ctx) + "/mcp"`; the bare form is byte-identical to today | Spec text names the flag and its meaning; `url.go`/`origin.go` provide the seam | S:90 R:95 A:95 D:95 |
| 12 | Confident | No full-daemon E2E; the transport is tested with `httptest` + the SDK's real `StreamableClientTransport` against the stub executor, plus router-level and doctor-level unit tests | The exact handler the daemon mounts is exercised; `rk serve` in a test would pull collectors, the tmuxctl supervisor, and a port for no additional coverage of this change's code | S:55 R:85 A:80 D:65 |
| 13 | Certain | Skill bundle unchanged; README `rk url` row gains the `--mcp` mention | Pane agents do not consume `/mcp`; the bundle is byte-identical-tested and line-budgeted; README carries one row per verb | S:75 R:95 A:90 D:85 |
| 14 | Confident | The daemon-hosted executor's `Exe` is `os.Executable()` (parity with `rk mcp`) | Every upgrade path restarts the daemon, so the running binary's path is valid for its lifetime; `selfpath.Stable` exists for sessions that outlive the binary, which the daemon does not | S:60 R:90 A:75 D:60 |
| 15 | Certain | SDK `DisableLocalhostProtection` left `false` | Additive guard; legitimate tailnet requests arrive on the tailnet address, loopback requests carry a loopback `Host`, so it never rejects a real client | S:70 R:90 A:85 D:85 |
| 16 | Certain | Rejection is `403 {"error":"origin not allowed"}` + one `WARN` log; a request with no `Origin` passes | The spec's rule is conditional on the header's presence; the API error shape is the router's single error contract | S:75 R:90 A:85 D:80 |

16 assumptions (7 certain, 9 confident, 0 tentative, 0 unresolved).

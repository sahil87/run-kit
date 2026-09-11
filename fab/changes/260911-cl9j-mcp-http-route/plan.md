# Plan: MCP streamable-HTTP route — `/mcp` on the daemon (W4 of the rk MCP plan)

**Change**: 260911-cl9j-mcp-http-route
**Intake**: `intake.md`

## Requirements

Design authority: `docs/specs/mcp.md` § Transports → `/mcp` and `docs/specs/api.md` § MCP. All
paths below are relative to `app/backend/` unless they start with `docs/`, `fab/`, or `README`.

### MCP transport: the `/mcp` handler on `internal/mcp.Server`

#### R1: `HTTPHandler` serves the stateful streamable-HTTP transport over the shared server
`internal/mcp` SHALL export `HTTPRoutePath = "/mcp"` and `HTTPSessionIdleTimeout = 30 * time.Minute`
and a method `func (s *Server) HTTPHandler(policy OriginPolicy, logger *slog.Logger) http.Handler`
that returns `mcpsdk.NewStreamableHTTPHandler(getServer, opts)` wrapped by the Origin guard (R2),
where `getServer` returns `s.sdk` for every request and `opts` is
`&mcpsdk.StreamableHTTPOptions{SessionTimeout: HTTPSessionIdleTimeout, Logger: logger}` — stateful
(`Stateless` false), SSE responses (`JSONResponse` false), no `EventStore`, `CrossOriginProtection`
nil, `DisableLocalhostProtection` false. `RunStdio`, `Tools`, `New`, the executor, and `Table` MUST
be unchanged.

- **GIVEN** a `Server` built by `New` and an `httptest.Server` serving `HTTPHandler(policy, logger)`
- **WHEN** a go-sdk client connects over `StreamableClientTransport{Endpoint: ts.URL + "/mcp"}`
- **THEN** `ListTools` returns exactly `server.Tools()` and `CallTool` executes the row's argv through the executor
- **AND** `session.Close()` issues the transport's `DELETE` and the server answers it

- **GIVEN** the same handler
- **WHEN** a raw `PUT /mcp` arrives
- **THEN** the SDK answers `405 Method Not Allowed`

#### R2: The Origin allowlist is the transport's DNS-rebinding guard
`internal/mcp` SHALL export `OriginPolicy` with `NewOriginPolicy(origins []string) OriginPolicy`,
`(OriginPolicy) Allows(origin string) bool`, and `(OriginPolicy) Origins() []string` (sorted). The
guard wrapping the SDK handler MUST apply to **every** method. A request with no `Origin` header
MUST pass. A request whose `Origin` is present MUST be rejected with `403` and body
`{"error":"origin not allowed"}` (content-type `application/json`) plus one `WARN` log line naming
the origin, unless `Allows` returns true. `Allows` MUST: parse with `url.Parse`; reject anything with
a path, query, fragment, or userinfo, or a scheme other than `http`/`https`; lowercase scheme and
host; fill a missing port with the scheme default (`80`/`443`); keep IPv6 hosts bracketed; pass any
origin whose host is `localhost`, a `127.0.0.0/8` address, or `[::1]` at **any** port and either
scheme (the loopback exception); otherwise require an exact `scheme://host:port` entry. The request
`Host` header MUST NOT be consulted anywhere in the guard.

- **GIVEN** a policy built from `["http://box:3000"]`
- **WHEN** requests arrive with `Origin: http://box:3000`, `Origin: http://BOX:3000`, no `Origin`, `Origin: http://127.0.0.1:5173`, `Origin: http://localhost`
- **THEN** each passes to the SDK handler (observable as the SDK's own `400 … requires an Mcp-Session-Id header` on a bare `GET`, not a `403`)

- **GIVEN** the same policy
- **WHEN** a request arrives with `Origin: http://evil.example:3000` and `Host: evil.example:3000` (the rebinding shape — Origin equals Host)
- **THEN** it is rejected with `403 {"error":"origin not allowed"}` and one `WARN` line

- **GIVEN** the same policy
- **WHEN** `Origin: http://box:3000/path`, `Origin: ftp://box:3000`, or `Origin: http://user@box:3000` arrives
- **THEN** it is rejected with `403`

#### R3: The allowlist derives from the daemon's own identity
`internal/mcp` SHALL export `TailnetIdentity{DNSName string; IPs []string}`,
`DeriveAllowedOrigins(bindHost string, port int, hostname string, addrs []net.Addr, tailnet TailnetIdentity) []string`,
and `LiveTailnetIdentity(ctx context.Context) TailnetIdentity`. `DeriveAllowedOrigins` MUST return
(deduplicated, sorted) `http://<host>:<port>` entries for: `bindHost` unless it is unspecified
(`0.0.0.0`, `::`, `[::]`, empty); `hostname` lowercased and, when it contains a dot, also its first
label; every non-loopback unicast IP found in `addrs` (`*net.IPNet` or `*net.IPAddr`; IPv6
bracketed; link-local and multicast excluded); `tailnet.DNSName` with any trailing dot removed; and
each `tailnet.IPs` entry. `LiveTailnetIdentity` MUST run `tailscale status --json` via
`exec.CommandContext` under a 3 s timeout with an argv slice, read `Self.DNSName` and
`Self.TailscaleIPs`, and return the zero value on a missing binary, non-zero exit, timeout, or
unparseable output (logged at `DEBUG` only).

- **GIVEN** `bindHost "0.0.0.0"`, `port 3000`, `hostname "Box.tail1234.ts.net"`, addrs `{127.0.0.1/8, 100.64.1.2/32, fe80::1/64, fd7a:115c:a1e0::1/128}`, tailnet `{DNSName:"box.tail1234.ts.net.", IPs:["100.64.1.2"]}`
- **WHEN** `DeriveAllowedOrigins` runs
- **THEN** the result is exactly `http://100.64.1.2:3000`, `http://[fd7a:115c:a1e0::1]:3000`, `http://box.tail1234.ts.net:3000`, `http://box:3000` (no `0.0.0.0`, no loopback, no link-local, no duplicate tailnet IP)

- **GIVEN** `bindHost "127.0.0.1"`, `hostname "box"`, no addrs, zero tailnet
- **WHEN** `DeriveAllowedOrigins` runs
- **THEN** the result is `http://127.0.0.1:3000`, `http://box:3000`

### API: the daemon mount

#### R4: `/mcp` is always registered and delegates to an injected handler
`api.Server` SHALL gain an `mcpHandler http.Handler` field and
`func (s *Server) SetMCPHandler(h http.Handler)`. `buildRouter` MUST register
`r.Handle(mcp.HTTPRoutePath, http.HandlerFunc(s.handleMCP))` (all methods) before the SPA catch-all,
in `api/router.go`, with `handleMCP` in a new `api/mcp.go` delegating to `s.mcpHandler` when set and
answering `503` via `writeError(w, http.StatusServiceUnavailable, "mcp transport not configured")`
when nil. The root CORS options (`AllowedMethods: [GET, POST, OPTIONS]`) MUST be unchanged.

- **GIVEN** a test router with no handler set
- **WHEN** `POST /mcp` arrives
- **THEN** the response is `503 {"error":"mcp transport not configured"}`

- **GIVEN** a test router with a recording stub set via `SetMCPHandler`
- **WHEN** `POST`, `GET`, and `DELETE /mcp` arrive
- **THEN** each reaches the stub with its method and path intact

- **GIVEN** the router
- **WHEN** a CORS preflight `OPTIONS /mcp` with `Access-Control-Request-Method: DELETE` arrives
- **THEN** the `Access-Control-Allow-Methods` header (if any) does not include `DELETE`

### CLI: `rk serve` wiring

#### R5: The daemon builds the MCP server fail-soft and mounts the transport
`cmd/rk/serve.go` SHALL, after `api.NewRouterAndServer` and before constructing `http.Server`, call
`mcp.New(mcp.Config{Root: rootCmd, Exe: <os.Executable()>, Version: version, Instructions: string(skillBundle), Logger: logger})`.
On error it MUST `slog.Warn` (`mcp: /mcp disabled — policy table did not resolve`) and continue
without setting a handler. On success it MUST derive the policy from
`mcp.DeriveAllowedOrigins(cfg.Host, cfg.Port, os.Hostname(), net.InterfaceAddrs(), mcp.LiveTailnetIdentity(ctx))`,
call `apiServer.SetMCPHandler(server.HTTPHandler(policy, logger))`, and `slog.Info` the tool count
and allowed origins. Daemon start MUST never fail because of this block.

- **GIVEN** a build whose policy table resolves
- **WHEN** `rk serve` starts
- **THEN** the log carries `mcp: /mcp mounted` with `tools` and `origins`, and `GET /mcp` answers the SDK's `400` rather than `503` or the SPA

### CLI: `rk url --mcp`

#### R6: `rk url --mcp` prints the MCP endpoint
`urlCmd` SHALL gain a local bool flag `--mcp` ("Print the MCP streamable-HTTP endpoint (<url>/mcp) instead of the server root").
With the flag, stdout is exactly `resolveOrigin(ctx) + "/mcp"` newline-terminated, exit 0, empty
stderr; without it the output is byte-identical to today. `Long` MUST name the flag and its consumer
(MCP clients on the tailnet; the Claude desktop app uses `ssh <box> rk mcp`). `Args: cobra.NoArgs`
is unchanged.

- **GIVEN** `RK_HOST=10.0.0.5 RK_PORT=3210` in the environment
- **WHEN** `rk url --mcp` runs
- **THEN** stdout is `http://10.0.0.5:3210/mcp\n` and stderr is empty

### CLI: `rk doctor` route row

#### R7: `rk doctor` carries an always-OK `mcp route` state row
`cmd/rk/doctor.go` SHALL add `mcpRouteCheck(origin string, tools int, get func(url string) (int, string, error)) doctorCheck`
— pure over the injected probe, `Name: "mcp route"`, always `OK: true` — registered in
`runDoctorChecks` immediately after the `mcp` row, with `tools` from that row's resolution (0 when it
failed). Notes: probe error → `not reachable at <origin>/mcp — is the daemon running? (rk daemon start)`;
`404` → `daemon at <origin> answers 404 for /mcp — it predates the route; restart it (rk daemon restart)`;
`503` → `route present but the transport is not configured — the daemon logged why at start (see the mcp row above)`;
`400`, `405`, or any `2xx` → `mounted at <origin>/mcp` plus ` (<n> tools)` when `tools > 0`; any
other status → `unexpected <status> from <origin>/mcp`. The live probe MUST be a package-level seam
`doctorHTTPGet` performing `GET <origin>/mcp` with `Accept: text/event-stream`, no session header,
`http.Client{Timeout: 2 * time.Second}`, body read capped at 1 KiB; the origin is `resolveOrigin(ctx)`.
The row MUST appear in `--json`.

- **GIVEN** a probe returning `(400, "Bad Request: GET requires an Mcp-Session-Id header", nil)` and `tools 10`
- **WHEN** `mcpRouteCheck` runs
- **THEN** the row is `OK: true`, Note `mounted at http://127.0.0.1:3000/mcp (10 tools)`

- **GIVEN** a probe returning a dial error
- **WHEN** `mcpRouteCheck` runs
- **THEN** the row is `OK: true` with the not-reachable Note, and `runDoctorChecks` overall `ok` is unaffected

### Governance and docs

#### R8: Constitution IX records the scoped exception
`fab/project/constitution.md` § IX SHALL gain, after the CORS sentence, exactly one additional
paragraph: `One documented exception: the MCP streamable-HTTP transport binds /mcp — and only /mcp — to POST + GET + DELETE on a single path because the protocol mandates all three (docs/specs/mcp.md § Transports, docs/specs/api.md § MCP). The exception is transport-scoped, grants nothing to /api/*, and leaves the CORS allowlist at [GET, POST, OPTIONS].`
(with the code spans as in the intake § 7). The governance line MUST read
`**Version**: 1.12.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-09-11`. No other principle changes.

- **GIVEN** the amended constitution
- **WHEN** a reviewer reads IX
- **THEN** the `/mcp` `DELETE` is an explicitly permitted, scoped exception and the CORS rule still reads `[GET, POST, OPTIONS]`

#### R9: README documents the flag
`README.md`'s `rk url` command-reference row SHALL mention `--mcp` (prints the `/mcp` MCP endpoint).
The skill bundle (`cmd/rk/skill/skill.md`, `docs/site/skill.md`) MUST NOT change.

- **GIVEN** the README
- **WHEN** the `rk url` row is read
- **THEN** it names `--mcp`; `cmd/rk/skill/skill.md` and `docs/site/skill.md` are byte-identical to before

### Non-Goals

- Any auth on `/mcp` or public exposure of it — D10, spec § Non-goals.
- `https` allowlist entries for a TLS-terminating proxy (`tailscale serve`) — the daemon serves plain HTTP; a config key would be needed and the spec defines none.
- New policy rows or any verb output change — W2/W3's scope; D5 untouched.
- A full-daemon E2E (`rk serve` under test) — the httptest handler is the exact mounted handler.
- `EventStore` / stream resumption, `listChanged`, MCP resources or prompts — spec § Deferred.
- Editing the skill bundle.
- Updating the plan doc's W4 row to "Done" — that happens at merge, outside this pipeline.

### Design Decisions

#### Own Origin guard instead of the SDK's or Go's cross-origin protection
**Decision**: `/mcp` is wrapped by an `internal/mcp.OriginPolicy` allowlist middleware; `StreamableHTTPOptions.CrossOriginProtection` stays nil and Go's `http.CrossOriginProtection` is not used.
**Why**: `mcp.md` names `Origin == Host` as defending nothing under DNS rebinding; both the SDK option (deprecated) and Go's `Check` pass on exactly that comparison, and Go's exempts `GET`, which is the SSE stream.
**Rejected**: `http.NewCrossOriginProtection()` with `AddTrustedOrigin` (still falls open on `Origin == Host` before consulting the trusted set); the SDK's `enableoriginverification` debug knob (same fail-open, and a `MCPGODEBUG` env is not a design).
*Introduced by*: 260911-cl9j-mcp-http-route

#### Stateful transport with an idle-session timeout
**Decision**: `Stateless: false`, `SessionTimeout: HTTPSessionIdleTimeout` (30 min), no `EventStore`.
**Why**: the spec's `GET` SSE stream and `DELETE` termination exist only in stateful mode; the SDK never closes idle sessions by default, so a vanished client would hold memory forever (Constitution II — the handler's memory is the only state).
**Rejected**: stateless mode (answers 405 to `GET`/`DELETE`, contradicting `api.md` § MCP); no timeout (unbounded per-session memory).
*Introduced by*: 260911-cl9j-mcp-http-route

#### Handler injected through a setter; route always registered
**Decision**: `api.Server.SetMCPHandler` carries the handler across the `cmd/rk` → `api` boundary; `/mcp` is registered unconditionally and answers 503 until set.
**Why**: `api` cannot import `cmd/rk`'s `rootCmd`; the setter mirrors `SetVersion`/`SetUpdateChecker`; an unregistered route would fall to the SPA catch-all's 404, indistinguishable from a pre-W4 daemon for the doctor row.
**Rejected**: passing the handler into `NewRouterAndServer` (signature churn for `NewRouter` callers and tests); building the MCP server inside `api` (needs the Cobra tree).
*Introduced by*: 260911-cl9j-mcp-http-route

#### Allowlist derived once at start from bind config, hostname, interfaces, and a best-effort tailscale probe
**Decision**: `DeriveAllowedOrigins` folds `RK_HOST`, `os.Hostname()`, `net.InterfaceAddrs()`, and `tailscale status --json`'s self identity into `http://…:<RK_PORT>` entries at daemon start.
**Why**: the spec names the tailnet hostname and IP as inputs without a derivation; interface enumeration yields the tailnet IP without the binary, and only the MagicDNS FQDN needs the bounded probe; the daemon's addresses are startup facts.
**Rejected**: a config key listing origins (Constitution VII — conventions over configuration; the spec defines none); re-deriving per request (a subprocess on the hot path).
*Introduced by*: 260911-cl9j-mcp-http-route

#### Doctor route row is a state row keyed on the SDK's session-less 400
**Decision**: `mcp route` is always `OK: true`; a bare `GET /mcp` answering `400 … Mcp-Session-Id` is the mounted signature.
**Why**: the `code-server`/`gui` rows set the posture that a not-running or older daemon is a state, not a dependency failure; the W1 `mcp` row remains the verdict flipper for real defects; the probe opens no MCP session.
**Rejected**: a full `initialize` handshake (heavier, and leaves a session to `DELETE`); a verdict-flipping row (a stopped daemon would fail doctor).
*Introduced by*: 260911-cl9j-mcp-http-route

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/mcp/origin.go`: `OriginPolicy` (allowed set), `NewOriginPolicy`, `Allows` (parse → reject path/query/fragment/userinfo/non-http(s) → lowercase scheme+host → fill default port → loopback exception for `localhost`/`127.0.0.0/8`/`[::1]` at any port and scheme → exact match), `Origins()` sorted; an unexported `normalizeOrigin(raw string) (string, bool)` shared by constructor and check; `isLoopbackHost(host string) bool` <!-- R2 -->
- [x] T002 [P] In `app/backend/internal/mcp/origin.go`: `TailnetIdentity`, `DeriveAllowedOrigins` (unspecified bind host skipped; hostname lowercased + first label when qualified; non-loopback unicast IPs from `*net.IPNet`/`*net.IPAddr` with link-local/multicast excluded and IPv6 bracketed via `net.JoinHostPort`; tailnet DNSName trailing dot trimmed; IPs folded; dedupe + sort), and `LiveTailnetIdentity(ctx)` (`exec.LookPath("tailscale")` → `exec.CommandContext` 3 s argv `["status","--json"]` → parse `Self.DNSName`/`Self.TailscaleIPs`; zero value + `slog.Debug` on any failure) <!-- R3 -->
- [x] T003 [P] Create `app/backend/internal/mcp/origin_test.go`: table tests for `Allows` (exact match, case folding, default-port fill for `http://box` vs `http://box:80`, IPv6 bracket, path/query/userinfo/scheme rejections, loopback at arbitrary port and https, `Origin == Host` rebinding shape rejected) and `DeriveAllowedOrigins` (the two R3 scenarios plus zero identity adds nothing) <!-- R2 -->

### Phase 2: Core Implementation

- [x] T004 Create `app/backend/internal/mcp/http.go`: `HTTPRoutePath`, `HTTPSessionIdleTimeout`, `(*Server).HTTPHandler(policy, logger)` building `mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return s.sdk }, &mcpsdk.StreamableHTTPOptions{SessionTimeout, Logger})` wrapped by `originGuard(policy, logger, next)` — every method; absent `Origin` passes; disallowed → `403` JSON `{"error":"origin not allowed"}` + `logger.Warn("mcp: origin rejected", "origin", o)`; `Host` never read. Update the `Server` doc comment in `server.go` to state the route now exists (no other `server.go` change) <!-- R1 -->
- [x] T005 Create `app/backend/internal/mcp/http_test.go`: `httptest.NewServer(srv.HTTPHandler(policy, logger))` with the executor pointed at the existing stub pattern from `server_test.go`/`exec_test.go`; connect via `mcpsdk.NewClient(...).Connect(ctx, &mcpsdk.StreamableClientTransport{Endpoint: ts.URL + "/mcp"}, nil)`; assert `ListTools` names == `srv.Tools()`, one `CallTool` round-trips argv through the stub, `Close()` succeeds (DELETE); raw-request cases: allowed Origin → SDK 400 (not 403), disallowed → 403 JSON, absent → 400, loopback other port → 400, `Origin == Host` non-allowlisted → 403, `PUT` → 405 <!-- R1 -->
- [x] T006 Create `app/backend/api/mcp.go` (`handleMCP`: delegate to `s.mcpHandler` or `writeError(w, 503, "mcp transport not configured")`) and edit `app/backend/api/router.go`: `mcpHandler http.Handler` field, `SetMCPHandler`, `r.Handle(mcp.HTTPRoutePath, http.HandlerFunc(s.handleMCP))` registered next to the `/ws/*` routes before `mountSPA`, with the IX-exception comment from intake § 3; import `rk/internal/mcp`; CORS options untouched <!-- R4 -->
- [x] T007 Create `app/backend/api/mcp_test.go` using `NewTestRouter`: 503 JSON without handler; recording stub receives `POST`/`GET`/`DELETE` (method + path observed) after `SetMCPHandler` (expose the server via the existing test-router pattern — add a `NewTestRouterAndServer` variant only if no existing helper returns the `*Server`); preflight `OPTIONS /mcp` with `Access-Control-Request-Method: DELETE` yields no `DELETE` in `Access-Control-Allow-Methods` <!-- R4 -->
- [x] T008 Edit `app/backend/cmd/rk/serve.go`: after `apiServer.SetVersion(...)`, the fail-soft `mcp.New` block from intake § 4 (`Exe` from `os.Executable()`, `Version: version`, `Instructions: string(skillBundle)`, `Logger: logger`), `DeriveAllowedOrigins` with `cfg.Host`, `cfg.Port`, `os.Hostname()`, `net.InterfaceAddrs()`, `mcp.LiveTailnetIdentity(ctx)`, `SetMCPHandler`, and the two log lines (`mcp: /mcp disabled — policy table did not resolve` / `mcp: /mcp mounted` with `tools`, `origins`) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Edit `app/backend/cmd/rk/url.go`: `--mcp` bool flag (package var `urlMCP`, registered in an `init()` or inline `Flags().BoolVar`), RunE prints `resolveOrigin(ctx) + "/mcp"` when set; extend `Long` per intake § 5; add tests to `app/backend/cmd/rk/url_test.go` (`--mcp` under `RK_HOST`/`RK_PORT` env prints `<origin>/mcp`, empty stderr; bare form unchanged; reset the flag in the test cleanup) <!-- R6 -->
- [x] T010 Edit `app/backend/cmd/rk/doctor.go`: `mcpRouteCheck(origin, tools, get)` per R7's note table, `doctorHTTPGet` package-level seam (`GET`, `Accept: text/event-stream`, 2 s client timeout, `io.LimitReader` 1 KiB), `mcpRouteDoctorCheck(ctx, tools)` live wrapper using `resolveOrigin`, registered in `runDoctorChecks` right after the `mcp` row (pass the resolved tool count; 0 when the drift guard failed); add `mcpRouteCheck` table tests (dial error, 404, 503, 400 with tools, 405, 200, 500) and a `runDoctorChecks` assertion that the row is present and `OK` under a stubbed `doctorHTTPGet` in `app/backend/cmd/rk/doctor_test.go` <!-- R7 -->

### Phase 4: Polish

- [x] T011 Edit `fab/project/constitution.md`: append the IX exception paragraph (intake § 7, code spans intact) after the CORS sentence; set the governance line to `**Version**: 1.12.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-09-11` <!-- R8 -->
- [x] T012 [P] Edit `README.md`: the `rk url` command-reference row gains `--mcp prints the /mcp MCP endpoint` (match the row's existing phrasing style); confirm `app/backend/cmd/rk/skill/skill.md` and `docs/site/skill.md` are untouched <!-- R9 -->
- [x] T013 Verify: `cd app/backend && gofmt -l ./internal/mcp ./api ./cmd/rk` is empty, `go vet ./...` passes, and `just test-backend` is green (includes `TestMCPTableResolves`, the W1 E2E, and the new tests); `just build` succeeds <!-- R1 -->

## Execution Order

- T001 blocks T004 (the guard needs `OriginPolicy`); T002 is independent of T001 beyond sharing the file — write T001 first, then append T002
- T004 blocks T005, T006 (imports `mcp.HTTPRoutePath`), and T008
- T006 blocks T007 and T008
- T009, T010, T011, T012 are independent of each other once T004/T006 exist (T010 needs nothing from them but should land after T008 so the note text matches the serve log)
- T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/mcp.HTTPHandler` exists, returns an `http.Handler`, uses `Stateless: false`, `SessionTimeout: HTTPSessionIdleTimeout`, nil `CrossOriginProtection`, default `DisableLocalhostProtection`, and returns `s.sdk` from `getServer`; `HTTPRoutePath == "/mcp"`; `RunStdio`/`Tools`/`New`/`Table` are unchanged
- [x] A-002 R2: `OriginPolicy` exposes `NewOriginPolicy`, `Allows`, `Origins`; the guard applies to every method, passes absent `Origin`, and never reads `Host`
- [x] A-003 R3: `DeriveAllowedOrigins` and `LiveTailnetIdentity` exist with the specified signatures; the probe uses `exec.CommandContext` with a 3 s timeout and an argv slice
- [x] A-004 R4: `/mcp` is registered via `r.Handle` before the SPA catch-all; `SetMCPHandler` exists; unset ⇒ `503 {"error":"mcp transport not configured"}`
- [x] A-005 R5: `serve.go` builds the MCP server fail-soft, derives the policy from bind config + hostname + interfaces + tailnet identity, sets the handler, and logs mounted/disabled
- [x] A-006 R6: `rk url --mcp` prints `<origin>/mcp`; the bare form is byte-identical
- [x] A-007 R7: the `mcp route` row exists, is always `OK: true`, sits after the `mcp` row, appears in `--json`, and its live probe rides the `doctorHTTPGet` seam
- [x] A-008 R8: Constitution IX carries the scoped exception paragraph and the governance line reads 1.12.0 / 2026-09-11
- [x] A-009 R9: README's `rk url` row names `--mcp`; both skill bundle copies are unchanged

### Behavioral Correctness

- [x] A-010 R2: an `Origin` equal to a crafted non-allowlisted `Host` is rejected with 403 (the rebinding case), while an allowlisted `Origin` with an unrelated `Host` passes
- [x] A-011 R2: rejection body is `application/json` `{"error":"origin not allowed"}` and exactly one `WARN` line names the origin
- [x] A-012 R4: the CORS `AllowedMethods` option is still exactly `["GET", "POST", "OPTIONS"]`

### Scenario Coverage

- [x] A-013 R1: a real go-sdk `StreamableClientTransport` client lists the table's tools and completes a `CallTool` against the mounted handler; `Close()` (DELETE) succeeds
- [x] A-014 R3: the two R3 derivation scenarios pass as table tests
- [x] A-015 R6: `url_test.go` covers `--mcp` with env-derived origin and empty stderr
- [x] A-016 R7: `mcpRouteCheck` table covers dial error, 404, 503, 400 (+tools), 405, 2xx, and an unexpected status

### Edge Cases & Error Handling

- [x] A-017 R2: `Allows` rejects origins with path, query, fragment, userinfo, or non-http(s) scheme; fills default ports; folds case; keeps IPv6 bracketed
- [x] A-018 R3: unspecified bind hosts (`0.0.0.0`, `::`, empty) produce no entry; loopback, link-local, and multicast interface addresses are excluded; a zero `TailnetIdentity` adds nothing; a missing `tailscale` binary yields the zero identity without error
- [x] A-019 R5: an `mcp.New` error leaves the daemon running with `/mcp` answering 503 and a single `WARN`
- [x] A-020 R1: a `PUT /mcp` reaches the SDK and is answered 405

### Code Quality

- [x] A-021 Pattern consistency: new files follow `internal/mcp` naming and comment style (constraint-stating comments, no narration, no change-ids in code comments); doctor row mirrors `codeServerCheck`'s pure-check + seam shape; `serve.go` block matches the surrounding setter-wiring style
- [x] A-022 No unnecessary duplication: origin normalization lives in one helper shared by constructor and check; the 403 body uses the API error shape (`{"error": …}`); no second executor or SDK server is constructed
- [x] A-023 `exec.CommandContext` with timeouts for all subprocess calls: the tailscale probe is the only new subprocess and is bounded at 3 s with an argv slice (Constitution I / Process Execution)
- [x] A-024 Tests cover added behavior: origin policy, derivation, HTTP handler, router mount, `url --mcp`, doctor row
- [x] A-025 No magic values: `/mcp`, the 30 min idle timeout, the 3 s probe timeout, the 2 s doctor client timeout, and the 1 KiB body cap are named constants
- [x] A-026 Adding routes without spec justification: `/mcp` is justified by `docs/specs/api.md` § MCP and the router comment cites it
- [x] A-027 Derive state, no caches: the allowlist is computed once at start from live inputs; the SDK's per-session state is the only in-memory state and is bounded by the idle timeout

### Security

- [x] A-028 R2: the Origin guard never consults the request `Host` header (grep the guard for `r.Host`/`req.Host` — none)
- [x] A-029 R5: `/mcp` adds no auth surface and no bind-address change; the daemon still binds `RK_HOST:RK_PORT` only
- [x] A-030 R1: every tool call over `/mcp` still executes through the W1 `Executor` (argv, stdin plumbing, 45 s cap, `TMUX`/`TMUX_PANE` stripped)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `mcpRouteCheck` takes the resolved tool count as a parameter so the note can say `(<n> tools)` without re-resolving the table | The `mcp` row already resolved it in `runDoctorChecks`; re-running `mcp.Resolve` would duplicate work | S:60 R:95 A:85 D:70 |
| 2 | Confident | The `api/mcp_test.go` stub-handler case uses the existing test-router helpers and adds a `*Server`-returning variant only if none exists | Keeps test surface minimal; `NewTestRouter*` variants already exist for riff/wt injection | S:55 R:90 A:80 D:65 |
| 3 | Confident | Qualified hostnames contribute both the FQDN and the first label to the allowlist | MagicDNS resolves the short name via the tailnet search domain, so browsers may send either form | S:50 R:90 A:70 D:60 |
| 4 | Confident | `LiveTailnetIdentity` looks up `tailscale` with `exec.LookPath` before spawning and returns the zero value on absence at `DEBUG` | Most hosts without Tailscale should pay no subprocess; failure is silent by spec intent (the route never depends on tailscale) | S:60 R:90 A:85 D:75 |
| 5 | Certain | The `/mcp` route is registered with chi `Handle` (method-agnostic) and the SDK answers 405 for non-transport methods | chi has no multi-method registration shorthand; the SDK already implements the 405 | S:80 R:90 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).

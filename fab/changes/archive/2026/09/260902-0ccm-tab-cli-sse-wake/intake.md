# Intake: Tab CLI SSE Wake

**Change**: 260902-0ccm-tab-cli-sse-wake
**Created**: 2026-09-02

## Origin

Backlog item `[0ccm]` (2026-09-02), taken via `/fab-new 0ccm` (one-shot, no prior conversation):

> rk tab CLI mutations should wake the daemon's SSE derive tick when the server is reachable (fail-silent when down) — direct tmux option writes (layout/web/color) emit no control-mode event, so the UI repaints only on the ~12s safety poll; an agent choreographing visible UI changes from the CLI gets swallowed intermediate states (found live in the rk-tutorial Chapter 4 layout demo). Same pattern as the row-color POST hub-wake fix.

## Why

1. **Problem**: `rk tab` verbs (`new`, `layout`, `web add/rm/select/mv`, `code`) are substrate commands — they write `@rk_win_*` tmux options directly (`cmd/rk/tab*.go`) without going through the daemon's HTTP API. tmux `set-option` emits no control-mode event, so the tmuxctl watcher never notifies the SSE hub, and connected dashboards repaint only on the 12s safety poll (`safetyPollInterval`, `api/sse.go:77`). An agent (or tutorial script) choreographing a sequence of visible UI changes from the shell sees intermediate states swallowed — observed live in the rk-tutorial Chapter 4 layout demo, where successive `rk tab layout` calls collapsed into one repaint.

2. **Consequence if unfixed**: any CLI-driven UI choreography (tutorials, agent-driven layout/web-tab manipulation, `rk tab` used by fab workers) renders with up-to-12s lag and dropped intermediate frames. The dashboard's own POST paths already repaint instantly (they call `sseHub.wake` after the write — `api/servers.go:318`, `handleWindowOptions`), so the CLI path is the one visibly second-class surface.

3. **Why this approach**: the wake seam already exists server-side (`sseHub.wake(server)` — per-server, coalescing, no-op for servers with no connected clients), and the CLI→daemon fail-silent POST pattern already exists (`rk notify` → `sendNotify` in `cmd/rk/notify.go`: `resolveOrigin()` + short-timeout POST, all errors swallowed, exit 0). This change joins the two: after a successful mutation, `rk tab` best-effort-pokes the covering daemon. Alternatives rejected: making `rk tab` route mutations through the HTTP API would break its substrate-only contract ("works with rk serve down", `cli-layering.md`); shortening the safety poll burdens every deployment for a CLI-only need; a control-mode-visible write trick (e.g. a dummy rename) would be a hack against Constitution X.

## What Changes

### 1. New endpoint: `POST /api/servers/wake`

A minimal mutation-signal endpoint in `app/backend/api/servers.go`, registered beside the other server POSTs in `router.go` (POST per Constitution IX):

```
POST /api/servers/wake  ← {"name": "fabKit1"}  → 200 {"ok": true}
```

Handler shape mirrors `handleServerProtect` minus the tmux write:
- `validate.ValidateServerName(body.Name)` → `400` on failure (Constitution I — bounds the input before it keys any map)
- `s.initSSEHub()` (idempotent) then `s.sseHub.wake(body.Name)`
- A wake for a server with no connected clients is already a harmless no-op inside the hub — no existence check needed; the endpoint never touches tmux.

### 2. CLI-side wake helper + call sites

A shared helper in `cmd/rk/` (sibling of `sendNotify`, e.g. `wakeStateHub(ctx, server)`):
- Resolves the daemon origin via the existing `resolveOrigin()` (env → `@rk_srv_origin` → `http://127.0.0.1:3000` default)
- POSTs `{"name": <server>}` to `/api/servers/wake` with a short timeout (~2s — shorter than notify's 8s; this rides every `rk tab` mutation's hot path, and a down daemon fails instantly with connection-refused while the timeout only bounds a *hung* daemon)
- Fail-silent by design: any error (unreachable, non-2xx, timeout) is swallowed, no output, exit code unaffected — `rk tab` keeps its "works with rk serve down" contract byte-for-byte on stdout/stderr.

Called after the successful tmux write in every **mutating** verb:
- `runTabNew` (`tab_new.go`) — new-window arrives as `%unlinked-*` which the control-mode watcher ignores, so it is equally invisible
- `runTabLayout` (`tab_layout.go` — set/add/rm/promote/cycle all funnel here)
- `runTabWebAdd`, `runTabWebRm`, `runTabWebSelect`, `runTabWebMv` (`tab_web.go`)
- `runTabCodeSet` (`tab_code.go`)

Read-only verbs (`tab show`, `tab web ls`) do not wake. The `<server>` passed is the mutation's **target** server (the resolved `-L` value or the caller's own server) — the caller's covering daemon serves every tmux server on the box, so origin resolution and wake target are independent.

### 3. Tests

- Handler test (table-driven, beside the other `servers` handler tests): valid name wakes the hub, invalid name → 400, body decode failure → 400.
- CLI test: a seam (the `originRunOutputFn` idiom, or an injectable POST func) proving each mutating verb fires exactly one wake with the resolved server name, read-only verbs fire none, and a failing POST changes neither exit code nor output.

## Affected Memory

- `run-kit/api-and-sockets`: (modify) new `POST /api/servers/wake` route row; extends the wake-after-write pattern documentation to name the CLI as a wake source
- `run-kit/architecture`: (modify) `rk tab` CLI subcommand behavior — post-mutation fail-silent daemon wake

## Impact

- `app/backend/api/servers.go` + `app/backend/api/router.go` — new handler + route
- `app/backend/cmd/rk/` — new wake helper file + one call per mutating `rk tab` RunE (`tab_new.go`, `tab_layout.go`, `tab_web.go`, `tab_code.go`)
- Reuses `cmd/rk/origin.go` `resolveOrigin` unchanged
- No frontend changes (the SSE/`/ws/state` repaint path is already event-driven once the hub wakes)
- No new `rk tab` flags or help-output changes (toolkit-standards surface untouched)
- Spec alignment: `docs/specs/ui-state.md` § Layout already states the wake lesson for POST handlers; this extends it to the CLI substrate path (spec is human-curated; memory updates ride hydrate)

## Open Questions

- None — the backlog entry names the mechanism, the failure mode, and the precedent; both halves of the pattern exist in the codebase.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery is a fail-silent HTTP POST from the CLI to the covering daemon, mirroring `rk notify`'s `sendNotify`/`resolveOrigin` pattern | Backlog text specifies "when the server is reachable (fail-silent when down)"; the exact pattern ships today in `cmd/rk/notify.go` | S:90 R:85 A:95 D:90 |
| 2 | Confident | New endpoint `POST /api/servers/wake {"name"}` (no existing bare-wake route; `POST /api/status/refresh` is the heavier PR-status pass, wrong tool) | Path/name is a choice, but the servers-POST family is the obvious home and Constitution IX fixes the verb | S:70 R:85 A:80 D:65 |
| 3 | Certain | All mutating verbs wake (`new`, every `layout` mutation, `web add/rm/select/mv`, `code`); read-only `show`/`web ls` do not | Directly implied by the problem statement; read-only verbs change nothing to repaint | S:85 R:90 A:95 D:95 |
| 4 | Confident | CLI-side timeout ~2s, deliberately shorter than notify's 8s | Rides every mutation's hot path; down-daemon fails instantly regardless, timeout only bounds a hung daemon; trivially tunable later | S:55 R:90 A:70 D:60 |
| 5 | Confident | Wake target server = the mutation's resolved target (`-L` or own), posted to the caller's covering daemon | One daemon serves all tmux servers on the box; `sseHub.wake` is keyed per-server and no-ops safely for unknown names | S:65 R:80 A:75 D:70 |
| 6 | Confident | `rk tab new` is included among waking verbs | Memory (tmux control-mode event scope): window add/close arrive as `%unlinked-*` and are ignored by the watcher, so creation is equally invisible until the safety poll | S:70 R:85 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).

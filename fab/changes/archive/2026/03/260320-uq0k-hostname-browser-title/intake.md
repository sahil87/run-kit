# Intake: Hostname in Browser Title

**Change**: 260320-uq0k-hostname-browser-title
**Created**: 2026-03-20
**Status**: Draft

## Origin

> "we need to show the host name in browser title because i have multiple machines and it's hard to know i'm on which machine"

One-shot request. User manages multiple machines running run-kit and needs to visually distinguish which machine a browser tab is connected to. The browser tab title is the only persistent, always-visible identifier across tab-switching workflows.

## Why

1. **Problem**: When multiple run-kit instances are open across different machines, all browser tabs show the same static title ("RunKit"), making it impossible to identify which tab connects to which host without clicking into each one.
2. **Consequence**: The user accidentally sends commands to the wrong machine's tmux sessions — a potentially destructive mistake in an agent orchestration context.
3. **Approach**: Expose the server's hostname from the Go backend and render it in the browser tab title. This is the minimal, non-invasive approach — no new pages, no config UI, just data flow from `os.Hostname()` to `document.title`.

## What Changes

### Backend: Expose hostname in `/api/health` response

The `/api/health` endpoint currently returns `{"status": "ok"}`. Extend it to include the server's hostname:

```json
{ "status": "ok", "hostname": "arbaaz-dev-01" }
```

The hostname is obtained via Go's `os.Hostname()` at server startup (computed once, not per-request). This keeps the health endpoint lightweight and avoids repeated syscalls.

### Frontend: Dynamic browser title with hostname

On app initialization, fetch the hostname from the backend and set `document.title` to include it. Format:

```
RunKit — arbaaz-dev-01
```

When navigating to a specific session/window, the title could further include the session context:

```
mysession/0 — arbaaz-dev-01
```

The static `<title>RunKit</title>` in `index.html` remains as the fallback — it's what the user sees during initial load before the API responds.

## Affected Memory

- `run-kit/architecture`: (modify) Document hostname exposure via health endpoint

## Impact

- **Backend**: `api/router.go` (health handler), `cmd/run-kit/` or `internal/config/` (hostname init)
- **Frontend**: Route-level title management (new), API client (minor — health endpoint shape change)
- **API spec**: `docs/specs/api.md` — health endpoint response shape gains `hostname` field
- **Tests**: Health endpoint test needs update for new response shape; frontend title behavior needs test coverage

## Open Questions

- None — the scope is clear and self-contained.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `os.Hostname()` for the hostname value | Go stdlib provides this; no config needed; matches what the OS reports | S:85 R:90 A:95 D:95 |
| 2 | Certain | Expose hostname via existing `/api/health` endpoint | Avoids new endpoint; health is already fetched; constitution says minimal surface area | S:80 R:85 A:90 D:85 |
| 3 | Confident | Title format: `RunKit — {hostname}` (with em dash) | Clean, readable; consistent with common browser title conventions | S:70 R:95 A:70 D:65 |
| 4 | Confident | Include session/window in title when on a session route | Natural extension — `mysession/0 — hostname` gives full context per tab | S:65 R:90 A:75 D:60 |
| 5 | Certain | Compute hostname once at startup, not per-request | Constitution requires minimal overhead; hostname doesn't change at runtime | S:85 R:90 A:95 D:90 |
| 6 | Certain | Keep static `<title>RunKit</title>` as fallback | Standard SPA practice — title visible during initial load before JS hydration | S:90 R:95 A:90 D:95 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).

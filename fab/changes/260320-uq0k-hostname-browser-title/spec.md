# Spec: Hostname in Browser Title

**Change**: 260320-uq0k-hostname-browser-title
**Created**: 2026-03-20
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Backend: Hostname Exposure

### Requirement: Compute Hostname at Startup

The Go backend SHALL compute the server hostname via `os.Hostname()` once at startup and store it for the lifetime of the process. The hostname SHALL NOT be computed per-request.

#### Scenario: Hostname Available
- **GIVEN** the server starts on a machine with hostname `arbaaz-dev-01`
- **WHEN** `os.Hostname()` succeeds
- **THEN** the hostname value `arbaaz-dev-01` is stored and available to all handlers

#### Scenario: Hostname Unavailable
- **GIVEN** `os.Hostname()` returns an error
- **WHEN** the server starts
- **THEN** the hostname value SHALL fall back to an empty string `""`
- **AND** the server SHALL start normally (hostname failure is not fatal)

### Requirement: Health Endpoint Includes Hostname

The `GET /api/health` endpoint SHALL return a JSON response that includes the `hostname` field alongside the existing `status` field.

Response shape:
```json
{ "status": "ok", "hostname": "arbaaz-dev-01" }
```

When the hostname is unavailable (empty string fallback), the response SHALL include `"hostname": ""`.

#### Scenario: Health Check with Hostname
- **GIVEN** the server is running with hostname `arbaaz-dev-01`
- **WHEN** a client sends `GET /api/health`
- **THEN** the response status is `200`
- **AND** the response body contains `{"status":"ok","hostname":"arbaaz-dev-01"}`

#### Scenario: Health Check with Empty Hostname
- **GIVEN** `os.Hostname()` failed at startup
- **WHEN** a client sends `GET /api/health`
- **THEN** the response body contains `{"status":"ok","hostname":""}`

## Frontend: Dynamic Browser Title

### Requirement: Fetch Hostname from Backend

The frontend SHALL fetch the hostname from `GET /api/health` on app initialization. The API client SHALL expose a `getHealth()` function that returns the health response including the `hostname` field.

#### Scenario: Hostname Fetched on Load
- **GIVEN** the app loads in the browser
- **WHEN** the health endpoint responds with `{"status":"ok","hostname":"arbaaz-dev-01"}`
- **THEN** the hostname `arbaaz-dev-01` is available to the title-setting logic

### Requirement: Browser Title Format

The browser tab title SHALL include the hostname using the following formats:

- **Dashboard** (`/`): `RunKit — {hostname}`
- **Terminal page** (`/:session/:window`): `{session}/{window} — {hostname}`

The em dash ` — ` (U+2014) SHALL be used as the separator.

When the hostname is empty, the title SHALL omit the hostname suffix:
- Dashboard: `RunKit`
- Terminal page: `{session}/{window}`

The static `<title>RunKit</title>` in `index.html` SHALL remain unchanged as the pre-hydration fallback.

#### Scenario: Dashboard Title with Hostname
- **GIVEN** the app is on the Dashboard (`/`)
- **AND** the hostname is `arbaaz-dev-01`
- **WHEN** the title is rendered
- **THEN** `document.title` equals `RunKit — arbaaz-dev-01`

#### Scenario: Terminal Title with Hostname
- **GIVEN** the app is on `/:session/:window` with session `myproject` and window `0`
- **AND** the hostname is `arbaaz-dev-01`
- **WHEN** the title is rendered
- **THEN** `document.title` equals `myproject/0 — arbaaz-dev-01`

#### Scenario: Title Updates on Navigation
- **GIVEN** the user is on the Dashboard with title `RunKit — arbaaz-dev-01`
- **WHEN** the user navigates to session `agent-work` window `2`
- **THEN** `document.title` updates to `agent-work/2 — arbaaz-dev-01`

#### Scenario: Title Without Hostname
- **GIVEN** the hostname is empty (backend fallback)
- **WHEN** the app is on the Dashboard
- **THEN** `document.title` equals `RunKit`

## Design Decisions

1. **Hostname via health endpoint (not a dedicated endpoint)**
   - *Why*: Constitution mandates minimal surface area. Health is already fetched; adding a field is cheaper than a new endpoint.
   - *Rejected*: `GET /api/hostname` — unnecessary new route.

2. **Hostname computed once in `NewRouter()`, stored in Server struct (not in config package)**
   - *Why*: `internal/config` reads env vars; hostname is an OS-level value, not configuration. Computing it in `NewRouter()` keeps the production path simple while `NewTestRouter()` accepts hostname as a parameter for test injection.
   - *Rejected*: Adding to `config.Config` — hostname is not configurable, it's derived.

3. **Title managed via `useEffect` in `AppShell` (not a dedicated context)**
   - *Why*: `document.title` is a simple side effect driven by route params + a single string. A context would be over-engineering for a derived value.
   - *Rejected*: `HostnameContext` — overkill for a single string fetched once.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `os.Hostname()` for the hostname value | Confirmed from intake #1. Go stdlib, no config needed | S:85 R:90 A:95 D:95 |
| 2 | Certain | Expose hostname via existing `/api/health` endpoint | Confirmed from intake #2. Constitution: minimal surface area | S:80 R:85 A:90 D:85 |
| 3 | Confident | Title format: `RunKit — {hostname}` with em dash | Confirmed from intake #3. Clean, readable, standard convention | S:70 R:95 A:70 D:65 |
| 4 | Confident | Include session/window in title: `session/window — hostname` | Confirmed from intake #4. Natural multi-tab identification | S:65 R:90 A:75 D:60 |
| 5 | Certain | Compute hostname once at startup, store in Server struct | Confirmed from intake #5. Upgraded: spec clarifies injection via Server struct | S:85 R:90 A:95 D:90 |
| 6 | Certain | Keep static `<title>RunKit</title>` as fallback | Confirmed from intake #6. Standard SPA practice | S:90 R:95 A:90 D:95 |
| 7 | Certain | Hostname failure falls back to empty string (non-fatal) | OS hostname is best-effort; server must start regardless | S:80 R:95 A:90 D:90 |
| 8 | Certain | Title managed as `useEffect` side effect, not a context | Single derived string; context is overkill | S:85 R:95 A:85 D:90 |
| 9 | Confident | Fetch hostname once via `getHealth()` on app init | Health endpoint already exists; one fetch on init is minimal overhead | S:75 R:90 A:80 D:70 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).

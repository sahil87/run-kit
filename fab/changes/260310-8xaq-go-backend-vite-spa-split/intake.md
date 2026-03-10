# Intake: Go Backend + Vite SPA Split

**Change**: 260310-8xaq-go-backend-vite-spa-split
**Created**: 2026-03-10
**Status**: Draft

## Origin

> Split run-kit into monorepo with Go backend and Vite+React SPA frontend

Conversational `/fab-discuss` session. User identified that the Next.js monolith — while effective for prototyping — is architecturally wrong for the project's direction. The core tension: run-kit needs to support multiple frontend iterations (web, mobile, potentially CLI) but Next.js tightly couples server and client. The user wants the backend to be a stable, long-lived API that outlives any individual frontend.

Three backend options were evaluated:
- **Hono** — dismissed because it has no native WebSocket story (delegates to runtime); on Node.js it would use the same `ws` library, adding no benefit
- **Rust** — acknowledged as highest performance but dismissed for development velocity cost; the borrow checker tax isn't justified for orchestration glue code that needs to be correct and fast enough, not nanosecond-optimal
- **Go** — chosen for: stdlib `net/http` stability (code written 5 years ago still compiles), single static binary deployment, goroutines for concurrent WebSocket connections, native PTY support via `creack/pty` (eliminates `node-pty` native module dependency), and fast iteration on backend logic

User explicitly stated: "Scaling isn't the problem." The drivers are decoupling, multi-client API support, fast frontend iteration, and backend stability/speed.

User decided to combine the repo split and Go rewrite into a single change: "why break it? the backend is anyway being rewritten."

## Why

1. **Frontend/backend coupling blocks iteration** — Next.js App Router interleaves server and client code. Rewriting or replacing the frontend requires understanding and untangling server-side data fetching, API routes, and React Server Components. The user plans multiple frontend iterations; each rewrite carries unnecessary backend risk.

2. **Multi-client API is a requirement** — The API must serve web frontends, Android apps, iOS apps, and potentially CLI tools. Next.js API routes are designed as an adjunct to the React app, not as a standalone API server. A proper Go HTTP server with explicit route definitions is the right foundation.

3. **Backend stability** — The Go backend should be a stable platform that rarely changes while frontends iterate rapidly. Go's stdlib stability, single-binary deployment, and lack of runtime dependencies (no `node_modules`, no native modules) make it ideal for this role.

4. **If we don't do this** — Every frontend iteration requires re-learning the Next.js server coupling. Mobile clients would need a separate API anyway, creating a split API surface. The terminal relay (WebSocket + PTY) remains tied to Node.js native modules.

## What Changes

### Repo Structure

Restructure from flat `src/` into pnpm workspaces:

```
packages/
  api/              # Go module — the stable backend
    cmd/
      run-kit/
        main.go     # Entry point
    internal/
      tmux/         # Ported from src/lib/tmux.ts
      config/       # Ported from src/lib/config.ts
      fab/          # Ported from src/lib/fab.ts
      worktree/     # Ported from src/lib/worktree.ts
      sessions/     # Ported from src/lib/sessions.ts
      validate/     # Ported from src/lib/validate.ts
      relay/        # Terminal relay (WebSocket + PTY), ported from src/terminal-relay/
    api/
      routes.go     # HTTP router + handlers
      sse.go        # SSE endpoint
      upload.go     # File upload endpoint
    go.mod
    go.sum

  web/              # Vite + React SPA — the disposable frontend
    src/
      components/   # From src/components/
      contexts/     # From src/contexts/
      hooks/        # From src/hooks/
      pages/        # Replaces src/app/ page components
      api/          # Typed fetch wrappers for Go backend
    index.html
    vite.config.ts
    package.json
    tsconfig.json

e2e/                # Stays at root — tests the full stack
fab/                # Stays at root
docs/               # Stays at root
supervisor.sh       # Updated for Go binary + Vite dev/build
Caddyfile.example   # Updated: reverse proxy API, serve SPA static
pnpm-workspace.yaml # Workspace config (packages/web only — Go is independent)
```

Root-level files removed: `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `tsconfig.json` (moves to `packages/web/`). `vitest.config.ts` moves to `packages/web/`.

### Go Backend (`packages/api/`)

**HTTP server** — `chi` router (lightweight, zero transitive deps, ergonomic middleware chaining for CORS, logging, panic recovery). Single binary serves both REST API and WebSocket terminal relay on configurable ports.

**API endpoints** — exact parity with current Next.js API routes:

| Endpoint | Method | Current Source | Go Target |
|----------|--------|----------------|-----------|
| `/api/health` | GET | `src/app/api/health/route.ts` | `api/routes.go` |
| `/api/sessions` | GET | `src/app/api/sessions/route.ts` | `api/routes.go` |
| `/api/sessions` | POST | `src/app/api/sessions/route.ts` | `api/routes.go` |
| `/api/sessions/stream` | GET (SSE) | `src/app/api/sessions/stream/route.ts` | `api/sse.go` |
| `/api/directories` | GET | `src/app/api/directories/route.ts` | `api/routes.go` |
| `/api/upload` | POST | `src/app/api/upload/route.ts` | `api/upload.go` |

**Terminal relay** — `gorilla/websocket` for WebSocket handling, `creack/pty` for PTY allocation. Same URL scheme: `ws://{host}:{relayPort}/:session/:window`. Same behavior: split-window per connection, relay I/O, kill pane on disconnect.

**tmux integration** — `os/exec` with `execve`-style argument arrays (same security model as `execFile`). All calls with timeouts via `context.WithTimeout`. Port existing logic from `src/lib/tmux.ts` (session listing, window listing, byobu filtering, sendKeys, createSession, createWindow, killSession, killWindow).

**Config** — same resolution order: CLI args > `run-kit.yaml` > defaults. YAML parsing via `gopkg.in/yaml.v3`.

**SSE** — module-level poller (goroutine polling tmux every 2.5s), fan-out to connected clients. Same deduplication behavior as current singleton.

### Vite SPA Frontend (`packages/web/`)

**Build** — Vite with React plugin. No SSR. Output is static files (HTML + JS + CSS) served by Caddy or the Go server itself.

**Routing** — TanStack Router for type-safe params and search params, built-in loader pattern for route-level data fetching. Same three routes: `/`, `/p/:project`, `/p/:project/:window`.

**Data fetching** — All data via `fetch()` to the Go API. No Server Components, no server actions. A typed API client module (`src/api/`) wraps fetch calls with TypeScript types.

**SSE** — `EventSource` connecting to Go backend's `/api/sessions/stream`. Same `SessionProvider` pattern at layout level.

**WebSocket** — Terminal relay connects to Go backend's WebSocket endpoint. Same xterm.js integration.

**Components** — Direct migration of existing components. Remove Server Component patterns, replace with client-side data fetching:
- `session-card.tsx` — unchanged (already a client pattern)
- `command-palette.tsx` — unchanged
- `bottom-bar.tsx` — unchanged
- `compose-buffer.tsx` — unchanged
- `breadcrumb-dropdown.tsx` — unchanged
- `top-bar-chrome.tsx` — unchanged
- `arrow-pad.tsx` — unchanged
- `dialog.tsx` — unchanged

**Hooks** — Direct migration, all already client-side:
- `use-sessions.ts` — minor: point EventSource at Go backend URL
- `use-keyboard-nav.ts` — unchanged
- `use-visual-viewport.ts` — unchanged
- `use-modifier-state.ts` — unchanged
- `use-file-upload.ts` — minor: point upload fetch at Go backend URL

**Page components** — Rewrite from Next.js App Router to plain React components:
- `dashboard-client.tsx` → `pages/dashboard.tsx` (fetch sessions from API instead of receiving as props)
- `project-client.tsx` → `pages/project.tsx`
- `terminal-client.tsx` → `pages/terminal.tsx` (relay port from config endpoint or env var instead of server component prop)

**Styling** — Tailwind CSS 4 + same `globals.css`. PostCSS config moves to `packages/web/`.

### Supervisor Updates

`supervisor.sh` updated to:
- Build Go binary: `cd packages/api && go build -o ../../bin/run-kit ./cmd/run-kit`
- Build frontend: `cd packages/web && pnpm build` (outputs to `packages/web/dist/`)
- Start Go server (serves API + optionally serves SPA static files)
- Health check against Go's `/api/health`
- Rollback: `git revert HEAD` still works (same repo)

### Caddyfile Updates

Caddy reverse proxies API requests to Go backend, serves SPA static files directly:

```
run-kit.local {
    handle /api/* {
        reverse_proxy localhost:3000
    }
    handle /ws/* {
        reverse_proxy localhost:3001
    }
    handle {
        root * packages/web/dist
        try_files {path} /index.html
        file_server
    }
}
```

### E2E Test Updates

Playwright tests in `e2e/` need web server config updated to point at the Go backend + Vite dev server (or built SPA). Test logic should remain largely unchanged — they test browser behavior, not server implementation.

### What Gets Deleted

- `src/` — entire directory (replaced by `packages/api/` and `packages/web/`)
- `next.config.ts`, `next-env.d.ts` — Next.js config
- Root `tsconfig.json` — moves to `packages/web/`
- Root `vitest.config.ts` — moves to `packages/web/`
- `postcss.config.mjs` — moves to `packages/web/`

## Affected Memory

- `run-kit/architecture`: (modify) Major rewrite — new system overview (Go backend + Vite SPA), updated data model, new backend libraries section (Go modules), updated API layer, updated terminal relay, updated supervisor, updated testing
- `run-kit/ui-patterns`: (modify) Minor updates — remove Server Component references, update data fetching patterns to API client
- `run-kit/tmux-sessions`: (no change) tmux enumeration logic is implementation-agnostic

## Impact

- **Every source file** — `src/` is deleted and replaced by `packages/api/` (Go) and `packages/web/` (TypeScript/React)
- **Build pipeline** — `pnpm build` no longer builds the whole app; separate Go and Vite builds
- **Development workflow** — `dev.sh` needs updating for concurrent Go + Vite dev servers
- **Deployment** — single Go binary + static files instead of Next.js server
- **Dependencies** — Go modules replace Node.js backend deps (`ws`, `node-pty`, `yaml`). Frontend deps slim down (remove `next`, add `vite`, `@tanstack/react-router`)
- **Constitution impact** — Constitution principles remain valid but implementation changes: "No Database" (still true), "execFile with argument arrays" becomes "os/exec with argument slices" (same security model), "Wrap, Don't Reinvent" (fab-kit scripts still called via Go's os/exec)

## Open Questions

- Should Go tests port the existing Vitest test cases or start fresh with Go's testing patterns?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Go for backend, not Rust or Hono | Discussed — user evaluated all three, chose Go for stability + dev velocity + native PTY | S:95 R:30 A:90 D:95 |
| 2 | Certain | Vite + React SPA for frontend | Discussed — natural choice given existing React components, no SSR needed | S:90 R:70 A:90 D:85 |
| 3 | Certain | pnpm workspaces monorepo (not separate repos) | Discussed — shared fab/docs/e2e, one PR for contract changes | S:90 R:75 A:85 D:90 |
| 4 | Certain | Single change (not separate split + rewrite) | Discussed — user explicitly said "why break it?" | S:95 R:50 A:95 D:95 |
| 5 | Certain | Drivers: decoupling, multi-client, iteration speed, stability (NOT scaling) | Discussed — user corrected "scaling" assumption | S:95 R:80 A:90 D:95 |
| 6 | Confident | gorilla/websocket for WebSocket relay | Strong ecosystem default for Go WebSockets; `nhooyr/websocket` is the alternative but gorilla is more battle-tested | S:70 R:80 A:80 D:70 |
| 7 | Confident | creack/pty for PTY allocation | Standard Go PTY library, eliminates node-pty native module dependency | S:70 R:75 A:85 D:80 |
| 8 | Confident | Same API contract (endpoint parity with current Next.js routes) | Enables incremental migration and preserves e2e test validity | S:75 R:85 A:80 D:75 |
| 9 | Confident | Tailwind CSS 4 stays (not switching CSS approach) | Existing styles work, no reason to change CSS tooling in this change | S:80 R:90 A:85 D:85 |
| 10 | Certain | chi router for Go HTTP server | Clarified — user chose chi for middleware ergonomics (CORS, logging, recovery) over zero-dep ServeMux | S:95 R:85 A:90 D:95 |
| 11 | Certain | TanStack Router for client-side routing | Clarified — user chose TanStack Router for type-safe params and loaders | S:95 R:80 A:90 D:95 |
| 12 | Certain | Go serves SPA in dev, Caddy in production | Clarified — user confirmed dual-mode serving strategy | S:95 R:85 A:90 D:95 |
| 13 | Certain | Relay port via `/api/config` runtime endpoint | Clarified — user chose config endpoint over build-time env vars | S:95 R:80 A:90 D:95 |

13 assumptions (9 certain, 4 confident, 0 tentative, 0 unresolved).

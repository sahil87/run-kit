# Project Context

<!-- Free-form project context: tech stack, conventions, architecture.
     This is the primary way skills understand your codebase without reading every file.
     Write naturally in markdown — no YAML constraints.

     Tips:
       - Be specific about languages, frameworks, and patterns
       - For monorepos, use labeled sections so skills scope to the relevant part:

         ## packages/frontend
         React, TypeScript, Next.js, Tailwind CSS

         ## packages/backend
         Python, FastAPI, SQLAlchemy, PostgreSQL
-->

## Repository Layout

```
app/
  backend/     # Go HTTP server (chi router)
  frontend/    # Vite + React SPA
```

Monorepo managed by pnpm workspaces. Task runner: `just` (see `justfile`).

## Backend — `app/backend/`

- **Language**: Go 1.22
- **Router**: chi/v5
- **WebSocket**: gorilla/websocket — terminal relay to tmux panes via creack/pty
- **SSE**: custom handler for real-time session state
- **Config parsing**: `gopkg.in/yaml.v3` for `run-kit.yaml`
- **Structure**: `cmd/run-kit/` (entrypoint), `api/` (HTTP handlers), `internal/` (config, fab, sessions, tmux, validate)
- **Testing**: `go test ./...`
- **Build**: `go build -o ../../bin/run-kit ./cmd/run-kit`

## Frontend — `app/frontend/`

- **Language**: TypeScript 5.7+
- **Framework**: Vite 7 + React 19 (SPA, no SSR)
- **Routing**: TanStack Router — routes: `/` (redirect), `/$session/$window`
- **UI**: Tailwind CSS 4
- **Terminal**: xterm.js 5 (`@xterm/xterm`) with FitAddon and WebLinks addon
- **API client**: `src/api/client.ts`
- **Testing**: Vitest 4, Testing Library (React + jest-dom), jsdom, Playwright (e2e)
- **Build**: `tsc --noEmit && vite build`
- **Package manager**: pnpm

## Conventions

- State derived from tmux + filesystem at request time — no database, no in-memory caches
- All Go subprocess calls use `exec.CommandContext` with timeouts — never shell strings
- Dark theme only, monospace everywhere
- Keyboard-first — command palette (`Cmd+K`) is primary discovery mechanism
- SSE for real-time session state, WebSocket for terminal I/O
- Dev workflow: `just dev` (runs Go backend with air live-reload + Vite dev server concurrently)
- For interactive UI testing during development, use Playwright MCP with `just dev --port <port>` to start the service

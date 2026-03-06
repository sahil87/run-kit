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

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Next.js 15 (App Router, Server Components by default)
- **Language**: TypeScript 5.7+
- **UI**: React 19, Tailwind CSS 4, shadcn/ui (generated into `components/ui/`)
- **Terminal**: xterm.js 5 (`@xterm/xterm`) with FitAddon and WebLinks addon
- **Terminal relay**: WebSocket server (`ws`) + `node-pty` for tmux pane I/O
- **Testing**: Vitest 4, Testing Library (React + jest-dom), jsdom
- **Package manager**: pnpm
- **Build**: `pnpm build` (Next.js production build)
- **Config parsing**: `yaml` package for `run-kit.yaml`

## Conventions

- Server Components by default; Client Components only for interactivity (keyboard handlers, xterm, SSE)
- All subprocess calls via `execFile` with argument arrays + timeouts (never `exec` or shell strings)
- State derived from tmux + filesystem at request time — no database, no in-memory caches
- Fab-kit scripts wrapped in typed async functions in `src/lib/*.ts`
- Dark theme only, monospace everywhere, `max-w-4xl` on all pages
- Three routes: `/`, `/p/:project`, `/p/:project/:window`
- SSE for real-time session state, WebSocket for terminal I/O

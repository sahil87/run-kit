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

Task runner: `just` (see `justfile`). Frontend deps managed by pnpm (in `app/frontend/`).

## Backend — `app/backend/`

- **Language**: Go 1.22
- **Router**: chi/v5
- **WebSocket**: gorilla/websocket — terminal relay to tmux panes via creack/pty
- **SSE**: custom handler for real-time session state
- **Config**: environment variables (`RK_PORT`, `RK_HOST`) loaded via `.env` / `.env.local`
- **Structure**: `cmd/rk/` (entrypoint), `api/` (HTTP handlers), `internal/` (config, fab, sessions, tmux, validate)
- **Testing**: `go test ./...`
- **Build**: `go build -o ../../bin/rk ./cmd/rk`

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
- Three-mode theme (system/light/dark), monospace everywhere
- Hover-animation vocabulary: one treatment per element category — glitch=brand, boot-sweep=top-bar page heading (one inverse-video cursor sweeps the `PageType: name` string: TypedLabel-style typed cursor over the prefix flowing into a decode glyph-churn over the instance name, ~28ms/cell; reuses the `rk-typed-*` cell classes + DECODE_* constants), brackets+caret=section headings (SectionHeading — the label keeps its typed-sweep inside the brackets), typed-sweep=section labels (TypedLabel — an inverse-video cursor types the label out in ~350ms), CRT glint=buttons (green sweep + the hovered chip's border/glyph flip green) — animated elements turn accent-green; `rk-*` utility classes in `globals.css`; under `prefers-reduced-motion` animations are zeroed and JS treatments skip themselves (classes and static hover colors remain)
- Keyboard-first — command palette (`Cmd+K`) is primary discovery mechanism
- SSE for real-time session state, WebSocket for terminal I/O
- Dev workflow: `just dev` (runs Go backend with air live-reload + Vite dev server concurrently)

## Testing

Run `just setup` once before attempting to run test cases — it installs frontend deps, playwright browsers, copies `.env.local`, and stages the tmux config for Go embed. Re-run when pulling dependency changes.

Always run tests through `just` recipes — never invoke `go test`, `pnpm test`, or `playwright test` directly. The `just test-e2e` recipe (via `scripts/test-e2e.sh`) starts a dedicated dev server on port 3020 with an isolated tmux server (`rk-test-e2e`), so e2e tests won't collide with a running `rk serve` instance on the default port. Running Playwright directly would fall back to port 3000 and interfere with the live instance.

- `just test` — all tests (backend + frontend + e2e)
- `just test-backend` — Go tests only
- `just test-frontend` — Vitest unit tests only
- `just test-e2e` — Playwright e2e tests (port 3020, isolated tmux server)
- `just pw` — ad-hoc Playwright commands (port 3020, e.g., `just pw test mobile-layout`)

The Playwright fallback port is 3333 (not 3000) — if `RK_PORT` is unset and Playwright runs directly, it will fail to connect rather than hitting a live `rk serve` instance.

## Playwright-Driven Development

When making UI changes — especially mobile/responsive work — use Playwright MCP as the primary verification tool:

1. Start a dev server on the e2e port: `RK_PORT=3020 just dev`
2. Set viewport size to simulate the target device (e.g., 375×812 for iPhone)
3. Navigate, click, and screenshot to verify layout changes visually
4. Test interactive elements: popups, drawers, toggles — confirm they render within bounds and aren't clipped
5. Resize viewport to verify desktop layout isn't broken
6. Run individual tests with `just pw test <name>` (uses port 3020 by default)

Never run `npx playwright test` directly — always use `just test-e2e` or `just pw` to ensure correct port isolation. This workflow catches overflow issues, clipping, and layout regressions that unit tests miss. Always verify both mobile (375px) and desktop (1024px+) viewports after responsive changes.

## Mobile Responsive Design

- Touch targets use the `coarse:` custom Tailwind variant (`@media (pointer: coarse)`) for touch devices
- Touch targets: bottom-bar chips are 33×35px with a 6px gap on fine pointers and the full `coarse:min-h-[36px] coarse:min-w-[36px]` + 4px gap on touch (375px single-row budget unchanged); `coarse:30px` square for top-bar button controls (24px on fine pointers), applied uniformly across the whole right-side cluster — splits, close, refresh, Aa, bell, theme, fixed-width — so they don't diverge in size on touch devices. The centered window heading also carries `coarse:min-h-[30px]` (it is the mobile leaf and the primary rename affordance there)
- Bottom bar toolbar fits all buttons in a single row at 375px — no wrapping, no horizontal scroll
- Top bar is a single-line 3-column grid (`grid-cols-[1fr_auto_1fr]`): a breadcrumb ending at the PARENT (left) · a universal `PageType: name` center page heading on EVERY mode (center — `Terminal: <window>` editable + ▾ window switcher, `Board: <board>` display + ▾ board switcher, `Server Cabin: <server>` display, solo `Cockpit`) · button cluster + connection dot (right). Move-don't-copy: the current-page leaf is the centered heading, never duplicated in the breadcrumb — the root server leaf and board name/▾ live in the center, the left breadcrumb ends at its parent (board mode keeps only the pane/server counts + cycle hint; the `Board ▸` home button is gone). The page-type prefix is a static sibling span (hidden below `sm`; solo `Cockpit` visible at all breakpoints). Session creation lives in the session crumb's `+ New Session`, window creation in the `▾` switcher's `+ New Window`. Window rename is the heading name itself — click for inline edit (Enter/blur commit, Escape cancels) or the palette's `Window: Rename`; there is no rename dialog (board/root/cockpit names are display-only)
- Mobile sidebar drawer is `absolute` inside the main area (not `fixed inset-0`) so the top bar stays visible and the logo toggle can close the drawer
- The `.app-shell` and terminal column have `overflow: hidden` to prevent horizontal page overflow from xterm.js canvas
- Terminal font: device default is 11px on mobile / 13px on desktop, set in JS via xterm `options.fontSize` (no CSS media query). Users can override via the terminal-font control (`ChromeContext.terminalFontSize`, persisted to `runkit-terminal-font-size`); the device default applies only when no preference is stored. The mobile/desktop split uses the shared narrow-width-OR-coarse-pointer rule (`isMobileViewport()`), not a width-only query
- tmux has a hard minimum width (~80 cols) that exceeds most phone screens — horizontal overflow in the terminal area is expected and acceptable
